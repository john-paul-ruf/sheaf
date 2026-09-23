/**
 * The table model of a legacy HTML export (M20), shared by the inventory
 * reader and the adapter so both see the same sheets under the same names.
 *
 * - **Sheets.** Each top-level `<table>`, in document order, is one sheet.
 *   Its name is its `<caption>` text, else the matching Excel `x:Name` (read
 *   from the `<!--[if gte mso 9]>` workbook description, in order), else
 *   `Table N`. A table inside a cell is not a sheet: its text folds into the
 *   enclosing cell (cells separated by spaces, rows by line breaks).
 * - **Implied structure,** as browsers imply it for tables: a `<tr>` closes the
 *   open cell and row, a `<td>`/`<th>` closes the open cell (and opens a row
 *   when none is open), a row-group tag closes both, `</table>` closes all.
 * - **The grid.** `rowspan` occupies the cells below, so a later row's cells
 *   start at the next free column; `colspan` is clamped to 1…1000 and
 *   `rowspan` to 1…65534 as the HTML standard clamps them. A cell past
 *   Excel's grid is `impossible-dimension`.
 * - **Cell text** is what a reader sees: runs of HTML whitespace collapse to
 *   one space, `<br>` and block starts break lines, each line is trimmed, and
 *   `&nbsp;`-only text is blank.
 * - **Inert content** (invariant 8) is reported as it is seen, never
 *   followed: `<script>` and every `on…` event attribute (`script`),
 *   `javascript:`/`vbscript:` URLs (`script`), `<img>` (`image`), every other
 *   `href`/`src` off the document (`external-link`; an in-document `#…` link
 *   is a `hyperlink`), `<object>`/`<embed>`/`<applet>` (`embedded-object`),
 *   and form fields (`form-control`).
 */

import type { PreservedPartKindV1 } from "../../facts/index.js";
import { BoundExceededError, CONTAINER_BOUNDS_V1 } from "../../source/bounds.js";
import { decodeCharacterReferences } from "./entities.js";
import type { HtmlAttributeV1, HtmlStartTokenV1, HtmlTokenV1 } from "./tokenizer.js";

const { maxRow, maxColumn, maxXmlDepth, maxXmlAttributeValueBytes } = CONTAINER_BOUNDS_V1;

const MAX_COLSPAN = 1000;
const MAX_ROWSPAN = 65_534;

export interface HtmlCellV1 {
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly rowSpan: number;
  readonly columnSpan: number;
  readonly text: string;
  readonly attributes: readonly HtmlAttributeV1[];
}

/** Where a part was seen: in a cell, in a table outside cells, or outside every table. */
export type HtmlPlaceV1 =
  | { readonly kind: "cell"; readonly rowIndex: number; readonly columnIndex: number }
  | { readonly kind: "table" }
  | { readonly kind: "document" };

export interface TableWalkerCallbacksV1 {
  onTable?(name: string, tableIndex: number): void;
  onRow?(rowIndex: number): void;
  onCell?(cell: HtmlCellV1): void;
  /** A row closed; its cells have all been reported. */
  onRowEnd?(rowIndex: number): void;
  onTableEnd?(tableIndex: number, summary: { readonly isStyled: boolean; readonly hasFormulas: boolean }): void;
  onPart?(partKind: PreservedPartKindV1, place: HtmlPlaceV1): void;
  onStyleBlock?(css: string): void;
}

const FORM_CONTROLS = new Set(["input", "button", "select", "textarea"]);
const EMBEDDED = new Set(["object", "embed", "applet"]);
const STYLING_ELEMENTS = new Set(["font", "b", "i", "u", "strong", "em", "s", "strike"]);
const STYLING_ATTRIBUTES = new Set(["style", "class", "bgcolor", "color"]);
const BLOCKS = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6"]);
const ROW_GROUPS = new Set(["thead", "tbody", "tfoot"]);
const X_NAME = /<x:Name>([^<]*)<\/x:Name>/gi;

const collapse = (line: string): string => line.replace(/[\t\n\f\r ]+/g, " ").replace(/^ | $/g, "");

const spanOf = (value: string | null, limit: number): number => {
  if (value === null || !/^\s*\d{1,9}\s*$/.test(value)) return 1;
  return Math.min(Math.max(1, Number(value)), limit);
};

const attributeOf = (token: HtmlStartTokenV1, name: string): string | null =>
  token.attributes.find((attribute) => attribute.name === name)?.value ?? null;

/** The kind of inert part a URL attribute is, or `null` for none. */
const urlPart = (url: string): PreservedPartKindV1 | null => {
  const trimmed = url.trim();
  if (trimmed === "") return null;
  if (/^(?:javascript|vbscript):/i.test(trimmed.replace(/[\t\n\r]/g, ""))) return "script";
  return trimmed.startsWith("#") ? "hyperlink" : "external-link";
};

interface OpenCell {
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly rowSpan: number;
  readonly columnSpan: number;
  readonly attributes: readonly HtmlAttributeV1[];
  readonly lines: string[];
  length: number;
}

interface OpenTable {
  readonly index: number;
  name: string | null;
  caption: string | null;
  isCapturing: boolean;
  rowIndex: number;
  isRowOpen: boolean;
  column: number;
  readonly spans: Map<number, number>;
  cell: OpenCell | null;
  isStyled: boolean;
  hasFormulas: boolean;
}

export function createTableWalker(callbacks: TableWalkerCallbacksV1): {
  readonly accept: (token: HtmlTokenV1) => void;
  readonly finish: () => void;
} {
  const xNames: string[] = [];
  let tableCount = 0;
  let table: OpenTable | null = null;
  let nestedDepth = 0;
  let hasStyleBlock = false;

  const place = (): HtmlPlaceV1 =>
    table === null
      ? { kind: "document" }
      : table.cell === null
        ? { kind: "table" }
        : { kind: "cell", rowIndex: table.cell.rowIndex, columnIndex: table.cell.columnIndex };

  const part = (partKind: PreservedPartKindV1): void => callbacks.onPart?.(partKind, place());

  const appendText = (text: string): void => {
    const cell = table?.cell;
    if (cell === undefined || cell === null) return;
    cell.length += text.length;
    if (cell.length > maxXmlAttributeValueBytes) throw new BoundExceededError("malformed-structure");
    cell.lines[cell.lines.length - 1] += text;
  };

  /** `hard`: a `<br>` always breaks; a block or nested row breaks only after text. */
  const breakLine = (isHard: boolean): void => {
    const cell = table?.cell;
    if (cell === undefined || cell === null) return;
    if (isHard || collapse(cell.lines.at(-1) as string) !== "") cell.lines.push("");
  };

  const ensureNamed = (open: OpenTable): void => {
    if (open.name !== null) return;
    const caption = open.caption === null ? "" : collapse(open.caption).normalize("NFC");
    open.name = caption !== "" ? caption : (xNames[open.index] ?? `Table ${open.index + 1}`);
    callbacks.onTable?.(open.name, open.index);
  };

  const closeCell = (open: OpenTable): void => {
    const cell = open.cell;
    if (cell === null) return;
    open.cell = null;
    const text = cell.lines.map(collapse).join("\n").replace(/^\n+|\n+$/g, "");
    callbacks.onCell?.({
      rowIndex: cell.rowIndex,
      columnIndex: cell.columnIndex,
      rowSpan: cell.rowSpan,
      columnSpan: cell.columnSpan,
      text: /^[\s ]*$/.test(text) ? "" : text,
      attributes: cell.attributes,
    });
  };

  const closeRow = (open: OpenTable): void => {
    closeCell(open);
    if (!open.isRowOpen) return;
    open.isRowOpen = false;
    callbacks.onRowEnd?.(open.rowIndex);
    for (const [column, remaining] of open.spans) {
      if (remaining <= 1) open.spans.delete(column);
      else open.spans.set(column, remaining - 1);
    }
    open.rowIndex += 1;
  };

  const openRow = (open: OpenTable): void => {
    closeRow(open);
    ensureNamed(open);
    open.isRowOpen = true;
    open.column = 0;
    callbacks.onRow?.(open.rowIndex);
  };

  const openCell = (open: OpenTable, token: HtmlStartTokenV1): void => {
    closeCell(open);
    if (!open.isRowOpen) openRow(open);
    let column = open.column;
    while (open.spans.has(column)) column += 1;
    const columnSpan = spanOf(attributeOf(token, "colspan"), MAX_COLSPAN);
    const rowSpan = spanOf(attributeOf(token, "rowspan"), MAX_ROWSPAN);
    if (open.rowIndex >= maxRow || column + columnSpan > maxColumn) {
      throw new BoundExceededError("impossible-dimension");
    }
    if (rowSpan > 1) {
      for (let covered = column; covered < column + columnSpan; covered += 1) open.spans.set(covered, rowSpan);
    }
    open.column = column + columnSpan;
    open.hasFormulas ||= attributeOf(token, "x:fmla") !== null;
    open.cell = {
      rowIndex: open.rowIndex,
      columnIndex: column,
      rowSpan,
      columnSpan,
      attributes: token.attributes,
      lines: [""],
      length: 0,
    };
  };

  const closeTable = (open: OpenTable): void => {
    closeRow(open);
    ensureNamed(open);
    table = null;
    callbacks.onTableEnd?.(open.index, { isStyled: open.isStyled, hasFormulas: open.hasFormulas });
  };

  /** Inert content any element may carry, wherever it is. */
  const inspect = (token: HtmlStartTokenV1): void => {
    const name = token.name;
    if (name === "script") part("script");
    else if (name === "img") part("image");
    else if (EMBEDDED.has(name)) part("embedded-object");
    else if (FORM_CONTROLS.has(name)) part("form-control");
    if (token.attributes.some((attribute) => /^on[a-z]/.test(attribute.name))) part("script");
    for (const attribute of token.attributes) {
      if (attribute.name !== "href" && attribute.name !== "src" && attribute.name !== "data" && attribute.name !== "action") {
        continue;
      }
      const kind = urlPart(attribute.value);
      if (kind === "script" || (kind !== null && name !== "img" && !EMBEDDED.has(name) && name !== "script")) part(kind);
    }
    if (table !== null && (STYLING_ELEMENTS.has(name) || token.attributes.some((attribute) => STYLING_ATTRIBUTES.has(attribute.name)))) {
      table.isStyled = true;
    }
  };

  /** What a start tag does to the table structure. */
  const structure = (token: HtmlStartTokenV1): void => {
    const name = token.name;
    if (table === null) {
      if (name === "table") {
        table = {
          index: tableCount,
          name: null,
          caption: null,
          isCapturing: false,
          rowIndex: 0,
          isRowOpen: false,
          column: 0,
          spans: new Map(),
          cell: null,
          isStyled: hasStyleBlock,
          hasFormulas: false,
        };
        tableCount += 1;
      }
      return;
    }
    if (nestedDepth > 0) {
      if (name === "table") nestedDepth += 1;
      else if (name === "br") breakLine(true);
      else if (name === "tr" || BLOCKS.has(name)) breakLine(false);
      else if (name === "td" || name === "th") appendText(" ");
      if (nestedDepth > maxXmlDepth) throw new BoundExceededError("malformed-structure");
      return;
    }
    if (name === "table") {
      nestedDepth = 1;
      breakLine(false);
    } else if (name === "caption" && table.name === null) {
      table.isCapturing = true;
    } else if (name === "tr") {
      openRow(table);
    } else if (name === "td" || name === "th") {
      openCell(table, token);
    } else if (ROW_GROUPS.has(name)) {
      closeRow(table);
    } else if (name === "br") {
      breakLine(true);
    } else if (BLOCKS.has(name)) {
      breakLine(false);
    }
  };

  const accept = (token: HtmlTokenV1): void => {
    switch (token.kind) {
      case "conditional":
        for (const match of token.value.matchAll(X_NAME)) {
          xNames.push(collapse(decodeCharacterReferences(match[1] as string)).normalize("NFC"));
        }
        return;
      case "raw":
        callbacks.onStyleBlock?.(token.value);
        hasStyleBlock = true;
        if (table !== null) table.isStyled = true;
        return;
      case "text":
        if (table?.isCapturing === true) table.caption = `${table.caption ?? ""}${token.value}`;
        else appendText(token.value);
        return;
      case "start":
        // Structure first, so a cell's own attributes are inspected inside it.
        structure(token);
        inspect(token);
        return;
      case "end": {
        if (table === null) return;
        const name = token.name;
        if (nestedDepth > 0) {
          if (name === "table") nestedDepth -= 1;
          if (nestedDepth === 0) breakLine(false);
          return;
        }
        if (name === "caption") table.isCapturing = false;
        else if (name === "td" || name === "th") closeCell(table);
        else if (name === "tr" || ROW_GROUPS.has(name)) closeRow(table);
        else if (name === "table") closeTable(table);
        return;
      }
    }
  };

  return {
    accept,
    finish: () => {
      if (table !== null) closeTable(table);
    },
  };
}
