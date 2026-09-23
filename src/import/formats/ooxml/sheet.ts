/**
 * One worksheet part, streamed into V2 facts (M15; CA-17, FR-3, invariant 7).
 *
 * The part is read once, through the bounded tokenizer, one `<row>` at a time:
 * a row's cells are gathered (at most 16,384 of them), then emitted as a `row`
 * fact followed, per cell in column order, by an optional `cell-format`, an
 * optional `formula`, and an optional `value` fact. Nothing wider than a row
 * is ever held, and a far-corner reference is `impossible-dimension`, never an
 * allocation.
 *
 * Cell values use the domain constructors only: numbers become canonical
 * decimals (the shortest round-tripping spelling of the stored double),
 * strings are NFC-normalized with a diagnostic (D28), error cells keep their
 * text as invalid-preserved values with `error-value`, and a value that does
 * not fit its declared type is kept verbatim with `malformed-value`. Dates are
 * not decided here: a date-formatted number is a decimal plus a `cell-format`
 * fact. Formulas are carried as text and never evaluated; the cached result is
 * an ordinary value fact (D33).
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
  VALIDATION_OPERATORS,
  type ImportDiagnosticCodeV2,
  type PreservedPartKindV1,
  type RangeV1,
  type ValidationListSourceV1,
  type ValidationOperatorV1,
  type ValidationRuleV1,
  type WorkbookFactV2,
} from "../../facts/index.js";
import { BoundExceededError, CONTAINER_BOUNDS_V1 } from "../../source/bounds.js";
import { partEvents, readRelationships, relationshipKind } from "../../source/opc.js";
import { tokenizeXml, type XmlStartEventV1 } from "../../source/xml.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import { readCommentAnchors, readDrawingObjects } from "./drawings.js";
import { readTablePart, type SheetPartV1 } from "./inventory.js";
import {
  attribute,
  isSheetElement,
  parseCellRef,
  parseRange,
  parseSqref,
  rangeText,
  relationshipAttribute,
  X14_NAMESPACE,
  XM_NAMESPACE,
} from "./parts.js";
import { DEFAULT_CELL_STYLE, type CellStyleV1 } from "./styles.js";

/** Where facts go; batching and diagnostics tallies live with the caller. */
export interface FactSinkV1 {
  push(fact: WorkbookFactV2): void;
  note(code: ImportDiagnosticCodeV2, rowIndex: number | null, columnIndex: number | null): void;
}

export interface SheetSourcesV1 {
  readonly zip: ZipContainerHandleV1;
  readonly strings: readonly string[];
  readonly styles: readonly CellStyleV1[];
}

/** `'Archive 2018'!B2:H18` — Excel's own spelling of a place, or the sheet. */
export const locationOf = (sheetName: string, range: RangeV1 | null): string => {
  if (range === null) return sheetName;
  const quoted = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
  return `${quoted}!${rangeText(range)}`;
};

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

const pivotAnchor = async (zip: ZipContainerHandleV1, partName: string): Promise<RangeV1 | null> => {
  for await (const event of partEvents(zip, partName)) {
    if (event.kind === "start" && isSheetElement(event.uri) && event.local === "location") {
      return parseRange(attribute(event, "ref") ?? "");
    }
  }
  return null;
};

/**
 * The facts a sheet's relationships declare — tables and every inert part
 * stored beside the sheet — emitted after its `sheet` fact, before its rows.
 */
export async function sheetPartFacts(
  zip: ZipContainerHandleV1,
  sheet: SheetPartV1,
): Promise<WorkbookFactV2[]> {
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
        for (const anchor of await readCommentAnchors(zip, target)) {
          facts.push(preservedPart("comment", at(anchor), anchor, target));
        }
        break;
      case "pivottable": {
        const anchor = await pivotAnchor(zip, target);
        facts.push(preservedPart("pivot-table", at(anchor), anchor, target));
        break;
      }
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
  readonly styleIndex: number;
  readonly type: string;
  value: string | null;
  inline: string | null;
  formula: { readonly type: string; readonly si: string | null; text: string } | null;
}

interface PendingValidation {
  rule: ValidationRuleV1 | null;
  operator: ValidationOperatorV1 | null;
  sqref: string;
  formula1: string | null;
  formula2: string | null;
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const RULES: ReadonlyMap<string, ValidationRuleV1> = new Map([
  ["list", "list"],
  ["whole", "whole"],
  ["decimal", "decimal"],
  ["date", "date"],
  ["time", "time"],
  ["textLength", "text-length"],
  ["custom", "custom"],
]);

const operatorOf = (value: string | null, rule: ValidationRuleV1 | null): ValidationOperatorV1 | null => {
  if (rule === null || rule === "list" || rule === "custom") return null;
  const kebab = (value ?? "between").replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return VALIDATION_OPERATORS.find((operator) => operator === kebab) ?? null;
};

/** `"a,b,c"` is an inline list; anything else names cells or a name. */
const listSourceOf = (formula1: string | null): ValidationListSourceV1 | null => {
  if (formula1 === null) return null;
  const inline = /^"(.*)"$/s.exec(formula1.trim());
  return inline === null
    ? { kind: "range", ref: formula1.trim() }
    : { kind: "inline", values: (inline[1] ?? "").replace(/""/g, '"').split(",") };
};

const isExternalFormula = (text: string): boolean => /\[\d+\]/.test(text.replace(/"[^"]*"/g, ""));

const indexOf = (value: string | null, limit: number): number | null =>
  value !== null && /^\d{1,7}$/.test(value) && Number(value) < limit ? Number(value) : null;

/**
 * Streams one worksheet (or dialog sheet) part into `sink`, yielding control
 * after every row so the caller can cut batches and observe cancellation.
 */
export async function* streamWorksheet(
  sources: SheetSourcesV1,
  sheet: SheetPartV1,
  sink: FactSinkV1,
): AsyncGenerator<void, void, undefined> {
  const { zip, strings, styles } = sources;
  const columnFormats = new Map<number, string>();
  let lastRowIndex = -1;
  let rowIndex: number | null = null;
  let cells: PendingCell[] = [];
  let nextColumn = 0;
  let cell: PendingCell | null = null;
  let capture: "value" | "inline" | "formula" | "formula1" | "formula2" | "sqref" | null = null;
  let phoneticDepth = 0;
  let isStyled = false;
  let conditionalFormats = 0;
  let validation: PendingValidation | null = null;
  const hyperlinkTargets = new Map(
    (await readRelationships(zip, sheet.partName)).map((relationship) => [relationship.id, relationship]),
  );

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
  const valueOf = (pending: PendingCell, row: number): CellValueV1 | null => {
    const raw = pending.value;
    const column = pending.column;
    switch (pending.type) {
      case "":
      case "n":
        if (raw === null || raw.trim() === "") return null;
        return (NUMBER.test(raw.trim()) ? decimalCellOfDouble(Number(raw)) : null) ?? kept(raw, "malformed-value", row, column);
      case "s": {
        if (raw === null) return null;
        const index = indexOf(raw.trim(), strings.length);
        return index === null ? kept(raw, "malformed-value", row, column) : textCell(strings[index] as string, row, column);
      }
      case "str":
      case "d":
        return raw === null ? null : textCell(raw, row, column);
      case "inlineStr":
        return pending.inline === null ? null : textCell(pending.inline, row, column);
      case "b":
        if (raw === null) return null;
        if (raw === "1" || raw === "true") return booleanValue(true);
        if (raw === "0" || raw === "false") return booleanValue(false);
        return kept(raw, "malformed-value", row, column);
      case "e":
        return raw === null || raw === "" ? null : kept(raw, "error-value", row, column);
      default:
        return raw === null ? null : kept(raw, "malformed-value", row, column);
    }
  };

  const flushRow = (): void => {
    if (rowIndex === null) return;
    const row = rowIndex;
    rowIndex = null;
    if (cells.length === 0) return;
    if (row <= lastRowIndex) {
      throw new BoundExceededError("malformed-structure");
    }
    lastRowIndex = row;
    cells.sort((left, right) => left.column - right.column);
    const width = (cells.at(-1) as PendingCell).column + 1;
    sink.push({ kind: "row", rowIndex: row, cellCount: width });
    let previousColumn = -1;
    for (const pending of cells) {
      if (pending.column === previousColumn) {
        throw new BoundExceededError("malformed-structure");
      }
      previousColumn = pending.column;
      const style = styles[pending.styleIndex] ?? DEFAULT_CELL_STYLE;
      isStyled ||= style.isVisuallyStyled;
      const value = valueOf(pending, row);
      if (value !== null && style.numberFormat !== (columnFormats.get(pending.column) ?? "General")) {
        columnFormats.set(pending.column, style.numberFormat);
        sink.push({
          kind: "cell-format",
          rowIndex: row,
          columnIndex: pending.column,
          numberFormat: style.numberFormat,
          formatClass: style.formatClass,
          currencySymbol: style.currencySymbol,
        });
      }
      const formula = pending.formula;
      if (formula !== null) {
        const isShared = formula.type === "shared";
        const text = formula.text === "" || formula.type === "dataTable" ? null : formula.text.normalize("NFC");
        sink.push({
          kind: "formula",
          rowIndex: row,
          columnIndex: pending.column,
          text,
          sharedGroup: isShared ? indexOf(formula.si, 1_048_576) : null,
          isArray: formula.type === "array",
          isExternal: text !== null && isExternalFormula(text),
        });
      }
      if (value !== null) {
        sink.push({ kind: "value", rowIndex: row, columnIndex: pending.column, value });
      }
    }
    cells = [];
  };

  const startCell = (event: XmlStartEventV1): PendingCell => {
    const ref = attribute(event, "r");
    const at = ref === null ? null : parseCellRef(ref);
    if (at !== null && at.row !== rowIndex) {
      throw new BoundExceededError("malformed-structure");
    }
    const column = at?.column ?? nextColumn;
    if (column >= CONTAINER_BOUNDS_V1.maxColumn) {
      throw new BoundExceededError("impossible-dimension");
    }
    nextColumn = column + 1;
    return {
      column,
      styleIndex: indexOf(attribute(event, "s"), styles.length) ?? 0,
      type: attribute(event, "t") ?? "",
      value: null,
      inline: null,
      formula: null,
    };
  };

  const emitValidation = (pending: PendingValidation): void => {
    if (pending.rule === null) return;
    for (const range of parseSqref(pending.sqref)) {
      sink.push({
        kind: "validation",
        range,
        rule: pending.rule,
        operator: pending.operator,
        listSource: pending.rule === "list" ? listSourceOf(pending.formula1) : null,
        formula1: pending.formula1,
        formula2: pending.formula2,
      });
    }
  };

  for await (const event of tokenizeXml(zip.streamEntry(sheet.partName))) {
    if (event.kind === "start") {
      const isMain = isSheetElement(event.uri);
      if (isMain && event.local === "row") {
        flushRow();
        const r = attribute(event, "r");
        const row = r !== null && /^\d{1,12}$/.test(r) ? Number(r) - 1 : lastRowIndex + 1;
        if (row < 0 || row >= CONTAINER_BOUNDS_V1.maxRow) {
          throw new BoundExceededError("impossible-dimension");
        }
        rowIndex = row;
        nextColumn = 0;
      } else if (isMain && event.local === "c" && rowIndex !== null) {
        cell = startCell(event);
        cells.push(cell);
      } else if (cell !== null && isMain && event.local === "v") {
        capture = "value";
        cell.value = "";
      } else if (cell !== null && isMain && event.local === "f") {
        capture = "formula";
        cell.formula = { type: attribute(event, "t") ?? "normal", si: attribute(event, "si"), text: "" };
      } else if (cell !== null && isMain && event.local === "is") {
        cell.inline = "";
      } else if (cell !== null && isMain && event.local === "rPh") {
        phoneticDepth += 1;
      } else if (cell !== null && isMain && event.local === "t" && cell.inline !== null && phoneticDepth === 0) {
        capture = "inline";
      } else if (isMain && event.local === "mergeCell") {
        const range = parseRange(attribute(event, "ref") ?? "");
        if (range !== null) sink.push({ kind: "merge", range });
      } else if (isMain && event.local === "conditionalFormatting") {
        conditionalFormats += 1;
      } else if (isMain && event.local === "hyperlink") {
        const anchor = parseRange(attribute(event, "ref") ?? "");
        const relationship = hyperlinkTargets.get(relationshipAttribute(event) ?? "");
        sink.push(
          preservedPart("hyperlink", locationOf(sheet.name, anchor), anchor, relationship?.isExternal === false ? relationship.target : null),
        );
      } else if ((isMain || event.uri === X14_NAMESPACE) && event.local === "dataValidation") {
        const rule = RULES.get(attribute(event, "type") ?? "none") ?? null;
        validation = {
          rule,
          operator: operatorOf(attribute(event, "operator"), rule),
          sqref: attribute(event, "sqref") ?? "",
          formula1: null,
          formula2: null,
        };
      } else if (validation !== null && isMain && (event.local === "formula1" || event.local === "formula2")) {
        capture = event.local;
        validation[event.local] = "";
      } else if (validation !== null && event.uri === X14_NAMESPACE && (event.local === "formula1" || event.local === "formula2")) {
        validation[event.local] = "";
      } else if (validation !== null && event.uri === XM_NAMESPACE && event.local === "f") {
        capture = validation.formula2 === "" ? "formula2" : "formula1";
      } else if (validation !== null && event.uri === XM_NAMESPACE && event.local === "sqref") {
        capture = "sqref";
      } else if (event.uri === X14_NAMESPACE && event.local === "sparklineGroup") {
        sink.push(preservedPart("sparkline", sheet.name, null, null));
      }
    } else if (event.kind === "text") {
      if (capture === "value" && cell !== null) cell.value += event.value;
      else if (capture === "formula" && cell !== null && cell.formula !== null) cell.formula.text += event.value;
      else if (capture === "inline" && cell !== null && cell.inline !== null) cell.inline += event.value;
      else if (validation !== null && (capture === "formula1" || capture === "formula2")) {
        validation[capture] = `${validation[capture] ?? ""}${event.value}`;
      } else if (validation !== null && capture === "sqref") validation.sqref += event.value;
    } else {
      if (capture !== null && ["v", "f", "t", "formula1", "formula2", "sqref"].includes(event.local)) {
        capture = null;
      }
      if (event.local === "rPh" && phoneticDepth > 0) phoneticDepth -= 1;
      else if (event.local === "c" && isSheetElement(event.uri)) cell = null;
      else if (event.local === "row" && isSheetElement(event.uri)) {
        flushRow();
        yield;
      } else if (event.local === "dataValidation" && validation !== null) {
        emitValidation(validation);
        validation = null;
      }
    }
  }
  flushRow();
  if (conditionalFormats > 0) {
    sink.push(preservedPart("conditional-formatting", sheet.name, null, null));
  }
  if (isStyled) {
    sink.push(preservedPart("cell-styling", sheet.name, null, null));
  }
}
