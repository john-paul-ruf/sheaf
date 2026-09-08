/**
 * Envelope sealing and opening, as the contract staging depends on (M07).
 *
 * Staging encrypts fact chunks, source chunks, checkpoint pages, and its own
 * stage payload. It must do all of that without importing M08, because a
 * module that can reach libsodium can also reach key bytes — and because the
 * unit suites have to run the whole cancellation and promotion order without
 * a WASM bootstrap.
 *
 * **A key is a reference, never bytes.** {@link EnvelopeKeyRefV1} is declared
 * structurally, so M08's `SecretKeyHandle` satisfies it with no adapter and
 * nothing here can widen it back into a byte array. The one operation that
 * takes raw bytes is {@link EnvelopeCryptoPort.importKey}, which *consumes*
 * them: after it returns, the caller's array belongs to the key and must not
 * be read again. That is what lets a provisional import key be sealed under
 * the local root and then used as an app key, exactly as database.md
 * § Import staging requires, without a second copy of the bytes existing.
 */

import type { StorageId16 } from "../../domain/model/bytes.js";
import type {
  CompressionCodecV1,
  EnvelopeFrameV1,
  EnvelopePayloadKindV1,
  EnvelopeScopeV1,
} from "../../migrations/003_envelope_format_v1.js";

/** An opaque secret key. M08's `SecretKeyHandle` satisfies it structurally. */
export interface EnvelopeKeyRefV1 {
  readonly purpose: string;
}

export interface SealEnvelopeRequestV1 {
  readonly scope: EnvelopeScopeV1;
  readonly storageId: StorageId16;
  /** The transaction revision this frame will commit at (D12/AD-6). */
  readonly logicalRevision: bigint;
  readonly payloadKind: EnvelopePayloadKindV1;
  readonly payload: Uint8Array;
  readonly compression: CompressionCodecV1;
  readonly key: EnvelopeKeyRefV1;
}

export interface OpenedEnvelopeV1 {
  readonly payloadKind: EnvelopePayloadKindV1;
  readonly payload: Uint8Array;
}

export interface EnvelopeCryptoPort {
  seal(request: SealEnvelopeRequestV1): Promise<EnvelopeFrameV1>;
  /**
   * Authenticates under `scope` and refuses a payload that is not
   * `expectedPayloadKind` — the kind comes from the already-authenticated
   * parent reference, never from the ciphertext (database.md § Envelope
   * plaintext and AAD).
   */
  open(
    frame: EnvelopeFrameV1,
    scope: EnvelopeScopeV1,
    key: EnvelopeKeyRefV1,
    expectedPayloadKind: EnvelopePayloadKindV1,
  ): Promise<OpenedEnvelopeV1>;
  /** Takes ownership of `bytes`; the caller must not retain its reference. */
  importKey(bytes: Uint8Array): EnvelopeKeyRefV1;
  /** Zeroizes the key and makes every further use of the reference fail. */
  destroyKey(key: EnvelopeKeyRefV1): void;
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
}
