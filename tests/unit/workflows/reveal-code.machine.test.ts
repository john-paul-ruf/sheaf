/**
 * CAP-06 (SCR-007, MOD-022). The passphrase gates every reveal, and the code
 * exists in the snapshot only while it is on screen.
 */

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { revealCodeMachine } from "../../../src/application/workflows/reveal-code.machine.js";
import {
  SETUP_RECOVERY_CODE,
  fakeServices,
  rejects,
  resolves,
  workerError,
} from "./fakes.js";

const PASSPHRASE = "harbour lantern gravel thicket";

function start(fake: ReturnType<typeof fakeServices>) {
  const actor = createActor(revealCodeMachine, {
    input: { services: fake.services },
  });
  actor.start();
  return actor;
}

function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("revealCodeMachine", () => {
  it("reveals the issued code once the current passphrase is given", async () => {
    const fake = fakeServices({
      revealRecoveryCode: resolves({
        kind: "revealRecoveryCode" as const,
        recoveryCode: SETUP_RECOVERY_CODE,
      }),
    });
    const actor = start(fake);

    actor.send({ type: "SUBMIT", currentPassphrase: PASSPHRASE });
    await settled();

    expect(actor.getSnapshot().value).toBe("revealed");
    expect(actor.getSnapshot().context.recoveryCode).toBe(SETUP_RECOVERY_CODE);
    expect(fake.calls).toEqual([
      {
        name: "revealRecoveryCode",
        input: { currentPassphrase: PASSPHRASE },
      },
    ]);
  });

  it("drops the code on dismissal and does not reveal it again", async () => {
    const fake = fakeServices({
      revealRecoveryCode: resolves({
        kind: "revealRecoveryCode" as const,
        recoveryCode: SETUP_RECOVERY_CODE,
      }),
    });
    const actor = start(fake);
    actor.send({ type: "SUBMIT", currentPassphrase: PASSPHRASE });
    await settled();

    actor.send({ type: "DISMISS" });
    expect(actor.getSnapshot().value).toBe("dismissed");
    expect(actor.getSnapshot().context.recoveryCode).toBeUndefined();

    actor.send({ type: "SUBMIT", currentPassphrase: PASSPHRASE });
    expect(actor.getSnapshot().value).toBe("dismissed");
    expect(fake.names()).toEqual(["revealRecoveryCode"]);
    expect(JSON.stringify(actor.getSnapshot().context)).not.toContain(
      SETUP_RECOVERY_CODE,
    );
  });

  it("returns a wrong passphrase to the prompt with a typed reason", async () => {
    const fake = fakeServices({
      revealRecoveryCode: rejects(workerError("wrong-passphrase")),
    });
    const actor = start(fake);

    actor.send({ type: "SUBMIT", currentPassphrase: "wrong" });
    await settled();

    expect(actor.getSnapshot().value).toBe("request");
    expect(actor.getSnapshot().context.error).toEqual({
      kind: "wrong-passphrase",
    });
    expect(actor.getSnapshot().context.recoveryCode).toBeUndefined();
    expect(actor.getSnapshot().context.draft).toBeUndefined();
  });
});
