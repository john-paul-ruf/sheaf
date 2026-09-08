/**
 * The versioned data-worker RPC contract (CA-04).
 *
 * Everything on this wire is text, numbers, booleans, or a union of them: no
 * key handle, no passphrase, no raw payload and no repository object appears
 * in a response type, and a locked response carries no decrypted value at all.
 * That is a type-level guarantee, not a review note —
 * `tests/unit/workers/module-boundaries.test.ts` fails if this file ever names
 * a byte array or a key type.
 *
 * Errors cross as {@link DataWorkerErrorV1}: a closed kind plus, where the
 * caller must render a wait, `retryAfterMs`. Consumers render that number;
 * they never recompute the schedule (CA-05).
 */

export const PROTOCOL_VERSION = 1;

/**
 * The approved idle-timeout choices (FR-22, SCR-005's select). `0` is off and
 * is the product default; a free-form number is never accepted.
 */
export const IDLE_TIMEOUT_MINUTES_V1 = Object.freeze([0, 5, 15, 60] as const);

export type IdleTimeoutMinutesV1 = (typeof IDLE_TIMEOUT_MINUTES_V1)[number];

export function isIdleTimeoutMinutesV1(
  value: unknown,
): value is IdleTimeoutMinutesV1 {
  return (IDLE_TIMEOUT_MINUTES_V1 as readonly unknown[]).includes(value);
}

// --- requests ---------------------------------------------------------------

export interface SetupRequestV1 {
  readonly kind: "setup";
  readonly passphrase: string;
}

export interface UnlockRequestV1 {
  readonly kind: "unlock";
  readonly passphrase: string;
}

export interface UnlockWithRecoveryCodeRequestV1 {
  readonly kind: "unlockWithRecoveryCode";
  readonly recoveryCode: string;
}

/**
 * A passphrase change is authorized either by the current passphrase (SCR-006)
 * or by a session that was unlocked with the recovery code, which must install
 * a new passphrase before it can be used for anything else (CAP-05).
 */
export type PassphraseChangeAuthorizationV1 =
  | { readonly via: "current-passphrase"; readonly currentPassphrase: string }
  | { readonly via: "recovery" };

export interface ChangePassphraseRequestV1 {
  readonly kind: "changePassphrase";
  readonly authorization: PassphraseChangeAuthorizationV1;
  readonly nextPassphrase: string;
}

export interface RevealRecoveryCodeRequestV1 {
  readonly kind: "revealRecoveryCode";
  readonly currentPassphrase: string;
}

export interface LockRequestV1 {
  readonly kind: "lock";
}

export interface UpdateSettingsRequestV1 {
  readonly kind: "updateSettings";
  readonly idleTimeoutMinutes: IdleTimeoutMinutesV1;
}

export interface ResetLockedRequestV1 {
  readonly kind: "resetLocked";
}

/**
 * Two phases, one command. Without a token the worker recomputes the inventory
 * and issues a token bound to it; with a token it recomputes again and purges
 * only if both the token and the session's own view still match what storage
 * says (database.md § `LocalCatalogV1` check 7).
 */
export interface ResetReadableRequestV1 {
  readonly kind: "resetReadable";
  readonly confirmToken?: string;
}

export interface GetStatusRequestV1 {
  readonly kind: "getStatus";
}

export type DataWorkerRequestV1 =
  | SetupRequestV1
  | UnlockRequestV1
  | UnlockWithRecoveryCodeRequestV1
  | ChangePassphraseRequestV1
  | RevealRecoveryCodeRequestV1
  | LockRequestV1
  | UpdateSettingsRequestV1
  | ResetLockedRequestV1
  | ResetReadableRequestV1
  | GetStatusRequestV1;

export type DataWorkerRequestKindV1 = DataWorkerRequestV1["kind"];

// --- views ------------------------------------------------------------------

export type UnlockMethodV1 = "passphrase" | "recovery-code";

export interface LocalSettingsViewV1 {
  readonly idleTimeoutMinutes: IdleTimeoutMinutesV1;
}

/**
 * What the page may know while unlocked: counts, revisions, and the settings
 * the user chose. No app content exists in F01, and none of these fields can
 * hold one when it does.
 */
export interface UnlockedSessionViewV1 {
  readonly state: "unlocked";
  readonly unlockedVia: UnlockMethodV1;
  readonly settings: LocalSettingsViewV1;
  readonly catalogRevision: number;
  readonly transactionRevision: number;
  readonly appCount: number;
  readonly homeCount: number;
}

/**
 * The locked view is deliberately almost empty: `uninitialized` means no
 * bootstrap row exists, and `retryAfterMs` is present only while an unlock
 * attempt would be refused (CA-05).
 */
export interface LockedSessionViewV1 {
  readonly state: "locked" | "uninitialized";
  readonly retryAfterMs?: number;
}

export type SessionStatusViewV1 = LockedSessionViewV1 | UnlockedSessionViewV1;

/**
 * One app as a readable reset would list it. F01 has no producer for this
 * shape — the list is always empty — and the confirmation must say so rather
 * than implying an unknown number (FR-23).
 */
export interface ResetInventoryAppV1 {
  readonly appId: string;
  readonly displayName: string;
  readonly deviceOnlyChangeCount: number;
}

export interface ResetInventoryViewV1 {
  readonly apps: readonly ResetInventoryAppV1[];
  readonly appCount: number;
  readonly homeCount: number;
}

// --- responses --------------------------------------------------------------

export interface SetupResponseV1 {
  readonly kind: "setup";
  /** Shown once, at setup. It is never returned again except by CAP-06. */
  readonly recoveryCode: string;
  readonly session: UnlockedSessionViewV1;
}

export interface UnlockResponseV1 {
  readonly kind: "unlock";
  readonly session: UnlockedSessionViewV1;
}

export interface UnlockWithRecoveryCodeResponseV1 {
  readonly kind: "unlockWithRecoveryCode";
  readonly session: UnlockedSessionViewV1;
}

export interface ChangePassphraseResponseV1 {
  readonly kind: "changePassphrase";
  readonly session: UnlockedSessionViewV1;
}

export interface RevealRecoveryCodeResponseV1 {
  readonly kind: "revealRecoveryCode";
  readonly recoveryCode: string;
}

export interface LockResponseV1 {
  readonly kind: "lock";
  /** The ack the page waits for before it terminates the worker (CAP-03). */
  readonly status: LockedSessionViewV1;
}

export interface UpdateSettingsResponseV1 {
  readonly kind: "updateSettings";
  readonly settings: LocalSettingsViewV1;
  readonly session: UnlockedSessionViewV1;
}

export interface ResetLockedResponseV1 {
  readonly kind: "resetLocked";
  readonly purged: true;
}

export type ResetReadableResponseV1 =
  | {
      readonly kind: "resetReadable";
      readonly phase: "inventory";
      readonly inventory: ResetInventoryViewV1;
      readonly confirmToken: string;
    }
  | {
      readonly kind: "resetReadable";
      readonly phase: "purged";
      readonly purged: true;
    };

export interface GetStatusResponseV1 {
  readonly kind: "getStatus";
  readonly status: SessionStatusViewV1;
}

export type DataWorkerResponseV1 =
  | SetupResponseV1
  | UnlockResponseV1
  | UnlockWithRecoveryCodeResponseV1
  | ChangePassphraseResponseV1
  | RevealRecoveryCodeResponseV1
  | LockResponseV1
  | UpdateSettingsResponseV1
  | ResetLockedResponseV1
  | ResetReadableResponseV1
  | GetStatusResponseV1;

/** The response a given request kind produces; the client is typed by it. */
export type ResponseForV1<K extends DataWorkerRequestKindV1> = Extract<
  DataWorkerResponseV1,
  { readonly kind: K }
>;

// --- errors -----------------------------------------------------------------

/**
 * The closed set of facts an error may carry across the boundary. Each kind is
 * a category the UI can render; none of them can name a cell value, a key, a
 * file name, or a passphrase (CA-04).
 */
export const DATA_WORKER_ERROR_KINDS_V1 = Object.freeze([
  "protocol-version-mismatch",
  "unsupported-request",
  "malformed-request",
  "already-initialized",
  "not-initialized",
  "wrong-passphrase",
  "invalid-recovery-code",
  "rate-limited",
  "locked",
  "invalid-setting",
  "revision-conflict",
  "stale-confirmation",
  "integrity",
  "worker-terminated",
  "timeout",
  "internal",
] as const);

export type DataWorkerErrorKindV1 =
  (typeof DATA_WORKER_ERROR_KINDS_V1)[number];

export function isDataWorkerErrorKindV1(
  value: unknown,
): value is DataWorkerErrorKindV1 {
  return (DATA_WORKER_ERROR_KINDS_V1 as readonly unknown[]).includes(value);
}

export interface DataWorkerErrorV1 {
  readonly kind: DataWorkerErrorKindV1;
  /** Milliseconds the caller must wait before retrying; render, never derive. */
  readonly retryAfterMs?: number;
}

// --- envelopes --------------------------------------------------------------

export interface DataWorkerRequestMessageV1 {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly id: number;
  readonly request: DataWorkerRequestV1;
}

export type DataWorkerResultV1 =
  | { readonly ok: true; readonly response: DataWorkerResponseV1 }
  | { readonly ok: false; readonly error: DataWorkerErrorV1 };

export interface DataWorkerResponseMessageV1 {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly id: number;
  readonly result: DataWorkerResultV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasEnvelopeShape(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value["protocolVersion"] === PROTOCOL_VERSION &&
    Number.isSafeInteger(value["id"])
  );
}

/**
 * Structured clone delivers `unknown`, so both ends parse rather than trust.
 * The guards check the envelope and the discriminant only: a request whose
 * kind is known but whose payload is wrong is rejected by its handler with a
 * typed `malformed-request`, where the reason is known precisely.
 */
export function isDataWorkerRequestMessageV1(
  value: unknown,
): value is DataWorkerRequestMessageV1 {
  if (!hasEnvelopeShape(value)) {
    return false;
  }
  const request: unknown = value["request"];
  return isRecord(request) && typeof request["kind"] === "string";
}

export function isDataWorkerResponseMessageV1(
  value: unknown,
): value is DataWorkerResponseMessageV1 {
  if (!hasEnvelopeShape(value)) {
    return false;
  }
  const result: unknown = value["result"];
  if (!isRecord(result)) {
    return false;
  }
  if (result["ok"] === true) {
    const response: unknown = result["response"];
    return isRecord(response) && typeof response["kind"] === "string";
  }
  if (result["ok"] === false) {
    const error: unknown = result["error"];
    return isRecord(error) && isDataWorkerErrorKindV1(error["kind"]);
  }
  return false;
}
