/** Bound at construction to one authenticated account and vault location. */
export interface DurableHomePort {
  readHead(signal: AbortSignal): Promise<HeadObjectV1 | null>;
  readObject(id: string, signal: AbortSignal): Promise<Uint8Array | null>;
  /** Create-only; an existing ID is accepted only for byte-identical content. */
  createObject(id: string, ciphertext: Uint8Array, signal: AbortSignal): Promise<void>;
  /** null means create-if-absent. A stale revision fails without changing bytes. */
  compareAndSwapHead(expectedRevision: string | null, bytes: Uint8Array, signal: AbortSignal): Promise<HeadReceiptV1>;
}
export interface HeadObjectV1 {
  readonly bytes: Uint8Array;
  readonly revision: string;
}
export interface HeadReceiptV1 {
  readonly candidateSha256: Uint8Array;
  /** Opaque provider revision, never an app sequence or generation. */
  readonly revision: string;
}
