import { readFile } from "node:fs/promises";
import {
  blobSource,
  type RandomAccessSource,
} from "../../../src/import/source/source.js";

const CORPUS = "tests/fixtures/workbooks";

export const fixtureBytes = async (relativePath: string): Promise<Uint8Array> =>
  Uint8Array.from(await readFile(`${CORPUS}/${relativePath}`));

export const fixtureSource = async (
  relativePath: string,
): Promise<RandomAccessSource> =>
  bytesSource(await fixtureBytes(relativePath));

export const bytesSource = (bytes: Uint8Array): RandomAccessSource =>
  blobSource(new Blob([Uint8Array.from(bytes)]));

export const textSource = (text: string): RandomAccessSource =>
  bytesSource(new TextEncoder().encode(text));

/** A source that records every read, so bounded-read claims are checkable. */
export interface CountingSource extends RandomAccessSource {
  readonly reads: readonly { offset: number; length: number }[];
  readonly bytesRead: number;
  readonly largestRead: number;
}

export const countingSource = (inner: RandomAccessSource): CountingSource => {
  const reads: { offset: number; length: number }[] = [];
  let bytesRead = 0;
  let largestRead = 0;
  return {
    byteLength: inner.byteLength,
    reads,
    get bytesRead() {
      return bytesRead;
    },
    get largestRead() {
      return largestRead;
    },
    async slice(offset: number, length: number): Promise<Uint8Array> {
      const chunk = await inner.slice(offset, length);
      reads.push({ offset, length });
      bytesRead += chunk.byteLength;
      largestRead = Math.max(largestRead, chunk.byteLength);
      return chunk;
    },
  };
};
