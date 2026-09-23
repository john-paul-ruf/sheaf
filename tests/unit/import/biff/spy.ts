/**
 * A spying CFB handle for the BIFF "pre-flight reads no cell" proof (CA-18):
 * {@link spyCfbHandle} records, per stream, how many bytes the reader pulled,
 * re-slicing every chunk into `sliceBytes` pieces so a reader that stops early
 * is charged for what it pulled, give or take one slice.
 */

import type { CfbHandleV1 } from "../../../../src/import/source/cfb.js";
import { openCfbContainer } from "../../../../src/import/source/cfb.js";
import { bytesSource } from "../fixtures.js";

export interface StreamReadsV1 {
  read: number;
  streamed: number;
}

export const spyCfbHandle = (
  cfb: CfbHandleV1,
  sliceBytes = 16,
): { readonly handle: CfbHandleV1; readonly reads: ReadonlyMap<string, StreamReadsV1> } => {
  const reads = new Map<string, StreamReadsV1>();
  const readsOf = (path: string): StreamReadsV1 => {
    const key = path.toUpperCase();
    let existing = reads.get(key);
    if (existing === undefined) {
      existing = { read: 0, streamed: 0 };
      reads.set(key, existing);
    }
    return existing;
  };
  const handle: CfbHandleV1 = {
    listStreams: () => cfb.listStreams(),
    has: (path) => cfb.has(path),
    async readStream(path, options) {
      const bytes = await cfb.readStream(path, options);
      readsOf(path).read += bytes.byteLength;
      return bytes;
    },
    async *streamStream(path) {
      const record = readsOf(path);
      for await (const chunk of cfb.streamStream(path)) {
        for (let at = 0; at < chunk.byteLength; at += sliceBytes) {
          const slice = chunk.subarray(at, at + sliceBytes);
          record.streamed += slice.byteLength;
          yield slice;
        }
      }
    },
    isEncryptedPackage: cfb.isEncryptedPackage,
  };
  return { handle, reads };
};

export const openCfb = async (bytes: Uint8Array): Promise<CfbHandleV1> => openCfbContainer(bytesSource(bytes));

export interface BiffRecordRefV1 {
  readonly type: number;
  readonly offset: number;
  readonly end: number;
}

/** Every record of a well-formed stream, header offsets and ends — test-side, independent of M17. */
export const listRecords = (stream: Uint8Array): BiffRecordRefV1[] => {
  const records: BiffRecordRefV1[] = [];
  for (let at = 0; at + 4 <= stream.length; ) {
    const type = (stream[at] as number) | ((stream[at + 1] as number) << 8);
    const length = (stream[at + 2] as number) | ((stream[at + 3] as number) << 8);
    records.push({ type, offset: at, end: at + 4 + length });
    at += 4 + length;
  }
  return records;
};
