/**
 * Per-surface view models for SCR-001–009 and MOD-022/032/033/037 (M37).
 *
 * A view model carries what its surface may show and nothing else. Three rules
 * are enforced by the *types* here, not by review:
 *
 * 1. **Locked-state models cannot name inventory.** {@link UnlockVm} and
 *    {@link LockedResetVm} have no field for an app name, a record count, or a
 *    backup time. In F01 nothing exists to put in one — but the shape must
 *    already refuse it, because the locked store is undecryptable by
 *    definition (FR-22/FR-23) and a field would invite a future writer to fill
 *    it from somewhere.
 * 2. **Secrets are not echoed.** No model has a passphrase or a confirmation
 *    field. The recovery code appears in exactly two places — the setup
 *    display variants and the MOD-022 reveal variant — and only while the
 *    owning machine is in that state.
 * 3. **Every prompt names its exact secret.** design.md § Content Patterns
 *    forbids "Enter your passphrase"; the scope string lives here, in the
 *    model, so no component can drop it.
 *
 * **On copy.** Strings quoted from a mock or from design.md carry that source
 * in a comment. Where a state has no mock sentence — busy states, refusals —
 * the string is assembled from facts in the Content Patterns style (facts then
 * remedy, no blame, exact secret, exact location). S07 owns the surfaces and
 * may replace any of these with approved copy; it must not *remove* the scope
 * strings or the D4 wording.
 */

import type { SnapshotFrom } from "xstate";
import type { CapabilityReport } from "../../platform/capabilities.js";
import type {
  DataWorkerErrorKindV1,
  IdleTimeoutMinutesV1,
} from "../../workers/protocol/messages.js";
import type { setupMachine } from "../workflows/setup.machine.js";
import type { unlockMachine } from "../workflows/unlock.machine.js";
import type { recoveryMachine } from "../workflows/recovery.machine.js";
import type { passphraseChangeMachine } from "../workflows/passphrase-change.machine.js";
import type { revealCodeMachine } from "../workflows/reveal-code.machine.js";
import type { resetMachine } from "../workflows/reset.machine.js";
import type { sessionMachine } from "../workflows/session.machine.js";
import {
  IDLE_TIMEOUT_OPTIONS,
  isRetryableSettingsError,
} from "../workflows/session.machine.js";
import { RESET_CONFIRMATION_PHRASE } from "../workflows/reset.machine.js";
import { UNLOCK_ROUTES_IN_ORDER } from "../workflows/unlock.machine.js";
import type { SecurityError } from "../workflows/services.js";

// --- exact-secret scope strings (design.md § Content Patterns) --------------

/** unlock.html, passphrase-change.html: never "your passphrase". */
export const LOCAL_PASSPHRASE_SCOPE = "This device's unlock passphrase";
export const CURRENT_LOCAL_PASSPHRASE_SCOPE =
  "Current local unlock passphrase";
export const NEW_LOCAL_PASSPHRASE_SCOPE = "New local unlock passphrase";
/** setup.html, recovery-codes.html. */
export const LOCAL_RECOVERY_CODE_SCOPE = "Local recovery code";
/** recovery-codes.html: what the local code can and cannot open. */
export const LOCAL_RECOVERY_CODE_REACH = "This device only";

// --- shared -----------------------------------------------------------------

/**
 * A refusal as a surface may render it: the worker's closed kind, whether
 * retrying can help, and the wait the worker imposed. No message, no cause, no
 * value — the redaction boundary already decided that (CA-04).
 */
export interface ErrorVm {
  readonly kind: DataWorkerErrorKindV1;
  readonly retryable: boolean;
  /** Present only when the worker sent one. Rendered, never recomputed. */
  readonly retryAfterMs?: number;
}

/** Retrying the same input can only help for these. */
const RETRYABLE_KINDS: ReadonlySet<DataWorkerErrorKindV1> = new Set([
  "revision-conflict",
  "timeout",
  "worker-terminated",
  "internal",
  "rate-limited",
]);

export function toErrorVm(error: SecurityError): ErrorVm {
  const retryable = RETRYABLE_KINDS.has(error.kind);
  return error.retryAfterMs === undefined
    ? { kind: error.kind, retryable }
    : { kind: error.kind, retryable, retryAfterMs: error.retryAfterMs };
}

/**
 * One sentence per refusal, in the Content Patterns style: what happened, then
 * what to do, never blame and never a value. Announcement only — the visible
 * copy is the surface's, from its mock.
 */
const REFUSAL_ANNOUNCEMENT: Readonly<
  Record<DataWorkerErrorKindV1, string>
> = Object.freeze({
  "protocol-version-mismatch":
    "Sheaf could not talk to its local worker. Reload this page.",
  "unsupported-request":
    "Sheaf could not talk to its local worker. Reload this page.",
  "malformed-request":
    "Sheaf could not talk to its local worker. Reload this page.",
  "already-initialized": "This device is already protected. Unlock it instead.",
  "not-initialized": "This device is not protected yet. Set it up first.",
  "wrong-passphrase": "That is not this device's unlock passphrase.",
  "invalid-recovery-code": "That is not this device's local recovery code.",
  "rate-limited": "Too many failed attempts. Wait before trying again.",
  locked: "The local store is locked. Unlock this device first.",
  "invalid-setting": "That is not one of the available choices.",
  "revision-conflict": "This device changed while you were deciding. Try again.",
  "stale-confirmation":
    "This device changed after the list was made. Nothing was destroyed. Review the new list.",
  integrity:
    "The local store did not pass its integrity check. Nothing was changed.",
  "worker-terminated": "The local session ended. Unlock this device again.",
  timeout: "That took too long to answer. Try again.",
  internal: "Sheaf could not finish that. Try again.",
});

export function announceRefusal(error: ErrorVm): string {
  return REFUSAL_ANNOUNCEMENT[error.kind];
}

export type PassphraseStrengthVm = "weak" | "sufficient" | undefined;
export type PassphraseMatchVm = "mismatch" | "matched" | undefined;

// --- SCR-001 welcome / capability gate (CAP-08) -----------------------------

export interface MissingCapabilityVm {
  readonly id: string;
  /** Why Sheaf needs it, written by the probe (S05). Never invented here. */
  readonly reason: string;
}

/**
 * SCR-001. The `unsupported` variant is CTL-087's recoverable state: it names
 * the capability that is missing, because "this browser is not supported" with
 * no name is not a fact the user can act on.
 */
export type WelcomeVm =
  | {
      readonly screen: "SCR-001";
      readonly kind: "ready";
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-001";
      readonly kind: "unsupported";
      readonly recoverable: true;
      readonly missing: readonly MissingCapabilityVm[];
      readonly announcement: string;
    };

export function selectWelcomeVm(report: CapabilityReport): WelcomeVm {
  if (report.supported) {
    return {
      screen: "SCR-001",
      kind: "ready",
      // welcome.html: "No account · no subscription · no network needed".
      announcement: "Sheaf runs on this device. No account or network needed.",
    };
  }

  const missing = report.entries
    .filter((entry) => report.missing.includes(entry.id))
    .map((entry) => ({ id: entry.id, reason: entry.reason }));

  return {
    screen: "SCR-001",
    kind: "unsupported",
    recoverable: true,
    missing,
    announcement: `Sheaf cannot protect this device in this browser. Missing: ${missing
      .map((entry) => entry.id)
      .join(", ")}.`,
  };
}

// --- SCR-002 setup (CAP-01) -------------------------------------------------

export type SetupVm =
  | {
      readonly screen: "SCR-002";
      readonly step: "welcome";
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-002";
      readonly step: "definePassphrase";
      readonly passphraseScope: string;
      /** setup.html's own guidance; the policy enforces the same rule. */
      readonly guidance: string;
      readonly strength: PassphraseStrengthVm;
      readonly match: PassphraseMatchVm;
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-002";
      readonly step: "deriving";
      readonly busy: true;
      readonly cancellation: "unavailable";
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-002";
      readonly step: "codeIssued";
      readonly codeScope: string;
      readonly codeReach: string;
      /** On screen now, and only now. */
      readonly recoveryCode: string;
      readonly warning: string;
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-002";
      readonly step: "codeConfirm";
      readonly codeScope: string;
      readonly recoveryCode: string;
      readonly acknowledged: boolean;
      readonly acknowledgement: string;
      readonly canFinish: boolean;
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-002";
      readonly step: "failed";
      readonly error: ErrorVm;
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-002";
      readonly step: "unlocked";
      readonly announcement: string;
    };

/** setup.html, verbatim. */
const SETUP_GUIDANCE = "Use four or more uncommon words you can remember.";
const SETUP_CODE_WARNING =
  "If I lose both this passphrase and this code, nobody—including Sheaf—can recover this device.";
const SETUP_ACKNOWLEDGEMENT = "I saved the local recovery code";

export function selectSetupVm(
  snapshot: SnapshotFrom<typeof setupMachine>,
): SetupVm {
  const { context } = snapshot;
  const screen = "SCR-002" as const;

  if (snapshot.matches("welcome")) {
    return {
      screen,
      step: "welcome",
      // welcome.html / setup.html step 1.
      announcement: "Protect this device. No account or network needed.",
    };
  }
  if (snapshot.matches("definePassphrase")) {
    return {
      screen,
      step: "definePassphrase",
      passphraseScope: LOCAL_PASSPHRASE_SCOPE,
      guidance: SETUP_GUIDANCE,
      strength: context.strength,
      match: context.match,
      announcement: "Choose an unlock passphrase for this device.",
    };
  }
  if (snapshot.matches("deriving")) {
    return {
      screen,
      step: "deriving",
      busy: true,
      cancellation: "unavailable",
      announcement: "Protecting this device. This takes a moment.",
    };
  }
  if (snapshot.matches("codeIssued")) {
    return {
      screen,
      step: "codeIssued",
      codeScope: LOCAL_RECOVERY_CODE_SCOPE,
      codeReach: LOCAL_RECOVERY_CODE_REACH,
      recoveryCode: context.recoveryCode ?? "",
      warning: SETUP_CODE_WARNING,
      // setup.html: "Write this down once".
      announcement:
        "Your local recovery code is shown once. Write it down now.",
    };
  }
  if (snapshot.matches("codeConfirm")) {
    return {
      screen,
      step: "codeConfirm",
      codeScope: LOCAL_RECOVERY_CODE_SCOPE,
      recoveryCode: context.recoveryCode ?? "",
      acknowledged: context.acknowledgedSaved,
      acknowledgement: SETUP_ACKNOWLEDGEMENT,
      canFinish: context.acknowledgedSaved,
      announcement:
        "Confirm you saved the local recovery code before finishing.",
    };
  }
  if (snapshot.matches("failed")) {
    const error = toErrorVm(context.error ?? { kind: "internal" });
    return {
      screen,
      step: "failed",
      error,
      announcement: announceRefusal(error),
    };
  }
  return {
    screen,
    step: "unlocked",
    announcement: "This device is protected and unlocked.",
  };
}

// --- SCR-003 cold unlock (CAP-02) -------------------------------------------

/**
 * FR-22 ordering as data: recovery is offered before reset. A surface renders
 * this array in order; it does not choose one.
 */
export type UnlockRouteVm = (typeof UNLOCK_ROUTES_IN_ORDER)[number];

/**
 * SCR-003. Note what is *absent*: no app names, no counts, no backup times,
 * no last-opened stamp. The locked store cannot produce them and this type
 * cannot carry them.
 */
export type UnlockVm =
  | {
      readonly screen: "SCR-003";
      readonly state: "locked";
      readonly passphraseScope: string;
      readonly encryptedFact: string;
      readonly delayFact: string;
      readonly routes: readonly UnlockRouteVm[];
      readonly canSubmit: true;
      readonly error: ErrorVm | undefined;
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-003";
      readonly state: "deriving";
      readonly busy: true;
      readonly cancellation: "unavailable";
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-003";
      readonly state: "delayed";
      readonly passphraseScope: string;
      readonly delayFact: string;
      readonly remainingMs: number;
      readonly remainingSeconds: number;
      readonly canSubmit: false;
      readonly routes: readonly UnlockRouteVm[];
      readonly error: ErrorVm;
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-003";
      readonly state: "unlocked";
      readonly announcement: string;
    };

/** unlock.html, verbatim. */
const UNLOCK_ENCRYPTED_FACT =
  "Your app names, record counts, and backup details stay encrypted until you unlock.";
/**
 * unlock.html, verbatim — and D4-safe: it says nothing about the delay
 * outliving this session, because it does not (the counter dies with the
 * worker).
 */
const UNLOCK_DELAY_FACT =
  "Repeated failed attempts receive an increasing delay. They never trigger a wipe.";

export function selectUnlockVm(
  snapshot: SnapshotFrom<typeof unlockMachine>,
): UnlockVm {
  const { context } = snapshot;
  const screen = "SCR-003" as const;
  const routes = [...UNLOCK_ROUTES_IN_ORDER];

  if (snapshot.matches("deriving")) {
    return {
      screen,
      state: "deriving",
      busy: true,
      cancellation: "unavailable",
      announcement: "Unlocking this device. This takes a moment.",
    };
  }
  if (snapshot.matches("unlocked")) {
    return {
      screen,
      state: "unlocked",
      announcement: "This device is unlocked.",
    };
  }
  if (snapshot.matches({ failed: "waiting" })) {
    const error = toErrorVm(context.error ?? { kind: "rate-limited" });
    const remainingSeconds = Math.ceil(context.remainingMs / 1_000);
    return {
      screen,
      state: "delayed",
      passphraseScope: LOCAL_PASSPHRASE_SCOPE,
      delayFact: UNLOCK_DELAY_FACT,
      remainingMs: context.remainingMs,
      remainingSeconds,
      canSubmit: false,
      routes,
      error,
      announcement: `Too many failed attempts. Try again in ${remainingSeconds} seconds.`,
    };
  }

  const error =
    context.error === undefined ? undefined : toErrorVm(context.error);
  return {
    screen,
    state: "locked",
    passphraseScope: LOCAL_PASSPHRASE_SCOPE,
    encryptedFact: UNLOCK_ENCRYPTED_FACT,
    delayFact: UNLOCK_DELAY_FACT,
    routes,
    canSubmit: true,
    error,
    announcement:
      error === undefined
        ? // unlock.html: "Local store locked".
          "The local store is locked. Enter this device's unlock passphrase."
        : announceRefusal(error),
  };
}

// --- SCR-004 local recovery (CAP-05) ----------------------------------------

export type RecoveryVm =
  | {
      readonly screen: "SCR-004";
      readonly step: "enterCode";
      readonly codeScope: string;
      readonly codeReach: string;
      readonly losslessFact: string;
      readonly codeMisspelled: boolean;
      readonly error: ErrorVm | undefined;
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-004";
      readonly step: "checkingFormat";
      readonly busy: true;
      readonly cancellation: "unavailable";
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-004";
      readonly step: "unlocking";
      readonly busy: true;
      readonly cancellation: "unavailable";
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-004";
      readonly step: "definePassphrase";
      readonly passphraseScope: string;
      readonly requirementFact: string;
      readonly strength: PassphraseStrengthVm;
      readonly match: PassphraseMatchVm;
      readonly error: ErrorVm | undefined;
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-004";
      readonly step: "installing";
      readonly busy: true;
      readonly cancellation: "unavailable";
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-004";
      readonly step: "done";
      readonly announcement: string;
    };

/** local-recovery.html, verbatim. */
const RECOVERY_LOSSLESS_FACT =
  "A valid local code opens the existing encrypted store. Reset is not involved.";
/** FR-23: recovery installs a replacement, so the surface must say so. */
const RECOVERY_REQUIREMENT_FACT =
  "Set a new unlock passphrase for this device to finish recovering.";

export function selectRecoveryVm(
  snapshot: SnapshotFrom<typeof recoveryMachine>,
): RecoveryVm {
  const { context } = snapshot;
  const screen = "SCR-004" as const;
  const error =
    context.error === undefined ? undefined : toErrorVm(context.error);

  if (snapshot.matches("checkingFormat")) {
    return {
      screen,
      step: "checkingFormat",
      busy: true,
      cancellation: "unavailable",
      announcement: "Checking the local recovery code.",
    };
  }
  if (snapshot.matches("unlocking")) {
    return {
      screen,
      step: "unlocking",
      busy: true,
      cancellation: "unavailable",
      announcement: "Opening this device's store. This takes a moment.",
    };
  }
  if (snapshot.matches("definePassphrase")) {
    return {
      screen,
      step: "definePassphrase",
      passphraseScope: NEW_LOCAL_PASSPHRASE_SCOPE,
      requirementFact: RECOVERY_REQUIREMENT_FACT,
      strength: context.strength,
      match: context.match,
      error,
      announcement:
        error === undefined
          ? RECOVERY_REQUIREMENT_FACT
          : announceRefusal(error),
    };
  }
  if (snapshot.matches("installing")) {
    return {
      screen,
      step: "installing",
      busy: true,
      cancellation: "unavailable",
      announcement: "Installing the new unlock passphrase.",
    };
  }
  if (snapshot.matches("done")) {
    return {
      screen,
      step: "done",
      announcement:
        "This device is unlocked and its new passphrase is in place.",
    };
  }

  return {
    screen,
    step: "enterCode",
    codeScope: LOCAL_RECOVERY_CODE_SCOPE,
    codeReach: LOCAL_RECOVERY_CODE_REACH,
    losslessFact: RECOVERY_LOSSLESS_FACT,
    codeMisspelled: context.codeMisspelled,
    error,
    announcement: context.codeMisspelled
      ? "That is not a complete local recovery code. Check it and try again."
      : error === undefined
        ? "Enter this device's local recovery code."
        : announceRefusal(error),
  };
}

// --- SCR-005 security settings (CAP-03, D13/AD-7) ---------------------------

export interface IdleTimeoutOptionVm {
  readonly minutes: IdleTimeoutMinutesV1;
  readonly label: string;
}

/** security-settings.html, verbatim, in the order the select shows them. */
export const IDLE_TIMEOUT_OPTION_VMS: readonly IdleTimeoutOptionVm[] =
  Object.freeze(
    IDLE_TIMEOUT_OPTIONS.map((minutes) => ({
      minutes,
      label:
        minutes === 0
          ? "Off"
          : minutes === 60
            ? "1 hour"
            : `${String(minutes)} minutes`,
    })),
  );

/**
 * SCR-005. `idleTimeoutMinutes` is the *persisted* value — the one the worker
 * confirmed it stored. A pending choice is not represented here at all, which
 * is the point: the surface cannot render a setting that did not persist
 * (D13/AD-7).
 */
export interface SecuritySettingsVm {
  readonly screen: "SCR-005";
  readonly idleTimeoutMinutes: IdleTimeoutMinutesV1;
  readonly options: readonly IdleTimeoutOptionVm[];
  readonly saving: boolean;
  readonly persistError: ErrorVm | undefined;
  readonly defaultFact: string;
  readonly lockNowFact: string;
  readonly locked: boolean;
  readonly announcement: string;
}

/** security-settings.html, verbatim. */
const IDLE_DEFAULT_FACT = "Off by default for uninterrupted field work";
const LOCK_NOW_FACT = "Closes the current unlocked session";

export function selectSecuritySettingsVm(
  snapshot: SnapshotFrom<typeof sessionMachine>,
): SecuritySettingsVm {
  const { context } = snapshot;
  const saving = snapshot.matches({
    active: { settings: "savingIdleTimeout" },
  });
  const locked = snapshot.matches("locked");
  const persistError =
    context.settingsError === undefined
      ? undefined
      : {
          ...toErrorVm(context.settingsError),
          retryable: isRetryableSettingsError(context.settingsError),
        };

  const persisted = IDLE_TIMEOUT_OPTION_VMS.find(
    (option) => option.minutes === context.idleTimeoutMinutes,
  );

  return {
    screen: "SCR-005",
    idleTimeoutMinutes: context.idleTimeoutMinutes,
    options: IDLE_TIMEOUT_OPTION_VMS,
    saving,
    persistError,
    defaultFact: IDLE_DEFAULT_FACT,
    lockNowFact: LOCK_NOW_FACT,
    locked,
    announcement: locked
      ? "This device is locked."
      : saving
        ? "Saving the idle timeout."
        : persistError !== undefined
          ? announceRefusal(persistError)
          : `Idle timeout is ${persisted?.label ?? "Off"}.`,
  };
}

// --- SCR-006 change passphrase (CAP-04, MOD-037) ----------------------------

export type PassphraseChangeVm =
  | {
      readonly screen: "SCR-006";
      readonly step: "form";
      readonly currentScope: string;
      readonly nextScope: string;
      readonly noDataLossFact: string;
      readonly strength: PassphraseStrengthVm;
      readonly match: PassphraseMatchVm;
      readonly error: ErrorVm | undefined;
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-006";
      readonly step: "confirm";
      readonly dialog: "MOD-037";
      readonly currentScope: string;
      readonly noDataLossFact: string;
      readonly localOnlyFact: string;
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-006";
      readonly step: "rewrapping";
      readonly busy: true;
      readonly cancellation: "unavailable";
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-006";
      readonly step: "done";
      readonly announcement: string;
    };

/** passphrase-change.html, verbatim. */
const CHANGE_NO_DATA_LOSS_FACT =
  "The current passphrase authorizes a key re-wrap. Your apps, histories, and durable copies remain intact.";
const CHANGE_LOCAL_ONLY_FACT =
  "This changes the local unlock only. Durable homes with different vault passphrases do not change.";

export function selectPassphraseChangeVm(
  snapshot: SnapshotFrom<typeof passphraseChangeMachine>,
): PassphraseChangeVm {
  const { context } = snapshot;
  const screen = "SCR-006" as const;

  if (snapshot.matches("confirm")) {
    return {
      screen,
      step: "confirm",
      dialog: "MOD-037",
      currentScope: CURRENT_LOCAL_PASSPHRASE_SCOPE,
      noDataLossFact: CHANGE_NO_DATA_LOSS_FACT,
      localOnlyFact: CHANGE_LOCAL_ONLY_FACT,
      announcement: CHANGE_NO_DATA_LOSS_FACT,
    };
  }
  if (snapshot.matches("rewrapping")) {
    return {
      screen,
      step: "rewrapping",
      busy: true,
      cancellation: "unavailable",
      announcement: "Re-wrapping this device's keys. No data is being changed.",
    };
  }
  if (snapshot.matches("done")) {
    return {
      screen,
      step: "done",
      announcement: "This device's unlock passphrase has changed.",
    };
  }

  const error =
    context.error === undefined ? undefined : toErrorVm(context.error);
  return {
    screen,
    step: "form",
    currentScope: CURRENT_LOCAL_PASSPHRASE_SCOPE,
    nextScope: NEW_LOCAL_PASSPHRASE_SCOPE,
    noDataLossFact: CHANGE_NO_DATA_LOSS_FACT,
    strength: context.strength,
    match: context.match,
    error,
    announcement:
      error === undefined ? CHANGE_NO_DATA_LOSS_FACT : announceRefusal(error),
  };
}

// --- SCR-007 recovery-code centre + MOD-022 reveal (CAP-06) -----------------

export type RevealCodeVm =
  | {
      readonly screen: "SCR-007";
      readonly dialog: "MOD-022";
      readonly step: "request";
      readonly passphraseScope: string;
      readonly codeScope: string;
      readonly codeReach: string;
      readonly error: ErrorVm | undefined;
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-007";
      readonly dialog: "MOD-022";
      readonly step: "revealing";
      readonly busy: true;
      readonly cancellation: "unavailable";
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-007";
      readonly dialog: "MOD-022";
      readonly step: "revealed";
      readonly codeScope: string;
      readonly codeReach: string;
      /** On screen now, and only now. */
      readonly recoveryCode: string;
      readonly announcement: string;
    }
  | {
      readonly screen: "SCR-007";
      readonly dialog: "MOD-022";
      readonly step: "dismissed";
      readonly announcement: string;
    };

export function selectRevealCodeVm(
  snapshot: SnapshotFrom<typeof revealCodeMachine>,
): RevealCodeVm {
  const { context } = snapshot;
  const base = { screen: "SCR-007", dialog: "MOD-022" } as const;

  if (snapshot.matches("revealing")) {
    return {
      ...base,
      step: "revealing",
      busy: true,
      cancellation: "unavailable",
      announcement: "Checking this device's unlock passphrase.",
    };
  }
  if (snapshot.matches("revealed")) {
    return {
      ...base,
      step: "revealed",
      codeScope: LOCAL_RECOVERY_CODE_SCOPE,
      codeReach: LOCAL_RECOVERY_CODE_REACH,
      recoveryCode: context.recoveryCode ?? "",
      announcement: "Your local recovery code is on screen.",
    };
  }
  if (snapshot.matches("dismissed")) {
    return {
      ...base,
      step: "dismissed",
      announcement: "The local recovery code is hidden again.",
    };
  }

  const error =
    context.error === undefined ? undefined : toErrorVm(context.error);
  return {
    ...base,
    step: "request",
    passphraseScope: CURRENT_LOCAL_PASSPHRASE_SCOPE,
    codeScope: LOCAL_RECOVERY_CODE_SCOPE,
    codeReach: LOCAL_RECOVERY_CODE_REACH,
    error,
    announcement:
      error === undefined
        ? "Enter this device's unlock passphrase to see the local recovery code."
        : announceRefusal(error),
  };
}

// --- SCR-008 / SCR-009 reset (CAP-07, MOD-032 / MOD-033) --------------------

export interface ConsequenceVm {
  readonly heading: string;
  readonly items: readonly string[];
}

/** Which of the three gates the user is standing on. */
export type ResetStageVm = 1 | 2 | 3;

/**
 * SCR-008 (MOD-033). No inventory field exists on this type: the locked store
 * cannot be enumerated, and `unknowns` says so in words rather than leaving a
 * count empty.
 */
export interface LockedResetVm {
  readonly screen: "SCR-008";
  readonly dialog: "MOD-033";
  readonly entry: "locked";
  readonly stage: ResetStageVm;
  readonly stageCount: 3;
  readonly cannotEnumerateFact: string;
  readonly noPlaintextInventoryFact: string;
  readonly known: ConsequenceVm;
  readonly unknowns: ConsequenceVm;
  readonly survives: ConsequenceVm;
  readonly losslessRoute: string;
  readonly confirmationPhrase: string;
  readonly canConfirm: boolean;
  readonly acknowledged: boolean;
  readonly error: ErrorVm | undefined;
  readonly announcement: string;
}

/** One app as a readable reset lists it. Empty in F01 — and truthfully so. */
export interface ResetInventoryRowVm {
  readonly appId: string;
  readonly displayName: string;
  readonly deviceOnlyChangeCount: number;
}

/** SCR-009 (MOD-032). Unlocked, so the facts are nameable. */
export interface ReadableResetVm {
  readonly screen: "SCR-009";
  readonly dialog: "MOD-032";
  readonly entry: "readable";
  readonly stage: ResetStageVm;
  readonly stageCount: 3;
  /** Enumerated, not guessed. `"none"` is a fact; there is no "unknown". */
  readonly inventory: "loading" | "none" | readonly ResetInventoryRowVm[];
  readonly appCount: number;
  readonly homeCount: number;
  readonly survives: ConsequenceVm;
  readonly confirmationPhrase: string;
  readonly canConfirm: boolean;
  readonly acknowledged: boolean;
  readonly staleConfirmation: boolean;
  readonly error: ErrorVm | undefined;
  readonly announcement: string;
}

export type ResetVm =
  | LockedResetVm
  | ReadableResetVm
  | {
      readonly screen: "SCR-008" | "SCR-009";
      readonly entry: "locked" | "readable";
      readonly stage: 3;
      readonly stageCount: 3;
      readonly purged: true;
      readonly announcement: string;
    };

/** reset.html, verbatim. */
const RESET_CANNOT_ENUMERATE =
  "Sheaf cannot list the apps, record counts, backup times, or device-only changes that would be destroyed—because all of that is encrypted.";
const RESET_NO_PLAINTEXT_INVENTORY =
  "Sheaf keeps no plaintext inventory beside the locked store just to improve this dialog.";
const RESET_LOSSLESS_ROUTE =
  "Your local recovery code unlocks this device's store. A vault recovery code does not.";

const LOCKED_KNOWN: ConsequenceVm = Object.freeze({
  heading: "What is known",
  items: Object.freeze([
    "Every app on this device is destroyed",
    "A scratch app is lost entirely",
    "A durable app may be adopted again, only at its last successful backup—not its current device state",
  ]),
});

const LOCKED_UNKNOWNS: ConsequenceVm = Object.freeze({
  heading: "This inability is the encryption working",
  items: Object.freeze([
    "Changes since backup are destroyed",
    "Sheaf cannot say how many or which app they belong to while locked",
  ]),
});

/**
 * Providers listed as the mock lists them, minus Google Drive: FORGE-CONFIG
 * Custom Rule 3 settles that Drive is not a durable home, so naming it here
 * would promise a copy that cannot exist.
 */
const RESET_SURVIVES: ConsequenceVm = Object.freeze({
  heading: "Durable-home ciphertext is left alone",
  items: Object.freeze([
    "This reset does not delete Dropbox, OneDrive, or bundle copies",
    "Re-adoption restores only the last confirmed backup",
  ]),
});

function resetStage(
  snapshot: SnapshotFrom<typeof resetMachine>,
): ResetStageVm {
  if (snapshot.matches("acknowledge")) {
    return 2;
  }
  if (
    snapshot.matches("typePhrase") ||
    snapshot.matches("purging") ||
    snapshot.matches("purged")
  ) {
    return 3;
  }
  return 1;
}

export function selectResetVm(
  snapshot: SnapshotFrom<typeof resetMachine>,
): ResetVm {
  const { context } = snapshot;
  const stage = resetStage(snapshot);
  const error =
    context.error === undefined ? undefined : toErrorVm(context.error);
  const canConfirm = snapshot.can({ type: "CONFIRM" });

  if (snapshot.matches("purged")) {
    return {
      screen: context.entry === "locked" ? "SCR-008" : "SCR-009",
      entry: context.entry,
      stage: 3,
      stageCount: 3,
      purged: true,
      announcement:
        "This device's encrypted local store was destroyed. Durable-home copies are untouched.",
    };
  }

  if (context.entry === "locked") {
    return {
      screen: "SCR-008",
      dialog: "MOD-033",
      entry: "locked",
      stage,
      stageCount: 3,
      cannotEnumerateFact: RESET_CANNOT_ENUMERATE,
      noPlaintextInventoryFact: RESET_NO_PLAINTEXT_INVENTORY,
      known: LOCKED_KNOWN,
      unknowns: LOCKED_UNKNOWNS,
      survives: RESET_SURVIVES,
      losslessRoute: RESET_LOSSLESS_ROUTE,
      confirmationPhrase: RESET_CONFIRMATION_PHRASE,
      canConfirm,
      acknowledged: context.acknowledged,
      error,
      announcement:
        error === undefined
          ? `Reset, step ${String(stage)} of 3. ${RESET_CANNOT_ENUMERATE}`
          : announceRefusal(error),
    };
  }

  const inventory: ReadableResetVm["inventory"] = snapshot.matches(
    "loadingInventory",
  )
    ? "loading"
    : context.inventory === undefined || context.inventory.apps.length === 0
      ? "none"
      : context.inventory.apps.map((app) => ({
          appId: app.appId,
          displayName: app.displayName,
          deviceOnlyChangeCount: app.deviceOnlyChangeCount,
        }));

  const staleConfirmation = snapshot.matches("staleConfirmation");

  return {
    screen: "SCR-009",
    dialog: "MOD-032",
    entry: "readable",
    stage,
    stageCount: 3,
    inventory,
    appCount: context.inventory?.appCount ?? 0,
    homeCount: context.inventory?.homeCount ?? 0,
    survives: RESET_SURVIVES,
    confirmationPhrase: RESET_CONFIRMATION_PHRASE,
    canConfirm,
    acknowledged: context.acknowledged,
    staleConfirmation,
    error,
    announcement:
      error === undefined
        ? inventory === "loading"
          ? "Listing what this reset would destroy."
          : inventory === "none"
            ? `Reset, step ${String(stage)} of 3. No apps are on this device, so none would be destroyed.`
            : `Reset, step ${String(stage)} of 3. ${String(context.inventory?.appCount ?? 0)} local apps would be destroyed.`
        : announceRefusal(error),
  };
}
