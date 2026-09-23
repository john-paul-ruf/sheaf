/**
 * The ODS adapter (M18; CA-17, D33, D39, FR-3, invariants 7 and 8): the
 * selected sheets of `content.xml`, in workbook order, as one V2 fact stream.
 *
 * Per selected table it emits the `sheet` fact (the first also carries the
 * workbook-wide facts: defined names, document scripts, DDE connections),
 * then each row — a `row` fact and, per cell in column order, an optional
 * `cell-format`, `formula` and `value` fact — with the structure the row
 * declares (merges, annotations, frames, links) after it, and at the end the
 * sheet's validations, declared tables (database ranges) and one
 * conditional-formatting / cell-styling part when used.
 *
 * **Repeats are expanded sparsely.** `table:number-rows-repeated` and
 * `table:number-columns-repeated` over empty cells only move the row index or
 * the column cursor: the million-row empty tail every spreadsheet writes costs
 * nothing. A repeated run of *populated* cells emits each cell, and every cell
 * a repeat adds beyond the cells actually written counts against
 * {@link ODS_MAX_REPEATED_CELLS}; crossing it is `expansion-limit`, before the
 * run is emitted.
 *
 * **Values.** Numbers (`float`, `percentage`, `currency`) become canonical
 * decimals (M65's shortest round-trip rule); `date` and `time` become Excel
 * 1900-system serial decimals with a date/time `cell-format`, exactly as an
 * XLSX date cell reads, so inference decides dates the same way for both;
 * booleans are booleans; strings are NFC text with a diagnostic when
 * normalized; error results are kept verbatim with `error-value`; a value that
 * does not fit its declared type is kept with `malformed-value`.
 *
 * **Formulas** are OpenFormula restated in Excel syntax where the mapping is
 * mechanical (`formula.ts`), else `text: null`; the cached result is the
 * ordinary value fact. Nothing is evaluated (D33).
 *
 * **Unknown sheet list.** When metadata could not name the sheets (see
 * `inventory.ts`), a selection cannot distinguish them: any non-empty
 * selection reads every table, an empty one reads none.
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
  WORKBOOK_FACTS_PER_BATCH,
  type ContainerHandleV1,
  type ImportDiagnosticCodeV2,
  type ParseSheetsOptionsV1,
  type PreservedPartKindV1,
  type RangeV1,
  type WorkbookAdapterV1,
  type WorkbookFactBatchV2,
  type WorkbookFactStreamItemV2,
  type WorkbookFactV2,
} from "../../facts/index.js";
import { BoundExceededError, CONTAINER_BOUNDS_V1 } from "../../source/bounds.js";
import { partEvents } from "../../source/opc.js";
import { tokenizeXml, type XmlEventV1, type XmlStartEventV1 } from "../../source/xml.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import { readDeclarations, type DatabaseRangeV1, type OdsDeclarationsV1 } from "./declarations.js";
import { convertOpenFormula, type ConvertedFormulaV1 } from "./formula.js";
import { CHART_MEDIA_TYPE, readManifest, readSheetList, type ManifestEntryV1 } from "./inventory.js";
import { cellFormatOf, createStyleCollector, resolveCellStyle, type CellFormatV1 } from "./styles.js";
import {
  attr,
  CALCEXT_NS,
  CONTENT_PART,
  countOf,
  DRAW_NS,
  locationOf,
  OFFICE_NS,
  parseOdfCell,
  SCRIPT_NS,
  STYLES_PART,
  TABLE_NS,
  TEXT_NS,
  XLINK_NS,
} from "./vocabulary.js";

/** Cells a repeat may add beyond the cells written: D31's cell budget. */
export const ODS_MAX_REPEATED_CELLS = 250_000;

/** Validation ranges one sheet may accumulate before it is refused. */
const MAX_VALIDATION_RANGES = 100_000;

const MAX_CELL_TEXT = CONTAINER_BOUNDS_V1.maxXmlAttributeValueBytes;
const { maxRow, maxColumn } = CONTAINER_BOUNDS_V1;
const WORKBOOK_LOCATION = "Workbook";

const SEVERITY: Readonly<Record<ImportDiagnosticCodeV2, "info" | "warning">> = Object.freeze({
  "text-normalized-nfc": "info",
  "unterminated-quote": "warning",
  "quote-inside-unquoted-field": "warning",
  "ragged-row": "warning",
  "replacement-character": "warning",
  "row-length-bound-reached": "warning",
  "error-value": "warning",
  "malformed-value": "warning",
});

const DRAW_OBJECTS = new Set([
  "frame",
  "rect",
  "line",
  "polyline",
  "polygon",
  "regular-polygon",
  "path",
  "circle",
  "ellipse",
  "custom-shape",
  "connector",
  "caption",
  "measure",
  "g",
  "control",
]);

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const ISO_DATE = /^(-?\d{4,6})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}(?:\.\d{1,9})?))?(?:Z|[+-]\d{2}:\d{2})?$/;
const DURATION = /^(-)?P(?:(\d{1,9})D)?(?:T(?:(\d{1,9})H)?(?:(\d{1,9})M)?(?:(\d{1,9}(?:\.\d{1,9})?)S)?)?$/;
const DAY_MS = 86_400_000;
const EPOCH_1899_12_30 = Date.UTC(1899, 11, 30) / DAY_MS;

const part = (
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

/** Days since 1899-12-30 as Excel's 1900-system serial (its phantom 1900-02-29 kept). */
const excelSerialOf = (days: number): number => (days >= 1 && days <= 60 ? days - 1 : days);

const dateSerialOf = (raw: string): number | null => {
  const match = ISO_DATE.exec(raw.trim());
  if (match === null) return null;
  const [, year, month, day, hours, minutes, seconds] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return null;
  }
  const clock = hours === undefined ? 0 : Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  if (clock >= 86_400) return null;
  return excelSerialOf(Math.round(date.getTime() / DAY_MS) - EPOCH_1899_12_30) + clock / 86_400;
};

const timeSerialOf = (raw: string): number | null => {
  const match = DURATION.exec(raw.trim());
  if (match === null || match.slice(2).every((part) => part === undefined)) return null;
  const [, sign, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
  return (sign === "-" ? -total : total) / 86_400;
};

/** Batching and diagnostics, the same contract every adapter keeps. */
function createEmitter(factsPerBatch: number) {
  const ready: WorkbookFactBatchV2[] = [];
  let facts: WorkbookFactV2[] = [];
  let batchSeq = 0;
  let rowCount = 0;
  let columnCount = 0;
  let valueCount = 0;
  const diagnostics = new Map<
    ImportDiagnosticCodeV2,
    { firstRowIndex: number | null; firstColumnIndex: number | null; occurrences: number }
  >();
  const cut = (): void => {
    if (facts.length > 0) {
      ready.push({ kind: "batch", batchSeq, facts });
      batchSeq += 1;
      facts = [];
    }
  };
  const push = (fact: WorkbookFactV2): void => {
    if (fact.kind === "row") {
      rowCount += 1;
      columnCount = Math.max(columnCount, fact.cellCount);
    } else if (fact.kind === "value") {
      valueCount += 1;
    }
    facts.push(fact);
    if (facts.length >= factsPerBatch) cut();
  };
  return {
    ready,
    push,
    cut,
    note(code: ImportDiagnosticCodeV2, rowIndex: number | null, columnIndex: number | null): void {
      const existing = diagnostics.get(code);
      if (existing !== undefined) {
        existing.occurrences += 1;
        return;
      }
      diagnostics.set(code, { firstRowIndex: rowIndex, firstColumnIndex: columnIndex, occurrences: 1 });
      push({
        kind: "diagnostic",
        diagnostic: { code, severity: SEVERITY[code], firstRowIndex: rowIndex, firstColumnIndex: columnIndex, occurrences: 1 },
      });
    },
    summary(): WorkbookFactStreamItemV2 {
      return {
        kind: "summary",
        rowCount,
        columnCount,
        valueCount,
        batchCount: batchSeq,
        diagnostics: [...diagnostics].map(([code, tally]) => ({ code, severity: SEVERITY[code], ...tally })),
      };
    },
  };
}

type Emitter = ReturnType<typeof createEmitter>;

interface CellPart {
  readonly partKind: PreservedPartKindV1;
  readonly partPath: string | null;
  readonly end: { readonly row: number; readonly column: number } | null;
}

interface OpenCell {
  readonly start: XmlStartEventV1;
  readonly column: number;
  readonly repeat: number;
  readonly styleName: string | null;
  text: string;
  paragraphs: number;
  paragraphDepth: number;
  annotationDepth: number;
  readonly parts: CellPart[];
}

interface FinishedCell {
  readonly column: number;
  readonly repeat: number;
  readonly value: CellValueV1 | null;
  readonly format: CellFormatV1 | null;
  readonly formula: ConvertedFormulaV1 | null;
  readonly isArray: boolean;
  readonly text: string;
  readonly validationName: string | null;
  readonly rowSpan: number;
  readonly columnSpan: number;
  readonly isStyled: boolean;
  readonly parts: readonly CellPart[];
}

interface OpenRow {
  readonly repeat: number;
  readonly defaultStyle: string | null;
  column: number;
  readonly cells: FinishedCell[];
}

interface OpenFrame {
  depth: number;
  kind: PreservedPartKindV1 | null;
  partPath: string | null;
  readonly end: { readonly row: number; readonly column: number } | null;
}

/** One selected sheet's streaming state. */
class SheetReader {
  private rowIndex = 0;
  private readonly columnStyles: { first: number; last: number; style: string }[] = [];
  private columnCursor = 0;
  private readonly columnFormats = new Map<number, string>();
  private readonly validationOpen = new Map<string, Map<string, { range: { firstRow: number; firstColumn: number; lastRow: number; lastColumn: number } }>>();
  private readonly validationRanges: { name: string; range: RangeV1 }[] = [];
  private readonly headers = new Map<DatabaseRangeV1, string[]>();
  private row: OpenRow | null = null;
  private cell: OpenCell | null = null;
  private cellDepth = 0;
  private frame: OpenFrame | null = null;
  private isStyled = false;
  private hasConditionalFormats = false;
  private scripts = 0;

  constructor(
    private readonly name: string,
    private readonly declarations: OdsDeclarationsV1,
    private readonly manifest: readonly ManifestEntryV1[],
    private readonly zip: ZipContainerHandleV1,
    private readonly emitter: Emitter,
    private readonly tables: readonly DatabaseRangeV1[],
    private readonly repeatBudget: { used: number },
  ) {
    for (const table of tables) this.headers.set(table, []);
  }

  /** Consumes one event inside the table; yields after every emitted row. */
  *accept(event: XmlEventV1): Generator<void, void, undefined> {
    if (this.frame !== null) {
      this.acceptFrame(event);
      return;
    }
    if (event.kind === "text") {
      const cell = this.cell;
      if (cell !== null && cell.paragraphDepth > 0 && cell.annotationDepth === 0) this.appendText(cell, event.value);
      return;
    }
    if (event.kind === "end") {
      yield* this.acceptEnd(event);
      return;
    }
    const cell = this.cell;
    if (event.uri === TABLE_NS && (event.local === "table-cell" || event.local === "covered-table-cell")) {
      this.cellDepth += 1;
      if (this.cellDepth === 1 && this.row !== null) this.openCell(event, this.row);
      return;
    }
    if (event.uri === SCRIPT_NS && event.local === "event-listener") {
      this.scripts += 1;
    } else if (event.uri === CALCEXT_NS && event.local === "conditional-format") {
      this.hasConditionalFormats = true;
    } else if (event.uri === DRAW_NS && DRAW_OBJECTS.has(event.local)) {
      const endAddress = attr(event, TABLE_NS, "end-cell-address");
      const end = endAddress === null ? null : parseOdfCell(endAddress);
      this.frame = {
        depth: 1,
        kind: event.local === "control" ? "form-control" : event.local === "frame" ? null : "drawing",
        partPath: null,
        end: end === null || end.row === null || end.column === null ? null : { row: end.row, column: end.column },
      };
    } else if (cell !== null && this.cellDepth > 0) {
      this.acceptCellContent(event, cell);
    } else if (this.cellDepth === 0 && event.uri === TABLE_NS) {
      this.acceptStructure(event);
    }
  }

  private acceptStructure(event: XmlStartEventV1): void {
    if (event.local === "table-column") {
      const repeat = countOf(attr(event, TABLE_NS, "number-columns-repeated"));
      const style = attr(event, TABLE_NS, "default-cell-style-name");
      if (style !== null && this.columnCursor < maxColumn) {
        this.columnStyles.push({ first: this.columnCursor, last: this.columnCursor + repeat - 1, style });
      }
      this.columnCursor += repeat;
    } else if (event.local === "table-row") {
      this.row = {
        repeat: countOf(attr(event, TABLE_NS, "number-rows-repeated")),
        defaultStyle: attr(event, TABLE_NS, "default-cell-style-name"),
        column: 0,
        cells: [],
      };
    } else if (event.local === "table-source") {
      this.emitter.push(part("external-link", this.name, null, null));
    }
  }

  private acceptCellContent(event: XmlStartEventV1, cell: OpenCell): void {
    if (event.uri === OFFICE_NS && event.local === "annotation") {
      cell.annotationDepth += 1;
      if (cell.annotationDepth === 1) cell.parts.push({ partKind: "comment", partPath: null, end: null });
      return;
    }
    if (cell.annotationDepth > 0) return;
    if (event.uri === TABLE_NS && event.local === "cell-range-source") {
      cell.parts.push({ partKind: "external-link", partPath: null, end: null });
    } else if (event.uri !== TEXT_NS) {
      return;
    } else if (event.local === "p" || event.local === "h") {
      if (cell.paragraphDepth === 0 && cell.paragraphs > 0) this.appendText(cell, "\n");
      if (cell.paragraphDepth === 0) cell.paragraphs += 1;
      cell.paragraphDepth += 1;
    } else if (cell.paragraphDepth === 0) {
      return;
    } else if (event.local === "s") {
      this.appendText(cell, " ".repeat(Math.min(countOf(attr(event, TEXT_NS, "c")), MAX_CELL_TEXT - cell.text.length + 1)));
    } else if (event.local === "tab") {
      this.appendText(cell, "\t");
    } else if (event.local === "line-break") {
      this.appendText(cell, "\n");
    } else if (event.local === "a") {
      cell.parts.push({ partKind: "hyperlink", partPath: null, end: null });
    }
  }

  private appendText(cell: OpenCell, text: string): void {
    cell.text += text;
    if (cell.text.length > MAX_CELL_TEXT) throw new BoundExceededError("malformed-structure");
  }

  private acceptFrame(event: XmlEventV1): void {
    const frame = this.frame as OpenFrame;
    if (event.kind === "start") {
      frame.depth += 1;
      if (event.uri === DRAW_NS && event.local === "object") {
        const path = this.internalPath(attr(event, XLINK_NS, "href"));
        const isChart =
          attr(event, DRAW_NS, "notify-on-update-of-ranges") !== null ||
          (path !== null && this.manifest.some((entry) => entry.fullPath.replace(/\/$/, "") === path && entry.mediaType === CHART_MEDIA_TYPE));
        frame.kind ??= isChart ? "chart" : "embedded-object";
        frame.partPath ??= path;
      } else if (event.uri === DRAW_NS && (event.local === "object-ole" || event.local === "plugin" || event.local === "applet")) {
        frame.kind ??= "embedded-object";
        frame.partPath ??= this.internalPath(attr(event, XLINK_NS, "href"));
      } else if (event.uri === DRAW_NS && event.local === "image") {
        frame.kind ??= "image";
        frame.partPath ??= this.internalPath(attr(event, XLINK_NS, "href"));
      } else if (event.uri === SCRIPT_NS && event.local === "event-listener") {
        this.scripts += 1;
      }
    } else if (event.kind === "end") {
      frame.depth -= 1;
      if (frame.depth === 0) {
        this.frame = null;
        const kind = frame.kind ?? "drawing";
        if (this.cell === null) {
          this.emitter.push(part(kind, this.name, null, frame.partPath));
        } else {
          this.cell.parts.push({ partKind: kind, partPath: frame.partPath, end: frame.end });
        }
      }
    }
  }

  /** A package part named by an `xlink:href`, or `null` when it points outside. */
  private internalPath(href: string | null): string | null {
    if (href === null || /^[A-Za-z][\w+.-]*:/.test(href) || href.startsWith("/") || href.includes("..")) return null;
    const path = href.replace(/^\.\//, "").replace(/\/$/, "");
    return this.zip.has(path) || this.manifest.some((entry) => entry.fullPath.replace(/\/$/, "") === path) ? path : null;
  }

  private openCell(event: XmlStartEventV1, row: OpenRow): void {
    const column = row.column;
    this.cell = {
      start: event,
      column,
      repeat: countOf(attr(event, TABLE_NS, "number-columns-repeated")),
      styleName: attr(event, TABLE_NS, "style-name") ?? row.defaultStyle ?? this.columnStyleAt(column),
      text: "",
      paragraphs: 0,
      paragraphDepth: 0,
      annotationDepth: 0,
      parts: [],
    };
  }

  private columnStyleAt(column: number): string | null {
    return this.columnStyles.find((run) => run.first <= column && column <= run.last)?.style ?? null;
  }

  private *acceptEnd(event: Extract<XmlEventV1, { kind: "end" }>): Generator<void, void, undefined> {
    const cell = this.cell;
    if (event.uri === TABLE_NS && (event.local === "table-cell" || event.local === "covered-table-cell")) {
      this.cellDepth -= 1;
      if (this.cellDepth === 0 && cell !== null && this.row !== null) {
        this.row.cells.push(this.finishCell(cell));
        this.row.column += cell.repeat;
        this.cell = null;
      }
    } else if (cell !== null && event.uri === OFFICE_NS && event.local === "annotation") {
      cell.annotationDepth -= 1;
    } else if (cell !== null && event.uri === TEXT_NS && (event.local === "p" || event.local === "h") && cell.annotationDepth === 0) {
      cell.paragraphDepth = Math.max(0, cell.paragraphDepth - 1);
    } else if (this.cellDepth === 0 && event.uri === TABLE_NS && event.local === "table-row" && this.row !== null) {
      const row = this.row;
      this.row = null;
      yield* this.emitRow(row);
    }
  }

  private finishCell(cell: OpenCell): FinishedCell {
    const event = cell.start;
    const row = this.rowIndex;
    const valueType = attr(event, OFFICE_NS, "value-type");
    const { dataStyle, isVisual } = resolveCellStyle(this.declarations.styles, cell.styleName);
    const value = this.valueOf(event, valueType, cell.text, row, cell.column);
    const raw = attr(event, TABLE_NS, "formula");
    const isArray =
      attr(event, TABLE_NS, "number-matrix-columns-spanned") !== null ||
      attr(event, TABLE_NS, "number-matrix-rows-spanned") !== null;
    return {
      column: cell.column,
      repeat: cell.repeat,
      value,
      format: value === null ? null : cellFormatOf(valueType ?? "string", dataStyle, attr(event, OFFICE_NS, "currency")),
      formula: raw === null ? null : convertOpenFormula(raw),
      isArray,
      text: cell.text,
      validationName: attr(event, TABLE_NS, "content-validation-name"),
      rowSpan: countOf(attr(event, TABLE_NS, "number-rows-spanned")),
      columnSpan: countOf(attr(event, TABLE_NS, "number-columns-spanned")),
      isStyled: isVisual,
      parts: cell.parts,
    };
  }

  private valueOf(
    event: XmlStartEventV1,
    valueType: string | null,
    display: string,
    row: number,
    column: number,
  ): CellValueV1 | null {
    const kept = (text: string | null, code: ImportDiagnosticCodeV2): CellValueV1 | null => {
      const source = text !== null && text !== "" ? text : display;
      if (source === "") return null;
      this.emitter.note(code, row, column);
      return invalidPreservedValue(source.normalize("NFC"));
    };
    const serial = (raw: string | null, read: (text: string) => number | null): CellValueV1 | null => {
      const number = raw === null ? null : read(raw);
      return (number === null ? null : decimalCellOfDouble(number)) ?? kept(raw, "malformed-value");
    };
    if (attr(event, CALCEXT_NS, "value-type") === "error") return kept(display, "error-value");
    switch (valueType) {
      case null:
      case "string": {
        const text = attr(event, OFFICE_NS, "string-value") ?? display;
        if (text === "") return null;
        const normalized = text.normalize("NFC");
        if (normalized !== text) this.emitter.note("text-normalized-nfc", row, column);
        return textValue(normalized);
      }
      case "void":
        return null;
      case "float":
      case "percentage":
      case "currency": {
        const raw = attr(event, OFFICE_NS, "value");
        return serial(raw, (text) => (NUMBER.test(text.trim()) ? Number(text) : null));
      }
      case "date":
        return serial(attr(event, OFFICE_NS, "date-value"), dateSerialOf);
      case "time":
        return serial(attr(event, OFFICE_NS, "time-value"), timeSerialOf);
      case "boolean": {
        const raw = attr(event, OFFICE_NS, "boolean-value");
        if (raw === "true" || raw === "1") return booleanValue(true);
        if (raw === "false" || raw === "0") return booleanValue(false);
        return kept(raw, "malformed-value");
      }
      default:
        return kept(display, "malformed-value");
    }
  }

  private spend(cells: number): void {
    this.repeatBudget.used += cells;
    if (this.repeatBudget.used > ODS_MAX_REPEATED_CELLS) throw new BoundExceededError("expansion-limit");
  }

  private *emitRow(row: OpenRow): Generator<void, void, undefined> {
    const first = this.rowIndex;
    this.rowIndex += row.repeat;
    const populated = row.cells.filter((cell) => cell.value !== null || cell.formula !== null);
    if (populated.length > 0) {
      const last = populated.at(-1) as FinishedCell;
      if (first + row.repeat > maxRow || last.column + last.repeat > maxColumn) {
        throw new BoundExceededError("impossible-dimension");
      }
      const written = populated.reduce((sum, cell) => sum + cell.repeat, 0);
      this.spend(row.repeat * written - populated.length);
      const cellCount = last.column + last.repeat;
      for (let offset = 0; offset < row.repeat; offset += 1) {
        this.emitCells(first + offset, cellCount, populated);
        yield;
      }
    }
    if (first < maxRow) this.emitStructure(first, row);
  }

  private emitCells(rowIndex: number, cellCount: number, cells: readonly FinishedCell[]): void {
    const { push } = this.emitter;
    push({ kind: "row", rowIndex, cellCount });
    for (const table of this.tables) {
      if (table.headerRowCount === 1 && table.range.firstRow === rowIndex) {
        const names = this.headers.get(table) as string[];
        for (const cell of cells) {
          for (let column = cell.column; column < cell.column + cell.repeat; column += 1) {
            if (column >= table.range.firstColumn && column <= table.range.lastColumn) {
              names[column - table.range.firstColumn] = cell.text.normalize("NFC");
            }
          }
        }
      }
    }
    for (const cell of cells) {
      for (let columnIndex = cell.column; columnIndex < cell.column + cell.repeat; columnIndex += 1) {
        const format = cell.format;
        if (cell.value !== null && format !== null && format.numberFormat !== (this.columnFormats.get(columnIndex) ?? "General")) {
          this.columnFormats.set(columnIndex, format.numberFormat);
          push({ kind: "cell-format", rowIndex, columnIndex, ...format });
        }
        if (cell.formula !== null) {
          push({
            kind: "formula",
            rowIndex,
            columnIndex,
            text: cell.formula.text?.normalize("NFC") ?? null,
            sharedGroup: null,
            isArray: cell.isArray,
            isExternal: cell.formula.isExternal,
          });
        }
        if (cell.value !== null) push({ kind: "value", rowIndex, columnIndex, value: cell.value });
      }
    }
  }

  /** Merges, validations, parts and styling a row declares, populated or not. */
  private emitStructure(first: number, row: OpenRow): void {
    const lastRow = Math.min(first + row.repeat, maxRow) - 1;
    const runs: { readonly name: string; readonly firstColumn: number; lastColumn: number }[] = [];
    for (const cell of row.cells) {
      if (cell.column >= maxColumn) break;
      const lastColumn = Math.min(cell.column + cell.repeat, maxColumn) - 1;
      this.isStyled ||= cell.isStyled;
      const name = cell.validationName;
      const previous = runs.at(-1);
      if (name !== null && previous?.name === name && previous.lastColumn + 1 === cell.column) {
        previous.lastColumn = lastColumn;
      } else if (name !== null) {
        runs.push({ name, firstColumn: cell.column, lastColumn });
      }
      if (cell.rowSpan > 1 || cell.columnSpan > 1) {
        this.spend(row.repeat * cell.repeat - 1);
        for (let rowIndex = first; rowIndex <= lastRow; rowIndex += 1) {
          for (let column = cell.column; column <= lastColumn; column += 1) {
            this.emitter.push({
              kind: "merge",
              range: {
                firstRow: rowIndex,
                firstColumn: column,
                lastRow: Math.min(rowIndex + cell.rowSpan, maxRow) - 1,
                lastColumn: Math.min(column + cell.columnSpan, maxColumn) - 1,
              },
            });
          }
        }
      }
      for (const cellPart of cell.parts) {
        const anchor = {
          firstRow: first,
          firstColumn: cell.column,
          lastRow: Math.max(lastRow, Math.min(cellPart.end?.row ?? 0, maxRow - 1)),
          lastColumn: Math.max(lastColumn, Math.min(cellPart.end?.column ?? 0, maxColumn - 1)),
        };
        this.emitter.push(part(cellPart.partKind, locationOf(this.name, anchor), anchor, cellPart.partPath));
      }
    }
    for (const run of runs) this.addValidation(run.name, first, lastRow, run.firstColumn, run.lastColumn);
  }

  private addValidation(name: string, firstRow: number, lastRow: number, firstColumn: number, lastColumn: number): void {
    let open = this.validationOpen.get(name);
    if (open === undefined) {
      open = new Map();
      this.validationOpen.set(name, open);
    }
    const key = `${firstColumn}:${lastColumn}`;
    const existing = open.get(key);
    if (existing !== undefined && existing.range.lastRow + 1 === firstRow) {
      existing.range.lastRow = lastRow;
      return;
    }
    const entry = { range: { firstRow, firstColumn, lastRow, lastColumn } };
    if (this.validationRanges.length >= MAX_VALIDATION_RANGES) throw new BoundExceededError("expansion-limit");
    this.validationRanges.push({ name, range: entry.range });
    open.set(key, entry);
  }

  /** The facts only the whole sheet can state. */
  finish(): void {
    const { push } = this.emitter;
    for (const { name, range } of this.validationRanges) {
      const declaration = this.declarations.validations.get(name);
      if (declaration === undefined) continue;
      if (declaration.kind === "unsupported") {
        push(part("unsupported-validation", locationOf(this.name, range), range, null));
      } else {
        push({
          kind: "validation",
          range: { ...range },
          rule: declaration.rule,
          operator: declaration.operator,
          listSource: declaration.listSource,
          formula1: declaration.formula1,
          formula2: declaration.formula2,
        });
      }
    }
    for (const table of this.tables) {
      const names = this.headers.get(table) as string[];
      const width = table.range.lastColumn - table.range.firstColumn + 1;
      push({
        kind: "declared-table",
        name: table.name,
        range: table.range,
        headerRowCount: table.headerRowCount,
        totalsRowCount: 0,
        columns: Array.from({ length: width }, (_, index) => names[index] ?? ""),
      });
    }
    for (let index = 0; index < this.scripts; index += 1) push(part("script", this.name, null, null));
    if (this.hasConditionalFormats) push(part("conditional-formatting", this.name, null, null));
    if (this.isStyled) push(part("cell-styling", this.name, null, null));
  }
}

async function* parseSheets(
  container: ContainerHandleV1,
  selection: readonly number[],
  options: ParseSheetsOptionsV1,
): AsyncGenerator<WorkbookFactStreamItemV2, void, undefined> {
  if (container.kind !== "zip") {
    throw new BoundExceededError("unrecognized-content");
  }
  const zip = container.zip;
  const factsPerBatch = Math.max(1, Math.floor(options.factsPerBatch ?? WORKBOOK_FACTS_PER_BATCH));
  const cancellation = options.cancellation;

  const manifest = await readManifest(zip);
  const collector = createStyleCollector();
  if (zip.has(STYLES_PART)) {
    for await (const event of partEvents(zip, STYLES_PART)) collector.accept(event);
  }
  const declarations = await readDeclarations(zip, collector);
  const { isKnown } = await readSheetList(zip);
  const isSelected = (sheetIndex: number): boolean =>
    isKnown ? selection.includes(sheetIndex) : selection.length > 0;

  const emitter = createEmitter(factsPerBatch);
  const repeatBudget = { used: 0 };

  function* drain(): Generator<WorkbookFactStreamItemV2, boolean, undefined> {
    while (emitter.ready.length > 0) {
      yield emitter.ready.shift() as WorkbookFactBatchV2;
      if (cancellation.aborted) return false;
    }
    return true;
  }

  let spreadsheetDepth: number | null = null;
  let tableIndex = -1;
  let depth = 0;
  let tableDepth: number | null = null;
  let hasOpenedSheet = false;
  let reader: SheetReader | null = null;

  for await (const event of tokenizeXml(zip.streamEntry(CONTENT_PART))) {
    if (event.kind === "start") depth += 1;
    if (spreadsheetDepth === null) {
      if (event.kind === "start" && event.uri === OFFICE_NS && event.local === "spreadsheet") spreadsheetDepth = depth;
    } else if (tableDepth === null) {
      if (event.kind === "start" && event.uri === TABLE_NS && event.local === "table" && depth === spreadsheetDepth + 1) {
        tableIndex += 1;
        tableDepth = depth;
        const table = declarations.tables[tableIndex];
        if (table !== undefined && isSelected(tableIndex)) {
          emitter.push({
            kind: "sheet",
            sheetIndex: tableIndex,
            name: table.name,
            sheetKind: "worksheet",
            visibility: table.isHidden ? "hidden" : "visible",
            declaredRange: null,
            dateSystem: "1900",
          });
          if (!hasOpenedSheet) {
            hasOpenedSheet = true;
            for (const name of declarations.definedNames) emitter.push({ kind: "defined-name", ...name });
            for (let index = 0; index < declarations.documentScripts; index += 1) {
              emitter.push(part("script", WORKBOOK_LOCATION, null, null));
            }
            for (let index = 0; index < declarations.documentConnections; index += 1) {
              emitter.push(part("data-connection", WORKBOOK_LOCATION, null, null));
            }
          }
          const tables = declarations.databaseRanges.filter(
            (range) => declarations.tables.findIndex((each) => each.name === range.sheetName) === tableIndex,
          );
          reader = new SheetReader(table.name, declarations, manifest, zip, emitter, tables, repeatBudget);
        }
      }
    } else if (event.kind === "end" && depth === tableDepth) {
      reader?.finish();
      reader = null;
      tableDepth = null;
    } else if (reader !== null) {
      const steps = reader.accept(event);
      for (let step = steps.next(); step.done !== true; step = steps.next()) {
        if (!(yield* drain())) return;
      }
    }
    if (event.kind === "end") depth -= 1;
    if (!(yield* drain())) return;
  }
  emitter.cut();
  if (!(yield* drain())) return;
  yield emitter.summary();
}

/** The ODS adapter the import worker registers (D35). */
export const odsAdapter: WorkbookAdapterV1 = Object.freeze({
  format: "ods",
  parseSheets,
});
