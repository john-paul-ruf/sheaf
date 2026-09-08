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
import type {
  EvidenceWireV1,
  ImportDiagnosticWireV1,
  InferenceStatementWireV1,
  InferenceSubjectWireV1,
  ProposedFieldTypeWireV1,
  ProposedFieldWireV1,
  RecordIssueViewV1,
  ReviewEditKindWireV1,
  SourceValueFormatWireV1,
} from "../../workers/protocol/messages.js";
import type {
  ImportFailureReasonV1,
  ImportPhaseV1,
  importMachine,
} from "../workflows/import.machine.js";

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
 * S03's closed rejection list, restated as a literal union because a view
 * model may not import the inference module and the wire widened `reason` to
 * `string`. `tests/unit/view-models/import.test.ts` pins the two together, so
 * a divergence is a compile error there rather than a wrong sentence here.
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

// --- SCR-016 upload landing (upload.html) -----------------------------------

/** upload.html's two format groups. Availability is D19's, not the mock's. */
export interface AcceptedFormatGroupVm {
  readonly id: "value-only" | "spreadsheet-structure";
  /** upload.html, verbatim. */
  readonly label: string;
  readonly extensions: readonly string[];
  /**
   * `later-release` is D19 stated at the landing rather than only at the
   * refusal: promising a format the next screen refuses would be the
   * untruthful order to learn it in.
   */
  readonly availability: "available" | "later-release";
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
    id: "value-only" as const,
    // upload.html, verbatim.
    label: "Value-only",
    extensions: Object.freeze(["csv", "tsv"]),
    availability: "available" as const,
  }),
  Object.freeze({
    id: "spreadsheet-structure" as const,
    // upload.html, verbatim.
    label: "Spreadsheet structure",
    extensions: Object.freeze(["xlsx", "xlsb", "xls", "ods"]),
    availability: "later-release" as const,
  }),
]);

// --- SCR-017 delimited target (delimited-import.html) ------------------------

export interface ImportDestinationOptionVm {
  readonly id: "new-app" | "existing-app";
  /** delimited-import.html, verbatim. */
  readonly label: string;
  readonly enabled: boolean;
  /**
   * Present exactly when the option is off. D18: FR-1's into-existing-app
   * semantics need F03's event-shape work, so the option ships disabled with a
   * stated reason rather than enabled and unable to finish.
   */
  readonly reason?: "into-existing-app-not-available-in-this-release";
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
  readonly appName: string;
  readonly tableName: string;
  readonly appNameProblem: NameProblemVm | null;
  readonly tableNameProblem: NameProblemVm | null;
  readonly canContinue: boolean;
  readonly announcement: string;
}

const DESTINATIONS: readonly ImportDestinationOptionVm[] = Object.freeze([
  Object.freeze({
    id: "new-app" as const,
    // delimited-import.html, verbatim.
    label: "Create a new app",
    enabled: true,
  }),
  Object.freeze({
    id: "existing-app" as const,
    // delimited-import.html, verbatim.
    label: "Add a table to an existing app",
    enabled: false,
    reason: "into-existing-app-not-available-in-this-release" as const,
  }),
]);

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

// --- SCR-020 progress (import-progress.html) --------------------------------

export interface ImportProgressVm {
  readonly screen: "SCR-020";
  readonly step: "beginningStage" | "parsing" | "inferring";
  readonly fileName: string;
  readonly phase: ImportPhaseV1;
  readonly rowsSoFar: number;
  /** Batches whose ack came back — the durable count, not the sent one. */
  readonly batchesCommitted: number;
  readonly cancellable: boolean;
  /** MOD-007, import-progress.html: what cancelling promises. */
  readonly cancellationContract: "removes-every-committed-batch";
  readonly announcement: string;
}

// --- SCR-021 refusal (import-refused.html) ----------------------------------

export type RefusalCopyTokenV1 =
  | "macro-content"
  | "numbers-file"
  | "pages-file"
  | "pdf-file"
  | "workbook-format-later-release"
  | "binary-unreadable";

export interface ImportRefusedVm {
  readonly screen: "SCR-021";
  readonly step: "refused";
  readonly fileName: string;
  readonly refusal: RefusalCopyTokenV1;
  /** S03's remedy id; the pairing with the kind is held by the wire type. */
  readonly remedy: string;
  /** Only for `workbook-format-later-release` (D19): which family it was. */
  readonly laterReleaseFormat: string | null;
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

export interface ImportEndedVm {
  readonly screen: "SCR-022";
  readonly step: "cancelling" | "cancelled" | "failing" | "failed";
  readonly outcome: "cancelled" | "failed";
  readonly busy: boolean;
  readonly fileName: string;
  /** `null` for a cancel: the user's decision is not a failure. */
  readonly reason: ImportFailureReasonV1 | null;
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

/** CA-16: projected, never reshaped. Every statement keeps its evidence. */
export interface ReviewStatementVm {
  readonly statementId: string;
  readonly subject: InferenceSubjectWireV1;
  /** The edit that changes it; `null` when nothing here is editable. */
  readonly editKind: ReviewEditKindWireV1 | null;
  readonly columnIndex: number | null;
  readonly evidence: readonly EvidenceWireV1[];
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
  readonly columnIndex: number;
  readonly fieldName: string;
  readonly isNameGenerated: boolean;
  readonly type: ProposedFieldTypeWireV1;
  readonly sourceFormat: SourceValueFormatWireV1;
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
  readonly statements: readonly ReviewStatementVm[];
}

export interface ReviewTableVm {
  readonly tableName: string;
  /** `null` when no row looked like a header; the rows below start the table. */
  readonly headerRowIndex: number | null;
  readonly rowCount: ImportRowCountVm;
  readonly discardedRowCount: number;
  readonly discardedRows: readonly {
    readonly rowIndex: number;
    readonly reason: "above-header" | "empty-row";
    readonly cells: readonly string[];
  }[];
  readonly leadingRows: readonly {
    readonly rowIndex: number;
    readonly cells: readonly string[];
  }[];
  readonly statements: readonly ReviewStatementVm[];
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
 * whose result is not an app anyone asked for. Composed from facts — no flow
 * and no hierarchy is invented (S03 followUp 13).
 */
export type PromotionBlockerV1 = "no-fields-found";

export interface ImportPromotionConfirmVm {
  /** The name the app will be created under, exactly as it will be used. */
  readonly appName: string;
  readonly canCreate: boolean;
  readonly blocker: PromotionBlockerV1 | null;
  readonly busy: boolean;
  /** review.html, verbatim. */
  readonly assurance: string;
}

export interface ImportReviewVm {
  readonly screen: "SCR-023";
  readonly step: "inferring" | "reviewing" | "applyingEdit" | "promoting";
  readonly fileName: string;
  readonly appName: string;
  readonly table: ReviewTableVm | null;
  readonly fields: readonly ReviewFieldVm[];
  readonly sections: readonly ReviewSectionVm[];
  readonly diagnostics: readonly ImportDiagnosticWireV1[];
  /**
   * Derived by summing the measured violations — never invented, and never a
   * count of what was not measured (CA-16).
   */
  readonly needsAttentionCount: number;
  /** False when any field's violations were nulled by a header-row edit. */
  readonly isNeedsAttentionExact: boolean;
  readonly editRejection: ReviewEditRejectionVm | null;
  /** A promotion that refused wrote nothing; its issues name every field. */
  readonly promotionIssues: readonly RecordIssueViewV1[];
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
  readonly announcement: string;
}

export type ImportVm =
  | UploadLandingVm
  | DelimitedTargetVm
  | ImportFitsVm
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

function toStatement(
  statement: InferenceStatementWireV1,
): ReviewStatementVm {
  return {
    statementId: statement.statementId,
    subject: statement.subject,
    editKind: statement.editKind,
    columnIndex: statement.columnIndex,
    evidence: statement.evidence,
    disposition: statement.disposition,
  };
}

function toField(
  field: ProposedFieldWireV1,
  statements: readonly InferenceStatementWireV1[],
): ReviewFieldVm {
  return {
    columnIndex: field.columnIndex,
    fieldName: field.fieldName,
    isNameGenerated: field.isNameGenerated,
    type: field.type,
    sourceFormat: field.sourceFormat,
    enumOptions: field.enumOptions,
    violations:
      field.violations === null
        ? { kind: "not-measured-yet" }
        : { kind: "measured", value: field.violations },
    statements: statements
      .filter((statement) => statement.columnIndex === field.columnIndex)
      .map(toStatement),
  };
}

const TABLE_SUBJECTS: ReadonlySet<InferenceSubjectWireV1> = new Set([
  "app-name",
  "table-name",
  "header-row",
  "discarded-rows",
]);

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
    return {
      screen: "SCR-023",
      step: "done",
      appId: promoted?.appId ?? "",
      rowCount: exact(promoted?.rowCount ?? 0),
      tableCount: promoted?.tableCount ?? 0,
      flaggedRecordCount: promoted?.flaggedRecordCount ?? 0,
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

function selectDelimitedTargetVm(snapshot: ImportSnapshot): DelimitedTargetVm {
  const { context } = snapshot;
  const detection = context.detection;
  const report = detection?.report;
  const contradiction = detection?.contradiction ?? null;

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
    destinations: DESTINATIONS,
    appName: context.appName,
    tableName: context.tableName,
    appNameProblem: context.appName.trim().length === 0 ? "required" : null,
    tableNameProblem: context.tableName.trim().length === 0 ? "required" : null,
    canContinue: snapshot.can({ type: "CONTINUE" }),
    // The mock's "Rows declared: N + header" defers to review, where the
    // header row is a finding rather than an assumption (S03 followUp 7).
    announcement: `About ${String(
      report?.estimatedRowCount ?? 0,
    )} rows across ${String(report?.columnCount ?? 0)} columns were detected.`,
  };
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
  const kind: RefusalCopyTokenV1 =
    refusal === undefined || refusal.kind === "over-import-budget"
      ? "binary-unreadable"
      : refusal.kind;

  return {
    screen: "SCR-021",
    step: "refused",
    fileName: refusal?.fileName ?? snapshot.context.fileName,
    refusal: kind,
    remedy: refusal?.remedy ?? "choose-another-file",
    laterReleaseFormat:
      refusal !== undefined && refusal.kind === "workbook-format-later-release"
        ? refusal.format
        : null,
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
    batchesCommitted: context.progress.batchesAcked,
    cancellable: snapshot.can({ type: "CANCEL" }),
    cancellationContract: "removes-every-committed-batch",
    announcement: `Importing ${context.fileName}. ${String(
      context.progress.rowsSoFar,
    )} rows are durable so far.`,
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
    cleanup,
    announcement: announceEnded(outcome, cancelling || failing, cleanup),
  };
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

function selectReviewVm(snapshot: ImportSnapshot): ImportReviewVm {
  const { context } = snapshot;
  const proposal = context.proposal;
  const statements = proposal?.statements ?? [];
  const fields = (proposal?.table.fields ?? []).map((field) =>
    toField(field, statements),
  );

  const measured = fields.filter(
    (field) => field.violations.kind === "measured",
  );
  const needsAttentionCount = measured.reduce(
    (total, field) =>
      total +
      (field.violations.kind === "measured"
        ? field.violations.value.count
        : 0),
    0,
  );

  const table: ReviewTableVm | null =
    proposal === undefined
      ? null
      : {
          tableName: proposal.table.tableName,
          headerRowIndex: proposal.headerRowIndex,
          rowCount: exact(proposal.rowCount),
          discardedRowCount: proposal.discardedRowCount,
          discardedRows: proposal.discardedRows,
          leadingRows: proposal.leadingRows,
          statements: statements
            .filter((statement) => TABLE_SUBJECTS.has(statement.subject))
            .map(toStatement),
        };

  const step = snapshot.matches("promoting")
    ? "promoting"
    : snapshot.matches("inferring")
      ? "inferring"
      : snapshot.matches({ reviewing: "applyingEdit" })
        ? "applyingEdit"
        : "reviewing";

  const appName = proposal?.appName ?? context.appName;

  return {
    screen: "SCR-023",
    step,
    fileName: context.fileName,
    appName,
    table,
    fields,
    sections: [
      section("tables-and-rows", table === null ? 0 : 1, "none-found"),
      section("fields-and-choices", fields.length, "none-found"),
      section("connections", 0, "not-applicable-value-only"),
      section("live-calculations", 0, "not-applicable-value-only"),
      section("sheets-and-snapshots", 0, "not-applicable-value-only"),
    ],
    diagnostics: proposal?.diagnostics ?? [],
    needsAttentionCount,
    isNeedsAttentionExact: measured.length === fields.length,
    editRejection:
      context.editRejection === undefined
        ? null
        : toReviewEditRejectionVm(context.editRejection),
    promotionIssues: (context.promotionRejection?.issues ?? []).map((issue) => ({
      fieldId: issue.fieldId,
      kind: issue.kind,
      severity: issue.severity,
      messageKey: issue.messageKey,
      messageParameters: {},
    })),
    confirm: {
      appName,
      canCreate:
        snapshot.can({ type: "CREATE_APP" }) && fields.length > 0,
      blocker: fields.length === 0 && proposal !== undefined ? "no-fields-found" : null,
      busy: snapshot.matches("promoting"),
      // review.html, verbatim.
      assurance: "No inference stands until you confirm.",
    },
    announcement: announceReview(
      snapshot.matches("inferring"),
      fields.length,
      needsAttentionCount,
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
  return needsAttention === 0
    ? `${String(fieldCount)} fields were found. Nothing needs your attention.`
    : `${String(fieldCount)} fields were found. ${String(
        needsAttention,
      )} values need your attention.`;
}
