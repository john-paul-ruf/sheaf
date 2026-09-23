/**
 * Source AST → stable-reference IR (M03; D49, D58, architecture § Formula IR).
 *
 * Two entrances share one lowering:
 *
 * - {@link translateImported} reads a workbook formula. Its resolver answers
 *   the address questions — which table field a sheet column holds, which
 *   cell is a dashboard formula, which accepted relationship a lookup goes
 *   through. Anything that does not land on imported structure becomes
 *   `unsupported` with a reason from a closed list; nothing is fetched and
 *   nothing outside the workbook is followed (invariant 12).
 * - {@link translateAuthored} reads D58 syntax a person typed: `[Quoted]` for
 *   this row, `Jobs[Quoted]` for a column, `RELATED([Customer],[Name])` across
 *   a relationship. Cell addresses are refused; an unknown name is reported
 *   by name for the editor.
 *
 * Translation is total: it returns a result, never throws, and never returns
 * a partial tree.
 */

import type { FieldId, FormulaId, RelationshipId, TableId } from "../model/ids.js";
import { domainIdsEqual } from "../model/ids.js";
import type { CellCoordinateV1, FormulaAstV1, FormulaReferenceV1, FormulaUnparsedReasonV1 } from "./ast.js";
import { catalogEntryOf } from "./catalog.js";
import { decimalFromNumberText } from "./decimal.js";
import {
  dependenciesOf,
  FORMULA_ERROR_CODES,
  type FormulaDependencyV1,
  type FormulaErrorLiteralV1,
  type FormulaIRDocumentV1,
  type FormulaIRV1,
  type IrBinaryOperatorV1,
} from "./ir.js";
import { parseFormula } from "./parser.js";

/** Why an imported formula is kept as `unsupported` (closed). */
export const IMPORT_UNSUPPORTED_REASONS = Object.freeze([
  "unparsed",
  /** An external workbook (`[1]Sheet!A1`, `[1]!Name`): never fetched. */
  "external-source",
  "three-d-reference",
  "whole-row-reference",
  "unresolved-name",
  /** A cell or range that is neither an imported table column nor a formula node. */
  "outside-imported-structure",
  /** One specific row of a table, or part of a column: not a stable reference. */
  "row-specific-reference",
  "multi-column-range",
  /** A lookup that does not go through an accepted relationship (D49). */
  "unsupported-lookup",
  "unsupported-function",
  "arity",
  "unsupported-operator",
  "array-constant",
  "unsupported-error-literal",
  "number-out-of-range",
] as const);

export type ImportUnsupportedReasonV1 = (typeof IMPORT_UNSUPPORTED_REASONS)[number];

export type TranslationV1 =
  | {
      readonly kind: "translated";
      readonly document: FormulaIRDocumentV1;
      readonly dependencies: readonly FormulaDependencyV1[];
    }
  | {
      readonly kind: "unsupported";
      readonly reason: ImportUnsupportedReasonV1;
      /** The function name for `unsupported-function`/`arity`; otherwise `null`. */
      readonly detail: string | null;
    };

/** One imported table column and the zero-based sheet rows its records occupy. */
export interface ImportedColumnV1 {
  readonly tableId: TableId;
  readonly fieldId: FieldId;
  readonly firstDataRow: number;
  readonly lastDataRow: number;
}

/** An **accepted** relationship whose source is a reference field. */
export interface ImportedRelationshipV1 {
  readonly relationshipId: RelationshipId;
  readonly toTableId: TableId;
  readonly toKeyFieldId: FieldId;
}

/** The workbook questions an imported formula's translation asks (S07 answers them). */
export interface ImportResolverV1 {
  /** The formula's own cell, zero-based. */
  readonly sheet: string;
  readonly row: number;
  readonly column: number;
  /** The table whose computed column this formula fills, or `null` for a metric or dashboard value. */
  readonly tableId: TableId | null;
  /** The imported table column sheet `sheet` column `column` holds, if any. */
  columnAt(sheet: string, column: number): ImportedColumnV1 | null;
  /** The dashboard value or table metric that cell holds, if any. */
  formulaAt(sheet: string, row: number, column: number): FormulaId | null;
  /** `Table[Column]`; a `null` table is the formula's own table. */
  tableColumn(table: string | null, column: string): ImportedColumnV1 | null;
  /** The accepted relationship whose source is this reference field. */
  relationshipFrom(fieldId: FieldId): ImportedRelationshipV1 | null;
  /** A defined name's definition as seen from `sheet`, or `null` when it resolves nowhere. */
  definedName(name: string, sheet: string): FormulaAstV1 | null;
}

/** Why authored formula text is refused (closed). */
export const AUTHORED_REFUSAL_REASONS = Object.freeze([
  "too-long",
  "too-deep",
  "syntax",
  "unsupported-token",
  /** A1 addresses, ranges, sheet or defined-name references: D58 has none. */
  "cell-reference",
  /** `VLOOKUP` and friends: use `RELATED` (D49). */
  "lookup-function",
  "unsupported-function",
  "arity",
  "unsupported-operator",
  "array-constant",
  "unsupported-error-literal",
  "number-out-of-range",
] as const);

export type AuthoredRefusalReasonV1 = (typeof AUTHORED_REFUSAL_REASONS)[number];

export type AuthoredTranslationV1 =
  | {
      readonly kind: "translated";
      readonly document: FormulaIRDocumentV1;
      readonly dependencies: readonly FormulaDependencyV1[];
    }
  /** A name that is not a current field, column, relationship or formula, as written. */
  | { readonly kind: "unknown-name"; readonly name: string }
  | { readonly kind: "refused"; readonly reason: AuthoredRefusalReasonV1; readonly detail: string | null };

/** The current-name questions authored text asks (S06's editor answers them). */
export interface AuthoredResolverV1 {
  /** A field of the formula's own table; `null` when the target has no row or no such field. */
  thisRowField(name: string): FieldId | null;
  tableColumn(table: string, column: string): { readonly tableId: TableId; readonly fieldId: FieldId } | null;
  /** `RELATED([referenceField],[field])` through the reference field's active relationship. */
  relatedField(
    referenceField: string,
    field: string,
  ): { readonly relationshipId: RelationshipId; readonly referenceFieldId: FieldId; readonly fieldId: FieldId } | null;
  /** A table metric or dashboard value by display name. */
  formulaNamed(name: string): FormulaId | null;
}

// ------------------------------------------------------------ shared lowering --

type SharedReason = Extract<ImportUnsupportedReasonV1, AuthoredRefusalReasonV1>;

/** Unwinds a translation; caught at the entrance and returned as a result. */
class Stop extends Error {
  constructor(
    readonly reason: ImportUnsupportedReasonV1 | AuthoredRefusalReasonV1 | "unknown-name",
    readonly detail: string | null = null,
  ) {
    super(reason);
  }
}

const stop = (reason: ConstructorParameters<typeof Stop>[0], detail: string | null = null): never => {
  throw new Stop(reason, detail);
};

interface Lowering {
  reference(reference: FormulaReferenceV1): FormulaIRV1;
  /** A call handled specially (lookups, `RELATED`), or `undefined` for the catalog path. */
  special(call: Extract<FormulaAstV1, { kind: "call" }>): FormulaIRV1 | undefined;
}

const IR_OPERATORS = new Set<string>(["+", "-", "*", "/", "^", "&", "=", "<>", "<", "<=", ">", ">="]);
const ERROR_LITERALS = new Set<string>(FORMULA_ERROR_CODES.filter((code) => code !== "#BUDGET"));

function lower(ast: FormulaAstV1, lowering: Lowering): FormulaIRV1 {
  const next = (node: FormulaAstV1): FormulaIRV1 => lower(node, lowering);
  switch (ast.kind) {
    case "number": {
      const decimal = decimalFromNumberText(ast.text);
      return decimal === null
        ? stop("number-out-of-range" satisfies SharedReason)
        : { kind: "literal", value: { kind: "decimal", decimal } };
    }
    case "string":
      return { kind: "literal", value: { kind: "text", text: ast.value.normalize("NFC") } };
    case "boolean":
      return { kind: "literal", value: { kind: "boolean", boolean: ast.value } };
    case "error":
      return ERROR_LITERALS.has(ast.code)
        ? { kind: "error", code: ast.code as FormulaErrorLiteralV1 }
        : stop("unsupported-error-literal" satisfies SharedReason);
    case "array":
      return stop("array-constant" satisfies SharedReason);
    case "reference":
      return lowering.reference(ast.reference);
    case "group":
      return next(ast.expression);
    case "percent":
      return { kind: "unary", operator: "%", operand: next(ast.operand) };
    case "unary": {
      const operand = next(ast.operand);
      // `-5` is one literal, so a rendered negative number reads back unchanged.
      if (ast.operator === "-" && operand.kind === "literal" && operand.value.kind === "decimal" && !operand.value.decimal.startsWith("-")) {
        const decimal = operand.value.decimal;
        return { kind: "literal", value: { kind: "decimal", decimal: /^0(\.0+)?$/.test(decimal) ? decimal : `-${decimal}` } };
      }
      return { kind: "unary", operator: ast.operator, operand };
    }
    case "binary":
      return IR_OPERATORS.has(ast.operator)
        ? {
            kind: "binary",
            operator: ast.operator as IrBinaryOperatorV1,
            left: next(ast.left),
            right: next(ast.right),
          }
        : stop("unsupported-operator" satisfies SharedReason);
    case "call": {
      const special = lowering.special(ast);
      if (special !== undefined) return special;
      const entry = catalogEntryOf(ast.name);
      if (entry === undefined) return stop("unsupported-function" satisfies SharedReason, ast.name);
      if (ast.args.length < entry.minArgs || ast.args.length > entry.maxArgs) {
        return stop("arity" satisfies SharedReason, ast.name);
      }
      return {
        kind: "call",
        name: entry.name,
        version: entry.version,
        args: ast.args.map((argument) => (argument === null ? null : next(argument))),
      };
    }
    default: {
      const unreachable: never = ast;
      return unreachable;
    }
  }
}

const documentOf = (root: FormulaIRV1) => {
  const document: FormulaIRDocumentV1 = { irVersion: 1, root };
  return { kind: "translated" as const, document, dependencies: dependenciesOf(document) };
};

// ------------------------------------------------------------------ imported --

const LOOKUP_NAMES = new Set(["VLOOKUP", "HLOOKUP", "XLOOKUP", "INDEX", "MATCH", "LOOKUP"]);
const MAX_NAME_DEPTH = 4;

const unwrap = (ast: FormulaAstV1 | null | undefined): FormulaAstV1 | null => {
  let current = ast ?? null;
  while (current?.kind === "group") current = current.expression;
  return current;
};

const integerLiteralOf = (ast: FormulaAstV1 | null | undefined): number | null => {
  const node = unwrap(ast);
  if (node?.kind === "number" && /^\d{1,5}$/.test(node.text)) return Number(node.text);
  return null;
};

const isExactMatchFlag = (ast: FormulaAstV1 | null | undefined): boolean => {
  const node = unwrap(ast);
  return (node?.kind === "boolean" && !node.value) || (node?.kind === "number" && /^0+$/.test(node.text));
};

/**
 * Translates one imported formula. The formula's own row, sheet and table
 * come from the resolver.
 */
export function translateImported(ast: FormulaAstV1, resolver: ImportResolverV1): TranslationV1 {
  let nameDepth = 0;

  const sheetOf = (reference: FormulaReferenceV1): string => {
    if (reference.kind === "structured") return resolver.sheet;
    const scope = reference.scope;
    if (scope === null) return resolver.sheet;
    if (scope.workbook !== null) return stop("external-source");
    if (scope.lastSheet !== null) return stop("three-d-reference");
    return scope.firstSheet;
  };

  const isOwnTable = (tableId: TableId): boolean =>
    resolver.tableId !== null && domainIdsEqual(resolver.tableId, tableId);

  const cell = (sheet: string, coordinate: CellCoordinateV1): FormulaIRV1 => {
    const column = resolver.columnAt(sheet, coordinate.column);
    const isDataRow = column !== null && coordinate.row >= column.firstDataRow && coordinate.row <= column.lastDataRow;
    if (isDataRow && coordinate.row === resolver.row && sheet === resolver.sheet && isOwnTable(column.tableId)) {
      return { kind: "field", fieldId: column.fieldId };
    }
    const formulaId = resolver.formulaAt(sheet, coordinate.row, coordinate.column);
    if (formulaId !== null) return { kind: "formula", formulaId };
    return stop(isDataRow ? "row-specific-reference" : "outside-imported-structure");
  };

  const wholeColumn = (sheet: string, columnIndex: number): FormulaIRV1 => {
    const column = resolver.columnAt(sheet, columnIndex);
    return column === null
      ? stop("outside-imported-structure")
      : { kind: "column", tableId: column.tableId, fieldId: column.fieldId };
  };

  const reference = (target: FormulaReferenceV1): FormulaIRV1 => {
    const sheet = sheetOf(target);
    switch (target.kind) {
      case "cell":
        return cell(sheet, target.cell);
      case "area": {
        if (target.first.column !== target.last.column) return stop("multi-column-range");
        const low = Math.min(target.first.row, target.last.row);
        const high = Math.max(target.first.row, target.last.row);
        if (low === high) return cell(sheet, target.first);
        const column = resolver.columnAt(sheet, target.first.column);
        if (column === null) return stop("outside-imported-structure");
        // The data rows, optionally with the header row above them (D49).
        const coversData = (low === column.firstDataRow || low === column.firstDataRow - 1) && high >= column.lastDataRow;
        return coversData
          ? { kind: "column", tableId: column.tableId, fieldId: column.fieldId }
          : stop("row-specific-reference");
      }
      case "columns":
        return target.firstColumn === target.lastColumn
          ? wholeColumn(sheet, target.firstColumn)
          : stop("multi-column-range");
      case "rows":
        return stop("whole-row-reference");
      case "structured": {
        const specifiers = target.specifiers.filter((specifier) => specifier !== "#Data" && specifier !== "#This Row");
        if (specifiers.length > 0) return stop("outside-imported-structure");
        if (target.firstColumn === null || target.lastColumn !== null) return stop("multi-column-range");
        const column = resolver.tableColumn(target.table, target.firstColumn);
        if (column === null) return stop("unresolved-name");
        if (!target.isThisRow) return { kind: "column", tableId: column.tableId, fieldId: column.fieldId };
        return isOwnTable(column.tableId) ? { kind: "field", fieldId: column.fieldId } : stop("row-specific-reference");
      }
      case "name": {
        const definition = resolver.definedName(target.name, sheet);
        if (definition === null || nameDepth >= MAX_NAME_DEPTH) return stop("unresolved-name");
        nameDepth += 1;
        const lowered = lower(definition, lowering);
        nameDepth -= 1;
        return lowered;
      }
      default: {
        const unreachable: never = target;
        return unreachable;
      }
    }
  };

  /** The imported column `offset` columns right of a range's first column. */
  const rangeColumn = (ast: FormulaAstV1 | null | undefined, offset: number): ImportedColumnV1 | null => {
    const node = unwrap(ast);
    if (node?.kind !== "reference") return null;
    const target = node.reference;
    switch (target.kind) {
      case "cell":
      case "area":
      case "columns": {
        const first = target.kind === "cell" ? target.cell.column : target.kind === "area" ? target.first.column : target.firstColumn;
        const last = target.kind === "cell" ? target.cell.column : target.kind === "area" ? target.last.column : target.lastColumn;
        const column = Math.min(first, last) + offset;
        return column > Math.max(first, last) ? null : resolver.columnAt(sheetOf(target), column);
      }
      case "structured":
        return offset === 0 && target.firstColumn !== null && target.lastColumn === null && !target.isThisRow
          ? resolver.tableColumn(target.table, target.firstColumn)
          : null;
      case "rows":
      case "name":
        return null;
      default: {
        const unreachable: never = target;
        return unreachable;
      }
    }
  };

  const related = (
    key: FormulaAstV1 | null | undefined,
    keyColumn: ImportedColumnV1 | null,
    resultColumn: ImportedColumnV1 | null,
  ): FormulaIRV1 => {
    const keyNode = unwrap(key);
    const referenceField = keyNode?.kind === "reference" ? reference(keyNode.reference) : null;
    if (referenceField?.kind !== "field" || keyColumn === null || resultColumn === null) return stop("unsupported-lookup");
    const relationship = resolver.relationshipFrom(referenceField.fieldId);
    const isThroughRelationship =
      relationship !== null &&
      domainIdsEqual(keyColumn.tableId, relationship.toTableId) &&
      domainIdsEqual(keyColumn.fieldId, relationship.toKeyFieldId) &&
      domainIdsEqual(resultColumn.tableId, relationship.toTableId);
    return isThroughRelationship
      ? {
          kind: "related",
          relationshipId: relationship.relationshipId,
          referenceFieldId: referenceField.fieldId,
          fieldId: resultColumn.fieldId,
        }
      : stop("unsupported-lookup");
  };

  const lowering: Lowering = {
    reference,
    special(call) {
      if (!LOOKUP_NAMES.has(call.name)) return undefined;
      const [first, second, third, fourth] = call.args;
      if (call.name === "VLOOKUP" && call.args.length === 4 && isExactMatchFlag(fourth)) {
        const index = integerLiteralOf(third);
        if (index !== null && index >= 1) return related(first, rangeColumn(second, 0), rangeColumn(second, index - 1));
      }
      if (call.name === "XLOOKUP" && call.args.length === 3) {
        return related(first, rangeColumn(second, 0), rangeColumn(third, 0));
      }
      const match = unwrap(second);
      if (call.name === "INDEX" && call.args.length === 2 && match?.kind === "call" && match.name === "MATCH") {
        const [key, keyRange, matchType] = match.args;
        if (match.args.length === 3 && isExactMatchFlag(matchType)) {
          return related(key, rangeColumn(keyRange, 0), rangeColumn(first, 0));
        }
      }
      return stop("unsupported-lookup");
    },
  };

  try {
    return documentOf(lower(ast, lowering));
  } catch (caught) {
    if (!(caught instanceof Stop)) throw caught;
    return { kind: "unsupported", reason: caught.reason as ImportUnsupportedReasonV1, detail: caught.detail };
  }
}

/**
 * The text entrance for an imported formula: parses, then translates. A
 * formula naming an external workbook's defined name (`[1]!Name`) cannot be
 * parsed by the F03 grammar; it is reported as `external-source`, never
 * `unparsed`, so the kept value says why truthfully.
 */
export function translateImportedText(text: string, resolver: ImportResolverV1): TranslationV1 {
  const parsed = parseFormula(text);
  if (parsed.kind === "parsed") return translateImported(parsed.ast, resolver);
  const outsideStrings = text.replace(/"(?:[^"]|"")*"/g, '""');
  return {
    kind: "unsupported",
    reason: /\[\d+\]!/.test(outsideStrings) ? "external-source" : "unparsed",
    detail: null,
  };
}

// ------------------------------------------------------------------- authored --

/**
 * Translates D58 formula text a person typed, with or without its leading
 * `=`, against the app's current names.
 */
export function translateAuthored(text: string, resolver: AuthoredResolverV1): AuthoredTranslationV1 {
  const parsed = parseFormula(text);
  if (parsed.kind === "unparsed") {
    const reason: FormulaUnparsedReasonV1 = parsed.reason;
    return { kind: "refused", reason, detail: null };
  }

  const columnName = (target: FormulaReferenceV1): string | null =>
    target.kind === "structured" && target.specifiers.length === 0 && target.firstColumn !== null && target.lastColumn === null
      ? target.firstColumn
      : null;

  const lowering: Lowering = {
    reference(target) {
      const name = columnName(target);
      if (target.kind !== "structured" || name === null) return stop("cell-reference");
      if (target.table === null) {
        const fieldId = resolver.thisRowField(name);
        if (fieldId !== null) return { kind: "field", fieldId };
        const formulaId = target.isThisRow ? null : resolver.formulaNamed(name);
        return formulaId === null ? stop("unknown-name", name) : { kind: "formula", formulaId };
      }
      if (target.isThisRow) return stop("cell-reference");
      const column = resolver.tableColumn(target.table, name);
      return column === null
        ? stop("unknown-name", `${target.table}[${name}]`)
        : { kind: "column", tableId: column.tableId, fieldId: column.fieldId };
    },
    special(call) {
      if (LOOKUP_NAMES.has(call.name)) return stop("lookup-function", call.name);
      if (call.name !== "RELATED") return undefined;
      const unqualified = (argument: FormulaAstV1 | null | undefined): string | null => {
        const node = unwrap(argument);
        return node?.kind === "reference" && node.reference.kind === "structured" && node.reference.table === null
          ? columnName(node.reference)
          : null;
      };
      const referenceName = unqualified(call.args[0]);
      const fieldName = unqualified(call.args[1]);
      if (call.args.length !== 2 || referenceName === null || fieldName === null) return stop("arity", "RELATED");
      const found = resolver.relatedField(referenceName, fieldName);
      return found === null
        ? stop("unknown-name", `RELATED([${referenceName}],[${fieldName}])`)
        : { kind: "related", ...found };
    },
  };

  try {
    return documentOf(lower(parsed.ast, lowering));
  } catch (caught) {
    if (!(caught instanceof Stop)) throw caught;
    if (caught.reason === "unknown-name") return { kind: "unknown-name", name: caught.detail ?? "" };
    return { kind: "refused", reason: caught.reason as AuthoredRefusalReasonV1, detail: caught.detail };
  }
}

// ------------------------------------------------------------- filled-down shape --

const relativeCoordinate = (coordinate: CellCoordinateV1, row: number, column: number) => ({
  row: coordinate.isRowAbsolute ? `R${coordinate.row + 1}` : `R[${coordinate.row - row}]`,
  column: coordinate.isColumnAbsolute ? `C${coordinate.column + 1}` : `C[${coordinate.column - column}]`,
});

const shapeOf = (ast: FormulaAstV1 | null, row: number, column: number): unknown => {
  if (ast === null) return null;
  const next = (node: FormulaAstV1 | null): unknown => shapeOf(node, row, column);
  switch (ast.kind) {
    case "reference": {
      const target = ast.reference;
      switch (target.kind) {
        case "cell":
          return ["cell", target.scope, relativeCoordinate(target.cell, row, column)];
        case "area":
          return ["area", target.scope, relativeCoordinate(target.first, row, column), relativeCoordinate(target.last, row, column)];
        case "columns":
          return [
            "columns",
            target.scope,
            target.isFirstAbsolute ? `C${target.firstColumn + 1}` : `C[${target.firstColumn - column}]`,
            target.isLastAbsolute ? `C${target.lastColumn + 1}` : `C[${target.lastColumn - column}]`,
          ];
        case "rows":
          return [
            "rows",
            target.scope,
            target.isFirstAbsolute ? `R${target.firstRow + 1}` : `R[${target.firstRow - row}]`,
            target.isLastAbsolute ? `R${target.lastRow + 1}` : `R[${target.lastRow - row}]`,
          ];
        case "structured":
        case "name":
          return target;
        default: {
          const unreachable: never = target;
          return unreachable;
        }
      }
    }
    case "unary":
      return ["unary", ast.operator, next(ast.operand)];
    case "percent":
      return ["percent", next(ast.operand)];
    case "binary":
      return ["binary", ast.operator, next(ast.left), next(ast.right)];
    case "group":
      return ["group", next(ast.expression)];
    case "call":
      return ["call", ast.name, ast.args.map(next)];
    case "array":
      return ["array", ast.rows];
    case "number":
    case "string":
    case "boolean":
    case "error":
      return ast;
    default: {
      const unreachable: never = ast;
      return unreachable;
    }
  }
};

/**
 * The formula's R1C1-like relative shape as seen from its own cell: two cells
 * of a filled-down column have the same key exactly when they are the same
 * formula relative to their rows (architecture § Formula IR). Absolute
 * anchors stay absolute; everything else is an offset.
 */
export function relativeShapeKey(ast: FormulaAstV1, anchorRow: number, anchorColumn: number): string {
  return JSON.stringify(shapeOf(ast, anchorRow, anchorColumn));
}
