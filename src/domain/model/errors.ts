/**
 * Typed domain errors.
 *
 * Messages are redaction-safe by construction: every reason is a fixed phrase
 * authored here or at the throw site. Callers never interpolate user data, key
 * material, passphrases, or decoded payload content into a reason — sizes,
 * offsets, versions, and format names are the only permitted specifics
 * (FORGE-CONFIG § Conventions, Logging).
 */

export type DomainErrorKind = "codec" | "crypto" | "integrity";

export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;

  protected constructor(reason: string) {
    super(reason);
    this.name = new.target.name;
  }
}

/** A value violated the canonical wire format, a declared length, or a bound. */
export class CodecError extends DomainError {
  readonly kind = "codec";

  constructor(reason: string) {
    super(reason);
  }
}

/** A key, descriptor, or cipher parameter was unusable or out of contract. */
export class CryptoError extends DomainError {
  readonly kind = "crypto";

  constructor(reason: string) {
    super(reason);
  }
}

/** Authentication failed or a durable invariant was violated: tamper-shaped. */
export class IntegrityError extends DomainError {
  readonly kind = "integrity";

  constructor(reason: string) {
    super(reason);
  }
}

export type AnyDomainError = CodecError | CryptoError | IntegrityError;

export function isDomainError(value: unknown): value is AnyDomainError {
  return value instanceof DomainError;
}
