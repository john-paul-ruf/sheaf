/**
 * Randomness as a dependency (F01 port subset, D9).
 *
 * Implementations must be a cryptographically secure RNG; every identifier,
 * salt, and key that reaches durable storage comes from here.
 */
export interface EntropyPort {
  /** Exactly `byteLength` unpredictable bytes. */
  randomBytes(byteLength: number): Uint8Array;
}
