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
  F02DomainEventV1,
  FieldChangeV1,
  Sha256V1,
} from "../../domain/model/events.js";
import type {
  AppId,
  CommitId,
  DeviceId,
  EventId,
  FieldId,
  RecordId,
  RuleId,
  SheetId,
  TableId,
} from "../../domain/model/ids.js";
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

/** SHA-256 over exact bytes; M08's `sha256` satisfies it (M09's convention). */
export type Sha256Fn = (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;

export const SHEET_CLASSIFICATIONS = Object.freeze([
  "table",
  "lookup",
  "summary",
  "chart",
  "snapshot",
] as const);

export type SheetClassificationV1 = (typeof SHEET_CLASSIFICATIONS)[number];

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
  readonly rule: ValidationRuleIR;
  readonly isActive: boolean;
  readonly schemaRevision: bigint;
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
  readonly validationRules: readonly ProjectionValidationRuleV1[];
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
export interface ProjectionCommitV1 {
  readonly commit: EventCommitV1;
  readonly events: readonly F02DomainEventV1[];
}

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

export interface ProjectionRecordSummaryV1 {
  /** The session row key. Stable within one projection; never durable. */
  readonly recordPk: number;
  readonly recordId: RecordId;
  readonly tableId: TableId;
  readonly recordRevision: bigint;
  /** Complete authored state, including the values that have no typed lane. */
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
  readonly fieldChanges: readonly FieldChangeV1[];
  /** The record revision this event left behind, for record events. */
  readonly recordRevision: bigint | null;
  /** The commit that first created the subject record, where one applies. */
  readonly createdCommitId: CommitId | null;
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
}
