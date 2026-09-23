/**
 * A deterministic ZIP writer for the workbook corpus (M58).
 *
 * Fixture bytes are the test subject, so they must not depend on the zlib the
 * generating machine happens to ship. Deflate here is a small, fixed encoder —
 * greedy LZ77 with a single-candidate hash, one fixed-Huffman block — whose
 * output is a pure function of its input. Every header field a hostile file
 * could lie in is controllable: declared sizes, CRC, the encryption flag and
 * the entry count, so bombs, lies and truncations are written, not simulated.
 */

export interface ZipEntrySpec {
  readonly name: string;
  readonly data: Uint8Array | string;
  /** Defaults to `deflate`. */
  readonly method?: "stored" | "deflate";
  /** Written into both headers instead of the true size. */
  readonly declaredUncompressedSize?: number;
  readonly crc32?: number;
  readonly encrypted?: boolean;
}

export interface ZipWriteOptions {
  /** Written into the end record instead of the true count. */
  readonly entryCount?: number;
}

const encoder = new TextEncoder();

export const bytesOf = (data: Uint8Array | string): Uint8Array =>
  typeof data === "string" ? encoder.encode(data) : data;

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

export const crc32 = (bytes: Uint8Array): number => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = (CRC_TABLE[(value ^ byte) & 0xff] as number) ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

class BitWriter {
  private readonly bytes: number[] = [];
  private current = 0;
  private filled = 0;

  /** Writes `count` bits of `value`, least significant first. */
  bits(value: number, count: number): void {
    for (let bit = 0; bit < count; bit += 1) {
      this.current |= ((value >>> bit) & 1) << this.filled;
      this.filled += 1;
      if (this.filled === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.filled = 0;
      }
    }
  }

  /** Huffman codes are defined most significant bit first. */
  code(value: number, count: number): void {
    for (let bit = count - 1; bit >= 0; bit -= 1) {
      this.bits((value >>> bit) & 1, 1);
    }
  }

  finish(): Uint8Array {
    if (this.filled > 0) {
      this.bytes.push(this.current);
    }
    return Uint8Array.from(this.bytes);
  }
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

const writeSymbol = (out: BitWriter, symbol: number): void => {
  if (symbol < 144) out.code(0x30 + symbol, 8);
  else if (symbol < 256) out.code(0x190 + symbol - 144, 9);
  else if (symbol < 280) out.code(symbol - 256, 7);
  else out.code(0xc0 + symbol - 280, 8);
};

const lastIndexAtMost = (table: readonly number[], value: number): number => {
  let index = 0;
  while (index + 1 < table.length && (table[index + 1] as number) <= value) index += 1;
  return index;
};

/** Raw deflate (RFC 1951): one final fixed-Huffman block. */
export const deflateRaw = (input: Uint8Array): Uint8Array => {
  const out = new BitWriter();
  out.bits(1, 1); // BFINAL
  out.bits(1, 2); // BTYPE = fixed Huffman
  const recent = new Map<number, number>();
  let at = 0;
  while (at < input.length) {
    let matchLength = 0;
    let matchDistance = 0;
    if (at + 3 <= input.length) {
      const key = ((input[at] as number) << 16) | ((input[at + 1] as number) << 8) | (input[at + 2] as number);
      const candidate = recent.get(key);
      recent.set(key, at);
      if (candidate !== undefined && at - candidate <= 32_768) {
        let length = 0;
        while (length < 258 && at + length < input.length && input[candidate + length] === input[at + length]) {
          length += 1;
        }
        if (length >= 3) {
          matchLength = length;
          matchDistance = at - candidate;
        }
      }
    }
    if (matchLength === 0) {
      writeSymbol(out, input[at] as number);
      at += 1;
      continue;
    }
    const lengthIndex = lastIndexAtMost(LENGTH_BASE, matchLength);
    writeSymbol(out, 257 + lengthIndex);
    out.bits(matchLength - (LENGTH_BASE[lengthIndex] as number), LENGTH_EXTRA[lengthIndex] as number);
    const distanceIndex = lastIndexAtMost(DISTANCE_BASE, matchDistance);
    out.code(distanceIndex, 5);
    out.bits(matchDistance - (DISTANCE_BASE[distanceIndex] as number), DISTANCE_EXTRA[distanceIndex] as number);
    // Index the skipped positions sparsely: runs stay cheap to encode.
    for (let skipped = at + 1; skipped < at + matchLength && skipped + 3 <= input.length; skipped += 16) {
      recent.set(((input[skipped] as number) << 16) | ((input[skipped + 1] as number) << 8) | (input[skipped + 2] as number), skipped);
    }
    at += matchLength;
  }
  writeSymbol(out, 256);
  return out.finish();
};

class ByteWriter {
  private readonly parts: Uint8Array[] = [];
  length = 0;

  u16(value: number): void {
    this.raw(Uint8Array.of(value & 0xff, (value >>> 8) & 0xff));
  }

  u32(value: number): void {
    this.raw(Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff));
  }

  raw(bytes: Uint8Array): void {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  finish(): Uint8Array {
    const bytes = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      bytes.set(part, at);
      at += part.length;
    }
    return bytes;
  }
}

const DOS_DATE_1980_01_01 = 0x0021;

/** Writes a complete archive. Identical specs always give identical bytes. */
export const writeZip = (
  entries: readonly ZipEntrySpec[],
  options: ZipWriteOptions = {},
): Uint8Array => {
  const out = new ByteWriter();
  const central = new ByteWriter();
  for (const entry of entries) {
    const data = bytesOf(entry.data);
    const name = encoder.encode(entry.name);
    const isStored = entry.method === "stored";
    const payload = isStored ? data : deflateRaw(data);
    const flags = (entry.encrypted === true ? 0x0001 : 0) | (/^[\x20-\x7e]*$/.test(entry.name) ? 0 : 0x0800);
    const crc = entry.crc32 ?? crc32(data);
    const size = entry.declaredUncompressedSize ?? data.length;
    const offset = out.length;

    const header = (writer: ByteWriter, isCentral: boolean): void => {
      writer.u32(isCentral ? 0x02014b50 : 0x04034b50);
      if (isCentral) writer.u16(20);
      writer.u16(20);
      writer.u16(flags);
      writer.u16(isStored ? 0 : 8);
      writer.u16(0);
      writer.u16(DOS_DATE_1980_01_01);
      writer.u32(crc);
      writer.u32(payload.length);
      writer.u32(size);
      writer.u16(name.length);
      writer.u16(0);
      if (isCentral) {
        writer.u16(0);
        writer.u16(0);
        writer.u16(0);
        writer.u32(0);
        writer.u32(offset);
      }
      writer.raw(name);
    };
    header(out, false);
    out.raw(payload);
    header(central, true);
  }
  const directoryOffset = out.length;
  const directory = central.finish();
  out.raw(directory);
  const count = options.entryCount ?? entries.length;
  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(Math.min(count, 0xffff));
  out.u16(Math.min(count, 0xffff));
  out.u32(directory.length);
  out.u32(directoryOffset);
  out.u16(0);
  return out.finish();
};
