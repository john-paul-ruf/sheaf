/**
 * The `EnvelopeFrameV1` ↔ `LocalEnvelopeRowV1` adapter (CA-02, D12/AD-6).
 *
 * S02 owns the frame and its AAD; migration 001 owns the row. Their shapes
 * differ — raw bytes versus canonical base64url text, `bigint` versus safe
 * integer, `Uint8Array` versus `ArrayBuffer` — and this file is the only place
 * in the module where that translation happens. No other file constructs a row
 * literal.
 *
 * **Pinned identity.** `frame.logicalRevision ≡ row.revision`: the transaction
 * revision that first commits a row *is* the logical revision bound into its
 * AAD. A writer may not pick a different number, and a reader rebuilds the AAD
 * from `row.revision` alone — which is why a stored row can be authenticated
 * without any side table. Divergence would be a schema re-entry, not a local
 * change.
 *
 * **Scope is not here.** It is never stored and never returned; callers supply
 * it from an already-authenticated parent (database.md § Envelope plaintext and
 * AAD).
 */

import { CodecError } from "../../domain/model/errors.js";
import {
  asStorageId16,
  decodeStorageId16,
  encodeStorageId16,
} from "../../domain/model/bytes.js";
import {
  migrateEnvelope,
  type EnvelopeFrameV1,
} from "../../migrations/003_envelope_format_v1.js";
import type { LocalEnvelopeRowV1 } from "../../migrations/001_local_store_v1.js";
import { CURRENT_FORMAT_VERSIONS } from "../../migrations/index.js";

function assertCommittableRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new CodecError("envelope revision must be a safe integer of at least 1");
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function toBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer.slice(0));
}

/**
 * Maps a sealed frame onto the row the committing transaction will `add`.
 * `revision` is the revision that transaction commits at; a frame sealed
 * against any other logical revision is refused rather than silently
 * re-labelled, because re-labelling would store a row that can never
 * authenticate again.
 */
export function frameToRow(
  frame: EnvelopeFrameV1,
  revision: number,
): LocalEnvelopeRowV1 {
  assertCommittableRevision(revision);
  const validated = migrateEnvelope(frame);

  if (validated.logicalRevision !== BigInt(revision)) {
    throw new CodecError(
      "envelope logical revision must equal the committing transaction revision",
    );
  }

  return {
    storageId: encodeStorageId16(asStorageId16(validated.storageId)),
    revision,
    envelopeFormatVersion: validated.envelopeFormatVersion,
    codecVersion: validated.codecVersion,
    cipherSuiteVersion: validated.cipherSuiteVersion,
    paddedBytes: validated.paddedBytes,
    nonce: toArrayBuffer(validated.nonce),
    ciphertext: toArrayBuffer(validated.ciphertext),
  };
}

/**
 * Rebuilds the frame a reader authenticates. The clear version columns are the
 * decoder gate (database.md § `envelopes`): a row written by a newer build is
 * refused before any allocation, and only the canonical spelling of a storage
 * ID is accepted, so two texts can never name one row.
 */
export function rowToFrame(row: LocalEnvelopeRowV1): EnvelopeFrameV1 {
  if (
    row.envelopeFormatVersion !== CURRENT_FORMAT_VERSIONS.envelope ||
    row.codecVersion !== CURRENT_FORMAT_VERSIONS.codec ||
    row.cipherSuiteVersion !== CURRENT_FORMAT_VERSIONS.cipherSuite
  ) {
    throw new CodecError("envelope row declares unsupported versions");
  }
  assertCommittableRevision(row.revision);

  return migrateEnvelope({
    envelopeFormatVersion: row.envelopeFormatVersion,
    codecVersion: row.codecVersion,
    cipherSuiteVersion: row.cipherSuiteVersion,
    storageId: decodeStorageId16(row.storageId),
    logicalRevision: BigInt(row.revision),
    paddedBytes: row.paddedBytes,
    nonce: toBytes(row.nonce),
    ciphertext: toBytes(row.ciphertext),
  });
}
