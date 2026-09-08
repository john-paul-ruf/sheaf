/**
 * The machine-facing edge of the data worker (M36 → M32).
 *
 * Every machine in this directory talks to exactly one of these adapters, so
 * S07 wires the real {@link DataWorkerClient} in one place and unit tests
 * substitute a fake in the same place. The adapters add no logic: they name a
 * request, send it, and return the typed response.
 *
 * Failures cross as {@link SecurityError} — the worker's own closed error kind
 * plus, where the caller must render a wait, the `retryAfterMs` the worker
 * computed. Machines render that number; they never derive a schedule from it
 * (CA-05/AD-5).
 */

import { DataWorkerRequestError } from "../../workers/protocol/client.js";
import type {
  ChangePassphraseResponseV1,
  DataWorkerErrorV1,
  DataWorkerRequestV1,
  GetStatusResponseV1,
  IdleTimeoutMinutesV1,
  LockResponseV1,
  PassphraseChangeAuthorizationV1,
  ResetLockedResponseV1,
  ResetReadableResponseV1,
  ResponseForV1,
  RevealRecoveryCodeResponseV1,
  SetupResponseV1,
  UnlockResponseV1,
  UnlockWithRecoveryCodeResponseV1,
  UpdateSettingsResponseV1,
} from "../../workers/protocol/messages.js";
import {
  createImportServices,
  type ImportServices,
  type ImportWorkerPort,
} from "./import-services.js";
import {
  createRecordsServices,
  type RecordsServices,
  type RecordsWorkerPort,
} from "./records-services.js";

/** A refusal a machine can render. Identical to the wire error by design. */
export type SecurityError = DataWorkerErrorV1;

/**
 * The part of the worker client these adapters use. Structural rather than the
 * class itself, so a test double is a two-line object and no machine can reach
 * `terminate()` — ending the worker is the bootstrap runtime's decision.
 */
export interface SecurityWorkerPort {
  send<R extends DataWorkerRequestV1>(
    request: R,
  ): Promise<ResponseForV1<R["kind"]>>;
}

export interface SecurityServices {
  readonly setup: (input: {
    readonly passphrase: string;
  }) => Promise<SetupResponseV1>;
  readonly unlock: (input: {
    readonly passphrase: string;
  }) => Promise<UnlockResponseV1>;
  readonly unlockWithRecoveryCode: (input: {
    readonly recoveryCode: string;
  }) => Promise<UnlockWithRecoveryCodeResponseV1>;
  readonly changePassphrase: (input: {
    readonly authorization: PassphraseChangeAuthorizationV1;
    readonly nextPassphrase: string;
  }) => Promise<ChangePassphraseResponseV1>;
  readonly revealRecoveryCode: (input: {
    readonly currentPassphrase: string;
  }) => Promise<RevealRecoveryCodeResponseV1>;
  readonly lock: () => Promise<LockResponseV1>;
  readonly updateSettings: (input: {
    readonly idleTimeoutMinutes: IdleTimeoutMinutesV1;
  }) => Promise<UpdateSettingsResponseV1>;
  readonly resetLocked: () => Promise<ResetLockedResponseV1>;
  /**
   * Two phases, one command: without a token the worker returns the inventory
   * and a token bound to it; with the token it purges. The token is opaque —
   * pass back exactly what was received (database.md check 7).
   */
  readonly resetReadable: (input: {
    readonly confirmToken?: string;
  }) => Promise<ResetReadableResponseV1>;
  readonly getStatus: () => Promise<GetStatusResponseV1>;
}

export function createSecurityServices(
  port: SecurityWorkerPort,
): SecurityServices {
  return {
    setup: ({ passphrase }) => port.send({ kind: "setup", passphrase }),
    unlock: ({ passphrase }) => port.send({ kind: "unlock", passphrase }),
    unlockWithRecoveryCode: ({ recoveryCode }) =>
      port.send({ kind: "unlockWithRecoveryCode", recoveryCode }),
    changePassphrase: ({ authorization, nextPassphrase }) =>
      port.send({ kind: "changePassphrase", authorization, nextPassphrase }),
    revealRecoveryCode: ({ currentPassphrase }) =>
      port.send({ kind: "revealRecoveryCode", currentPassphrase }),
    lock: () => port.send({ kind: "lock" }),
    updateSettings: ({ idleTimeoutMinutes }) =>
      port.send({ kind: "updateSettings", idleTimeoutMinutes }),
    resetLocked: () => port.send({ kind: "resetLocked" }),
    resetReadable: ({ confirmToken }) =>
      port.send(
        confirmToken === undefined
          ? { kind: "resetReadable" }
          : { kind: "resetReadable", confirmToken },
      ),
    getStatus: () => port.send({ kind: "getStatus" }),
  };
}

/**
 * Normalises whatever an invoked service rejected with into a renderable
 * refusal. An unrecognised rejection becomes `internal` rather than reaching a
 * surface as a raw message: an exception string is exactly the kind of value
 * the redaction boundary exists to keep out of the UI (CA-04).
 */
export function toSecurityError(cause: unknown): SecurityError {
  if (cause instanceof DataWorkerRequestError) {
    return cause.error;
  }
  return { kind: "internal" };
}

/**
 * Every adapter set one runtime needs, composed from the one worker client
 * (F02). The import set is separate because it also owns a second worker and
 * the channel between them; the records set is separate because it has no
 * lifecycle at all. They are assembled here so a runtime wires the client once.
 */
export interface ApplicationServices {
  readonly security: SecurityServices;
  readonly records: RecordsServices;
  readonly import: ImportServices;
}

export function createApplicationServices(options: {
  readonly port: SecurityWorkerPort & ImportWorkerPort & RecordsWorkerPort;
  readonly spawnImportWorker: () => Worker;
}): ApplicationServices {
  return {
    security: createSecurityServices(options.port),
    records: createRecordsServices(options.port),
    import: createImportServices({
      dataWorker: options.port,
      spawnImportWorker: options.spawnImportWorker,
    }),
  };
}

/** Whether the entry is strong enough to be accepted (CTL-098's vocabulary). */
export type PassphraseStrength = "weak" | "sufficient";

/** Whether the confirmation entry equals the passphrase entry. */
export type PassphraseMatch = "mismatch" | "matched";

/**
 * The strength verdict is injected, never computed inside a machine: a machine
 * decides *whether a verdict allows submission*, and the policy decides what
 * the verdict is.
 */
export interface PassphrasePolicyPort {
  evaluate(passphrase: string): PassphraseStrength;
}

/** setup.html: "Use four or more uncommon words you can remember." */
export const PASSPHRASE_MINIMUM_WORDS = 4;

/**
 * The approved guidance read literally: four or more words. It counts words,
 * not entropy, because that is what the surface asks the user for; a policy
 * that refuses what the label promises would be the untruthful one.
 */
export const wordCountPassphrasePolicy: PassphrasePolicyPort = {
  evaluate(passphrase: string): PassphraseStrength {
    const words = passphrase.split(/\s+/u).filter((word) => word.length > 0);
    return words.length >= PASSPHRASE_MINIMUM_WORDS ? "sufficient" : "weak";
  },
};

/**
 * Local, pre-KDF validation of a recovery code's spelling (M08's parse).
 *
 * The port exists because workflows may not import crypto (M36 must-not): S07
 * wires `parseRecoveryCode` from `src/crypto/recovery-code.ts` behind it. The
 * point is refusal *before* an expensive derive — a misspelled code is a
 * typing mistake, not an unlock attempt, and must not cost the user an
 * attempt-delay step.
 */
export interface RecoveryCodeFormatPort {
  isWellFormed(recoveryCode: string): Promise<boolean>;
}
