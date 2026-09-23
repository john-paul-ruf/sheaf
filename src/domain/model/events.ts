/**
 * Typed payloads for the event kinds Sheaf authors (database.md § Event
 * catalog and payload constraints).
 *
 * The kind list in `src/migrations/004_event_format_v1.ts` is closed for event
 * format 1 and stays closed: this module types a **subset** of it — the eleven
 * kinds F02 produces, the nine F04 schema kinds and the two chart kinds — and
 * adds nothing to it.
 * `tests/unit/domain/events.test.ts` asserts every kind named here is one 004
 * already declares.
 *
 * The F04 payloads carry a rule IR (M02), a formula definition (M03) and an
 * impact report (M02). M01 imports nothing outward, so it states those
 * payloads **generically** over the three and never names them:
 * {@link DomainEventOfV1} is instantiated with the real types by M07
 * (`src/application/ports/event-repository.ts`) and M12
 * (`src/persistence/projection/types.ts`), and
 * `tests/unit/workers/projection-port.test.ts` pins the two instantiations
 * equal.
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

import type { ChartDefinitionV1 } from "./charts.js";
import type {
  ChartId,
  EventId,
  FieldId,
  LineageId,
  RecordId,
  SheetId,
  TableId,
} from "./ids.js";
import type { StorageId16 } from "./bytes.js";
import type {
  EnumOptionDefV1,
  FieldDefV1,
  RelationshipDefV1,
  TableDefV1,
} from "./schema.js";
import type { SheetDescriptorV1 } from "./snapshots.js";
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
  /** Empty for a delimited app, which detects none (the F02 payload). */
  readonly relationships: readonly RelationshipDefV1[];
  readonly theme: AppThemeV1;
  /** The import this app was accepted from; null for an authored app. */
  readonly importLineageId: LineageId | null;
  readonly schemaRevision: bigint;
}

export interface TableCreatedPayloadV1 {
  readonly table: TableDefV1;
  /** The imported sheet this table came from, or null when authored. */
  readonly sourceSheetId: SheetId | null;
  /**
   * database.md's "source provenance": the whole sheet descriptor, so a table
   * appended in a tail commit (D38) can build its `sheet_snapshots` row
   * without a checkpoint. Null when authored, and for an F02 payload, which
   * never carried it (the initial import's table lives in the checkpoint).
   */
  readonly sourceSheet: SheetDescriptorV1 | null;
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

// ------------------------------------------------------------ F04 schema --

/**
 * The schema, rule and formula kinds F04 authors (CA-25, CA-27, CA-28). Every
 * one is already in migration 004's closed list. There is still no
 * recalculation kind: a computed value is derived, never authored (invariant
 * 7), so no payload below can carry one.
 */
export const F04_SCHEMA_EVENT_KINDS = Object.freeze([
  "app.renamed",
  "table.changed",
  "field.changed",
  "relationship.changed",
  "relationship.removed",
  "rule.changed",
  "rule.removed",
  "formula.changed",
  "formula.removed",
] as const);

export type F04SchemaEventKindV1 = (typeof F04_SCHEMA_EVENT_KINDS)[number];

/**
 * The two chart kinds (CA-30), also already in migration 004's list. A chart
 * is not schema: saving one moves no schema revision.
 */
export const F04_CHART_EVENT_KINDS = Object.freeze(["chart.saved", "chart.deleted"] as const);

export type F04ChartEventKindV1 = (typeof F04_CHART_EVENT_KINDS)[number];

/** Every kind this build authors or replays. */
export type DomainEventKindV1 = F02EventKindV1 | F04SchemaEventKindV1 | F04ChartEventKindV1;

/** A table's own definition, without its fields (each field has its own events). */
export type TableDefinitionV1 = Omit<TableDefV1, "fields">;

export interface AppRenamedPayloadV1 {
  readonly priorNameSha256: Sha256V1;
  readonly displayName: string;
}

/**
 * Rename, label or key (D64); values are never touched. `Impact` is the
 * counted impact MOD-014 previewed — never the values it counted (CA-12).
 */
export interface TableChangedPayloadV1<Impact> {
  readonly priorSha256: Sha256V1;
  readonly before: TableDefinitionV1;
  readonly after: TableDefinitionV1;
  readonly impact: Impact;
}

/** The table and field IDs never change; everything else may (D57). */
export interface FieldChangedPayloadV1<Impact> {
  readonly before: FieldDefV1;
  readonly after: FieldDefV1;
  readonly impact: Impact;
}

export interface RelationshipChangedPayloadV1 {
  /** The complete endpoints and detection source after the change. */
  readonly relationship: RelationshipDefV1;
  /** Hash of the definition this replaces; null when it is new. */
  readonly priorSha256: Sha256V1 | null;
}

export interface RelationshipRemovedPayloadV1 {
  readonly relationship: RelationshipDefV1;
  /** The rejection evidence that keeps re-detection suppressed (FR-7), if any. */
  readonly rejectionFingerprint: Sha256V1 | null;
}

export interface RuleChangedPayloadV1<Rule> {
  readonly tableId: TableId;
  readonly displayName: string;
  /** The complete rule IR (v1 or v2), message parameters included. */
  readonly rule: Rule;
  readonly priorSha256: Sha256V1 | null;
}

export interface RuleRemovedPayloadV1<Rule, Impact> {
  readonly tableId: TableId;
  readonly displayName: string;
  readonly rule: Rule;
  readonly impact: Impact;
}

/** Where a formula came from, and what happens to the values an import kept. */
export const FORMULA_SOURCES = Object.freeze(["authored", "imported"] as const);
export type FormulaSourceV1 = (typeof FORMULA_SOURCES)[number];

export const FORMULA_IMPORTED_VALUE_POLICIES = Object.freeze([
  /** Nothing was imported for it: an authored formula. */
  "none",
  /** Frozen or unsupported: each imported value stays an authored literal (D51). */
  "kept-as-literal",
] as const);
export type FormulaImportedValuePolicyV1 = (typeof FORMULA_IMPORTED_VALUE_POLICIES)[number];

export interface FormulaFunctionVersionV1 {
  readonly name: string;
  readonly version: number;
}

/** `formulas.metadata_cbor` (CA-25): versions, source and imported-value policy. */
export interface FormulaMetadataV1 {
  readonly catalogVersion: number;
  /** Each catalog function the IR calls, once, at the version it was translated against. */
  readonly functionVersions: readonly FormulaFunctionVersionV1[];
  readonly source: FormulaSourceV1;
  readonly importedValuePolicy: FormulaImportedValuePolicyV1;
}

/** CA-25: the definition (M03's) and its metadata. Never an evaluated value. */
export interface FormulaChangedPayloadV1<Formula> {
  readonly formula: Formula;
  readonly metadata: FormulaMetadataV1;
  readonly priorSha256: Sha256V1 | null;
}

/** Authored literals remain; no result is materialized (database.md). */
export interface FormulaRemovedPayloadV1<Formula, Impact> {
  readonly formula: Formula;
  readonly metadata: FormulaMetadataV1;
  readonly impact: Impact;
}

// ------------------------------------------------------------- F04 charts --

/** migration 005's `charts.provenance` CHECK: rebuilt from a workbook, or made here. */
export const CHART_PROVENANCES = Object.freeze(["imported", "user"] as const);
export type ChartProvenanceV1 = (typeof CHART_PROVENANCES)[number];

/**
 * One chart as it stands: its definition and the facts the `charts` row keeps
 * beside it. `displayName` and `pinned` repeat the definition's own `name`
 * and `pinned` (database.md names both columns); the codec refuses a pair
 * that disagrees.
 */
export interface ChartStateV1 {
  readonly definition: ChartDefinitionV1;
  readonly displayName: string;
  readonly pinned: boolean;
  /** Display order; unique among the app's charts. */
  readonly ordinal: number;
  readonly provenance: ChartProvenanceV1;
  /** The stale-builder guard: 0 at the first save, +1 at every later one. */
  readonly chartRevision: bigint;
}

/** `chart.saved` (CA-30): the complete definition, never a delta. */
export interface ChartSavedPayloadV1 extends ChartStateV1 {
  readonly chartId: ChartId;
  /** Hash of the definition this save replaces; null for a new chart. */
  readonly priorSha256: Sha256V1 | null;
}

/** `chart.deleted`: everything the chart was, so the audit can say so. */
export interface ChartDeletedPayloadV1 {
  readonly chartId: ChartId;
  readonly prior: ChartStateV1;
}

export interface F04ChartEventPayloadsV1 {
  readonly "chart.saved": ChartSavedPayloadV1;
  readonly "chart.deleted": ChartDeletedPayloadV1;
}

/**
 * The nine F04 payloads, over the rule IR, formula definition and impact
 * report types the instantiating layer supplies (see the file comment).
 */
export interface F04SchemaEventPayloadsV1<Rule, Formula, Impact> {
  readonly "app.renamed": AppRenamedPayloadV1;
  readonly "table.changed": TableChangedPayloadV1<Impact>;
  readonly "field.changed": FieldChangedPayloadV1<Impact>;
  readonly "relationship.changed": RelationshipChangedPayloadV1;
  readonly "relationship.removed": RelationshipRemovedPayloadV1;
  readonly "rule.changed": RuleChangedPayloadV1<Rule>;
  readonly "rule.removed": RuleRemovedPayloadV1<Rule, Impact>;
  readonly "formula.changed": FormulaChangedPayloadV1<Formula>;
  readonly "formula.removed": FormulaRemovedPayloadV1<Formula, Impact>;
}

/**
 * Every authored or replayed event: F02's eleven kinds, F04's nine schema
 * kinds and its two chart kinds, each paired with exactly its own payload.
 */
export type DomainEventOfV1<Rule, Formula, Impact> = {
  [K in DomainEventKindV1]: {
    readonly kind: K;
    readonly payload: (F02EventPayloadsV1 &
      F04SchemaEventPayloadsV1<Rule, Formula, Impact> &
      F04ChartEventPayloadsV1)[K];
  };
}[DomainEventKindV1];
