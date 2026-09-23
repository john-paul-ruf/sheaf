/**
 * Writes legacy Excel (`.xls`) workbooks from a typed description (M58): a
 * BIFF8 `Workbook` stream (or a BIFF5 `Book` stream) inside a CFB file written
 * by S01's `writeCfb`.
 *
 * The writer lays records out the way Excel does — globals, then one
 * substream per sheet, `BOUNDSHEET8` offsets patched to each sheet's `BOF` —
 * and chooses cell records the way Excel does: `LABELSST` for BIFF8 text,
 * `LABEL` for BIFF5, `RK` for a number an `RkNumber` holds exactly, `NUMBER`
 * otherwise, `MULRK`/`MULBLANK` for runs. The SST is split across `CONTINUE`
 * records at Excel's 8,224-byte limit, re-flagging each continued string.
 *
 * `poisonCells` overwrites everything between each sheet's `DIMENSIONS` and
 * its `EOF` with 0xFF: a workbook whose cell records cannot be read at all,
 * for proving that the inventory reader never reads one.
 */

import { writeCfb, type CfbStreamSpec, type CfbWriteOptions } from "../build/cfb-writer.js";

export type BiffCellInput = number | string | boolean | null | { readonly error: number };

/** Range as `[firstRow, lastRow, firstColumn, lastColumn]`. */
export type BiffRange = readonly [number, number, number, number];

export type BiffFormulaSpec =
  | { readonly tokens: Uint8Array; readonly extra?: Uint8Array }
  /** A shared formula's master; `tokens` use `PtgRefN`/`PtgAreaN` relative to each member. */
  | { readonly shared: { readonly range: BiffRange; readonly tokens: Uint8Array } }
  /** A shared- or array-formula member: `PtgExp` pointing at its master. */
  | { readonly member: readonly [number, number] }
  | { readonly array: { readonly range: BiffRange; readonly tokens: Uint8Array; readonly extra?: Uint8Array } }
  /** A data-table cell (`PtgTbl` + `TABLE`). */
  | { readonly table: true };

export interface BiffCellSpec {
  /** For a formula cell: the cached result. */
  readonly value?: BiffCellInput;
  readonly style?: number;
  readonly formula?: BiffFormulaSpec;
}

export interface BiffValidationSpec {
  /** `valType` (MS-XLS §2.4.117): 1 whole, 2 decimal, 3 list, 4 date, 5 time, 6 text length, 7 custom. */
  readonly type: number;
  /** `typOperator`: 0 between … 7 less-than-or-equal. */
  readonly operator?: number;
  /** A list written as one `PtgStr` of NUL-separated values. */
  readonly isStringList?: boolean;
  readonly formula1: Uint8Array;
  readonly formula2?: Uint8Array;
  readonly ranges: readonly BiffRange[];
}

export type BiffRowSpec = readonly (BiffCellSpec | BiffCellInput | undefined)[];

export interface BiffSheetSpec {
  readonly name: string;
  readonly type?: "worksheet" | "dialog" | "chart" | "macro" | "vbmodule";
  readonly hidden?: 0 | 1 | 2;
  /** `[firstRow, lastRow, firstColumn, lastColumn]`; defaults to the populated extent. */
  readonly dimension?: readonly [number, number, number, number] | "empty" | null;
  readonly rows?: readonly (BiffRowSpec | undefined)[];
  readonly merges?: readonly BiffRange[];
  readonly validations?: readonly BiffValidationSpec[];
  readonly hyperlinks?: readonly BiffRange[];
  /** Cells that carry a note (`NOTE` + its `OBJ`). */
  readonly notes?: readonly (readonly [number, number])[];
  /** `OBJ` records by object type (`ftCmo.ot`): 8 picture, 0x0b checkbox, 2 rectangle … */
  readonly objects?: readonly number[];
  /** Embedded chart substreams. */
  readonly charts?: number;
  readonly conditionalFormats?: number;
}

export interface BiffNameSpec {
  readonly name: string;
  /** A built-in name's character code (MS-XLS §2.5.114), e.g. 6 for Print_Area. */
  readonly builtin?: number;
  readonly sheetIndex?: number;
  readonly isFunction?: boolean;
  readonly rgce: Uint8Array;
  readonly rgcb?: Uint8Array;
}

export interface BiffWorkbookSpec {
  readonly version?: "biff8" | "biff5";
  readonly codePage?: number;
  readonly date1904?: boolean;
  readonly encrypted?: boolean;
  readonly fnGroupName?: boolean;
  readonly formats?: readonly { readonly id: number; readonly code: string }[];
  /** Cell XFs by index; defaults to one General XF. */
  readonly xfs?: readonly { readonly formatId: number; readonly font?: number }[];
  readonly sheets: readonly BiffSheetSpec[];
  /** `SUPBOOK`s; defaults to this workbook alone when `xti` is given. */
  readonly supbooks?: readonly ({ readonly kind: "self" } | { readonly kind: "addin"; readonly names: readonly string[] })[];
  /** `EXTERNSHEET` entries: supbook index and sheet span. */
  readonly xti?: readonly { readonly supbook: number; readonly first: number; readonly last: number }[];
  readonly names?: readonly BiffNameSpec[];
  /** Extra CFB streams — a VBA storage, summary information. */
  readonly streams?: readonly CfbStreamSpec[];
}

export interface BiffBuildOptions {
  /** Every sheet, or only the sheets at these indexes. */
  readonly poisonCells?: boolean | readonly number[];
  /** Passed to `writeCfb` — a directory loop, a lying size. */
  readonly cfb?: CfbWriteOptions;
}

const MAX_BODY = 8224;

const RT = {
  FORMULA: 0x0006,
  EOF: 0x000a,
  NOTE: 0x001c,
  OBJ: 0x005d,
  MERGEDCELLS: 0x00e5,
  CONDFMT: 0x01b0,
  DVAL: 0x01b2,
  HLINK: 0x01b8,
  DV: 0x01be,
  STRING: 0x0207,
  ARRAY: 0x0221,
  TABLE: 0x0236,
  SHRFMLA: 0x04bc,
  DATEMODE: 0x0022,
  FILEPASS: 0x002f,
  CONTINUE: 0x003c,
  CODEPAGE: 0x0042,
  WSBOOL: 0x0081,
  BOUNDSHEET: 0x0085,
  FNGROUPNAME: 0x009a,
  EXTERNSHEET: 0x0017,
  NAME: 0x0018,
  EXTERNNAME: 0x0023,
  SUPBOOK: 0x01ae,
  MULRK: 0x00bd,
  MULBLANK: 0x00be,
  XF: 0x00e0,
  SST: 0x00fc,
  LABELSST: 0x00fd,
  DIMENSIONS: 0x0200,
  BLANK: 0x0201,
  NUMBER: 0x0203,
  LABEL: 0x0204,
  BOOLERR: 0x0205,
  ROW: 0x0208,
  RK: 0x027e,
  FORMAT: 0x041e,
  BOF: 0x0809,
} as const;

/** A little-endian byte builder. */
export class Bytes {
  private readonly parts: number[] = [];

  get length(): number {
    return this.parts.length;
  }

  u8(value: number): this {
    this.parts.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    return this.u8(value).u8(value >>> 8);
  }

  u32(value: number): this {
    return this.u16(value & 0xffff).u16(value >>> 16);
  }

  f64(value: number): this {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, true);
    return this.raw(new Uint8Array(view.buffer));
  }

  raw(bytes: Iterable<number>): this {
    for (const byte of bytes) this.parts.push(byte & 0xff);
    return this;
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

const isWide = (text: string): boolean => [...text].some((character) => (character.codePointAt(0) as number) > 0xff);

const utf16 = (text: string): number[] => {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    bytes.push(unit & 0xff, unit >>> 8);
  }
  return bytes;
};

/** Characters with a compression flag, as `XLUnicodeString` stores them. */
export const unicodeBody = (text: string): { flags: number; chars: number[] } =>
  isWide(text)
    ? { flags: 1, chars: utf16(text) }
    : { flags: 0, chars: Array.from(text, (character) => character.charCodeAt(0)) };

/** `XLUnicodeString` (16-bit count). */
export const xlUnicodeString = (text: string): number[] => {
  const { flags, chars } = unicodeBody(text);
  return [text.length & 0xff, text.length >>> 8, flags, ...chars];
};

/** `ShortXLUnicodeString` (8-bit count). */
export const shortXlUnicodeString = (text: string): number[] => {
  const { flags, chars } = unicodeBody(text);
  return [text.length, flags, ...chars];
};

/** Windows-1252 for the characters the corpus uses above ASCII. */
const WINDOWS_1252_HIGH = new Map([
  ["€", 0x80],
  ["—", 0x97],
  ["’", 0x92],
  ["“", 0x93],
  ["”", 0x94],
]);

export const windows1252 = (text: string): number[] =>
  Array.from(text, (character) => {
    const code = character.charCodeAt(0);
    const high = WINDOWS_1252_HIGH.get(character);
    if (high !== undefined) return high;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) return code;
    throw new Error(`no Windows-1252 byte for ${character}`);
  });

/** One record: type, 16-bit length, body. */
export const record = (type: number, body: Iterable<number> = []): number[] => {
  const bytes = [...body];
  if (bytes.length > 0xffff) throw new Error("record body too long");
  return [type & 0xff, type >>> 8, bytes.length & 0xff, bytes.length >>> 8, ...bytes];
};

/** The `RkNumber` holding `value` exactly, or `null` when none does. */
export const rkOf = (value: number): number | null => {
  const limit = 2 ** 29;
  if (Number.isInteger(value) && Math.abs(value) < limit) return ((value << 2) | 2) >>> 0;
  const hundredths = Math.round(value * 100);
  if (hundredths / 100 === value && Math.abs(hundredths) < limit) return ((hundredths << 2) | 3) >>> 0;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true);
  const high = view.getUint32(4, true);
  if (view.getUint32(0, true) === 0 && (high & 3) === 0) return high;
  return null;
};

const cellOf = (input: BiffCellSpec | BiffCellInput | undefined): BiffCellSpec | undefined =>
  input === undefined
    ? undefined
    : input !== null && typeof input === "object" && !("error" in input)
      ? input
      : { value: input };

/** The SST, split at the record limit with continued strings re-flagged. */
const sstRecords = (strings: readonly string[]): number[] => {
  const records: number[][] = [];
  let body: number[] = [...new Bytes().u32(strings.length).u32(strings.length).finish()];
  let type: number = RT.SST;
  const flush = (): void => {
    records.push(record(type, body));
    type = RT.CONTINUE;
    body = [];
  };
  for (const text of strings) {
    const { flags, chars } = unicodeBody(text);
    if (body.length + 3 > MAX_BODY) flush();
    body.push(text.length & 0xff, text.length >>> 8, flags);
    const width = flags === 1 ? 2 : 1;
    let at = 0;
    while (at < chars.length) {
      const room = Math.floor((MAX_BODY - body.length) / width) * width;
      if (room === 0) {
        flush();
        body.push(flags);
        continue;
      }
      const take = chars.slice(at, at + room);
      body.push(...take);
      at += take.length;
    }
  }
  flush();
  return records.flat();
};

interface SheetOutput {
  readonly bytes: number[];
  /** `[start, end)` within the sheet substream to poison. */
  readonly poison: readonly [number, number] | null;
}

const SHEET_TYPE_CODES = { worksheet: 0, dialog: 0, macro: 1, chart: 2, vbmodule: 6 } as const;

export const buildBiffWorkbook = (spec: BiffWorkbookSpec, options: BiffBuildOptions = {}): Uint8Array => {
  const isBiff8 = (spec.version ?? "biff8") === "biff8";
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const sstIndexOf = (text: string): number => {
    let index = stringIndex.get(text);
    if (index === undefined) {
      index = strings.length;
      strings.push(text);
      stringIndex.set(text, index);
    }
    return index;
  };

  const bof = (dt: number): number[] =>
    record(
      RT.BOF,
      isBiff8
        ? new Bytes().u16(0x0600).u16(dt).u16(0x0dbb).u16(0x07cc).u32(0).u32(0x06).finish()
        : new Bytes().u16(0x0500).u16(dt).u16(0x0dbb).u16(0x07cc).finish(),
    );

  const formulaRecords = (row: number, column: number, style: number, cached: BiffCellInput, formula: BiffFormulaSpec): number[] => {
    const result = new Bytes();
    if (typeof cached === "number") result.f64(cached);
    else if (typeof cached === "string") result.raw([0x00, 0, 0, 0, 0, 0, 0xff, 0xff]);
    else if (typeof cached === "boolean") result.raw([0x01, 0, cached ? 1 : 0, 0, 0, 0, 0xff, 0xff]);
    else if (cached === null) result.raw([0x03, 0, 0, 0, 0, 0, 0xff, 0xff]);
    else result.raw([0x02, 0, cached.error, 0, 0, 0, 0xff, 0xff]);
    const exp = (masterRow: number, masterColumn: number): number[] => [...new Bytes().u8(0x01).u16(masterRow).u16(masterColumn).finish()];
    let tokens: number[];
    let extra: number[] = [];
    const following: number[] = [];
    if ("tokens" in formula) {
      tokens = [...formula.tokens];
      extra = [...(formula.extra ?? [])];
    } else if ("shared" in formula) {
      tokens = exp(row, column);
      const [r1, r2, c1, c2] = formula.shared.range;
      following.push(
        ...record(RT.SHRFMLA, [...new Bytes().u16(r1).u16(r2).u8(c1).u8(c2).u8(0).u8((r2 - r1 + 1) * (c2 - c1 + 1)).u16(formula.shared.tokens.length).finish(), ...formula.shared.tokens]),
      );
    } else if ("member" in formula) {
      tokens = exp(formula.member[0], formula.member[1]);
    } else if ("array" in formula) {
      tokens = exp(row, column);
      const [r1, r2, c1, c2] = formula.array.range;
      following.push(
        ...record(RT.ARRAY, [
          ...new Bytes().u16(r1).u16(r2).u8(c1).u8(c2).u16(0).u32(0).u16(formula.array.tokens.length).finish(),
          ...formula.array.tokens,
          ...(formula.array.extra ?? []),
        ]),
      );
    } else {
      tokens = [...new Bytes().u8(0x02).u16(row).u16(column).finish()];
      following.push(...record(RT.TABLE, new Bytes().u16(row).u16(row).u8(column).u8(column).u16(0).u16(0).u16(0).u16(0).u16(0).finish()));
    }
    const grbit = "shared" in formula || "member" in formula ? 0x0008 : 0;
    const out = record(RT.FORMULA, [
      ...new Bytes().u16(row).u16(column).u16(style).finish(),
      ...result.finish(),
      ...new Bytes().u16(grbit).u32(0).u16(tokens.length).finish(),
      ...tokens,
      ...extra,
    ]);
    out.push(...following);
    if (typeof cached === "string") {
      out.push(...record(RT.STRING, isBiff8 ? xlUnicodeString(cached) : [...new Bytes().u16(cached.length).finish(), ...windows1252(cached)]));
    }
    return out;
  };

  const structureRecords = (sheet: BiffSheetSpec): number[] => {
    const out: number[] = [];
    const ref8 = ([r1, r2, c1, c2]: BiffRange): number[] => [...new Bytes().u16(r1).u16(r2).u16(c1).u16(c2).finish()];
    const obj = (ot: number, id: number): number[] =>
      record(RT.OBJ, [...new Bytes().u16(0x15).u16(0x12).u16(ot).u16(id).u16(0x6011).finish(), ...new Array<number>(12).fill(0), 0, 0, 0, 0]);
    let objectId = 1;
    for (const ot of sheet.objects ?? []) out.push(...obj(ot, objectId++));
    for (let index = 0; index < (sheet.charts ?? 0); index += 1) {
      out.push(...obj(0x05, objectId++), ...bof(0x0020), ...record(0x1001, [0, 0]), ...record(RT.EOF));
    }
    for (const [row, column] of sheet.notes ?? []) {
      const id = objectId++;
      out.push(...obj(0x19, id));
      out.push(...record(RT.NOTE, [...new Bytes().u16(row).u16(column).u16(0).u16(id).finish(), ...xlUnicodeString("Sheaf"), 0]));
    }
    if ((sheet.merges ?? []).length > 0) {
      out.push(...record(RT.MERGEDCELLS, [...new Bytes().u16((sheet.merges ?? []).length).finish(), ...(sheet.merges ?? []).flatMap(ref8)]));
    }
    for (let index = 0; index < (sheet.conditionalFormats ?? 0); index += 1) {
      out.push(...record(RT.CONDFMT, [...new Bytes().u16(1).u16(0).finish(), ...ref8([0, 0, 0, 0]), 1, 0, ...ref8([0, 0, 0, 0])]));
    }
    for (const range of sheet.hyperlinks ?? []) {
      out.push(...record(RT.HLINK, [...ref8(range), ...new Array<number>(16).fill(0xd0), 2, 0, 0, 0, 0, 0, 0, 0]));
    }
    const validations = sheet.validations ?? [];
    if (validations.length > 0) {
      out.push(...record(RT.DVAL, new Bytes().u16(0).u32(0).u32(0).u32(0xffffffff).u32(validations.length).finish()));
      for (const validation of validations) {
        const flags = validation.type | (validation.isStringList === true ? 0x80 : 0) | 0x100 | ((validation.operator ?? 0) << 20);
        const formula2 = validation.formula2 ?? new Uint8Array(0);
        out.push(
          ...record(RT.DV, [
            ...new Bytes().u32(flags).finish(),
            ...[0, 1, 2, 3].flatMap(() => [1, 0, 0, 0]),
            ...new Bytes().u16(validation.formula1.length).u16(0).finish(),
            ...validation.formula1,
            ...new Bytes().u16(formula2.length).u16(0).finish(),
            ...formula2,
            ...new Bytes().u16(validation.ranges.length).finish(),
            ...validation.ranges.flatMap(ref8),
          ]),
        );
      }
    }
    return out;
  };

  const cellRecords = (rowIndex: number, row: BiffRowSpec): number[] => {
    const cells = row.map(cellOf);
    const out: number[] = [];
    let column = 0;
    while (column < cells.length) {
      const cell = cells[column];
      if (cell === undefined) {
        column += 1;
        continue;
      }
      const style = cell.style ?? 0;
      const value = cell.value ?? null;
      if (cell.formula !== undefined) {
        out.push(...formulaRecords(rowIndex, column, style, value, cell.formula));
        column += 1;
        continue;
      }
      const runOf = (test: (candidate: BiffCellSpec | undefined) => boolean): number => {
        let end = column;
        while (end < cells.length && test(cells[end])) end += 1;
        return end - column;
      };
      if (value === null) {
        const run = runOf((candidate) => candidate !== undefined && candidate.formula === undefined && (candidate.value ?? null) === null);
        if (run >= 2) {
          const body = new Bytes().u16(rowIndex).u16(column);
          for (let offset = 0; offset < run; offset += 1) body.u16(cells[column + offset]?.style ?? 0);
          out.push(...record(RT.MULBLANK, body.u16(column + run - 1).finish()));
          column += run;
          continue;
        }
        out.push(...record(RT.BLANK, new Bytes().u16(rowIndex).u16(column).u16(style).finish()));
      } else if (typeof value === "number") {
        const run = runOf(
          (candidate) =>
            candidate !== undefined && candidate.formula === undefined && typeof candidate.value === "number" && rkOf(candidate.value) !== null,
        );
        if (run >= 2) {
          const body = new Bytes().u16(rowIndex).u16(column);
          for (let offset = 0; offset < run; offset += 1) {
            const each = cells[column + offset] as BiffCellSpec;
            body.u16(each.style ?? 0).u32(rkOf(each.value as number) as number);
          }
          out.push(...record(RT.MULRK, body.u16(column + run - 1).finish()));
          column += run;
          continue;
        }
        const rk = rkOf(value);
        out.push(
          ...(rk === null
            ? record(RT.NUMBER, new Bytes().u16(rowIndex).u16(column).u16(style).f64(value).finish())
            : record(RT.RK, new Bytes().u16(rowIndex).u16(column).u16(style).u32(rk).finish())),
        );
      } else if (typeof value === "string") {
        out.push(
          ...(isBiff8
            ? record(RT.LABELSST, new Bytes().u16(rowIndex).u16(column).u16(style).u32(sstIndexOf(value)).finish())
            : record(
                RT.LABEL,
                new Bytes().u16(rowIndex).u16(column).u16(style).u16(value.length).raw(windows1252(value)).finish(),
              )),
        );
      } else if (typeof value === "boolean") {
        out.push(...record(RT.BOOLERR, new Bytes().u16(rowIndex).u16(column).u16(style).u8(value ? 1 : 0).u8(0).finish()));
      } else {
        out.push(...record(RT.BOOLERR, new Bytes().u16(rowIndex).u16(column).u16(style).u8(value.error).u8(1).finish()));
      }
      column += 1;
    }
    return out;
  };

  const extentOf = (sheet: BiffSheetSpec): readonly [number, number, number, number] | "empty" => {
    let lastRow = -1;
    let lastColumn = -1;
    (sheet.rows ?? []).forEach((row, rowIndex) => {
      if (row === undefined || row.length === 0) return;
      lastRow = rowIndex;
      lastColumn = Math.max(lastColumn, row.length - 1);
    });
    return lastRow === -1 ? "empty" : [0, lastRow, 0, lastColumn];
  };

  const sheetOutput = (sheet: BiffSheetSpec): SheetOutput => {
    const type = sheet.type ?? "worksheet";
    const out: number[] = [];
    if (type === "chart") {
      out.push(...bof(0x0020), ...record(RT.EOF));
      return { bytes: out, poison: null };
    }
    out.push(...bof(type === "macro" ? 0x0040 : 0x0010));
    out.push(...record(RT.WSBOOL, [0x01 | (type === "dialog" ? 0x10 : 0), 0x04]));
    const dimension = sheet.dimension === undefined ? extentOf(sheet) : sheet.dimension;
    if (dimension !== null) {
      const [firstRow, lastRow, firstColumn, lastColumn] = dimension === "empty" ? [0, -1, 0, -1] : dimension;
      const body = new Bytes();
      if (isBiff8) body.u32(firstRow).u32(lastRow + 1);
      else body.u16(firstRow).u16(lastRow + 1);
      out.push(...record(RT.DIMENSIONS, body.u16(firstColumn).u16(lastColumn + 1).u16(0).finish()));
    }
    const cellsStart = out.length;
    (sheet.rows ?? []).forEach((row, rowIndex) => {
      if (row === undefined || row.length === 0) return;
      out.push(...record(RT.ROW, new Bytes().u16(rowIndex).u16(0).u16(row.length).u16(0x00ff).u16(0).u16(0).u32(0x0100).finish()));
    });
    (sheet.rows ?? []).forEach((row, rowIndex) => {
      if (row !== undefined) out.push(...cellRecords(rowIndex, row));
    });
    out.push(...structureRecords(sheet));
    const cellsEnd = out.length;
    out.push(...record(RT.EOF));
    return { bytes: out, poison: dimension === null ? null : [cellsStart, cellsEnd] };
  };

  const sheets = spec.sheets.map(sheetOutput);

  const globalsWithout = (offsets: readonly number[]): number[] => {
    const out: number[] = [...bof(0x0005)];
    if (spec.encrypted === true) {
      out.push(...record(RT.FILEPASS, new Bytes().u16(1).u16(1).u16(1).raw(new Array<number>(48).fill(0x5a)).finish()));
    }
    out.push(...record(RT.CODEPAGE, new Bytes().u16(spec.codePage ?? (isBiff8 ? 1200 : 1252)).finish()));
    out.push(...record(RT.DATEMODE, new Bytes().u16(spec.date1904 === true ? 1 : 0).finish()));
    for (const format of spec.formats ?? []) {
      out.push(
        ...record(
          RT.FORMAT,
          isBiff8
            ? [format.id & 0xff, format.id >>> 8, ...xlUnicodeString(format.code)]
            : [format.id & 0xff, format.id >>> 8, format.code.length, ...windows1252(format.code)],
        ),
      );
    }
    for (const xf of spec.xfs ?? [{ formatId: 0 }]) {
      const body = new Bytes().u16(xf.font ?? 0).u16(xf.formatId).u16(0x0001);
      out.push(...record(RT.XF, body.raw(new Array<number>(isBiff8 ? 14 : 10).fill(0)).finish()));
    }
    if (spec.fnGroupName === true) out.push(...record(RT.FNGROUPNAME, shortXlUnicodeString("Custom")));
    spec.sheets.forEach((sheet, index) => {
      const body = new Bytes().u32(offsets[index] ?? 0).u8(sheet.hidden ?? 0).u8(SHEET_TYPE_CODES[sheet.type ?? "worksheet"]);
      body.raw(isBiff8 ? shortXlUnicodeString(sheet.name) : [sheet.name.length, ...windows1252(sheet.name)]);
      out.push(...record(RT.BOUNDSHEET, body.finish()));
    });
    if (spec.xti !== undefined || spec.supbooks !== undefined) {
      for (const book of spec.supbooks ?? [{ kind: "self" as const }]) {
        if (book.kind === "self") {
          out.push(...record(RT.SUPBOOK, new Bytes().u16(spec.sheets.length).u16(0x0401).finish()));
        } else {
          out.push(...record(RT.SUPBOOK, new Bytes().u16(1).u16(0x3a01).finish()));
          for (const name of book.names) {
            out.push(...record(RT.EXTERNNAME, [...new Bytes().u16(0).u32(0).finish(), ...shortXlUnicodeString(name), 0, 0]));
          }
        }
      }
      const xti = new Bytes().u16((spec.xti ?? []).length);
      for (const entry of spec.xti ?? []) xti.u16(entry.supbook).u16(entry.first & 0xffff).u16(entry.last & 0xffff);
      out.push(...record(RT.EXTERNSHEET, xti.finish()));
    }
    for (const name of spec.names ?? []) {
      const text = name.builtin === undefined ? name.name : String.fromCharCode(name.builtin);
      const { flags, chars } = unicodeBody(text);
      const grbit = (name.isFunction === true ? 0x0002 : 0) | (name.builtin === undefined ? 0 : 0x0020);
      out.push(
        ...record(RT.NAME, [
          ...new Bytes().u16(grbit).u8(0).u8(text.length).u16(name.rgce.length).u16(0).u16(name.sheetIndex === undefined ? 0 : name.sheetIndex + 1).u32(0).u8(flags).finish(),
          ...chars,
          ...name.rgce,
          ...(name.rgcb ?? []),
        ]),
      );
    }
    return out;
  };

  // Cell records register their strings; the SST is written after them.
  const probe = globalsWithout(spec.sheets.map(() => 0));
  const sst = isBiff8 && strings.length > 0 ? sstRecords(strings) : [];
  const globalsLength = probe.length + sst.length + 4;
  const offsets: number[] = [];
  let cursor = globalsLength;
  for (const sheet of sheets) {
    offsets.push(cursor);
    cursor += sheet.bytes.length;
  }
  const stream = [...globalsWithout(offsets), ...sst, ...record(RT.EOF)];
  sheets.forEach((sheet, index) => {
    const start = stream.length;
    stream.push(...sheet.bytes);
    const poison = options.poisonCells;
    if ((poison === true || (Array.isArray(poison) && poison.includes(index))) && sheet.poison !== null) {
      stream.fill(0xff, start + sheet.poison[0], start + sheet.poison[1]);
    }
    if (start !== offsets[index]) throw new Error("sheet offset drifted");
  });

  return writeCfb(
    [{ path: isBiff8 ? "Workbook" : "Book", data: Uint8Array.from(stream) }, ...(spec.streams ?? [])],
    options.cfb,
  );
};
