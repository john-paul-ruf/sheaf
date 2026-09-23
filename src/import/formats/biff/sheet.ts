/**
 * One BIFF worksheet substream, streamed into V2 facts (M17; CA-17, FR-3,
 * invariants 7 and 8).
 *
 * Records are read one at a time from the sheet's `BOF` to its `EOF`. Cell
 * records of one row are gathered (at most one row's worth), then emitted as a
 * `row` fact followed, per cell in column order, by an optional `cell-format`,
 * an optional `formula`, and an optional `value` fact — the order and the
 * sparsity rule M65 states, exactly as the OOXML adapter emits them. A blank
 * cell (`BLANK`, `MULBLANK`) widens its row but is never a value fact.
 *
 * Values use the domain constructors only. Numbers (`NUMBER`, `RK`, `MULRK`,
 * cached formula results) become canonical decimals through M65's rule; text
 * is NFC-normalized with a diagnostic (D28); an error cell keeps its text as an
 * invalid-preserved value with `error-value`; BIFF5 text that its code page
 * cannot read keeps U+FFFD with `replacement-character`.
 *
 * Formulas are decompiled, never evaluated (D33, D34): a shared formula's
 * master carries its text and group, each member only the group (M65's
 * rule); an array formula's master carries its text; a token stream the
 * decoder cannot read keeps its cached value and becomes an inert `formula`
 * part with no text. Everything the sheet holds that is not a cell or a
 * structure fact — notes, hyperlinks, drawings, controls, charts,
 * conditional formatting, visual cell styling — becomes a preserved part.
 */

import {
  booleanValue,
  invalidPreservedValue,
  textValue,
  type CellValueV1,
} from "../../../domain/model/values.js";
import {
  BUILTIN_NUMBER_FORMATS,
  classifyNumberFormat,
  decimalCellOfDouble,
  PRESERVED_REASON_BY_KIND,
  type FormatClassV1,
  type ImportDiagnosticCodeV2,
  type PreservedPartKindV1,
  type RangeV1,
  type ValidationListSourceV1,
  type ValidationOperatorV1,
  type ValidationRuleV1,
  type WorkbookFactV2,
} from "../../facts/index.js";
import { BoundExceededError, CONTAINER_BOUNDS_V1 } from "../../source/bounds.js";
import { ptgContextOf, type BiffGlobalsV1, type BiffSheetEntryV1 } from "./globals.js";
import { decodePtgFormula, ERROR_TEXT, locationOf, ptgExpOf, type PtgDecodeResultV1 } from "./ptg.js";
import {
  ContinuedCursorV1,
  f64,
  malformed,
  rkNumber,
  RT,
  u16,
  u32,
  u8,
  unicodeString,
  type BiffRecordStreamV1,
  type BiffRecordV1,
} from "./records.js";

/** Where facts go; batching and diagnostic tallies live with the caller. */
export interface FactSinkV1 {
  push(fact: WorkbookFactV2): void;
  note(code: ImportDiagnosticCodeV2, rowIndex: number | null, columnIndex: number | null): void;
}

export const preservedPart = (
  partKind: PreservedPartKindV1,
  location: string,
  anchor: RangeV1 | null,
): WorkbookFactV2 => ({
  kind: "preserved-part",
  partKind,
  location,
  reasonKey: PRESERVED_REASON_BY_KIND[partKind],
  anchor,
  partPath: null,
});

interface CellStyleV1 {
  readonly numberFormat: string;
  readonly formatClass: FormatClassV1;
  readonly currencySymbol: string | null;
  readonly isVisuallyStyled: boolean;
}

const GENERAL: CellStyleV1 = Object.freeze({
  numberFormat: "General",
  formatClass: "general",
  currencySymbol: null,
  isVisuallyStyled: false,
});

/** Each XF's number format and class; built-in ids 0–49 read as OOXML reads them. */
export const cellStylesOf = (globals: BiffGlobalsV1): readonly CellStyleV1[] =>
  globals.cellFormats.map(({ formatId, isVisuallyStyled }) => {
    const code = globals.formats.get(formatId);
    if (code !== undefined) return { numberFormat: code, ...classifyNumberFormat(code), isVisuallyStyled };
    const builtin = BUILTIN_NUMBER_FORMATS.get(formatId);
    return builtin === undefined
      ? { ...GENERAL, isVisuallyStyled }
      : { numberFormat: builtin.code, formatClass: builtin.formatClass, currencySymbol: builtin.currencySymbol, isVisuallyStyled };
  });

interface PendingCell {
  readonly column: number;
  readonly xf: number;
  readonly value: CellValueV1 | null;
  readonly formula: WorkbookFactV2 | null;
  readonly isUndecodable: boolean;
}

/** A `FORMULA` record's cached result (MS-XLS §2.5.133 `FormulaValue`). */
type CachedResult =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string" }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "error"; readonly code: number }
  | { readonly kind: "empty" };

const cachedResultOf = (body: Uint8Array): CachedResult => {
  if (u16(body, 12) !== 0xffff) return { kind: "number", value: f64(body, 6) };
  switch (u8(body, 6)) {
    case 0:
      return { kind: "string" };
    case 1:
      return { kind: "boolean", value: u8(body, 8) !== 0 };
    case 2:
      return { kind: "error", code: u8(body, 8) };
    default:
      return { kind: "empty" };
  }
};

const VALIDATION_TYPES: readonly (ValidationRuleV1 | null)[] = [null, "whole", "decimal", "list", "date", "time", "text-length", "custom"];
const VALIDATION_OPERATORS: readonly ValidationOperatorV1[] = [
  "between",
  "not-between",
  "equal",
  "not-equal",
  "greater-than",
  "less-than",
  "greater-than-or-equal",
  "less-than-or-equal",
];
const DV_STRING_LIST = 0x80;

/** `OBJ.ftCmo.ot` → the inert kind it is (MS-XLS §2.5.110); notes and charts are read elsewhere. */
const objectKindOf = (ot: number): PreservedPartKindV1 | null => {
  if (ot === 0x05 || ot === 0x19) return null;
  if (ot === 0x08) return "image";
  if ([0x07, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x14].includes(ot)) return "form-control";
  return "drawing";
};

const isExternalFormula = (text: string): boolean => /\[\d+\]/.test(text.replace(/"[^"]*"/g, ""));

/** An `Ref8`-shaped range (16-bit rows and columns), or `null` when it leaves the grid or is inverted. */
const ref8 = (body: Uint8Array, at: number): RangeV1 | null => {
  const range = { firstRow: u16(body, at), lastRow: u16(body, at + 2), firstColumn: u16(body, at + 4), lastColumn: u16(body, at + 6) };
  return range.firstRow <= range.lastRow &&
    range.firstColumn <= range.lastColumn &&
    range.lastColumn < CONTAINER_BOUNDS_V1.maxColumn
    ? range
    : null;
};

/** A `CONTINUE`-joined record's fragments. */
const fragmentsOf = async (stream: BiffRecordStreamV1, first: Uint8Array): Promise<Uint8Array[]> => {
  const fragments = [first];
  while ((await stream.peekType()) === RT.CONTINUE) fragments.push(((await stream.next()) ?? malformed()).body);
  return fragments;
};

interface SharedGroup {
  readonly id: number;
  readonly master: { readonly row: number; readonly column: number };
}

/**
 * Streams one worksheet (or dialog sheet) from just after its `DIMENSIONS`
 * (or its first cell) to its `EOF` into `sink`, yielding after every row so
 * the caller can cut batches and observe cancellation.
 */
export async function* streamBiffSheet(
  stream: BiffRecordStreamV1,
  globals: BiffGlobalsV1,
  sheet: BiffSheetEntryV1,
  sink: FactSinkV1,
): AsyncGenerator<void, void, undefined> {
  const isBiff8 = globals.version === "biff8";
  const styles = cellStylesOf(globals);
  const columnFormats = new Map<number, string>();
  const sharedGroups = new Map<string, SharedGroup>();
  const arrayMasters = new Set<string>();
  let rowIndex: number | null = null;
  let lastRowIndex = -1;
  let cells: PendingCell[] = [];
  let isStyled = false;
  let conditionalFormats = 0;
  const at = (range: RangeV1 | null): string => locationOf(sheet.name, range);
  const key = (row: number, column: number): string => `${row},${column}`;

  const textCell = (raw: string, row: number, column: number): CellValueV1 | null => {
    if (raw === "") return null;
    const text = raw.normalize("NFC");
    if (text !== raw) sink.note("text-normalized-nfc", row, column);
    return textValue(text);
  };
  const kept = (raw: string, code: ImportDiagnosticCodeV2, row: number, column: number): CellValueV1 => {
    sink.note(code, row, column);
    return invalidPreservedValue(raw.normalize("NFC"));
  };
  const numberCell = (value: number, row: number, column: number): CellValueV1 =>
    decimalCellOfDouble(value) ?? kept(String(value), "malformed-value", row, column);
  const errorCell = (code: number, row: number, column: number): CellValueV1 =>
    kept(ERROR_TEXT.get(code) ?? "#N/A", "error-value", row, column);
  /** BIFF5 text through the code page; BIFF8 text is UTF-16 already. */
  const byteText = (bytes: Uint8Array, row: number, column: number): string => {
    const decoded = globals.codePage.decode(bytes);
    if (decoded.isLossy) sink.note("replacement-character", row, column);
    return decoded.text;
  };
  /** `XLUnicodeString` (BIFF8) or a 16-bit-counted byte string (BIFF5), maybe continued. */
  const recordString = (fragments: readonly Uint8Array[], start: number, row: number, column: number): string => {
    if (isBiff8) {
      const cursor = new ContinuedCursorV1(fragments, start);
      const cch = cursor.u16();
      return cursor.chars(cch, (cursor.u8() & 1) !== 0);
    }
    const body = fragments[0] ?? malformed();
    const cch = u16(body, start);
    if (start + 2 + cch > body.byteLength) malformed();
    return byteText(body.subarray(start + 2, start + 2 + cch), row, column);
  };

  const flushRow = (): void => {
    if (rowIndex === null) return;
    const row = rowIndex;
    rowIndex = null;
    if (cells.length === 0) return;
    cells.sort((left, right) => left.column - right.column);
    sink.push({ kind: "row", rowIndex: row, cellCount: (cells.at(-1) as PendingCell).column + 1 });
    let previousColumn = -1;
    for (const cell of cells) {
      if (cell.column === previousColumn) malformed();
      previousColumn = cell.column;
      const style = styles[cell.xf] ?? GENERAL;
      isStyled ||= style.isVisuallyStyled;
      if (cell.value !== null && style.numberFormat !== (columnFormats.get(cell.column) ?? "General")) {
        columnFormats.set(cell.column, style.numberFormat);
        sink.push({
          kind: "cell-format",
          rowIndex: row,
          columnIndex: cell.column,
          numberFormat: style.numberFormat,
          formatClass: style.formatClass,
          currencySymbol: style.currencySymbol,
        });
      }
      if (cell.formula !== null) sink.push(cell.formula);
      if (cell.isUndecodable) {
        const anchor = { firstRow: row, firstColumn: cell.column, lastRow: row, lastColumn: cell.column };
        sink.push(preservedPart("formula", at(anchor), anchor));
      }
      if (cell.value !== null) sink.push({ kind: "value", rowIndex: row, columnIndex: cell.column, value: cell.value });
    }
    lastRowIndex = row;
    cells = [];
  };

  /** Adds a cell to its row, flushing the previous row first; `true` when a row was flushed. */
  const addCell = (row: number, cell: PendingCell): boolean => {
    if (row >= CONTAINER_BOUNDS_V1.maxRow || cell.column >= CONTAINER_BOUNDS_V1.maxColumn) {
      throw new BoundExceededError("impossible-dimension");
    }
    let flushed = false;
    if (rowIndex !== row) {
      flushRow();
      flushed = true;
      if (row <= lastRowIndex) malformed();
      rowIndex = row;
    }
    cells.push(cell);
    return flushed;
  };

  const plainCell = (column: number, xf: number, value: CellValueV1 | null): PendingCell => ({
    column,
    xf,
    value,
    formula: null,
    isUndecodable: false,
  });

  const formulaCell = async (record: BiffRecordV1): Promise<{ row: number; cell: PendingCell }> => {
    const body = record.body;
    const row = u16(body, 0);
    const column = u16(body, 2);
    const xf = u16(body, 4);
    const cached = cachedResultOf(body);
    const cce = u16(body, 20);
    if (22 + cce > body.byteLength) malformed();
    const rgce = body.subarray(22, 22 + cce);
    const rgcb = body.subarray(22 + cce);

    let text: string | null = null;
    let sharedGroup: number | null = null;
    let isArray = false;
    let isArrayMember = false;
    const exp = isBiff8 ? ptgExpOf(rgce, "biff8") : null;
    const decodeAt = (tokens: Uint8Array, extra: Uint8Array, isShared: boolean): PtgDecodeResultV1 =>
      decodePtgFormula(tokens, ptgContextOf(globals, { row, column }, isShared), extra);

    const following = await stream.peekType();
    if (exp !== null && following === RT.SHRFMLA) {
      const shared = ((await stream.next()) ?? malformed()).body;
      const sharedCce = u16(shared, 8);
      if (10 + sharedCce > shared.byteLength) malformed();
      const group: SharedGroup = { id: sharedGroups.size, master: { row, column } };
      sharedGroups.set(key(row, column), group);
      sharedGroup = group.id;
      const decoded = decodeAt(shared.subarray(10, 10 + sharedCce), shared.subarray(10 + sharedCce), true);
      text = "text" in decoded ? decoded.text : null;
    } else if (exp !== null && following === RT.ARRAY) {
      const array = ((await stream.next()) ?? malformed()).body;
      const arrayCce = u16(array, 12);
      if (14 + arrayCce > array.byteLength) malformed();
      arrayMasters.add(key(row, column));
      isArray = true;
      const decoded = decodeAt(array.subarray(14, 14 + arrayCce), array.subarray(14 + arrayCce), false);
      text = "text" in decoded ? decoded.text : null;
    } else if (exp !== null && following === RT.TABLE) {
      await stream.next();
    } else if (exp !== null) {
      const masterKey = key(exp.row, exp.column ?? column);
      const group = sharedGroups.get(masterKey);
      if (group !== undefined) sharedGroup = group.id;
      isArrayMember = arrayMasters.has(masterKey);
    } else if (isBiff8) {
      const decoded = decodeAt(rgce, rgcb, false);
      text = "text" in decoded ? decoded.text : null;
    }

    let value: CellValueV1 | null;
    switch (cached.kind) {
      case "number":
        value = numberCell(cached.value, row, column);
        break;
      case "boolean":
        value = booleanValue(cached.value);
        break;
      case "error":
        value = errorCell(cached.code, row, column);
        break;
      case "empty":
        value = null;
        break;
      case "string": {
        value = null;
        if ((await stream.peekType()) === RT.STRING) {
          const string = ((await stream.next()) ?? malformed()).body;
          value = textCell(recordString(await fragmentsOf(stream, string), 0, row, column), row, column);
        }
        break;
      }
    }

    if (isArrayMember) return { row, cell: plainCell(column, xf, value) };
    const isUndecodable = text === null && sharedGroup === null;
    return {
      row,
      cell: {
        column,
        xf,
        value,
        isUndecodable,
        formula: {
          kind: "formula",
          rowIndex: row,
          columnIndex: column,
          text: text === null ? null : text.normalize("NFC"),
          sharedGroup,
          isArray,
          isExternal: text !== null && isExternalFormula(text),
        },
      },
    };
  };

  const validation = (body: Uint8Array): void => {
    const flags = u32(body, 0);
    const rule = VALIDATION_TYPES[flags & 0x0f] ?? null;
    let cursor = 4;
    for (let index = 0; index < 4; index += 1) cursor = unicodeString(body, cursor, 2).end;
    const formulaAt = (start: number): { tokens: Uint8Array; end: number } => {
      const cce = u16(body, start);
      if (start + 4 + cce > body.byteLength) malformed();
      return { tokens: body.subarray(start + 4, start + 4 + cce), end: start + 4 + cce };
    };
    const first = formulaAt(cursor);
    const second = formulaAt(first.end);
    const count = u16(body, second.end);
    const ranges: RangeV1[] = [];
    for (let index = 0; index < count; index += 1) {
      const range = ref8(body, second.end + 2 + index * 8);
      if (range !== null) ranges.push(range);
    }
    const origin = ranges[0];
    if (rule === null || origin === undefined) return;
    const context = ptgContextOf(globals, { row: origin.firstRow, column: origin.firstColumn });
    const textOf = (tokens: Uint8Array): string | null | undefined => {
      if (tokens.byteLength === 0) return null;
      const decoded = decodePtgFormula(tokens, context);
      return "text" in decoded ? decoded.text.normalize("NFC") : undefined;
    };
    let formula1 = textOf(first.tokens);
    const formula2 = textOf(second.tokens);
    let listSource: ValidationListSourceV1 | null = null;
    if (rule === "list" && typeof formula1 === "string") {
      if ((flags & DV_STRING_LIST) !== 0 && /^".*"$/s.test(formula1)) {
        const values = formula1.slice(1, -1).replace(/""/g, '"').split("\0");
        formula1 = `"${values.join(",").replace(/"/g, '""')}"`;
        listSource = { kind: "inline", values };
      } else {
        listSource = { kind: "range", ref: formula1 };
      }
    }
    if (formula1 === undefined || formula2 === undefined) {
      for (const range of ranges) sink.push(preservedPart("unsupported-validation", at(range), range));
      return;
    }
    const operator = rule === "list" || rule === "custom" ? null : (VALIDATION_OPERATORS[(flags >>> 20) & 0x0f] ?? null);
    for (const range of ranges) {
      sink.push({ kind: "validation", range, rule, operator, listSource, formula1, formula2 });
    }
  };

  let substreamDepth = 0;
  for (let record = await stream.next(); record !== null; record = await stream.next()) {
    const body = record.body;
    if (substreamDepth > 0) {
      if (record.type === RT.BOF) substreamDepth += 1;
      if (record.type === RT.EOF) substreamDepth -= 1;
      continue;
    }
    let flushed = false;
    switch (record.type) {
      case RT.EOF:
        flushRow();
        if (conditionalFormats > 0) sink.push(preservedPart("conditional-formatting", sheet.name, null));
        if (isStyled) sink.push(preservedPart("cell-styling", sheet.name, null));
        yield;
        return;
      case RT.BOF:
        sink.push(preservedPart("chart", sheet.name, null));
        substreamDepth = 1;
        break;
      case RT.LABELSST: {
        const row = u16(body, 0);
        const column = u16(body, 2);
        const index = u32(body, 6);
        const text = globals.strings[index];
        flushed = addCell(
          row,
          plainCell(column, u16(body, 4), text === undefined ? kept(String(index), "malformed-value", row, column) : textCell(text, row, column)),
        );
        break;
      }
      case RT.LABEL:
      case RT.RSTRING: {
        const row = u16(body, 0);
        const column = u16(body, 2);
        flushed = addCell(row, plainCell(column, u16(body, 4), textCell(recordString([body], 6, row, column), row, column)));
        break;
      }
      case RT.NUMBER: {
        const row = u16(body, 0);
        const column = u16(body, 2);
        flushed = addCell(row, plainCell(column, u16(body, 4), numberCell(f64(body, 6), row, column)));
        break;
      }
      case RT.RK: {
        const row = u16(body, 0);
        const column = u16(body, 2);
        flushed = addCell(row, plainCell(column, u16(body, 4), numberCell(rkNumber(u32(body, 6)), row, column)));
        break;
      }
      case RT.MULRK: {
        const row = u16(body, 0);
        const first = u16(body, 2);
        const last = u16(body, body.byteLength - 2);
        if (last < first || 4 + (last - first + 1) * 6 + 2 !== body.byteLength) malformed();
        for (let column = first; column <= last; column += 1) {
          const at6 = 4 + (column - first) * 6;
          flushed = addCell(row, plainCell(column, u16(body, at6), numberCell(rkNumber(u32(body, at6 + 2)), row, column))) || flushed;
        }
        break;
      }
      case RT.BOOLERR: {
        const row = u16(body, 0);
        const column = u16(body, 2);
        const value = u8(body, 7) === 0 ? booleanValue(u8(body, 6) !== 0) : errorCell(u8(body, 6), row, column);
        flushed = addCell(row, plainCell(column, u16(body, 4), value));
        break;
      }
      case RT.BLANK:
        flushed = addCell(u16(body, 0), plainCell(u16(body, 2), u16(body, 4), null));
        break;
      case RT.MULBLANK: {
        const row = u16(body, 0);
        const first = u16(body, 2);
        const last = u16(body, body.byteLength - 2);
        if (last < first || 4 + (last - first + 1) * 2 + 2 !== body.byteLength) malformed();
        for (let column = first; column <= last; column += 1) {
          flushed = addCell(row, plainCell(column, u16(body, 4 + (column - first) * 2), null)) || flushed;
        }
        break;
      }
      case RT.FORMULA: {
        const { row, cell } = await formulaCell(record);
        flushed = addCell(row, cell);
        break;
      }
      case RT.MERGEDCELLS:
        for (let index = 0, count = u16(body, 0); index < count; index += 1) {
          const range = ref8(body, 2 + index * 8);
          if (range !== null) sink.push({ kind: "merge", range });
        }
        break;
      case RT.DV:
        if (isBiff8) validation(body);
        break;
      case RT.HLINK: {
        const anchor = ref8(body, 0);
        sink.push(preservedPart("hyperlink", at(anchor), anchor));
        break;
      }
      case RT.NOTE: {
        const anchor = { firstRow: u16(body, 0), firstColumn: u16(body, 2), lastRow: u16(body, 0), lastColumn: u16(body, 2) };
        sink.push(preservedPart("comment", at(anchor), anchor));
        break;
      }
      case RT.OBJ: {
        const kind = u16(body, 0) === 0x15 ? objectKindOf(u16(body, 4)) : null;
        if (kind !== null) sink.push(preservedPart(kind, sheet.name, null));
        break;
      }
      case RT.CONDFMT:
      case RT.CONDFMT12:
        conditionalFormats += 1;
        break;
    }
    if (flushed) yield;
  }
  throw new BoundExceededError("truncated-container");
}
