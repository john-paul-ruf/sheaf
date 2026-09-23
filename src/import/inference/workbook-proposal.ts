/**
 * The workbook proposal's shape (M21; CA-19, FR-4–FR-8). Declared on its own
 * so the inference and review-edit modules share it without importing each
 * other.
 *
 * A proposal is **not** an app: nothing here is a domain ID. Every sheet,
 * table, column, relationship and rule is named by a stable key derived from
 * position — sheet index, region or declared-table ordinal, sheet column —
 * never from a display name, so a rename moves no key.
 *
 * - sheet `s<sheetIndex>`;
 * - declared table `s<sheetIndex>.t<n>`, region table `s<sheetIndex>.r<n>`
 *   (the table key is also its region key, for `set-header-row`);
 * - column `<tableKey>.c<sheetColumn>`;
 * - relationship `rel:<childColumnKey>`, rule `rule:<columnKey>`;
 * - formula: a computed column's `<columnKey>`, a table metric's
 *   `<columnKey>.R<row>`, a dashboard value's `<sheetKey>.R<row>C<column>`
 *   (rows and columns one-based, as a person reads them).
 */

import {
  IMPORT_UNSUPPORTED_REASONS,
  type FormulaDeterminismV1,
  type FormulaDispositionV1,
} from "../../domain/formulas/index.js";
import type {
  DateSystemV1,
  ImportDiagnosticV2,
  PreservedPartKindV1,
  PreservedReasonKeyV1,
  RangeV1,
  SheetKindV1,
  SheetVisibilityV1,
} from "../facts/index.js";
import type { RelationshipDetectionSourceV1 } from "../../domain/model/schema.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import type { ProposedRowV1, WorkbookDiscardedRowV1 } from "./regions.js";
import type { WorkbookStatementV1 } from "./statements.js";
import type { ProposedEnumOptionV1, TypeViolationsV1 } from "./types.js";
import type {
  ProposedFieldTypeV1,
  ProposedWorkbookFieldTypeV1,
  WorkbookSourceValueFormatV1,
} from "./values.js";

/**
 * The roles a sheet plays, restated from `src/domain/model/snapshots.ts`
 * (`SHEET_CLASSIFICATIONS`, which M21 may not import — the pipeline sweep) and
 * pinned against it by test.
 */
export const SHEET_ROLES = Object.freeze(["table", "lookup", "summary", "chart", "snapshot"] as const);

export type SheetRoleV1 = (typeof SHEET_ROLES)[number];

/** A proposal adds `excluded`: a sheet the user did not select (D39). */
export type ProposedSheetClassificationV1 = SheetRoleV1 | "excluded";

export interface ProposedSheetV1 {
  readonly sheetKey: string;
  readonly sheetIndex: number;
  readonly name: string;
  readonly sheetKind: SheetKindV1;
  readonly visibility: SheetVisibilityV1;
  readonly isSelected: boolean;
  /** Canonical order; `["excluded"]` exactly when unselected. */
  readonly classification: readonly ProposedSheetClassificationV1[];
  /** The rest is `null` for an unselected sheet: nothing of it was read. */
  readonly declaredRange: RangeV1 | null;
  readonly dateSystem: DateSystemV1 | null;
  readonly rowCount: number | null;
  readonly usedCellCount: number | null;
  readonly formulaCellCount: number | null;
  /** Regions past the per-sheet limit, kept only in the snapshot. */
  readonly omittedRegionCount: number;
}

export type ProposedTableSourceV1 =
  | {
      readonly kind: "declared-table";
      readonly name: string;
      readonly range: RangeV1;
      readonly headerRowCount: number;
      readonly totalsRowCount: number;
    }
  | { readonly kind: "region" };

export interface ProposedWorkbookFieldV1 {
  readonly columnKey: string;
  /** The sheet column. */
  readonly columnIndex: number;
  readonly fieldName: string;
  readonly isNameGenerated: boolean;
  /** `reference` exactly while an applied relationship names this column. */
  readonly type: ProposedWorkbookFieldTypeV1;
  /** What the column's values and declarations make it, relationships aside. */
  readonly valueType: ProposedFieldTypeV1;
  /** How promotion reads this column's source text (`values.ts`). */
  readonly sourceFormat: WorkbookSourceValueFormatV1;
  readonly enumOptions: readonly ProposedEnumOptionV1[];
  /** `null`: not measured (a user override, or a structural edit since). */
  readonly violations: TypeViolationsV1 | null;
  /** The column's first master formula, as authored; what it becomes is its entry in `formulas`. */
  readonly formulaText: string | null;
}

export interface ProposedTableV2 {
  readonly tableKey: string;
  readonly sheetKey: string;
  readonly tableName: string;
  readonly source: ProposedTableSourceV1;
  readonly firstColumn: number;
  readonly lastColumn: number;
  /** Null when the table has no heading row and every name was generated. */
  readonly headerRowIndex: number | null;
  /** The first rows verbatim; `cells[k]` is column `firstColumn + k`. */
  readonly leadingRows: readonly ProposedRowV1[];
  readonly discardedRows: readonly WorkbookDiscardedRowV1[];
  readonly discardedRowCount: number;
  /** This table's own data rows. Exact. */
  readonly rowCount: number;
  /** Its last data row (totals and footer rows excluded); `null` when it has none. */
  readonly lastDataRowIndex: number | null;
  /**
   * The table whose rows these rows join (a spacer merge, FR-4). A joined
   * table is promoted as part of that one; its own fields stand ready for a
   * split. `null` for a table promoted on its own.
   */
  readonly joinedToTableKey: string | null;
  readonly fields: readonly ProposedWorkbookFieldV1[];
  readonly keyColumnKey: string | null;
  readonly labelColumnKey: string | null;
}

/** A table a relationship could point at instead, and what the proposal measured of it. */
export interface RelationshipCandidateV1 {
  readonly toTableKey: string;
  readonly toColumnKey: string;
  /** Why it is a candidate: the lookup itself, a heading match, containment, or both. */
  readonly basis: "lookup-formula" | "heading" | "containment" | "heading-and-containment";
  readonly brokenReferenceCount: number;
}

/**
 * A child column referring to a parent table's key (FR-7). While applied, the
 * child field's type is `reference`; rejected, it is its value type again.
 */
export interface ProposedRelationshipV1 {
  readonly relationshipKey: string;
  readonly fromTableKey: string;
  readonly fromColumnKey: string;
  readonly toTableKey: string;
  /** The parent's key column. */
  readonly toColumnKey: string;
  /** `user` once a review edit retargets it. */
  readonly detectionSource: Exclude<RelationshipDetectionSourceV1, "declared">;
  readonly isApplied: boolean;
  /**
   * Distinct child values with no parent key: at promotion each row holding
   * one keeps its original key as a broken reference (D36).
   */
  readonly brokenReferenceCount: number;
  /** True when the child column outgrew its sketch and was measured on a sample. */
  readonly isSampled: boolean;
  /** Every table the review may retarget it to, the current parent included. */
  readonly candidates: readonly RelationshipCandidateV1[];
}

/** A record rule M02's IR can state (field presence and equality only). */
export type ProposedRuleConditionV1 =
  | { readonly kind: "field-equals"; readonly columnKey: string; readonly value: CellValueV1 }
  | { readonly kind: "not"; readonly condition: ProposedRuleConditionV1 };

export interface ProposedRecordRuleV1 {
  readonly ruleKey: string;
  readonly tableKey: string;
  readonly columnKey: string;
  readonly condition: ProposedRuleConditionV1;
  readonly isActive: boolean;
}

/** Why an imported formula stays kept values (closed): M03's reasons, then the proposal's own. */
export const FORMULA_KEEP_REASONS = Object.freeze([
  ...IMPORT_UNSUPPORTED_REASONS,
  /** A column whose rows do not all hold the same formula (the fill-down proof failed). */
  "not-filled-down",
  /** The formula's text could not be read from the workbook. */
  "unreadable",
  "array-formula",
  /** A nondeterministic metric or dashboard value: no record exists to keep its frozen value. */
  "value-not-kept",
] as const);

export type FormulaKeepReasonV1 = (typeof FORMULA_KEEP_REASONS)[number];

/** Where an imported formula's result lives (migration 005's target kinds, by key). */
export type ProposedFormulaTargetV1 =
  | { readonly kind: "computed-column"; readonly tableKey: string; readonly columnKey: string }
  /** A totals-row or footer cell; `columnKey` is the column it sits under. */
  | { readonly kind: "table-metric"; readonly tableKey: string; readonly columnKey: string }
  | { readonly kind: "dashboard-value"; readonly sheetKey: string };

/**
 * One workbook formula and what it becomes (CA-25 at import, D51). The
 * outcome — disposition, determinism, reason — is derived from the text and
 * the proposal's structure (`formulas.ts`) and re-derived after every review
 * edit; `isActive` is the review's own choice.
 */
export interface ProposedFormulaV1 {
  readonly formulaKey: string;
  readonly target: ProposedFormulaTargetV1;
  /** A metric's or dashboard value's label; a computed column is its field. */
  readonly displayName: string | null;
  /** The formula as authored, without its `=`: a column's first row's. */
  readonly originalText: string;
  /** The cell that text belongs to; its relative references count from here. */
  readonly sheetKey: string;
  readonly rowIndex: number;
  readonly columnIndex: number;
  /** A user-understandable place: `Jobs!G2:G61`, `Overview!B3`. */
  readonly location: string;
  readonly anchor: RangeV1;
  readonly isArray: boolean;
  /** Cells holding this formula's shape: the fill-down proof for a column. */
  readonly shapeMatchCount: number;
  /** The first row of a column that breaks the shape; `null` when none does. */
  readonly shapeBreakRowIndex: number | null;
  readonly disposition: FormulaDispositionV1;
  readonly determinism: FormulaDeterminismV1;
  readonly reason: FormulaKeepReasonV1 | null;
  /** The function a reason names (`OFFSET`), if any. */
  readonly detail: string | null;
  /** The applied relationship a lookup goes through. */
  readonly relationshipKey: string | null;
  /** `false` once the review declines it: its values stay authored literals. */
  readonly isActive: boolean;
}

export interface ProposedInertItemV1 {
  readonly kind: PreservedPartKindV1;
  readonly sheetKey: string;
  /** A user-understandable place: `Overview!D2:K18`, or the sheet name. */
  readonly location: string;
  readonly reasonKey: PreservedReasonKeyV1;
  readonly anchor: RangeV1 | null;
}

export interface ProposedWorkbookV1 {
  readonly fileName: string;
  /**
   * True for a delimited file: one sheet, one table, F02's statements and F02's
   * fingerprint inputs (so F02 decisions keep matching).
   */
  readonly isDelimited: boolean;
  readonly appName: string;
  /** Every sheet of the workbook in workbook order, selected or not (D39). */
  readonly sheets: readonly ProposedSheetV1[];
  readonly tables: readonly ProposedTableV2[];
  readonly relationships: readonly ProposedRelationshipV1[];
  readonly recordRules: readonly ProposedRecordRuleV1[];
  /** Every formula a table column, totals row or summary sheet holds (F04). */
  readonly formulas: readonly ProposedFormulaV1[];
  readonly inertItems: readonly ProposedInertItemV1[];
  /** Inert items per kind, over every selected sheet (FR-9). */
  readonly inertCounts: Readonly<Record<PreservedPartKindV1, number>>;
  readonly statements: readonly WorkbookStatementV1[];
  readonly diagnostics: readonly ImportDiagnosticV2[];
  /** Always `true`: a proposal is built from a completed stream, never a sample. */
  readonly isRowCountExact: true;
}
