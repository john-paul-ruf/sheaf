/**
 * Spies for the "pre-flight reads no cell" proof (architecture § Parser and
 * fidelity corpus, first assertion; CA-18). S04/S05 reuse them for their
 * readers.
 *
 * - {@link spyZipHandle} wraps a real handle and records, per entry, how many
 *   decompressed bytes it delivered. Streams are re-sliced into
 *   `sliceBytes`-sized pieces, so a consumer that stops early is charged for
 *   what it pulled, give or take one slice — not for a whole 64 KiB window.
 * - {@link entryDataRanges} locates each entry's compressed bytes in the
 *   archive, so a counting source's reads can be checked against them.
 */

import type { ZipContainerHandleV1 } from "../../../../src/import/source/zip.js";

export interface EntryReadsV1 {
  /** Bytes delivered by `readEntry`. */
  read: number;
  /** Bytes delivered by `streamEntry`, all streams summed. */
  streamed: number;
}

export const spyZipHandle = (
  zip: ZipContainerHandleV1,
  sliceBytes = 16,
): { readonly handle: ZipContainerHandleV1; readonly reads: ReadonlyMap<string, EntryReadsV1> } => {
  const reads = new Map<string, EntryReadsV1>();
  const entryReads = (name: string): EntryReadsV1 => {
    const key = name.toLowerCase();
    let existing = reads.get(key);
    if (existing === undefined) {
      existing = { read: 0, streamed: 0 };
      reads.set(key, existing);
    }
    return existing;
  };
  const handle: ZipContainerHandleV1 = {
    entries: zip.entries,
    has: (name) => zip.has(name),
    entry: (name) => zip.entry(name),
    async readEntry(name, options) {
      const bytes = await zip.readEntry(name, options);
      entryReads(name).read += bytes.byteLength;
      return bytes;
    },
    async *streamEntry(name) {
      const record = entryReads(name);
      for await (const chunk of zip.streamEntry(name)) {
        for (let at = 0; at < chunk.byteLength; at += sliceBytes) {
          const slice = chunk.subarray(at, at + sliceBytes);
          record.streamed += slice.byteLength;
          yield slice;
        }
      }
    },
    get expandedByteCount() {
      return zip.expandedByteCount;
    },
  };
  return { handle, reads };
};

const u16 = (bytes: Uint8Array, at: number): number => (bytes[at] as number) | ((bytes[at + 1] as number) << 8);
const u32 = (bytes: Uint8Array, at: number): number => (u16(bytes, at) | (u16(bytes, at + 2) << 16)) >>> 0;

/** Each entry's compressed data as `[start, end)` offsets in the archive. */
export const entryDataRanges = (bytes: Uint8Array): Map<string, { start: number; end: number }> => {
  const eocd = bytes.length - 22;
  let cursor = u32(bytes, eocd + 16);
  const ranges = new Map<string, { start: number; end: number }>();
  for (let index = 0; index < u16(bytes, eocd + 10); index += 1) {
    const nameLength = u16(bytes, cursor + 28);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const local = u32(bytes, cursor + 42);
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    ranges.set(name, { start, end: start + u32(bytes, cursor + 20) });
    cursor += 46 + nameLength + u16(bytes, cursor + 30) + u16(bytes, cursor + 32);
  }
  return ranges;
};
