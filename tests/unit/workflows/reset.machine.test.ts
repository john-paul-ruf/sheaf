/**
 * CAP-07 (SCR-008/009, MOD-032/033, FR-23). The assertions that matter are
 * negative: no gate can be skipped, the destructive command is reachable from
 * exactly one state, and a stale confirmation purges nothing.
 */

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import {
  RESET_CONFIRMATION_PHRASE,
  isResetPhraseMatched,
  resetMachine,
  type ResetEntry,
} from "../../../src/application/workflows/reset.machine.js";
import {
  emptyInventory,
  fakeServices,
  rejects,
  resolves,
  workerError,
} from "./fakes.js";

const TOKEN = "opaque-confirm-token-from-the-worker";

function start(fake: ReturnType<typeof fakeServices>, entry: ResetEntry) {
  const actor = createActor(resetMachine, {
    input: { services: fake.services, entry },
  });
  actor.start();
  return actor;
}

function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function lockedReset() {
  return fakeServices({
    resetLocked: resolves({ kind: "resetLocked" as const, purged: true }),
  });
}

function readableReset(overrides: { purge?: () => Promise<never> } = {}) {
  let issued = false;
  return fakeServices({
    resetReadable: (input) => {
      if (input.confirmToken === undefined) {
        issued = true;
        return Promise.resolve({
          kind: "resetReadable" as const,
          phase: "inventory" as const,
          inventory: emptyInventory(),
          confirmToken: TOKEN,
        });
      }
      if (!issued) {
        throw new Error("confirm arrived before any enumeration");
      }
      return (
        overrides.purge?.() ??
        Promise.resolve({
          kind: "resetReadable" as const,
          phase: "purged" as const,
          purged: true as const,
        })
      );
    },
  });
}

/** Walks the two gates that follow stage 1. */
function passGatesTwoAndThree(actor: ReturnType<typeof start>): void {
  actor.send({ type: "CONTINUE" });
  actor.send({ type: "ACKNOWLEDGE", acknowledged: true });
  actor.send({ type: "CONTINUE" });
  actor.send({ type: "TYPE_PHRASE", text: RESET_CONFIRMATION_PHRASE });
  actor.send({ type: "CONFIRM" });
}

describe("resetMachine — locked entry (SCR-008 / MOD-033)", () => {
  it("enumerates nothing and purges only after all three gates", async () => {
    const fake = lockedReset();
    const actor = start(fake, "locked");

    expect(actor.getSnapshot().value).toBe("readLoss");
    expect(actor.getSnapshot().context.inventory).toBeUndefined();

    passGatesTwoAndThree(actor);
    expect(actor.getSnapshot().value).toBe("purging");
    await settled();

    expect(actor.getSnapshot().value).toBe("purged");
    expect(fake.names()).toEqual(["resetLocked"]);
  });

  it("refuses to skip a gate: CONFIRM does nothing before stage 3", () => {
    const fake = lockedReset();
    const actor = start(fake, "locked");

    actor.send({ type: "CONFIRM" });
    expect(actor.getSnapshot().value).toBe("readLoss");

    actor.send({ type: "CONTINUE" });
    expect(actor.getSnapshot().value).toBe("acknowledge");
    actor.send({ type: "CONFIRM" });
    expect(actor.getSnapshot().value).toBe("acknowledge");

    // Gate 2 is not passed by asking twice: it needs the acknowledgement.
    actor.send({ type: "CONTINUE" });
    expect(actor.getSnapshot().value).toBe("acknowledge");

    actor.send({ type: "ACKNOWLEDGE", acknowledged: true });
    actor.send({ type: "CONTINUE" });
    expect(actor.getSnapshot().value).toBe("typePhrase");

    expect(fake.calls).toEqual([]);
  });

  it("requires the exact phrase before the destructive call", () => {
    const fake = lockedReset();
    const actor = start(fake, "locked");
    actor.send({ type: "CONTINUE" });
    actor.send({ type: "ACKNOWLEDGE", acknowledged: true });
    actor.send({ type: "CONTINUE" });

    for (const text of ["", "reset this device", "RESET THIS DEVIC", "wipe"]) {
      actor.send({ type: "TYPE_PHRASE", text });
      actor.send({ type: "CONFIRM" });
      expect(actor.getSnapshot().value).toBe("typePhrase");
    }
    expect(fake.calls).toEqual([]);

    actor.send({
      type: "TYPE_PHRASE",
      text: ` ${RESET_CONFIRMATION_PHRASE} `,
    });
    actor.send({ type: "CONFIRM" });
    expect(actor.getSnapshot().value).toBe("purging");
  });
});

describe("resetMachine — readable entry (SCR-009 / MOD-032)", () => {
  it("enumerates first, then purges with the worker's own token", async () => {
    const fake = readableReset();
    const actor = start(fake, "readable");

    expect(actor.getSnapshot().value).toBe("loadingInventory");
    await settled();

    expect(actor.getSnapshot().value).toBe("reviewInventory");
    expect(actor.getSnapshot().context.inventory).toEqual(emptyInventory());
    expect(actor.getSnapshot().context.confirmToken).toBe(TOKEN);

    passGatesTwoAndThree(actor);
    await settled();

    expect(actor.getSnapshot().value).toBe("purged");
    expect(fake.calls).toEqual([
      { name: "resetReadable", input: {} },
      { name: "resetReadable", input: { confirmToken: TOKEN } },
    ]);
  });

  it("carries an empty inventory as an enumeration, not as an unknown", async () => {
    const actor = start(readableReset(), "readable");
    await settled();

    const { inventory } = actor.getSnapshot().context;
    expect(inventory).toBeDefined();
    expect(inventory?.apps).toEqual([]);
    expect(inventory?.appCount).toBe(0);
    expect(inventory?.homeCount).toBe(0);
  });

  it("treats a stale confirmation as recoverable and purges nothing", async () => {
    const fake = readableReset({
      purge: rejects(workerError("stale-confirmation")),
    });
    const actor = start(fake, "readable");
    await settled();

    passGatesTwoAndThree(actor);
    await settled();

    expect(actor.getSnapshot().value).toBe("staleConfirmation");
    expect(actor.getSnapshot().context.error).toEqual({
      kind: "stale-confirmation",
    });
    // The invalidated token is dropped rather than retried.
    expect(actor.getSnapshot().context.confirmToken).toBeUndefined();

    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().value).toBe("loadingInventory");
    await settled();

    // A fresh enumeration re-opens every gate.
    expect(actor.getSnapshot().value).toBe("reviewInventory");
    expect(actor.getSnapshot().context.acknowledged).toBe(false);
    expect(actor.getSnapshot().context.typedPhrase).toBe("");
    expect(actor.getSnapshot().context.confirmToken).toBe(TOKEN);
  });

  it("reports a refused enumeration without offering a purge", async () => {
    const fake = fakeServices({
      resetReadable: rejects(workerError("locked")),
    });
    const actor = start(fake, "readable");
    await settled();

    expect(actor.getSnapshot().value).toBe("failed");
    expect(actor.getSnapshot().context.error).toEqual({ kind: "locked" });
    expect(fake.names()).toEqual(["resetReadable"]);
  });
});

describe("isResetPhraseMatched", () => {
  it("trims but never case-folds", () => {
    expect(isResetPhraseMatched(RESET_CONFIRMATION_PHRASE)).toBe(true);
    expect(isResetPhraseMatched(`  ${RESET_CONFIRMATION_PHRASE}\n`)).toBe(true);
    expect(isResetPhraseMatched("reset this device")).toBe(false);
    expect(isResetPhraseMatched("RESET  THIS  DEVICE")).toBe(false);
  });
});
