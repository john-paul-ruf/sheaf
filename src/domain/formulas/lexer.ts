/**
 * Formula text → tokens (M03; D34). References are recognised whole here —
 * sheet prefix, `$` anchors, ranges, whole columns and rows, structured table
 * references — so the parser only ever sees operands and operators.
 *
 * The lexer is linear in the text and allocates nothing but tokens; it is
 * never handed more than {@link FORMULA_MAX_LENGTH} characters.
 */

import type {
  CellCoordinateV1,
  FormulaReferenceV1,
  FormulaUnparsedReasonV1,
  SheetScopeV1,
} from "./ast.js";

export type FormulaTokenV1 =
  | { readonly kind: "number"; readonly text: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "error"; readonly code: string }
  | { readonly kind: "reference"; readonly reference: FormulaReferenceV1 }
  | { readonly kind: "identifier"; readonly text: string }
  | { readonly kind: "operator"; readonly text: string }
  | { readonly kind: "punctuation"; readonly text: "(" | ")" | "{" | "}" | "," | ";" }
  | { readonly kind: "space" };

/** Thrown inside the parser only; `parseFormula` turns it into a result. */
export class FormulaRefusal extends Error {
  constructor(readonly reason: FormulaUnparsedReasonV1) {
    super(reason);
  }
}

const refuse = (reason: FormulaUnparsedReasonV1): never => {
  throw new FormulaRefusal(reason);
};

/** Excel's grid: 16,384 columns (`XFD`) by 1,048,576 rows. */
const MAX_COLUMN = 16_384;
const MAX_ROW = 1_048_576;

export const ERROR_LITERALS = Object.freeze([
  "#NULL!",
  "#DIV/0!",
  "#VALUE!",
  "#REF!",
  "#NAME?",
  "#NUM!",
  "#N/A",
  "#GETTING_DATA",
  "#SPILL!",
  "#CALC!",
  "#FIELD!",
  "#BLOCKED!",
  "#CONNECT!",
  "#BUSY!",
  "#UNKNOWN!",
] as const);

const NAME_START = /[A-Za-z_\\\u00A1-\uFFFF]/;
const NAME_PART = /[A-Za-z0-9_.?\\\u00A1-\uFFFF]/;
const SHEET_CHAR = /[A-Za-z0-9_.\u00A1-\uFFFF]/;

const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/;
const COLUMN = /^(\$?)([A-Za-z]{1,3})/;
const ROW = /^(\$?)(\d{1,7})/;
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

export const columnNumberOf = (letters: string): number => {
  let value = 0;
  for (const letter of letters.toUpperCase()) {
    value = value * 26 + (letter.charCodeAt(0) - 64);
  }
  return value - 1;
};

export const columnLettersOf = (column: number): string => {
  let letters = "";
  for (let rest = column + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }
  return letters;
};

const isNamePart = (char: string | undefined): boolean =>
  char !== undefined && NAME_PART.test(char);

/** `Sheet1`, `Sheet1:Sheet3`, `[1]Sheet`, `C:\dir\[Book.xlsx]Sheet`. */
const scopeOf = (spec: string): SheetScopeV1 | null => {
  let workbook: string | null = null;
  let rest = spec;
  const bracket = /^(.*)\[([^\]]+)\](.*)$/s.exec(spec);
  if (bracket !== null) {
    workbook = `${bracket[1] ?? ""}${bracket[2] ?? ""}`;
    rest = bracket[3] ?? "";
  }
  const colon = rest.indexOf(":");
  const firstSheet = colon < 0 ? rest : rest.slice(0, colon);
  const lastSheet = colon < 0 ? null : rest.slice(colon + 1);
  if (firstSheet === "" || lastSheet === "") return null;
  return { workbook, firstSheet, lastSheet };
};

/** Reads `'…'!` or `Name!` / `Name:Name!` / `[1]Name!` at `start`, or nothing. */
const readSheetPrefix = (
  text: string,
  start: number,
): { readonly scope: SheetScopeV1; readonly end: number } | null => {
  if (text[start] === "'") {
    let spec = "";
    let index = start + 1;
    for (;;) {
      const char = text[index];
      if (char === undefined) return null;
      if (char === "'") {
        if (text[index + 1] === "'") {
          spec += "'";
          index += 2;
          continue;
        }
        break;
      }
      spec += char;
      index += 1;
    }
    if (text[index + 1] !== "!") return null;
    const scope = scopeOf(spec);
    return scope === null ? refuse("syntax") : { scope, end: index + 2 };
  }
  let index = start;
  if (text[index] === "[") {
    const close = text.indexOf("]", index);
    if (close < 0 || !/^\d+$/.test(text.slice(index + 1, close))) return null;
    index = close + 1;
  }
  const sheetStart = index;
  while (text[index] !== undefined && SHEET_CHAR.test(text[index] as string)) index += 1;
  if (index === sheetStart) return null;
  if (text[index] === ":") {
    const second = index + 1;
    let cursor = second;
    while (text[cursor] !== undefined && SHEET_CHAR.test(text[cursor] as string)) cursor += 1;
    if (cursor > second && text[cursor] === "!") index = cursor;
  }
  if (text[index] !== "!") return null;
  const scope = scopeOf(text.slice(start, index));
  return scope === null ? null : { scope, end: index + 1 };
};

const coordinate = (match: RegExpExecArray): CellCoordinateV1 | null => {
  const column = columnNumberOf(match[2] as string);
  const row = Number(match[4]) - 1;
  if (column >= MAX_COLUMN || row < 0 || row >= MAX_ROW) return null;
  return {
    row,
    column,
    isColumnAbsolute: match[1] === "$",
    isRowAbsolute: match[3] === "$",
  };
};

/** A cell, area, whole-column or whole-row reference at `start`, or nothing. */
const readArea = (
  text: string,
  start: number,
  scope: SheetScopeV1 | null,
): { readonly reference: FormulaReferenceV1; readonly end: number } | null => {
  const rest = text.slice(start);
  const cell = CELL.exec(rest);
  if (cell !== null) {
    const first = coordinate(cell);
    const end = start + cell[0].length;
    if (first !== null) {
      if (text[end] === ":") {
        const second = CELL.exec(text.slice(end + 1));
        const last = second === null ? null : coordinate(second);
        if (second !== null && last !== null && !isNamePart(text[end + 1 + second[0].length]) && text[end + 1 + second[0].length] !== "(") {
          return { reference: { kind: "area", scope, first, last }, end: end + 1 + second[0].length };
        }
      }
      if (!isNamePart(text[end]) && text[end] !== "(" && text[end] !== "[") {
        return { reference: { kind: "cell", scope, cell: first }, end };
      }
    }
  }
  const column = COLUMN.exec(rest);
  if (column !== null && text[start + column[0].length] === ":") {
    const second = COLUMN.exec(text.slice(start + column[0].length + 1));
    const end = start + column[0].length + 1 + (second?.[0].length ?? 0);
    if (second !== null && !isNamePart(text[end]) && text[end] !== "(") {
      const firstColumn = columnNumberOf(column[2] as string);
      const lastColumn = columnNumberOf(second[2] as string);
      if (firstColumn < MAX_COLUMN && lastColumn < MAX_COLUMN) {
        return {
          reference: {
            kind: "columns",
            scope,
            firstColumn,
            lastColumn,
            isFirstAbsolute: column[1] === "$",
            isLastAbsolute: second[1] === "$",
          },
          end,
        };
      }
    }
  }
  const row = ROW.exec(rest);
  if (row !== null && text[start + row[0].length] === ":") {
    const second = ROW.exec(text.slice(start + row[0].length + 1));
    const end = start + row[0].length + 1 + (second?.[0].length ?? 0);
    if (second !== null && !isNamePart(text[end]) && text[end] !== ".") {
      const firstRow = Number(row[2]) - 1;
      const lastRow = Number(second[2]) - 1;
      if (firstRow >= 0 && lastRow >= 0 && firstRow < MAX_ROW && lastRow < MAX_ROW) {
        return {
          reference: {
            kind: "rows",
            scope,
            firstRow,
            lastRow,
            isFirstAbsolute: row[1] === "$",
            isLastAbsolute: second[1] === "$",
          },
          end,
        };
      }
    }
  }
  return null;
};

/** `Col Name`, with `'` escaping `[`, `]`, `#`, `'`. */
const unescapeColumn = (raw: string): string => raw.replace(/'(.)/g, "$1");

/** Splits the inside of `Table[…]` into specifiers and a column span. */
const structuredOf = (table: string | null, inner: string): FormulaReferenceV1 => {
  const trimmed = inner.trim();
  const reference = (
    specifiers: readonly string[],
    firstColumn: string | null,
    lastColumn: string | null,
    isThisRow: boolean,
  ): FormulaReferenceV1 => ({ kind: "structured", table, specifiers, firstColumn, lastColumn, isThisRow });
  if (trimmed === "") return reference([], null, null, false);
  if (trimmed.startsWith("@")) {
    const rest = trimmed.slice(1).trim();
    const column = /^\[(.*)\]$/s.exec(rest)?.[1] ?? rest;
    return reference([], column === "" ? null : unescapeColumn(column), null, true);
  }
  if (!trimmed.startsWith("[")) {
    return trimmed.startsWith("#")
      ? reference([trimmed], null, null, false)
      : reference([], unescapeColumn(trimmed), null, false);
  }
  const specifiers: string[] = [];
  const columns: string[] = [];
  let index = 0;
  let isRange = false;
  while (index < trimmed.length) {
    const char = trimmed[index];
    if (char === "[") {
      let item = "";
      const isSpecifier = trimmed[index + 1] === "#";
      index += 1;
      while (index < trimmed.length && trimmed[index] !== "]") {
        if (trimmed[index] === "'" && index + 1 < trimmed.length) {
          item += trimmed[index + 1];
          index += 2;
          continue;
        }
        item += trimmed[index];
        index += 1;
      }
      if (trimmed[index] !== "]") refuse("syntax");
      index += 1;
      if (isSpecifier) specifiers.push(item);
      else columns.push(item);
    } else if (char === ",") {
      index += 1;
    } else if (char === ":") {
      isRange = true;
      index += 1;
    } else if (char === " ") {
      index += 1;
    } else {
      refuse("syntax");
    }
  }
  if (columns.length > 2 || (isRange && columns.length !== 2) || (!isRange && columns.length > 1)) {
    refuse("syntax");
  }
  return reference(specifiers, columns[0] ?? null, columns[1] ?? null, specifiers.includes("#This Row"));
};

/** The balanced `[…]` starting at `start`; returns its inside and the end. */
const readBrackets = (text: string, start: number): { readonly inner: string; readonly end: number } => {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'") {
      index += 1;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(start + 1, index), end: index + 1 };
    }
  }
  return refuse("syntax");
};

const OPERATORS = ["<>", "<=", ">=", "+", "-", "*", "/", "^", "&", "=", "<", ">", "%", ":"];

/** Tokenizes a whole formula body (the leading `=` already removed). */
export function tokenize(text: string): FormulaTokenV1[] {
  const tokens: FormulaTokenV1[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] as string;

    if (/[ \t\r\n]/.test(char)) {
      while (index < text.length && /[ \t\r\n]/.test(text[index] as string)) index += 1;
      tokens.push({ kind: "space" });
      continue;
    }

    if (char === '"') {
      let value = "";
      index += 1;
      for (;;) {
        const next = text[index];
        if (next === undefined) refuse("syntax");
        if (next === '"') {
          if (text[index + 1] === '"') {
            value += '"';
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        value += next;
        index += 1;
      }
      tokens.push({ kind: "string", value });
      continue;
    }

    if (char === "#") {
      const upper = text.slice(index, index + 16).toUpperCase();
      const code = ERROR_LITERALS.find((literal) => upper.startsWith(literal)) ?? refuse("unsupported-token");
      tokens.push({ kind: "error", code });
      index += code.length;
      continue;
    }

    const prefix = readSheetPrefix(text, index);
    if (prefix !== null) {
      const area = readArea(text, prefix.end, prefix.scope);
      if (area !== null) {
        tokens.push({ kind: "reference", reference: area.reference });
        index = area.end;
      } else if (text.startsWith("#REF!", prefix.end)) {
        tokens.push({ kind: "error", code: "#REF!" });
        index = prefix.end + 5;
      } else if (text[prefix.end] !== undefined && NAME_START.test(text[prefix.end] as string)) {
        let end = prefix.end + 1;
        while (isNamePart(text[end])) end += 1;
        tokens.push({ kind: "reference", reference: { kind: "name", scope: prefix.scope, name: text.slice(prefix.end, end) } });
        index = end;
      } else {
        refuse("syntax");
      }
      if (text[index] === "#") refuse("unsupported-token");
      continue;
    }

    if (char === "[") {
      const { inner, end } = readBrackets(text, index);
      tokens.push({ kind: "reference", reference: structuredOf(null, inner) });
      index = end;
      continue;
    }

    const area = readArea(text, index, null);
    if (area !== null) {
      tokens.push({ kind: "reference", reference: area.reference });
      index = area.end;
      if (text[index] === "#") refuse("unsupported-token");
      continue;
    }

    const number = NUMBER.exec(text.slice(index));
    if (number !== null) {
      tokens.push({ kind: "number", text: number[0] });
      index += number[0].length;
      continue;
    }

    if (NAME_START.test(char)) {
      let end = index + 1;
      while (isNamePart(text[end])) end += 1;
      const name = text.slice(index, end);
      if (text[end] === "[") {
        const brackets = readBrackets(text, end);
        tokens.push({ kind: "reference", reference: structuredOf(name, brackets.inner) });
        index = brackets.end;
      } else {
        tokens.push({ kind: "identifier", text: name });
        index = end;
      }
      continue;
    }

    const operator = OPERATORS.find((candidate) => text.startsWith(candidate, index));
    if (operator !== undefined) {
      tokens.push({ kind: "operator", text: operator });
      index += operator.length;
      continue;
    }

    if (char === "(" || char === ")" || char === "{" || char === "}" || char === "," || char === ";") {
      tokens.push({ kind: "punctuation", text: char });
      index += 1;
      continue;
    }

    refuse("unsupported-token");
  }
  return tokens;
}
