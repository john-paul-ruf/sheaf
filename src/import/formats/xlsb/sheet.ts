/**
 * One XLSB sheet part, streamed into V2 facts (M16; CA-17, FR-3, invariants
 * 7 and 8) — the same fact order, sparsity and value rules as the OOXML and
 * BIFF adapters.
 *
 * Records are read one at a time. A row's cells (`BrtCell*`, the compact
 * `BrtShort*` whose column follows the previous cell's, and `BrtFmla*`) are
 * gathered, then emitted as a `row` fact followed, per cell in column order,
 * by an optional `cell-format`, `formula` and `value` fact. A blank cell
 * widens its row but is never a value fact.
 *
 * Formulas are decompiled through M17's shared `Ptg` decoder with BIFF12
 * operand widths (D34) and never evaluated: a shared formula's master carries
 * its text and group (`BrtShrFmla`), each member only the group; an array
 * formula's master carries its text (`BrtArrFmla`); a token stream the decoder
 * cannot read keeps its cached value and becomes an inert `formula` part.
 */

import {
  booleanValue,
  invalidPreservedValue,
  textValue,
  type CellValueV1,
} from "../../../domain/model/values.js";
import {
  decimalCellOfDouble,
  PRESERVED_REASON_BY_KIND,
  type ImportDiagnosticCodeV2,
  type PreservedPartKindV1,
  type RangeV1,
  type ValidationListSourceV1,
  type ValidationOperatorV1,
  type ValidationRuleV1,
  type WorkbookFactV2,
} from "../../facts/index.js";
import { BoundExceededError, isBoundExceeded } from "../../source/bounds.js";
import { readRelationships, relationshipKind } from "../../source/opc.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import { decodePtgFormula, ERROR_TEXT, locationOf, ptgExpOf } from "../biff/ptg.js";
import { DEFAULT_CELL_STYLE, readCommentAnchors, readDrawingObjects, readTablePart, type CellStyleV1 } from "./parts.js";
import { BodyReaderV1, BRT, gridRange, malformed, openXlsbRecords, rkNumber } from "./records.js";
import { parsedFormula, ptgContextOf, type XlsbSheetEntryV1, type XlsbWorkbookV1 } from "./workbook.js";

/** Where facts go; batching and diagnostic tallies live with the caller. */
export interface FactSinkV1 {
  push(fact: WorkbookFactV2): void;
  note(code: ImportDiagnosticCodeV2, rowIndex: number | null, columnIndex: number | null): void;
}

export interface XlsbSheetSourcesV1 {
  readonly zip: ZipContainerHandleV1;
  readonly workbook: XlsbWorkbookV1;
  readonly strings: readonly string[];
  readonly styles: readonly CellStyleV1[];
}

export const preservedPart = (
  partKind: PreservedPartKindV1,
  location: string,
  anchor: RangeV1 | null,
  partPath: string | null,
): WorkbookFactV2 => ({
  kind: "preserved-part",
  partKind,
  location,
  reasonKey: PRESERVED_REASON_BY_KIND[partKind],
  anchor,
  partPath,
});

/**
 * The facts a sheet's relationships declare — tables and every inert part
 * stored beside the sheet — emitted after its `sheet` fact, before its rows.
 */
export async function sheetPartFacts(zip: ZipContainerHandleV1, sheet: XlsbSheetEntryV1): Promise<WorkbookFactV2[]> {
  const facts: WorkbookFactV2[] = [];
  const at = (range: RangeV1 | null) => locationOf(sheet.name, range);
  for (const relationship of await readRelationships(zip, sheet.partName)) {
    if (relationship.isExternal || !zip.has(relationship.target)) continue;
    const target = relationship.target;
    switch (relationshipKind(relationship.type)) {
      case "table": {
        const table = await readTablePart(zip, target);
        if (table !== null) facts.push({ kind: "declared-table", ...table });
        break;
      }
      case "drawing":
        for (const object of await readDrawingObjects(zip, target)) {
          facts.push(preservedPart(object.partKind, at(object.anchor), object.anchor, object.partPath ?? target));
        }
        break;
      case "comments":
        for (const anchor of await readCommentAnchors(zip, target)) facts.push(preservedPart("comment", at(anchor), anchor, target));
        break;
      case "pivottable":
        facts.push(preservedPart("pivot-table", at(null), null, target));
        break;
      case "oleobject":
      case "package":
        facts.push(preservedPart("embedded-object", at(null), null, target));
        break;
      case "ctrlprop":
        facts.push(preservedPart("form-control", at(null), null, target));
        break;
    }
  }
  return facts;
}

interface PendingCell {
  readonly column: number;
  readonly style: number;
  readonly value: CellValueV1 | null;
  readonly formula: WorkbookFactV2 | null;
  readonly isUndecodable: boolean;
  /** Diagnostics met reading the value; noted when the row is emitted, as the OOXML adapter notes them. */
  readonly notes: readonly ImportDiagnosticCodeV2[];
}

interface FormulaGroup {
  readonly id: number;
  readonly range: RangeV1;
}

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

const SHORT_CELLS: ReadonlySet<number> = new Set([
  BRT.SHORT_BLANK,
  BRT.SHORT_RK,
  BRT.SHORT_ERROR,
  BRT.SHORT_BOOL,
  BRT.SHORT_REAL,
  BRT.SHORT_ST,
  BRT.SHORT_ISST,
]);
const FORMULA_CELLS: ReadonlySet<number> = new Set([BRT.FMLA_STRING, BRT.FMLA_NUM, BRT.FMLA_BOOL, BRT.FMLA_ERROR]);

const isExternalFormula = (text: string): boolean => /\[\d+\]/.test(text.replace(/"[^"]*"/g, ""));

const contains = (range: RangeV1, row: number, column: number): boolean =>
  row >= range.firstRow && row <= range.lastRow && column >= range.firstColumn && column <= range.lastColumn;

/** A range inside the grid, or `null` for one a sheet may not name. */
const rangeOrNull = (reader: BodyReaderV1): RangeV1 | null => {
  const rfx = reader.rfx();
  try {
    return gridRange(rfx);
  } catch (cause) {
    if (isBoundExceeded(cause)) return null;
    throw cause;
  }
};

/**
 * Streams one worksheet (or dialog sheet) part into `sink`, yielding after
 * every row so the caller can cut batches and observe cancellation.
 */
export async function* streamXlsbSheet(
  sources: XlsbSheetSourcesV1,
  sheet: XlsbSheetEntryV1,
  sink: FactSinkV1,
): AsyncGenerator<void, void, undefined> {
  const { zip, workbook, strings, styles } = sources;
  const columnFormats = new Map<number, string>();
  const sharedGroups: FormulaGroup[] = [];
  const arrayRanges: RangeV1[] = [];
  const relationships = new Map((await readRelationships(zip, sheet.partName)).map((each) => [each.id, each]));
  let rowIndex: number | null = null;
  let lastRowIndex = -1;
  let previousColumn = -1;
  let cells: PendingCell[] = [];
  let isStyled = false;
  let conditionalFormats = 0;
  const at = (range: RangeV1 | null): string => locationOf(sheet.name, range);

  let notes: ImportDiagnosticCodeV2[] = [];
  const takeNotes = (): ImportDiagnosticCodeV2[] => {
    const taken = notes;
    notes = [];
    return taken;
  };
  const textCell = (raw: string): CellValueV1 | null => {
    if (raw === "") return null;
    const text = raw.normalize("NFC");
    if (text !== raw) notes.push("text-normalized-nfc");
    return textValue(text);
  };
  const kept = (raw: string, code: ImportDiagnosticCodeV2): CellValueV1 => {
    notes.push(code);
    return invalidPreservedValue(raw.normalize("NFC"));
  };
  const numberCell = (value: number): CellValueV1 =>
    decimalCellOfDouble(value) ?? kept(String(value), "malformed-value");
  const errorCell = (code: number): CellValueV1 =>
    kept(ERROR_TEXT.get(code) ?? "#N/A", "error-value");

  const flushRow = (): void => {
    const row = rowIndex;
    if (row === null || cells.length === 0) {
      cells = [];
      return;
    }
    cells.sort((left, right) => left.column - right.column);
    sink.push({ kind: "row", rowIndex: row, cellCount: (cells.at(-1) as PendingCell).column + 1 });
    let seen = -1;
    for (const cell of cells) {
      if (cell.column === seen) malformed();
      seen = cell.column;
      for (const code of cell.notes) sink.note(code, row, cell.column);
      const style = styles[cell.style] ?? DEFAULT_CELL_STYLE;
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
        sink.push(preservedPart("formula", at(anchor), anchor, null));
      }
      if (cell.value !== null) sink.push({ kind: "value", rowIndex: row, columnIndex: cell.column, value: cell.value });
    }
    cells = [];
  };

  const validation = (reader: BodyReaderV1): void => {
    const flags = reader.u32();
    const count = reader.u32();
    if (count > reader.remaining / 16) malformed();
    const ranges: RangeV1[] = [];
    for (let index = 0; index < count; index += 1) {
      const range = rangeOrNull(reader);
      if (range !== null) ranges.push(range);
    }
    for (let index = 0; index < 4; index += 1) reader.nullableWide();
    const first = parsedFormula(reader);
    const second = parsedFormula(reader);
    const rule = VALIDATION_TYPES[flags & 0x0f] ?? null;
    const origin = ranges[0];
    if (rule === null || origin === undefined) return;
    const context = ptgContextOf(workbook, { row: origin.firstRow, column: origin.firstColumn });
    const textOf = (formula: { rgce: Uint8Array; rgcb: Uint8Array }): string | null | undefined => {
      if (formula.rgce.byteLength === 0) return null;
      const decoded = decodePtgFormula(formula.rgce, context, formula.rgcb);
      return "text" in decoded ? decoded.text.normalize("NFC") : undefined;
    };
    let formula1 = textOf(first);
    const formula2 = textOf(second);
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
      for (const range of ranges) sink.push(preservedPart("unsupported-validation", at(range), range, null));
      return;
    }
    const operator = rule === "list" || rule === "custom" ? null : (VALIDATION_OPERATORS[(flags >>> 20) & 0x0f] ?? null);
    for (const range of ranges) sink.push({ kind: "validation", range, rule, operator, listSource, formula1, formula2 });
  };

  const records = openXlsbRecords(zip.streamEntry(sheet.partName));
  try {
    for (let record = await records.next(); record !== null; record = await records.next()) {
      const reader = new BodyReaderV1(record.body);
      const type = record.type;
      if (type === BRT.ROW_HDR) {
        flushRow();
        const row = reader.u32();
        if (row >= 1_048_576) throw new BoundExceededError("impossible-dimension");
        if (row <= lastRowIndex) malformed();
        rowIndex = row;
        lastRowIndex = row;
        previousColumn = -1;
        yield;
        continue;
      }
      const isShort = SHORT_CELLS.has(type);
      if (isShort || (type >= BRT.CELL_BLANK && type <= BRT.FMLA_ERROR) || type === BRT.CELL_RSTRING) {
        const row: number = rowIndex ?? malformed();
        const column = isShort ? previousColumn + 1 : reader.u32();
        const style = reader.u32() & 0xffffff;
        if (column >= 16_384) throw new BoundExceededError("impossible-dimension");
        previousColumn = column;
        let value: CellValueV1 | null = null;
        switch (type) {
          case BRT.CELL_RK:
          case BRT.SHORT_RK:
            value = numberCell(rkNumber(reader.u32()));
            break;
          case BRT.CELL_ERROR:
          case BRT.SHORT_ERROR:
          case BRT.FMLA_ERROR:
            value = errorCell(reader.u8());
            break;
          case BRT.CELL_BOOL:
          case BRT.SHORT_BOOL:
          case BRT.FMLA_BOOL:
            value = booleanValue(reader.u8() !== 0);
            break;
          case BRT.CELL_REAL:
          case BRT.SHORT_REAL:
          case BRT.FMLA_NUM:
            value = numberCell(reader.f64());
            break;
          case BRT.CELL_ST:
          case BRT.SHORT_ST:
          case BRT.FMLA_STRING:
            value = textCell(reader.wide());
            break;
          case BRT.CELL_RSTRING:
            reader.u8();
            value = textCell(reader.wide());
            break;
          case BRT.CELL_ISST:
          case BRT.SHORT_ISST: {
            const index = reader.u32();
            const text = strings[index];
            value = text === undefined ? kept(String(index), "malformed-value") : textCell(text);
            break;
          }
        }
        if (!FORMULA_CELLS.has(type)) {
          cells.push({ column, style, value, formula: null, isUndecodable: false, notes: takeNotes() });
          continue;
        }

        reader.u16();
        const { rgce, rgcb } = parsedFormula(reader);
        let text: string | null = null;
        let sharedGroup: number | null = null;
        let isArray = false;
        let isArrayMember = false;
        const exp = ptgExpOf(rgce, "biff12");
        const following = exp === null ? null : await records.peekType();
        if (exp !== null && exp.row === row && following === BRT.SHR_FMLA) {
          const shared = new BodyReaderV1(((await records.next()) ?? malformed()).body);
          const range = rangeOrNull(shared) ?? malformed();
          const formula = parsedFormula(shared);
          const group = { id: sharedGroups.length, range };
          sharedGroups.push(group);
          sharedGroup = group.id;
          const decoded = decodePtgFormula(formula.rgce, ptgContextOf(workbook, { row, column }, true), formula.rgcb);
          text = "text" in decoded ? decoded.text : null;
        } else if (exp !== null && exp.row === row && following === BRT.ARR_FMLA) {
          const array = new BodyReaderV1(((await records.next()) ?? malformed()).body);
          const range = rangeOrNull(array) ?? malformed();
          array.u8();
          const formula = parsedFormula(array);
          arrayRanges.push(range);
          isArray = true;
          const decoded = decodePtgFormula(formula.rgce, ptgContextOf(workbook, { row, column }), formula.rgcb);
          text = "text" in decoded ? decoded.text : null;
        } else if (exp !== null) {
          const group = sharedGroups.find((each) => each.range.firstRow === exp.row && contains(each.range, row, column));
          sharedGroup = group?.id ?? null;
          isArrayMember = group === undefined && arrayRanges.some((range) => range.firstRow === exp.row && contains(range, row, column));
        } else {
          const decoded = decodePtgFormula(rgce, ptgContextOf(workbook, { row, column }), rgcb);
          text = "text" in decoded ? decoded.text : null;
        }
        if (isArrayMember) {
          cells.push({ column, style, value, formula: null, isUndecodable: false, notes: takeNotes() });
          continue;
        }
        cells.push({
          column,
          style,
          value,
          isUndecodable: text === null && sharedGroup === null,
          notes: takeNotes(),
          formula: {
            kind: "formula",
            rowIndex: row,
            columnIndex: column,
            text: text === null ? null : text.normalize("NFC"),
            sharedGroup,
            isArray,
            isExternal: text !== null && isExternalFormula(text),
          },
        });
        continue;
      }
      switch (type) {
        case BRT.END_SHEET_DATA:
          flushRow();
          rowIndex = null;
          yield;
          break;
        case BRT.MERGE_CELL: {
          const range = rangeOrNull(reader);
          if (range !== null) sink.push({ kind: "merge", range });
          break;
        }
        case BRT.DVAL:
          validation(reader);
          break;
        case BRT.HLINK: {
          const anchor = rangeOrNull(reader);
          const relationship = relationships.get(reader.nullableWide() ?? "");
          sink.push(
            preservedPart("hyperlink", at(anchor), anchor, relationship !== undefined && !relationship.isExternal ? relationship.target : null),
          );
          break;
        }
        case BRT.BEGIN_COND_FORMATTING:
          conditionalFormats += 1;
          break;
      }
    }
  } finally {
    await records.close();
  }
  flushRow();
  if (conditionalFormats > 0) sink.push(preservedPart("conditional-formatting", sheet.name, null, null));
  if (isStyled) sink.push(preservedPart("cell-styling", sheet.name, null, null));
}
