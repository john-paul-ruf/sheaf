/**
 * The parts of a `ProposedWorkbookV1` the demo pin states exactly: every
 * table, field, type, option, key, label, relationship, classification, inert
 * count and statement (with its evidence kinds, disposition and fingerprint
 * input). Leading-row cells are left to the structure tests.
 */

import type { ProposedWorkbookV1 } from "../../../../src/import/inference/workbook-proposal.js";
import type { ProposedWorkbookFieldTypeV1, WorkbookSourceValueFormatV1 } from "../../../../src/import/inference/values.js";

const typeText = (type: ProposedWorkbookFieldTypeV1): string => (type.kind === "currency" ? `currency:${type.currencyCode}` : type.kind);

const formatText = (format: WorkbookSourceValueFormatV1): string =>
  format.kind === "decimal"
    ? `decimal:${format.currencySymbol ?? ""}`
    : format.kind === "serial-date"
      ? `serial-date:${format.system}`
      : format.kind === "slash-date"
        ? `slash-date:${format.order}`
        : format.kind;

export const pinOf = (proposal: ProposedWorkbookV1) => ({
  appName: proposal.appName,
  isDelimited: proposal.isDelimited,
  sheets: proposal.sheets.map((sheet) => [sheet.sheetKey, sheet.name, sheet.isSelected, sheet.classification]),
  tables: proposal.tables.map((table) => ({
    tableKey: table.tableKey,
    tableName: table.tableName,
    source: table.source.kind,
    joinedTo: table.joinedToTableKey,
    headerRowIndex: table.headerRowIndex,
    rowCount: table.rowCount,
    discardedRowCount: table.discardedRowCount,
    key: table.keyColumnKey,
    label: table.labelColumnKey,
    fields: table.fields.map((field) => [
      field.columnKey,
      field.fieldName,
      typeText(field.type),
      typeText(field.valueType),
      formatText(field.sourceFormat),
      field.enumOptions.map((option) => option.label),
      field.violations === null ? null : field.violations.count,
      field.formulaText,
    ]),
  })),
  relationships: proposal.relationships,
  recordRules: proposal.recordRules,
  formulas: proposal.formulas.map((formula) => [
    formula.formulaKey,
    formula.target.kind,
    formula.displayName,
    formula.originalText,
    formula.location,
    formula.shapeMatchCount,
    formula.disposition,
    formula.determinism,
    formula.reason,
    formula.relationshipKey,
    formula.isActive,
  ]),
  inertCounts: Object.fromEntries(Object.entries(proposal.inertCounts).filter(([, count]) => count > 0)),
  statements: proposal.statements.map((statement) => [
    statement.statementId,
    statement.subject,
    statement.editKind,
    statement.evidence.map((evidence) => evidence.kind),
    statement.disposition,
    statement.evidenceFingerprint,
  ]),
});
