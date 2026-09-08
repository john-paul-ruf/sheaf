/**
 * Envelope inner frame, padding, AEAD additional data, and `SHF1` transport.
 *
 * Everything here is representation, never crypto: the same bytes are produced
 * by a writer before encryption and by a reader after authentication.
 *
 * **AAD (CA-02, D6).** The additional data is the canonical CBOR encoding of
 * `["sheaf", scope, storageId, codecVersion, cipherSuiteVersion,
 * logicalRevision]` with pinned element types — text, text, 16-byte byte
 * string, unsigned, unsigned, unsigned 64-bit. The scope is never stored on a
 * row: the bootstrap supplies the fixed `local.catalog` scope and every other
 * scope comes from an already-authenticated parent reference (database.md
 * § Envelope plaintext and AAD). `logicalRevision` is an opaque uint64 here;
 * the local store binds it to the committing transaction revision (D12), which
 * is that adapter's business, not this codec's.
 *
 * **Padding.** Ciphertext including its 16-byte tag is padded inside
 * encryption to the smallest fitting v1 bucket (database.md § Padding profile
 * v1), so the plaintext target is `bucket - ENVELOPE_TAG_BYTES` and padding is
 * trailing zero bytes after the inner frame. The frame's own declared lengths
 * are what a reader trusts; the padding is authenticated but carries nothing.
 *
 * **`SHF1` transport.** For provider and bundle transport the same fields are
 * serialized big-endian behind the four-byte magic. v1 layout, 62-byte header:
 *
 * | offset | bytes | field |
 * |-------:|------:|-------|
 * | 0      | 4     | `SHF1` magic |
 * | 4      | 2     | envelope format version |
 * | 6      | 2     | codec version |
 * | 8      | 2     | cipher suite version |
 * | 10     | 16    | storage ID (raw bytes) |
 * | 26     | 8     | logical revision (uint64) |
 * | 34     | 4     | padded byte length |
 * | 38     | 24    | nonce |
 * | 62     | …     | ciphertext (exactly the padded byte length) |
 */

import { CodecError } from "../../domain/model/errors.js";
import { asStorageId16, type StorageId16 } from "../../domain/model/bytes.js";
import {
  CIPHER_SUITE_VERSION,
  CODEC_VERSION,
  ENVELOPE_FORMAT_VERSION,
  ENVELOPE_MAGIC,
  ENVELOPE_NONCE_BYTES,
  ENVELOPE_PAYLOAD_KINDS_V1,
  ENVELOPE_SCOPES_V1,
  ENVELOPE_TAG_BYTES,
  PADDED_ENVELOPE_BYTES_V1,
  STORAGE_ID_BYTES,
  type CompressionCodecV1,
  type EnvelopeFrameV1,
  type EnvelopePayloadKindV1,
  type EnvelopePlaintextV1,
  type EnvelopeScopeV1,
} from "../../migrations/003_envelope_format_v1.js";
import {
  DEFAULT_DECODE_BUDGET,
  decodeCanonicalPrefix,
  encodeCanonical,
  type CborKey,
  type CborValue,
  type DecodeBudget,
  type DecodedValue,
} from "./canonical-cbor.js";

const AAD_PRODUCT_ID = "sheaf";
const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const TRANSPORT_HEADER_BYTES = 62;
const COMPRESSION_CODECS_V1: readonly CompressionCodecV1[] = [
  "none",
  "deflate-raw-v1",
];

export interface EnvelopeAadInput {
  readonly scope: EnvelopeScopeV1;
  readonly storageId: StorageId16;
  readonly codecVersion: number;
  readonly cipherSuiteVersion: number;
  readonly logicalRevision: bigint;
}

export function isEnvelopeScopeV1(value: string): value is EnvelopeScopeV1 {
  return (ENVELOPE_SCOPES_V1 as readonly string[]).includes(value);
}

export function isEnvelopePayloadKindV1(
  value: string,
): value is EnvelopePayloadKindV1 {
  return (ENVELOPE_PAYLOAD_KINDS_V1 as readonly string[]).includes(value);
}

/** The canonical CBOR 6-tuple bound into every envelope's AEAD (CA-02). */
export function buildEnvelopeAad(input: EnvelopeAadInput): Uint8Array {
  if (!isEnvelopeScopeV1(input.scope)) {
    throw new CodecError("scope is not a v1 envelope scope");
  }
  if (input.storageId.byteLength !== STORAGE_ID_BYTES) {
    throw new CodecError("storage id must be 16 bytes");
  }
  if (input.logicalRevision < 0n || input.logicalRevision > UINT64_MAX) {
    throw new CodecError("logical revision is outside the uint64 range");
  }
  if (
    !Number.isSafeInteger(input.codecVersion) ||
    input.codecVersion < 0 ||
    !Number.isSafeInteger(input.cipherSuiteVersion) ||
    input.cipherSuiteVersion < 0
  ) {
    throw new CodecError("version elements must be unsigned integers");
  }

  return encodeCanonical([
    AAD_PRODUCT_ID,
    input.scope,
    // A copy: the tuple must not alias a caller buffer that may be wiped.
    new Uint8Array(input.storageId),
    BigInt(input.codecVersion),
    BigInt(input.cipherSuiteVersion),
    input.logicalRevision,
  ]);
}

/** Smallest v1 bucket whose ciphertext, tag included, fits this plaintext. */
export function selectPaddedBucket(plaintextByteLength: number): number {
  const required = plaintextByteLength + ENVELOPE_TAG_BYTES;
  const bucket = PADDED_ENVELOPE_BYTES_V1.find((size) => size >= required);
  if (bucket === undefined) {
    throw new CodecError("payload exceeds the largest v1 padding bucket");
  }
  return bucket;
}

export function isPaddedBucket(paddedBytes: number): boolean {
  return (PADDED_ENVELOPE_BYTES_V1 as readonly number[]).includes(paddedBytes);
}

export function buildEnvelopePlaintext(frame: EnvelopePlaintextV1): Uint8Array {
  if (frame.innerVersion !== 1) {
    throw new CodecError("inner frame version is not 1");
  }
  if (!isEnvelopePayloadKindV1(frame.payloadKind)) {
    throw new CodecError("payload kind is not a v1 payload kind");
  }
  if (!COMPRESSION_CODECS_V1.includes(frame.compression)) {
    throw new CodecError("compression codec is not a v1 codec");
  }
  if (frame.encodedPayloadByteLength !== frame.payload.byteLength) {
    throw new CodecError("stored payload length differs from the declared length");
  }
  if (
    !Number.isSafeInteger(frame.decodedPayloadByteLength) ||
    frame.decodedPayloadByteLength < 0
  ) {
    throw new CodecError("declared decoded length is not a safe length");
  }

  return encodeCanonical(
    new Map<CborKey, CborValue>([
      ["innerVersion", BigInt(frame.innerVersion)],
      ["payloadKind", frame.payloadKind],
      ["compression", frame.compression],
      ["encodedPayloadByteLength", BigInt(frame.encodedPayloadByteLength)],
      ["decodedPayloadByteLength", BigInt(frame.decodedPayloadByteLength)],
      ["payload", frame.payload],
    ]),
  );
}

/** Zero-pads an inner frame to the plaintext size of its bucket. */
export function padToBucket(plaintext: Uint8Array, paddedBytes: number): Uint8Array {
  if (!isPaddedBucket(paddedBytes)) {
    throw new CodecError("padded length is not a v1 padding bucket");
  }
  const target = paddedBytes - ENVELOPE_TAG_BYTES;
  if (plaintext.byteLength > target) {
    throw new CodecError("inner frame does not fit its padding bucket");
  }
  const padded = new Uint8Array(target);
  padded.set(plaintext);
  return padded;
}

function readSafeLength(value: DecodedValue | undefined, reason: string): number {
  if (typeof value !== "bigint" || value < 0n) {
    throw new CodecError(reason);
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new CodecError(reason);
  }
  return length;
}

/**
 * Parses an authenticated, padded inner frame. Trailing padding must be zero
 * bytes: a reader that accepted arbitrary trailing content would accept two
 * distinct byte strings for one envelope.
 */
export function parseEnvelopePlaintext(
  padded: Uint8Array,
  budget: DecodeBudget = DEFAULT_DECODE_BUDGET,
): EnvelopePlaintextV1 {
  const { value, byteLength } = decodeCanonicalPrefix(padded, budget);
  for (let index = byteLength; index < padded.byteLength; index += 1) {
    if (padded[index] !== 0) {
      throw new CodecError("inner frame padding is not zero bytes");
    }
  }

  if (!(value instanceof Map)) {
    throw new CodecError("inner frame is not a map");
  }
  const frame = value as ReadonlyMap<string | bigint, DecodedValue>;
  if (frame.size !== 6) {
    throw new CodecError("inner frame does not have exactly six fields");
  }
  if (frame.get("innerVersion") !== 1n) {
    throw new CodecError("inner frame version is not 1");
  }

  const payloadKind = frame.get("payloadKind");
  if (typeof payloadKind !== "string" || !isEnvelopePayloadKindV1(payloadKind)) {
    throw new CodecError("payload kind is not a v1 payload kind");
  }

  const compression = frame.get("compression");
  if (
    typeof compression !== "string" ||
    !COMPRESSION_CODECS_V1.includes(compression as CompressionCodecV1)
  ) {
    throw new CodecError("compression codec is not a v1 codec");
  }

  const payload = frame.get("payload");
  if (!(payload instanceof Uint8Array)) {
    throw new CodecError("inner frame payload is not a byte string");
  }

  const encodedPayloadByteLength = readSafeLength(
    frame.get("encodedPayloadByteLength"),
    "stored payload length is not a safe length",
  );
  const decodedPayloadByteLength = readSafeLength(
    frame.get("decodedPayloadByteLength"),
    "declared decoded length is not a safe length",
  );
  if (encodedPayloadByteLength !== payload.byteLength) {
    throw new CodecError("stored payload length differs from the declared length");
  }

  return {
    innerVersion: 1,
    payloadKind,
    compression: compression as CompressionCodecV1,
    encodedPayloadByteLength,
    decodedPayloadByteLength,
    payload,
  };
}

export function serializeEnvelopeTransport(frame: EnvelopeFrameV1): Uint8Array {
  if (frame.storageId.byteLength !== STORAGE_ID_BYTES) {
    throw new CodecError("storage id must be 16 bytes");
  }
  if (frame.nonce.byteLength !== ENVELOPE_NONCE_BYTES) {
    throw new CodecError("nonce must be 24 bytes");
  }
  if (!isPaddedBucket(frame.paddedBytes)) {
    throw new CodecError("padded length is not a v1 padding bucket");
  }
  if (frame.ciphertext.byteLength !== frame.paddedBytes) {
    throw new CodecError("ciphertext length differs from the padded length");
  }
  if (frame.logicalRevision < 0n || frame.logicalRevision > UINT64_MAX) {
    throw new CodecError("logical revision is outside the uint64 range");
  }

  const bytes = new Uint8Array(TRANSPORT_HEADER_BYTES + frame.ciphertext.byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < ENVELOPE_MAGIC.length; index += 1) {
    bytes[index] = ENVELOPE_MAGIC.charCodeAt(index);
  }
  view.setUint16(4, frame.envelopeFormatVersion);
  view.setUint16(6, frame.codecVersion);
  view.setUint16(8, frame.cipherSuiteVersion);
  bytes.set(frame.storageId, 10);
  view.setBigUint64(26, frame.logicalRevision);
  view.setUint32(34, frame.paddedBytes);
  bytes.set(frame.nonce, 38);
  bytes.set(frame.ciphertext, TRANSPORT_HEADER_BYTES);
  return bytes;
}

export function parseEnvelopeTransport(bytes: Uint8Array): EnvelopeFrameV1 {
  if (bytes.byteLength < TRANSPORT_HEADER_BYTES) {
    throw new CodecError("transport envelope is shorter than its header");
  }
  for (let index = 0; index < ENVELOPE_MAGIC.length; index += 1) {
    if (bytes[index] !== ENVELOPE_MAGIC.charCodeAt(index)) {
      throw new CodecError("transport envelope has no SHF1 magic");
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const envelopeFormatVersion = view.getUint16(4);
  const codecVersion = view.getUint16(6);
  const cipherSuiteVersion = view.getUint16(8);
  if (
    envelopeFormatVersion !== ENVELOPE_FORMAT_VERSION ||
    codecVersion !== CODEC_VERSION ||
    cipherSuiteVersion !== CIPHER_SUITE_VERSION
  ) {
    throw new CodecError("transport envelope declares unsupported versions");
  }

  const paddedBytes = view.getUint32(34);
  if (!isPaddedBucket(paddedBytes)) {
    throw new CodecError("padded length is not a v1 padding bucket");
  }
  if (bytes.byteLength !== TRANSPORT_HEADER_BYTES + paddedBytes) {
    throw new CodecError("transport envelope length differs from its header");
  }

  return {
    envelopeFormatVersion: 1,
    codecVersion: 1,
    cipherSuiteVersion: 1,
    storageId: asStorageId16(bytes.slice(10, 10 + STORAGE_ID_BYTES)),
    logicalRevision: view.getBigUint64(26),
    paddedBytes,
    nonce: bytes.slice(38, 38 + ENVELOPE_NONCE_BYTES),
    ciphertext: bytes.slice(TRANSPORT_HEADER_BYTES),
  };
}
