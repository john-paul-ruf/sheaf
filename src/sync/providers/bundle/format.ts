import { constantTimeEquals, decodeStorageId16, encodeBase64Url } from "../../../domain/model/bytes.js";
import { IntegrityError } from "../../../domain/model/errors.js";
import { sha256, sha256Chunks } from "../../../crypto/hash.js";
import { CURRENT_FORMAT_VERSIONS } from "../../../migrations/index.js";
import type { BundleDirectoryEntryV1 } from "../../../migrations/006_vault_format_v1.js";
import { encodeCanonical } from "../../../persistence/codecs/canonical-cbor.js";
import { parseEnvelopeTransport } from "../../../persistence/codecs/envelope-frame.js";
import { assertBundleDirectoryBounds, BUNDLE_PREAMBLE_BYTES, BUNDLE_TRAILER_BYTES, compareBytes,
  decodeBundleFooter, decodeBundlePreamble, decodeBundleTrailer, decodeVaultHeader,
  encodeBundleFooter, encodeBundlePreamble, encodeBundleTrailer, vaultValue } from "../../../persistence/codecs/vault.js";

export interface BundleSourceV1 {
  readonly headBytes: Uint8Array;
  readonly objects: readonly { readonly id: string }[];
  read(id: string, signal: AbortSignal): Promise<Uint8Array>;
}

/** One envelope at a time; the authenticated publication owns graph closure. */
export async function* bundleChunks(source: BundleSourceV1, signal: AbortSignal): AsyncIterable<Uint8Array> {
  signal.throwIfAborted();
  const header = source.headBytes.slice();
  decodeVaultHeader(header);
  const preamble = encodeBundlePreamble(header.length);
  yield preamble;
  yield header;
  let offset = BigInt(preamble.length + header.length);
  const directory: BundleDirectoryEntryV1[] = [];
  const ids = source.objects.map(({ id }) => decodeStorageId16(id)).sort(compareBytes);
  for (const storageId of ids) {
    signal.throwIfAborted();
    const bytes = await source.read(encodeBase64Url(storageId), signal);
    const frame = parseEnvelopeTransport(bytes);
    if (!constantTimeEquals(frame.storageId, storageId)) throw new IntegrityError("bundle object identity mismatch");
    directory.push({ storageId, byteOffset: offset, byteLength: BigInt(bytes.length), ciphertextSha256: await sha256(frame.ciphertext) });
    offset += BigInt(bytes.length);
    yield bytes;
  }
  signal.throwIfAborted();
  const footer = encodeBundleFooter({ vaultFormatVersion: CURRENT_FORMAT_VERSIONS.vault, directory,
    directorySha256: await sha256(encodeCanonical(vaultValue(directory))), complete: true });
  yield footer;
  yield encodeBundleTrailer(BigInt(footer.length));
}

export async function* blobChunks(blob: Blob, signal: AbortSignal): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < blob.size; offset += 65536) {
    signal.throwIfAborted();
    yield new Uint8Array(await blob.slice(offset, offset + 65536).arrayBuffer());
  }
}

/** Second pass: framing, directory, object bytes, and exact authenticated source. */
export async function verifyBundle(blob: Blob, expectedSha256: Uint8Array, signal: AbortSignal): Promise<void> {
  const read = async (start: number, end: number) => {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(start) || start < 0 || end > blob.size || end < start) throw new IntegrityError("bundle bounds");
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  };
  const headerLength = decodeBundlePreamble(await read(0, BUNDLE_PREAMBLE_BYTES));
  const objectsStart = BUNDLE_PREAMBLE_BYTES + headerLength;
  const header = decodeVaultHeader(await read(BUNDLE_PREAMBLE_BYTES, objectsStart));
  const footerLength = decodeBundleTrailer(await read(blob.size - BUNDLE_TRAILER_BYTES, blob.size));
  const footerStart = blob.size - BUNDLE_TRAILER_BYTES - Number(footerLength);
  const footer = decodeBundleFooter(await read(footerStart, blob.size - BUNDLE_TRAILER_BYTES));
  assertBundleDirectoryBounds(footer, BigInt(objectsStart), BigInt(footerStart));
  if (!constantTimeEquals(await sha256(encodeCanonical(vaultValue(footer.directory))), footer.directorySha256)) throw new IntegrityError("bundle directory hash mismatch");
  if (!footer.directory.some((entry) => constantTimeEquals(entry.storageId, header.currentIndex.storageId))) throw new IntegrityError("bundle index missing");
  for (const entry of footer.directory) {
    const frame = parseEnvelopeTransport(await read(Number(entry.byteOffset), Number(entry.byteOffset + entry.byteLength)));
    if (!constantTimeEquals(frame.storageId, entry.storageId) || !constantTimeEquals(await sha256(frame.ciphertext), entry.ciphertextSha256)) throw new IntegrityError("bundle object hash mismatch");
  }
  if (!constantTimeEquals(await sha256Chunks(blobChunks(blob, signal), signal), expectedSha256)) throw new IntegrityError("bundle differs from authenticated publication");
}
