/**
 * Every reference a formula names, in reading order (M03; D34). Syntax only:
 * nothing is resolved against a workbook here.
 */

import type { FormulaAstV1, FormulaReferenceV1 } from "./ast.js";

const collect = (ast: FormulaAstV1 | null, into: FormulaReferenceV1[]): void => {
  if (ast === null) return;
  switch (ast.kind) {
    case "reference":
      into.push(ast.reference);
      return;
    case "unary":
    case "percent":
      collect(ast.operand, into);
      return;
    case "binary":
      collect(ast.left, into);
      collect(ast.right, into);
      return;
    case "group":
      collect(ast.expression, into);
      return;
    case "call":
      for (const argument of ast.args) collect(argument, into);
      return;
    case "array":
      for (const row of ast.rows) for (const item of row) collect(item, into);
      return;
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
 * Cell, area, whole-column, whole-row, sheet-qualified (including 3-D and
 * external), structured-table and defined-name references, in the order they
 * appear. A reference with a non-null `scope.workbook` points outside the
 * file.
 */
export function extractReferences(ast: FormulaAstV1): readonly FormulaReferenceV1[] {
  const references: FormulaReferenceV1[] = [];
  collect(ast, references);
  return references;
}

