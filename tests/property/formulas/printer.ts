/**
 * A test-only printer for {@link FormulaAstV1}: the inverse the parser's
 * stability property needs. Sheet scopes are always quoted, so a printed 3-D
 * or spaced sheet name can never be mis-read as a range.
 */

import type { CellCoordinateV1, FormulaAstV1, FormulaReferenceV1, SheetScopeV1 } from "../../../src/domain/formulas/index.js";
import { columnLettersOf } from "../../../src/domain/formulas/index.js";

const scopeText = (scope: SheetScopeV1 | null): string => {
  if (scope === null) return "";
  const spec = `${scope.workbook === null ? "" : `[${scope.workbook}]`}${scope.firstSheet}${scope.lastSheet === null ? "" : `:${scope.lastSheet}`}`;
  return `'${spec.replace(/'/g, "''")}'!`;
};

const cellText = (cell: CellCoordinateV1): string =>
  `${cell.isColumnAbsolute ? "$" : ""}${columnLettersOf(cell.column)}${cell.isRowAbsolute ? "$" : ""}${cell.row + 1}`;

const escapeColumn = (name: string): string => name.replace(/['[\]#]/g, "'$&");

const referenceText = (reference: FormulaReferenceV1): string => {
  switch (reference.kind) {
    case "cell":
      return scopeText(reference.scope) + cellText(reference.cell);
    case "area":
      return `${scopeText(reference.scope)}${cellText(reference.first)}:${cellText(reference.last)}`;
    case "columns":
      return `${scopeText(reference.scope)}${reference.isFirstAbsolute ? "$" : ""}${columnLettersOf(reference.firstColumn)}:${reference.isLastAbsolute ? "$" : ""}${columnLettersOf(reference.lastColumn)}`;
    case "rows":
      return `${scopeText(reference.scope)}${reference.isFirstAbsolute ? "$" : ""}${reference.firstRow + 1}:${reference.isLastAbsolute ? "$" : ""}${reference.lastRow + 1}`;
    case "name":
      return scopeText(reference.scope) + reference.name;
    case "structured": {
      const table = reference.table ?? "";
      if (reference.specifiers.length === 0 && reference.isThisRow) {
        return `${table}[@${reference.firstColumn === null ? "" : `[${escapeColumn(reference.firstColumn)}]`}]`;
      }
      const columns =
        reference.firstColumn === null
          ? []
          : reference.lastColumn === null
            ? [`[${escapeColumn(reference.firstColumn)}]`]
            : [`[${escapeColumn(reference.firstColumn)}]:[${escapeColumn(reference.lastColumn)}]`];
      const items = [...reference.specifiers.map((specifier) => `[${specifier}]`), ...columns];
      return `${table}[${items.join(",")}]`;
    }
    default: {
      const unreachable: never = reference;
      return unreachable;
    }
  }
};

export function printFormula(ast: FormulaAstV1): string {
  switch (ast.kind) {
    case "number":
      return ast.text;
    case "string":
      return `"${ast.value.replace(/"/g, '""')}"`;
    case "boolean":
      return ast.value ? "TRUE" : "FALSE";
    case "error":
      return ast.code;
    case "array":
      return `{${ast.rows.map((row) => row.map(printFormula).join(",")).join(";")}}`;
    case "reference":
      return referenceText(ast.reference);
    case "unary":
      return ast.operator + printFormula(ast.operand);
    case "percent":
      return `${printFormula(ast.operand)}%`;
    case "binary":
      return printFormula(ast.left) + ast.operator + printFormula(ast.right);
    case "group":
      return `(${printFormula(ast.expression)})`;
    case "call":
      return `${ast.prefix ?? ""}${ast.name}(${ast.args.map((argument) => (argument === null ? "" : printFormula(argument))).join(",")})`;
    default: {
      const unreachable: never = ast;
      return unreachable;
    }
  }
}
