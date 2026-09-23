/**
 * The stable-reference formula IR (M03; architecture § Formula IR, CA-25).
 *
 * A node names only stable IDs — `FieldId`, `TableId`, `RelationshipId`,
 * `FormulaId`. There is no A1 address, no sheet name and no user-visible
 * name anywhere in the tree, so renaming a table or a field never breaks a
 * formula: the renderer prints current names from IDs (D58).
 *
 * The tree is plain data, the durable payload of `formula.changed`. It is a
 * description of a calculation, never code: the evaluator interprets it
 * node by node inside a step budget (invariant 8).
 */

import { encodeDomainId, type FieldId, type FormulaId, type RelationshipId, type TableId } from "../model/ids.js";
import type { CellValueV1 } from "../model/values.js";
import type { CatalogFunctionNameV1 } from "./catalog.js";

/** Excel's error literals a formula may name, plus Sheaf's own budget refusal. */
export const FORMULA_ERROR_CODES = Object.freeze([
  "#NULL!",
  "#DIV/0!",
  "#VALUE!",
  "#REF!",
  "#NAME?",
  "#NUM!",
  "#N/A",
  "#BUDGET",
] as const);

export type FormulaErrorCodeV1 = (typeof FORMULA_ERROR_CODES)[number];

/** `#BUDGET` is produced by the evaluator only; no formula text can spell it. */
export type FormulaErrorLiteralV1 = Exclude<FormulaErrorCodeV1, "#BUDGET">;

export const IR_BINARY_OPERATORS = Object.freeze([
  "+",
  "-",
  "*",
  "/",
  "^",
  "&",
  "=",
  "<>",
  "<",
  "<=",
  ">",
  ">=",
] as const);

export type IrBinaryOperatorV1 = (typeof IR_BINARY_OPERATORS)[number];

/** The values a literal may hold: never an absent state, an ID, or preserved text. */
export type FormulaLiteralV1 = Extract<CellValueV1, { readonly kind: "text" | "decimal" | "boolean" }>;

export type FormulaIRV1 =
  | { readonly kind: "literal"; readonly value: FormulaLiteralV1 }
  | { readonly kind: "error"; readonly code: FormulaErrorLiteralV1 }
  /** This row's value of a field of the formula's own table. */
  | { readonly kind: "field"; readonly fieldId: FieldId }
  /** Every row's value of one field — the argument of an aggregate. */
  | { readonly kind: "column"; readonly tableId: TableId; readonly fieldId: FieldId }
  /**
   * The parent row's `fieldId`, reached from this row's `referenceFieldId`
   * through `relationshipId` (D49: a lookup through an accepted relationship).
   */
  | {
      readonly kind: "related";
      readonly relationshipId: RelationshipId;
      readonly referenceFieldId: FieldId;
      readonly fieldId: FieldId;
    }
  /** Another table metric or dashboard value. */
  | { readonly kind: "formula"; readonly formulaId: FormulaId }
  | { readonly kind: "unary"; readonly operator: "+" | "-" | "%"; readonly operand: FormulaIRV1 }
  | {
      readonly kind: "binary";
      readonly operator: IrBinaryOperatorV1;
      readonly left: FormulaIRV1;
      readonly right: FormulaIRV1;
    }
  | {
      readonly kind: "call";
      readonly name: CatalogFunctionNameV1;
      /** The catalog entry version the formula was translated against. */
      readonly version: number;
      /** `null` marks an omitted argument (`IF(x,,y)`). */
      readonly args: readonly (FormulaIRV1 | null)[];
    };

export interface FormulaIRDocumentV1 {
  readonly irVersion: 1;
  readonly root: FormulaIRV1;
}

/** migration 005's `formulas.target_kind` CHECK, verbatim. */
export const FORMULA_TARGET_KINDS = Object.freeze([
  "computed-column",
  "table-metric",
  "dashboard-value",
] as const);

export type FormulaTargetKindV1 = (typeof FORMULA_TARGET_KINDS)[number];

/** Where a formula's result lives; the shape is migration 005's target CHECK. */
export type FormulaTargetV1 =
  | { readonly kind: "computed-column"; readonly tableId: TableId; readonly fieldId: FieldId }
  | { readonly kind: "table-metric"; readonly tableId: TableId }
  | { readonly kind: "dashboard-value"; readonly tableId: TableId | null };

/** migration 005's `formulas.disposition` CHECK, verbatim. */
export const FORMULA_DISPOSITIONS = Object.freeze(["live", "frozen", "unsupported"] as const);

export type FormulaDispositionV1 = (typeof FORMULA_DISPOSITIONS)[number];

/** migration 005's `formulas.determinism` CHECK, verbatim. */
export const FORMULA_DETERMINISMS = Object.freeze([
  "deterministic",
  "clock-volatile",
  "frozen-nondeterministic",
  "unsupported",
] as const);

export type FormulaDeterminismV1 = (typeof FORMULA_DETERMINISMS)[number];

/** migration 005's `formula_dependencies.dependency_kind` CHECK, verbatim. */
export const FORMULA_DEPENDENCY_KINDS = Object.freeze(["field", "formula"] as const);

export type FormulaDependencyV1 =
  | { readonly kind: "field"; readonly fieldId: FieldId }
  | { readonly kind: "formula"; readonly formulaId: FormulaId };

const visit = (node: FormulaIRV1 | null, into: (node: FormulaIRV1) => void): void => {
  if (node === null) return;
  into(node);
  switch (node.kind) {
    case "unary":
      visit(node.operand, into);
      return;
    case "binary":
      visit(node.left, into);
      visit(node.right, into);
      return;
    case "call":
      for (const argument of node.args) visit(argument, into);
      return;
    case "literal":
    case "error":
    case "field":
    case "column":
    case "related":
    case "formula":
      return;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
};

/** Every node, parents before children, arguments in order. */
export function irNodesOf(root: FormulaIRV1): readonly FormulaIRV1[] {
  const nodes: FormulaIRV1[] = [];
  visit(root, (node) => nodes.push(node));
  return nodes;
}

/**
 * The durable `formula_dependencies` rows of a document: each field and
 * formula it reads, once, in first-reading order. A `related` node depends on
 * both the reference field that picks the parent and the parent field it
 * reads, so changing either recalculates it.
 */
export function dependenciesOf(document: FormulaIRDocumentV1): readonly FormulaDependencyV1[] {
  const seen = new Set<string>();
  const dependencies: FormulaDependencyV1[] = [];
  const addField = (fieldId: FieldId): void => {
    const key = `field:${encodeDomainId(fieldId)}`;
    if (seen.has(key)) return;
    seen.add(key);
    dependencies.push({ kind: "field", fieldId });
  };
  for (const node of irNodesOf(document.root)) {
    if (node.kind === "field" || node.kind === "column") addField(node.fieldId);
    else if (node.kind === "related") {
      addField(node.referenceFieldId);
      addField(node.fieldId);
    } else if (node.kind === "formula") {
      const key = `formula:${encodeDomainId(node.formulaId)}`;
      if (!seen.has(key)) {
        seen.add(key);
        dependencies.push({ kind: "formula", formulaId: node.formulaId });
      }
    }
  }
  return dependencies;
}

/**
 * One formula as a definition (CA-25): stable ID, target, the text as
 * authored or imported, its IR (`null` only when unsupported), disposition,
 * determinism and dependencies. It never holds an evaluated value.
 */
export interface FormulaDefinitionV1 {
  readonly formulaId: FormulaId;
  readonly target: FormulaTargetV1;
  readonly displayName: string | null;
  readonly originalText: string;
  readonly document: FormulaIRDocumentV1 | null;
  readonly disposition: FormulaDispositionV1;
  readonly determinism: FormulaDeterminismV1;
  readonly dependencies: readonly FormulaDependencyV1[];
}
