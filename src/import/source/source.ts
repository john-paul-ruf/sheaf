/**
 * Random-access reads over a file the user chose (architecture § Import
 * Architecture Stage 1).
 *
 * Every import stage above this one reads through {@link RandomAccessSource}
 * and nothing else, which is what makes "the whole file is never in memory"
 * (FR-3) a structural property rather than a discipline: a caller can only ask
 * for a bounded window, and a window larger than {@link MAX_SLICE_BYTES} is
 * refused before any allocation happens. A hostile declared size therefore
 * cannot make Sheaf allocate on its behalf.
 *
 * The source deliberately does not know the file's name. Format is decided by
 * content (FR-1), and the name travels beside the source as the declared
 * evidence that sniffing may contradict.
 */

/** The largest single read any import stage may request: 1 MiB. */
export const MAX_SLICE_BYTES = 1_048_576;

export interface RandomAccessSource {
  readonly byteLength: number;
  /**
   * Reads at most `length` bytes starting at `offset`. A window that runs past
   * the end returns the bytes that exist — a short read is the end of the
   * file, never an error — and a window that starts past the end is empty.
   */
  slice(offset: number, length: number): Promise<Uint8Array>;
}

const checkBounds = (offset: number, length: number): void => {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("source offset must be a non-negative whole number");
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError("source length must be a non-negative whole number");
  }
  if (length > MAX_SLICE_BYTES) {
    throw new RangeError("source read exceeds the 1 MiB slice bound");
  }
};

/** Reads through `Blob.slice`, so a `File` is never held in memory as bytes. */
export function blobSource(blob: Blob): RandomAccessSource {
  return {
    byteLength: blob.size,
    async slice(offset: number, length: number): Promise<Uint8Array> {
      checkBounds(offset, length);
      const start = Math.min(offset, blob.size);
      const end = Math.min(start + length, blob.size);
      return new Uint8Array(await blob.slice(start, end).arrayBuffer());
    },
  };
}
