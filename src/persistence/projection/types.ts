/**
 * The projection's public vocabulary: what a caller hands the engine, and what
 * the engine hands back.
 *
 * Two boundaries are stated here rather than assumed:
 *
 * - **The engine never reads storage.** Every input below is already decoded
 *   and decrypted by its owner (S04's promotion, S05's worker composition).
 *   M12 opens no IndexedDB, decrypts nothing, and holds no key.
 * - **The engine never interprets an opaque payload.** `EventCommitV1.payload`
 *   is `unknown` by contract — M09 carries payloads as opaque canonical CBOR
 *   and the semantic mapping belongs to the commit's author. So
 *   {@link ProjectionCommitV1} pairs the raw commit (whose hash and chain the
 *   replay guards verify) with the caller's already-typed events, and the
 *   guards prove the two agree index for index.
 *
 * Everything the engine writes is ephemeral. It lives in one `:memory:`
 * database that is destroyed on lock, so a shape here is a session shape, never
 * a durable format: nothing in this file may be written to IndexedDB or to a
 * provider.
 */

import type { StorageId16 } from "../../domain/model/bytes.js";
import type {
  AppThemeV1,
  AuthoredRecordV1,
  ChartStateV1,
  DomainEventOfV1,
  FieldChangeV1,
  FormulaMetadataV1,
  Sha256V1,
} from "../../domain/model/events.js";
import type { FormulaDefinitionV1 } from "../../domain/formulas/ir.js";
import type { GroupingV1 } from "../../domain/model/charts.js";
import type { ImpactReportV1 } from "../../domain/validation/schema-impact.js";
import type {
  AppId,
  CommitId,
  DecisionId,
  DeviceId,
  EventId,
  FieldId,
  FormulaId,
  InertItemId,
  RecordId,
  RelationshipId,
  RuleId,
  SheetId,
  TableId,
} from "../../domain/model/ids.js";
import type {
  EnumOptionDefV1,
  FieldDefV1,
  RelationshipDefV1,
  StorageKindV1,
  TableDefV1,
} from "../../domain/model/schema.js";
import type { ValueProvenanceV1 } from "../../domain/model/provenance.js";
import type {
  CellRangeV1,
  DecisionKindV1,
  ImportLineageV1,
  InertItemKindV1,
  InertReasonKeyV1,
  SheetClassificationV1,
} from "../../domain/model/snapshots.js";
import type { InferenceDispositionV1 } from "../../domain/model/events.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import type {
  ValidationIssueKindV1,
  ValidationRuleIR,
  ValidationRuleIRV2,
  ValidationSeverityV1,
} from "../../domain/validation/rules.js";
import type {
  EventClassV1,
  EventCommitV1,
  FrontierEntryV1,
} from "../../migrations/004_event_format_v1.js";

/** SHA-256 over exact bytes; M08's `sha256` satisfies it (M09's convention). */
export type Sha256Fn = (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/** The domain's list (M01), re-exported where the projection's readers look. */
export {
  SHEET_CLASSIFICATIONS,
  type SheetClassificationV1,
} from "../../domain/model/snapshots.js";

/** `change_history.subject_kind`, closed by migration 005. */
export const CHANGE_SUBJECT_KINDS = Object.freeze([
  "app",
  "table",
  "field",
  "record",
  "chart",
  "rule",
  "formula",
  "home",
  "conflict",
] as const);

export type ChangeSubjectKindV1 = (typeof CHANGE_SUBJECT_KINDS)[number];

/** A record rule of either IR version (CA-27). */
export type RecordRuleIRV1 = ValidationRuleIR | ValidationRuleIRV2;

/**
 * M01's event union over M02's rule IR and impact counts and M03's formula
 * definition (M01 may not name them); M07 states the same instantiation.
 */
export type DomainEventV1 = DomainEventOfV1<
  RecordRuleIRV1,
  FormulaDefinitionV1,
  Omit<ImpactReportV1, "patches">
>;

// ------------------------------------------------------------ hydration in --

/**
 * The `app_state` root. Promotion writes it (D29) and hydration reads it: the
 * engine never composes a default theme, because `theme_cbor` is `NOT NULL` and
 * a projection that invented one would show a colour nobody authored.
 */
export interface ProjectionAppStateV1 {
  readonly appId: AppId;
  readonly displayName: string;
  readonly createdAtMs: number;
  readonly lastOpenedAtMs: number | null;
  readonly schemaRevision: bigint;
  readonly locality: "present" | "oversized-local";
  /** Null means scratch — no durable home yet (F05 assigns one). */
  readonly durableHomeId: Uint8Array | null;
  readonly lastSuccessfulBackupMs: number | null;
  readonly deviceOnlyChangeCount: number;
  readonly theme: AppThemeV1;
  readonly stateRevision: bigint;
}

export interface ProjectionSheetSnapshotV1 {
  readonly sheetId: SheetId;
  readonly displayName: string;
  readonly sheetOrdinal: number;
  readonly classification: readonly SheetClassificationV1[];
  readonly snapshotManifestStorageId: StorageId16;
  /** Omitted rather than shown as zero when the source never declared it. */
  readonly declaredRowCount: number | null;
  readonly declaredColumnCount: number | null;
  readonly snapshotRevision: bigint;
}

export interface ProjectionValidationRuleV1 {
  readonly tableId: TableId;
  readonly displayName: string;
  /** IR v1 or v2 (CA-27): the same IR CRUD, restore and impact evaluate. */
  readonly rule: RecordRuleIRV1;
  readonly isActive: boolean;
  readonly schemaRevision: bigint;
}

/**
 * One `formulas` row with its `formula_dependencies` (CA-25). The definition
 * holds no result: results are recalculated here and live only in `cells`
 * (computed lane) and `scalar_formula_results` (D60).
 */
export interface ProjectionFormulaV1 {
  readonly formula: FormulaDefinitionV1;
  readonly metadata: FormulaMetadataV1;
  readonly isActive: boolean;
  readonly schemaRevision: bigint;
}

/**
 * One `charts` row (CA-30): the definition and the facts beside it. A
 * dataset is never a row — it is computed per request (database.md).
 */
export type ProjectionChartV1 = ChartStateV1;

/** One `inert_content` row: kept, listed, and never executed (D40). */
export interface ProjectionInertItemV1 {
  readonly inertItemId: InertItemId;
  readonly sheetId: SheetId;
  readonly kind: InertItemKindV1;
  readonly location: string;
  readonly reasonKey: InertReasonKeyV1;
  readonly anchor: CellRangeV1 | null;
  readonly preservedManifestStorageId: StorageId16 | null;
}

/**
 * One projectable `inference_decisions` row. Only a decision with a kind is a
 * row; `(decisionKind, evidenceFingerprint)` is unique, so a rejected
 * statement is discoverable before inference can propose it again (D44).
 */
export interface ProjectionInferenceDecisionV1 {
  readonly decisionId: DecisionId;
  readonly decisionKind: DecisionKindV1;
  readonly evidenceFingerprint: Sha256V1;
  readonly disposition: InferenceDispositionV1;
  /** Canonically encodable; the producer's shape. */
  readonly statement: unknown;
  readonly evidence: unknown;
  readonly recordedEventId: EventId;
}

/**
 * One live record as the checkpoint holds it: the authored values, the commits
 * that produced them, and the issues **the shared validator** already found.
 * The engine adds no validation of its own — the single exception is the
 * decimal order-key domain, which is a property of this projection rather than
 * of the record (see `record-rows.ts`).
 */
export interface ProjectionRecordV1 {
  readonly record: AuthoredRecordV1;
  readonly recordRevision: bigint;
  readonly createdCommitId: CommitId;
  readonly updatedCommitId: CommitId;
  readonly issues: readonly ValidationIssueV1Input[];
}

/** A validator issue as it enters the projection; `issue_id` is derived here. */
export interface ValidationIssueV1Input {
  readonly fieldId: FieldId | null;
  readonly ruleId: RuleId | null;
  readonly kind: ValidationIssueKindV1;
  readonly severity: ValidationSeverityV1;
  readonly messageKey: string;
  readonly messageParameters: Readonly<
    Record<string, string | number | bigint | boolean>
  >;
}

/**
 * One checkpoint record page — the load batch boundary, not a decorative
 * wrapper: a failure anywhere inside a page rolls the batch back and disposes
 * the whole projection (database.md § Projection load order).
 */
export interface ProjectionRecordPageV1 {
  readonly records: readonly ProjectionRecordV1[];
}

export interface ProjectionCheckpointV1 {
  readonly appId: AppId;
  /** Paired: both null for an app with no checkpoint yet, or both present. */
  readonly checkpointStorageId: StorageId16 | null;
  readonly checkpointSemanticSha256: Sha256V1 | null;
  /** The frontier the checkpoint content covers. */
  readonly frontier: readonly FrontierEntryV1[];
  /** Session diagnostic; the projection owns no clock. */
  readonly hydratedAtMs: number;
  readonly appState: ProjectionAppStateV1;
  readonly sheetSnapshots: readonly ProjectionSheetSnapshotV1[];
  readonly tables: readonly TableDefV1[];
  readonly enumOptions: readonly EnumOptionDefV1[];
  readonly relationships: readonly RelationshipDefV1[];
  readonly validationRules: readonly ProjectionValidationRuleV1[];
  /** Load order step 3: after the fields whose `formulaId` names them. */
  readonly formulas: readonly ProjectionFormulaV1[];
  /** The live charts (CA-30); absent means none, as for every app before S05. */
  readonly charts?: readonly ProjectionChartV1[];
  readonly inertItems: readonly ProjectionInertItemV1[];
  readonly importLineages: readonly ImportLineageV1[];
  readonly inferenceDecisions: readonly ProjectionInferenceDecisionV1[];
  readonly recordPages: readonly ProjectionRecordPageV1[];
}

// ---------------------------------------------------------------- replay in --

/**
 * A commit to replay. `commit` is the wire value exactly as M09 decoded it —
 * the chain, hash, frontier, and schema guards run against it. `events` is the
 * same event list with its payloads typed by the caller that authored them;
 * the guards refuse a pair whose length, order, or kinds disagree, so a typed
 * payload can never be attached to a commit that does not contain it.
 */
export interface ProjectionEvidenceStateV1 {
  readonly identity?: { readonly matchFieldId: Uint8Array | null; readonly candidates: readonly AuthoredRecordV1[] };
  readonly state: "present" | "deleted" | "absent";
  readonly record: AuthoredRecordV1 | null;
  readonly canonical: Uint8Array;
}

export interface ProjectionEvidenceSourceV1 {
  readonly source: "this-device" | "another-device" | "uploaded-file";
  readonly timestampMs: number;
  readonly commitId: Uint8Array;
  readonly frontier: readonly FrontierEntryV1[];
  readonly state: ProjectionEvidenceStateV1;
  readonly canonical: Uint8Array;
}

export interface ProjectionEvidenceBaselineV1 {
  readonly scopeId: Uint8Array;
  readonly state: "present" | "deleted" | "absent";
  readonly values: Uint8Array | null;
  readonly absentReason: string | null;
  readonly frontier: readonly FrontierEntryV1[];
  readonly canonical: Uint8Array;
}

export interface ProjectionEvidenceReportV1 {
  readonly isValid: boolean;
  readonly issues: readonly ValidationIssueV1Input[];
  readonly canonical: Uint8Array;
}

export type ProjectionEvidenceEventV1 = {
  readonly kind: "conflict.detected";
  readonly payload: {
    readonly schemaRevision: bigint;
    readonly conflictId: Uint8Array;
    readonly tableId: Uint8Array;
    readonly targetKind: "record" | "schema" | "identity";
    readonly targetId: Uint8Array;
    readonly conflictKind: "field" | "key" | "delete-edit" | "baseline-absent" | "record-validation" | "schema" | "identity";
    readonly baseline: ProjectionEvidenceBaselineV1 | null;
    readonly local: ProjectionEvidenceSourceV1;
    readonly incoming: ProjectionEvidenceSourceV1;
    readonly conflictingFields: readonly Uint8Array[];
    readonly validationReport: ProjectionEvidenceReportV1 | null;
  };
  readonly canonical: Uint8Array;
} | {
  readonly kind: "conflict.resolved";
  readonly payload: {
    readonly schemaRevision: bigint;
    readonly conflictId: Uint8Array;
    readonly detectedEventId: Uint8Array;
    readonly decision: "keep-local" | "use-incoming" | "edited";
    readonly result: ProjectionEvidenceStateV1;
    readonly validationReport: ProjectionEvidenceReportV1;
    readonly effectEventIds: readonly Uint8Array[];
  };
  readonly canonical: Uint8Array;
} | {
  readonly kind: "merge.applied";
  readonly payload: {
    readonly schemaRevision: bigint;
    readonly mergeId: Uint8Array;
    readonly tableId: Uint8Array;
    readonly recordId: Uint8Array;
    readonly baseline: ProjectionEvidenceBaselineV1;
    readonly local: ProjectionEvidenceSourceV1;
    readonly incoming: ProjectionEvidenceSourceV1;
    readonly localChangedFields: readonly Uint8Array[];
    readonly incomingChangedFields: readonly Uint8Array[];
    readonly result: AuthoredRecordV1;
    readonly resultCommitId: Uint8Array;
    readonly validationReport: ProjectionEvidenceReportV1;
    readonly explanation: Uint8Array;
    readonly effectEventIds: readonly Uint8Array[];
  };
  readonly canonical: Uint8Array;
};

export type ProjectionReplayEventV1 = DomainEventV1 | ProjectionEvidenceEventV1;

export interface ProjectionCommitV1 {
  readonly schemaEvidence?: () => Uint8Array;
  readonly commit: EventCommitV1;
  readonly events: readonly ProjectionReplayEventV1[];
  /**
   * The validator's issues for the record an event leaves behind, keyed by
   * event index. The projection never re-validates (invariant 5), so a caller
   * that holds a report — S05 does, at command time — hands it over here;
   * anything not named simply has no issues.
   */
  readonly issuesByEventIndex?: ReadonlyMap<
    number,
    readonly ValidationIssueV1Input[]
  >;
  /**
   * The one shared validator, handed over for a commit that changes the
   * schema: once the commit's events have landed, every record of a table the
   * commit touched is re-judged through it against the schema as it now
   * stands (a new rule, a required toggle, a converted type). The projection
   * still decides nothing — it asks the caller's validator (invariant 5).
   * Absent: nothing is re-judged, which is right for a record-only commit.
   */
  readonly revalidate?: RecordRevalidatorV1;
}

/** The validator's verdict for one record, as the schema now stands. */
export type RecordRevalidatorV1 = (
  record: AuthoredRecordV1,
) => readonly ValidationIssueV1Input[];

// --------------------------------------------------------------- queries out --

export type ProjectionTableSummaryV1 = Omit<TableDefV1, "fields">;

/**
 * One `cells` row, verbatim. The lanes are returned raw so a consumer — and
 * CA-13(b)'s proof — can see that exactly one of them is populated. The value
 * a user reads comes from {@link ProjectionRecordDetailV1.authoredValues},
 * which is the authoritative state; these lanes are the index over it.
 */
export interface ProjectionCellRowV1 {
  readonly fieldId: FieldId;
  readonly origin: "authored" | "computed";
  readonly valueKind: StorageKindV1;
  readonly textValue: string | null;
  readonly textSortKey: Uint8Array | null;
  readonly decimalValue: string | null;
  readonly decimalOrderKey: Uint8Array | null;
  readonly integerValue: number | null;
  readonly idValue: Uint8Array | null;
}

export interface ProjectionIssueRowV1 {
  readonly issueId: Uint8Array;
  readonly fieldId: FieldId | null;
  readonly ruleId: RuleId | null;
  readonly issueKind: ValidationIssueKindV1;
  readonly severity: ValidationSeverityV1;
  readonly messageKey: string;
  readonly messageParameters: Readonly<
    Record<string, string | bigint | boolean>
  >;
}

/**
 * A computed cell as a read reports it (CA-26): each result state distinct,
 * a value only where one exists. `unsupported` and `frozen` carry the
 * record's authored literal; `unsupported-new-row` never becomes a zero.
 */
export type ProjectionComputedCellV1 =
  | { readonly state: "ok" | "frozen" | "unsupported"; readonly value: CellValueV1 }
  | { readonly state: "type" | "empty" | "cycle" | "unsupported-new-row" }
  | { readonly state: "error"; readonly code: string };

export interface ProjectionRecordSummaryV1 {
  /** The session row key. Stable within one projection; never durable. */
  readonly recordPk: number;
  readonly recordId: RecordId;
  readonly tableId: TableId;
  readonly recordRevision: bigint;
  /** Complete authored state, including the values that have no typed lane. */
  readonly authoredValues: ReadonlyMap<FieldId, CellValueV1>;
  /** Every active computed column's current result, keyed by the schema's field IDs. */
  readonly computed: ReadonlyMap<FieldId, ProjectionComputedCellV1>;
  readonly blockingIssueCount: number;
  readonly warningIssueCount: number;
}

/**
 * One `scalar_formula_results` row: a table metric's or dashboard value's
 * current result, evaluated at the session clock (D60). Ephemeral.
 */
export interface ProjectionScalarResultV1 {
  readonly formulaId: FormulaId;
  readonly status: "ok" | "empty" | "unsupported" | "cycle" | "error";
  readonly value: CellValueV1 | null;
  readonly code: string | null;
  readonly evaluatedAtMs: number;
}

/** What `applyEvents` reports: the computed columns its commits re-derived. */
export interface ProjectionApplyReceiptV1 {
  readonly recalculatedFieldIds: readonly FieldId[];
}

export interface ProjectionRecordDetailV1 extends ProjectionRecordSummaryV1 {
  readonly createdCommitId: CommitId;
  readonly updatedCommitId: CommitId;
  readonly provenance: ReadonlyMap<FieldId, ValueProvenanceV1>;
  readonly cells: readonly ProjectionCellRowV1[];
  readonly issues: readonly ProjectionIssueRowV1[];
}

/**
 * A page of records. There is no total here on purpose (CA-14): an exact count
 * comes only from the `count-records` query's `count(*)`, and `hasMore` is
 * observed by reading one row past the page rather than estimated.
 */
export interface ProjectionRecordPageResultV1 {
  readonly records: readonly ProjectionRecordSummaryV1[];
  readonly hasMore: boolean;
  /** Pass back as `afterRecordPk`; null when the page ended the table. */
  readonly nextRecordPk: number | null;
}

/** The structured before/after a history row carries; language is M37's. */
export interface ProjectionChangeSummaryV1 {
  readonly evidence?: Uint8Array;
  readonly fieldChanges: readonly FieldChangeV1[];
  /** The record revision this event left behind, for record events. */
  readonly recordRevision: bigint | null;
  /** The commit that first created the subject record, where one applies. */
  readonly createdCommitId: CommitId | null;
  /**
   * The table the event is about — its record's, field's, or its own — so a
   * multi-table log can say where a change happened. Null for app events.
   */
  readonly tableId: TableId | null;
}

export interface ProjectionChangeEventV1 {
  readonly eventId: EventId;
  readonly commitId: CommitId;
  readonly eventIndex: number;
  readonly eventKind: string;
  readonly eventClass: EventClassV1;
  readonly subjectKind: ChangeSubjectKindV1;
  readonly subjectId: Uint8Array;
  readonly wallTimeMs: number;
  readonly logicalCounter: number;
  readonly deviceId: DeviceId;
  readonly summary: ProjectionChangeSummaryV1;
  /** Complete restoration payload; present only on a recoverable delete. */
  readonly restoration: AuthoredRecordV1 | null;
}

/** Keyset cursor for history paging: the last row of the previous page. */
export interface ChangeHistoryCursorV1 {
  readonly wallTimeMs: number;
  readonly logicalCounter: number;
  readonly eventId: EventId;
}

export interface ProjectionChangeHistoryPageV1 {
  readonly events: readonly ProjectionChangeEventV1[];
  readonly hasMore: boolean;
  readonly nextCursor: ChangeHistoryCursorV1 | null;
}

/**
 * Where a reference points. `resolved` names the live parent and its label
 * (the parent's label field, else its key — display text, never the record).
 * `broken` carries the original key when one is knowable: the preserved
 * imported text, or the key value in a deleted parent's restoration payload
 * (D36); null when neither exists.
 */
export type ProjectionRelatedParentV1 =
  | {
      readonly status: "resolved";
      readonly recordId: RecordId;
      readonly tableId: TableId;
      readonly label: string;
    }
  | { readonly status: "broken"; readonly originalKey: string | null };

/** A record as a relationship surface shows it: its id and its label. */
export interface ProjectionLabeledRecordV1 {
  readonly recordPk: number;
  readonly recordId: RecordId;
  readonly label: string;
}

/** One page of a parent's children; `hasMore` is observed, never estimated. */
export interface ProjectionRelatedChildrenPageV1 {
  readonly children: readonly ProjectionLabeledRecordV1[];
  readonly hasMore: boolean;
  readonly nextRecordPk: number | null;
}

/**
 * A deleted record as its latest delete left it (MOD-010): the complete
 * restoration payload, when it was deleted, and — when its table has a key —
 * its key value, which is a broken reference's original key (D36).
 */
export interface ProjectionDeletedRecordV1 {
  readonly tableId: TableId;
  readonly restoration: AuthoredRecordV1;
  readonly deletedEventId: EventId;
  readonly deletedAtMs: number;
  readonly keyValue: CellValueV1 | null;
}

/** A relationship with both tables' names, for navigation and switching. */
/** A sheet with how many inert items of each kind it holds. */
export interface ProjectionSheetListingV1 {
  readonly sheet: ProjectionSheetSnapshotV1;
  readonly inertCounts: readonly {
    readonly kind: InertItemKindV1;
    readonly count: number;
  }[];
}

export interface ProjectionRelationshipV1 {
  readonly relationship: RelationshipDefV1;
  readonly fromTableName: string;
  readonly toTableName: string;
}

/**
 * One typed-lane predicate of a records query (CA-29): a field and values,
 * never SQL. `filter-sql.ts` binds every value; M35 compiles these from the
 * domain's `FilterV1`.
 */
export type ProjectionFilterTermV1 =
  | { readonly kind: "id-in"; readonly fieldId: FieldId; readonly ids: readonly Uint8Array[] }
  | {
      readonly kind: "integer-range";
      readonly fieldId: FieldId;
      readonly min: number | null;
      readonly max: number | null;
    }
  | {
      readonly kind: "decimal-range";
      readonly fieldId: FieldId;
      readonly min: string | null;
      readonly max: string | null;
    }
  | { readonly kind: "text-equals" | "text-contains"; readonly fieldId: FieldId; readonly text: string }
  | { readonly kind: "reference-broken"; readonly fieldId: FieldId }
  | { readonly kind: "is-empty" | "not-empty"; readonly fieldId: FieldId; readonly isComputed: boolean };

export type ProjectionSortKeyKindV1 =
  | "text"
  | "decimal"
  | "integer"
  | "option-ordinal"
  | "reference-label";

export interface ProjectionRecordSortV1 {
  readonly fieldId: FieldId;
  readonly direction: "asc" | "desc";
  readonly key: ProjectionSortKeyKindV1;
}

/** A row's sort key as SQLite orders it; null sorts last in both directions. */
export type ProjectionSortValueV1 = Uint8Array | number | null;

export interface ProjectionQueryCursorV1 {
  readonly recordPk: number;
  readonly sortValue: ProjectionSortValueV1;
}

/** A partial page never carries a total; `partial` states what it examined (D53). */
export interface ProjectionRecordQueryResultV1 {
  readonly records: readonly ProjectionRecordSummaryV1[];
  readonly hasMore: boolean;
  readonly next: ProjectionQueryCursorV1 | null;
  readonly total: number | null;
  readonly partial: { readonly scanned: number; readonly tableTotal: number } | null;
}

/**
 * The shape a chart dataset reads (D54): a grouping (and a stacked chart's
 * series) with an optional measured field, or a scatter's two axes. Stable
 * IDs only — the lanes each one reads are the field types' to decide.
 */
export type ProjectionChartShapeV1 =
  | {
      readonly kind: "grouped";
      readonly groupBy: GroupingV1;
      readonly seriesBy: GroupingV1 | null;
      /** Null counts records; a decimal field is summed, averaged, or bounded. */
      readonly measureFieldId: FieldId | null;
    }
  | { readonly kind: "scatter"; readonly x: FieldId; readonly y: FieldId };

/**
 * One category or series of a chart dataset. `empty` holds the records with
 * no value (missing or blank; for a relationship grouping: no reference at
 * all), `unreadable` those whose value was imported as written; a
 * relationship grouping's `value` and `empty-parent` name the parents that
 * carry it, which is how its tapped mark becomes a filter (D54).
 */
export type ProjectionChartKeyV1 =
  | { readonly kind: "empty" }
  | {
      readonly kind: "value";
      /** The value, or for a date grouping the first day of its bucket. */
      readonly value: CellValueV1;
      /** An option's or a referenced record's label; null where the value says itself. */
      readonly label: string | null;
      readonly parents: readonly RecordId[] | null;
    }
  | { readonly kind: "empty-parent"; readonly parents: readonly RecordId[] }
  /** An imported value kept exactly as written (D36/FR-4): no filter can name these rows. */
  | { readonly kind: "unreadable" };

/** One category (x series) of a grouped dataset, aggregated exactly. */
export interface ProjectionChartGroupV1 {
  readonly category: ProjectionChartKeyV1;
  readonly series: ProjectionChartKeyV1 | null;
  /** Source rows in this group. */
  readonly records: number;
  /** Of those, how many carry the measured field (all of them for a count). */
  readonly measured: number;
  /** Canonical decimals over the measured values; null when none, or out of range. */
  readonly sum: string | null;
  readonly min: string | null;
  readonly max: string | null;
}

export interface ProjectionChartPointV1 {
  readonly recordId: RecordId;
  readonly x: string;
  readonly y: string;
}

/**
 * A chart's bounded dataset (CA-30, D53): request-scoped, never a row. It
 * says exactly what it read — how many rows matched, how many of those (the
 * newest, by `record_pk`) it aggregated, and how many the table holds.
 */
export interface ProjectionChartDatasetV1 {
  readonly tableTotal: number;
  readonly matchingRows: number;
  readonly sourceRows: number;
  /** Grouped: in category order, each category's series in series order. */
  readonly groups: readonly ProjectionChartGroupV1[];
  /** Scatter: the source rows carrying both axes, newest first. */
  readonly points: readonly ProjectionChartPointV1[];
}

export type ProjectionQueryV1 =
  | { readonly kind: "app-state" }
  | { readonly kind: "list-tables" }
  | { readonly kind: "list-fields"; readonly tableId: TableId }
  | { readonly kind: "list-enum-options"; readonly fieldId: FieldId }
  | { readonly kind: "list-validation-rules"; readonly tableId: TableId }
  | { readonly kind: "count-records"; readonly tableId: TableId }
  | {
      readonly kind: "page-records";
      readonly tableId: TableId;
      readonly afterRecordPk: number | null;
      readonly limit: number;
    }
  | {
      readonly kind: "search-records";
      readonly tableId: TableId;
      readonly text: string;
      readonly afterRecordPk: number | null;
      readonly limit: number;
    }
  | { readonly kind: "record-by-id"; readonly recordId: RecordId }
  | {
      readonly kind: "page-change-history";
      readonly after: ChangeHistoryCursorV1 | null;
      readonly limit: number;
    }
  | {
      readonly kind: "record-change-history";
      readonly recordId: RecordId;
      readonly limit: number;
    }
  /** The reference resolver's predicate: live, and in exactly this table. */
  | {
      readonly kind: "record-is-live";
      readonly tableId: TableId;
      readonly recordId: RecordId;
    }
  /** Both directions for a table, or every relationship when null. */
  | { readonly kind: "list-relationships"; readonly tableId: TableId | null }
  /** Null when the record is not live or the field holds no reference. */
  | {
      readonly kind: "related-parent";
      readonly recordId: RecordId;
      readonly fieldId: FieldId;
    }
  /** Null when the relationship is unknown. Reverse navigation, paged. */
  | {
      readonly kind: "related-children";
      readonly relationshipId: RelationshipId;
      readonly parentRecordId: RecordId;
      readonly afterRecordPk: number | null;
      readonly limit: number;
    }
  /** Exact, because it is `count(*)` (CA-14). */
  | {
      readonly kind: "count-related-children";
      readonly relationshipId: RelationshipId;
      readonly parentRecordId: RecordId;
    }
  /** Parent-table records for a reference picker; blank text browses. */
  | {
      readonly kind: "reference-candidates";
      readonly relationshipId: RelationshipId;
      readonly text: string;
      readonly limit: number;
    }
  | { readonly kind: "deleted-record"; readonly recordId: RecordId }
  /** Every imported sheet in workbook order, with inert counts per kind. */
  | { readonly kind: "list-sheet-snapshots" }
  /** A sheet's inert items, or every sheet's when null. */
  | { readonly kind: "list-inert-items"; readonly sheetId: SheetId | null }
  /** Review decisions of one kind, or all — the append path's rejection memory (D44). */
  | {
      readonly kind: "list-inference-decisions";
      readonly decisionKind: DecisionKindV1 | null;
    }
  /** A table's formulas (column, metric, table-scoped dashboard), or all when null. */
  | { readonly kind: "list-formulas"; readonly tableId: TableId | null }
  /** Every metric and dashboard value's current result. */
  | { readonly kind: "scalar-results" }
  /** Every live chart, in display order (`chart_ordinal`). */
  | { readonly kind: "list-charts" }
  /**
   * A chart's dataset over one table, filtered as the records query filters
   * (CA-29), reading at most `sourceRowBudget` rows — the newest (D53).
   */
  | {
      readonly kind: "chart-dataset";
      readonly tableId: TableId;
      readonly filters: readonly ProjectionFilterTermV1[];
      readonly shape: ProjectionChartShapeV1;
      readonly sourceRowBudget: number;
    }
  /** Search ∧ typed filters ∧ one sort, within a candidate budget (CA-29, D53). */
  | {
      readonly kind: "query-records";
      readonly tableId: TableId;
      readonly search: string | null;
      readonly filters: readonly ProjectionFilterTermV1[];
      readonly sort: ProjectionRecordSortV1 | null;
      readonly after: ProjectionQueryCursorV1 | null;
      readonly limit: number;
      readonly candidateBudget: number;
    };

export interface ProjectionQueryResultsV1 {
  readonly "app-state": ProjectionAppStateV1;
  readonly "list-tables": readonly ProjectionTableSummaryV1[];
  readonly "list-fields": readonly FieldDefV1[];
  readonly "list-enum-options": readonly EnumOptionDefV1[];
  readonly "list-validation-rules": readonly ProjectionValidationRuleV1[];
  /** Exact, because it is `count(*)` and nothing else (CA-14). */
  readonly "count-records": number;
  readonly "page-records": ProjectionRecordPageResultV1;
  readonly "search-records": ProjectionRecordPageResultV1;
  readonly "record-by-id": ProjectionRecordDetailV1 | null;
  readonly "page-change-history": ProjectionChangeHistoryPageV1;
  readonly "record-change-history": readonly ProjectionChangeEventV1[];
  readonly "record-is-live": boolean;
  readonly "list-relationships": readonly ProjectionRelationshipV1[];
  readonly "related-parent": ProjectionRelatedParentV1 | null;
  readonly "related-children": ProjectionRelatedChildrenPageV1 | null;
  readonly "count-related-children": number;
  readonly "reference-candidates": readonly ProjectionLabeledRecordV1[];
  readonly "deleted-record": ProjectionDeletedRecordV1 | null;
  readonly "list-sheet-snapshots": readonly ProjectionSheetListingV1[];
  readonly "list-inert-items": readonly ProjectionInertItemV1[];
  readonly "list-inference-decisions": readonly ProjectionInferenceDecisionV1[];
  readonly "list-formulas": readonly ProjectionFormulaV1[];
  readonly "scalar-results": readonly ProjectionScalarResultV1[];
  readonly "list-charts": readonly ProjectionChartV1[];
  readonly "chart-dataset": ProjectionChartDatasetV1 | null;
  readonly "query-records": ProjectionRecordQueryResultV1;
}

export type ProjectionQueryKindV1 = ProjectionQueryV1["kind"];

// ---------------------------------------------------------------- internals --

/**
 * The schema the engine holds in memory while a projection is open: what the
 * typed lanes, the searchable text, and the replay guards need to know about a
 * field without a round trip. Hydration builds it; `enum.changed` updates it.
 */
export interface ProjectionSchemaCacheV1 {
  readonly tables: Map<string, ProjectionTableSummaryV1>;
  readonly fieldsByTable: Map<string, FieldDefV1[]>;
  readonly fields: Map<string, FieldDefV1>;
  readonly enumOptions: Map<string, EnumOptionDefV1[]>;
  readonly optionLabels: Map<string, string>;
  /** Every relationship, keyed by its reference (source) field. */
  readonly relationships: Map<string, RelationshipDefV1>;
  /** Every formula, active or not, keyed by its ID; `formula.changed` updates it. */
  readonly formulas: Map<string, ProjectionFormulaV1>;
  /** Every live chart, keyed by its ID; `chart.saved`/`chart.deleted` update it. */
  readonly charts: Map<string, ProjectionChartV1>;
}
