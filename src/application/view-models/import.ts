/**
 * The import surfaces (M37; SCR-016–023, MOD-004–008; CAP-09–CAP-13).
 *
 * Sources: `mocks/upload.html` (SCR-016), `mocks/delimited-import.html`
 * (SCR-017), `mocks/import.html` (SCR-018), `mocks/import-large.html`
 * (SCR-019), `mocks/import-progress.html` (SCR-020),
 * `mocks/import-refused.html` (SCR-021), `mocks/import-failed.html`
 * (SCR-022), `mocks/review.html` (SCR-023).
 *
 * **Numbers are not formatted here and times are not rendered here.** A view
 * model holds no clock and no locale; every count crosses as a number beside a
 * token that says what kind of number it is, and the surface writes the
 * sentence. The one composed string per variant is its `announcement` — an
 * `aria-live` line, not visible copy (the F01 precedent).
 *
 * **An estimate never loses its flag (D24).** Pre-flight's counts arrive with
 * `isEstimate` fixed at the literal `true` and leave here as
 * {@link ImportRowCountVm} `"estimated"`; the proposal's arrive with
 * `isRowCountExact` fixed at `true` and leave as `"exact"`. Neither direction
 * can be written the other way round, because neither literal can be widened.
 *
 * **Empty is stated, never implied.** A delimited file carries values and
 * nothing else, so review.html's connections, calculations and sheets sections
 * are not "0 found" — they are "there was nothing of this kind to look for"
 * (STA-025). The two are different claims and {@link ReviewEmptinessV1} keeps
 * them different.
 */

import type { SnapshotFrom } from "xstate";
import type { ImportFailureDetailV1 } from "../../workers/protocol/import-messages.js";
import type {
  FieldTypeWireV1,
  ImportDiagnosticWireV2,
  PreservedPartKindWireV1,
  PreservedReasonKeyWireV1,
  ProposedFieldTypeWireV1,
  ProposedTableWireV2,
  ProposedWorkbookWireV1,
  WorkbookEvidenceWireV1,
  WorkbookInferenceSubjectWireV1,
  WorkbookReviewEditKindWireV1,
  WorkbookSourceValueFormatWireV1,
  WorkbookStatementWireV1,
} from "../../workers/protocol/messages.js";
import {
  APPEND_EVENT_CAP,
  appendEventEstimate,
  canAppendEstimate,
  selectionCellEstimate,
  type ImportFailureReasonV1,
  type ImportPhaseV1,
  type ImportSheetProgressV1,
  type ImportWorkbookFactsV1,
  type importMachine,
} from "../workflows/import.machine.js";
import { selectAppChoices, type AppChoiceVm } from "./library.js";
import { toIssueVm, type RecordIssueTokenV1 } from "./records.js";

type ImportSnapshot = SnapshotFrom<typeof importMachine>;

// --- shared vocabulary -------------------------------------------------------

/**
 * Which kind of count this is. `estimated` must reach the user as "about …"
 * (D24); `exact` is only ever produced from a completed stream's summary.
 */
export interface ImportRowCountVm {
  readonly kind: "estimated" | "exact";
  readonly value: number;
}

/**
 * S02's closed workbook rejection list (F02's nine, then the workbook edits'
 * own), restated as a literal union because a view model may not import the
 * inference module and the wire widened `reason` to `string`.
 * `tests/unit/view-models/import.test.ts` pins the two together, so a
 * divergence is a compile error there rather than a wrong sentence here.
 */
export const REVIEW_EDIT_REJECTION_TOKENS = Object.freeze([
  "unknown-column",
  "row-outside-leading-rows",
  "empty-name",
  "name-not-nfc",
  "duplicate-name",
  "not-an-enum-field",
  "no-enum-options",
  "duplicate-enum-option",
  "too-many-enum-options",
  "unknown-table",
  "unknown-relationship",
  "unknown-statement",
  "statement-not-rejectable",
  "field-is-reference",
  "retarget-not-evidenced",
  "parent-key-changed",
  "key-used-by-relationship",
  "regions-not-joinable",
] as const);

export type ReviewEditRejectionTokenV1 =
  (typeof REVIEW_EDIT_REJECTION_TOKENS)[number];

/** A reason outside the closed list is named as unrecognised, never guessed. */
export type ReviewEditRejectionVm =
  | ReviewEditRejectionTokenV1
  | "unrecognised-rejection";

export function toReviewEditRejectionVm(reason: string): ReviewEditRejectionVm {
  return (REVIEW_EDIT_REJECTION_TOKENS as readonly string[]).includes(reason)
    ? (reason as ReviewEditRejectionTokenV1)
    : "unrecognised-rejection";
}

/**
 * M23's closed promotion rejections, restated like the edit rejections above
 * and pinned against `PROMOTION_REJECTIONS` by `tests/unit/view-models/import.test.ts`.
 * `append-too-large` is D38's: an append whose one commit would not fit one
 * event segment. The words are the surface's (S07, D43); this is the token.
 */
export const PROMOTION_REJECTION_TOKENS = Object.freeze([
  "schema-invalid",
  "record-invalid",
  "no-proposal",
  "empty-table",
  "append-too-large",
] as const);

export type PromotionRejectionTokenV1 = (typeof PROMOTION_REJECTION_TOKENS)[number];

/** A reason outside the closed list is named as unrecognised, never guessed. */
export type PromotionRejectionVm = PromotionRejectionTokenV1 | "unrecognised-rejection";

export function toPromotionRejectionVm(reason: string): PromotionRejectionVm {
  return (PROMOTION_REJECTION_TOKENS as readonly string[]).includes(reason)
    ? (reason as PromotionRejectionTokenV1)
    : "unrecognised-rejection";
}

// --- SCR-016 upload landing (upload.html) -----------------------------------

/** upload.html's two format groups, in its order. Both are read (D19 retired). */
export interface AcceptedFormatGroupVm {
  readonly id: "value-only" | "spreadsheet-structure";
  /** upload.html, verbatim. */
  readonly label: string;
  readonly extensions: readonly string[];
}

export interface UploadLandingVm {
  readonly screen: "SCR-016";
  readonly step: "choosingFile" | "detecting";
  readonly formats: readonly AcceptedFormatGroupVm[];
  /** True while the parser is sniffing and sizing; nothing is cancellable yet. */
  readonly busy: boolean;
  readonly phase: ImportPhaseV1 | null;
  readonly announcement: string;
}

const FORMAT_GROUPS: readonly AcceptedFormatGroupVm[] = Object.freeze([
  Object.freeze({
    id: "spreadsheet-structure" as const,
    // upload.html, verbatim.
    label: "Spreadsheet structure",
    extensions: Object.freeze(["xlsx", "xlsb", "xls", "ods"]),
  }),
  Object.freeze({
    id: "value-only" as const,
    // upload.html, verbatim.
    label: "Value-only",
    extensions: Object.freeze(["csv", "tsv"]),
  }),
]);

// --- SCR-017 delimited target (delimited-import.html) ------------------------

/**
 * Why "Add a table to an existing app" is off (D38). Each is a fact the page
 * holds: the apps are still being listed, could not be listed, there are none,
 * or pre-flight's estimate already exceeds what one commit can hold.
 */
export type ExistingAppUnavailableReasonV1 =
  | "listing-local-apps"
  | "local-apps-not-listed"
  | "no-local-apps"
  | "too-large-to-append";

export interface ImportDestinationOptionVm {
  readonly id: "new-app" | "existing-app";
  /** delimited-import.html, verbatim. */
  readonly label: string;
  readonly enabled: boolean;
  readonly isSelected: boolean;
  /** Present exactly when the option is off, and it says why. */
  readonly reason?: ExistingAppUnavailableReasonV1;
}

/** D38's pre-flight arithmetic, kept so the too-large reason states real numbers. */
export interface AppendEstimateVm {
  /** Estimated events the append would write — always an estimate (D24). */
  readonly estimatedEvents: number;
  readonly estimatedRows: ImportRowCountVm;
  /** One segment's event cap: an append is one commit, never split. */
  readonly eventCap: number;
}

/** MOD-004: the extension claimed one thing and the bytes said another. */
export interface FormatContradictionVm {
  readonly declaredExtension: string;
  readonly expectedKind: string;
  readonly detectedKind: string;
}

export type NameProblemVm = "required";

export interface DelimitedTargetVm {
  readonly screen: "SCR-017";
  readonly step: "delimitedTarget";
  readonly fileName: string;
  readonly delimiter: string;
  readonly encoding: string;
  readonly columnCount: number;
  /** Always `estimated` here: pre-flight read a bounded sample (D24). */
  readonly rowCount: ImportRowCountVm;
  readonly contradiction: FormatContradictionVm | null;
  readonly destinations: readonly ImportDestinationOptionVm[];
  readonly destination: "new-app" | "existing-app";
  /** The apps an append could land in; empty unless that option is on. */
  readonly appChoices: readonly AppChoiceVm[];
  readonly appendEstimate: AppendEstimateVm;
  /** A new app needs its name; an append names only its table. */
  readonly needsAppName: boolean;
  readonly appName: string;
  readonly tableName: string;
  readonly appNameProblem: NameProblemVm | null;
  readonly tableNameProblem: NameProblemVm | null;
  readonly canContinue: boolean;
  readonly announcement: string;
}

/** delimited-import.html, verbatim. */
const NEW_APP_LABEL = "Create a new app";
const EXISTING_APP_LABEL = "Add a table to an existing app";

// --- SCR-018 / SCR-019 the size answer (D20) --------------------------------

/**
 * import.html's fits variant, composed for delimited input: there is one
 * table, so the mock's sheet list has nothing to list and the type has no
 * field for it. What remains is the measurement and the confirmation.
 */
export interface ImportFitsVm {
  readonly screen: "SCR-018";
  readonly step: "fits";
  readonly fileName: string;
  readonly sourceByteLength: number;
  readonly columnCount: number;
  readonly rowCount: ImportRowCountVm;
  readonly fits: true;
  readonly announcement: string;
}

/**
 * import-large.html's delimited variant (D20). Deliberately absent: the sheet
 * list (one table cannot be sub-selected) and the capacity-detail link (the
 * five budgets are F07). Both are fields a future writer cannot fill because
 * neither exists on this type.
 */
export interface ImportOverBudgetVm {
  readonly screen: "SCR-019";
  readonly step: "overBudget";
  readonly fileName: string;
  readonly exceeded: "source-bytes" | "estimated-cells";
  readonly sourceByteLength: number;
  readonly maxSourceByteLength: number;
  readonly estimatedCellCount: number;
  readonly maxEstimatedCellCount: number;
  readonly remedy: "use-larger-device";
  /** Nothing was parsed and nothing was staged (FR-2). */
  readonly libraryUnchanged: true;
  readonly announcement: string;
}

/**
 * A workbook's size, sheet by sheet, from metadata (CA-18). An estimate has
 * exactly one numeric member and it is `estimated`, so it can only be written
 * as "about" (D24); a count nothing declared is `not-declared`, which carries
 * no number at all and so cannot be rendered as 0 (database.md).
 */
export type SheetEstimateVm =
  | { readonly kind: "estimated"; readonly value: number }
  | { readonly kind: "not-declared" };

/**
 * What the report's own facts say a sheet holds — the checklist line
 * import.html draws. Decided from declarations, never from cells: declared
 * tables, chart parts or a chart sheet, or neither.
 */
export type WorkbookSheetShapeV1 = "declared-table" | "table-region" | "charts-and-summary";

/** import.html's badges, and only those: Use, Inspect, Dashboard, Excluded. */
export type WorkbookSheetBadgeV1 = "use" | "inspect" | "dashboard" | "excluded";

export interface WorkbookSheetRowVm {
  readonly sheetIndex: number;
  readonly name: string;
  readonly isSelected: boolean;
  readonly isHidden: boolean;
  readonly shape: WorkbookSheetShapeV1;
  readonly rows: SheetEstimateVm;
  readonly cells: SheetEstimateVm;
  readonly badge: WorkbookSheetBadgeV1;
}

/** Why a selection cannot start: nothing chosen, or more than the budget. */
export type WorkbookSelectionBlockerV1 = "nothing-selected" | "over-budget";

export interface WorkbookSelectionVm {
  readonly selectedCount: number;
  readonly sheetCount: number;
  readonly estimatedRows: SheetEstimateVm;
  /** Summed from the report's per-sheet estimates, as pre-flight routed them. */
  readonly estimatedCells: number;
  readonly maxEstimatedCells: number;
  readonly blocker: WorkbookSelectionBlockerV1 | null;
}

/** import.html's drawing notice, from the report's part counts per selected sheet. */
export interface DrawingNoticeVm {
  readonly sheetName: string;
  readonly drawingCount: number;
}

/** MOD-004 for a workbook: the name promised one format and the content is another. */
export interface WorkbookContradictionVm {
  readonly declaredExtension: string;
  readonly detectedFormat: WorkbookFormatVm;
}

export type WorkbookFormatVm = ImportWorkbookFactsV1["report"]["format"];

/**
 * SCR-019's desktop handoff (D31). `instructions` is what "Copy handoff
 * instructions" copies: import-large.html's own sentences with the real file
 * name (D43). `copy` is what the platform answered, once it has.
 */
export interface WorkbookHandoffVm {
  readonly instructions: string;
  readonly copy: "copied" | "unavailable" | null;
}

export interface WorkbookPreflightVm {
  readonly screen: "SCR-018" | "SCR-019";
  readonly step: "workbookFits" | "workbookSubset" | "workbookHandoff";
  readonly fileName: string;
  readonly format: WorkbookFormatVm;
  readonly sourceByteLength: number;
  /** The name's extension, lowercased; `null` when the name has none. */
  readonly declaredExtension: string | null;
  readonly contradiction: WorkbookContradictionVm | null;
  /** Every inventoried sheet, in workbook order — none is dropped (FR-5). */
  readonly sheets: readonly WorkbookSheetRowVm[];
  readonly selection: WorkbookSelectionVm;
  /** The whole workbook's estimate, for SCR-019's over-budget statement. */
  readonly workbookEstimatedCells: SheetEstimateVm;
  readonly drawingNotices: readonly DrawingNoticeVm[];
  readonly canStart: boolean;
  /** Present on SCR-019 only. */
  readonly handoff: WorkbookHandoffVm | null;
  readonly announcement: string;
}

// --- SCR-020 progress (import-progress.html) --------------------------------

export interface ImportProgressVm {
  readonly screen: "SCR-020";
  readonly step: "beginningStage" | "parsing" | "inferring";
  readonly fileName: string;
  readonly phase: ImportPhaseV1;
  readonly rowsSoFar: number;
  /** "Sheet k of n · name" while a workbook streams; `null` for delimited input. */
  readonly sheet: ImportSheetProgressV1 | null;
  /** Batches whose ack came back — the durable count, not the sent one. */
  readonly batchesCommitted: number;
  readonly cancellable: boolean;
  /** MOD-007, import-progress.html: what cancelling promises. */
  readonly cancellationContract: "removes-every-committed-batch";
  readonly announcement: string;
}

// --- SCR-021 refusal (import-refused.html) ----------------------------------

/**
 * The refusals SCR-021 renders. `workbook-format-later-release` stays declared
 * on the wire with no producer (D42) but has no card: this page accepts
 * workbooks, and the machine ends a run that receives one anyway.
 */
export type RefusalCopyTokenV1 =
  | "macro-content"
  | "numbers-file"
  | "pages-file"
  | "pdf-file"
  | "binary-unreadable";

export type UnreadableDetailVm = Extract<
  NonNullable<ImportSnapshot["context"]["refusal"]>,
  { readonly kind: "binary-unreadable" }
>["detail"];

export interface ImportRefusedVm {
  readonly screen: "SCR-021";
  readonly step: "refused";
  readonly fileName: string;
  readonly refusal: RefusalCopyTokenV1;
  /** S03's remedy id; the pairing with the kind is held by the wire type. */
  readonly remedy: string;
  /**
   * Only for `binary-unreadable`: which class of problem made the file
   * unreadable or unsafe (D42) — a closed token, never file content.
   */
  readonly unreadableDetail: UnreadableDetailVm | null;
  /** The refusal is whole-file; no stage was ever created (FR-2). */
  readonly libraryUnchanged: true;
  readonly announcement: string;
}

// --- SCR-022 ended (import-failed.html) -------------------------------------

/**
 * What can be said about what was left behind.
 *
 * `removed` carries the receipt, which is the only evidence that lets a
 * surface say "no partial app remains" (MOD-007). `nothing-to-remove` is the
 * refusal case: no stage was ever created. `unconfirmed` is the one state that
 * must not claim either — cleanup was asked for and did not answer.
 */
export type ImportCleanupVm =
  | {
      readonly kind: "removed";
      readonly deletedCount: number;
      readonly completed: true;
      readonly reason: string;
    }
  | { readonly kind: "nothing-to-remove" }
  | { readonly kind: "unconfirmed" };

/**
 * Where a streamed parse stopped (CA-24). The diagnostic stays the raw closed
 * token — import-failed.html shows it beside the sentence — and the sheet is
 * named from the selection pre-flight showed, never from the failure.
 */
export interface ImportFailureDetailVm {
  readonly stage: ImportFailureDetailV1["stage"];
  readonly diagnostic: ImportFailureDetailV1["diagnostic"];
  readonly sheet: ImportSheetProgressV1 | null;
}

export interface ImportEndedVm {
  readonly screen: "SCR-022";
  readonly step: "cancelling" | "cancelled" | "failing" | "failed";
  readonly outcome: "cancelled" | "failed";
  readonly busy: boolean;
  readonly fileName: string;
  /** `null` for a cancel: the user's decision is not a failure. */
  readonly reason: ImportFailureReasonV1 | null;
  /** MOD-008's named stage, sheet and diagnostic, when the parser gave them. */
  readonly detail: ImportFailureDetailVm | null;
  readonly cleanup: ImportCleanupVm;
  readonly announcement: string;
}

// --- SCR-023 review (review.html) -------------------------------------------

export type ReviewSectionIdV1 =
  | "tables-and-rows"
  | "fields-and-choices"
  | "connections"
  | "live-calculations"
  | "sheets-and-snapshots";

/**
 * Why a section has no items. `not-applicable-value-only` is the delimited
 * fact, stated by delimited-import.html itself: "CSV and TSV carry values, not
 * workbook structure … No formula, validation, chart, or relationship
 * structure is claimed." It is not a search that found nothing, and a surface
 * must not render it as one (STA-025).
 */
export type ReviewEmptinessV1 = "not-applicable-value-only" | "none-found";

/** CA-19: projected, never reshaped. Every statement keeps its evidence. */
export interface ReviewStatementVm {
  readonly statementId: string;
  readonly subject: WorkbookInferenceSubjectWireV1;
  /** The edit that changes it; `null` when nothing here is editable. */
  readonly editKind: WorkbookReviewEditKindWireV1 | null;
  readonly targetKey: string | null;
  readonly columnIndex: number | null;
  readonly evidence: readonly WorkbookEvidenceWireV1[];
  readonly disposition: "accepted" | "rejected" | "edited";
}

export interface ReviewViolationsVm {
  readonly count: number;
  readonly examples: readonly {
    readonly rowIndex: number;
    readonly sourceText: string;
  }[];
}

export interface ReviewFieldVm {
  readonly tableKey: string;
  readonly columnKey: string;
  readonly columnIndex: number;
  readonly fieldName: string;
  readonly isNameGenerated: boolean;
  /** What the field will be: a reference for a connection's child column. */
  readonly type: FieldTypeWireV1;
  /** What its values look like, which is what "change type" edits. */
  readonly valueType: ProposedFieldTypeWireV1;
  readonly sourceFormat: WorkbookSourceValueFormatWireV1;
  readonly enumOptions: readonly {
    readonly label: string;
    readonly occurrences: number;
  }[];
  /**
   * `measured` carries the count; `not-measured-yet` is what a `set-header-row`
   * edit leaves behind. It is never "none": nulling a measurement is not the
   * same finding as measuring zero (S03).
   */
  readonly violations:
    | { readonly kind: "measured"; readonly value: ReviewViolationsVm }
    | { readonly kind: "not-measured-yet" };
  /** The workbook formula this column came from, preserved (D33); `null` for none. */
  readonly formulaText: string | null;
  readonly statements: readonly ReviewStatementVm[];
}

/** A region folded into the table above it (a spacer merge, S02). */
export interface ReviewJoinedRegionVm {
  readonly tableKey: string;
  readonly tableName: string;
  readonly headerRowIndex: number | null;
  readonly rowCount: ImportRowCountVm;
  readonly statements: readonly ReviewStatementVm[];
}

export interface ReviewTableVm {
  readonly tableKey: string;
  readonly tableName: string;
  readonly sheetName: string;
  /** The workbook's own declared table, by its declared name, or a region. */
  readonly declaredTableName: string | null;
  /** `null` when no row looked like a header; the rows below start the table. */
  readonly headerRowIndex: number | null;
  /** Exact: the records it will become, joined regions included. */
  readonly rowCount: ImportRowCountVm;
  readonly discardedRowCount: number;
  readonly discardedRows: readonly {
    readonly rowIndex: number;
    readonly reason: "above-header" | "empty-row" | "totals-row";
    readonly cells: readonly string[];
  }[];
  readonly leadingRows: readonly {
    readonly rowIndex: number;
    readonly cells: readonly string[];
  }[];
  readonly joined: readonly ReviewJoinedRegionVm[];
  readonly keyFieldName: string | null;
  readonly labelFieldName: string | null;
  readonly statements: readonly ReviewStatementVm[];
  readonly fields: readonly ReviewFieldVm[];
}

/** One connection, named by its tables and fields, applied or rejected (CA-19). */
export interface ReviewConnectionVm {
  readonly relationshipKey: string;
  readonly fromTableName: string;
  readonly fromFieldName: string;
  readonly toTableKey: string;
  readonly toTableName: string;
  readonly toFieldName: string;
  /** The parent's label field, which the child shows instead of the raw key. */
  readonly toLabelFieldName: string | null;
  readonly detectionSource: "lookup-formula" | "key-match" | "user";
  /** `false` is the user's stored rejection: shown as a choice, never hidden. */
  readonly isApplied: boolean;
  /** Distinct child keys that matched no parent row: kept and flagged (D36). */
  readonly brokenReferenceCount: number;
  /** Evidenced alternatives a retarget may choose (S02 candidates). */
  readonly retargets: readonly { readonly toTableKey: string; readonly toTableName: string }[];
  readonly statement: ReviewStatementVm | null;
}

/** A column that came from a formula: results kept as values, formula preserved (D33). */
export interface ReviewCalculationVm {
  readonly tableName: string;
  readonly fieldName: string;
  readonly formulaText: string;
}

export interface ReviewInertItemVm {
  readonly kind: PreservedPartKindWireV1;
  readonly location: string;
  readonly reasonKey: PreservedReasonKeyWireV1;
}

export type ReviewSheetClassificationV1 = Exclude<
  ProposedWorkbookWireV1["sheets"][number]["classification"][number],
  "excluded"
>;

export interface ReviewSheetVm {
  readonly sheetKey: string;
  readonly name: string;
  /** Unselected sheets are listed as excluded by the user's choice (D39). */
  readonly isSelected: boolean;
  readonly classification: readonly ReviewSheetClassificationV1[];
  readonly statements: readonly ReviewStatementVm[];
  readonly inertItems: readonly ReviewInertItemVm[];
}

export interface ReviewSectionVm {
  readonly id: ReviewSectionIdV1;
  /** review.html, verbatim. */
  readonly label: string;
  readonly count: number;
  /** Present exactly when `count` is 0, and it says which kind of zero. */
  readonly emptiness: ReviewEmptinessV1 | null;
}

/**
 * Why "Create app" is off. `no-fields-found` is the empty-`.csv` case: a
 * proposal with no columns would build an app with nothing in it, so the
 * affordance is disabled with the fact stated rather than offering a create
 * whose result is not an app anyone asked for.
 */
export type PromotionBlockerV1 = "no-fields-found";

export interface ImportPromotionConfirmVm {
  /** A new app, or a new table added to an app on this device (D38). */
  readonly kind: "create-app" | "add-table";
  /** The new app's name, or the name of the app the table is added to. */
  readonly appName: string;
  /** The table an append adds; `null` for a new app. */
  readonly tableName: string | null;
  readonly canCreate: boolean;
  readonly blocker: PromotionBlockerV1 | null;
  readonly busy: boolean;
  /** review.html, verbatim. */
  readonly assurance: string;
}

/**
 * A refused promotion's issues, one group per field (F02 S07 obligation).
 * The field is the promotion's own id: the stage minted it and wrote nothing,
 * so no name reaches the page for it (reported as a seam) — the group
 * says how many values in one field broke which rule.
 */
export interface PromotionIssueGroupVm {
  readonly fieldId: string | null;
  readonly token: RecordIssueTokenV1;
  readonly sentence: string;
  readonly severity: "warning" | "blocking";
  readonly count: number;
}

export interface ImportReviewVm {
  readonly screen: "SCR-023";
  readonly step: "inferring" | "reviewing" | "applyingEdit" | "promoting";
  readonly fileName: string;
  readonly appName: string;
  readonly isDelimited: boolean;
  /** An Excel workbook (xlsx, xlsb, xls), whose validations are Excel's own. */
  readonly isExcelWorkbook: boolean;
  readonly appStatements: readonly ReviewStatementVm[];
  readonly tables: readonly ReviewTableVm[];
  readonly connections: readonly ReviewConnectionVm[];
  readonly calculations: readonly ReviewCalculationVm[];
  /** Every preserved formula region, in a table column or not (D33). */
  readonly formulaRegionCount: number;
  readonly sheets: readonly ReviewSheetVm[];
  readonly sections: readonly ReviewSectionVm[];
  readonly diagnostics: readonly ImportDiagnosticWireV2[];
  /**
   * Measured violations plus broken references — never invented, and
   * never a count of what was not measured (CA-16).
   */
  readonly needsAttentionCount: number;
  /** False when any field's violations were nulled by a header-row edit. */
  readonly isNeedsAttentionExact: boolean;
  readonly brokenReferenceCount: number;
  readonly editRejection: ReviewEditRejectionVm | null;
  /** Why the last promotion refused, as a closed token; `null` when none did. */
  readonly promotionRejection: PromotionRejectionVm | null;
  readonly promotionIssues: readonly PromotionIssueGroupVm[];
  readonly confirm: ImportPromotionConfirmVm;
  readonly announcement: string;
}

// --- the app exists ----------------------------------------------------------

export interface ImportDoneVm {
  readonly screen: "SCR-023";
  readonly step: "done";
  readonly appId: string;
  readonly rowCount: ImportRowCountVm;
  readonly tableCount: number;
  /** Rows kept and flagged rather than refused (FR-4/FR-6). */
  readonly flaggedRecordCount: number;
  /** A new app lands on its home; an append on the table it created. */
  readonly landing: ImportLandingVm;
  readonly announcement: string;
}

export type ImportLandingVm =
  | { readonly kind: "app-home"; readonly appId: string }
  | { readonly kind: "appended-table"; readonly appId: string; readonly tableId: string };

export type ImportVm =
  | UploadLandingVm
  | DelimitedTargetVm
  | ImportFitsVm
  | WorkbookPreflightVm
  | ImportOverBudgetVm
  | ImportProgressVm
  | ImportRefusedVm
  | ImportEndedVm
  | ImportReviewVm
  | ImportDoneVm;

// --- selectors ---------------------------------------------------------------

const estimated = (value: number): ImportRowCountVm => ({
  kind: "estimated",
  value,
});

const exact = (value: number): ImportRowCountVm => ({ kind: "exact", value });

/** review.html, verbatim, in the mock's order. */
const SECTION_LABELS: Readonly<Record<ReviewSectionIdV1, string>> =
  Object.freeze({
    "tables-and-rows": "Tables & rows",
    "fields-and-choices": "Fields & choices",
    connections: "Connections",
    "live-calculations": "Live calculations",
    "sheets-and-snapshots": "Sheets & snapshots",
  });

export function selectImportVm(snapshot: ImportSnapshot): ImportVm {
  const { context } = snapshot;

  if (snapshot.matches("choosingFile") || snapshot.matches("detecting")) {
    const detecting = snapshot.matches("detecting");
    return {
      screen: "SCR-016",
      step: detecting ? "detecting" : "choosingFile",
      formats: FORMAT_GROUPS,
      busy: detecting,
      phase: detecting ? context.progress.phase : null,
      announcement: detecting
        ? `Reading ${context.fileName} on this device.`
        : // upload.html: "Sheaf reads it on this device."
          "Choose the workbook you already use. Sheaf reads it on this device.",
    };
  }

  if (snapshot.matches("delimitedTarget")) {
    return selectDelimitedTargetVm(snapshot);
  }

  if (snapshot.matches("fits")) {
    const report = context.detection?.report;
    return {
      screen: "SCR-018",
      step: "fits",
      fileName: context.fileName,
      sourceByteLength: report?.sourceByteLength ?? 0,
      columnCount: report?.columnCount ?? 0,
      rowCount: estimated(report?.estimatedRowCount ?? 0),
      fits: true,
      announcement: `This file fits this device. About ${String(
        report?.estimatedRowCount ?? 0,
      )} rows will be imported.`,
    };
  }

  if (snapshot.matches("workbookSizing")) {
    return selectWorkbookPreflightVm(snapshot);
  }

  if (snapshot.matches("overBudget")) {
    return selectOverBudgetVm(snapshot);
  }

  if (snapshot.matches("refused")) {
    return selectRefusedVm(snapshot);
  }

  if (
    snapshot.matches("beginningStage") ||
    snapshot.matches("parsing") ||
    snapshot.matches("inferring")
  ) {
    return selectProgressVm(snapshot);
  }

  if (
    snapshot.matches("cancelling") ||
    snapshot.matches("cancelled") ||
    snapshot.matches("failing") ||
    snapshot.matches("failed")
  ) {
    return selectEndedVm(snapshot);
  }

  if (snapshot.matches("done")) {
    const promoted = context.promoted;
    const appId = promoted?.appId ?? "";
    const appendedTableId = promoted?.appendedTableId ?? null;
    return {
      screen: "SCR-023",
      step: "done",
      appId,
      rowCount: exact(promoted?.rowCount ?? 0),
      tableCount: promoted?.tableCount ?? 0,
      flaggedRecordCount: promoted?.flaggedRecordCount ?? 0,
      landing:
        appendedTableId === null
          ? { kind: "app-home", appId }
          : { kind: "appended-table", appId, tableId: appendedTableId },
      announcement:
        promoted === undefined
          ? "The app was created on this device."
          : `${context.appName} was created on this device with ${String(
              promoted.rowCount,
            )} rows.`,
    };
  }

  return selectReviewVm(snapshot);
}

function existingAppReason(
  snapshot: ImportSnapshot,
): ExistingAppUnavailableReasonV1 | null {
  const { context } = snapshot;
  if (context.detection !== undefined && !canAppendEstimate(context.detection)) {
    return "too-large-to-append";
  }
  switch (context.library.kind) {
    case "listing":
      return "listing-local-apps";
    case "unlisted":
      return "local-apps-not-listed";
    case "listed":
      return context.library.apps.length === 0 ? "no-local-apps" : null;
  }
}

function selectDelimitedTargetVm(snapshot: ImportSnapshot): DelimitedTargetVm {
  const { context } = snapshot;
  const detection = context.detection;
  const report = detection?.report;
  const contradiction = detection?.contradiction ?? null;
  const reason = existingAppReason(snapshot);
  const destination = context.destination;
  const apps = context.library.kind === "listed" ? context.library.apps : [];

  return {
    screen: "SCR-017",
    step: "delimitedTarget",
    fileName: context.fileName,
    delimiter: report?.delimiter ?? "",
    encoding: report?.encoding ?? "",
    columnCount: report?.columnCount ?? 0,
    rowCount: estimated(report?.estimatedRowCount ?? 0),
    contradiction:
      contradiction === null
        ? null
        : {
            declaredExtension: contradiction.declaredExtension,
            expectedKind: contradiction.expectedKind,
            detectedKind: contradiction.detectedKind,
          },
    destinations: [
      {
        id: "new-app",
        label: NEW_APP_LABEL,
        enabled: true,
        isSelected: destination.kind === "new-app",
      },
      {
        id: "existing-app",
        label: EXISTING_APP_LABEL,
        enabled: reason === null,
        isSelected: destination.kind === "existing-app",
        ...(reason === null ? {} : { reason }),
      },
    ],
    destination: destination.kind,
    appChoices:
      reason === null
        ? selectAppChoices(apps, destination.kind === "existing-app" ? destination.appId : null)
        : [],
    appendEstimate: {
      estimatedEvents: detection === undefined ? 0 : appendEventEstimate(detection),
      estimatedRows: estimated(report?.estimatedRowCount ?? 0),
      eventCap: APPEND_EVENT_CAP,
    },
    needsAppName: destination.kind === "new-app",
    appName: context.appName,
    tableName: context.tableName,
    appNameProblem:
      destination.kind === "new-app" && context.appName.trim().length === 0 ? "required" : null,
    tableNameProblem: context.tableName.trim().length === 0 ? "required" : null,
    canContinue: snapshot.can({ type: "CONTINUE" }),
    // The mock's "Rows declared: N + header" defers to review, where the
    // header row is a finding rather than an assumption (S03 followUp 7).
    announcement: `About ${String(
      report?.estimatedRowCount ?? 0,
    )} rows across ${String(report?.columnCount ?? 0)} columns were detected.`,
  };
}

const estimateOf = (value: number | null): SheetEstimateVm =>
  value === null ? { kind: "not-declared" } : { kind: "estimated", value };

/** A sum of estimates is `not-declared` only when none of them declared anything. */
const sumOfEstimates = (values: readonly (number | null)[]): SheetEstimateVm =>
  values.every((value) => value === null)
    ? { kind: "not-declared" }
    : { kind: "estimated", value: values.reduce<number>((sum, value) => sum + (value ?? 0), 0) };

type InventoriedSheetV1 = ImportWorkbookFactsV1["report"]["sheets"][number];

/** import.html's checklist line, decided from the sheet's declarations alone. */
function shapeOf(sheet: InventoriedSheetV1): WorkbookSheetShapeV1 {
  if (
    sheet.kind === "chartsheet" ||
    sheet.preservedPartCounts.chart > 0 ||
    sheet.preservedPartCounts["pivot-table"] > 0
  ) {
    return "charts-and-summary";
  }
  return sheet.declaredTables.length > 0 ? "declared-table" : "table-region";
}

const BADGE_OF_SHAPE: Readonly<Record<WorkbookSheetShapeV1, WorkbookSheetBadgeV1>> = Object.freeze({
  "declared-table": "use",
  "table-region": "inspect",
  "charts-and-summary": "dashboard",
});

/**
 * import-large.html's handoff card, as the text "Copy handoff instructions"
 * copies (D43): the card's own sentences, in its order, around the real file
 * name. D31's truthfulness limit is kept — the budget is conditional, and
 * import.html's "Desktop solves importing only" says what the handoff is not.
 */
export function handoffInstructions(fileName: string): string {
  return [
    `Import everything on desktop: “${fileName}”.`,
    "No work is transferred automatically. Open this same source file in Sheaf on a device with a larger local budget.",
    "Desktop solves importing only.",
  ].join("\n");
}

const WORKBOOK_STEP = Object.freeze({
  fits: "workbookFits",
  subset: "workbookSubset",
  handoff: "workbookHandoff",
} as const);

function selectWorkbookPreflightVm(snapshot: ImportSnapshot): WorkbookPreflightVm {
  const { context } = snapshot;
  // `workbookSizing` is entered only with the workbook's facts assigned.
  const facts = context.workbook as ImportWorkbookFactsV1;
  const { report } = facts;
  const route = snapshot.matches({ workbookSizing: "subset" })
    ? "subset"
    : snapshot.matches({ workbookSizing: "handoff" })
      ? "handoff"
      : "fits";
  const selected = context.selectedSheets;
  const selectedSheets = report.sheets.filter((sheet) => selected.includes(sheet.sheetIndex));
  const estimatedCells = selectionCellEstimate(report, selected);
  const blocker: WorkbookSelectionBlockerV1 | null =
    selected.length === 0
      ? "nothing-selected"
      : estimatedCells > report.budgets.maxEstimatedCells
        ? "over-budget"
        : null;
  const canStart = snapshot.can({ type: "START" });
  const handoff: WorkbookHandoffVm | null =
    route === "fits"
      ? null
      : { instructions: handoffInstructions(report.fileName), copy: context.handoffCopy ?? null };

  return {
    screen: route === "fits" ? "SCR-018" : "SCR-019",
    step: WORKBOOK_STEP[route],
    fileName: report.fileName,
    format: report.format,
    sourceByteLength: report.sourceByteLength,
    declaredExtension: facts.declaredExtension,
    contradiction:
      report.formatContradiction === null
        ? null
        : {
            declaredExtension: report.formatContradiction.declaredExtension,
            detectedFormat: report.formatContradiction.detectedFormat,
          },
    sheets: report.sheets.map((sheet) => {
      const isSelected = selected.includes(sheet.sheetIndex);
      const shape = shapeOf(sheet);
      return {
        sheetIndex: sheet.sheetIndex,
        name: sheet.name,
        isSelected,
        isHidden: sheet.visibility !== "visible",
        shape,
        rows: estimateOf(sheet.estimatedRowCount),
        cells: estimateOf(sheet.estimatedCellCount),
        badge: isSelected ? BADGE_OF_SHAPE[shape] : "excluded",
      };
    }),
    selection: {
      selectedCount: selectedSheets.length,
      sheetCount: report.sheets.length,
      estimatedRows: sumOfEstimates(selectedSheets.map((sheet) => sheet.estimatedRowCount)),
      estimatedCells,
      maxEstimatedCells: report.budgets.maxEstimatedCells,
      blocker,
    },
    workbookEstimatedCells: estimateOf(report.totals.estimatedCellCount),
    drawingNotices: selectedSheets
      .filter((sheet) => sheet.preservedPartCounts.drawing > 0)
      .map((sheet) => ({ sheetName: sheet.name, drawingCount: sheet.preservedPartCounts.drawing })),
    canStart,
    handoff,
    announcement: announceWorkbookPreflight(route, selectedSheets.length, report.sheets.length, context.handoffCopy),
  };
}

function announceWorkbookPreflight(
  route: "fits" | "subset" | "handoff",
  selectedCount: number,
  sheetCount: number,
  copy: "copied" | "unavailable" | undefined,
): string {
  const opening =
    route === "fits"
      ? // import.html, composed with the real counts.
        `This workbook fits this device. ${String(selectedCount)} of ${String(sheetCount)} sheets are selected.`
      : route === "subset"
        ? `This workbook is too large for this device. ${String(selectedCount)} of ${String(sheetCount)} sheets are selected. No cell data has been read.`
        : "This workbook is too large for this device, and no single sheet fits. No cell data has been read.";
  switch (copy) {
    case "copied":
      return `${opening} The handoff instructions were copied.`;
    case "unavailable":
      return `${opening} This browser did not allow copying, so the instructions are shown on this screen.`;
    default:
      return opening;
  }
}

function selectOverBudgetVm(snapshot: ImportSnapshot): ImportOverBudgetVm {
  const refusal = snapshot.context.refusal;
  const budget =
    refusal !== undefined && refusal.kind === "over-import-budget"
      ? refusal
      : undefined;

  return {
    screen: "SCR-019",
    step: "overBudget",
    fileName: snapshot.context.fileName,
    exceeded: budget?.exceeded ?? "source-bytes",
    sourceByteLength: budget?.sourceByteLength ?? 0,
    maxSourceByteLength: budget?.maxSourceByteLength ?? 0,
    estimatedCellCount: budget?.estimatedCellCount ?? 0,
    maxEstimatedCellCount: budget?.maxEstimatedCellCount ?? 0,
    remedy: "use-larger-device",
    libraryUnchanged: true,
    announcement:
      // import-large.html: "No cell payload has been parsed and no partial app
      // exists." Composed with the real numbers rather than the mock's.
      `This file is too large for this device. No cell data was read and the library is unchanged.`,
  };
}

function selectRefusedVm(snapshot: ImportSnapshot): ImportRefusedVm {
  const refusal = snapshot.context.refusal;
  // `refused` is entered for neither of the two excluded kinds: an over-budget
  // refusal is SCR-019's and a later-release one ends the run (D42).
  const kind: RefusalCopyTokenV1 =
    refusal === undefined ||
    refusal.kind === "over-import-budget" ||
    refusal.kind === "workbook-format-later-release"
      ? "binary-unreadable"
      : refusal.kind;

  return {
    screen: "SCR-021",
    step: "refused",
    fileName: refusal?.fileName ?? snapshot.context.fileName,
    refusal: kind,
    remedy: refusal?.remedy ?? "choose-another-file",
    unreadableDetail:
      refusal !== undefined && refusal.kind === "binary-unreadable" ? refusal.detail : null,
    libraryUnchanged: true,
    // import-refused.html: "The refusal is whole-file. Nothing partial was
    // added to the library."
    announcement: `${
      refusal?.fileName ?? snapshot.context.fileName
    } cannot become a Sheaf app. Nothing partial was added to the library.`,
  };
}

function selectProgressVm(snapshot: ImportSnapshot): ImportProgressVm {
  const { context } = snapshot;
  const step = snapshot.matches("beginningStage")
    ? "beginningStage"
    : snapshot.matches("parsing")
      ? "parsing"
      : "inferring";

  return {
    screen: "SCR-020",
    step,
    fileName: context.fileName,
    phase: context.progress.phase,
    rowsSoFar: context.progress.rowsSoFar,
    sheet: context.progress.sheet,
    batchesCommitted: context.progress.batchesAcked,
    cancellable: snapshot.can({ type: "CANCEL" }),
    cancellationContract: "removes-every-committed-batch",
    announcement: `Importing ${context.fileName}.${
      context.progress.sheet === null
        ? ""
        : ` Sheet ${String(context.progress.sheet.ordinal)} of ${String(
            context.progress.sheet.count,
          )}: ${context.progress.sheet.name}.`
    } ${String(context.progress.rowsSoFar)} rows are durable so far.`,
  };
}

function selectEndedVm(snapshot: ImportSnapshot): ImportEndedVm {
  const { context } = snapshot;
  const cancelling = snapshot.matches("cancelling");
  const cancelled = snapshot.matches("cancelled");
  const failing = snapshot.matches("failing");
  const outcome = cancelling || cancelled ? "cancelled" : "failed";

  const cleanup: ImportCleanupVm =
    context.cleanupReceipt !== undefined
      ? {
          kind: "removed",
          deletedCount: context.cleanupReceipt.deletedCount,
          completed: true,
          reason: context.cleanupReceipt.reason,
        }
      : context.stageId === undefined
        ? { kind: "nothing-to-remove" }
        : { kind: "unconfirmed" };

  return {
    screen: "SCR-022",
    step: cancelling
      ? "cancelling"
      : cancelled
        ? "cancelled"
        : failing
          ? "failing"
          : "failed",
    outcome,
    busy: cancelling || failing,
    fileName: context.fileName,
    reason: outcome === "cancelled" ? null : (context.failure ?? null),
    detail:
      outcome === "cancelled" || context.failureDetail === undefined
        ? null
        : {
            stage: context.failureDetail.stage,
            diagnostic: context.failureDetail.diagnostic,
            sheet: failedSheetOf(context.failureDetail, context.selectedSheets, context.workbook),
          },
    cleanup,
    announcement: announceEnded(outcome, cancelling || failing, cleanup),
  };
}

/**
 * The sheet a failure names, by its one-based ordinal among the selected
 * sheets, read back from the inventory pre-flight showed (CA-24).
 */
function failedSheetOf(
  detail: ImportFailureDetailV1,
  selectedSheets: readonly number[],
  workbook: ImportWorkbookFactsV1 | undefined,
): ImportSheetProgressV1 | null {
  if (detail.sheetOrdinal === null || workbook === undefined) return null;
  const sheetIndex = selectedSheets[detail.sheetOrdinal - 1];
  const sheet = workbook.report.sheets.find((candidate) => candidate.sheetIndex === sheetIndex);
  return sheet === undefined
    ? null
    : { ordinal: detail.sheetOrdinal, count: selectedSheets.length, name: sheet.name };
}

function announceEnded(
  outcome: "cancelled" | "failed",
  busy: boolean,
  cleanup: ImportCleanupVm,
): string {
  if (busy) {
    // Nothing may be claimed yet: the receipt has not arrived (MOD-007).
    return "Stopping the import and removing what it had written.";
  }
  const opening =
    outcome === "cancelled"
      ? // import-failed.html, cancelled variant, verbatim.
        "You cancelled the import."
      : "The import did not complete.";
  switch (cleanup.kind) {
    case "removed":
      // import-failed.html: "No partial app remains."
      return `${opening} No partial app remains.`;
    case "nothing-to-remove":
      return `${opening} Nothing had been written, so the library is unchanged.`;
    default:
      return `${opening} Sheaf could not confirm that everything it had written was removed.`;
  }
}

const toStatement = (statement: WorkbookStatementWireV1): ReviewStatementVm => ({
  statementId: statement.statementId,
  subject: statement.subject,
  editKind: statement.editKind,
  targetKey: statement.targetKey,
  columnIndex: statement.columnIndex,
  evidence: statement.evidence,
  disposition: statement.disposition,
});

function toField(
  field: ProposedTableWireV2["fields"][number],
  tableKey: string,
  statementsFor: (targetKey: string) => readonly ReviewStatementVm[],
): ReviewFieldVm {
  return {
    tableKey,
    columnKey: field.columnKey,
    columnIndex: field.columnIndex,
    fieldName: field.fieldName,
    isNameGenerated: field.isNameGenerated,
    type: field.type,
    valueType: field.valueType,
    sourceFormat: field.sourceFormat,
    enumOptions: field.enumOptions,
    violations:
      field.violations === null
        ? { kind: "not-measured-yet" }
        : { kind: "measured", value: field.violations },
    formulaText: field.formulaText,
    statements: statementsFor(field.columnKey),
  };
}

/**
 * The proposal as the one review reads it (CA-19). Statements are attached to
 * what they are about by their own target key — a table, a column, a
 * relationship, a sheet — and never re-derived; a region joined to the
 * table above it is shown inside that table, because promotion builds them as
 * one (S02).
 */
function reviewOf(proposal: ProposedWorkbookWireV1) {
  const statements = proposal.statements.map(toStatement);
  const statementsFor = (targetKey: string): readonly ReviewStatementVm[] =>
    statements.filter((statement) => statement.targetKey === targetKey);
  const sheetNameOf = (sheetKey: string): string =>
    proposal.sheets.find((sheet) => sheet.sheetKey === sheetKey)?.name ?? "";
  const headOf = (tableKey: string): ProposedTableWireV2 | undefined => {
    const table = proposal.tables.find((candidate) => candidate.tableKey === tableKey);
    const headKey = table?.joinedToTableKey ?? null;
    return headKey === null ? table : proposal.tables.find((candidate) => candidate.tableKey === headKey);
  };
  const fieldNameIn = (table: ProposedTableWireV2 | undefined, columnKey: string | null): string | null =>
    table?.fields.find((field) => field.columnKey === columnKey)?.fieldName ?? null;

  const tables: ReviewTableVm[] = proposal.tables
    .filter((table) => table.joinedToTableKey === null)
    .map((head) => {
      const joined = proposal.tables.filter((table) => table.joinedToTableKey === head.tableKey);
      return {
        tableKey: head.tableKey,
        tableName: head.tableName,
        sheetName: sheetNameOf(head.sheetKey),
        declaredTableName: head.source.kind === "declared-table" ? head.source.name : null,
        headerRowIndex: head.headerRowIndex,
        rowCount: exact(joined.reduce((sum, table) => sum + table.rowCount, head.rowCount)),
        discardedRowCount: head.discardedRowCount,
        discardedRows: head.discardedRows,
        leadingRows: head.leadingRows,
        joined: joined.map((table) => ({
          tableKey: table.tableKey,
          tableName: table.tableName,
          headerRowIndex: table.headerRowIndex,
          rowCount: exact(table.rowCount),
          statements: statementsFor(table.tableKey),
        })),
        keyFieldName: fieldNameIn(head, head.keyColumnKey),
        labelFieldName: fieldNameIn(head, head.labelColumnKey),
        statements: statementsFor(head.tableKey),
        fields: head.fields.map((field) => toField(field, head.tableKey, statementsFor)),
      };
    });

  const connections: ReviewConnectionVm[] = proposal.relationships.map((relationship) => {
    const from = proposal.tables.find((table) => table.tableKey === relationship.fromTableKey);
    const to = proposal.tables.find((table) => table.tableKey === relationship.toTableKey);
    const retargets = new Map<string, string>();
    for (const candidate of relationship.candidates) {
      if (candidate.toTableKey === relationship.toTableKey) continue;
      retargets.set(candidate.toTableKey, headOf(candidate.toTableKey)?.tableName ?? candidate.toTableKey);
    }
    return {
      relationshipKey: relationship.relationshipKey,
      fromTableName: headOf(relationship.fromTableKey)?.tableName ?? relationship.fromTableKey,
      fromFieldName: fieldNameIn(from, relationship.fromColumnKey) ?? relationship.fromColumnKey,
      toTableKey: relationship.toTableKey,
      toTableName: headOf(relationship.toTableKey)?.tableName ?? relationship.toTableKey,
      toFieldName: fieldNameIn(to, relationship.toColumnKey) ?? relationship.toColumnKey,
      toLabelFieldName: fieldNameIn(to, to?.labelColumnKey ?? null),
      detectionSource: relationship.detectionSource,
      isApplied: relationship.isApplied,
      brokenReferenceCount: relationship.brokenReferenceCount,
      retargets: [...retargets].map(([toTableKey, toTableName]) => ({ toTableKey, toTableName })),
      statement: statementsFor(relationship.relationshipKey)[0] ?? null,
    };
  });

  const calculations: ReviewCalculationVm[] = tables.flatMap((table) =>
    table.fields.flatMap((field) =>
      field.formulaText === null
        ? []
        : [{ tableName: table.tableName, fieldName: field.fieldName, formulaText: field.formulaText }],
    ),
  );

  const sheets: ReviewSheetVm[] = proposal.sheets.map((sheet) => ({
    sheetKey: sheet.sheetKey,
    name: sheet.name,
    isSelected: sheet.isSelected,
    classification: sheet.classification.filter(
      (entry): entry is ReviewSheetClassificationV1 => entry !== "excluded",
    ),
    // A classification statement targets `<sheetKey>.<classification>`.
    statements: statements.filter(
      (statement) =>
        statement.subject === "sheet-classification" &&
        statement.targetKey?.startsWith(`${sheet.sheetKey}.`) === true,
    ),
    inertItems: proposal.inertItems
      .filter((item) => item.sheetKey === sheet.sheetKey)
      .map((item) => ({ kind: item.kind, location: item.location, reasonKey: item.reasonKey })),
  }));

  return {
    appStatements: statements.filter((statement) => statement.subject === "app-name"),
    tables,
    connections,
    calculations,
    sheets,
  };
}

/** A refused promotion's issues, grouped by field and reason (F02 S07). */
function issueGroupsOf(rejection: ImportSnapshot["context"]["promotionRejection"]): readonly PromotionIssueGroupVm[] {
  const groups = new Map<string, PromotionIssueGroupVm>();
  for (const issue of rejection?.issues ?? []) {
    const vm = toIssueVm({ ...issue, messageParameters: {} });
    const key = `${issue.fieldId ?? "record"}|${vm.token}`;
    const group = groups.get(key);
    groups.set(
      key,
      group === undefined
        ? { fieldId: issue.fieldId, token: vm.token, sentence: vm.sentence, severity: vm.severity, count: 1 }
        : { ...group, count: group.count + 1, severity: group.severity === "blocking" ? "blocking" : vm.severity },
    );
  }
  return [...groups.values()];
}

function selectReviewVm(snapshot: ImportSnapshot): ImportReviewVm {
  const { context } = snapshot;
  const proposal = context.proposal;
  const review = proposal === undefined ? null : reviewOf(proposal);
  const tables = review?.tables ?? [];
  const fields = tables.flatMap((table) => table.fields);
  const connections = review?.connections ?? [];
  const sheets = review?.sheets ?? [];
  const isDelimited = proposal?.isDelimited ?? true;

  const measured = fields.filter((field) => field.violations.kind === "measured");
  const violationCount = measured.reduce(
    (total, field) => total + (field.violations.kind === "measured" ? field.violations.value.count : 0),
    0,
  );
  const brokenReferenceCount = connections
    .filter((connection) => connection.isApplied)
    .reduce((total, connection) => total + connection.brokenReferenceCount, 0);
  const formulaRegionCount = proposal?.inertCounts.formula ?? 0;
  const selectedSheetCount = sheets.filter((sheet) => sheet.isSelected).length;
  const structure: ReviewEmptinessV1 = isDelimited ? "not-applicable-value-only" : "none-found";

  const step = snapshot.matches("promoting")
    ? "promoting"
    : snapshot.matches("inferring")
      ? "inferring"
      : snapshot.matches({ reviewing: "applyingEdit" })
        ? "applyingEdit"
        : "reviewing";

  const appName = proposal?.appName ?? context.appName;
  const { destination } = context;
  const targetApp =
    destination.kind === "existing-app" && context.library.kind === "listed"
      ? context.library.apps.find((app) => app.appId === destination.appId)
      : undefined;

  return {
    screen: "SCR-023",
    step,
    fileName: context.fileName,
    appName,
    isDelimited,
    isExcelWorkbook: ["xlsx", "xlsb", "xls"].includes(context.workbook?.report.format ?? ""),
    appStatements: review?.appStatements ?? [],
    tables,
    connections,
    calculations: review?.calculations ?? [],
    formulaRegionCount,
    sheets,
    sections: [
      section("tables-and-rows", tables.length, "none-found"),
      section("fields-and-choices", fields.length, "none-found"),
      section("connections", connections.length, structure),
      section("live-calculations", formulaRegionCount, structure),
      section("sheets-and-snapshots", isDelimited ? 0 : selectedSheetCount, structure),
    ],
    diagnostics: proposal?.diagnostics ?? [],
    needsAttentionCount: violationCount + brokenReferenceCount,
    isNeedsAttentionExact: measured.length === fields.length,
    brokenReferenceCount,
    editRejection:
      context.editRejection === undefined
        ? null
        : toReviewEditRejectionVm(context.editRejection),
    promotionRejection:
      context.promotionRejection === undefined ? null : toPromotionRejectionVm(context.promotionRejection.reason),
    promotionIssues: issueGroupsOf(context.promotionRejection),
    confirm: {
      kind: destination.kind === "existing-app" ? "add-table" : "create-app",
      appName: destination.kind === "existing-app" ? (targetApp?.displayName ?? "") : appName,
      tableName: destination.kind === "existing-app" ? (tables[0]?.tableName ?? null) : null,
      canCreate: snapshot.can({ type: "CREATE_APP" }) && fields.length > 0,
      blocker: fields.length === 0 && proposal !== undefined ? "no-fields-found" : null,
      busy: snapshot.matches("promoting"),
      // review.html, verbatim.
      assurance: "No inference stands until you confirm.",
    },
    announcement: announceReview(
      snapshot.matches("inferring"),
      tables.length,
      fields.length,
      violationCount + brokenReferenceCount,
    ),
  };
}

function section(
  id: ReviewSectionIdV1,
  count: number,
  emptiness: ReviewEmptinessV1,
): ReviewSectionVm {
  return {
    id,
    label: SECTION_LABELS[id],
    count,
    emptiness: count === 0 ? emptiness : null,
  };
}

function announceReview(
  inferring: boolean,
  tableCount: number,
  fieldCount: number,
  needsAttention: number,
): string {
  if (inferring) {
    return "Reading what this file contains.";
  }
  if (fieldCount === 0) {
    // The empty-.csv case, composed from the one fact there is.
    return "Sheaf found no columns in this file, so there is nothing to create an app from.";
  }
  const found =
    tableCount > 1
      ? `${String(tableCount)} tables with ${String(fieldCount)} fields were found.`
      : `${String(fieldCount)} fields were found.`;
  return needsAttention === 0
    ? `${found} Nothing needs your attention.`
    : `${found} ${String(needsAttention)} values need your attention.`;
}
