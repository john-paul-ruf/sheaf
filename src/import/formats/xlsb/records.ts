/**
 * The bounded BIFF12 record reader (M16; FR-3, invariant 8).
 *
 * An XLSB part is a flat run of records, each a variable-length type (one or
 * two bytes, seven bits each), a variable-length size (up to four bytes) and a
 * body (MS-XLSB §2.1.4). Records are read one at a time from M13's zip stream;
 * a record larger than {@link MAX_RECORD_BYTES} is malformed rather than
 * buffered, so a hostile size cannot make the reader allocate.
 */

import { BoundExceededError, CONTAINER_BOUNDS_V1 } from "../../source/bounds.js";
import type { RangeV1 } from "../../facts/index.js";

/** Record types this adapter reads (MS-XLSB §2.3.2). */
export const BRT = Object.freeze({
  ROW_HDR: 0,
  CELL_BLANK: 1,
  CELL_RK: 2,
  CELL_ERROR: 3,
  CELL_BOOL: 4,
  CELL_REAL: 5,
  CELL_ST: 6,
  CELL_ISST: 7,
  FMLA_STRING: 8,
  FMLA_NUM: 9,
  FMLA_BOOL: 10,
  FMLA_ERROR: 11,
  SHORT_BLANK: 12,
  SHORT_RK: 13,
  SHORT_ERROR: 14,
  SHORT_BOOL: 15,
  SHORT_REAL: 16,
  SHORT_ST: 17,
  SHORT_ISST: 18,
  SST_ITEM: 19,
  NAME: 39,
  FMT: 44,
  XF: 47,
  CELL_RSTRING: 62,
  DVAL: 64,
  BEGIN_SHEET_DATA: 145,
  WS_DIM: 148,
  WB_PROP: 153,
  BUNDLE_SH: 156,
  BEGIN_SST: 159,
  MERGE_CELL: 176,
  BEGIN_LIST: 343,
  BEGIN_LIST_COL: 347,
  SUP_BOOK_SRC: 355,
  SUP_SELF: 357,
  SUP_SAME: 358,
  SUP_TABS: 359,
  PLACEHOLDER_NAME: 361,
  EXTERN_SHEET: 362,
  ARR_FMLA: 425,
  SHR_FMLA: 426,
  BEGIN_COND_FORMATTING: 461,
  HLINK: 494,
  BEGIN_CELL_XFS: 617,
  END_CELL_XFS: 618,
  BEGIN_COMMENT: 635,
  SUP_ADDIN: 666,
} as const);

/** Records that hold a cell; inventory never reads one. */
export const CELL_RECORD_TYPES: ReadonlySet<number> = new Set([
  BRT.CELL_BLANK,
  BRT.CELL_RK,
  BRT.CELL_ERROR,
  BRT.CELL_BOOL,
  BRT.CELL_REAL,
  BRT.CELL_ST,
  BRT.CELL_ISST,
  BRT.FMLA_STRING,
  BRT.FMLA_NUM,
  BRT.FMLA_BOOL,
  BRT.FMLA_ERROR,
  BRT.SHORT_BLANK,
  BRT.SHORT_RK,
  BRT.SHORT_ERROR,
  BRT.SHORT_BOOL,
  BRT.SHORT_REAL,
  BRT.SHORT_ST,
  BRT.SHORT_ISST,
  BRT.CELL_RSTRING,
]);

/** No BIFF12 record Sheaf reads comes near this; a larger claim is malformed. */
export const MAX_RECORD_BYTES = 16_777_216;

export interface XlsbRecordV1 {
  readonly type: number;
  readonly body: Uint8Array;
}

export function malformed(): never {
  throw new BoundExceededError("malformed-structure");
}

/** Reads one record's fields in order; every read is bounds-checked. */
export class BodyReaderV1 {
  at = 0;

  constructor(readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.byteLength - this.at;
  }

  private take(count: number): number {
    if (count < 0 || this.at + count > this.bytes.byteLength) malformed();
    const start = this.at;
    this.at += count;
    return start;
  }

  u8(): number {
    return this.bytes[this.take(1)] as number;
  }

  u16(): number {
    const at = this.take(2);
    return (this.bytes[at] as number) | ((this.bytes[at + 1] as number) << 8);
  }

  u32(): number {
    const at = this.take(4);
    return (
      ((this.bytes[at] as number) |
        ((this.bytes[at + 1] as number) << 8) |
        ((this.bytes[at + 2] as number) << 16) |
        ((this.bytes[at + 3] as number) << 24)) >>>
      0
    );
  }

  i32(): number {
    return this.u32() | 0;
  }

  f64(): number {
    const at = this.take(8);
    return new DataView(this.bytes.buffer, this.bytes.byteOffset + at, 8).getFloat64(0, true);
  }

  bytesOf(count: number): Uint8Array {
    const at = this.take(count);
    return this.bytes.slice(at, at + count);
  }

  skip(count: number): void {
    this.take(count);
  }

  /** `XLWideString`: a 32-bit count of UTF-16 code units. */
  wide(): string {
    const cch = this.u32();
    if (cch > this.remaining / 2) malformed();
    return UTF16.decode(this.bytes.subarray(this.take(cch * 2), this.at));
  }

  /** `XLNullableWideString`: `0xFFFFFFFF` is null. */
  nullableWide(): string | null {
    if (this.remaining >= 4 && this.bytes[this.at] === 0xff && this.bytes[this.at + 1] === 0xff && this.bytes[this.at + 2] === 0xff && this.bytes[this.at + 3] === 0xff) {
      this.at += 4;
      return null;
    }
    return this.wide();
  }

  /** `RfX`/`UncheckedRfX`: inclusive rows and columns. */
  rfx(): { readonly firstRow: number; readonly lastRow: number; readonly firstColumn: number; readonly lastColumn: number } {
    return { firstRow: this.u32(), lastRow: this.u32(), firstColumn: this.u32(), lastColumn: this.u32() };
  }
}

const UTF16 = new TextDecoder("utf-16le");

/** A range inside Excel's grid, or `impossible-dimension`; inverted is malformed. */
export function gridRange(rfx: {
  readonly firstRow: number;
  readonly lastRow: number;
  readonly firstColumn: number;
  readonly lastColumn: number;
}): RangeV1 {
  const { maxRow, maxColumn } = CONTAINER_BOUNDS_V1;
  if (rfx.lastRow >= maxRow || rfx.lastColumn >= maxColumn || rfx.firstRow >= maxRow || rfx.firstColumn >= maxColumn) {
    throw new BoundExceededError("impossible-dimension");
  }
  if (rfx.firstRow > rfx.lastRow || rfx.firstColumn > rfx.lastColumn) malformed();
  return rfx;
}

export interface XlsbRecordStreamV1 {
  /** Part offset of the next unread byte. */
  readonly position: number;
  /** The next record's type, reading its header only; `null` at the end. */
  peekType(): Promise<number | null>;
  next(): Promise<XlsbRecordV1 | null>;
  close(): Promise<void>;
}

export function openXlsbRecords(chunks: AsyncIterable<Uint8Array>): XlsbRecordStreamV1 {
  const iterator = chunks[Symbol.asyncIterator]();
  let buffer: Uint8Array = new Uint8Array(0);
  let cursor = 0;
  let consumed = 0;
  let isDone = false;

  const ensure = async (count: number): Promise<boolean> => {
    while (buffer.byteLength - cursor < count) {
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
      buffer = joined;
      cursor = 0;
    }
    return true;
  };

  /** Header fields and length, reading at most six bytes. */
  const header = async (): Promise<{ type: number; size: number; length: number } | null> => {
    if (!(await ensure(1))) return null;
    let length = 0;
    const varint = async (maxBytes: number): Promise<number> => {
      let value = 0;
      for (let index = 0; index < maxBytes; index += 1) {
        if (!(await ensure(length + 1))) throw new BoundExceededError("truncated-container");
        const byte = buffer[cursor + length] as number;
        length += 1;
        value += (byte & 0x7f) * 2 ** (7 * index);
        if ((byte & 0x80) === 0) return value;
      }
      return malformed();
    };
    const type = await varint(2);
    const size = await varint(4);
    if (size > MAX_RECORD_BYTES) malformed();
    return { type, size, length };
  };

  return {
    get position() {
      return consumed;
    },
    async peekType() {
      return (await header())?.type ?? null;
    },
    async next() {
      const found = await header();
      if (found === null) return null;
      if (!(await ensure(found.length + found.size))) throw new BoundExceededError("truncated-container");
      const start = cursor + found.length;
      const body = buffer.slice(start, start + found.size);
      cursor = start + found.size;
      consumed += found.length + found.size;
      return { type: found.type, body };
    },
    async close() {
      isDone = true;
      await iterator.return?.();
    },
  };
}
