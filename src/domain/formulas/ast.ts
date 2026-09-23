/**
 * The source AST of one spreadsheet formula (M03; D34, architecture § Formula
 * IR). This is syntax only: nothing here resolves a reference against data or
 * evaluates anything (invariant 8). F04 builds its stable-reference IR from
 * this tree rather than replacing the parser.
 *
 * Every node is plain data — no functions, no prototypes — so a tree can be
 * compared, cloned and printed without knowing where it came from.
 */

/** Which workbook and sheet(s) a reference is qualified with. */
export interface SheetScopeV1 {
  /**
   * The external-workbook token (`1` in `[1]Sheet!A1`), or `null` for this
   * workbook. A non-null value means the reference points outside the file and
   * is never fetched (invariant 12).
   */
  readonly workbook: string | null;
  readonly firstSheet: string;
  /** The last sheet of a 3-D reference (`Sheet1:Sheet3!A1`), else `null`. */
  readonly lastSheet: string | null;
}

/** One A1 corner, zero-based. */
export interface CellCoordinateV1 {
  readonly row: number;
  readonly column: number;
  readonly isRowAbsolute: boolean;
  readonly isColumnAbsolute: boolean;
}

export type FormulaReferenceV1 =
  | { readonly kind: "cell"; readonly scope: SheetScopeV1 | null; readonly cell: CellCoordinateV1 }
  | {
      readonly kind: "area";
      readonly scope: SheetScopeV1 | null;
      readonly first: CellCoordinateV1;
      readonly last: CellCoordinateV1;
    }
  | {
      /** Whole columns, `A:B`. */
      readonly kind: "columns";
      readonly scope: SheetScopeV1 | null;
      readonly firstColumn: number;
      readonly lastColumn: number;
      readonly isFirstAbsolute: boolean;
      readonly isLastAbsolute: boolean;
    }
  | {
      /** Whole rows, `1:3`. */
      readonly kind: "rows";
      readonly scope: SheetScopeV1 | null;
      readonly firstRow: number;
      readonly lastRow: number;
      readonly isFirstAbsolute: boolean;
      readonly isLastAbsolute: boolean;
    }
  | {
      /**
       * `Table[Column]`, `Table[[#Headers],[Col]]`, `[@Col]`. `table` is `null`
       * for an unqualified reference, which names the table the formula sits in.
       */
      readonly kind: "structured";
      readonly table: string | null;
      /** Item specifiers without brackets: `#All`, `#Data`, `#Headers`, `#Totals`, `#This Row`. */
      readonly specifiers: readonly string[];
      readonly firstColumn: string | null;
      readonly lastColumn: string | null;
      /** True for the `@` this-row shorthand. */
      readonly isThisRow: boolean;
    }
  | {
      /** A defined name, possibly sheet- or workbook-qualified. */
      readonly kind: "name";
      readonly scope: SheetScopeV1 | null;
      readonly name: string;
    };

export const BINARY_OPERATORS = Object.freeze([
  ":",
  " ",
  ",",
  "^",
  "*",
  "/",
  "+",
  "-",
  "&",
  "=",
  "<>",
  "<",
  "<=",
  ">",
  ">=",
] as const);

export type BinaryOperatorV1 = (typeof BINARY_OPERATORS)[number];

export type FormulaAstV1 =
  /** A number as authored (`2`, `0.5`, `1E3`); never converted to a float. */
  | { readonly kind: "number"; readonly text: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  /** `#N/A`, `#REF!` … as authored. */
  | { readonly kind: "error"; readonly code: string }
  /** `{1,2;3,4}` — rows of constants. */
  | { readonly kind: "array"; readonly rows: readonly (readonly FormulaAstV1[])[] }
  | { readonly kind: "reference"; readonly reference: FormulaReferenceV1 }
  | { readonly kind: "unary"; readonly operator: "+" | "-"; readonly operand: FormulaAstV1 }
  | { readonly kind: "percent"; readonly operand: FormulaAstV1 }
  | {
      readonly kind: "binary";
      readonly operator: BinaryOperatorV1;
      readonly left: FormulaAstV1;
      readonly right: FormulaAstV1;
    }
  /** Parentheses, kept so a union like `(A1,B1)` and the authored grouping survive. */
  | { readonly kind: "group"; readonly expression: FormulaAstV1 }
  | {
      readonly kind: "call";
      /** Upper-cased, without any `_xlfn.`/`_xlws.` prefix: `XLOOKUP`. */
      readonly name: string;
      /** The stripped future-function prefix as authored (`_xlfn.`), else `null`. */
      readonly prefix: string | null;
      /** `null` marks an omitted argument (`IF(A1,,2)`). */
      readonly args: readonly (FormulaAstV1 | null)[];
    };

export const FORMULA_UNPARSED_REASONS = Object.freeze([
  "too-long",
  "too-deep",
  "syntax",
  "unsupported-token",
] as const);

export type FormulaUnparsedReasonV1 = (typeof FORMULA_UNPARSED_REASONS)[number];

/** Total: a whole tree or a reason, never a partial tree. */
export type FormulaParseResultV1 =
  | { readonly kind: "parsed"; readonly ast: FormulaAstV1 }
  | { readonly kind: "unparsed"; readonly reason: FormulaUnparsedReasonV1 };

/** The Excel limit on formula text. */
export const FORMULA_MAX_LENGTH = 8192;

/** Deeper nesting than this is refused rather than recursed into. */
export const FORMULA_MAX_DEPTH = 64;
