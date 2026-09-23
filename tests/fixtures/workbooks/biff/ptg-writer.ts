/**
 * Writes parsed-formula token streams (`rgce`) and their extra data (`rgcb`)
 * for the BIFF8 and BIFF12 fixtures (M58). Operand widths follow MS-XLS §2.5.198
 * and MS-XLSB §2.5.97; references are written the way Excel writes them, with
 * the relative flags set where formula text has no `$`.
 */

export type PtgWriterFormat = "biff8" | "biff12";

export interface RefFlags {
  /** `$` on the row / column. */
  readonly rowAbsolute?: boolean;
  readonly columnAbsolute?: boolean;
}

export class PtgWriter {
  private readonly tokens: number[] = [];
  private readonly extra: number[] = [];

  constructor(readonly format: PtgWriterFormat) {}

  private get isBiff8(): boolean {
    return this.format === "biff8";
  }

  private push(...bytes: number[]): this {
    this.tokens.push(...bytes.map((byte) => byte & 0xff));
    return this;
  }

  private u16(target: number[], value: number): void {
    target.push(value & 0xff, (value >>> 8) & 0xff);
  }

  private u32(target: number[], value: number): void {
    target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }

  private f64(target: number[], value: number): void {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, true);
    target.push(...new Uint8Array(view.buffer));
  }

  private row(value: number): void {
    if (this.isBiff8) this.u16(this.tokens, value);
    else this.u32(this.tokens, value);
  }

  private column(value: number, flags: RefFlags): void {
    this.u16(this.tokens, (value & 0x3fff) | (flags.columnAbsolute === true ? 0 : 0x4000) | (flags.rowAbsolute === true ? 0 : 0x8000));
  }

  get rgce(): Uint8Array {
    return Uint8Array.from(this.tokens);
  }

  get rgcb(): Uint8Array {
    return Uint8Array.from(this.extra);
  }

  /** Raw token bytes, for hostile streams. */
  raw(...bytes: number[]): this {
    return this.push(...bytes);
  }

  op(code: number): this {
    return this.push(code);
  }

  add(): this {
    return this.op(0x03);
  }

  sub(): this {
    return this.op(0x04);
  }

  paren(): this {
    return this.op(0x15);
  }

  missArg(): this {
    return this.op(0x16);
  }

  int(value: number): this {
    this.push(0x1e);
    this.u16(this.tokens, value);
    return this;
  }

  num(value: number): this {
    this.push(0x1f);
    this.f64(this.tokens, value);
    return this;
  }

  bool(value: boolean): this {
    return this.push(0x1d, value ? 1 : 0);
  }

  err(code: number): this {
    return this.push(0x1c, code);
  }

  str(text: string): this {
    this.push(0x17);
    if (this.isBiff8) {
      const isWide = [...text].some((character) => character.charCodeAt(0) > 0xff);
      this.push(text.length, isWide ? 1 : 0);
      for (const character of text) {
        const code = character.charCodeAt(0);
        if (isWide) this.u16(this.tokens, code);
        else this.push(code);
      }
    } else {
      this.u16(this.tokens, text.length);
      for (const character of text) this.u16(this.tokens, character.charCodeAt(0));
    }
    return this;
  }

  ref(row: number, column: number, flags: RefFlags = {}, token = 0x24): this {
    this.push(token);
    this.row(row);
    this.column(column, flags);
    return this;
  }

  area(firstRow: number, firstColumn: number, lastRow: number, lastColumn: number, flags: RefFlags = {}, token = 0x25): this {
    this.push(token);
    this.row(firstRow);
    this.row(lastRow);
    this.column(firstColumn, flags);
    this.column(lastColumn, flags);
    return this;
  }

  /** `PtgRefN`: offsets from the formula's own cell (relative parts). */
  refN(rowOffset: number, columnOffset: number, flags: RefFlags = {}): this {
    return this.ref(rowOffset & (this.isBiff8 ? 0xffff : 0xffffffff), columnOffset & (this.isBiff8 ? 0xff : 0x3fff), flags, 0x2c);
  }

  areaN(firstRow: number, firstColumn: number, lastRow: number, lastColumn: number, flags: RefFlags = {}): this {
    const rowMask = this.isBiff8 ? 0xffff : 0xffffffff;
    const columnMask = this.isBiff8 ? 0xff : 0x3fff;
    return this.area(firstRow & rowMask, firstColumn & columnMask, lastRow & rowMask, lastColumn & columnMask, flags, 0x2d);
  }

  ref3d(ixti: number, row: number, column: number, flags: RefFlags = {}): this {
    this.push(0x3a);
    this.u16(this.tokens, ixti);
    this.row(row);
    this.column(column, flags);
    return this;
  }

  area3d(ixti: number, firstRow: number, firstColumn: number, lastRow: number, lastColumn: number, flags: RefFlags = {}): this {
    this.push(0x3b);
    this.u16(this.tokens, ixti);
    this.row(firstRow);
    this.row(lastRow);
    this.column(firstColumn, flags);
    this.column(lastColumn, flags);
    return this;
  }

  refErr(): this {
    return this.push(0x2a, ...new Array<number>(this.isBiff8 ? 4 : 6).fill(0));
  }

  areaErr(): this {
    return this.push(0x2b, ...new Array<number>(this.isBiff8 ? 8 : 12).fill(0));
  }

  refErr3d(ixti: number): this {
    this.push(0x3c);
    this.u16(this.tokens, ixti);
    return this.push(...new Array<number>(this.isBiff8 ? 4 : 6).fill(0));
  }

  areaErr3d(ixti: number): this {
    this.push(0x3d);
    this.u16(this.tokens, ixti);
    return this.push(...new Array<number>(this.isBiff8 ? 8 : 12).fill(0));
  }

  name(index: number): this {
    this.push(0x23);
    this.u32(this.tokens, index);
    return this;
  }

  nameX(ixti: number, index: number): this {
    this.push(0x39);
    this.u16(this.tokens, ixti);
    this.u32(this.tokens, index);
    return this;
  }

  func(id: number): this {
    this.push(0x41);
    this.u16(this.tokens, id);
    return this;
  }

  funcVar(id: number, argc: number): this {
    this.push(0x42, argc);
    this.u16(this.tokens, id);
    return this;
  }

  attr(flags: number, data = 0, choose: readonly number[] = []): this {
    this.push(0x19, flags);
    this.u16(this.tokens, data);
    for (const offset of choose) this.u16(this.tokens, offset);
    return this;
  }

  attrSum(): this {
    return this.attr(0x10);
  }

  attrSpace(count: number): this {
    return this.attr(0x40, count << 8);
  }

  /** `PtgMemFunc`: the following `cce` bytes compute a reference. */
  memFunc(cce: number): this {
    this.push(0x29);
    this.u16(this.tokens, cce);
    return this;
  }

  /** `PtgMemArea` with its `PtgExtraMem` extent in `rgcb`. */
  memArea(cce: number, extents: readonly (readonly [number, number, number, number])[]): this {
    this.push(0x26, 0, 0, 0, 0);
    this.u16(this.tokens, cce);
    if (this.isBiff8) {
      this.u16(this.extra, extents.length);
      for (const [r1, r2, c1, c2] of extents) [r1, r2, c1, c2].forEach((value) => this.u16(this.extra, value));
    } else {
      this.u32(this.extra, extents.length);
      for (const [r1, r2, c1, c2] of extents) [r1, r2, c1, c2].forEach((value) => this.u32(this.extra, value));
    }
    return this;
  }

  /** `PtgArray` with its constant values in `rgcb`, row-major. */
  array(rows: readonly (readonly (number | string | boolean | { readonly error: number })[])[]): this {
    this.push(0x60, ...new Array<number>(this.isBiff8 ? 7 : 14).fill(0));
    const width = rows[0]?.length ?? 0;
    if (this.isBiff8) {
      this.extra.push(width - 1);
      this.u16(this.extra, rows.length - 1);
    } else {
      this.u32(this.extra, rows.length);
      this.u32(this.extra, width);
    }
    for (const row of rows) {
      for (const value of row) {
        if (typeof value === "number") {
          this.extra.push(this.isBiff8 ? 0x01 : 0x00);
          this.f64(this.extra, value);
        } else if (typeof value === "string") {
          this.extra.push(this.isBiff8 ? 0x02 : 0x01);
          this.u16(this.extra, value.length);
          if (this.isBiff8) this.extra.push(1);
          for (const character of value) this.u16(this.extra, character.charCodeAt(0));
        } else if (typeof value === "boolean") {
          this.extra.push(this.isBiff8 ? 0x04 : 0x02, value ? 1 : 0);
          if (this.isBiff8) this.extra.push(0, 0, 0, 0, 0, 0, 0);
        } else {
          this.extra.push(this.isBiff8 ? 0x10 : 0x04, value.error);
          if (this.isBiff8) this.extra.push(0, 0, 0, 0, 0, 0, 0);
        }
      }
    }
    return this;
  }

  /** `PtgExp`: this cell belongs to the shared/array formula whose master is here. */
  exp(row: number, column: number): this {
    this.push(0x01);
    if (this.isBiff8) {
      this.u16(this.tokens, row);
      this.u16(this.tokens, column);
    } else {
      this.u32(this.tokens, row);
    }
    return this;
  }

  tbl(row: number, column: number): this {
    this.push(0x02);
    this.u16(this.tokens, row);
    this.u16(this.tokens, column);
    return this;
  }
}

export const ptg = (format: PtgWriterFormat): PtgWriter => new PtgWriter(format);
