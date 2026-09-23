/**
 * F02's one-table proposal shape and the delimited stream adapter (M21;
 * FR-4/FR-6/FR-8; CA-16).
 *
 * A delimited file is the single-sheet case of the workbook path
 * (`workbook.ts`), which is the only proposal production builds: F02's
 * `inferProposal` adapter was removed in F04. The F02 shape below stays, as
 * pinned, for the F02 wire and staged-proposal codecs that still name it.
 *
 * A proposal is **not** an app. Nothing here allocates a domain ID, writes an
 * event, or decides anything a person cannot undo on one review screen. Counts
 * are **exact** — they come from a completed stream — and inference refuses to
 * run on a stream with no summary.
 */

import type { ImportDiagnosticV1, WorkbookFactStreamItemV2 } from "../facts/index.js";
import type { DiscardedRowV1, ProposedRowV1 } from "./regions.js";
import type { InferenceStatementV1 } from "./statements.js";
import type { ProposedEnumOptionV1, TypeViolationsV1 } from "./types.js";
import type { ProposedFieldTypeV1, SourceValueFormatV1 } from "./values.js";

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
