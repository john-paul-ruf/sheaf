/**
 * The bounded BIFF record reader (M17; FR-3, invariant 8).
 *
 * A BIFF workbook stream is a flat run of records — a 2-byte type, a 2-byte
 * length, a body of at most 65,535 bytes — read here one record at a time
 * from M13's CFB stream, never whole. Every length is the file's claim, so a
 * body is only ever as large as its own 16-bit length field allows, and a
 * stream that ends inside a record is `truncated-container`.
 *
 * {@link BiffRecordStreamV1.skipTo} moves to a stream offset — a sheet's `BOF`,
 * named by `BOUNDSHEET8` — **without interpreting a byte on the way**: skipped
 * bytes are never parsed as records. M13's CFB handle streams a stream from
 * its start only, so the skipped sectors are still fetched; a ranged CFB read
 * would let `skipTo` fetch nothing.
 *
 * Strings split across `CONTINUE` records (the SST, a long `STRING`) are read
 * through {@link ContinuedCursorV1}, which re-reads the compression flag at
 * every continuation as MS-XLS §2.5.293 requires.
 */

import { BoundExceededError } from "../../source/bounds.js";

/** Record types this adapter reads (MS-XLS §2.3, BIFF5 where noted). */
export const RT = Object.freeze({
  FORMULA: 0x0006,
  EOF: 0x000a,
  NOTE: 0x001c,
  EXTERNSHEET: 0x0017,
  NAME: 0x0018,
  DATEMODE: 0x0022,
  EXTERNNAME: 0x0023,
  FILEPASS: 0x002f,
  CONTINUE: 0x003c,
  CODEPAGE: 0x0042,
  OBJ: 0x005d,
  WSBOOL: 0x0081,
  BOUNDSHEET: 0x0085,
  FNGROUPNAME: 0x009a,
  MULRK: 0x00bd,
  MULBLANK: 0x00be,
  RSTRING: 0x00d6,
  XF: 0x00e0,
  MERGEDCELLS: 0x00e5,
  SST: 0x00fc,
  LABELSST: 0x00fd,
  SUPBOOK: 0x01ae,
  CONDFMT: 0x01b0,
  HLINK: 0x01b8,
  DV: 0x01be,
  DIMENSIONS: 0x0200,
  BLANK: 0x0201,
  NUMBER: 0x0203,
  LABEL: 0x0204,
  BOOLERR: 0x0205,
  STRING: 0x0207,
  ROW: 0x0208,
  ARRAY: 0x0221,
  TABLE: 0x0236,
  RK: 0x027e,
  FORMAT: 0x041e,
  SHRFMLA: 0x04bc,
  BOF: 0x0809,
  DCONN: 0x0876,
  CONDFMT12: 0x0879,
} as const);

/** The records that hold a cell; inventory never reads one. */
export const CELL_RECORD_TYPES: ReadonlySet<number> = new Set([
  RT.FORMULA,
  RT.MULRK,
  RT.MULBLANK,
  RT.RSTRING,
  RT.LABELSST,
  RT.BLANK,
  RT.NUMBER,
  RT.LABEL,
  RT.BOOLERR,
  RT.RK,
]);

/** `BOF.dt`: which substream a `BOF` opens. */
export const SUBSTREAM = Object.freeze({
  GLOBALS: 0x0005,
  WORKSHEET: 0x0010,
  CHART: 0x0020,
  MACRO_SHEET: 0x0040,
});

export const BIFF8_VERSION = 0x0600;
export const BIFF5_VERSION = 0x0500;

export type BiffVersionV1 = "biff8" | "biff5";

export interface BiffRecordV1 {
  readonly type: number;
  /** Stream offset of the record header. */
  readonly offset: number;
  readonly body: Uint8Array;
}

export function malformed(): never {
  throw new BoundExceededError("malformed-structure");
}

export const u8 = (bytes: Uint8Array, at: number): number => {
  const value = bytes[at];
  return value === undefined ? malformed() : value;
};

export const u16 = (bytes: Uint8Array, at: number): number => u8(bytes, at) | (u8(bytes, at + 1) << 8);

export const i16 = (bytes: Uint8Array, at: number): number => (u16(bytes, at) << 16) >> 16;

export const u32 = (bytes: Uint8Array, at: number): number => (u16(bytes, at) | (u16(bytes, at + 2) << 16)) >>> 0;

export const f64 = (bytes: Uint8Array, at: number): number => {
  if (at + 8 > bytes.byteLength) malformed();
  return new DataView(bytes.buffer, bytes.byteOffset + at, 8).getFloat64(0, true);
};

/**
 * An `RkNumber` (MS-XLS §2.5.217) as the double Excel means: a 30-bit integer
 * or the high 30 bits of a double, optionally divided by 100.
 */
export function rkNumber(rk: number): number {
  let value: number;
  if ((rk & 2) !== 0) {
    value = (rk | 0) >> 2;
  } else {
    const view = new DataView(new ArrayBuffer(8));
    view.setUint32(4, (rk & 0xfffffffc) >>> 0, true);
    value = view.getFloat64(0, true);
  }
  return (rk & 1) !== 0 ? value / 100 : value;
}

const UTF16 = new TextDecoder("utf-16le");

/** `cch` characters, one byte each (compressed) or UTF-16LE. */
export function unicodeChars(bytes: Uint8Array, at: number, cch: number, isHighByte: boolean): string {
  const length = isHighByte ? cch * 2 : cch;
  if (at + length > bytes.byteLength) malformed();
  const slice = bytes.subarray(at, at + length);
  return isHighByte ? UTF16.decode(slice) : String.fromCharCode(...slice);
}

/** `XLUnicodeString` (16-bit count) or `ShortXLUnicodeString` (8-bit count). */
export function unicodeString(
  bytes: Uint8Array,
  at: number,
  countBytes: 1 | 2,
): { readonly text: string; readonly end: number } {
  const cch = countBytes === 1 ? u8(bytes, at) : u16(bytes, at);
  const flags = u8(bytes, at + countBytes);
  const isHighByte = (flags & 1) !== 0;
  const start = at + countBytes + 1;
  return { text: unicodeChars(bytes, start, cch, isHighByte), end: start + cch * (isHighByte ? 2 : 1) };
}

/** Reads one stream's records in order; see the module comment. */
export interface BiffRecordStreamV1 {
  /** Stream offset of the next unread byte. */
  readonly position: number;
  /** The next record's type, reading its header only; `null` at the end. */
  peekType(): Promise<number | null>;
  next(): Promise<BiffRecordV1 | null>;
  /** Discards bytes up to `offset` without parsing them. Never moves back. */
  skipTo(offset: number): Promise<void>;
  close(): Promise<void>;
}

const HEADER_BYTES = 4;

export function openRecordStream(chunks: AsyncIterable<Uint8Array>): BiffRecordStreamV1 {
  const iterator = chunks[Symbol.asyncIterator]();
  let buffer: Uint8Array = new Uint8Array(0);
  let cursor = 0;
  let bufferStart = 0;
  let isDone = false;

  const available = (): number => buffer.byteLength - cursor;

  const pull = async (): Promise<boolean> => {
    if (isDone) return false;
    const step = await iterator.next();
    if (step.done === true) {
      isDone = true;
      return false;
    }
    const rest = buffer.subarray(cursor);
    const joined = new Uint8Array(rest.byteLength + step.value.byteLength);
    joined.set(rest, 0);
    joined.set(step.value, rest.byteLength);
    bufferStart += cursor;
    buffer = joined;
    cursor = 0;
    return true;
  };

  const ensure = async (count: number): Promise<boolean> => {
    while (available() < count) {
      if (!(await pull())) return false;
    }
    return true;
  };

  const peekType = async (): Promise<number | null> => {
    if (!(await ensure(HEADER_BYTES))) {
      if (available() !== 0) throw new BoundExceededError("truncated-container");
      return null;
    }
    return u16(buffer, cursor);
  };

  return {
    get position() {
      return bufferStart + cursor;
    },
    peekType,
    async next() {
      const type = await peekType();
      if (type === null) return null;
      const length = u16(buffer, cursor + 2);
      if (!(await ensure(HEADER_BYTES + length))) throw new BoundExceededError("truncated-container");
      const offset = bufferStart + cursor;
      const body = buffer.slice(cursor + HEADER_BYTES, cursor + HEADER_BYTES + length);
      cursor += HEADER_BYTES + length;
      return { type, offset, body };
    },
    async skipTo(offset) {
      if (offset < bufferStart + cursor) malformed();
      for (;;) {
        const wanted = offset - (bufferStart + cursor);
        if (wanted <= available()) {
          cursor += wanted;
          return;
        }
        bufferStart += buffer.byteLength;
        buffer = new Uint8Array(0);
        cursor = 0;
        if (isDone) throw new BoundExceededError("truncated-container");
        const step = await iterator.next();
        if (step.done === true) throw new BoundExceededError("truncated-container");
        buffer = step.value;
      }
    },
    async close() {
      isDone = true;
      await iterator.return?.();
    },
  };
}

/**
 * A record body followed by its `CONTINUE` bodies, read as one byte sequence
 * except where MS-XLS says otherwise: a string's characters that cross into a
 * continuation start with a fresh compression-flag byte.
 */
export class ContinuedCursorV1 {
  private fragment = 0;
  private at: number;

  constructor(
    private readonly fragments: readonly Uint8Array[],
    start = 0,
  ) {
    this.at = start;
  }

  get isAtEnd(): boolean {
    this.settle();
    return this.fragment >= this.fragments.length;
  }

  private settle(): void {
    while (this.fragment < this.fragments.length && this.at >= (this.fragments[this.fragment] as Uint8Array).byteLength) {
      this.fragment += 1;
      this.at = 0;
    }
  }

  private current(): Uint8Array {
    this.settle();
    return this.fragments[this.fragment] ?? malformed();
  }

  u8(): number {
    const bytes = this.current();
    const value = bytes[this.at] as number;
    this.at += 1;
    return value;
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }

  skip(count: number): void {
    let remaining = count;
    while (remaining > 0) {
      const bytes = this.current();
      const step = Math.min(remaining, bytes.byteLength - this.at);
      this.at += step;
      remaining -= step;
    }
  }

  /**
   * `cch` characters. Where they cross into the next fragment, that fragment
   * opens with a flag byte whose low bit is the new compression state.
   */
  chars(cch: number, isHighByte: boolean): string {
    const parts: string[] = [];
    let remaining = cch;
    let isHigh = isHighByte;
    while (remaining > 0) {
      const bytes = this.fragments[this.fragment] ?? malformed();
      if (this.at >= bytes.byteLength) {
        this.fragment += 1;
        isHigh = (u8(this.fragments[this.fragment] ?? malformed(), 0) & 1) !== 0;
        this.at = 1;
        continue;
      }
      const width = isHigh ? 2 : 1;
      const fit = Math.min(remaining, Math.floor((bytes.byteLength - this.at) / width));
      if (fit === 0) malformed();
      parts.push(unicodeChars(bytes, this.at, fit, isHigh));
      this.at += fit * width;
      remaining -= fit;
    }
    return parts.join("");
  }

  /** `XLUnicodeRichExtendedString` (MS-XLS §2.5.293): the text, runs and phonetics skipped. */
  richExtendedString(): string {
    const cch = this.u16();
    const flags = this.u8();
    const runs = (flags & 0x08) !== 0 ? this.u16() : 0;
    const extended = (flags & 0x04) !== 0 ? this.u32() : 0;
    const text = this.chars(cch, (flags & 1) !== 0);
    this.skip(runs * 4);
    this.skip(extended);
    return text;
  }
}
