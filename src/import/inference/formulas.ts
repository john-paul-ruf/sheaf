/**
 * Imported formulas made live (M21; FR-14 a–d, FR-5 "summary tabs → dashboard
 * metrics"; D49, D51; CAP-38).
 *
 * A proposal names each formula by its place and keeps its text; this module
 * decides what the formula becomes by translating that text (M03's
 * `translateImportedText`) against the proposal's structure:
 *
 * - a **computed column** — every data row of a table column holds the same
 *   formula relative to its row (the fill-down proof); anything less is kept
 *   as imported values, `not-filled-down`;
 * - a **table metric** — a formula in a table's totals row or footer;
 * - a **dashboard value** — a formula cell on a summary sheet, labelled by the
 *   text to its left; one dashboard value may read another (`B4-B5`).
 *
 * Lookups translate only through an **applied** relationship (D49), so
 * rejecting the relationship in review makes the lookup `unsupported` and its
 * values stay (they are re-derived after every review edit). A formula the
 * catalog or the structure cannot state is `unsupported`; a nondeterministic
 * one is `frozen` in a column (each record keeps its value, D51) and
 * `unsupported` as a metric or dashboard value, which has no record to keep a
 * frozen value in (`value-not-kept`).
 *
 * The same translation runs twice: under stand-in identities, to tell the
 * review what each formula will be, and at promotion under the
 * allocated identities, to write it. Both read only the reviewed proposal, so
 * they agree.
 */

import {
  classifyFormula,
  irNodesOf,
  type FormulaDefinitionV1,
  type FormulaDependencyV1,
  type FormulaDeterminismV1,
  type FormulaDispositionV1,
  type FormulaIRDocumentV1,
  type ImportedColumnV1,
  type ImportedRelationshipV1,
  type ImportResolverV1,
  translateImportedText,
} from "../../domain/formulas/index.js";
import { PRESERVED_PART_KINDS, type PreservedPartKindV1, type PreservedReasonKeyV1 } from "../facts/index.js";
import { workbookStatementIdOf, type WorkbookEvidenceV1 } from "./statements.js";
import type {
  FormulaKeepReasonV1,
  ProposedFormulaV1,
  ProposedInertItemV1,
  ProposedTableV2,
  ProposedWorkbookV1,
} from "./workbook-proposal.js";

/**
 * The identities a translation names: the allocated ones at promotion, and
 * stand-ins at review (M23 supplies both; M21 never makes an identity). The
 * types are M03's own, so nothing here reaches past the formula engine.
 */
export interface FormulaIdentitiesV1 {
  tableId(tableKey: string): ImportedColumnV1["tableId"];
  fieldId(columnKey: string): ImportedColumnV1["fieldId"];
  relationshipId(relationshipKey: string): ImportedRelationshipV1["relationshipId"];
  formulaId(formulaKey: string): FormulaDefinitionV1["formulaId"];
}

/** Byte equality of two identities of one kind. */
const sameId = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

export interface FormulaOutcomeV1 {
  readonly disposition: FormulaDispositionV1;
  readonly determinism: FormulaDeterminismV1;
  readonly reason: FormulaKeepReasonV1 | null;
  readonly detail: string | null;
  readonly document: FormulaIRDocumentV1 | null;
  readonly dependencies: readonly FormulaDependencyV1[];
  /** The applied relationship a lookup goes through, by key. */
  readonly relationshipKey: string | null;
}

const kept = (reason: FormulaKeepReasonV1, detail: string | null = null): FormulaOutcomeV1 => ({
  disposition: "unsupported",
  determinism: "unsupported",
  reason,
  detail,
  document: null,
  dependencies: [],
  relationshipKey: null,
});

const sameName = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

/** The table a key names, followed to the table it promotes as part of. */
const headOf = (proposal: ProposedWorkbookV1, tableKey: string): ProposedTableV2 | undefined => {
  const table = proposal.tables.find((candidate) => candidate.tableKey === tableKey);
  return table?.joinedToTableKey == null ? table : proposal.tables.find((candidate) => candidate.tableKey === table.joinedToTableKey);
};

const firstDataRowOf = (table: ProposedTableV2): number =>
  table.headerRowIndex !== null
    ? table.headerRowIndex + 1
    : table.source.kind === "declared-table"
      ? table.source.range.firstRow
      : (table.leadingRows[0]?.rowIndex ?? 0);

/** A declared table's column as its structured references spell it: the header text. */
const structuredNameOf = (table: ProposedTableV2, columnIndex: number): string | null => {
  const header = table.leadingRows.find((row) => row.rowIndex === table.headerRowIndex);
  return header?.cells[columnIndex - table.firstColumn] ?? null;
};

/** The resolver M03 asks the workbook questions through (`ImportResolverV1`). */
export function resolverFor(proposal: ProposedWorkbookV1, formula: ProposedFormulaV1, ids: FormulaIdentitiesV1): ImportResolverV1 {
  const sheetNameOf = (sheetKey: string): string => proposal.sheets.find((sheet) => sheet.sheetKey === sheetKey)?.name ?? "";
  const heads = proposal.tables.filter((table) => table.joinedToTableKey === null);
  const importedColumn = (table: ProposedTableV2, columnIndex: number): ImportedColumnV1 | null => {
    const field = table.fields.find((candidate) => candidate.columnIndex === columnIndex);
    if (field === undefined || table.lastDataRowIndex === null) return null;
    return {
      tableId: ids.tableId(table.tableKey),
      fieldId: ids.fieldId(field.columnKey),
      firstDataRow: firstDataRowOf(table),
      lastDataRow: table.lastDataRowIndex,
    };
  };
  const ownTableKey = formula.target.kind === "dashboard-value" ? null : formula.target.tableKey;
  const ownTable = ownTableKey === null ? undefined : headOf(proposal, ownTableKey);
  return {
    sheet: sheetNameOf(formula.sheetKey),
    row: formula.rowIndex,
    column: formula.columnIndex,
    tableId: formula.target.kind === "computed-column" && ownTable !== undefined ? ids.tableId(ownTable.tableKey) : null,
    columnAt(sheet, column) {
      const table = heads.find(
        (candidate) =>
          sameName(sheetNameOf(candidate.sheetKey), sheet) && column >= candidate.firstColumn && column <= candidate.lastColumn,
      );
      return table === undefined ? null : importedColumn(table, column);
    },
    formulaAt(sheet, row, column) {
      const found = proposal.formulas.find(
        (candidate) =>
          candidate.target.kind !== "computed-column" &&
          candidate.rowIndex === row &&
          candidate.columnIndex === column &&
          sameName(sheetNameOf(candidate.sheetKey), sheet),
      );
      return found === undefined ? null : ids.formulaId(found.formulaKey);
    },
    tableColumn(tableName, columnName) {
      const table =
        tableName === null
          ? ownTable
          : heads.find(
              (candidate) =>
                (candidate.source.kind === "declared-table" && sameName(candidate.source.name, tableName)) ||
                sameName(candidate.tableName, tableName),
            );
      const field = table?.fields.find((candidate) => {
        const spelled = structuredNameOf(table, candidate.columnIndex) ?? candidate.fieldName;
        return sameName(spelled, columnName) || sameName(candidate.fieldName, columnName);
      });
      return table === undefined || field === undefined ? null : importedColumn(table, field.columnIndex);
    },
    relationshipFrom(fieldId) {
      const relationship = proposal.relationships.find(
        (candidate) => candidate.isApplied && sameId(ids.fieldId(candidate.fromColumnKey), fieldId),
      );
      const parent = relationship === undefined ? undefined : headOf(proposal, relationship.toTableKey);
      return relationship === undefined || parent === undefined
        ? null
        : {
            relationshipId: ids.relationshipId(relationship.relationshipKey),
            toTableId: ids.tableId(parent.tableKey),
            toKeyFieldId: ids.fieldId(relationship.toColumnKey),
          };
    },
    // Defined names are not carried into the proposal; a formula naming one
    // is kept as imported values (`unresolved-name`), never guessed.
    definedName: () => null,
  };
}

/** The rows a computed column must fill: its table's data rows, with every table joined to it. */
const dataRowsOf = (proposal: ProposedWorkbookV1, tableKey: string): number => {
  const head = headOf(proposal, tableKey);
  return head === undefined
    ? 0
    : proposal.tables
        .filter((table) => table.tableKey === head.tableKey || table.joinedToTableKey === head.tableKey)
        .reduce((sum, table) => sum + table.rowCount, 0);
};

/** What one proposed formula becomes under `ids`. */
export function translateProposedFormula(
  proposal: ProposedWorkbookV1,
  formula: ProposedFormulaV1,
  ids: FormulaIdentitiesV1,
): FormulaOutcomeV1 {
  if (formula.originalText === "") return kept("unreadable");
  if (formula.isArray) return kept("array-formula");
  if (formula.target.kind === "computed-column" && formula.shapeMatchCount < dataRowsOf(proposal, formula.target.tableKey)) {
    return kept("not-filled-down");
  }
  const translation = translateImportedText(formula.originalText, resolverFor(proposal, formula, ids));
  if (translation.kind === "unsupported") return kept(translation.reason, translation.detail);
  const classification = classifyFormula(translation.document);
  if (classification.disposition === "unsupported") return kept("unsupported-function");
  if (classification.disposition === "frozen" && formula.target.kind !== "computed-column") return kept("value-not-kept");
  const related = irNodesOf(translation.document.root).find((node) => node.kind === "related");
  const relationshipKey =
    related?.kind !== "related"
      ? null
      : (proposal.relationships.find((candidate) => sameId(ids.relationshipId(candidate.relationshipKey), related.relationshipId))
          ?.relationshipKey ?? null);
  return {
    ...classification,
    reason: null,
    detail: null,
    document: translation.document,
    dependencies: translation.dependencies,
    relationshipKey,
  };
}

/** The review's evidence of what a formula became. */
export const formulaOutcomeEvidence = (proposal: ProposedWorkbookV1, formula: ProposedFormulaV1): WorkbookEvidenceV1 => {
  const relationship = proposal.relationships.find((candidate) => candidate.relationshipKey === formula.relationshipKey);
  const parent = relationship === undefined ? undefined : headOf(proposal, relationship.toTableKey);
  return {
    kind: "formula-outcome",
    target: formula.target.kind,
    disposition: formula.disposition,
    determinism: formula.determinism,
    reason: formula.reason,
    detail: formula.detail,
    shapeMatchCount: formula.shapeMatchCount,
    rowCount: formula.target.kind === "computed-column" ? dataRowsOf(proposal, formula.target.tableKey) : null,
    shapeBreakRowIndex: formula.shapeBreakRowIndex,
    relatedTableName: parent?.tableName ?? null,
  };
};

/** The inert item a formula leaves: its values kept, and why. */
const inertOf = (formula: ProposedFormulaV1): ProposedInertItemV1 | null => {
  const reasonKey: PreservedReasonKeyV1 | null = !formula.isActive
    ? "formula-not-live-yet"
    : formula.disposition === "unsupported"
      ? "formula-not-supported"
      : null;
  return reasonKey === null
    ? null
    : { kind: "formula", sheetKey: formula.sheetKey, location: formula.location, reasonKey, anchor: formula.anchor };
};

export const countInert = (items: readonly ProposedInertItemV1[]): Readonly<Record<PreservedPartKindV1, number>> => {
  const counts = Object.fromEntries(PRESERVED_PART_KINDS.map((kind) => [kind, 0])) as Record<PreservedPartKindV1, number>;
  for (const item of items) counts[item.kind] += 1;
  return counts;
};

/**
 * The review surface a proposal's formulas imply as they now stand: each
 * formula statement's outcome evidence, and the inert items a declined or
 * unsupported formula leaves. Needs no identity; a review edit that only
 * accepts or declines a formula runs this alone.
 */
export function deriveFormulaSurface(proposal: ProposedWorkbookV1): ProposedWorkbookV1 {
  if (proposal.formulas.length === 0) return proposal;
  const byStatement = new Map(proposal.formulas.map((formula) => [workbookStatementIdOf("formula", formula.formulaKey), formula]));
  const statements = proposal.statements.map((statement) => {
    const formula = byStatement.get(statement.statementId);
    return formula === undefined
      ? statement
      : {
          ...statement,
          evidence: [
            ...statement.evidence.filter((evidence) => evidence.kind !== "formula-outcome"),
            formulaOutcomeEvidence(proposal, formula),
          ],
        };
  });
  const owned = new Set(proposal.formulas.map((formula) => `${formula.sheetKey}|${formula.location}`));
  const inertItems = [
    ...proposal.inertItems.filter((item) => item.kind !== "formula" || !owned.has(`${item.sheetKey}|${item.location}`)),
    ...proposal.formulas.flatMap((formula) => inertOf(formula) ?? []),
  ];
  return { ...proposal, statements, inertItems, inertCounts: countInert(inertItems) };
}

/**
 * Re-derives every formula's outcome from the proposal as it now stands, then
 * its review surface. Pure and idempotent; a review edit that can change what
 * a formula translates to — a relationship, a header, a join — runs it.
 */
export function refreshFormulas(proposal: ProposedWorkbookV1, ids: FormulaIdentitiesV1): ProposedWorkbookV1 {
  if (proposal.formulas.length === 0) return proposal;
  const formulas = proposal.formulas.map((formula) => {
    const outcome = translateProposedFormula(proposal, formula, ids);
    return {
      ...formula,
      disposition: outcome.disposition,
      determinism: outcome.determinism,
      reason: outcome.reason,
      detail: outcome.detail,
      relationshipKey: outcome.relationshipKey,
    };
  });
  return deriveFormulaSurface({ ...proposal, formulas });
}
