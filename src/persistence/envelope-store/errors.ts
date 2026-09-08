/**
 * Typed local-store errors.
 *
 * Dexie is an implementation detail of this module (architecture § Dependency
 * flow: provider types stop inside their adapter), so a `ConstraintError` or a
 * failed optimistic check is translated here before it can reach a worker or
 * the application layer. Reasons are fixed phrases: a store error never names
 * a storage ID, a key, or any payload content.
 */

export type LocalStoreErrorKind =
  | "revision-conflict"
  | "bootstrap-exists"
  | "envelope-exists";

export abstract class LocalStoreError extends Error {
  abstract readonly kind: LocalStoreErrorKind;

  protected constructor(reason: string) {
    super(reason);
    this.name = new.target.name;
  }
}

/**
 * The caller's expected transaction revision or writer epoch is stale, or the
 * store has no bootstrap row at all — the actuals are then `null`.
 */
export class RevisionConflictError extends LocalStoreError {
  readonly kind = "revision-conflict";

  constructor(
    readonly expectedRevision: number,
    readonly expectedWriterEpoch: number,
    readonly actualRevision: number | null,
    readonly actualWriterEpoch: number | null,
  ) {
    super("local store moved on since the caller read the bootstrap row");
  }
}

/** A second bootstrap row was attempted: the store is already initialised. */
export class BootstrapExistsError extends LocalStoreError {
  readonly kind = "bootstrap-exists";

  constructor() {
    super("local store already has a bootstrap row");
  }
}

/** A random storage ID collided; the whole transaction aborts (add, not put). */
export class EnvelopeExistsError extends LocalStoreError {
  readonly kind = "envelope-exists";

  constructor() {
    super("envelope storage id already exists");
  }
}

const DUPLICATE_KEY_ERROR = "ConstraintError";

export function isDuplicateKeyFailure(cause: unknown): boolean {
  return cause instanceof Error && cause.name === DUPLICATE_KEY_ERROR;
}
