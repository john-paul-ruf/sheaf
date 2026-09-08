/**
 * Envelope AEAD: XChaCha20-Poly1305 with a fresh 192-bit nonce per envelope
 * and the CA-02 additional data (architecture § Cipher profile).
 *
 * Encryption compresses, frames, pads to the smallest fitting v1 bucket, and
 * seals; decryption authenticates first and only then reads declared lengths,
 * so no length taken from ciphertext is trusted before the tag verifies. Every
 * parse runs migration 003's `migrateEnvelope` validator, which owns the wire
 * contract this module implements.
 */

import { IntegrityError, CryptoError } from "../domain/model/errors.js";
import type { StorageId16 } from "../domain/model/bytes.js";
import {
  CIPHER_SUITE_VERSION,
  CODEC_VERSION,
  ENVELOPE_FORMAT_VERSION,
  ENVELOPE_NONCE_BYTES,
  migrateEnvelope,
  type CompressionCodecV1,
  type EnvelopeFrameV1,
  type EnvelopePayloadKindV1,
  type EnvelopeScopeV1,
} from "../migrations/003_envelope_format_v1.js";
import {
  buildEnvelopeAad,
  buildEnvelopePlaintext,
  padToBucket,
  parseEnvelopePlaintext,
  selectPaddedBucket,
} from "../persistence/codecs/envelope-frame.js";
import {
  compressBounded,
  decompressBounded,
} from "../persistence/codecs/compression.js";
import { readKeyBytes, type SecretKeyHandle } from "./keys.js";
import { loadSodium } from "./sodium.js";

export interface EncryptEnvelopeInput {
  readonly scope: EnvelopeScopeV1;
  readonly storageId: StorageId16;
  readonly logicalRevision: bigint;
  readonly payloadKind: EnvelopePayloadKindV1;
  readonly payload: Uint8Array;
  readonly compression: CompressionCodecV1;
  readonly key: SecretKeyHandle;
  /**
   * Deterministic fixtures only (the CA-02 known-answer vector). Production
   * callers omit it so the nonce is drawn fresh from the CSPRNG.
   */
  readonly nonce?: Uint8Array;
}

export interface DecryptedEnvelopeV1 {
  readonly payloadKind: EnvelopePayloadKindV1;
  readonly compression: CompressionCodecV1;
  readonly payload: Uint8Array;
}

export async function encryptEnvelope(
  input: EncryptEnvelopeInput,
): Promise<EnvelopeFrameV1> {
  const sodium = await loadSodium();

  if (input.nonce !== undefined && input.nonce.byteLength !== ENVELOPE_NONCE_BYTES) {
    throw new CryptoError("nonce must be 24 bytes");
  }
  const nonce =
    input.nonce ?? sodium.randombytes_buf(ENVELOPE_NONCE_BYTES);

  const encodedPayload = await compressBounded(input.payload, input.compression);
  const plaintext = buildEnvelopePlaintext({
    innerVersion: 1,
    payloadKind: input.payloadKind,
    compression: input.compression,
    encodedPayloadByteLength: encodedPayload.byteLength,
    decodedPayloadByteLength: input.payload.byteLength,
    payload: encodedPayload,
  });

  const paddedBytes = selectPaddedBucket(plaintext.byteLength);
  const additionalData = buildEnvelopeAad({
    scope: input.scope,
    storageId: input.storageId,
    codecVersion: CODEC_VERSION,
    cipherSuiteVersion: CIPHER_SUITE_VERSION,
    logicalRevision: input.logicalRevision,
  });

  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    padToBucket(plaintext, paddedBytes),
    additionalData,
    null,
    nonce,
    readKeyBytes(input.key),
  );

  return migrateEnvelope({
    envelopeFormatVersion: ENVELOPE_FORMAT_VERSION,
    codecVersion: CODEC_VERSION,
    cipherSuiteVersion: CIPHER_SUITE_VERSION,
    storageId: input.storageId,
    logicalRevision: input.logicalRevision,
    paddedBytes,
    nonce,
    ciphertext,
  });
}

/**
 * Authenticates `frame` under `scope` and returns its inner payload.
 * `expectedPayloadKind`, when supplied by an authenticated parent reference,
 * must equal the kind inside the ciphertext (database.md § Envelope plaintext
 * and AAD).
 */
export async function decryptEnvelope(
  frame: EnvelopeFrameV1,
  scope: EnvelopeScopeV1,
  key: SecretKeyHandle,
  expectedPayloadKind?: EnvelopePayloadKindV1,
): Promise<DecryptedEnvelopeV1> {
  const sodium = await loadSodium();
  const validated = migrateEnvelope(frame);

  const additionalData = buildEnvelopeAad({
    scope,
    storageId: validated.storageId as StorageId16,
    codecVersion: validated.codecVersion,
    cipherSuiteVersion: validated.cipherSuiteVersion,
    logicalRevision: validated.logicalRevision,
  });

  let padded: Uint8Array;
  try {
    padded = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      validated.ciphertext,
      additionalData,
      validated.nonce,
      readKeyBytes(key),
    );
  } catch {
    throw new IntegrityError("envelope failed authentication");
  }

  const plaintext = parseEnvelopePlaintext(padded);
  if (
    expectedPayloadKind !== undefined &&
    plaintext.payloadKind !== expectedPayloadKind
  ) {
    throw new IntegrityError("envelope payload kind is not the expected kind");
  }

  return {
    payloadKind: plaintext.payloadKind,
    compression: plaintext.compression,
    payload: await decompressBounded(
      plaintext.payload,
      plaintext.compression,
      plaintext.decodedPayloadByteLength,
    ),
  };
}
