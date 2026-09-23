/**
 * The legacy HTML-table adapter (M20; CA-17, D39, invariant 8): the selected
 * top-level tables of an Excel "Save as Web Page" export — or any HTML file
 * whose content is a table — as one **value-only** V2 fact stream.
 *
 * Per selected table: the `sheet` fact (the first also carries the
 * document-level inert parts seen before it, at `Workbook`), then each row — a
 * `row` fact whose `cellCount` is how far the row's own cells reach, then per
 * non-blank cell an optional `cell-format` and a `value` — followed by the
 * row's merges (`colspan`/`rowspan`) and the inert parts found in its cells.
 * A table that used styling ends with one `cell-styling` part, and one whose
 * cells carried Excel formulas (`x:fmla`) with one `formula` part: formulas
 * are not read here, only their cached values.
 *
 * **Values are text** (`textValue`, NFC with a diagnostic), except where
 * Excel's own attributes type them: `x:num` (a canonical decimal by M65's
 * rule), `x:bool`, `x:err` (kept verbatim with `error-value`). A cell's
 * `mso-number-format` — inline or from a class in a `<style>` block — gives
 * its `cell-format`, classified by M65's rule. No fact ever carries markup:
 * script content is never tokenized, and style content is read only for
 * number formats.
 *
 * **Encoding** is decided by `detectHtmlEncoding`: BOM, then `<meta
 * charset>`, else Windows-1252. **Bounds:** the tokenizer's construct and
 * text bounds, the table model's grid and nesting bounds, and at most
 * {@link HTML_MAX_VALUE_CELLS} value cells per stream (D31's cell budget).
 *
 * **Unknown sheet list.** When the file is larger than the sample the
 * inventory read (see `inventory.ts`), any non-empty selection reads every
 * table, and an empty one reads none.
 */

import { booleanValue, invalidPreservedValue, textValue, type CellValueV1 } from "../../../domain/model/values.js";
import {
  classifyNumberFormat,
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
import { SNIFF_SAMPLE_BYTES } from "../../source/sniff.js";
import type { RandomAccessSource } from "../../source/source.js";
import { isSheetListKnown } from "./inventory.js";
import { createTableWalker, type HtmlCellV1, type HtmlPlaceV1 } from "./structure.js";
import { detectHtmlEncoding, tokenizeHtml } from "./tokenizer.js";

/** Value cells one stream may emit: D31's cell budget. */
export const HTML_MAX_VALUE_CELLS = 250_000;

/** One decode window: 64 KiB. */
const READ_CHUNK_BYTES = 65_536;

/** Style classes one document may declare formats for. */
const MAX_FORMAT_CLASSES = 10_000;

const WORKBOOK_LOCATION = "Workbook";
const { maxRow, maxColumn } = CONTAINER_BOUNDS_V1;

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

/** Excel's named `mso-number-format` values, as the format codes they stand for. */
const NAMED_FORMATS: ReadonlyMap<string, string> = new Map([
  ["general", "General"],
  ["short date", "m/d/yyyy"],
  ["medium date", "dd-mmm-yy"],
  ["long date", "dddd, mmmm dd, yyyy"],
  ["short time", "h:mm"],
  ["medium time", "h:mm AM/PM"],
  ["long time", "h:mm:ss AM/PM"],
  ["percent", "0.00%"],
  ["fixed", "0.00"],
  ["standard", "#,##0.00"],
  ["scientific", "0.00E+00"],
]);

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const MSO_NUMBER_FORMAT = /mso-number-format\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^;]+))/i;
const MARKUP = /<[A-Za-z/!?]/;

const unescapeCss = (text: string): string =>
  text.replace(/\\(?:([0-9A-Fa-f]{1,6})[ \t\n]?|(.))/gs, (_, hex: string | undefined, character: string | undefined) =>
    hex === undefined ? (character as string) : String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd),
  );

/** The format code a declaration block names, or `null`. */
const numberFormatIn = (declarations: string): string | null => {
  const match = MSO_NUMBER_FORMAT.exec(declarations);
  if (match === null) return null;
  const code = unescapeCss((match[1] ?? match[2] ?? match[3] ?? "").trim()).normalize("NFC");
  if (code === "" || MARKUP.test(code)) return null;
  return NAMED_FORMATS.get(code.toLowerCase()) ?? code;
};

const columnLetters = (column: number): string => {
  let letters = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
  }
  return letters;
};

const locationOf = (sheetName: string, range: RangeV1): string => {
  const sheet = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
  const first = `${columnLetters(range.firstColumn)}${range.firstRow + 1}`;
  const last = `${columnLetters(range.lastColumn)}${range.lastRow + 1}`;
  return `${sheet}!${first === last ? first : `${first}:${last}`}`;
};

const part = (
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

/** The whole source as decoded text, one bounded window at a time. */
async function* decodedChunks(
  source: RandomAccessSource,
  encoding: string,
  bomByteLength: number,
): AsyncGenerator<string, void, undefined> {
  const decoder = new TextDecoder(encoding);
  for (let offset = bomByteLength; offset < source.byteLength; offset += READ_CHUNK_BYTES) {
    const bytes = await source.slice(offset, Math.min(READ_CHUNK_BYTES, source.byteLength - offset));
    if (bytes.byteLength === 0) break;
    yield decoder.decode(bytes, { stream: true });
  }
  yield decoder.decode();
}

async function* parseSheets(
  container: ContainerHandleV1,
  selection: readonly number[],
  options: ParseSheetsOptionsV1,
): AsyncGenerator<WorkbookFactStreamItemV2, void, undefined> {
  if (container.kind !== "text") {
    throw new BoundExceededError("unrecognized-content");
  }
  const source = container.source;
  const factsPerBatch = Math.max(1, Math.floor(options.factsPerBatch ?? WORKBOOK_FACTS_PER_BATCH));
  const cancellation = options.cancellation;
  const { encoding, bomByteLength } = detectHtmlEncoding(await source.slice(0, SNIFF_SAMPLE_BYTES));
  const isKnown = isSheetListKnown(source);
  const isSelected = (tableIndex: number): boolean => (isKnown ? selection.includes(tableIndex) : selection.length > 0);

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
      if (valueCount > HTML_MAX_VALUE_CELLS) throw new BoundExceededError("expansion-limit");
    }
    facts.push(fact);
    if (facts.length >= factsPerBatch) cut();
  };
  const note = (code: ImportDiagnosticCodeV2, rowIndex: number, columnIndex: number): void => {
    const existing = diagnostics.get(code);
    if (existing !== undefined) {
      existing.occurrences += 1;
      return;
    }
    diagnostics.set(code, { firstRowIndex: rowIndex, firstColumnIndex: columnIndex, occurrences: 1 });
    push({ kind: "diagnostic", diagnostic: { code, severity: SEVERITY[code], firstRowIndex: rowIndex, firstColumnIndex: columnIndex, occurrences: 1 } });
  };

  const classFormats = new Map<string, string>();
  const pendingWorkbookParts: PreservedPartKindV1[] = [];
  let hasOpenedSheet = false;
  let sheet: { name: string; columnFormats: Map<number, string> } | null = null;
  let rowCells: HtmlCellV1[] = [];
  let rowParts: { partKind: PreservedPartKindV1; anchor: RangeV1 }[] = [];

  const formatOf = (cell: HtmlCellV1, isNumber: boolean): string | null => {
    let code: string | null = null;
    for (const className of (cell.attributes.find((attribute) => attribute.name === "class")?.value ?? "").split(/\s+/)) {
      code = classFormats.get(className) ?? code;
    }
    const inline = cell.attributes.find((attribute) => attribute.name === "style")?.value;
    code = (inline === undefined ? null : numberFormatIn(inline)) ?? code;
    return code ?? (isNumber ? "General" : null);
  };

  const valueOf = (cell: HtmlCellV1): CellValueV1 | null => {
    const attribute = (name: string): string | null => cell.attributes.find((each) => each.name === name)?.value ?? null;
    const { rowIndex, columnIndex, text } = cell;
    const error = attribute("x:err");
    if (error !== null && (error !== "" || text !== "")) {
      note("error-value", rowIndex, columnIndex);
      return invalidPreservedValue((error === "" ? text : error).normalize("NFC"));
    }
    const bool = attribute("x:bool");
    if (bool !== null && /^(?:true|false)$/i.test(bool === "" ? text : bool)) {
      return booleanValue(/^true$/i.test(bool === "" ? text : bool));
    }
    const num = attribute("x:num");
    if (num !== null) {
      const raw = (num === "" ? text : num).trim();
      const decimal = NUMBER.test(raw) ? decimalCellOfDouble(Number(raw)) : null;
      if (decimal !== null) return decimal;
    }
    if (text === "") return null;
    if (text.includes("�")) note("replacement-character", rowIndex, columnIndex);
    const normalized = text.normalize("NFC");
    if (normalized !== text) note("text-normalized-nfc", rowIndex, columnIndex);
    return textValue(normalized);
  };

  const emitRow = (rowIndex: number): void => {
    const cells = rowCells;
    const parts = rowParts;
    rowCells = [];
    rowParts = [];
    if (sheet === null || cells.length === 0) return;
    const current = sheet;
    push({
      kind: "row",
      rowIndex,
      cellCount: Math.max(...cells.map((cell) => cell.columnIndex + cell.columnSpan)),
    });
    for (const cell of cells) {
      const value = valueOf(cell);
      if (value === null) continue;
      const code = formatOf(cell, value.kind === "decimal");
      if (code !== null && code !== (current.columnFormats.get(cell.columnIndex) ?? "General")) {
        current.columnFormats.set(cell.columnIndex, code);
        push({ kind: "cell-format", rowIndex, columnIndex: cell.columnIndex, numberFormat: code, ...classifyNumberFormat(code) });
      }
      push({ kind: "value", rowIndex, columnIndex: cell.columnIndex, value });
    }
    for (const cell of cells) {
      if (cell.rowSpan > 1 || cell.columnSpan > 1) {
        push({
          kind: "merge",
          range: {
            firstRow: cell.rowIndex,
            firstColumn: cell.columnIndex,
            lastRow: Math.min(cell.rowIndex + cell.rowSpan, maxRow) - 1,
            lastColumn: Math.min(cell.columnIndex + cell.columnSpan, maxColumn) - 1,
          },
        });
      }
    }
    for (const { partKind, anchor } of parts) push(part(partKind, locationOf(current.name, anchor), anchor));
  };

  const walker = createTableWalker({
    onStyleBlock(css) {
      for (const rule of css.replace(/<!--|-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const code = numberFormatIn(rule[2] as string);
        if (code === null) continue;
        for (const selector of (rule[1] as string).split(",")) {
          const className = /\.([A-Za-z0-9_-]+)\s*$/.exec(selector.trim())?.[1];
          if (className !== undefined && (classFormats.has(className) || classFormats.size < MAX_FORMAT_CLASSES)) {
            classFormats.set(className, code);
          }
        }
      }
    },
    onTable(name, tableIndex) {
      if (!isSelected(tableIndex)) {
        sheet = null;
        return;
      }
      sheet = { name, columnFormats: new Map() };
      push({
        kind: "sheet",
        sheetIndex: tableIndex,
        name,
        sheetKind: "worksheet",
        visibility: "visible",
        declaredRange: null,
        dateSystem: "1900",
      });
      if (!hasOpenedSheet) {
        hasOpenedSheet = true;
        for (const partKind of pendingWorkbookParts.splice(0)) push(part(partKind, WORKBOOK_LOCATION, null));
      }
    },
    onCell(cell) {
      if (sheet !== null) rowCells.push(cell);
    },
    onRowEnd: emitRow,
    onTableEnd(_tableIndex, summary) {
      if (sheet !== null) {
        if (summary.hasFormulas) push(part("formula", sheet.name, null));
        if (summary.isStyled) push(part("cell-styling", sheet.name, null));
      }
      sheet = null;
    },
    onPart(partKind: PreservedPartKindV1, place: HtmlPlaceV1) {
      if (place.kind === "document") {
        if (hasOpenedSheet) push(part(partKind, WORKBOOK_LOCATION, null));
        else if (pendingWorkbookParts.length < CONTAINER_BOUNDS_V1.maxZipEntries) pendingWorkbookParts.push(partKind);
      } else if (sheet !== null && place.kind === "table") {
        push(part(partKind, sheet.name, null));
      } else if (sheet !== null && place.kind === "cell") {
        const anchor = { firstRow: place.rowIndex, firstColumn: place.columnIndex, lastRow: place.rowIndex, lastColumn: place.columnIndex };
        rowParts.push({ partKind, anchor });
      }
    },
  });

  function* drain(): Generator<WorkbookFactStreamItemV2, boolean, undefined> {
    while (ready.length > 0) {
      yield ready.shift() as WorkbookFactBatchV2;
      if (cancellation.aborted) return false;
    }
    return true;
  }

  for await (const token of tokenizeHtml(decodedChunks(source, encoding, bomByteLength))) {
    walker.accept(token);
    if (!(yield* drain())) return;
  }
  walker.finish();
  cut();
  if (!(yield* drain())) return;
  yield {
    kind: "summary",
    rowCount,
    columnCount,
    valueCount,
    batchCount: batchSeq,
    diagnostics: [...diagnostics].map(([code, tally]) => ({ code, severity: SEVERITY[code], ...tally })),
  };
}

/** The legacy HTML-table adapter the import worker registers (D35). */
export const htmlTableAdapter: WorkbookAdapterV1 = Object.freeze({
  format: "html-table",
  parseSheets,
});
