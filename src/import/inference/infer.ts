/**
 * F02's one-table proposal from a completed delimited stream (M21; FR-4/FR-6/
 * FR-8; CA-16).
 *
 * A delimited file is now the single-sheet case of the workbook path
 * (`workbook.ts`): {@link inferProposal} runs `inferWorkbook` and reads its one
 * table back into the F02 shape, statements and fingerprints unchanged. The
 * F02 shape stays exactly as pinned until S06 migrates its consumers to
 * `ProposedWorkbookV1`.
 *
 * A proposal is **not** an app. Nothing here allocates a domain ID, writes an
 * event, or decides anything a person cannot undo on one review screen. Counts
 * are **exact** — they come from a completed stream — and inference refuses to
 * run on a stream with no summary.
 */

import {
  IMPORT_DIAGNOSTIC_CODES_V1,
  type ImportDiagnosticCodeV1,
  type ImportDiagnosticV1,
  type WorkbookFactStreamItemV2,
} from "../facts/index.js";
import type { DiscardedRowV1, ProposedRowV1, WorkbookDiscardedRowV1 } from "./regions.js";
import {
  INFERENCE_SUBJECTS,
  REVIEW_EDIT_KINDS,
  statementIdOf,
  type EvidenceV1,
  type InferenceStatementV1,
  type InferenceSubjectV1,
  type ReviewEditKindV1,
  type WorkbookEvidenceV1,
} from "./statements.js";
import type { ProposedEnumOptionV1, TypeViolationsV1 } from "./types.js";
import type { ProposedFieldTypeV1, SourceValueFormatV1, WorkbookSourceValueFormatV1 } from "./values.js";
import { inferWorkbook } from "./workbook.js";

export {
  DISCARD_REASONS,
  PROPOSAL_DISCARDED_ROW_LIMIT,
  PROPOSAL_LEADING_ROWS,
  detectHeaderRow,
  fieldNamesFrom,
  generatedFieldName,
  type DiscardReasonV1,
  type DiscardedRowV1,
  type ProposedRowV1,
} from "./regions.js";
export {
  ENUM_MINIMUM_VALUES,
  ENUM_OPTION_LIMIT,
  TYPE_CONFIDENCE,
  type ProposedEnumOptionV1,
  type TypeViolationsV1,
} from "./types.js";

export interface ProposedFieldV1 {
  readonly columnIndex: number;
  readonly fieldName: string;
  /** True when no heading supplied the name and Sheaf generated one. */
  readonly isNameGenerated: boolean;
  readonly type: ProposedFieldTypeV1;
  /** How promotion reads this column's source text (`values.ts`). */
  readonly sourceFormat: SourceValueFormatV1;
  readonly enumOptions: readonly ProposedEnumOptionV1[];
  /**
   * Values that will be preserved and flagged rather than stored typed (FR-6),
   * or `null` after the user overrode the type — nothing has measured the new
   * type yet, and promotion is what will find out.
   */
  readonly violations: TypeViolationsV1 | null;
}

export interface ProposedTableV1 {
  readonly tableName: string;
  readonly fields: readonly ProposedFieldV1[];
}

export interface ProposedAppV1 {
  /** The file this came from — review evidence, and what a refusal would name. */
  readonly fileName: string;
  readonly appName: string;
  readonly table: ProposedTableV1;
  /** Null when the file has no headings and every name was generated. */
  readonly headerRowIndex: number | null;
  /** The first rows verbatim: review evidence, and the header's move range. */
  readonly leadingRows: readonly ProposedRowV1[];
  readonly discardedRows: readonly DiscardedRowV1[];
  readonly discardedRowCount: number;
  /** Data rows the app will hold. Exact — see the module note. */
  readonly rowCount: number;
  /** Always `true`: a proposal is built from a completed stream, never a sample. */
  readonly isRowCountExact: true;
  readonly statements: readonly InferenceStatementV1[];
  readonly diagnostics: readonly ImportDiagnosticV1[];
}

export interface InferenceContextV1 {
  readonly fileName: string;
}

/** A delimited proposal holds only F02 members; anything else is a defect here. */
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

/**
 * A delimited stream as S02's delimited path reads it. The import worker opens
 * a delimited stream with its one `sheet` fact (M65's positional scoping), but
 * `inferWorkbook` recognises a delimited file by the *absence* of a sheet fact
 * — which is what keeps its proposal, statements and fingerprints equal to
 * F02's (CA-19). A delimited file is one sheet by definition, so the fact
 * carries nothing inference could lose.
 */
export function* delimitedStream(
  items: Iterable<WorkbookFactStreamItemV2>,
): Generator<WorkbookFactStreamItemV2> {
  for (const item of items) {
    yield item.kind === "batch" && item.facts.some((fact) => fact.kind === "sheet")
      ? { ...item, facts: item.facts.filter((fact) => fact.kind !== "sheet") }
      : item;
  }
}

/**
 * Reads a completed fact stream and proposes one app with one table.
 *
 * @throws when the stream carries no terminal summary — a cancelled parse has
 * nothing exact to propose from, and guessing would be the one thing a review
 * screen must never have to do.
 */
export function inferProposal(
  items: Iterable<WorkbookFactStreamItemV2>,
  context: InferenceContextV1,
): ProposedAppV1 {
  let diagnostics: readonly ImportDiagnosticV1[] = [];
  function* tap(): Generator<WorkbookFactStreamItemV2> {
    for (const item of delimitedStream(items)) {
      if (item.kind === "summary") {
        diagnostics = item.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          code: f02Member<ImportDiagnosticCodeV1>(diagnostic.code, IMPORT_DIAGNOSTIC_CODES_V1),
        }));
      }
      yield item;
    }
  }
  const workbook = inferWorkbook(tap(), {
    fileName: context.fileName,
    sheetSelection: null,
    rejectionMemory: new Set(),
    fingerprintOf: (input) => input,
    existingApp: null,
  });
  const [table] = workbook.tables;
  if (table === undefined || workbook.tables.length !== 1) {
    return defect("table list");
  }
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
    diagnostics,
  };
}
