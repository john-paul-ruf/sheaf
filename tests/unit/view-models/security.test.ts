/**
 * M37's three contracts, asserted rather than reviewed: locked models cannot
 * carry inventory (in the type *and* in the value), every prompt names its
 * exact secret, and every state has something to announce.
 */

import { describe, expect, it } from "vitest";
import { createActor, type Actor, type AnyStateMachine } from "xstate";
import {
  IDLE_TIMEOUT_OPTION_VMS,
  LOCAL_PASSPHRASE_SCOPE,
  LOCAL_RECOVERY_CODE_SCOPE,
  announceRefusal,
  selectPassphraseChangeVm,
  selectRecoveryVm,
  selectResetVm,
  selectRevealCodeVm,
  selectSecuritySettingsVm,
  selectSetupVm,
  selectUnlockVm,
  selectWelcomeVm,
  toErrorVm,
  type LockedResetVm,
  type ReadableResetVm,
  type UnlockVm,
} from "../../../src/application/view-models/security.js";
import { setupMachine } from "../../../src/application/workflows/setup.machine.js";
import { unlockMachine } from "../../../src/application/workflows/unlock.machine.js";
import { recoveryMachine } from "../../../src/application/workflows/recovery.machine.js";
import { passphraseChangeMachine } from "../../../src/application/workflows/passphrase-change.machine.js";
import { revealCodeMachine } from "../../../src/application/workflows/reveal-code.machine.js";
import {
  RESET_CONFIRMATION_PHRASE,
  resetMachine,
} from "../../../src/application/workflows/reset.machine.js";
import { sessionMachine } from "../../../src/application/workflows/session.machine.js";
import {
  wordCountPassphrasePolicy,
  type RecoveryCodeFormatPort,
} from "../../../src/application/workflows/services.js";
import { DATA_WORKER_ERROR_KINDS_V1 } from "../../../src/workers/protocol/messages.js";
import type { CapabilityReport } from "../../../src/platform/capabilities.js";
import {
  SETUP_RECOVERY_CODE,
  emptyInventory,
  fakeClock,
  fakeServices,
  rejects,
  resolves,
  unlockedSession,
  workerError,
} from "../workflows/fakes.js";

const PASSPHRASE = "harbour lantern gravel thicket";

const anyFormat: RecoveryCodeFormatPort = {
  isWellFormed: () => Promise.resolve(true),
};

function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function stopAll(actors: Actor<AnyStateMachine>[]): void {
  for (const actor of actors) {
    actor.stop();
  }
}

/** Every string a surface might announce, from one model. */
function announcementOf(vm: { readonly announcement: string }): string {
  return vm.announcement;
}

describe("SCR-001 welcome / capability gate (CAP-08)", () => {
  const report = (
    supported: boolean,
    missing: readonly string[] = [],
  ): CapabilityReport => ({
    entries: [
      {
        id: "indexeddb",
        classification: "baseline-required",
        detected: supported,
        reason: "The encrypted local store lives in IndexedDB.",
      },
      {
        id: "storage-persistence",
        classification: "advisory",
        detected: false,
        reason: "A granted hint is not durability.",
      },
    ],
    missing,
    supported,
  });

  it("names the missing capability and stays recoverable", () => {
    const vm = selectWelcomeVm(report(false, ["indexeddb"]));

    expect(vm.kind).toBe("unsupported");
    if (vm.kind !== "unsupported") {
      throw new Error("expected the unsupported variant");
    }
    expect(vm.recoverable).toBe(true);
    expect(vm.missing).toEqual([
      {
        id: "indexeddb",
        reason: "The encrypted local store lives in IndexedDB.",
      },
    ]);
    expect(vm.announcement).toContain("indexeddb");
  });

  it("does not report an advisory absence as missing", () => {
    const vm = selectWelcomeVm(report(true));

    expect(vm.kind).toBe("ready");
    expect(announcementOf(vm).length).toBeGreaterThan(0);
  });
});

describe("SCR-002 setup (CAP-01)", () => {
  function setupActor() {
    const fake = fakeServices({
      setup: resolves({
        kind: "setup" as const,
        recoveryCode: SETUP_RECOVERY_CODE,
        session: unlockedSession(),
      }),
    });
    const actor = createActor(setupMachine, {
      input: { services: fake.services, policy: wordCountPassphrasePolicy },
    });
    actor.start();
    return actor;
  }

  it("names the exact secret and repeats the code's scope", async () => {
    const actor = setupActor();
    actor.send({ type: "BEGIN" });

    const define = selectSetupVm(actor.getSnapshot());
    expect(define.step).toBe("definePassphrase");
    if (define.step !== "definePassphrase") {
      throw new Error("expected definePassphrase");
    }
    expect(define.passphraseScope).toBe(LOCAL_PASSPHRASE_SCOPE);
    expect(define.passphraseScope).not.toMatch(/your passphrase/iu);

    actor.send({ type: "SUBMIT", passphrase: PASSPHRASE, confirmation: PASSPHRASE });
    await settled();

    const issued = selectSetupVm(actor.getSnapshot());
    if (issued.step !== "codeIssued") {
      throw new Error("expected codeIssued");
    }
    expect(issued.codeScope).toBe(LOCAL_RECOVERY_CODE_SCOPE);
    expect(issued.codeReach).toBe("This device only");
    expect(issued.recoveryCode).toBe(SETUP_RECOVERY_CODE);
    actor.stop();
  });

  it("shows the code only while a display state is active", async () => {
    const actor = setupActor();
    actor.send({ type: "BEGIN" });
    actor.send({ type: "SUBMIT", passphrase: PASSPHRASE, confirmation: PASSPHRASE });
    await settled();
    actor.send({ type: "CONTINUE" });
    actor.send({ type: "ACKNOWLEDGE_SAVED", acknowledged: true });
    actor.send({ type: "FINISH" });

    const vm = selectSetupVm(actor.getSnapshot());
    expect(vm.step).toBe("unlocked");
    expect(JSON.stringify(vm)).not.toContain(SETUP_RECOVERY_CODE);
    actor.stop();
  });

  it("has an announcement in every state it can reach", async () => {
    const actor = setupActor();
    const seen = new Set<string>();
    const record = (): void => {
      const vm = selectSetupVm(actor.getSnapshot());
      seen.add(vm.step);
      expect(announcementOf(vm).length).toBeGreaterThan(0);
    };

    record();
    actor.send({ type: "BEGIN" });
    record();
    actor.send({ type: "SUBMIT", passphrase: PASSPHRASE, confirmation: PASSPHRASE });
    record();
    await settled();
    record();
    actor.send({ type: "CONTINUE" });
    record();
    actor.send({ type: "ACKNOWLEDGE_SAVED", acknowledged: true });
    actor.send({ type: "FINISH" });
    record();

    expect(seen).toEqual(
      new Set([
        "welcome",
        "definePassphrase",
        "deriving",
        "codeIssued",
        "codeConfirm",
        "unlocked",
      ]),
    );
    actor.stop();
  });
});

describe("SCR-003 unlock (CAP-02, CA-04, CA-05)", () => {
  function unlockActor(fake: ReturnType<typeof fakeServices>) {
    const actor = createActor(unlockMachine, {
      input: { services: fake.services, clock: fakeClock(), tickMs: 1_000 },
    });
    actor.start();
    return actor;
  }

  /** The fields a locked surface must never be able to show. */
  const FORBIDDEN_KEYS = [
    "apps",
    "appCount",
    "appNames",
    "homeCount",
    "recordCount",
    "lastBackupAt",
    "inventory",
    "session",
  ];

  it("carries no inventory field, by type and by value", () => {
    const actor = unlockActor(fakeServices());
    const vm = selectUnlockVm(actor.getSnapshot());

    // Type level: assigning any of these to the locked variant is an error.
    type LockedVariant = Extract<UnlockVm, { state: "locked" }>;
    type ForbiddenKey = Extract<
      keyof LockedVariant,
      "apps" | "appCount" | "homeCount" | "inventory" | "lastBackupAt"
    >;
    const noForbiddenKeys: ForbiddenKey extends never ? true : false = true;
    expect(noForbiddenKeys).toBe(true);

    // Value level, across the whole reachable model.
    for (const key of FORBIDDEN_KEYS) {
      expect(Object.keys(vm)).not.toContain(key);
    }
    expect(JSON.stringify(vm)).not.toMatch(/appCount|homeCount|inventory/u);
    actor.stop();
  });

  it("offers recovery before reset and names the exact secret", () => {
    const actor = unlockActor(fakeServices());
    const vm = selectUnlockVm(actor.getSnapshot());
    if (vm.state !== "locked") {
      throw new Error("expected locked");
    }

    expect(vm.routes).toEqual(["recovery-code", "reset"]);
    expect(vm.passphraseScope).toBe(LOCAL_PASSPHRASE_SCOPE);
    expect(vm.encryptedFact).toContain("stay encrypted until you unlock");
    actor.stop();
  });

  it("renders the worker's delay as seconds and forbids submitting", async () => {
    const fake = fakeServices({
      unlock: rejects(workerError("rate-limited", 4_000)),
    });
    const actor = unlockActor(fake);
    actor.send({ type: "SUBMIT", passphrase: "wrong" });
    await settled();

    const vm = selectUnlockVm(actor.getSnapshot());
    if (vm.state !== "delayed") {
      throw new Error("expected delayed");
    }
    expect(vm.remainingMs).toBe(4_000);
    expect(vm.remainingSeconds).toBe(4);
    expect(vm.canSubmit).toBe(false);
    expect(vm.error.retryAfterMs).toBe(4_000);
    expect(vm.announcement).toContain("4 seconds");
    actor.stop();
  });

  it("never implies the delay outlives this session (D4)", () => {
    const actor = unlockActor(fakeServices());
    const vm = selectUnlockVm(actor.getSnapshot());
    if (vm.state !== "locked") {
      throw new Error("expected locked");
    }

    expect(vm.delayFact).toBe(
      "Repeated failed attempts receive an increasing delay. They never trigger a wipe.",
    );
    expect(vm.delayFact).not.toMatch(/restart|relaunch|next time|remembered/iu);
    actor.stop();
  });
});

describe("SCR-004 recovery (CAP-05)", () => {
  it("distinguishes a misspelling from a refusal, and names both scopes", async () => {
    const misspelled = createActor(recoveryMachine, {
      input: {
        services: fakeServices().services,
        policy: wordCountPassphrasePolicy,
        codeFormat: { isWellFormed: () => Promise.resolve(false) },
      },
    });
    misspelled.start();
    misspelled.send({ type: "SUBMIT_CODE", recoveryCode: "nope" });
    await settled();

    const vm = selectRecoveryVm(misspelled.getSnapshot());
    if (vm.step !== "enterCode") {
      throw new Error("expected enterCode");
    }
    expect(vm.codeMisspelled).toBe(true);
    expect(vm.codeScope).toBe(LOCAL_RECOVERY_CODE_SCOPE);
    expect(vm.error).toBeUndefined();
    expect(vm.losslessFact).toContain("Reset is not involved");

    const refused = createActor(recoveryMachine, {
      input: {
        services: fakeServices({
          unlockWithRecoveryCode: rejects(workerError("invalid-recovery-code")),
        }).services,
        policy: wordCountPassphrasePolicy,
        codeFormat: anyFormat,
      },
    });
    refused.start();
    refused.send({ type: "SUBMIT_CODE", recoveryCode: SETUP_RECOVERY_CODE });
    await settled();

    const refusedVm = selectRecoveryVm(refused.getSnapshot());
    if (refusedVm.step !== "enterCode") {
      throw new Error("expected enterCode");
    }
    expect(refusedVm.codeMisspelled).toBe(false);
    expect(refusedVm.error?.kind).toBe("invalid-recovery-code");
    expect(JSON.stringify(refusedVm)).not.toContain(SETUP_RECOVERY_CODE);

    stopAll([misspelled, refused]);
  });

  it("states that recovery installs a replacement passphrase (FR-23)", async () => {
    const actor = createActor(recoveryMachine, {
      input: {
        services: fakeServices({
          unlockWithRecoveryCode: resolves({
            kind: "unlockWithRecoveryCode" as const,
            session: unlockedSession({ unlockedVia: "recovery-code" }),
          }),
        }).services,
        policy: wordCountPassphrasePolicy,
        codeFormat: anyFormat,
      },
    });
    actor.start();
    actor.send({ type: "SUBMIT_CODE", recoveryCode: SETUP_RECOVERY_CODE });
    await settled();

    const vm = selectRecoveryVm(actor.getSnapshot());
    if (vm.step !== "definePassphrase") {
      throw new Error("expected definePassphrase");
    }
    expect(vm.passphraseScope).toBe("New local unlock passphrase");
    expect(vm.requirementFact).toContain("new unlock passphrase");
    actor.stop();
  });
});

describe("SCR-005 security settings (CAP-03, D13/AD-7)", () => {
  function sessionActor(
    fake: ReturnType<typeof fakeServices>,
    idleTimeoutMinutes: 0 | 5 | 15 | 60 = 0,
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

  it("offers exactly the four approved options with the mock's labels", () => {
    expect(IDLE_TIMEOUT_OPTION_VMS).toEqual([
      { minutes: 0, label: "Off" },
      { minutes: 5, label: "5 minutes" },
      { minutes: 15, label: "15 minutes" },
      { minutes: 60, label: "1 hour" },
    ]);
  });

  it("renders only the persisted value, with a saving flag while it is in flight", async () => {
    const fake = fakeServices({
      updateSettings: resolves({
        kind: "updateSettings" as const,
        settings: { idleTimeoutMinutes: 15 as const },
        session: unlockedSession({ settings: { idleTimeoutMinutes: 15 } }),
      }),
    });
    const actor = sessionActor(fake);

    actor.send({ type: "SET_IDLE_TIMEOUT", minutes: 15 });
    const saving = selectSecuritySettingsVm(actor.getSnapshot());
    expect(saving.saving).toBe(true);
    // The requested value is nowhere in the model: it has not persisted.
    expect(saving.idleTimeoutMinutes).toBe(0);
    expect(saving.announcement).toContain("Saving");

    await settled();
    const saved = selectSecuritySettingsVm(actor.getSnapshot());
    expect(saved.saving).toBe(false);
    expect(saved.idleTimeoutMinutes).toBe(15);
    expect(saved.persistError).toBeUndefined();
    expect(saved.announcement).toContain("15 minutes");
    actor.stop();
  });

  it("keeps the persisted value and offers a retry when the write conflicts", async () => {
    const fake = fakeServices({
      updateSettings: rejects(workerError("revision-conflict")),
    });
    const actor = sessionActor(fake, 5);

    actor.send({ type: "SET_IDLE_TIMEOUT", minutes: 60 });
    await settled();

    const vm = selectSecuritySettingsVm(actor.getSnapshot());
    expect(vm.idleTimeoutMinutes).toBe(5);
    expect(vm.persistError).toEqual({
      kind: "revision-conflict",
      retryable: true,
    });
    expect(vm.saving).toBe(false);
    actor.stop();
  });

  it("carries the off-by-default fact and the lock-now consequence", () => {
    const actor = sessionActor(fakeServices());
    const vm = selectSecuritySettingsVm(actor.getSnapshot());

    expect(vm.defaultFact).toBe("Off by default for uninterrupted field work");
    expect(vm.lockNowFact).toBe("Closes the current unlocked session");
    actor.stop();
  });
});

describe("SCR-006 change passphrase (CAP-04, MOD-037)", () => {
  it("carries the no-data-loss fact on the form and in MOD-037", () => {
    const actor = createActor(passphraseChangeMachine, {
      input: {
        services: fakeServices().services,
        policy: wordCountPassphrasePolicy,
      },
    });
    actor.start();

    const form = selectPassphraseChangeVm(actor.getSnapshot());
    if (form.step !== "form") {
      throw new Error("expected form");
    }
    expect(form.currentScope).toBe("Current local unlock passphrase");
    expect(form.noDataLossFact).toContain("remain intact");

    actor.send({
      type: "SUBMIT",
      currentPassphrase: "old harbour lantern gravel",
      nextPassphrase: PASSPHRASE,
      confirmation: PASSPHRASE,
    });

    const confirm = selectPassphraseChangeVm(actor.getSnapshot());
    if (confirm.step !== "confirm") {
      throw new Error("expected confirm");
    }
    expect(confirm.dialog).toBe("MOD-037");
    expect(confirm.noDataLossFact).toContain("remain intact");
    expect(confirm.localOnlyFact).toContain("local unlock only");
    // The entries are never echoed back through the model.
    expect(JSON.stringify(confirm)).not.toContain(PASSPHRASE);
    actor.stop();
  });
});

describe("SCR-007 reveal recovery code (CAP-06, MOD-022)", () => {
  it("holds the code only in the revealed state", async () => {
    const actor = createActor(revealCodeMachine, {
      input: {
        services: fakeServices({
          revealRecoveryCode: resolves({
            kind: "revealRecoveryCode" as const,
            recoveryCode: SETUP_RECOVERY_CODE,
          }),
        }).services,
      },
    });
    actor.start();

    const request = selectRevealCodeVm(actor.getSnapshot());
    expect(request.step).toBe("request");
    expect(JSON.stringify(request)).not.toContain(SETUP_RECOVERY_CODE);

    actor.send({ type: "SUBMIT", currentPassphrase: PASSPHRASE });
    await settled();
    const revealed = selectRevealCodeVm(actor.getSnapshot());
    if (revealed.step !== "revealed") {
      throw new Error("expected revealed");
    }
    expect(revealed.recoveryCode).toBe(SETUP_RECOVERY_CODE);
    expect(revealed.codeReach).toBe("This device only");

    actor.send({ type: "DISMISS" });
    const dismissed = selectRevealCodeVm(actor.getSnapshot());
    expect(dismissed.step).toBe("dismissed");
    expect(JSON.stringify(dismissed)).not.toContain(SETUP_RECOVERY_CODE);
    actor.stop();
  });

  it("asks for the exact secret, never 'your passphrase'", () => {
    const actor = createActor(revealCodeMachine, {
      input: { services: fakeServices().services },
    });
    actor.start();

    const vm = selectRevealCodeVm(actor.getSnapshot());
    if (vm.step !== "request") {
      throw new Error("expected request");
    }
    expect(vm.passphraseScope).toBe("Current local unlock passphrase");
    expect(vm.announcement).toContain("this device's unlock passphrase");
    actor.stop();
  });
});

describe("SCR-008 locked reset (CAP-07, MOD-033)", () => {
  function lockedActor() {
    const actor = createActor(resetMachine, {
      input: { services: fakeServices().services, entry: "locked" },
    });
    actor.start();
    return actor;
  }

  it("carries no inventory field at all, and says why", () => {
    const actor = lockedActor();
    const vm = selectResetVm(actor.getSnapshot()) as LockedResetVm;

    type ForbiddenKey = Extract<
      keyof LockedResetVm,
      "inventory" | "apps" | "appCount" | "homeCount"
    >;
    const noForbiddenKeys: ForbiddenKey extends never ? true : false = true;
    expect(noForbiddenKeys).toBe(true);

    expect(Object.keys(vm)).not.toContain("inventory");
    expect(vm.cannotEnumerateFact).toContain("because all of that is encrypted");
    expect(vm.noPlaintextInventoryFact).toContain("no plaintext inventory");
    expect(vm.unknowns.heading).toBe(
      "This inability is the encryption working",
    );
    actor.stop();
  });

  it("reports the gate it is on and refuses to confirm before stage 3", () => {
    const actor = lockedActor();
    expect(selectResetVm(actor.getSnapshot()).stage).toBe(1);
    expect((selectResetVm(actor.getSnapshot()) as LockedResetVm).canConfirm).toBe(
      false,
    );

    actor.send({ type: "CONTINUE" });
    expect(selectResetVm(actor.getSnapshot()).stage).toBe(2);

    actor.send({ type: "ACKNOWLEDGE", acknowledged: true });
    actor.send({ type: "CONTINUE" });
    const stage3 = selectResetVm(actor.getSnapshot()) as LockedResetVm;
    expect(stage3.stage).toBe(3);
    expect(stage3.canConfirm).toBe(false);
    expect(stage3.confirmationPhrase).toBe(RESET_CONFIRMATION_PHRASE);

    actor.send({ type: "TYPE_PHRASE", text: RESET_CONFIRMATION_PHRASE });
    expect((selectResetVm(actor.getSnapshot()) as LockedResetVm).canConfirm).toBe(
      true,
    );
    actor.stop();
  });

  it("does not name Google Drive as a durable home (Custom Rule 3)", () => {
    const actor = lockedActor();
    const vm = selectResetVm(actor.getSnapshot()) as LockedResetVm;

    // `\b` keeps OneDrive — a real provider — out of the negative assertion.
    expect(JSON.stringify(vm)).not.toMatch(/\bdrive\b/iu);
    expect(JSON.stringify(vm)).not.toMatch(/google/iu);
    expect(vm.survives.items[0]).toContain("Dropbox, OneDrive, or bundle");
    actor.stop();
  });
});

describe("SCR-009 readable reset (CAP-07, MOD-032)", () => {
  function readableActor(purgeFails = false) {
    const fake = fakeServices({
      resetReadable: (input) =>
        input.confirmToken === undefined
          ? Promise.resolve({
              kind: "resetReadable" as const,
              phase: "inventory" as const,
              inventory: emptyInventory(),
              confirmToken: "token",
            })
          : purgeFails
            ? Promise.reject(workerError("stale-confirmation"))
            : Promise.resolve({
                kind: "resetReadable" as const,
                phase: "purged" as const,
                purged: true as const,
              }),
    });
    const actor = createActor(resetMachine, {
      input: { services: fake.services, entry: "readable" },
    });
    actor.start();
    return actor;
  }

  it("says 'none' for an empty inventory, never 'unknown'", async () => {
    const actor = readableActor();
    expect((selectResetVm(actor.getSnapshot()) as ReadableResetVm).inventory).toBe(
      "loading",
    );

    await settled();
    const vm = selectResetVm(actor.getSnapshot()) as ReadableResetVm;
    expect(vm.inventory).toBe("none");
    expect(vm.appCount).toBe(0);
    expect(vm.announcement).toContain("No apps are on this device");
    expect(JSON.stringify(vm)).not.toMatch(/unknown/iu);
    actor.stop();
  });

  it("reports a stale confirmation as recoverable, with nothing destroyed", async () => {
    const actor = readableActor(true);
    await settled();
    actor.send({ type: "CONTINUE" });
    actor.send({ type: "ACKNOWLEDGE", acknowledged: true });
    actor.send({ type: "CONTINUE" });
    actor.send({ type: "TYPE_PHRASE", text: RESET_CONFIRMATION_PHRASE });
    actor.send({ type: "CONFIRM" });
    await settled();

    const vm = selectResetVm(actor.getSnapshot()) as ReadableResetVm;
    expect(vm.staleConfirmation).toBe(true);
    expect(vm.error?.kind).toBe("stale-confirmation");
    expect(vm.announcement).toContain("Nothing was destroyed");
    actor.stop();
  });
});

describe("refusal announcements", () => {
  it("has one sentence for every error kind the worker can send", () => {
    for (const kind of DATA_WORKER_ERROR_KINDS_V1) {
      const announcement = announceRefusal(toErrorVm({ kind }));
      expect(announcement.length).toBeGreaterThan(0);
    }
  });

  it("never blames the user and never echoes a value", () => {
    for (const kind of DATA_WORKER_ERROR_KINDS_V1) {
      const announcement = announceRefusal(toErrorVm({ kind }));
      expect(announcement).not.toMatch(/your fault|invalid input|bad /iu);
      expect(announcement).not.toMatch(/your passphrase\b/iu);
    }
  });

  it("marks a rate limit retryable and carries the worker's wait", () => {
    expect(toErrorVm({ kind: "rate-limited", retryAfterMs: 2_000 })).toEqual({
      kind: "rate-limited",
      retryable: true,
      retryAfterMs: 2_000,
    });
    expect(toErrorVm({ kind: "wrong-passphrase" })).toEqual({
      kind: "wrong-passphrase",
      retryable: false,
    });
  });
});
