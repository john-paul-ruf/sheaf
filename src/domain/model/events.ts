/**
 * Typed payloads for the event kinds F02 authors (database.md § Event catalog
 * and payload constraints).
 *
 * The kind list in `src/migrations/004_event_format_v1.ts` is closed for event
 * format 1 and stays closed: this module types a **subset** of it — the eleven
 * kinds this feature can actually produce — and adds nothing to it.
 * `tests/unit/domain/events.test.ts` asserts every kind named here is one 004
 * already declares.
 *
 * Two catalog rules are held by the types rather than by review:
 *
 * - `record.patched` carries a **sparse** change map in which each entry
 *   states both the before and the after value, so an unchanged value is never
 *   duplicated into history and a patch can always be read backwards.
 * - `record.deleted` carries the **complete** restoration payload, which is
 *   what makes delete recoverable (FR-12); a delete that only named the record
 *   would not be expressible here.
 *
 * Events that must not exist have no type either — there is no recalculation,
 * last-opened, reminder, or last-write-wins payload in this file, and adding
 * one would require a forward event-format migration first.
 */

import type {
  EventId,
  FieldId,
  LineageId,
  RecordId,
  SheetId,
  TableId,
} from "./ids.js";
import type { StorageId16 } from "./bytes.js";
import type { EnumOptionDefV1, FieldDefV1, TableDefV1 } from "./schema.js";
import type { ValueProvenanceV1 } from "./provenance.js";
import type { CellValueV1 } from "./values.js";

export const F02_EVENT_KINDS = Object.freeze([
  "app.created",
  "table.created",
  "field.created",
  "enum.changed",
  "record.created",
  "record.patched",
  "record.deleted",
  "record.restored",
  "theme.changed",
  "inference-decision.recorded",
  "import.accepted",
] as const);

export type F02EventKindV1 = (typeof F02_EVENT_KINDS)[number];

/** SHA-256 of the exact canonical bytes the field names; always 32 bytes. */
export type Sha256V1 = Uint8Array;

/** A complete authored record: every field's value and where it came from. */
export interface AuthoredRecordV1 {
  readonly recordId: RecordId;
  readonly tableId: TableId;
  readonly values: ReadonlyMap<FieldId, CellValueV1>;
  readonly provenance: ReadonlyMap<FieldId, ValueProvenanceV1>;
}

/** One field's movement inside a patch: both ends, never just the new one. */
export interface FieldChangeV1 {
  readonly fieldId: FieldId;
  readonly before: CellValueV1;
  readonly after: CellValueV1;
  readonly provenance: ValueProvenanceV1;
}

/**
 * The semantic per-app theme (design.md § Per-app theming contract). Safety
 * semantics — danger, warning, success, focus visibility — are system-owned
 * and deliberately absent: a theme cannot make them ambiguous.
 */
export const APP_THEME_TOKENS = Object.freeze([
  "app-ink",
  "app-canvas",
  "app-surface",
  "app-primary",
  "app-accent",
  "app-muted",
] as const);

export type AppThemeTokenV1 = (typeof APP_THEME_TOKENS)[number];

export interface AppThemeV1 {
  /** Names the built-in theme this app started from (FR-17, F02 partial). */
  readonly themeKey: string;
  readonly tokens: Readonly<Record<AppThemeTokenV1, string>>;
}

export interface AppCreatedPayloadV1 {
  readonly displayName: string;
  /** The initial schema: complete table definitions with their fields. */
  readonly tables: readonly TableDefV1[];
  readonly enumOptions: readonly EnumOptionDefV1[];
  readonly theme: AppThemeV1;
  /** The import this app was accepted from; null for an authored app. */
  readonly importLineageId: LineageId | null;
  readonly schemaRevision: bigint;
}

export interface TableCreatedPayloadV1 {
  readonly table: TableDefV1;
  /** The imported sheet this table came from, or null when authored. */
  readonly sourceSheetId: SheetId | null;
}

export interface FieldCreatedPayloadV1 {
  readonly field: FieldDefV1;
  /** Why this field has this type; canonically encodable review evidence. */
  readonly evidence: unknown;
}

export interface EnumChangedPayloadV1 {
  readonly fieldId: FieldId;
  /** Hash of the option set being replaced; null when the field had none. */
  readonly priorOptionSetSha256: Sha256V1 | null;
  /** The complete resulting option set, not a delta. */
  readonly options: readonly EnumOptionDefV1[];
}

export interface RecordCreatedPayloadV1 {
  readonly record: AuthoredRecordV1;
  /**
   * True only for an imported record the shared validator rejected, whose
   * values are preserved and flagged rather than dropped (FR-4). An authored
   * write can never set it: the validator must pass first.
   */
  readonly importedInvalid: boolean;
}

export interface RecordPatchedPayloadV1 {
  readonly recordId: RecordId;
  readonly tableId: TableId;
  readonly recordRevision: bigint;
  /** Sparse: only the fields that moved. */
  readonly changes: readonly FieldChangeV1[];
  readonly resultingRecordSha256: Sha256V1;
}

export const DELETION_SOURCES = Object.freeze([
  "user",
  "conflict-resolution",
] as const);

export type DeletionSourceV1 = (typeof DELETION_SOURCES)[number];

export interface RecordDeletedPayloadV1 {
  readonly recordId: RecordId;
  readonly tableId: TableId;
  readonly priorRecordRevision: bigint;
  /** Everything needed to bring the record back; never purged in v1. */
  readonly restoration: AuthoredRecordV1;
  readonly source: DeletionSourceV1;
}

export interface RecordRestoredPayloadV1 {
  /** The `record.deleted` event this undoes. */
  readonly deletedEventId: EventId;
  readonly record: AuthoredRecordV1;
}

export interface ThemeChangedPayloadV1 {
  /** Null at the first write, when the app had no prior theme. */
  readonly before: AppThemeV1 | null;
  readonly after: AppThemeV1;
}

export const INFERENCE_DISPOSITIONS = Object.freeze([
  "accepted",
  "rejected",
  "edited",
] as const);

export type InferenceDispositionV1 = (typeof INFERENCE_DISPOSITIONS)[number];

export interface InferenceDecisionPayloadV1 {
  /** Identifies the evidence, so a re-import does not re-propose a rejection. */
  readonly evidenceFingerprint: Sha256V1;
  readonly statement: unknown;
  readonly evidence: unknown;
  readonly disposition: InferenceDispositionV1;
}

export interface ImportAcceptedPayloadV1 {
  readonly lineageId: LineageId;
  /** Encrypted durable roots written by promotion (CA-11, S04). */
  readonly sourceManifestStorageId: StorageId16;
  readonly snapshotManifestStorageId: StorageId16;
  readonly checkpointManifestStorageId: StorageId16;
  readonly originalBaselineStorageId: StorageId16;
  /** The accepted proposal and the evidence behind it. */
  readonly evidenceLedger: unknown;
  readonly acceptedSchemaRevision: bigint;
}

export interface F02EventPayloadsV1 {
  readonly "app.created": AppCreatedPayloadV1;
  readonly "table.created": TableCreatedPayloadV1;
  readonly "field.created": FieldCreatedPayloadV1;
  readonly "enum.changed": EnumChangedPayloadV1;
  readonly "record.created": RecordCreatedPayloadV1;
  readonly "record.patched": RecordPatchedPayloadV1;
  readonly "record.deleted": RecordDeletedPayloadV1;
  readonly "record.restored": RecordRestoredPayloadV1;
  readonly "theme.changed": ThemeChangedPayloadV1;
  readonly "inference-decision.recorded": InferenceDecisionPayloadV1;
  readonly "import.accepted": ImportAcceptedPayloadV1;
}

/** A kind paired with exactly its own payload; no other pairing type-checks. */
export type F02DomainEventV1 = {
  [K in F02EventKindV1]: {
    readonly kind: K;
    readonly payload: F02EventPayloadsV1[K];
  };
}[F02EventKindV1];
