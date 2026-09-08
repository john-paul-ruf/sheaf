/**
 * CAP-03 / D13 / AD-7. The claim under test is ordering: the timer arms only
 * after the worker confirms the write, and a refusal leaves both the stored
 * value and the running countdown untouched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";
import {
  IDLE_TIMEOUT_OPTIONS,
  MINUTE_MS,
  isRetryableSettingsError,
  sessionMachine,
} from "../../../src/application/workflows/session.machine.js";
import {
  IDLE_TIMEOUT_CHOICES,
  fakeServices,
  rejects,
  resolves,
  unlockedSession,
  workerError,
} from "./fakes.js";
import type { IdleTimeoutMinutesV1 } from "../../../src/workers/protocol/messages.js";

function start(
  fake: ReturnType<typeof fakeServices>,
  idleTimeoutMinutes: IdleTimeoutMinutesV1 = 0,
) {
  const actor = createActor(sessionMachine, {
    input: {
      services: fake.services,
      session: unlockedSession({ settings: { idleTimeoutMinutes } }),
    },
  });
  actor.start();
  return actor;
}

function persists(minutes: IdleTimeoutMinutesV1) {
  return resolves({
    kind: "updateSettings" as const,
    settings: { idleTimeoutMinutes: minutes },
    session: unlockedSession({ settings: { idleTimeoutMinutes: minutes } }),
  });
}

const lockAck = resolves({
  kind: "lock" as const,
  status: { state: "locked" as const },
});

describe("sessionMachine — idle timeout (D13/AD-7)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers exactly the four approved choices", () => {
    expect(IDLE_TIMEOUT_OPTIONS).toEqual([0, 5, 15, 60]);
    expect([...IDLE_TIMEOUT_OPTIONS]).toEqual([...IDLE_TIMEOUT_CHOICES]);
  });

  it("starts disarmed, because off is the product default", () => {
    const actor = start(fakeServices());

    expect(actor.getSnapshot().value).toEqual({
      active: { settings: "idle", idleTimer: "disarmed" },
    });
    expect(actor.getSnapshot().context.idleTimeoutMinutes).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("persists before arming, and arms with the worker's value", async () => {
    const fake = fakeServices({ updateSettings: persists(15) });
    const actor = start(fake);

    actor.send({ type: "SET_IDLE_TIMEOUT", minutes: 15 });

    // While the write is in flight nothing is armed and nothing is adopted.
    expect(actor.getSnapshot().value).toEqual({
      active: { settings: "savingIdleTimeout", idleTimer: "disarmed" },
    });
    expect(actor.getSnapshot().context.idleTimeoutMinutes).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(0);

    expect(actor.getSnapshot().value).toEqual({
      active: { settings: "idle", idleTimer: "armed" },
    });
    expect(actor.getSnapshot().context.idleTimeoutMinutes).toBe(15);
    expect(fake.calls).toEqual([
      { name: "updateSettings", input: { idleTimeoutMinutes: 15 } },
    ]);

    await vi.advanceTimersByTimeAsync(15 * MINUTE_MS);
    expect(actor.getSnapshot().context.lockReason).toBe("idle-timeout");
  });

  it("adopts the worker's value, not the optimistic one", async () => {
    // The worker answers 5 to a request for 60: the surface must show 5.
    const fake = fakeServices({ updateSettings: persists(5) });
    const actor = start(fake);

    actor.send({ type: "SET_IDLE_TIMEOUT", minutes: 60 });
    await vi.advanceTimersByTimeAsync(0);

    expect(actor.getSnapshot().context.idleTimeoutMinutes).toBe(5);
    expect(actor.getSnapshot().context.session.settings).toEqual({
      idleTimeoutMinutes: 5,
    });
  });

  it("leaves the stored value and the running timer unchanged when the write is refused", async () => {
    let answer = persists(5);
    const fake = fakeServices({ updateSettings: () => answer() });
    const actor = start(fake, 5);

    // Half of the armed five-minute countdown has elapsed.
    await vi.advanceTimersByTimeAsync(2.5 * MINUTE_MS);

    answer = rejects(workerError("revision-conflict"));
    actor.send({ type: "SET_IDLE_TIMEOUT", minutes: 60 });
    await vi.advanceTimersByTimeAsync(0);

    expect(actor.getSnapshot().value).toEqual({
      active: { settings: "idle", idleTimer: "armed" },
    });
    expect(actor.getSnapshot().context.idleTimeoutMinutes).toBe(5);
    expect(actor.getSnapshot().context.settingsError).toEqual({
      kind: "revision-conflict",
    });

    // The original deadline still holds: the refused write did not restart it.
    await vi.advanceTimersByTimeAsync(2.5 * MINUTE_MS);
    expect(actor.getSnapshot().context.lockReason).toBe("idle-timeout");
  });

  it("treats a revision conflict as retryable and other refusals as not", () => {
    expect(isRetryableSettingsError({ kind: "revision-conflict" })).toBe(true);
    expect(isRetryableSettingsError({ kind: "invalid-setting" })).toBe(false);
    expect(isRetryableSettingsError({ kind: "internal" })).toBe(false);
  });

  it("disarms when the user turns the timeout off, once that persists", async () => {
    const fake = fakeServices({ updateSettings: persists(0) });
    const actor = start(fake, 5);
    expect(actor.getSnapshot().value).toEqual({
      active: { settings: "idle", idleTimer: "armed" },
    });

    actor.send({ type: "SET_IDLE_TIMEOUT", minutes: 0 });
    await vi.advanceTimersByTimeAsync(0);

    expect(actor.getSnapshot().value).toEqual({
      active: { settings: "idle", idleTimer: "disarmed" },
    });

    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
    expect(actor.getSnapshot().context.lockReason).toBeUndefined();
  });

  it("restarts the countdown on activity, and starts none when off", async () => {
    const fake = fakeServices({ updateSettings: persists(5) });
    const actor = start(fake, 5);

    await vi.advanceTimersByTimeAsync(4 * MINUTE_MS);
    actor.send({ type: "ACTIVITY" });
    await vi.advanceTimersByTimeAsync(4 * MINUTE_MS);
    expect(actor.getSnapshot().context.lockReason).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1 * MINUTE_MS);
    expect(actor.getSnapshot().context.lockReason).toBe("idle-timeout");

    const off = start(fakeServices(), 0);
    off.send({ type: "ACTIVITY" });
    expect(off.getSnapshot().value).toEqual({
      active: { settings: "idle", idleTimer: "disarmed" },
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("sessionMachine — locking (CAP-03)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("locks on request and on pagehide, recording which it was", async () => {
    for (const [event, reason] of [
      ["LOCK_NOW", "user"],
      ["PAGEHIDE", "pagehide"],
    ] as const) {
      const fake = fakeServices({ lock: lockAck });
      const actor = start(fake, 15);

      actor.send({ type: event });
      expect(actor.getSnapshot().value).toBe("locking");
      await vi.advanceTimersByTimeAsync(0);

      expect(actor.getSnapshot().value).toBe("locked");
      expect(actor.getSnapshot().context.lockReason).toBe(reason);
      expect(fake.names()).toEqual(["lock"]);
      // The idle countdown does not outlive the session.
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("locks even when the lock command fails: termination is the real lock", async () => {
    const fake = fakeServices({ lock: rejects(workerError("timeout")) });
    const actor = start(fake);

    actor.send({ type: "LOCK_NOW" });
    await vi.advanceTimersByTimeAsync(0);

    expect(actor.getSnapshot().value).toBe("locked");
    expect(actor.getSnapshot().status).toBe("done");
  });
});
