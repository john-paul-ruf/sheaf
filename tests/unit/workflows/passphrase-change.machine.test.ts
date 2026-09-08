/**
 * CAP-04 (SCR-006, MOD-037). The confirmation is a real gate: nothing is sent
 * until it is passed, and cancelling it sends nothing at all.
 */

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { passphraseChangeMachine } from "../../../src/application/workflows/passphrase-change.machine.js";
import { wordCountPassphrasePolicy } from "../../../src/application/workflows/services.js";
import {
  fakeServices,
  rejects,
  resolves,
  unlockedSession,
  workerError,
} from "./fakes.js";

const CURRENT = "old harbour lantern gravel";
const NEXT = "new thicket meadow furrow";

function start(fake: ReturnType<typeof fakeServices>) {
  const actor = createActor(passphraseChangeMachine, {
    input: { services: fake.services, policy: wordCountPassphrasePolicy },
  });
  actor.start();
  return actor;
}

function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function accepting() {
  return fakeServices({
    changePassphrase: resolves({
      kind: "changePassphrase" as const,
      session: unlockedSession({ transactionRevision: 3 }),
    }),
  });
}

describe("passphraseChangeMachine", () => {
  it("re-wraps only after the MOD-037 confirmation, authorized by the current passphrase", async () => {
    const fake = accepting();
    const actor = start(fake);

    actor.send({
      type: "SUBMIT",
      currentPassphrase: CURRENT,
      nextPassphrase: NEXT,
      confirmation: NEXT,
    });
    expect(actor.getSnapshot().value).toBe("confirm");
    expect(fake.calls).toEqual([]);

    actor.send({ type: "CONFIRM" });
    expect(actor.getSnapshot().value).toBe("rewrapping");
    await settled();

    expect(actor.getSnapshot().value).toBe("done");
    expect(fake.calls).toEqual([
      {
        name: "changePassphrase",
        input: {
          authorization: {
            via: "current-passphrase",
            currentPassphrase: CURRENT,
          },
          nextPassphrase: NEXT,
        },
      },
    ]);
  });

  it("sends nothing when the confirmation is cancelled", () => {
    const fake = accepting();
    const actor = start(fake);

    actor.send({
      type: "SUBMIT",
      currentPassphrase: CURRENT,
      nextPassphrase: NEXT,
      confirmation: NEXT,
    });
    actor.send({ type: "CANCEL" });

    expect(actor.getSnapshot().value).toBe("form");
    expect(actor.getSnapshot().context.draft).toBeUndefined();
    expect(fake.calls).toEqual([]);
  });

  it("keeps a weak, mismatched, or unauthorized entry on the form", () => {
    const fake = accepting();
    const actor = start(fake);

    actor.send({
      type: "SUBMIT",
      currentPassphrase: "",
      nextPassphrase: NEXT,
      confirmation: NEXT,
    });
    expect(actor.getSnapshot().value).toBe("form");

    actor.send({
      type: "SUBMIT",
      currentPassphrase: CURRENT,
      nextPassphrase: "tiny",
      confirmation: "tiny",
    });
    expect(actor.getSnapshot().context.strength).toBe("weak");

    actor.send({
      type: "SUBMIT",
      currentPassphrase: CURRENT,
      nextPassphrase: NEXT,
      confirmation: "other",
    });
    expect(actor.getSnapshot().context.match).toBe("mismatch");

    expect(actor.getSnapshot().value).toBe("form");
    expect(fake.calls).toEqual([]);
  });

  it("returns a refused change to the form with a typed reason", async () => {
    const fake = fakeServices({
      changePassphrase: rejects(workerError("wrong-passphrase")),
    });
    const actor = start(fake);

    actor.send({
      type: "SUBMIT",
      currentPassphrase: CURRENT,
      nextPassphrase: NEXT,
      confirmation: NEXT,
    });
    actor.send({ type: "CONFIRM" });
    await settled();

    expect(actor.getSnapshot().value).toBe("form");
    expect(actor.getSnapshot().context.error).toEqual({
      kind: "wrong-passphrase",
    });
  });

  it("holds neither passphrase once the re-wrap settles", async () => {
    const fake = accepting();
    const actor = start(fake);

    actor.send({
      type: "SUBMIT",
      currentPassphrase: CURRENT,
      nextPassphrase: NEXT,
      confirmation: NEXT,
    });
    // Held across the confirmation, because the re-wrap still needs both.
    expect(actor.getSnapshot().context.draft).toEqual({
      currentPassphrase: CURRENT,
      nextPassphrase: NEXT,
    });

    actor.send({ type: "CONFIRM" });
    await settled();

    const final = JSON.stringify(actor.getSnapshot().context);
    expect(final).not.toContain(CURRENT);
    expect(final).not.toContain(NEXT);
    expect(actor.getSnapshot().context.draft).toBeUndefined();
  });
});
