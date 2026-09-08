/**
 * CAP-02 / CA-05. Both delay branches are exercised by the number the worker
 * sent — `retryAfterMs = 0` and `retryAfterMs > 0` — never by an attempt count
 * this machine keeps, because it keeps none.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";
import {
  UNLOCK_ROUTES_IN_ORDER,
  unlockMachine,
} from "../../../src/application/workflows/unlock.machine.js";
import {
  fakeClock,
  fakeServices,
  rejects,
  resolves,
  unlockedSession,
  workerError,
} from "./fakes.js";

const PASSPHRASE = "harbour lantern gravel thicket";
const TICK_MS = 1_000;

function start(fake: ReturnType<typeof fakeServices>, clock = fakeClock()) {
  const actor = createActor(unlockMachine, {
    input: { services: fake.services, clock, tickMs: TICK_MS },
  });
  actor.start();
  return { actor, clock };
}

/** Advances both the fake clock and the timer queue by the same amount. */
async function tick(
  clock: ReturnType<typeof fakeClock>,
  ms: number,
): Promise<void> {
  clock.advance(ms);
  await vi.advanceTimersByTimeAsync(ms);
}

describe("unlockMachine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers the recovery-code route before the reset route (FR-22)", () => {
    expect(UNLOCK_ROUTES_IN_ORDER).toEqual(["recovery-code", "reset"]);
    expect(UNLOCK_ROUTES_IN_ORDER.indexOf("recovery-code")).toBeLessThan(
      UNLOCK_ROUTES_IN_ORDER.indexOf("reset"),
    );
  });

  it("unlocks through the worker and keeps the session view", async () => {
    const fake = fakeServices({
      unlock: resolves({
        kind: "unlock" as const,
        session: unlockedSession({ settings: { idleTimeoutMinutes: 15 } }),
      }),
    });
    const { actor } = start(fake);

    actor.send({ type: "SUBMIT", passphrase: PASSPHRASE });
    expect(actor.getSnapshot().value).toBe("deriving");
    await vi.advanceTimersByTimeAsync(0);

    expect(actor.getSnapshot().value).toBe("unlocked");
    expect(actor.getSnapshot().context.session?.settings).toEqual({
      idleTimeoutMinutes: 15,
    });
    expect(fake.calls).toEqual([
      { name: "unlock", input: { passphrase: PASSPHRASE } },
    ]);
  });

  it("allows an immediate retry when the worker imposed no delay", async () => {
    const fake = fakeServices({
      unlock: rejects(workerError("wrong-passphrase")),
    });
    const { actor } = start(fake);

    actor.send({ type: "SUBMIT", passphrase: "wrong" });
    await vi.advanceTimersByTimeAsync(0);

    expect(actor.getSnapshot().value).toEqual({ failed: "ready" });
    expect(actor.getSnapshot().context.error).toEqual({
      kind: "wrong-passphrase",
    });
    expect(actor.getSnapshot().context.retryAfterMs).toBe(0);

    actor.send({ type: "SUBMIT", passphrase: "wrong" });
    expect(actor.getSnapshot().value).toBe("deriving");
  });

  it("renders the worker's delay, refuses retry until it elapses, then reopens", async () => {
    const fake = fakeServices({
      unlock: rejects(workerError("rate-limited", 2_000)),
    });
    const { actor, clock } = start(fake);

    actor.send({ type: "SUBMIT", passphrase: "wrong" });
    await vi.advanceTimersByTimeAsync(0);

    expect(actor.getSnapshot().value).toEqual({ failed: "waiting" });
    expect(actor.getSnapshot().context.retryAfterMs).toBe(2_000);
    expect(actor.getSnapshot().context.remainingMs).toBe(2_000);

    // Retry is not merely discouraged while waiting — it does nothing.
    actor.send({ type: "SUBMIT", passphrase: PASSPHRASE });
    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().value).toEqual({ failed: "waiting" });
    expect(fake.names()).toEqual(["unlock"]);

    await tick(clock, TICK_MS);
    expect(actor.getSnapshot().context.remainingMs).toBe(1_000);
    expect(actor.getSnapshot().value).toEqual({ failed: "waiting" });

    await tick(clock, TICK_MS);
    expect(actor.getSnapshot().context.remainingMs).toBe(0);
    expect(actor.getSnapshot().value).toEqual({ failed: "ready" });

    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().value).toBe("locked");
    expect(actor.getSnapshot().context.error).toBeUndefined();
  });

  it("renders whatever delay the worker sends, without deriving a schedule", async () => {
    for (const retryAfterMs of [2_000, 4_000, 3_600_000]) {
      const fake = fakeServices({
        unlock: rejects(workerError("rate-limited", retryAfterMs)),
      });
      const { actor } = start(fake);
      actor.send({ type: "SUBMIT", passphrase: "wrong" });
      await vi.advanceTimersByTimeAsync(0);

      expect(actor.getSnapshot().context.retryAfterMs).toBe(retryAfterMs);
      expect(actor.getSnapshot().context.remainingMs).toBe(retryAfterMs);
      actor.stop();
    }
  });

  it("stops the countdown when the machine stops", async () => {
    const fake = fakeServices({
      unlock: rejects(workerError("rate-limited", 2_000)),
    });
    const { actor } = start(fake);
    actor.send({ type: "SUBMIT", passphrase: "wrong" });
    await vi.advanceTimersByTimeAsync(0);

    actor.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("holds no passphrase in a snapshot after the derive settles", async () => {
    const fake = fakeServices({
      unlock: rejects(workerError("wrong-passphrase")),
    });
    const { actor } = start(fake);

    actor.send({ type: "SUBMIT", passphrase: PASSPHRASE });
    expect(actor.getSnapshot().context.draft).toEqual({
      passphrase: PASSPHRASE,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(actor.getSnapshot().context.draft).toBeUndefined();
    expect(JSON.stringify(actor.getSnapshot().context)).not.toContain(
      PASSPHRASE,
    );
  });
});
