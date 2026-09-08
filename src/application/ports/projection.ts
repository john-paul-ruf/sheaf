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
 * - **The query surface is closed.** {@link ProjectionQueryV1} is a union of
 *   eleven members and no member carries SQL, so no caller — and no user text
 *   travelling through one — can reach a statement.
 * - **`applyEvents` takes the raw commit and the caller's typed events
 *   together.** The engine verifies they agree index for index; supplying a
 *   payload that does not match the commit it rides on is refused rather than
 *   trusted (S02 surprise 2).
 */

import type {
  AuthoredRecordV1,
  F02DomainEventV1,
  FieldChangeV1,
  AppThemeV1,
} from "../../domain/model/events.js";
import type {
  CommitId,
  DeviceId,
  EventId,
  FieldId,
  RecordId,
  RuleId,
  SheetId,
  TableId,
  AppId,
} from "../../domain/model/ids.js";
import type { StorageId16 } from "../../domain/model/bytes.js";
import type {
  EnumOptionDefV1,
  FieldDefV1,
  StorageKindV1,
  TableDefV1,
} from "../../domain/model/schema.js";
import type { ValueProvenanceV1 } from "../../domain/model/provenance.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import type {
  ValidationIssueKindV1,
  ValidationRuleIR,
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
  readonly classification: readonly (
    | "table"
    | "lookup"
    | "summary"
    | "chart"
    | "snapshot"
  )[];
  readonly snapshotManifestStorageId: StorageId16;
  readonly declaredRowCount: number | null;
  readonly declaredColumnCount: number | null;
  readonly snapshotRevision: bigint;
}

export interface ProjectionValidationRuleV1 {
  readonly tableId: TableId;
  readonly displayName: string;
  readonly rule: ValidationRuleIR;
  readonly isActive: boolean;
  readonly schemaRevision: bigint;
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
  readonly validationRules: readonly ProjectionValidationRuleV1[];
  readonly recordPages: readonly ProjectionRecordPageV1[];
}

/**
 * A commit to replay, paired with the caller's typed reading of its payloads.
 * `issuesByEventIndex` is how the one shared validator's verdict reaches the
 * projection: the projection never re-decides one (invariant 5).
 */
export interface ProjectionCommitV1 {
  readonly commit: EventCommitV1;
  readonly events: readonly F02DomainEventV1[];
  readonly issuesByEventIndex?: ReadonlyMap<
    number,
    readonly ProjectionIssueInputV1[]
  >;
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

export interface ProjectionRecordSummaryV1 {
  /** The session row key — stable inside one projection, never durable. */
  readonly recordPk: number;
  readonly recordId: RecordId;
  readonly tableId: TableId;
  readonly recordRevision: bigint;
  readonly authoredValues: ReadonlyMap<FieldId, CellValueV1>;
  readonly blockingIssueCount: number;
  readonly warningIssueCount: number;
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
  readonly fieldChanges: readonly FieldChangeV1[];
  readonly recordRevision: bigint | null;
  readonly createdCommitId: CommitId | null;
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
  applyEvents(commits: readonly ProjectionCommitV1[]): Promise<void>;
}
