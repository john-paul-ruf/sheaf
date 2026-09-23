/**
 * The shared parsed-formula (`Ptg`) decoder of BIFF8 and BIFF12 (M17; D34).
 *
 * Legacy `.xls` and binary `.xlsb` store a formula as a reverse-Polish token
 * stream, not as text. D34 decompiles that stream to the formula text an
 * `.xlsx` would carry — `VLOOKUP(B2,Customers!A:B,2,FALSE)`, `=` omitted — so
 * M03's one parser reads every format the same way. M16 (XLSB) imports this
 * file: the only adapter-to-adapter edge.
 *
 * **Never a guessed formula.** A token this decoder does not handle, an
 * operand that runs past the stream, a function whose arity it does not know,
 * a name or sheet the context cannot resolve, or a stack that does not end
 * with exactly one expression is `undecodable` with a closed reason — never
 * text. The decoder never throws.
 *
 * Handled: operators and parentheses; string, boolean, error, integer and
 * number literals; `PtgRef`/`PtgArea` with their `N` (relative), `3d` and
 * `Err` forms; `PtgName`/`PtgNameX` (including `_xlfn.` future functions
 * called through `PtgFuncVar` 255); `PtgFunc`/`PtgFuncVar` over the built-in
 * function table; `PtgMissArg`; `PtgArray` constants; `PtgAttr` (the
 * `tAttrSum` shorthand becomes `SUM(…)`, `tAttrSpace`/`If`/`Choose`/`Goto`/
 * `Semi` bookkeeping is skipped); `PtgMem*` (transparent). `PtgExp` (a
 * shared-/array-formula member) is the adapter's to resolve, through
 * {@link ptgExpOf}; the decoder reports it as `shared-formula-reference`.
 */

import { decimalTextOfDouble } from "../../facts/index.js";

/** One external workbook reference (`SUPBOOK` / `BrtSupBook*`). */
export interface PtgSupbookV1 {
  /** `self`: this workbook; `addin`: add-in functions; `external`: another file. */
  readonly kind: "self" | "addin" | "external";
  /** 1-based among external books, as formula text writes `[1]`; 0 otherwise. */
  readonly bookIndex: number;
  readonly sheetNames: readonly string[];
  /** `EXTERNNAME`s in order; `PtgNameX` indexes them from 1. */
  readonly names: readonly string[];
}

/** One `XTI`: a 3-D reference's book and sheet span. */
export interface PtgExternSheetV1 {
  readonly supbook: number;
  /** Negative when the sheet was deleted (`#REF!`). */
  readonly firstSheet: number;
  readonly lastSheet: number;
}

/** BIFF8 (`.xls`) and BIFF12 (`.xlsb`) differ only in operand widths. */
export type PtgFormatV1 = "biff8" | "biff12";

export interface PtgCellV1 {
  readonly row: number;
  readonly column: number;
}

export interface PtgContextV1 {
  readonly format: PtgFormatV1;
  /** This workbook's sheets, in workbook order. */
  readonly sheetNames: readonly string[];
  readonly supbooks: readonly PtgSupbookV1[];
  readonly externSheets: readonly PtgExternSheetV1[];
  /** Defined names in workbook order; `PtgName` indexes them from 1. */
  readonly definedNames: readonly string[];
  /** The formula's own cell, for relative `PtgRefN`/`PtgAreaN`; `null` outside a cell. */
  readonly cell: PtgCellV1 | null;
  /**
   * True for a shared formula's tokens (`SHRFMLA`, `BrtShrFmla`), where a 3-D
   * reference's relative parts are offsets from `cell`, as `PtgRefN`'s are.
   */
  readonly isSharedFormula: boolean;
}

export const PTG_UNDECODABLE_REASONS = Object.freeze([
  "truncated",
  "unknown-token",
  "unbalanced-stack",
  "shared-formula-reference",
  "data-table",
  "structured-reference",
  "unknown-function",
  "macro-function",
  "unknown-name",
  "unknown-sheet",
  "relative-without-cell",
] as const);
export type PtgUndecodableReasonV1 = (typeof PTG_UNDECODABLE_REASONS)[number];

export type PtgDecodeResultV1 =
  | { readonly text: string }
  | { readonly undecodable: PtgUndecodableReasonV1 };

/** Error values by code (MS-XLS §2.5.10 `BErr`, shared by BIFF12). */
export const ERROR_TEXT: ReadonlyMap<number, string> = new Map([
  [0x00, "#NULL!"],
  [0x07, "#DIV/0!"],
  [0x0f, "#VALUE!"],
  [0x17, "#REF!"],
  [0x1d, "#NAME?"],
  [0x24, "#NUM!"],
  [0x2a, "#N/A"],
  [0x2b, "#GETTING_DATA"],
]);

/**
 * Built-in functions by `iftab` id, 0–380, as MS-XLS §2.5.198.17 (`Ftab`)
 * lists them; BIFF12 uses the same ids (MS-XLSB §2.5.97.10). `""` marks an
 * id the list leaves unassigned, and 255 is the user-defined/add-in call
 * whose name is its first argument.
 */
export const FUNCTION_NAMES: readonly string[] = Object.freeze([
  "COUNT", "IF", "ISNA", "ISERROR", "SUM", "AVERAGE", "MIN", "MAX", "ROW", "COLUMN",
  "NA", "NPV", "STDEV", "DOLLAR", "FIXED", "SIN", "COS", "TAN", "ATAN", "PI",
  "SQRT", "EXP", "LN", "LOG10", "ABS", "INT", "SIGN", "ROUND", "LOOKUP", "INDEX",
  "REPT", "MID", "LEN", "VALUE", "TRUE", "FALSE", "AND", "OR", "NOT", "MOD",
  "DCOUNT", "DSUM", "DAVERAGE", "DMIN", "DMAX", "DSTDEV", "VAR", "DVAR", "TEXT", "LINEST",
  "TREND", "LOGEST", "GROWTH", "GOTO", "HALT", "RETURN", "PV", "FV", "NPER", "PMT",
  "RATE", "MIRR", "IRR", "RAND", "MATCH", "DATE", "TIME", "DAY", "MONTH", "YEAR",
  "WEEKDAY", "HOUR", "MINUTE", "SECOND", "NOW", "AREAS", "ROWS", "COLUMNS", "OFFSET", "ABSREF",
  "RELREF", "ARGUMENT", "SEARCH", "TRANSPOSE", "ERROR", "STEP", "TYPE", "ECHO", "SET.NAME", "CALLER",
  "DEREF", "WINDOWS", "SERIES", "DOCUMENTS", "ACTIVE.CELL", "SELECTION", "RESULT", "ATAN2", "ASIN", "ACOS",
  "CHOOSE", "HLOOKUP", "VLOOKUP", "LINKS", "INPUT", "ISREF", "GET.FORMULA", "GET.NAME", "SET.VALUE", "LOG",
  "EXEC", "CHAR", "LOWER", "UPPER", "PROPER", "LEFT", "RIGHT", "EXACT", "TRIM", "REPLACE",
  "SUBSTITUTE", "CODE", "NAMES", "DIRECTORY", "FIND", "CELL", "ISERR", "ISTEXT", "ISNUMBER", "ISBLANK",
  "T", "N", "FOPEN", "FCLOSE", "FSIZE", "FREADLN", "FREAD", "FWRITELN", "FWRITE", "FPOS",
  "DATEVALUE", "TIMEVALUE", "SLN", "SYD", "DDB", "GET.DEF", "REFTEXT", "TEXTREF", "INDIRECT", "REGISTER",
  "CALL", "ADD.BAR", "ADD.MENU", "ADD.COMMAND", "ENABLE.COMMAND", "CHECK.COMMAND", "RENAME.COMMAND", "SHOW.BAR", "DELETE.MENU", "DELETE.COMMAND",
  "GET.CHART.ITEM", "DIALOG.BOX", "CLEAN", "MDETERM", "MINVERSE", "MMULT", "FILES", "IPMT", "PPMT", "COUNTA",
  "CANCEL.KEY", "FOR", "WHILE", "BREAK", "NEXT", "INITIATE", "REQUEST", "POKE", "EXECUTE", "TERMINATE",
  "RESTART", "HELP", "GET.BAR", "PRODUCT", "FACT", "GET.CELL", "GET.WORKSPACE", "GET.WINDOW", "GET.DOCUMENT", "DPRODUCT",
  "ISNONTEXT", "GET.NOTE", "NOTE", "STDEVP", "VARP", "DSTDEVP", "DVARP", "TRUNC", "ISLOGICAL", "DCOUNTA",
  "DELETE.BAR", "UNREGISTER", "", "", "USDOLLAR", "FINDB", "SEARCHB", "REPLACEB", "LEFTB", "RIGHTB",
  "MIDB", "LENB", "ROUNDUP", "ROUNDDOWN", "ASC", "DBCS", "RANK", "", "", "ADDRESS",
  "DAYS360", "TODAY", "VDB", "ELSE", "ELSE.IF", "END.IF", "FOR.CELL", "MEDIAN", "SUMPRODUCT", "SINH",
  "COSH", "TANH", "ASINH", "ACOSH", "ATANH", "DGET", "CREATE.OBJECT", "VOLATILE", "LAST.ERROR", "CUSTOM.UNDO",
  "CUSTOM.REPEAT", "FORMULA.CONVERT", "GET.LINK.INFO", "TEXT.BOX", "INFO", "GROUP", "GET.OBJECT", "DB", "PAUSE", "",
  "", "RESUME", "FREQUENCY", "ADD.TOOLBAR", "DELETE.TOOLBAR", "", "RESET.TOOLBAR", "EVALUATE", "GET.TOOLBAR", "GET.TOOL",
  "SPELLING.CHECK", "ERROR.TYPE", "APP.TITLE", "WINDOW.TITLE", "SAVE.TOOLBAR", "ENABLE.TOOL", "PRESS.TOOL", "REGISTER.ID", "GET.WORKBOOK", "AVEDEV",
  "BETADIST", "GAMMALN", "BETAINV", "BINOMDIST", "CHIDIST", "CHIINV", "COMBIN", "CONFIDENCE", "CRITBINOM", "EVEN",
  "EXPONDIST", "FDIST", "FINV", "FISHER", "FISHERINV", "FLOOR", "GAMMADIST", "GAMMAINV", "CEILING", "HYPGEOMDIST",
  "LOGNORMDIST", "LOGINV", "NEGBINOMDIST", "NORMDIST", "NORMSDIST", "NORMINV", "NORMSINV", "STANDARDIZE", "ODD", "PERMUT",
  "POISSON", "TDIST", "WEIBULL", "SUMXMY2", "SUMX2MY2", "SUMX2PY2", "CHITEST", "CORREL", "COVAR", "FORECAST",
  "FTEST", "INTERCEPT", "PEARSON", "RSQ", "STEYX", "SLOPE", "TTEST", "PROB", "DEVSQ", "GEOMEAN",
  "HARMEAN", "SUMSQ", "KURT", "SKEW", "ZTEST", "LARGE", "SMALL", "QUARTILE", "PERCENTILE", "PERCENTRANK",
  "MODE", "TRIMMEAN", "TINV", "", "MOVIE.COMMAND", "GET.MOVIE", "CONCATENATE", "POWER", "PIVOT.ADD.DATA", "GET.PIVOT.TABLE",
  "GET.PIVOT.FIELD", "GET.PIVOT.ITEM", "RADIANS", "DEGREES", "SUBTOTAL", "SUMIF", "COUNTIF", "COUNTBLANK", "SCENARIO.GET", "OPTIONS.LISTS.GET",
  "ISPMT", "DATEDIF", "DATESTRING", "NUMBERSTRING", "ROMAN", "OPEN.DIALOG", "SAVE.DIALOG", "VIEW.GET", "GETPIVOTDATA", "HYPERLINK",
  "PHONETIC", "AVERAGEA", "MAXA", "MINA", "STDEVPA", "VARPA", "STDEVA", "VARA", "BAHTTEXT", "THAIDAYOFWEEK",
  "THAIDIGIT", "THAIMONTHOFYEAR", "THAINUMSOUND", "THAINUMSTRING", "THAISTRINGLENGTH", "ISTHAIDIGIT", "ROUNDBAHTDOWN", "ROUNDBAHTUP", "THAIYEAR", "RTD",
  "CUBEVALUE",
]);

/** The call that names its function in its first argument (add-ins, `_xlfn.`). */
export const USER_DEFINED_FUNCTION = 255;

/**
 * Argument counts of the functions `PtgFunc` may call (fixed arity), from the
 * same MS-XLS table. A function absent here is variadic and only reachable
 * through `PtgFuncVar`, which carries its own count.
 */
export const FIXED_ARITY: ReadonlyMap<number, number> = new Map(
  (
    [
      [0, [10, 19, 34, 35, 63, 74, 85, 89, 94, 95, 173, 174, 221, 223, 225, 238, 245]],
      [
        1,
        [
          2, 3, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 32, 33, 38, 67, 68, 69, 71, 72, 73, 75, 76, 77, 83, 86, 90, 98, 99,
          105, 106, 111, 112, 113, 114, 118, 121, 126, 127, 128, 129, 130, 131, 133, 134, 135, 140, 141, 162, 163, 164, 172,
          179, 184, 186, 190, 198, 200, 201, 211, 214, 215, 224, 229, 230, 231, 232, 233, 234, 244, 254, 256, 257, 261, 271,
          279, 283, 284, 294, 296, 298, 342, 343, 347, 349, 352, 360, 368, 369, 370, 371, 372, 373, 374, 375, 376, 377, 378,
        ],
      ],
      [
        2,
        [
          27, 30, 39, 48, 79, 80, 97, 108, 117, 136, 137, 138, 165, 175, 176, 178, 212, 213, 252, 274, 275, 276, 285, 288,
          299, 303, 304, 305, 306, 307, 308, 310, 311, 312, 313, 314, 315, 325, 326, 327, 328, 331, 332, 337, 346, 353,
        ],
      ],
      [
        3,
        [
          31, 40, 41, 42, 43, 44, 45, 47, 61, 65, 66, 142, 177, 189, 195, 196, 199, 210, 235, 265, 266, 277, 278, 280, 281,
          282, 287, 290, 291, 292, 295, 297, 300, 301, 309, 351,
        ],
      ],
      [4, [119, 143, 207, 273, 286, 289, 293, 302, 316, 350]],
    ] as const
  ).flatMap(([arity, ids]) => ids.map((id): [number, number] => [id, arity])),
);

class Undecodable extends Error {
  constructor(readonly reason: PtgUndecodableReasonV1) {
    super(reason);
  }
}

const stop = (reason: PtgUndecodableReasonV1): never => {
  throw new Undecodable(reason);
};

class Cursor {
  at = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get isAtEnd(): boolean {
    return this.at >= this.bytes.byteLength;
  }

  private take(count: number): number {
    if (this.at + count > this.bytes.byteLength) stop("truncated");
    const start = this.at;
    this.at += count;
    return start;
  }

  u8(): number {
    return this.bytes[this.take(1)] as number;
  }

  u16(): number {
    const at = this.take(2);
    return (this.bytes[at] as number) | ((this.bytes[at + 1] as number) << 8);
  }

  u32(): number {
    const at = this.take(4);
    return (
      ((this.bytes[at] as number) |
        ((this.bytes[at + 1] as number) << 8) |
        ((this.bytes[at + 2] as number) << 16) |
        ((this.bytes[at + 3] as number) << 24)) >>>
      0
    );
  }

  i32(): number {
    return this.u32() | 0;
  }

  f64(): number {
    const at = this.take(8);
    return new DataView(this.bytes.buffer, this.bytes.byteOffset + at, 8).getFloat64(0, true);
  }

  skip(count: number): void {
    this.take(count);
  }

  /** `count` characters, one byte each or UTF-16LE. */
  chars(count: number, isWide: boolean): string {
    const at = this.take(isWide ? count * 2 : count);
    let text = "";
    for (let index = 0; index < count; index += 1) {
      text += String.fromCharCode(
        isWide ? (this.bytes[at + index * 2] as number) | ((this.bytes[at + index * 2 + 1] as number) << 8) : (this.bytes[at + index] as number),
      );
    }
    return text;
  }
}

/** Grid size per format: BIFF8 is 65,536 × 256; BIFF12 1,048,576 × 16,384. */
const GRID: Readonly<Record<PtgFormatV1, { readonly rows: number; readonly columns: number }>> = {
  biff8: { rows: 65_536, columns: 256 },
  biff12: { rows: 1_048_576, columns: 16_384 },
};

export const columnLetters = (column: number): string => {
  let letters = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
  }
  return letters;
};

/** `B7` for zero-based (6, 1). */
export const cellText = (row: number, column: number): string => `${columnLetters(column)}${row + 1}`;

/** A1 text of a range, the way a person finds it: `B2:H18`, or `C3`. */
export const rangeText = (range: { readonly firstRow: number; readonly firstColumn: number; readonly lastRow: number; readonly lastColumn: number }): string => {
  const first = cellText(range.firstRow, range.firstColumn);
  const last = cellText(range.lastRow, range.lastColumn);
  return first === last ? first : `${first}:${last}`;
};

const PLAIN_SHEET_NAME = /^[A-Za-z_¡-￿][A-Za-z0-9_.¡-￿]*$/;
const LOOKS_LIKE_A1 = /^[A-Za-z]{1,3}[0-9]+$/;
const LOOKS_LIKE_R1C1 = /^[Rr][0-9]*[Cc][0-9]*$/;

/** A sheet name as formula text writes it: bare when it can be, else `'…'` with `''`. */
export const quoteSheetName = (name: string): string =>
  PLAIN_SHEET_NAME.test(name) && !LOOKS_LIKE_A1.test(name) && !LOOKS_LIKE_R1C1.test(name) && !/^(TRUE|FALSE)$/i.test(name)
    ? name
    : `'${name.replace(/'/g, "''")}'`;

/** `'Archive 2018'!B2:H18` — Excel's own spelling of a place, or the sheet alone. */
export const locationOf = (sheetName: string, range: Parameters<typeof rangeText>[0] | null): string =>
  range === null ? sheetName : `${quoteSheetName(sheetName)}!${rangeText(range)}`;

interface Location {
  row: number;
  column: number;
  isRowRelative: boolean;
  isColumnRelative: boolean;
}

const locationText = ({ row, column, isRowRelative, isColumnRelative }: Location): string =>
  `${isColumnRelative ? "" : "$"}${columnLetters(column)}${isRowRelative ? "" : "$"}${row + 1}`;

const wrap = (value: number, size: number): number => ((value % size) + size) % size;

const OPERATORS: ReadonlyMap<number, string> = new Map([
  [0x03, "+"],
  [0x04, "-"],
  [0x05, "*"],
  [0x06, "/"],
  [0x07, "^"],
  [0x08, "&"],
  [0x09, "<"],
  [0x0a, "<="],
  [0x0b, "="],
  [0x0c, ">="],
  [0x0d, ">"],
  [0x0e, "<>"],
  [0x0f, " "],
  [0x10, ","],
  [0x11, ":"],
]);

const ATTR = Object.freeze({ SUM: 0x10, CHOOSE: 0x04 });

/** `PtgAttr` bookkeeping that changes nothing about the formula's text. */
const SKIPPED_ATTRS: ReadonlySet<number> = new Set([0x01, 0x02, 0x08, 0x20, 0x40, 0x41]);

const stringLiteral = (text: string): string => `"${text.replace(/"/g, '""')}"`;

const numberText = (value: number): string => (Number.isFinite(value) ? decimalTextOfDouble(value) : stop("unknown-token"));

const errorText = (code: number): string => ERROR_TEXT.get(code) ?? stop("unknown-token");

/** The master cell a `PtgExp` stream points at, or `null` when the stream is not one. */
export function ptgExpOf(rgce: Uint8Array, format: PtgFormatV1): { readonly row: number; readonly column: number | null } | null {
  if (rgce[0] !== 0x01) return null;
  const cursor = new Cursor(rgce);
  cursor.skip(1);
  try {
    // BIFF12 stores the master's row only; the column is the member's own.
    return format === "biff8" ? { row: cursor.u16(), column: cursor.u16() } : { row: cursor.u32(), column: null };
  } catch {
    return null;
  }
}

function decode(rgce: Uint8Array, ctx: PtgContextV1, rgcb: Uint8Array): string {
  const isBiff8 = ctx.format === "biff8";
  const grid = GRID[ctx.format];
  const tokens = new Cursor(rgce);
  const extra = new Cursor(rgcb);
  const stack: string[] = [];
  const pop = (): string => stack.pop() ?? stop("unbalanced-stack");
  const popMany = (count: number): string[] => {
    if (count > stack.length) stop("unbalanced-stack");
    return stack.splice(stack.length - count, count);
  };

  const rowField = (): number => (isBiff8 ? tokens.u16() : tokens.u32());
  const columnField = (): { column: number; isRowRelative: boolean; isColumnRelative: boolean } => {
    const raw = tokens.u16();
    return { column: raw & 0x3fff, isColumnRelative: (raw & 0x4000) !== 0, isRowRelative: (raw & 0x8000) !== 0 };
  };

  const location = (isOffset: boolean, row: number, field: ReturnType<typeof columnField>): Location => {
    const cell = ctx.cell;
    const shiftsRow = isOffset && field.isRowRelative;
    const shiftsColumn = isOffset && field.isColumnRelative;
    if ((shiftsRow || shiftsColumn) && cell === null) stop("relative-without-cell");
    const rowOffset = isBiff8 ? (row << 16) >> 16 : row | 0;
    const at = {
      row: shiftsRow ? wrap((cell as PtgCellV1).row + rowOffset, grid.rows) : row,
      column: shiftsColumn ? wrap((cell as PtgCellV1).column + field.column, grid.columns) : field.column,
      isRowRelative: field.isRowRelative,
      isColumnRelative: field.isColumnRelative,
    };
    if (at.row >= grid.rows || at.column >= grid.columns) stop("unknown-token");
    return at;
  };

  const refOperand = (isOffset: boolean): string => {
    const row = rowField();
    return locationText(location(isOffset, row, columnField()));
  };

  const areaOperand = (isOffset: boolean): string => {
    const firstRow = rowField();
    const lastRow = rowField();
    const first = location(isOffset, firstRow, columnField());
    const last = location(isOffset, lastRow, columnField());
    const column = (at: Location) => `${at.isColumnRelative ? "" : "$"}${columnLetters(at.column)}`;
    const row = (at: Location) => `${at.isRowRelative ? "" : "$"}${at.row + 1}`;
    if (first.row === 0 && last.row === grid.rows - 1) return `${column(first)}:${column(last)}`;
    if (first.column === 0 && last.column === grid.columns - 1) return `${row(first)}:${row(last)}`;
    return `${locationText(first)}:${locationText(last)}`;
  };

  /** `Sheet!`, `'A:B'!`, `[1]Sheet!` — or `null` for a deleted sheet, whose reference is `#REF!`. */
  const sheetPrefix = (ixti: number): string | null => {
    const xti = ctx.externSheets[ixti] ?? stop("unknown-sheet");
    const book = ctx.supbooks[xti.supbook] ?? stop("unknown-sheet");
    if (book.kind === "addin") stop("unknown-sheet");
    if (xti.firstSheet < 0 || xti.lastSheet < 0) return null;
    const names = book.kind === "self" ? ctx.sheetNames : book.sheetNames;
    const first = names[xti.firstSheet] ?? stop("unknown-sheet");
    const last = names[xti.lastSheet] ?? stop("unknown-sheet");
    const span = first === last ? first : `${first}:${last}`;
    const needsQuotes = quoteSheetName(first) !== first || quoteSheetName(last) !== last;
    const bookPart = book.kind === "external" ? `[${book.bookIndex}]` : "";
    return needsQuotes ? `'${bookPart}${span.replace(/'/g, "''")}'!` : `${bookPart}${span}!`;
  };

  const externName = (ixti: number, index: number): string => {
    const xti = ctx.externSheets[ixti] ?? stop("unknown-name");
    const book = ctx.supbooks[xti.supbook] ?? stop("unknown-name");
    if (book.kind === "self") return ctx.definedNames[index - 1] ?? stop("unknown-name");
    const name = book.names[index - 1] ?? stop("unknown-name");
    return book.kind === "external" ? `[${book.bookIndex}]!${name}` : name;
  };

  const arrayConstant = (): string => {
    const columns = isBiff8 ? extra.u8() + 1 : 0;
    const rows = isBiff8 ? extra.u16() + 1 : extra.u32();
    const width = isBiff8 ? columns : extra.u32();
    if (rows * width > rgcb.byteLength) stop("truncated");
    const lines: string[] = [];
    for (let row = 0; row < rows; row += 1) {
      const values: string[] = [];
      for (let column = 0; column < width; column += 1) {
        const type = extra.u8();
        if (isBiff8) {
          if (type === 0x00) {
            extra.skip(8);
            values.push("");
          } else if (type === 0x01) values.push(numberText(extra.f64()));
          else if (type === 0x02) {
            const count = extra.u16();
            values.push(stringLiteral(extra.chars(count, (extra.u8() & 1) !== 0)));
          } else if (type === 0x04) {
            values.push(extra.u8() === 0 ? "FALSE" : "TRUE");
            extra.skip(7);
          } else if (type === 0x10) {
            values.push(errorText(extra.u8()));
            extra.skip(7);
          } else stop("unknown-token");
        } else if (type === 0x00) values.push(numberText(extra.f64()));
        else if (type === 0x01) values.push(stringLiteral(extra.chars(extra.u16(), true)));
        else if (type === 0x02) values.push(extra.u8() === 0 ? "FALSE" : "TRUE");
        else if (type === 0x04) values.push(errorText(extra.u8()));
        else stop("unknown-token");
      }
      lines.push(values.join(","));
    }
    return `{${lines.join(";")}}`;
  };

  const skipExtraMem = (): void => {
    const count = isBiff8 ? extra.u16() : extra.u32();
    extra.skip(count * (isBiff8 ? 8 : 16));
  };

  const call = (id: number, argc: number): string => {
    if (id === USER_DEFINED_FUNCTION) {
      if (argc < 1) stop("unbalanced-stack");
      const [name, ...args] = popMany(argc);
      return `${name as string}(${args.join(",")})`;
    }
    const name = FUNCTION_NAMES[id];
    if (name === undefined || name === "") stop("unknown-function");
    return `${name as string}(${popMany(argc).join(",")})`;
  };

  while (!tokens.isAtEnd) {
    const token = tokens.u8();
    if (token < 0x20) {
      const operator = OPERATORS.get(token);
      if (operator !== undefined) {
        const right = pop();
        stack.push(`${pop()}${operator}${right}`);
        continue;
      }
      switch (token) {
        case 0x01:
          stop("shared-formula-reference");
          break;
        case 0x02:
          stop("data-table");
          break;
        case 0x12:
          stack.push(`+${pop()}`);
          break;
        case 0x13:
          stack.push(`-${pop()}`);
          break;
        case 0x14:
          stack.push(`${pop()}%`);
          break;
        case 0x15:
          stack.push(`(${pop()})`);
          break;
        case 0x16:
          stack.push("");
          break;
        case 0x17:
          if (isBiff8) {
            const count = tokens.u8();
            stack.push(stringLiteral(tokens.chars(count, (tokens.u8() & 1) !== 0)));
          } else {
            stack.push(stringLiteral(tokens.chars(tokens.u16(), true)));
          }
          break;
        case 0x18:
          stop(!isBiff8 && tokens.u8() === 0x19 ? "structured-reference" : "unknown-token");
          break;
        case 0x19: {
          const flags = tokens.u8();
          const data = tokens.u16();
          if (flags === ATTR.SUM) stack.push(`SUM(${pop()})`);
          else if (flags === ATTR.CHOOSE) tokens.skip((data + 1) * 2);
          else if (!SKIPPED_ATTRS.has(flags)) stop("unknown-token");
          break;
        }
        case 0x1c:
          stack.push(errorText(tokens.u8()));
          break;
        case 0x1d:
          stack.push(tokens.u8() === 0 ? "FALSE" : "TRUE");
          break;
        case 0x1e:
          stack.push(String(tokens.u16()));
          break;
        case 0x1f:
          stack.push(numberText(tokens.f64()));
          break;
        default:
          stop("unknown-token");
      }
      continue;
    }

    switch (token & 0x1f) {
      case 0x00:
        tokens.skip(isBiff8 ? 7 : 14);
        stack.push(arrayConstant());
        break;
      case 0x01: {
        const id = tokens.u16();
        const arity = FIXED_ARITY.get(id);
        if (arity === undefined) stop("unknown-function");
        stack.push(call(id, arity as number));
        break;
      }
      case 0x02: {
        const argc = tokens.u8() & 0x7f;
        const tab = tokens.u16();
        if ((tab & 0x8000) !== 0) stop("macro-function");
        stack.push(call(tab & 0x7fff, argc));
        break;
      }
      case 0x03:
        stack.push(ctx.definedNames[tokens.u32() - 1] ?? stop("unknown-name"));
        break;
      case 0x04:
        stack.push(refOperand(false));
        break;
      case 0x05:
        stack.push(areaOperand(false));
        break;
      case 0x06:
        tokens.skip(6);
        skipExtraMem();
        break;
      case 0x07:
      case 0x08:
        tokens.skip(6);
        break;
      case 0x09:
        tokens.skip(2);
        break;
      case 0x0a:
        tokens.skip(isBiff8 ? 4 : 6);
        stack.push("#REF!");
        break;
      case 0x0b:
        tokens.skip(isBiff8 ? 8 : 12);
        stack.push("#REF!");
        break;
      case 0x0c:
        stack.push(refOperand(true));
        break;
      case 0x0d:
        stack.push(areaOperand(true));
        break;
      case 0x19: {
        const ixti = tokens.u16();
        stack.push(externName(ixti, tokens.u32()));
        break;
      }
      case 0x1a: {
        const prefix = sheetPrefix(tokens.u16());
        const operand = refOperand(ctx.isSharedFormula);
        stack.push(prefix === null ? "#REF!" : `${prefix}${operand}`);
        break;
      }
      case 0x1b: {
        const prefix = sheetPrefix(tokens.u16());
        const operand = areaOperand(ctx.isSharedFormula);
        stack.push(prefix === null ? "#REF!" : `${prefix}${operand}`);
        break;
      }
      case 0x1c:
      case 0x1d: {
        const prefix = sheetPrefix(tokens.u16());
        tokens.skip((isBiff8 ? 4 : 6) * ((token & 0x1f) === 0x1c ? 1 : 2));
        stack.push(`${prefix ?? ""}#REF!`);
        break;
      }
      default:
        stop("unknown-token");
    }
  }
  if (stack.length !== 1) stop("unbalanced-stack");
  return stack[0] as string;
}

const EMPTY = new Uint8Array(0);

/**
 * Decompiles one parsed formula to the text M03 parses (`=` omitted), or says
 * why it cannot. `rgcb` is the extra data that follows the tokens (array
 * constants, `PtgMemArea` extents); it is consumed in token order.
 */
export function decodePtgFormula(rgce: Uint8Array, ctx: PtgContextV1, rgcb: Uint8Array = EMPTY): PtgDecodeResultV1 {
  try {
    return { text: decode(rgce, ctx, rgcb) };
  } catch (cause) {
    if (cause instanceof Undecodable) return { undecodable: cause.reason };
    throw cause;
  }
}
