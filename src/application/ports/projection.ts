/**
 * The unlocked relational projection, as the contract the application layer
 * depends on (M07; CA-13 consumer side).
 *
 * M12 owns the engine — SQLite WASM, the SQL templates, the typed lanes — and
 * it lives in `src/persistence/`. Commands and queries may not import it
 * (M34/M35's dependency must-nots), so this port restates M12's *session*
 * vocabulary structurally, exactly as M01 restates 004's provenance and
 * `messages.ts` restates S03's proposal. Drift is not a review risk: the two
 * are pinned assignable in both directions by
 * `tests/unit/workers/projection-port.test.ts`, where the worker composes them.
 *
 * Three properties of S02's engine are carried into the port because a caller
 * that did not know them would write something untrue:
 *
 * - **`execute` is synchronous.** The engine holds an in-memory database; a
 *   query returns a value, never a promise, so a query plan cannot interleave
 *   a write between its own reads.
 * - **The query surface is closed.** {@link ProjectionQueryV1} is a closed union
 *   and no member carries SQL, so no caller — and no user text
 *   travelling through one — can reach a statement.
 * - **`applyEvents` takes the raw commit and the caller's typed events
 *   together.** The engine verifies they agree index for index; supplying a
 *   payload that does not match the commit it rides on is refused rather than
 *   trusted (S02 surprise 2).
 */

import type {
  AuthoredRecordV1,
  ChartStateV1,
  FieldChangeV1,
  FormulaMetadataV1,
  AppThemeV1,
  InferenceDispositionV1,
} from "../../domain/model/events.js";
import type { DomainEventV1, RecordRuleIRV1 } from "./event-repository.js";
import type { FormulaDefinitionV1 } from "../../domain/formulas/ir.js";
import type { GroupingV1 } from "../../domain/model/charts.js";
import type {
  CellRangeV1,
  DecisionKindV1,
  ImportLineageV1,
  InertItemKindV1,
  InertReasonKeyV1,
  SheetClassificationV1,
} from "../../domain/model/snapshots.js";
import type {
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
  AppId,
} from "../../domain/model/ids.js";
import type { StorageId16 } from "../../domain/model/bytes.js";
import type {
  EnumOptionDefV1,
  FieldDefV1,
  RelationshipDefV1,
  StorageKindV1,
  TableDefV1,
} from "../../domain/model/schema.js";
import type { ValueProvenanceV1 } from "../../domain/model/provenance.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import type {
  ValidationIssueKindV1,
  ValidationSeverityV1,
} from "../../domain/validation/rules.js";
import type {
  EventClassV1,
  EventCommitV1,
  FrontierEntryV1,
} from "../../migrations/004_event_format_v1.js";

/** A validator issue as it enters the projection; `issue_id` is derived there. */
export interface ProjectionIssueInputV1 {
  readonly fieldId: FieldId | null;
  readonly ruleId: RuleId | null;
  readonly kind: ValidationIssueKindV1;
  readonly severity: ValidationSeverityV1;
  readonly messageKey: string;
  readonly messageParameters: Readonly<
    Record<string, string | number | bigint | boolean>
  >;
}

// --- hydration in -----------------------------------------------------------

export interface ProjectionAppStateV1 {
  readonly appId: AppId;
  readonly displayName: string;
  readonly createdAtMs: number;
  readonly lastOpenedAtMs: number | null;
  readonly schemaRevision: bigint;
  readonly locality: "present" | "oversized-local";
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
  readonly declaredRowCount: number | null;
  readonly declaredColumnCount: number | null;
  readonly snapshotRevision: bigint;
}

export interface ProjectionValidationRuleV1 {
  readonly tableId: TableId;
  readonly displayName: string;
  /** IR v1 or v2 (CA-27). */
  readonly rule: RecordRuleIRV1;
  readonly isActive: boolean;
  readonly schemaRevision: bigint;
}

/** One formula definition (CA-25); it never holds a result. */
export interface ProjectionFormulaV1 {
  readonly formula: FormulaDefinitionV1;
  readonly metadata: FormulaMetadataV1;
  readonly isActive: boolean;
  readonly schemaRevision: bigint;
}

/** One chart as the projection holds it (CA-30): never a dataset. */
export type ProjectionChartV1 = ChartStateV1;

export interface ProjectionInertItemV1 {
  readonly inertItemId: InertItemId;
  readonly sheetId: SheetId;
  readonly kind: InertItemKindV1;
  readonly location: string;
  readonly reasonKey: InertReasonKeyV1;
  readonly anchor: CellRangeV1 | null;
  readonly preservedManifestStorageId: StorageId16 | null;
}

/** Only a decision with a kind is projectable (D44's rejection memory). */
export interface ProjectionInferenceDecisionV1 {
  readonly decisionId: DecisionId;
  readonly decisionKind: DecisionKindV1;
  readonly evidenceFingerprint: Uint8Array;
  readonly disposition: InferenceDispositionV1;
  readonly statement: unknown;
  readonly evidence: unknown;
  readonly recordedEventId: EventId;
}

export interface ProjectionRecordV1 {
  readonly record: AuthoredRecordV1;
  readonly recordRevision: bigint;
  readonly createdCommitId: CommitId;
  readonly updatedCommitId: CommitId;
  readonly issues: readonly ProjectionIssueInputV1[];
}

export interface ProjectionRecordPageV1 {
  readonly records: readonly ProjectionRecordV1[];
}

export interface ProjectionCheckpointV1 {
  readonly appId: AppId;
  readonly checkpointStorageId: StorageId16 | null;
  readonly checkpointSemanticSha256: Uint8Array | null;
  readonly frontier: readonly FrontierEntryV1[];
  readonly hydratedAtMs: number;
  readonly appState: ProjectionAppStateV1;
  readonly sheetSnapshots: readonly ProjectionSheetSnapshotV1[];
  readonly tables: readonly TableDefV1[];
  readonly enumOptions: readonly EnumOptionDefV1[];
  readonly relationships: readonly RelationshipDefV1[];
  readonly validationRules: readonly ProjectionValidationRuleV1[];
  readonly formulas: readonly ProjectionFormulaV1[];
  /** Absent means none. */
  readonly charts?: readonly ProjectionChartV1[];
  readonly inertItems: readonly ProjectionInertItemV1[];
  readonly importLineages: readonly ImportLineageV1[];
  readonly inferenceDecisions: readonly ProjectionInferenceDecisionV1[];
  readonly recordPages: readonly ProjectionRecordPageV1[];
}

/**
 * A commit to replay, paired with the caller's typed reading of its payloads.
 * `issuesByEventIndex` is how the one shared validator's verdict reaches the
 * projection: the projection never re-decides one (invariant 5).
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
  readonly issues: readonly ProjectionIssueInputV1[];
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
  readonly issuesByEventIndex?: ReadonlyMap<
    number,
    readonly ProjectionIssueInputV1[]
  >;
  /**
   * The one shared validator, for a commit that changes the schema: every
   * record of a table it touched is re-judged through it once the commit's
   * events have landed. The projection asks; it never decides (invariant 5).
   */
  readonly revalidate?: (
    record: AuthoredRecordV1,
  ) => readonly ProjectionIssueInputV1[];
}

// --- queries out ------------------------------------------------------------

export type ProjectionTableSummaryV1 = Omit<TableDefV1, "fields">;

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

/** A computed cell's result as a read reports it (CA-26). */
export type ProjectionComputedCellV1 =
  | { readonly state: "ok" | "frozen" | "unsupported"; readonly value: CellValueV1 }
  | { readonly state: "type" | "empty" | "cycle" | "unsupported-new-row" }
  | { readonly state: "error"; readonly code: string };

export interface ProjectionRecordSummaryV1 {
  /** The session row key — stable inside one projection, never durable. */
  readonly recordPk: number;
  readonly recordId: RecordId;
  readonly tableId: TableId;
  readonly recordRevision: bigint;
  readonly authoredValues: ReadonlyMap<FieldId, CellValueV1>;
  /** Every active computed column's current result, by the schema's field IDs. */
  readonly computed: ReadonlyMap<FieldId, ProjectionComputedCellV1>;
  readonly blockingIssueCount: number;
  readonly warningIssueCount: number;
}

/** A metric's or dashboard value's current result (D60); ephemeral. */
export interface ProjectionScalarResultV1 {
  readonly formulaId: FormulaId;
  readonly status: "ok" | "empty" | "unsupported" | "cycle" | "error";
  readonly value: CellValueV1 | null;
  readonly code: string | null;
  readonly evaluatedAtMs: number;
}

/** The computed columns a batch of commits re-derived. */
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

/** No total, by contract (CA-14): an exact count comes only from `count(*)`. */
export interface ProjectionRecordPageResultV1 {
  readonly records: readonly ProjectionRecordSummaryV1[];
  readonly hasMore: boolean;
  readonly nextRecordPk: number | null;
}

export interface ProjectionChangeSummaryV1 {
  readonly evidence?: Uint8Array;
  readonly fieldChanges: readonly FieldChangeV1[];
  readonly recordRevision: bigint | null;
  readonly createdCommitId: CommitId | null;
  /** The table the event is about; null for app events. */
  readonly tableId: TableId | null;
}

/** `change_history.subject_kind`, closed by migration 005. */
export type ProjectionSubjectKindV1 =
  | "app"
  | "table"
  | "field"
  | "record"
  | "chart"
  | "rule"
  | "formula"
  | "home"
  | "conflict";

export interface ProjectionChangeEventV1 {
  readonly eventId: EventId;
  readonly commitId: CommitId;
  readonly eventIndex: number;
  readonly eventKind: string;
  readonly eventClass: EventClassV1;
  readonly subjectKind: ProjectionSubjectKindV1;
  readonly subjectId: Uint8Array;
  readonly wallTimeMs: number;
  readonly logicalCounter: number;
  readonly deviceId: DeviceId;
  readonly summary: ProjectionChangeSummaryV1;
  /** The complete restoration payload; present only on a recoverable delete. */
  readonly restoration: AuthoredRecordV1 | null;
}

export interface ProjectionHistoryCursorV1 {
  readonly wallTimeMs: number;
  readonly logicalCounter: number;
  readonly eventId: EventId;
}

export interface ProjectionChangeHistoryPageV1 {
  readonly events: readonly ProjectionChangeEventV1[];
  readonly hasMore: boolean;
  readonly nextCursor: ProjectionHistoryCursorV1 | null;
}

export type ProjectionRelatedParentV1 =
  | {
      readonly status: "resolved";
      readonly recordId: RecordId;
      readonly tableId: TableId;
      readonly label: string;
    }
  | { readonly status: "broken"; readonly originalKey: string | null };

export interface ProjectionLabeledRecordV1 {
  readonly recordPk: number;
  readonly recordId: RecordId;
  readonly label: string;
}

export interface ProjectionRelatedChildrenPageV1 {
  readonly children: readonly ProjectionLabeledRecordV1[];
  readonly hasMore: boolean;
  readonly nextRecordPk: number | null;
}

export interface ProjectionDeletedRecordV1 {
  readonly tableId: TableId;
  readonly restoration: AuthoredRecordV1;
  readonly deletedEventId: EventId;
  readonly deletedAtMs: number;
  readonly keyValue: CellValueV1 | null;
}

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
 * One typed-lane predicate of a records query (CA-29). It names a field and
 * carries **values only** — the projection turns it into a prepared
 * statement and binds every value, so no member can carry SQL. M35's filter
 * compiler produces these from the domain's `FilterV1`.
 */
export type ProjectionFilterTermV1 =
  /** An enum option or a referenced record, by id (`idx_cells_field_id`). */
  | { readonly kind: "id-in"; readonly fieldId: FieldId; readonly ids: readonly Uint8Array[] }
  /** A date (epoch day) or boolean (0/1) lane, inclusive; a null bound is open. */
  | {
      readonly kind: "integer-range";
      readonly fieldId: FieldId;
      readonly min: number | null;
      readonly max: number | null;
    }
  /** Canonical decimals, inclusive; compared through the 20-byte order key, never a float. */
  | {
      readonly kind: "decimal-range";
      readonly fieldId: FieldId;
      readonly min: string | null;
      readonly max: string | null;
    }
  /** Text equality or containment, case-insensitive over NFC (the lane text and the operand both folded). */
  | { readonly kind: "text-equals" | "text-contains"; readonly fieldId: FieldId; readonly text: string }
  /** A reference holding a key or a record that resolves nowhere (D36). */
  | { readonly kind: "reference-broken"; readonly fieldId: FieldId }
  /**
   * Empty means missing or blank. An authored field is judged from its
   * authored value; a computed field from whether it has a result to show.
   */
  | { readonly kind: "is-empty" | "not-empty"; readonly fieldId: FieldId; readonly isComputed: boolean };

/** Which lane a sort reads, by the field's type. */
export type ProjectionSortKeyKindV1 =
  | "text"
  | "decimal"
  | "integer"
  /** An enum sorts by its options' order, not by id. */
  | "option-ordinal"
  /** A reference sorts by its parent's label (else key) field. */
  | "reference-label";

export interface ProjectionRecordSortV1 {
  readonly fieldId: FieldId;
  readonly direction: "asc" | "desc";
  readonly key: ProjectionSortKeyKindV1;
}

/** A row's sort key as SQLite orders it; null is a row with no value (sorted last). */
export type ProjectionSortValueV1 = Uint8Array | number | null;

/** A keyset position: the last row's sort key, then its row key (ties). */
export interface ProjectionQueryCursorV1 {
  readonly recordPk: number;
  readonly sortValue: ProjectionSortValueV1;
}

/**
 * A searched/filtered/sorted page (CA-29, D53). `total` is an exact count of
 * matches, or null when the candidate budget stopped the count — then
 * `partial` states exactly how many candidate rows were examined out of how
 * many the table holds. A partial page never carries a total.
 */
export interface ProjectionRecordQueryResultV1 {
  readonly records: readonly ProjectionRecordSummaryV1[];
  readonly hasMore: boolean;
  /** Pass back as `after`; null when the page ended the scope. */
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
      readonly after: ProjectionHistoryCursorV1 | null;
      readonly limit: number;
    }
  | {
      readonly kind: "record-change-history";
      readonly recordId: RecordId;
      readonly limit: number;
    }
  | {
      readonly kind: "record-is-live";
      readonly tableId: TableId;
      readonly recordId: RecordId;
    }
  | { readonly kind: "list-relationships"; readonly tableId: TableId | null }
  | {
      readonly kind: "related-parent";
      readonly recordId: RecordId;
      readonly fieldId: FieldId;
    }
  | {
      readonly kind: "related-children";
      readonly relationshipId: RelationshipId;
      readonly parentRecordId: RecordId;
      readonly afterRecordPk: number | null;
      readonly limit: number;
    }
  | {
      readonly kind: "count-related-children";
      readonly relationshipId: RelationshipId;
      readonly parentRecordId: RecordId;
    }
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
  /** A table's formulas, or every formula when null. */
  | { readonly kind: "list-formulas"; readonly tableId: TableId | null }
  /** Every metric and dashboard value's current result. */
  | { readonly kind: "scalar-results" }
  /** Every live chart, in display order. */
  | { readonly kind: "list-charts" }
  /** A chart's bounded dataset (CA-30); null when the table is not the app's. */
  | {
      readonly kind: "chart-dataset";
      readonly tableId: TableId;
      readonly filters: readonly ProjectionFilterTermV1[];
      readonly shape: ProjectionChartShapeV1;
      readonly sourceRowBudget: number;
    }
  /**
   * Search ∧ typed filters ∧ one sort over one table (CA-29), examining at
   * most `candidateBudget` candidate rows (D53).
   */
  | {
      readonly kind: "query-records";
      readonly tableId: TableId;
      /** Null or wordless text: no search. */
      readonly search: string | null;
      readonly filters: readonly ProjectionFilterTermV1[];
      /** Null keeps row-key order. */
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

/**
 * One hydrated app, as commands and queries may use it. There is no `open`,
 * no `hydrate`, and no `dispose` here on purpose: a projection's lifetime is
 * the unlocked worker's, and an application-layer caller that could end one
 * could end it while another command was mid-flight.
 */
export interface ProjectionEnginePort {
  execute<K extends ProjectionQueryKindV1>(
    query: Extract<ProjectionQueryV1, { readonly kind: K }>,
  ): ProjectionQueryResultsV1[K];
  /**
   * Replays commits and recalculates, in one transaction; resolves with the
   * computed columns that moved (D60's `recalculated` notice).
   */
  applyEvents(commits: readonly ProjectionCommitV1[]): Promise<ProjectionApplyReceiptV1>;
  /**
   * Re-evaluates the clock-volatile formulas when they were last evaluated
   * more than `maxAgeMs` ago or on another day; resolves with the columns
   * that moved (none when the reading was fresh).
   */
  refreshVolatile(maxAgeMs: number): Promise<readonly FieldId[]>;
}

/** Read-only cursor bound to an isolated, hydrated snapshot in the data worker. */
export interface ProjectionAuthoredStatePort {
  authoredState(signal: AbortSignal): AsyncIterable<Uint8Array>;
}

/** Worker-owned authored snapshot; callers must retain its frontier while reading. */
export interface ProjectionCheckpointExportPort {
  checkpoint(): ProjectionCheckpointV1;
  records(signal: AbortSignal): Iterable<ProjectionRecordV1>;
}
