/**
 * CAP-05. Two obligations: a misspelled code costs no derive, and a recovered
 * session cannot be used until a replacement passphrase is installed (FR-23).
 */

import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";
import { recoveryMachine } from "../../../src/application/workflows/recovery.machine.js";
import {
  wordCountPassphrasePolicy,
  type RecoveryCodeFormatPort,
} from "../../../src/application/workflows/services.js";
import {
  SETUP_RECOVERY_CODE,
  fakeClock,
  fakeServices,
  rejects,
  resolves,
  unlockedSession,
  workerError,
} from "./fakes.js";

const NEXT = "harbour lantern gravel thicket";

const acceptsAnyFormat: RecoveryCodeFormatPort = {
  isWellFormed: () => Promise.resolve(true),
};
const rejectsAnyFormat: RecoveryCodeFormatPort = {
  isWellFormed: () => Promise.resolve(false),
};

function start(
  fake: ReturnType<typeof fakeServices>,
  codeFormat: RecoveryCodeFormatPort = acceptsAnyFormat,
) {
  const actor = createActor(recoveryMachine, {
    input: {
      services: fake.services,
      policy: wordCountPassphrasePolicy,
      codeFormat,
      clock: fakeClock(),
    },
  });
  actor.start();
  return actor;
}

function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function recovered() {
  return fakeServices({
    unlockWithRecoveryCode: resolves({
      kind: "unlockWithRecoveryCode" as const,
      session: unlockedSession({ unlockedVia: "recovery-code" }),
    }),
    changePassphrase: resolves({
      kind: "changePassphrase" as const,
      session: unlockedSession(),
    }),
  });
}

describe("recoveryMachine", () => {
  it("unlocks with the code and then forces a replacement passphrase", async () => {
    const fake = recovered();
    const actor = start(fake);

    actor.send({ type: "SUBMIT_CODE", recoveryCode: SETUP_RECOVERY_CODE });
    await settled();

    expect(actor.getSnapshot().value).toBe("definePassphrase");
    expect(actor.getSnapshot().context.session?.unlockedVia).toBe(
      "recovery-code",
    );

    actor.send({
      type: "SUBMIT_PASSPHRASE",
      passphrase: NEXT,
      confirmation: NEXT,
    });
    await settled();

    expect(actor.getSnapshot().value).toBe("done");
    expect(fake.calls).toEqual([
      {
        name: "unlockWithRecoveryCode",
        input: { recoveryCode: SETUP_RECOVERY_CODE },
      },
      {
        name: "changePassphrase",
        input: {
          authorization: { via: "recovery" },
          nextPassphrase: NEXT,
        },
      },
    ]);
  });

  it("has no route from a recovered session to done without the new passphrase", async () => {
    const fake = recovered();
    const actor = start(fake);
    actor.send({ type: "SUBMIT_CODE", recoveryCode: SETUP_RECOVERY_CODE });
    await settled();

    // A weak or mismatched replacement keeps the session unusable.
    actor.send({
      type: "SUBMIT_PASSPHRASE",
      passphrase: "short",
      confirmation: "short",
    });
    expect(actor.getSnapshot().value).toBe("definePassphrase");
    expect(actor.getSnapshot().context.strength).toBe("weak");

    actor.send({
      type: "SUBMIT_PASSPHRASE",
      passphrase: NEXT,
      confirmation: "different",
    });
    expect(actor.getSnapshot().value).toBe("definePassphrase");
    expect(actor.getSnapshot().context.match).toBe("mismatch");

    expect(fake.names()).toEqual(["unlockWithRecoveryCode"]);
  });

  it("rejects a misspelled code locally, before any derive", async () => {
    const fake = recovered();
    const actor = start(fake, rejectsAnyFormat);

    actor.send({ type: "SUBMIT_CODE", recoveryCode: "not-a-code" });
    await settled();

    expect(actor.getSnapshot().value).toBe("enterCode");
    expect(actor.getSnapshot().context.codeMisspelled).toBe(true);
    expect(fake.calls).toEqual([]);
  });

  it("reports a code the worker refused, and keeps it out of the snapshot", async () => {
    const fake = fakeServices({
      unlockWithRecoveryCode: rejects(workerError("invalid-recovery-code")),
    });
    const actor = start(fake);

    actor.send({ type: "SUBMIT_CODE", recoveryCode: SETUP_RECOVERY_CODE });
    await settled();

    expect(actor.getSnapshot().value).toBe("enterCode");
    expect(actor.getSnapshot().context.error).toEqual({
      kind: "invalid-recovery-code",
    });
    expect(actor.getSnapshot().context.codeMisspelled).toBe(false);
    expect(actor.getSnapshot().context.draft).toBeUndefined();
    expect(JSON.stringify(actor.getSnapshot().context)).not.toContain(
      SETUP_RECOVERY_CODE,
    );
  });

  it("renders a worker-imposed delay on the recovery route too", async () => {
    const fake = fakeServices({
      unlockWithRecoveryCode: rejects(workerError("rate-limited", 4_000)),
    });
    const actor = start(fake);

    actor.send({ type: "SUBMIT_CODE", recoveryCode: SETUP_RECOVERY_CODE });
    await settled();

    expect(actor.getSnapshot().context.error).toEqual({
      kind: "rate-limited",
      retryAfterMs: 4_000,
    });
    actor.stop();
  });

  it("holds neither the code nor the new passphrase after their transitions", async () => {
    const fake = recovered();
    const actor = start(fake);

    actor.send({ type: "SUBMIT_CODE", recoveryCode: SETUP_RECOVERY_CODE });
    await settled();
    expect(JSON.stringify(actor.getSnapshot().context)).not.toContain(
      SETUP_RECOVERY_CODE,
    );

    actor.send({
      type: "SUBMIT_PASSPHRASE",
      passphrase: NEXT,
      confirmation: NEXT,
    });
    await settled();

    const final = JSON.stringify(actor.getSnapshot().context);
    expect(final).not.toContain(SETUP_RECOVERY_CODE);
    expect(final).not.toContain(NEXT);
    expect(actor.getSnapshot().context.draft).toBeUndefined();
  });
});

it.each(["rate-limited", "invalid-recovery-code"] as const)("%s: enforces 4000 → 3000 → 0 and cancels the timer", async (kind) => {
  vi.useFakeTimers();
  const clock = fakeClock();
  const fake = fakeServices({ unlockWithRecoveryCode: rejects(workerError(kind, 4000)) });
  const actor = createActor(recoveryMachine, { input: { services: fake.services, policy: wordCountPassphrasePolicy, codeFormat: acceptsAnyFormat, clock } }).start();
  try {
    actor.send({ type: "SUBMIT_CODE", recoveryCode: SETUP_RECOVERY_CODE });
    await vi.advanceTimersByTimeAsync(0);
    expect(actor.getSnapshot().value).toBe("waiting");
    expect(actor.getSnapshot().context.remainingMs).toBe(4000);
    expect(actor.getSnapshot().context.draft).toBeUndefined();
    actor.send({ type: "SUBMIT_CODE", recoveryCode: SETUP_RECOVERY_CODE }); actor.send({ type: "RETRY" });
    expect(fake.names()).toEqual(["unlockWithRecoveryCode"]);
    clock.advance(1000); await vi.advanceTimersByTimeAsync(1000);
    expect(actor.getSnapshot().context.remainingMs).toBe(3000);
    clock.advance(9000); await vi.advanceTimersByTimeAsync(1000);
    expect(actor.getSnapshot().value).toBe("enterCode");
    expect(actor.getSnapshot().context.remainingMs).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    actor.send({ type: "SUBMIT_CODE", recoveryCode: SETUP_RECOVERY_CODE });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.names()).toHaveLength(2);
    actor.stop();
    expect(vi.getTimerCount()).toBe(0);
  } finally { actor.stop(); vi.useRealTimers(); }
});
