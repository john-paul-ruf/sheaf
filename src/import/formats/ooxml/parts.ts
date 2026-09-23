/**
 * OOXML vocabulary shared by the inventory reader and the sheet parser (M15):
 * the two namespace sets (Transitional and Strict), relationship attributes,
 * and A1 references.
 *
 * A reference outside Excel's grid is not a large sheet, it is an impossible
 * one: it ends the read as `impossible-dimension` rather than being clamped,
 * so a far-corner `<dimension>` can never make anything allocate.
 */

import { BoundExceededError, CONTAINER_BOUNDS_V1 } from "../../source/bounds.js";
import type { XmlStartEventV1 } from "../../source/xml.js";
import type { RangeV1 } from "../../facts/index.js";

const SPREADSHEET_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://purl.oclc.org/ooxml/spreadsheetml/main",
]);

const RELATIONSHIP_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);

export const DRAWING_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
  "http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing",
]);

export const CHART_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/drawingml/2006/chart",
  "http://purl.oclc.org/ooxml/drawingml/chart",
]);

/** Excel 2010+ extension namespaces (`x14`, `xm`). */
export const X14_NAMESPACE = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
export const XM_NAMESPACE = "http://schemas.microsoft.com/office/excel/2006/main";

/** True for a SpreadsheetML element in either namespace set. */
export const isSheetElement = (uri: string): boolean => SPREADSHEET_NAMESPACES.has(uri);

/** The `r:id`-style attribute (either namespace set), or `null`. */
export const relationshipAttribute = (event: XmlStartEventV1, local = "id"): string | null =>
  event.attributes.find(
    (attribute) => attribute.local === local && RELATIONSHIP_NAMESPACES.has(attribute.uri),
  )?.value ?? null;

/** An unprefixed attribute. */
export const attribute = (event: XmlStartEventV1, local: string): string | null =>
  event.attributes.find((each) => each.local === local && each.uri === "")?.value ?? null;

export const isTrue = (value: string | null): boolean => value === "1" || value === "true";

const impossible = (): never => {
  throw new BoundExceededError("impossible-dimension");
};

/**
 * `B7` (or `$B$7`) → zero-based row and column; `null` when the text is not a
 * cell reference at all. Beyond the grid is `impossible-dimension`.
 */
export function parseCellRef(ref: string): { readonly row: number; readonly column: number } | null {
  const match = /^\$?([A-Za-z]{1,8})\$?([0-9]{1,12})$/.exec(ref.trim());
  if (match === null) {
    return null;
  }
  let column = 0;
  for (const letter of (match[1] as string).toUpperCase()) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }
  const row = Number(match[2]);
  if (row < 1 || row > CONTAINER_BOUNDS_V1.maxRow || column > CONTAINER_BOUNDS_V1.maxColumn) {
    return impossible();
  }
  return { row: row - 1, column: column - 1 };
}

/** `A1:E61` or `C3` → an inclusive range; `null` when it is not one. */
export function parseRange(ref: string): RangeV1 | null {
  const [first, last, extra] = ref.trim().split(":");
  if (first === undefined || extra !== undefined) {
    return null;
  }
  const from = parseCellRef(first);
  const to = last === undefined ? from : parseCellRef(last);
  if (from === null || to === null) {
    return null;
  }
  return {
    firstRow: Math.min(from.row, to.row),
    firstColumn: Math.min(from.column, to.column),
    lastRow: Math.max(from.row, to.row),
    lastColumn: Math.max(from.column, to.column),
  };
}

/** Every range in a space-separated `sqref`; unparseable members are skipped. */
export const parseSqref = (sqref: string): RangeV1[] =>
  sqref
    .split(/\s+/)
    .filter((part) => part !== "")
    .map(parseRange)
    .filter((range): range is RangeV1 => range !== null);

export const columnLetters = (column: number): string => {
  let letters = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
  }
  return letters;
};

/** A1 text of a range, the way a person finds it: `B2:H18`, or `C3`. */
export const rangeText = (range: RangeV1): string => {
  const first = `${columnLetters(range.firstColumn)}${range.firstRow + 1}`;
  const last = `${columnLetters(range.lastColumn)}${range.lastRow + 1}`;
  return first === last ? first : `${first}:${last}`;
};

export const rangeArea = (range: RangeV1): number =>
  (range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1);

/** Relationship kinds (last type-URI segment, lowercased) that open a sheet. */
export const SHEET_RELATIONSHIP_KINDS = new Map([
  ["worksheet", "worksheet"],
  ["chartsheet", "chartsheet"],
  ["dialogsheet", "dialogsheet"],
] as const);

/** Sheet relationship kinds that are macro sheets: refused, never parsed. */
export const MACRO_SHEET_RELATIONSHIP_KINDS = new Set(["xlmacrosheet", "xlintlmacrosheet"]);
