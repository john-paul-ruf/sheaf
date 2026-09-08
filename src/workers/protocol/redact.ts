/**
 * Error → wire mapping (CA-04).
 *
 * Nothing that reaches this module keeps its message. A thrown error may carry
 * a passphrase fragment, a storage id, a stack with file paths, or a provider
 * string; the wire form is a kind from the closed allowlist plus, where the
 * caller must render a wait, `retryAfterMs`. Anything unrecognised becomes
 * `internal` — fail closed, say nothing.
 */

import {
  CodecError,
  CryptoError,
  IntegrityError,
} from "../../domain/model/errors.js";
import {
  BootstrapExistsError,
  RevisionConflictError,
} from "../../persistence/envelope-store/errors.js";
import {
  isDataWorkerErrorKindV1,
  type DataWorkerErrorKindV1,
  type DataWorkerErrorV1,
} from "./messages.js";

/** A command's own typed refusal; the only error that keeps its kind. */
export class DataWorkerCommandError extends Error {
  readonly retryAfterMs: number | undefined;

  constructor(
    readonly kind: DataWorkerErrorKindV1,
    options: { readonly retryAfterMs?: number } = {},
  ) {
    // The message is developer-facing only and is never sent: `redactError`
    // builds the wire value from `kind`, not from this string.
    super(`data worker refused the request: ${kind}`);
    this.name = "DataWorkerCommandError";
    this.retryAfterMs = options.retryAfterMs;
  }
}

function retryAfter(value: number | undefined): { retryAfterMs?: number } {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? { retryAfterMs: value }
    : {};
}

/**
 * `IntegrityError` and `CodecError` both mean "the durable bytes do not say
 * what a reader requires": a mutated envelope and a catalog that fails its
 * constraints are the same recoverable, tamper-shaped condition to the UI.
 */
function kindOf(cause: unknown): DataWorkerErrorKindV1 {
  if (cause instanceof RevisionConflictError) {
    return "revision-conflict";
  }
  if (cause instanceof BootstrapExistsError) {
    return "already-initialized";
  }
  if (cause instanceof IntegrityError || cause instanceof CodecError) {
    return "integrity";
  }
  if (cause instanceof CryptoError) {
    return "internal";
  }
  return "internal";
}

export function redactError(cause: unknown): DataWorkerErrorV1 {
  if (cause instanceof DataWorkerCommandError) {
    const kind = isDataWorkerErrorKindV1(cause.kind) ? cause.kind : "internal";
    return { kind, ...retryAfter(cause.retryAfterMs) };
  }
  return { kind: kindOf(cause) };
}
