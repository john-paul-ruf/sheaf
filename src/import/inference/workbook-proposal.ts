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
 * - relationship `rel:<childColumnKey>`, rule `rule:<columnKey>`.
 */

import type {
  DateSystemV1,
  ImportDiagnosticV2,
  PreservedPartKindV1,
  PreservedReasonKeyV1,
  RangeV1,
  SheetKindV1,
  SheetVisibilityV1,
} from "../facts/index.js";
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
  /** The column's first master formula, preserved and not live (D33); the field stays authored. */
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
  readonly appName: string;
  /** Every sheet of the workbook in workbook order, selected or not (D39). */
  readonly sheets: readonly ProposedSheetV1[];
  readonly tables: readonly ProposedTableV2[];
  readonly recordRules: readonly ProposedRecordRuleV1[];
  readonly inertItems: readonly ProposedInertItemV1[];
  readonly statements: readonly WorkbookStatementV1[];
  readonly diagnostics: readonly ImportDiagnosticV2[];
  /** Always `true`: a proposal is built from a completed stream, never a sample. */
  readonly isRowCountExact: true;
}
