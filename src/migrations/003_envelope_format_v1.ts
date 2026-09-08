/** Baseline encrypted-envelope wire contract. */

export const ENVELOPE_FORMAT_VERSION = 1;
export const CODEC_VERSION = 1;
export const CIPHER_SUITE_VERSION = 1;
export const PADDING_PROFILE_VERSION = 1;
export const ENVELOPE_MAGIC = "SHF1";
export const ENVELOPE_NONCE_BYTES = 24;
export const ENVELOPE_TAG_BYTES = 16;
export const STORAGE_ID_BYTES = 16;

/** Ciphertext sizes, including the authentication tag and encrypted padding. */
export const PADDED_ENVELOPE_BYTES_V1 = Object.freeze([
  4_096,
  16_384,
  65_536,
  262_144,
  1_114_112,
  4_259_840,
  16_777_216,
] as const);

export const ENVELOPE_SCOPES_V1 = Object.freeze([
  "local.catalog",
  "local.home",
  "local.workflow",
  "local.cleanup",
  "local.migration",
  "app.head",
  "app.events",
  "app.checkpoint",
  "app.records",
  "app.baselines",
  "app.conflicts",
  "app.audit",
  "app.source-manifest",
  "app.source-chunk",
  "app.snapshot-manifest",
  "app.snapshot-chunk",
  "app.import-stage",
  "vault.index",
  "vault.app-manifest",
] as const);

export type EnvelopeScopeV1 = (typeof ENVELOPE_SCOPES_V1)[number];

export const ENVELOPE_PAYLOAD_KINDS_V1 = Object.freeze([
  "local.catalog",
  "local.home-state",
  "local.workflow-resume",
  "local.cleanup-ticket",
  "local.migration-journal",
  "app.head",
  "app.event-segment",
  "app.checkpoint-manifest",
  "app.record-page",
  "app.baseline-page",
  "app.conflict-page",
  "app.audit-page",
  "app.source-manifest",
  "app.source-chunk",
  "app.snapshot-manifest",
  "app.snapshot-chunk",
  "app.import-stage",
  "vault.index",
  "vault.app-manifest",
] as const);

export type EnvelopePayloadKindV1 =
  (typeof ENVELOPE_PAYLOAD_KINDS_V1)[number];
export type CompressionCodecV1 = "none" | "deflate-raw-v1";

/** Authenticated inner frame; encoded as canonical CBOR before padding. */
export interface EnvelopePlaintextV1 {
  readonly innerVersion: 1;
  readonly payloadKind: EnvelopePayloadKindV1;
  readonly compression: CompressionCodecV1;
  readonly encodedPayloadByteLength: number;
  readonly decodedPayloadByteLength: number;
  readonly payload: Uint8Array;
}

/**
 * Scope is deliberately absent. It is supplied by the already-authenticated
 * parent reference and is included in AEAD additional data.
 */
export interface EnvelopeFrameV1 {
  readonly envelopeFormatVersion: 1;
  readonly codecVersion: 1;
  readonly cipherSuiteVersion: 1;
  readonly storageId: Uint8Array;
  readonly logicalRevision: bigint;
  readonly paddedBytes: number;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

export interface EnvelopeReferenceV1 {
  readonly storageId: Uint8Array;
  readonly scope: EnvelopeScopeV1;
  readonly logicalRevision: bigint;
  readonly envelopeFormatVersion: 1;
  readonly codecVersion: 1;
  readonly cipherSuiteVersion: 1;
  readonly paddedBytes: number;
  readonly ciphertextSha256: Uint8Array;
}

/** V1 has no predecessor; this rejects unknown future or malformed frames. */
export function migrateEnvelope(frame: EnvelopeFrameV1): EnvelopeFrameV1 {
  if (frame.envelopeFormatVersion !== ENVELOPE_FORMAT_VERSION) {
    throw new Error("Unsupported envelope format version");
  }
  if (
    frame.codecVersion !== CODEC_VERSION ||
    frame.cipherSuiteVersion !== CIPHER_SUITE_VERSION
  ) {
    throw new Error("Unsupported envelope codec or cipher suite");
  }
  if (frame.logicalRevision < 1n) {
    throw new Error("Invalid envelope logical revision");
  }
  if (frame.storageId.byteLength !== STORAGE_ID_BYTES) {
    throw new Error("Invalid envelope storage identifier");
  }
  if (frame.nonce.byteLength !== ENVELOPE_NONCE_BYTES) {
    throw new Error("Invalid envelope nonce");
  }
  if (
    !PADDED_ENVELOPE_BYTES_V1.includes(
      frame.paddedBytes as (typeof PADDED_ENVELOPE_BYTES_V1)[number],
    ) ||
    frame.ciphertext.byteLength !== frame.paddedBytes
  ) {
    throw new Error("Invalid envelope padding bucket");
  }
  return frame;
}
