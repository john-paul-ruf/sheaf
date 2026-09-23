/**
 * A delimited file's proposal, and its F02 view, for the tests that pin F02's
 * behaviour on the production path.
 *
 * `inferProposal` (F02's adapter over `inferWorkbook`) is gone from `src/`
 * (F04 S07): the workbook proposal is the only one production builds. The F02
 * assertions stay meaningful because a delimited workbook proposal still uses
 * only F02 members with F02's fingerprint inputs; {@link f02ViewOf} reads it
 * back into the F02 shape so those assertions — and F02's pure review edits,
 * whose wire shape is still pinned — run against exactly what production
 * proposes, and fail loudly if a workbook-only member ever leaks in.
 */

import {
  IMPORT_DIAGNOSTIC_CODES_V1,
  type ImportDiagnosticCodeV1,
  type WorkbookFactStreamItemV2,
} from "../../../src/import/facts/index.js";
import {
  delimitedStream,
  type DiscardedRowV1,
  type ProposedAppV1,
} from "../../../src/import/inference/infer.js";
import type { WorkbookDiscardedRowV1 } from "../../../src/import/inference/regions.js";
import {
  INFERENCE_SUBJECTS,
  REVIEW_EDIT_KINDS,
  statementIdOf,
  type EvidenceV1,
  type InferenceSubjectV1,
  type ReviewEditKindV1,
  type WorkbookEvidenceV1,
} from "../../../src/import/inference/statements.js";
import type { SourceValueFormatV1, WorkbookSourceValueFormatV1 } from "../../../src/import/inference/values.js";
import type { FormulaIdentitiesV1 } from "../../../src/import/inference/formulas.js";
import { inferWorkbook } from "../../../src/import/inference/workbook.js";
import { reviewFormulaIdentities } from "../../../src/import/staging/formula-identities.js";
import type { ProposedWorkbookV1 } from "../../../src/import/inference/workbook-proposal.js";

/** Review stand-in identities over the platform CSPRNG, as the worker mints them. */
export const testFormulaIdentities = (): FormulaIdentitiesV1 =>
  reviewFormulaIdentities({ randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)) });

/** The production proposal of a delimited stream (no stored rejections, identity fingerprints). */
export const delimitedProposal = (
  items: Iterable<WorkbookFactStreamItemV2>,
  fileName: string,
): ProposedWorkbookV1 =>
  inferWorkbook(delimitedStream(items), {
    fileName,
    sheetSelection: null,
    rejectionMemory: new Set(),
    fingerprintOf: (input) => input,
    formulaIdentities: testFormulaIdentities(),
    existingApp: null,
  });

const defect = (what: string): never => {
  throw new Error(`a delimited proposal carried a workbook-only ${what}`);
};

const f02Member = <T extends string>(value: string, members: readonly T[]): T =>
  (members as readonly string[]).includes(value) ? (value as T) : defect(value);

const f02Evidence = (evidence: WorkbookEvidenceV1): EvidenceV1 => {
  switch (evidence.kind) {
    case "value-pattern":
    case "distinct-values":
    case "header-text":
    case "file-name":
    case "row-shape":
    case "value-conflict":
      return evidence;
    default:
      return defect(evidence.kind);
  }
};

const f02Format = (format: WorkbookSourceValueFormatV1): SourceValueFormatV1 =>
  format.kind === "serial-date" ? defect(format.kind) : format;

const f02Discard = (row: WorkbookDiscardedRowV1): DiscardedRowV1 =>
  row.reason === "totals-row" ? defect(row.reason) : { rowIndex: row.rowIndex, reason: row.reason, cells: row.cells };

/** The one-table workbook proposal read back as F02's `ProposedAppV1`; throws on any workbook-only member. */
export function f02ViewOf(workbook: ProposedWorkbookV1): ProposedAppV1 {
  const [table] = workbook.tables;
  if (table === undefined || workbook.tables.length !== 1) return defect("table list");
  if (workbook.formulas.length > 0 || workbook.charts.length > 0) return defect("formula or chart");
  return {
    fileName: workbook.fileName,
    appName: workbook.appName,
    table: {
      tableName: table.tableName,
      fields: table.fields.map((field) => ({
        columnIndex: field.columnIndex,
        fieldName: field.fieldName,
        isNameGenerated: field.isNameGenerated,
        type: field.valueType,
        sourceFormat: f02Format(field.sourceFormat),
        enumOptions: field.enumOptions,
        violations: field.violations,
      })),
    },
    headerRowIndex: table.headerRowIndex,
    leadingRows: table.leadingRows,
    discardedRows: table.discardedRows.map(f02Discard),
    discardedRowCount: table.discardedRowCount,
    rowCount: table.rowCount,
    isRowCountExact: true,
    statements: workbook.statements.map((statement) => {
      const subject = f02Member<InferenceSubjectV1>(statement.subject, INFERENCE_SUBJECTS);
      return {
        statementId: statementIdOf(subject, statement.columnIndex),
        subject,
        editKind: statement.editKind === null ? null : f02Member<ReviewEditKindV1>(statement.editKind, REVIEW_EDIT_KINDS),
        columnIndex: statement.columnIndex,
        evidence: statement.evidence.map(f02Evidence),
        evidenceFingerprint: statement.evidenceFingerprint,
        disposition: statement.disposition,
      };
    }),
    diagnostics: workbook.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      code: f02Member<ImportDiagnosticCodeV1>(diagnostic.code, IMPORT_DIAGNOSTIC_CODES_V1),
    })),
  };
}

/** F02's pinned proposal of a delimited stream, through the production path. */
export const f02ProposalOf = (items: Iterable<WorkbookFactStreamItemV2>, fileName: string): ProposedAppV1 =>
  f02ViewOf(delimitedProposal(items, fileName));
