/**
 * The lookup calls in a formula — FR-7's primary relationship signal (M03;
 * D34). A lookup names a key and the range the key is looked up in; M21 turns
 * that into "this column refers to that table's key". Nothing is resolved or
 * evaluated here.
 */

import type { FormulaAstV1, FormulaReferenceV1, SheetScopeV1 } from "./ast.js";
import { extractReferences } from "./references.js";

export const LOOKUP_FUNCTIONS = Object.freeze([
  "VLOOKUP",
  "HLOOKUP",
  "XLOOKUP",
  "LOOKUP",
  "INDEX-MATCH",
] as const);

export type LookupFunctionV1 = (typeof LOOKUP_FUNCTIONS)[number];

/** Where a key is looked up, as far as syntax can say. */
export type LookupRangeV1 =
  | {
      /** A cell, area or whole-column range; the key column is `firstColumn`. */
      readonly kind: "columns";
      readonly scope: SheetScopeV1 | null;
      readonly firstColumn: number;
      readonly lastColumn: number;
    }
  | {
      readonly kind: "table-columns";
      /** `null` for an unqualified structured reference (the formula's own table). */
      readonly table: string | null;
      readonly firstColumn: string | null;
      readonly lastColumn: string | null;
    }
  | { readonly kind: "name"; readonly scope: SheetScopeV1 | null; readonly name: string }
  /** Whole rows, constants or an expression: nothing a key column can come from. */
  | { readonly kind: "other" };

export interface LookupV1 {
  readonly functionName: LookupFunctionV1;
  /** Every reference in the key argument, in reading order. */
  readonly keyReferences: readonly FormulaReferenceV1[];
  readonly lookupRange: LookupRangeV1;
  /** VLOOKUP's column index / HLOOKUP's row index when it is a literal integer. */
  readonly returnIndex: number | null;
}

const unwrap = (ast: FormulaAstV1 | null | undefined): FormulaAstV1 | null => {
  let current = ast ?? null;
  while (current?.kind === "group") current = current.expression;
  return current;
};

/** The range a reference argument denotes; `other` for anything else. */
export function lookupRangeOf(ast: FormulaAstV1 | null | undefined): LookupRangeV1 {
  const node = unwrap(ast);
  if (node?.kind !== "reference") return { kind: "other" };
  const reference = node.reference;
  switch (reference.kind) {
    case "cell":
      return { kind: "columns", scope: reference.scope, firstColumn: reference.cell.column, lastColumn: reference.cell.column };
    case "area":
      return {
        kind: "columns",
        scope: reference.scope,
        firstColumn: Math.min(reference.first.column, reference.last.column),
        lastColumn: Math.max(reference.first.column, reference.last.column),
      };
    case "columns":
      return {
        kind: "columns",
        scope: reference.scope,
        firstColumn: Math.min(reference.firstColumn, reference.lastColumn),
        lastColumn: Math.max(reference.firstColumn, reference.lastColumn),
      };
    case "structured":
      return {
        kind: "table-columns",
        table: reference.table,
        firstColumn: reference.firstColumn,
        lastColumn: reference.lastColumn,
      };
    case "name":
      return { kind: "name", scope: reference.scope, name: reference.name };
    case "rows":
      return { kind: "other" };
    default: {
      const unreachable: never = reference;
      return unreachable;
    }
  }
}

const integerLiteral = (ast: FormulaAstV1 | null | undefined): number | null => {
  const node = unwrap(ast);
  return node?.kind === "number" && /^\d{1,7}$/.test(node.text) ? Number(node.text) : null;
};

const lookupOf = (call: Extract<FormulaAstV1, { kind: "call" }>): LookupV1 | null => {
  const [first, second, third] = call.args;
  const lookup = (
    functionName: LookupFunctionV1,
    key: FormulaAstV1 | null | undefined,
    range: FormulaAstV1 | null | undefined,
    returnIndex: number | null,
  ): LookupV1 | null =>
    key === null || key === undefined || range === null || range === undefined
      ? null
      : { functionName, keyReferences: extractReferences(key), lookupRange: lookupRangeOf(range), returnIndex };

  switch (call.name) {
    case "VLOOKUP":
    case "HLOOKUP":
      return lookup(call.name, first, second, integerLiteral(third));
    case "XLOOKUP":
    case "LOOKUP":
      return lookup(call.name, first, second, null);
    case "INDEX": {
      const match = unwrap(second);
      if (match?.kind !== "call" || match.name !== "MATCH") return null;
      const [key, keyRange, matchType] = match.args;
      return integerLiteral(matchType) === 0 ? lookup("INDEX-MATCH", key, keyRange, null) : null;
    }
    default:
      return null;
  }
};

const walk = (ast: FormulaAstV1 | null, into: LookupV1[]): void => {
  if (ast === null) return;
  switch (ast.kind) {
    case "call": {
      const lookup = lookupOf(ast);
      if (lookup !== null) into.push(lookup);
      for (const argument of ast.args) walk(argument, into);
      return;
    }
    case "unary":
    case "percent":
      walk(ast.operand, into);
      return;
    case "binary":
      walk(ast.left, into);
      walk(ast.right, into);
      return;
    case "group":
      walk(ast.expression, into);
      return;
    case "array":
    case "reference":
    case "number":
    case "string":
    case "boolean":
    case "error":
      return;
    default: {
      const unreachable: never = ast;
      return unreachable;
    }
  }
};

/**
 * `VLOOKUP`, `HLOOKUP`, `XLOOKUP`, `LOOKUP`, and `INDEX(range, MATCH(key,
 * keyRange, 0))`, outermost first, including lookups nested inside other
 * calls.
 */
export function findLookups(ast: FormulaAstV1): readonly LookupV1[] {
  const lookups: LookupV1[] = [];
  walk(ast, lookups);
  return lookups;
}
