/**
 * The bounded ZIP container reader (M13; D30, invariant 8, FR-3).
 *
 * **D30 fallback path.** The approved stack names zip.js, but its checkpoint-0
 * probe (F03 S01) found worker-creation code (`new Worker` over blob URLs, and
 * in the default entry a WASM codec) compiled into the production bundle from
 * every exported entry point, even with `useWebWorkers: false`. D30's
 * pre-decided fallback is this file: the same surface, written over the
 * end-of-central-directory and central-directory records and the platform's
 * native `DecompressionStream("deflate-raw")` — the M09 precedent.
 *
 * Nothing a file declares is trusted:
 *
 * - opening reads only the end record and the central directory — never an
 *   entry's data — so listing a workbook costs its directory, not its size;
 * - every entry byte is counted as it is produced, against the entry's
 *   declared size (both directions), the measured expansion ratio, the
 *   caller's cap, and one running total across the whole container;
 * - a read that crosses any of them stops mid-stream: the decompressor is
 *   cancelled and no further compressed byte is fetched.
 *
 * Every failure is a {@link BoundExceededError} with a closed detail token.
 */

import {
  BoundExceededError,
  CONTAINER_BOUNDS_V1,
  isBoundExceeded,
  type ContainerBoundsV1,
} from "./bounds.js";
import type { RandomAccessSource } from "./source.js";

/** One compressed read window: 64 KiB. */
export const ZIP_READ_CHUNK_BYTES = 65_536;

export const ZIP_METHOD_STORED = 0;
export const ZIP_METHOD_DEFLATE = 8;

export interface ZipEntryV1 {
  readonly name: string;
  readonly compressedSize: number;
  /** What the directory claims. Reads verify it; nothing trusts it. */
  readonly declaredUncompressedSize: number;
  /** 0 = stored, 8 = deflate. Any other method is refused when read. */
  readonly method: number;
}

export interface ZipReadOptionsV1 {
  /** The most bytes this caller will accept for the whole entry. */
  readonly maxBytes: number;
}

export interface ZipContainerHandleV1 {
  /** Central-directory order. */
  readonly entries: readonly ZipEntryV1[];
  /** Part names compare ASCII-case-insensitively, as OPC requires. */
  has(name: string): boolean;
  entry(name: string): ZipEntryV1 | null;
  /** A whole small part (a workbook or styles part), capped by the caller. */
  readEntry(name: string, options: ZipReadOptionsV1): Promise<Uint8Array>;
  /** A large part as it decompresses; stop iterating to stop reading. */
  streamEntry(name: string): AsyncIterable<Uint8Array>;
  /** Decompressed bytes produced so far across every entry. */
  readonly expandedByteCount: number;
}

interface EntryRecord extends ZipEntryV1 {
  readonly flags: number;
  readonly crc32: number;
  readonly localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_BYTES = 22;
const MAX_COMMENT_BYTES = 65_535;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_BYTES = 20;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_EOCD_BYTES = 56;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_BYTES = 46;
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_BYTES = 30;
const ZIP64_EXTRA_ID = 0x0001;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;

function fail(detail: BoundExceededError["detail"]): never {
  throw new BoundExceededError(detail);
}

const u16 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] as number) | ((bytes[at + 1] as number) << 8);

const u32 = (bytes: Uint8Array, at: number): number =>
  (u16(bytes, at) | (u16(bytes, at + 2) << 16)) >>> 0;

const u64 = (bytes: Uint8Array, at: number): number => {
  const value = u32(bytes, at) + u32(bytes, at + 4) * 0x1_0000_0000;
  return Number.isSafeInteger(value) ? value : fail("malformed-structure");
};

/** Reads exactly `length` bytes, in bounded slices, or reports truncation. */
const readExactly = async (
  source: RandomAccessSource,
  offset: number,
  length: number,
): Promise<Uint8Array> => {
  if (offset + length > source.byteLength) {
    fail("truncated-container");
  }
  const bytes = new Uint8Array(length);
  let filled = 0;
  while (filled < length) {
    const chunk = await source.slice(
      offset + filled,
      Math.min(ZIP_READ_CHUNK_BYTES, length - filled),
    );
    if (chunk.byteLength === 0) {
      fail("truncated-container");
    }
    bytes.set(chunk, filled);
    filled += chunk.byteLength;
  }
  return bytes;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const updateCrc32 = (crc: number, bytes: Uint8Array): number => {
  let value = crc;
  for (const byte of bytes) {
    value = (CRC_TABLE[(value ^ byte) & 0xff] as number) ^ (value >>> 8);
  }
  return value >>> 0;
};

const asciiLower = (name: string): string =>
  name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

const decodeName = (bytes: Uint8Array, flags: number): string => {
  if ((flags & FLAG_UTF8) !== 0) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return fail("malformed-structure");
    }
  }
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
};

/**
 * A part name must name a place inside the container. Absolute paths, drive
 * letters, backslashes, and `..`/`.`/empty segments are refused outright: no
 * reader resolves them, and a name that could escape is never a workbook part.
 */
const isSafeName = (name: string): boolean =>
  name !== "" &&
  !name.startsWith("/") &&
  !name.includes("\\") &&
  !/^[A-Za-z]:/.test(name) &&
  name
    .replace(/\/$/, "")
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");

interface EndRecord {
  readonly entryCount: number;
  readonly directorySize: number;
  readonly directoryOffset: number;
}

const findEndRecord = async (source: RandomAccessSource): Promise<EndRecord> => {
  if (source.byteLength < EOCD_BYTES) {
    fail("truncated-container");
  }
  // The common case — no archive comment — costs one 22-byte read.
  let eocdOffset = source.byteLength - EOCD_BYTES;
  let eocd = await readExactly(source, eocdOffset, EOCD_BYTES);
  if (u32(eocd, 0) !== EOCD_SIGNATURE || u16(eocd, 20) !== 0) {
    const windowLength = Math.min(source.byteLength, EOCD_BYTES + MAX_COMMENT_BYTES);
    const windowStart = source.byteLength - windowLength;
    const window = await readExactly(source, windowStart, windowLength);
    let found = -1;
    for (let at = windowLength - EOCD_BYTES; at >= 0; at -= 1) {
      if (
        u32(window, at) === EOCD_SIGNATURE &&
        at + EOCD_BYTES + u16(window, at + 20) === windowLength
      ) {
        found = at;
        break;
      }
    }
    if (found === -1) {
      fail("truncated-container");
    }
    eocdOffset = windowStart + found;
    eocd = window.subarray(found, found + EOCD_BYTES);
  }

  if (u16(eocd, 4) !== 0 || u16(eocd, 6) !== 0) {
    fail("unrecognized-content"); // a split (multi-disk) archive
  }
  let entryCount = u16(eocd, 10);
  let directorySize = u32(eocd, 12);
  let directoryOffset = u32(eocd, 16);
  let directoryEnd = eocdOffset;

  if (
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    const locatorOffset = eocdOffset - ZIP64_LOCATOR_BYTES;
    if (locatorOffset < 0) {
      fail("truncated-container");
    }
    const locator = await readExactly(source, locatorOffset, ZIP64_LOCATOR_BYTES);
    if (u32(locator, 0) !== ZIP64_LOCATOR_SIGNATURE) {
      fail("malformed-structure");
    }
    const recordOffset = u64(locator, 8);
    const record = await readExactly(source, recordOffset, ZIP64_EOCD_BYTES);
    if (u32(record, 0) !== ZIP64_EOCD_SIGNATURE) {
      fail("malformed-structure");
    }
    entryCount = u64(record, 32);
    directorySize = u64(record, 40);
    directoryOffset = u64(record, 48);
    directoryEnd = recordOffset;
  }

  if (directoryOffset + directorySize > directoryEnd) {
    fail("truncated-container");
  }
  return { entryCount, directorySize, directoryOffset };
};

const zip64Values = (
  extra: Uint8Array,
  wanted: { usize: boolean; csize: boolean; offset: boolean },
): { usize?: number; csize?: number; offset?: number } => {
  for (let at = 0; at + 4 <= extra.byteLength; ) {
    const id = u16(extra, at);
    const size = u16(extra, at + 2);
    const body = at + 4;
    if (body + size > extra.byteLength) {
      break;
    }
    if (id === ZIP64_EXTRA_ID) {
      const values: { usize?: number; csize?: number; offset?: number } = {};
      let cursor = body;
      const next = (): number => {
        if (cursor + 8 > body + size) {
          fail("malformed-structure");
        }
        const value = u64(extra, cursor);
        cursor += 8;
        return value;
      };
      if (wanted.usize) values.usize = next();
      if (wanted.csize) values.csize = next();
      if (wanted.offset) values.offset = next();
      return values;
    }
    at = body + size;
  }
  return fail("malformed-structure");
};

const readDirectory = async (
  source: RandomAccessSource,
  end: EndRecord,
  bounds: ContainerBoundsV1,
): Promise<EntryRecord[]> => {
  if (end.entryCount > bounds.maxZipEntries) {
    fail("expansion-limit");
  }
  const records: EntryRecord[] = [];
  const seen = new Set<string>();
  let cursor = end.directoryOffset;
  const directoryEnd = end.directoryOffset + end.directorySize;

  while (records.length < end.entryCount) {
    if (cursor + CENTRAL_BYTES > directoryEnd) {
      fail("malformed-structure");
    }
    const header = await readExactly(source, cursor, CENTRAL_BYTES);
    if (u32(header, 0) !== CENTRAL_SIGNATURE) {
      fail("malformed-structure");
    }
    const flags = u16(header, 8);
    const method = u16(header, 10);
    const crc32 = u32(header, 16);
    let compressedSize = u32(header, 20);
    let declaredUncompressedSize = u32(header, 24);
    const nameLength = u16(header, 28);
    const extraLength = u16(header, 30);
    const commentLength = u16(header, 32);
    let localHeaderOffset = u32(header, 42);

    if (nameLength > bounds.maxEntryPathBytes) {
      fail("malformed-structure");
    }
    const variable = cursor + CENTRAL_BYTES;
    const recordEnd = variable + nameLength + extraLength + commentLength;
    if (recordEnd > directoryEnd) {
      fail("malformed-structure");
    }
    const nameAndExtra = await readExactly(source, variable, nameLength + extraLength);
    const name = decodeName(nameAndExtra.subarray(0, nameLength), flags);

    const wanted = {
      usize: declaredUncompressedSize === 0xffffffff,
      csize: compressedSize === 0xffffffff,
      offset: localHeaderOffset === 0xffffffff,
    };
    if (wanted.usize || wanted.csize || wanted.offset) {
      const values = zip64Values(nameAndExtra.subarray(nameLength), wanted);
      declaredUncompressedSize = values.usize ?? declaredUncompressedSize;
      compressedSize = values.csize ?? compressedSize;
      localHeaderOffset = values.offset ?? localHeaderOffset;
    }

    const key = asciiLower(name);
    if (!isSafeName(name) || seen.has(key)) {
      fail("malformed-structure");
    }
    seen.add(key);
    records.push({
      name,
      compressedSize,
      declaredUncompressedSize,
      method,
      flags,
      crc32,
      localHeaderOffset,
    });
    cursor = recordEnd;
  }
  return records;
};

async function* compressedSlices(
  source: RandomAccessSource,
  offset: number,
  length: number,
): AsyncGenerator<Uint8Array, void, undefined> {
  let read = 0;
  while (read < length) {
    const chunk = await source.slice(
      offset + read,
      Math.min(ZIP_READ_CHUNK_BYTES, length - read),
    );
    if (chunk.byteLength === 0) {
      fail("truncated-container");
    }
    read += chunk.byteLength;
    yield chunk;
  }
}

/**
 * Raw inflate through the platform decompressor, pulled one output chunk at a
 * time. Leaving early cancels the decompressor, which rejects the pending
 * write and so stops the compressed reads too; nothing is left running.
 */
async function* inflateRaw(
  input: AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array, void, undefined> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  let inputFailure: unknown = null;

  const pump = (async () => {
    try {
      for await (const chunk of input) {
        // Copied so the stream owns a plain, non-shared buffer.
        await writer.write(new Uint8Array(chunk));
      }
      await writer.close();
    } catch (cause) {
      inputFailure = cause;
      await writer.abort(cause).catch(() => undefined);
    }
  })();

  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (cause) {
        if (isBoundExceeded(inputFailure)) {
          throw inputFailure;
        }
        throw isBoundExceeded(cause)
          ? cause
          : new BoundExceededError("malformed-structure");
      }
      if (result.done) {
        break;
      }
      yield result.value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    await pump;
  }
  if (isBoundExceeded(inputFailure)) {
    throw inputFailure;
  }
}

/**
 * Opens a ZIP container by reading its end record and central directory only.
 * `bounds` exists so tests can prove each bound with small inputs; production
 * callers use the default.
 */
export async function openZipContainer(
  source: RandomAccessSource,
  bounds: ContainerBoundsV1 = CONTAINER_BOUNDS_V1,
): Promise<ZipContainerHandleV1> {
  const end = await findEndRecord(source);
  const records = await readDirectory(source, end, bounds);
  const byName = new Map(records.map((record) => [asciiLower(record.name), record]));
  let expandedByteCount = 0;

  const lookup = (name: string): EntryRecord =>
    byName.get(asciiLower(name)) ?? fail("malformed-structure");

  const dataOffset = async (record: EntryRecord): Promise<number> => {
    if ((record.flags & FLAG_ENCRYPTED) !== 0) {
      fail("encrypted-workbook");
    }
    if (record.method !== ZIP_METHOD_STORED && record.method !== ZIP_METHOD_DEFLATE) {
      fail("unrecognized-content");
    }
    if (
      record.method === ZIP_METHOD_STORED &&
      record.compressedSize !== record.declaredUncompressedSize
    ) {
      fail("malformed-structure");
    }
    const local = await readExactly(source, record.localHeaderOffset, LOCAL_BYTES);
    if (u32(local, 0) !== LOCAL_SIGNATURE) {
      fail("malformed-structure");
    }
    const start =
      record.localHeaderOffset + LOCAL_BYTES + u16(local, 26) + u16(local, 28);
    if (start + record.compressedSize > source.byteLength) {
      fail("truncated-container");
    }
    return start;
  };

  async function* streamEntry(name: string): AsyncGenerator<Uint8Array, void, undefined> {
    const record = lookup(name);
    const start = await dataOffset(record);
    const compressed = compressedSlices(source, start, record.compressedSize);
    const output =
      record.method === ZIP_METHOD_STORED ? compressed : inflateRaw(compressed);
    const ratioLimit = Math.max(
      bounds.expansionRatioGraceBytes,
      record.compressedSize * bounds.maxExpansionRatio,
    );

    let produced = 0;
    let crc = 0xffffffff;
    for await (const chunk of output) {
      produced += chunk.byteLength;
      expandedByteCount += chunk.byteLength;
      if (produced > ratioLimit || expandedByteCount > bounds.maxTotalExpandedBytes) {
        fail("expansion-limit");
      }
      if (produced > record.declaredUncompressedSize) {
        fail("malformed-structure");
      }
      crc = updateCrc32(crc, chunk);
      yield chunk;
    }
    if (
      produced !== record.declaredUncompressedSize ||
      (crc ^ 0xffffffff) >>> 0 !== record.crc32
    ) {
      fail("malformed-structure");
    }
  }

  return {
    entries: records.map(
      ({ name, compressedSize, declaredUncompressedSize, method }) => ({
        name,
        compressedSize,
        declaredUncompressedSize,
        method,
      }),
    ),
    has: (name) => byName.has(asciiLower(name)),
    entry(name) {
      const record = byName.get(asciiLower(name));
      return record === undefined
        ? null
        : {
            name: record.name,
            compressedSize: record.compressedSize,
            declaredUncompressedSize: record.declaredUncompressedSize,
            method: record.method,
          };
    },
    async readEntry(name, { maxBytes }) {
      const record = lookup(name);
      if (record.declaredUncompressedSize > maxBytes) {
        fail("expansion-limit");
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of streamEntry(name)) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          fail("expansion-limit");
        }
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      return bytes;
    },
    streamEntry,
    get expandedByteCount() {
      return expandedByteCount;
    },
  };
}
