/**
 * The original file, kept exactly as it arrived (M22; D21).
 *
 * Sheaf promises that an accepted import can be re-exported and re-compared
 * against its source, so the source bytes are retained — chunked, encrypted
 * under the app key, and named by a manifest. Chunks carry at most
 * {@link SOURCE_CHUNK_BYTES} decoded bytes each (database.md § Checkpoint and
 * page boundaries), which is what keeps both the write and any later read
 * bounded however large the file was.
 *
 * **The digest is a digest of digests.** The whole file is never in memory
 * (FR-3) and the platform offers no incremental SHA-256, so the source's
 * identity is the hash of its chunk hashes in order — computable one bounded
 * chunk at a time, stable, and verifiable without ever holding the file. It is
 * deliberately *not* the plain SHA-256 of the file: this module names it
 * `chunkedSha256` so nothing can mistake one for the other.
 */

import type { EnvelopeCryptoPort } from "../../application/ports/envelope-crypto.js";
import {
  cborMap,
  count,
  bytesOfLength,
  exactKeys,
  field,
  list,
  asMap,
  text,
} from "../staging/proposal-codec.js";
import {
  decodeCanonical,
  encodeCanonical,
  type CborValue,
  type DecodedValue,
} from "../../persistence/codecs/canonical-cbor.js";
import { CodecError } from "../../domain/model/errors.js";

/** database.md: "a source or normalized snapshot chunk carries at most 1 MiB". */
export const SOURCE_CHUNK_BYTES = 1_048_576;

const SHA256_BYTES = 32;
const MANIFEST_VERSION = 1;

export interface ManifestChunkRefV1 {
  readonly storageId: string;
  readonly sequence: number;
  readonly decodedByteLength: number;
  readonly sha256: Uint8Array;
}

/**
 * `SourceManifestV1` (database.md): the original file's identity, its ordered
 * encrypted chunk refs, and their digest.
 */
export interface SourceManifestV1 {
  readonly manifestVersion: typeof MANIFEST_VERSION;
  readonly fileName: string;
  readonly byteLength: number;
  /** SHA-256 over the concatenated chunk digests, in order. See the header. */
  readonly chunkedSha256: Uint8Array;
  readonly chunks: readonly ManifestChunkRefV1[];
}

export const encodeChunkRef = (chunk: ManifestChunkRefV1): CborValue =>
  cborMap([
    ["storageId", chunk.storageId],
    ["sequence", chunk.sequence],
    ["decodedByteLength", chunk.decodedByteLength],
    ["sha256", chunk.sha256],
  ]);

export const decodeChunkRef = (value: DecodedValue): ManifestChunkRefV1 => {
  const map = exactKeys(
    asMap(value, "a chunk ref"),
    ["storageId", "sequence", "decodedByteLength", "sha256"],
    "a chunk ref",
  );
  return {
    storageId: text(field(map, "storageId"), "a chunk storage id"),
    sequence: count(field(map, "sequence"), "a chunk sequence"),
    decodedByteLength: count(field(map, "decodedByteLength"), "a chunk length"),
    sha256: bytesOfLength(field(map, "sha256"), SHA256_BYTES, "a chunk digest"),
  };
};

function assertOrdered(chunks: readonly ManifestChunkRefV1[]): void {
  chunks.forEach((chunk, index) => {
    if (chunk.sequence !== index) {
      throw new CodecError("manifest chunks are not contiguous from zero");
    }
    if (chunk.decodedByteLength > SOURCE_CHUNK_BYTES) {
      throw new CodecError("a manifest chunk exceeds the 1 MiB decoded cap");
    }
  });
}

export function encodeSourceManifest(manifest: SourceManifestV1): Uint8Array {
  assertOrdered(manifest.chunks);
  return encodeCanonical(
    cborMap([
      ["manifestVersion", manifest.manifestVersion],
      ["fileName", manifest.fileName],
      ["byteLength", manifest.byteLength],
      ["chunkedSha256", manifest.chunkedSha256],
      ["chunks", manifest.chunks.map(encodeChunkRef)],
    ]),
  );
}

export function decodeSourceManifest(payload: Uint8Array): SourceManifestV1 {
  const map = exactKeys(
    asMap(decodeCanonical(payload), "a source manifest"),
    ["manifestVersion", "fileName", "byteLength", "chunkedSha256", "chunks"],
    "a source manifest",
  );
  if (count(field(map, "manifestVersion"), "a manifest version") !== MANIFEST_VERSION) {
    throw new CodecError("source manifest declares an unsupported version");
  }
  const chunks = list(field(map, "chunks"), "manifest chunks").map(decodeChunkRef);
  assertOrdered(chunks);

  return {
    manifestVersion: MANIFEST_VERSION,
    fileName: text(field(map, "fileName"), "a file name"),
    byteLength: count(field(map, "byteLength"), "a source length"),
    chunkedSha256: bytesOfLength(
      field(map, "chunkedSha256"),
      SHA256_BYTES,
      "a source digest",
    ),
    chunks,
  };
}

/**
 * Folds ordered chunk digests into the one digest that names the source.
 * Order matters, so two files with the same chunks in a different order have
 * different identities.
 */
export async function chunkedSourceDigest(
  crypto: EnvelopeCryptoPort,
  chunks: readonly ManifestChunkRefV1[],
): Promise<Uint8Array> {
  const joined = new Uint8Array(chunks.length * SHA256_BYTES);
  chunks.forEach((chunk, index) => {
    joined.set(chunk.sha256, index * SHA256_BYTES);
  });
  return crypto.sha256(joined);
}
