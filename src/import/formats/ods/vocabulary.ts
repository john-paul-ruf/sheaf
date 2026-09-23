/**
 * OpenDocument vocabulary shared by the ODS inventory reader and adapter
 * (M18): namespaces, attribute access, and ODF cell-range addresses.
 *
 * An ODF address names its sheet inside the address (`$Jobs.$A$2:.$A$9`,
 * `'Job list'.A1:'Job list'.E61`). A reference outside Excel's grid is not a
 * large sheet, it is an impossible one: it ends the read as
 * `impossible-dimension` rather than being clamped.
 */

import { BoundExceededError, CONTAINER_BOUNDS_V1 } from "../../source/bounds.js";
import type { XmlStartEventV1 } from "../../source/xml.js";
import type { RangeV1 } from "../../facts/index.js";

export const OFFICE_NS = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
export const TABLE_NS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
export const TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
export const STYLE_NS = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
export const FO_NS = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0";
export const NUMBER_NS = "urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0";
export const DRAW_NS = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0";
export const XLINK_NS = "http://www.w3.org/1999/xlink";
export const META_NS = "urn:oasis:names:tc:opendocument:xmlns:meta:1.0";
export const CONFIG_NS = "urn:oasis:names:tc:opendocument:xmlns:config:1.0";
export const MANIFEST_NS = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";
export const SCRIPT_NS = "urn:oasis:names:tc:opendocument:xmlns:script:1.0";
export const CALCEXT_NS = "urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0";

export const CONTENT_PART = "content.xml";
export const STYLES_PART = "styles.xml";
export const META_PART = "meta.xml";
export const SETTINGS_PART = "settings.xml";
export const MANIFEST_PART = "META-INF/manifest.xml";
export const MIMETYPE_PART = "mimetype";

/** The attribute `local` in namespace `uri`, or `null`. */
export const attr = (event: XmlStartEventV1, uri: string, local: string): string | null =>
  event.attributes.find((each) => each.local === local && each.uri === uri)?.value ?? null;

/** A repeat or span count: a whole number ≥ 1, anything else is 1. */
export const countOf = (value: string | null): number =>
  value !== null && /^\d{1,10}$/.test(value) && Number(value) > 0 ? Number(value) : 1;

const impossible = (): never => {
  throw new BoundExceededError("impossible-dimension");
};

export const columnIndexOf = (letters: string): number => {
  let column = 0;
  for (const letter of letters.toUpperCase()) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
    if (column > CONTAINER_BOUNDS_V1.maxColumn) return impossible();
  }
  return column - 1;
};

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

/** `'Job list'!B2:H18` — Excel's own spelling of a place, or the sheet name. */
export const locationOf = (sheetName: string, range: RangeV1 | null): string =>
  range === null ? sheetName : `${excelSheetName(sheetName)}!${rangeText(range)}`;

/** A sheet name as Excel writes it before `!`: quoted unless plainly a name. */
export const excelSheetName = (name: string): string =>
  /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;

/** One side of an ODF address: `$Sheet.$A$1`, `.A1`, `.A` (column), `.1` (row). */
export interface OdfCellAddressV1 {
  readonly sheet: string | null;
  /** The cell part as written minus nothing: `$A$1`, `A`, `$3`. */
  readonly cell: string;
  readonly row: number | null;
  readonly column: number | null;
}

/**
 * Splits `text` on `separator` outside single-quoted sheet names (`''` is an
 * escaped quote). `null` when a quote never closes.
 */
export const splitOutsideQuotes = (text: string, separator: string): string[] | null => {
  const parts: string[] = [];
  let current = "";
  let isQuoted = false;
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at] as string;
    if (character === "'") {
      if (isQuoted && text[at + 1] === "'") {
        current += "''";
        at += 1;
        continue;
      }
      isQuoted = !isQuoted;
      current += character;
    } else if (character === separator && !isQuoted) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (isQuoted) return null;
  parts.push(current);
  return parts;
};

const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})$/;
const COLUMN = /^(\$?)([A-Za-z]{1,3})$/;
const ROW = /^(\$?)([0-9]{1,7})$/;

/** Parses one side of an ODF address; `null` when it is not one (or external). */
export function parseOdfCell(text: string): OdfCellAddressV1 | null {
  const trimmed = text.trim();
  let sheet: string | null = null;
  let rest: string;
  const body = trimmed.startsWith("$") ? trimmed.slice(1) : trimmed;
  if (body.startsWith("'")) {
    let at = 1;
    let name = "";
    for (; at < body.length; at += 1) {
      if (body[at] === "'") {
        if (body[at + 1] === "'") {
          name += "'";
          at += 1;
          continue;
        }
        break;
      }
      name += body[at] as string;
    }
    if (at >= body.length || body[at + 1] !== ".") return null;
    sheet = name;
    rest = body.slice(at + 2);
  } else {
    const dot = body.lastIndexOf(".");
    if (dot === -1) return null;
    sheet = dot === 0 ? null : body.slice(0, dot);
    rest = body.slice(dot + 1);
    if (sheet !== null && (sheet.includes("#") || sheet.includes("'"))) return null;
  }
  const cell = CELL.exec(rest);
  if (cell !== null) {
    const row = Number(cell[4]);
    if (row < 1 || row > CONTAINER_BOUNDS_V1.maxRow) return impossible();
    return { sheet, cell: rest, row: row - 1, column: columnIndexOf(cell[2] as string) };
  }
  const column = COLUMN.exec(rest);
  if (column !== null) return { sheet, cell: rest, row: null, column: columnIndexOf(column[2] as string) };
  const row = ROW.exec(rest);
  if (row !== null) {
    const index = Number(row[2]);
    if (index < 1 || index > CONTAINER_BOUNDS_V1.maxRow) return impossible();
    return { sheet, cell: rest, row: index - 1, column: null };
  }
  return null;
}

/**
 * An ODF range address (`Jobs.A1:Jobs.E61`, `$Customers.$A$2:.$A$14`) as its
 * sheet plus Excel's spelling (`Customers!$A$2:$A$14`); `null` when it is not
 * a single-sheet range this adapter can state mechanically.
 */
export function odfAddressToExcel(address: string): { readonly sheet: string | null; readonly text: string } | null {
  const sides = splitOutsideQuotes(address.trim(), ":");
  if (sides === null || sides.length > 2) return null;
  const first = parseOdfCell(sides[0] as string);
  const second = sides[1] === undefined ? null : parseOdfCell(sides[1]);
  if (first === null || (sides[1] !== undefined && second === null)) return null;
  if (second !== null && second.sheet !== null && second.sheet !== first.sheet) return null;
  if (second !== null && (first.row === null) !== (second.row === null)) return null;
  if (second !== null && (first.column === null) !== (second.column === null)) return null;
  if (second === null && (first.row === null || first.column === null)) return null;
  const cells = second === null ? first.cell : `${first.cell}:${second.cell}`;
  return {
    sheet: first.sheet,
    text: first.sheet === null ? cells : `${excelSheetName(first.sheet)}!${cells}`,
  };
}

/** A whole-cell ODF range address as its sheet and zero-based range. */
export function odfAddressToRange(address: string): { readonly sheet: string | null; readonly range: RangeV1 } | null {
  const sides = splitOutsideQuotes(address.trim(), ":");
  if (sides === null || sides.length > 2) return null;
  const first = parseOdfCell(sides[0] as string);
  const second = sides[1] === undefined ? first : parseOdfCell(sides[1]);
  if (first === null || second === null || first.row === null || first.column === null) return null;
  if (second.row === null || second.column === null) return null;
  if (second.sheet !== null && second.sheet !== first.sheet) return null;
  return {
    sheet: first.sheet,
    range: {
      firstRow: Math.min(first.row, second.row),
      firstColumn: Math.min(first.column, second.column),
      lastRow: Math.max(first.row, second.row),
      lastColumn: Math.max(first.column, second.column),
    },
  };
}
