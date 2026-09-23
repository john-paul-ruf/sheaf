/**
 * Promotion: a reviewed proposal becomes a durable app, or nothing (M23;
 * CA-11, CA-19, CA-20, CA-22; database.md § Import staging promotion order).
 *
 * The four steps are the contract, in this order:
 *
 * 1. **Validate and allocate.** The reviewed proposal's schema — tables,
 *    fields, options, relationships (S03's endpoint rule) — goes through the
 *    shared validator, then every record goes through `validateRecord` with the
 *    real resolver predicate (invariant 5). Records are built in **two passes**
 *    over the staged facts: pass 1 allocates the `RecordId`s of every table
 *    with a key and maps each *parent* table's key text to its record; pass 2
 *    builds every record, turning a child's key into `reference{recordId}` when
 *    the parent has it and into `invalid-preserved{sourceText: key}` when it
 *    does not (D36) — kept, and flagged as a broken reference. A refusal is a
 *    typed **result** (D23): nothing has been written.
 * 2. **Build outside the transaction.** Record pages, the checkpoint with its
 *    F03 roots (D37), one snapshot per selected sheet (D39/D41), the source
 *    manifest, the baseline, explicit-empty conflict and audit roots, and the
 *    one import-class commit are all encoded and sealed before the write opens.
 * 3. **One transaction** adds them, wraps the app key, swaps the catalog, and
 *    tickets the temporaries.
 * 4. **Acknowledge after commit.**
 *
 * **Memory bound for the key maps.** Pass 1 holds, per keyed table, one
 * `RecordId` per data row, and per parent table one entry per distinct key
 * text. Both are bounded by the rows promotion builds anyway — at most the
 * D31 budget of 250,000 estimated cells across the selected sheets, so at most
 * 250,000 key entries of (key text + 16 bytes).
 *
 * **The commit/checkpoint split (CA-11), as implemented.** The import commit
 * carries the schema-establishing events — `app.created` (with its
 * relationships), one `table.created` per table (with its sheet descriptor),
 * `field.created`, `enum.changed`, `inference-decision.recorded` for edited and
 * rejected statements, and `import.accepted` last — and **no
 * `record.created`**: the imported rows are the initial checkpoint's pages. The
 * decisions and the lineage are materialized in the checkpoint too, because a
 * checkpoint-covered commit is never replayed.
 */

import {
  asStorageId16,
  decodeStorageId16,
  encodeStorageId16,
  type StorageId16,
} from "../../domain/model/bytes.js";
import {
  compareDomainIds,
  createDomainId,
  encodeDomainId,
  type AppId,
  type CommitId,
  type DeviceId,
  type EventId,
  type FieldId,
  type LineageId,
  type OptionId,
  type RecordId,
  type SheetId,
  type TableId,
} from "../../domain/model/ids.js";
import type { AppThemeV1 } from "../../domain/model/events.js";
import type {
  EnumOptionDefV1,
  FieldDefV1,
  RelationshipDefV1,
  TableDefV1,
} from "../../domain/model/schema.js";
import {
  INERT_REASON_KEYS,
  type ImportLineageV1,
  type InertItemV1,
  type InertReasonKeyV1,
  type InferenceDecisionRecordV1,
  type SheetDescriptorV1,
} from "../../domain/model/snapshots.js";
import { validateSchema } from "../../domain/validation/schema-checks.js";
import {
  validateRecord,
  type ReferenceResolver,
  type ValidationContext,
} from "../../domain/validation/validate-record.js";
import type { RuleConditionV1, ValidationReport } from "../../domain/validation/rules.js";
import {
  BLANK_VALUE,
  MISSING_VALUE,
  invalidPreservedValue,
  type CellValueV1,
} from "../../domain/model/values.js";
import type { DomainEventV1 } from "../../migrations/004_event_format_v1.js";
import type { EnvelopeFrameV1 } from "../../migrations/003_envelope_format_v1.js";
import type { EntropyPort } from "../../application/ports/entropy.js";
import type { ClockPort } from "../../application/ports/clock.js";
import type { EnvelopeKeyRefV1 } from "../../application/ports/envelope-crypto.js";
import type { PreservedReasonKeyV1, WorkbookFactStreamItemV2 } from "../facts/index.js";
import { PRESERVED_REASON_KEYS } from "../facts/index.js";
import { delimitedStream } from "../inference/infer.js";
import { decisionKindOf, workbookStatementIdOf, type WorkbookStatementV1 } from "../inference/statements.js";
import { sourceTextToCellValue } from "../inference/values.js";
import { tableRowExtents } from "../inference/workbook.js";
import type {
  ProposedRuleConditionV1,
  ProposedSheetV1,
  ProposedTableV2,
  ProposedWorkbookFieldV1,
  ProposedWorkbookV1,
  SheetRoleV1,
} from "../inference/workbook-proposal.js";
import { encodeSheetSnapshotManifest } from "../snapshots/sheet-snapshot.js";
import { SheetSnapshotWriter } from "../snapshots/sheet-writer.js";
import {
  chunkedSourceDigest,
  encodeSourceManifest,
  type ManifestChunkRefV1,
} from "../snapshots/source-chunks.js";
import { DEFAULT_APP_THEME, accentForApp, glyphForApp } from "./theme.js";
import {
  encodeAppHead,
  encodeAppHeadBody,
  encodeBaselinePage,
  encodeCheckpointBody,
  encodeCheckpointManifest,
  encodeRecordPage,
  compareRecordKeys,
  baselinePageEntryByteLength,
  recordPageEntryByteLength,
  PAGE_MAX_DECODED_BYTES,
  RECORD_PAGE_MAX_RECORDS,
  type AppHeadV1,
  type BaselineEntryV1,
  type CheckpointManifestV1,
  type CheckpointValidationRuleV1,
  type PageRefV1,
  type StorageRefV1,
  type StoredRecordV1,
} from "./roots.js";
import { decisionEvidence, decisionStatement, encodeImportEventPayload } from "./events.js";
import type { LoadedImportStageV1, StagingPortsV1 } from "./lifecycle.js";
import { readProvisionalKeyBytes, stagedChunkStorageIds } from "./lifecycle.js";
import { RowPlan, sourceTextAt, walkRows, type PlannedRowV1 } from "./row-plan.js";
import { cborMap } from "./proposal-codec.js";
import { EMPTY_IMPORT_CHAIN, sealImportCommit } from "./import-commit.js";
import { serializeEnvelopeTransport } from "../../persistence/codecs/envelope-frame.js";

const ID_BYTES = 16;
const STORAGE_ID_BYTES = 16;

/**
 * Promotion refuses for reasons a person can act on; each is a closed token.
 * `append-too-large` is an append's alone (D38, D42): the one commit it would
 * write does not fit one event segment.
 */
export const PROMOTION_REJECTIONS = Object.freeze([
  "schema-invalid",
  "record-invalid",
  "no-proposal",
  "empty-table",
  "append-too-large",
] as const);

export type PromotionRejectionV1 = (typeof PROMOTION_REJECTIONS)[number];

export interface PromotionReceiptV1 {
  readonly appId: AppId;
  readonly appHeadStorageId: string;
  readonly rowCount: number;
  readonly tableCount: number;
  readonly transactionRevision: number;
  /** Rows kept and flagged rather than refused (FR-4). */
  readonly flaggedRecordCount: number;
}

/** A refused promotion or append: nothing was written. */
export interface PromotionRejectedV1 {
  readonly kind: "rejected";
  readonly reason: PromotionRejectionV1;
  readonly report: ValidationReport | null;
  /**
   * The reviewed column each field the report names was allocated for, keyed
   * by `encodeDomainId(fieldId)`. The refused promotion minted those field ids
   * and wrote nothing, so the column key is the only name the review knows.
   */
  readonly columnKeys: ReadonlyMap<string, string>;
}

export type PromotionResultV1 = { readonly kind: "promoted"; readonly receipt: PromotionReceiptV1 } | PromotionRejectedV1;

/** A rejection; with the allocated schema when the report names its fields. */
export function rejectedPromotion(
  reason: PromotionRejectionV1,
  report: ValidationReport | null = null,
  schema: Pick<AllocatedSchemaV2, "tables"> | null = null,
): PromotionRejectedV1 {
  const columnKeys = new Map(
    (schema?.tables ?? []).flatMap((plan) =>
      plan.fields.map((entry) => [encodeDomainId(entry.definition.fieldId), entry.proposed.columnKey] as const),
    ),
  );
  return { kind: "rejected", reason, report, columnKeys };
}

export interface PromoteInputV1 {
  readonly loaded: LoadedImportStageV1;
  /** The staged stream, in order; walked twice for records and once for snapshots. */
  readonly facts: readonly WorkbookFactStreamItemV2[];
  /** The source bytes, already chunked and staged, in order. */
  readonly sourceChunks: readonly ManifestChunkRefV1[];
  readonly acceptedName: string;
  readonly deviceId: DeviceId;
}

/**
 * M65's preserved-part reasons, as M01's durable inert reasons (auto-decision
 * (a)): total over the adapter vocabulary, so every preserved part lands on a
 * reason the app can state. Pivots, like charts, are rebuilt live in F04
 * (D45); drawings, images, objects and controls are never rendered; links,
 * external sources and connections are never fetched; a comment stays in the
 * source as its text.
 */
export const INERT_REASON_OF: Readonly<Record<PreservedReasonKeyV1, InertReasonKeyV1>> = Object.freeze({
  "formula-not-live-yet": "formula-not-live-yet",
  "chart-not-live-yet": "chart-not-live-yet",
  "pivot-not-live-yet": "chart-not-live-yet",
  "visual-only": "object-not-rendered",
  "note-kept-as-text": "kept-in-source",
  "link-not-followed": "link-not-followed",
  "external-source-not-fetched": "link-not-followed",
  "object-not-opened": "object-not-rendered",
  "control-not-run": "object-not-rendered",
  "connection-not-refreshed": "link-not-followed",
  "formatting-not-reproduced": "formatting-not-reproduced",
  "script-not-run": "script-never-runs",
  "validation-not-expressible": "validation-not-expressible",
});

// Every key and value is a member of its closed list, or this module does not load.
for (const key of PRESERVED_REASON_KEYS) {
  if (!(INERT_REASON_KEYS as readonly string[]).includes(INERT_REASON_OF[key])) {
    throw new Error("an inert reason mapping names a reason M01 does not have");
  }
}

// ------------------------------------------------------ schema construction --

const SCHEMA_REVISION_AFTER = 1n;

export interface FieldPlanV1 {
  readonly proposed: ProposedWorkbookFieldV1;
  readonly definition: FieldDefV1;
  readonly optionIds: ReadonlyMap<string, OptionId>;
}

export interface TablePlanV1 {
  /** The table promoted on its own. */
  readonly head: ProposedTableV2;
  /** Tables whose rows join it (spacer merges, FR-4). */
  readonly joined: readonly ProposedTableV2[];
  readonly table: TableDefV1;
  readonly fields: readonly FieldPlanV1[];
}

export interface SheetPlanV1 {
  readonly proposed: ProposedSheetV1;
  readonly sheetId: SheetId;
  readonly ordinal: number;
}

export interface AllocatedSchemaV2 {
  readonly sheets: readonly SheetPlanV1[];
  readonly tables: readonly TablePlanV1[];
  readonly enumOptions: readonly EnumOptionDefV1[];
  readonly relationships: readonly RelationshipDefV1[];
  /** Parent table key → the relationship that points at it, by child column key. */
  readonly relationshipByChildColumn: ReadonlyMap<string, { readonly toTableKey: string }>;
  readonly rules: readonly CheckpointValidationRuleV1[];
}

const roleOf = (role: ProposedSheetV1["classification"][number]): role is SheetRoleV1 => role !== "excluded";

/**
 * Allocates every identity the reviewed proposal needs: sheets (selected only,
 * D39), tables (joined tables promote as part of their head), fields, enum
 * options, applied relationships, and record rules.
 */
export function allocateSchema(
  entropy: EntropyPort,
  proposal: ProposedWorkbookV1,
  options: { readonly firstTableOrdinal?: number; readonly schemaRevision?: bigint } = {},
): AllocatedSchemaV2 {
  const schemaRevision = options.schemaRevision ?? SCHEMA_REVISION_AFTER;
  const sheets: SheetPlanV1[] = proposal.sheets
    .filter((sheet) => sheet.isSelected)
    .map((proposed, ordinal) => ({ proposed, sheetId: createDomainId("sheet", entropy), ordinal }));
  const sheetIdOf = (sheetKey: string): SheetId | null =>
    sheets.find((sheet) => sheet.proposed.sheetKey === sheetKey)?.sheetId ?? null;

  const enumOptions: EnumOptionDefV1[] = [];
  const heads = proposal.tables.filter((table) => table.joinedToTableKey === null);
  const tables: TablePlanV1[] = heads.map((head, index) => {
    const tableId = createDomainId("table", entropy);
    const fields = head.fields.map((proposed, fieldOrdinal): FieldPlanV1 => {
      const fieldId = createDomainId("field", entropy);
      const optionIds = new Map<string, OptionId>();
      if (proposed.type.kind === "enum") {
        proposed.enumOptions.forEach((option, optionOrdinal) => {
          const optionId = createDomainId("option", entropy);
          optionIds.set(option.label, optionId);
          enumOptions.push({
            optionId,
            fieldId,
            displayLabel: option.label,
            optionOrdinal,
            isActive: true,
            schemaRevision,
          });
        });
      }
      return {
        proposed,
        optionIds,
        definition: {
          fieldId,
          tableId,
          displayName: proposed.fieldName,
          fieldOrdinal,
          type: proposed.type,
          // An imported column is never required: a required field would refuse
          // rows the file actually contains, and FR-4 keeps them instead.
          isRequired: false,
          isActive: true,
          schemaRevision,
        },
      };
    });
    const fieldOf = (columnKey: string | null): FieldId | null =>
      fields.find((entry) => entry.proposed.columnKey === columnKey)?.definition.fieldId ?? null;
    return {
      head,
      joined: proposal.tables.filter((table) => table.joinedToTableKey === head.tableKey),
      fields,
      table: {
        tableId,
        displayName: head.tableName,
        tableOrdinal: (options.firstTableOrdinal ?? 0) + index,
        fields: fields.map((entry) => entry.definition),
        keyFieldId: fieldOf(head.keyColumnKey),
        labelFieldId: fieldOf(head.labelColumnKey),
        sourceSheetId: sheetIdOf(head.sheetKey),
        isActive: true,
        schemaRevision,
      },
    };
  });

  const planOf = (tableKey: string): TablePlanV1 | undefined =>
    tables.find((plan) => plan.head.tableKey === tableKey || plan.joined.some((table) => table.tableKey === tableKey));
  const fieldIn = (plan: TablePlanV1 | undefined, columnKey: string): FieldPlanV1 | undefined => {
    const column = plan?.joined.flatMap((table) => table.fields).find((entry) => entry.columnKey === columnKey)?.columnIndex;
    return plan?.fields.find((entry) => entry.proposed.columnKey === columnKey || entry.proposed.columnIndex === column);
  };

  const relationships: RelationshipDefV1[] = [];
  const relationshipByChildColumn = new Map<string, { readonly toTableKey: string }>();
  for (const relationship of proposal.relationships) {
    if (!relationship.isApplied) continue;
    const from = planOf(relationship.fromTableKey);
    const to = planOf(relationship.toTableKey);
    const fromField = fieldIn(from, relationship.fromColumnKey);
    const toField = fieldIn(to, relationship.toColumnKey);
    if (from === undefined || to === undefined || fromField === undefined || toField === undefined) {
      throw new Error("an applied relationship names a table or column the proposal does not have");
    }
    relationships.push({
      relationshipId: createDomainId("relationship", entropy),
      fromTableId: from.table.tableId,
      fromFieldId: fromField.definition.fieldId,
      toTableId: to.table.tableId,
      // S03's endpoint rule: the target is **the** parent's key. A review that
      // moved the key away from this column fails `validateSchema` below.
      toKeyFieldId: toField.definition.fieldId,
      detectionSource: relationship.detectionSource,
      isActive: true,
      schemaRevision,
    });
    relationshipByChildColumn.set(`${from.head.tableKey}|${fromField.proposed.columnKey}`, {
      toTableKey: to.head.tableKey,
    });
  }

  const rules: CheckpointValidationRuleV1[] = proposal.recordRules.flatMap((rule) => {
    const plan = planOf(rule.tableKey);
    const target = fieldIn(plan, rule.columnKey);
    if (plan === undefined || target === undefined) return [];
    const condition = (proposed: ProposedRuleConditionV1): RuleConditionV1 =>
      proposed.kind === "field-equals"
        ? { kind: "field-equals", fieldId: (fieldIn(plan, proposed.columnKey) ?? target).definition.fieldId, value: proposed.value }
        : { kind: "not", condition: condition(proposed.condition) };
    return [
      {
        tableId: plan.table.tableId,
        displayName: target.definition.displayName,
        rule: {
          irVersion: 1,
          ruleId: createDomainId("rule", entropy),
          condition: condition(rule.condition),
          // An imported validation flags the rows that break it; it never
          // refuses a row the file already holds (FR-4).
          severity: "warning",
          messageKey: "validation.record-rule",
          messageParameters: { fieldLabel: target.definition.displayName },
        },
        isActive: rule.isActive,
        schemaRevision,
      },
    ];
  });

  return { sheets, tables, enumOptions, relationships, relationshipByChildColumn, rules };
}

// ------------------------------------------------------ record construction --

interface BuiltRecordsV2 {
  readonly records: readonly StoredRecordV1[];
  readonly flaggedCount: number;
  readonly firstBlockingReport: ValidationReport | null;
}

/** The facts a row plan reads: a delimited file without its one sheet fact, as inference read it. */
const planningStream = (proposal: ProposedWorkbookV1, facts: readonly WorkbookFactStreamItemV2[]) =>
  proposal.isDelimited ? [...delimitedStream(facts)] : facts;

/** Every table a row belongs to, head-mapped: which promoted table takes it. */
const planFor = (schema: AllocatedSchemaV2, table: ProposedTableV2): TablePlanV1 | undefined =>
  schema.tables.find((plan) => plan.head === table || plan.joined.includes(table));

const contextFor = (
  schema: AllocatedSchemaV2,
  plan: TablePlanV1,
  referenceExists: ReferenceResolver,
): ValidationContext => {
  const tableKey = encodeDomainId(plan.table.tableId);
  const enumOptions = new Map<FieldId, readonly EnumOptionDefV1[]>();
  for (const entry of plan.fields) {
    if (entry.definition.type.kind === "enum") {
      enumOptions.set(
        entry.definition.fieldId,
        schema.enumOptions.filter((option) => compareDomainIds(option.fieldId, entry.definition.fieldId) === 0),
      );
    }
  }
  return {
    table: plan.table,
    enumOptions,
    rules: schema.rules
      .filter((rule) => rule.isActive && encodeDomainId(rule.tableId) === tableKey)
      .map((rule) => rule.rule),
    referenceExists,
    referenceTargets: schema.relationships
      .filter((relationship) => encodeDomainId(relationship.fromTableId) === tableKey)
      .map((relationship) => ({
        fieldId: relationship.fromFieldId,
        tableId: relationship.toTableId,
        tableLabel:
          schema.tables.find((candidate) => compareDomainIds(candidate.table.tableId, relationship.toTableId) === 0)
            ?.table.displayName ?? "",
      })),
  };
};

/**
 * Both record passes. Rows the plan discards are returned as snapshot
 * markers, so the snapshot shows what no table took and why.
 */
export async function buildRecords(
  entropy: EntropyPort,
  proposal: ProposedWorkbookV1,
  schema: AllocatedSchemaV2,
  facts: readonly WorkbookFactStreamItemV2[],
  /** An app the rows join (an append): its records resolve too. */
  options: { readonly referenceExists?: ReferenceResolver } = {},
): Promise<BuiltRecordsV2 & { readonly discarded: ReadonlyMap<number, ReadonlyMap<number, "above-header" | "empty-row">> }> {
  const stream = planningStream(proposal, facts);
  const extents = tableRowExtents(stream);
  const parentKeys = new Set([...schema.relationshipByChildColumn.values()].map((entry) => entry.toTableKey));
  const keyedIds = new Map<string, RecordId[]>();
  const keyMaps = new Map<string, Map<string, RecordId>>();
  const live = new Set<string>();
  const liveKey = (tableId: TableId, recordId: RecordId): string => `${encodeDomainId(tableId)}:${encodeDomainId(recordId)}`;

  // Pass 1: keyed tables' identities, and each parent's key text → record.
  const firstPlan = new RowPlan(proposal, extents);
  await walkRows(stream, {
    declaredTable: (sheetIndex) => firstPlan.declare(sheetIndex),
    row(row) {
      for (const placement of firstPlan.place(row)) {
        if (placement.kind !== "data") continue;
        const plan = planFor(schema, placement.table);
        if (plan === undefined || plan.table.keyFieldId === null) continue;
        const recordId = createDomainId("record", entropy);
        const ids = keyedIds.get(plan.head.tableKey) ?? [];
        ids.push(recordId);
        keyedIds.set(plan.head.tableKey, ids);
        live.add(liveKey(plan.table.tableId, recordId));
        if (parentKeys.has(plan.head.tableKey)) {
          const keyColumn = plan.fields.find((entry) => entry.definition.fieldId === plan.table.keyFieldId)?.proposed.columnIndex;
          const text = keyColumn === undefined ? undefined : sourceTextAt(row, keyColumn);
          if (text !== undefined && text !== "") {
            const map = keyMaps.get(plan.head.tableKey) ?? new Map<string, RecordId>();
            if (!map.has(text)) map.set(text, recordId);
            keyMaps.set(plan.head.tableKey, map);
          }
        }
      }
    },
  });
  firstPlan.assertMatches(proposal);

  // Pass 2: every record, through the one validator with the real predicate.
  const referenceExists: ReferenceResolver = (tableId, recordId) =>
    live.has(liveKey(tableId, recordId)) || (options.referenceExists?.(tableId, recordId) ?? false);
  const contexts = new Map(schema.tables.map((plan) => [plan.head.tableKey, contextFor(schema, plan, referenceExists)]));
  const cursors = new Map<string, number>();
  const records: StoredRecordV1[] = [];
  const discarded = new Map<number, Map<number, "above-header" | "empty-row">>();
  let flaggedCount = 0;
  let firstBlockingReport: ValidationReport | null = null;

  const secondPlan = new RowPlan(proposal, extents);
  const valueOf = (plan: TablePlanV1, entry: FieldPlanV1, table: ProposedTableV2, row: PlannedRowV1): CellValueV1 => {
    const column = entry.proposed.columnIndex;
    const text = secondPlan.isReadableBy(table, row, column) ? sourceTextAt(row, column) : "";
    if (text === undefined) return MISSING_VALUE;
    if (text === "") return BLANK_VALUE;
    const relationship = schema.relationshipByChildColumn.get(`${plan.head.tableKey}|${entry.proposed.columnKey}`);
    if (relationship !== undefined) {
      // D36: the parent's record, or the original key kept and flagged.
      const recordId = keyMaps.get(relationship.toTableKey)?.get(text);
      return recordId === undefined ? invalidPreservedValue(text) : { kind: "reference", recordId };
    }
    if (entry.proposed.type.kind === "reference") return invalidPreservedValue(text);
    const converted = sourceTextToCellValue(text, {
      type: entry.proposed.valueType,
      sourceFormat: entry.proposed.sourceFormat,
      enumOptions: entry.proposed.enumOptions.map((option) => option.label),
    });
    if (converted.kind === "value") return converted.value;
    const optionId = entry.optionIds.get(converted.label);
    return optionId === undefined ? invalidPreservedValue(text) : { kind: "enum", optionId };
  };

  await walkRows(stream, {
    declaredTable: (sheetIndex) => secondPlan.declare(sheetIndex),
    row(row) {
      for (const placement of secondPlan.place(row)) {
        if (placement.kind === "discarded") {
          if (placement.reason !== "totals-row") {
            const sheet = discarded.get(row.sheetIndex) ?? new Map<number, "above-header" | "empty-row">();
            if (!sheet.has(row.rowIndex)) sheet.set(row.rowIndex, placement.reason);
            discarded.set(row.sheetIndex, sheet);
          }
          continue;
        }
        if (placement.kind !== "data") continue;
        const plan = planFor(schema, placement.table);
        const context = plan === undefined ? undefined : contexts.get(plan.head.tableKey);
        if (plan === undefined || context === undefined) continue;

        let recordId: RecordId;
        if (plan.table.keyFieldId === null) {
          recordId = createDomainId("record", entropy);
          live.add(liveKey(plan.table.tableId, recordId));
        } else {
          const index = cursors.get(plan.head.tableKey) ?? 0;
          cursors.set(plan.head.tableKey, index + 1);
          recordId = keyedIds.get(plan.head.tableKey)?.[index] as RecordId;
        }

        const values = new Map<FieldId, CellValueV1>();
        const entries: { readonly fieldId: FieldId; readonly value: CellValueV1 }[] = [];
        for (const entry of plan.fields) {
          const value = valueOf(plan, entry, placement.table, row);
          values.set(entry.definition.fieldId, value);
          entries.push({ fieldId: entry.definition.fieldId, value });
        }
        const report = validateRecord(context, { recordId, tableId: plan.table.tableId, values });
        if (!report.isValid && firstBlockingReport === null) firstBlockingReport = report;
        if (report.issues.length > 0) flaggedCount += 1;
        records.push({
          recordId,
          tableId: plan.table.tableId,
          values: entries,
          issues: report.issues.map((issue) => ({
            fieldId: issue.fieldId,
            kind: issue.kind,
            severity: issue.severity,
            messageKey: issue.messageKey,
          })),
        });
      }
    },
  });

  return { records: [...records].sort(compareRecordKeys), flaggedCount, firstBlockingReport, discarded };
}

/** Canonical CBOR's head for an array of `count` items (major type 4). */
const arrayHeadByteLength = (count: number): number =>
  count < 24 ? 1 : count <= 0xff ? 2 : count <= 0xffff ? 3 : 5;

/**
 * Greedy pages, in order, each inside `maxCount` items and
 * {@link PAGE_MAX_DECODED_BYTES}. A page's decoded size is exact without
 * encoding it: the empty page, less its empty array's one-byte head, plus the
 * head for its item count and each item's own canonical encoding. So every
 * item is measured once, not once per candidate page. The page encoders still
 * enforce both caps when the pages are sealed.
 */
function pagesWithin<T>(
  items: readonly T[],
  emptyPageByteLength: number,
  itemByteLength: (item: T) => number,
  maxCount: number,
): readonly T[][] {
  const pages: T[][] = [];
  let current: T[] = [];
  let currentItemBytes = 0;
  const byteLength = (count: number, itemBytes: number): number =>
    emptyPageByteLength - 1 + arrayHeadByteLength(count) + itemBytes;

  for (const item of items) {
    const size = itemByteLength(item);
    const fits =
      current.length + 1 <= maxCount && byteLength(current.length + 1, currentItemBytes + size) <= PAGE_MAX_DECODED_BYTES;
    if (!fits && current.length > 0) {
      pages.push(current);
      current = [];
      currentItemBytes = 0;
    }
    current.push(item);
    currentItemBytes += size;
  }
  if (current.length > 0) {
    pages.push(current);
  }
  return pages.length === 0 ? [[]] : pages;
}

/** Splits sorted records into pages inside both caps. */
export function paginate(records: readonly StoredRecordV1[]): readonly StoredRecordV1[][] {
  return pagesWithin(
    records,
    encodeRecordPage({ pageVersion: 1, records: [] }).byteLength,
    recordPageEntryByteLength,
    RECORD_PAGE_MAX_RECORDS,
  );
}

/**
 * Splits a baseline's entries, in record-page key order, into pages inside the
 * 512 KiB decoded cap baseline pages share with record pages (database.md
 * § Checkpoint and page boundaries).
 */
export function paginateBaseline(scopeId: Uint8Array, entries: readonly BaselineEntryV1[]): readonly BaselineEntryV1[][] {
  return pagesWithin(
    entries,
    encodeBaselinePage({ pageVersion: 1, scopeId, entries: [] }).byteLength,
    baselinePageEntryByteLength,
    Number.POSITIVE_INFINITY,
  );
}

const pageKey = (record: StoredRecordV1): Uint8Array => {
  const key = new Uint8Array(ID_BYTES * 2);
  key.set(record.tableId, 0);
  key.set(record.recordId, ID_BYTES);
  return key;
};

// ------------------------------------------------------------ root building --

type SealScope = Parameters<StagingPortsV1["crypto"]["seal"]>[0]["scope"];
type SealKind = Parameters<StagingPortsV1["crypto"]["seal"]>[0]["payloadKind"];

/** Seals roots under one key at one revision, collecting the frames. */
export interface RootSealerV1 {
  readonly frames: EnvelopeFrameV1[];
  seal(scope: SealScope, kind: SealKind, payload: Uint8Array): Promise<StorageRefV1>;
}

export function rootSealer(
  ports: StagingPortsV1,
  key: EnvelopeKeyRefV1,
  logicalRevision: bigint,
): RootSealerV1 {
  const frames: EnvelopeFrameV1[] = [];
  return {
    frames,
    async seal(scope, kind, payload) {
      const storageId = asStorageId16(ports.entropy.randomBytes(STORAGE_ID_BYTES));
      frames.push(
        await ports.crypto.seal({
          scope,
          storageId,
          logicalRevision,
          payloadKind: kind,
          payload,
          compression: "deflate-raw-v1",
          key,
        }),
      );
      return { storageId: encodeStorageId16(storageId), semanticSha256: await ports.crypto.sha256(payload) };
    },
  };
}

/** Record pages, sorted and capped, and their manifest references. */
export async function sealRecordPages(
  sealer: RootSealerV1,
  records: readonly StoredRecordV1[],
): Promise<readonly PageRefV1[]> {
  const refs: PageRefV1[] = [];
  for (const page of paginate(records)) {
    const payload = encodeRecordPage({ pageVersion: 1, records: page });
    const ref = await sealer.seal("app.records", "app.record-page", payload);
    const first = page[0];
    const last = page.at(-1);
    refs.push({
      storageId: ref.storageId,
      firstKey: first === undefined ? null : pageKey(first),
      lastKey: last === undefined ? null : pageKey(last),
      decodedCount: page.length,
      decodedByteLength: payload.byteLength,
      semanticSha256: ref.semanticSha256,
    });
  }
  return refs;
}

export interface WrittenSnapshotV1 {
  readonly sheetKey: string;
  readonly descriptor: SheetDescriptorV1;
  readonly manifest: StorageRefV1;
}

/**
 * One normalized snapshot per selected sheet (D39): every row the sheet holds,
 * rendered (D41), its merges, the anchors of its inert items, and the rows no
 * table took. Chunks and manifest are sealed under the app key.
 */
export async function writeSnapshots(input: {
  readonly sealer: RootSealerV1;
  readonly sha256: (bytes: Uint8Array) => Promise<Uint8Array>;
  readonly proposal: ProposedWorkbookV1;
  readonly sheets: readonly SheetPlanV1[];
  readonly facts: readonly WorkbookFactStreamItemV2[];
  readonly inertItems: readonly InertItemV1[];
  readonly discarded: ReadonlyMap<number, ReadonlyMap<number, "above-header" | "empty-row">>;
  readonly snapshotRevision: bigint;
}): Promise<readonly WrittenSnapshotV1[]> {
  const { sealer, sha256, sheets, inertItems } = input;
  const writers = new Map<number, { readonly plan: SheetPlanV1; readonly writer: SheetSnapshotWriter }>();
  const writerFor = (sheetIndex: number, dateSystem: "1900" | "1904") => {
    const existing = writers.get(sheetIndex);
    if (existing !== undefined) return existing;
    const plan = sheets.find((sheet) => sheet.proposed.sheetIndex === sheetIndex);
    if (plan === undefined) return undefined;
    const created = {
      plan,
      writer: new SheetSnapshotWriter(
        {
          sheetId: plan.sheetId,
          sheetOrdinal: plan.ordinal,
          displayName: plan.proposed.name,
          classification: plan.proposed.classification.filter(roleOf),
          dateSystem: plan.proposed.dateSystem ?? dateSystem,
          inertAnchors: inertItems.flatMap((item) =>
            item.anchor === null || compareDomainIds(item.sheetId, plan.sheetId) !== 0
              ? []
              : [{ inertItemId: item.inertItemId, range: item.anchor }],
          ),
        },
        async (payload, sequence) => {
          const ref = await sealer.seal("app.snapshot-chunk", "app.snapshot-chunk", payload);
          return { storageId: ref.storageId, sequence, decodedByteLength: payload.byteLength, sha256: await sha256(payload) };
        },
      ),
    };
    writers.set(sheetIndex, created);
    return created;
  };

  let dateSystem: "1900" | "1904" = "1900";
  await walkRows(input.facts, {
    sheet(sheet) {
      dateSystem = sheet.dateSystem;
      writerFor(sheet.sheetIndex, sheet.dateSystem);
    },
    merge(sheetIndex, range) {
      writerFor(sheetIndex, dateSystem)?.writer.merge(range);
    },
    async row(row) {
      const target = writerFor(row.sheetIndex, dateSystem);
      if (target === undefined) return;
      const reason = input.discarded.get(row.sheetIndex)?.get(row.rowIndex);
      if (reason !== undefined) target.writer.discard(row.rowIndex, reason);
      await target.writer.row(
        row.rowIndex,
        row.cellCount,
        [...row.cells.entries()].flatMap(([columnIndex, cell]) =>
          cell.value === null ? [] : [{ columnIndex, value: cell.value, numberFormat: cell.numberFormat, isFormula: cell.isFormula }],
        ),
      );
    },
  });

  const written: WrittenSnapshotV1[] = [];
  for (const plan of sheets) {
    const writer = writerFor(plan.proposed.sheetIndex, plan.proposed.dateSystem ?? "1900")?.writer;
    if (writer === undefined) continue;
    const manifest = await writer.finish();
    const ref = await sealer.seal("app.snapshot-manifest", "app.snapshot-manifest", encodeSheetSnapshotManifest(manifest));
    written.push({
      sheetKey: plan.proposed.sheetKey,
      manifest: ref,
      descriptor: {
        sheetId: plan.sheetId,
        displayName: plan.proposed.name,
        sheetOrdinal: plan.ordinal,
        classification: manifest.classification.length === 0 ? ["snapshot"] : manifest.classification,
        snapshotManifestStorageId: ref.storageId,
        declaredRowCount: plan.proposed.declaredRange === null ? null : plan.proposed.declaredRange.lastRow + 1,
        declaredColumnCount: plan.proposed.declaredRange === null ? null : plan.proposed.declaredRange.lastColumn + 1,
        snapshotRevision: input.snapshotRevision,
      },
    });
  }
  return written;
}

/** Inert items for the selected sheets, reasons mapped to M01's (auto-decision (a)). */
export function inertItemsOf(
  entropy: EntropyPort,
  proposal: ProposedWorkbookV1,
  sheets: readonly SheetPlanV1[],
): readonly InertItemV1[] {
  return proposal.inertItems.flatMap((item) => {
    const sheet = sheets.find((candidate) => candidate.proposed.sheetKey === item.sheetKey);
    return sheet === undefined
      ? []
      : [
          {
            inertItemId: createDomainId("inert-item", entropy),
            sheetId: sheet.sheetId,
            kind: item.kind,
            location: item.location.normalize("NFC"),
            reasonKey: INERT_REASON_OF[item.reasonKey],
            anchor: item.anchor,
            preservedManifestStorageId: null,
          },
        ];
  });
}

/** The statements a person changed: each becomes one recorded decision (FR-7). */
export interface DecisionPlanV1 {
  readonly statement: WorkbookStatementV1;
  readonly eventId: EventId;
  readonly fingerprint: Uint8Array;
  readonly record: InferenceDecisionRecordV1;
}

export async function decisionsOf(
  entropy: EntropyPort,
  proposal: ProposedWorkbookV1,
  sha256: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<readonly DecisionPlanV1[]> {
  const plans: DecisionPlanV1[] = [];
  for (const statement of proposal.statements) {
    // An accepted proposal is the default; recording it would be noise a
    // re-import would then have to ignore (FR-7).
    if (statement.disposition === "accepted") continue;
    const eventId = createDomainId("event", entropy);
    // S02 owns the fingerprint *input*; M08 owns the digest.
    const fingerprint = await sha256(new TextEncoder().encode(statement.evidenceFingerprint));
    plans.push({
      statement,
      eventId,
      fingerprint,
      record: {
        decisionId: createDomainId("decision", entropy),
        subject: statement.subject,
        decisionKind: decisionKindOf(statement.subject),
        evidenceFingerprint: fingerprint,
        disposition: statement.disposition,
        statement: decisionStatement(statement),
        evidence: decisionEvidence(statement),
        recordedEventId: eventId,
      },
    });
  }
  return plans;
}

// ------------------------------------------------------------------ the run --

export interface PromotionDependenciesV1 {
  readonly ports: StagingPortsV1;
  readonly clock: ClockPort;
  readonly localRoot: EnvelopeKeyRefV1;
  /** Adds the app entry and drops the staging workflow, in one catalog. */
  commitCatalog(input: {
    readonly appId: AppId;
    readonly displayName: string;
    readonly accentId: string;
    readonly glyph: string;
    readonly createdAtEpochMs: number;
    readonly rowCount: number;
    readonly tableCount: number;
    readonly wrappedAppKey: Uint8Array;
    readonly appHeadStorageId: string;
    readonly removeWorkflowStorageId: string;
    readonly addCleanupTicketStorageId: string;
    readonly logicalRevision: number;
  }): Promise<{ readonly frame: EnvelopeFrameV1; readonly storageId: string }>;
  /** Seals a cleanup ticket for the stage's temporaries. */
  sealCleanupTicket(input: {
    readonly storageId: StorageId16;
    readonly ticketId: string;
    readonly storageIds: readonly string[];
    readonly logicalRevision: number;
  }): Promise<EnvelopeFrameV1>;
}

/**
 * Runs the whole promotion. Returns a typed rejection rather than throwing
 * when the reviewed proposal cannot become an app: the user can fix it on the
 * review screen (D23).
 */
export async function promoteImport(
  deps: PromotionDependenciesV1,
  input: PromoteInputV1,
): Promise<PromotionResultV1> {
  const { ports } = deps;
  const { loaded, facts } = input;
  const proposal = loaded.stage.proposal;
  const entropy = ports.entropy;
  const sha256 = (bytes: Uint8Array): Promise<Uint8Array> => ports.crypto.sha256(bytes);

  // --- step 1: validate, then allocate -------------------------------------
  if (proposal === null) {
    return rejectedPromotion("no-proposal");
  }
  const heads = proposal.tables.filter((table) => table.joinedToTableKey === null);
  if (heads.length === 0 || heads.some((table) => table.fields.length === 0)) {
    return rejectedPromotion("empty-table");
  }

  const schema = allocateSchema(entropy, proposal);
  const tables = schema.tables.map((plan) => plan.table);
  const schemaReport = validateSchema(tables, schema.enumOptions, schema.relationships);
  if (!schemaReport.isValid) {
    return rejectedPromotion("schema-invalid", schemaReport, schema);
  }

  const built = await buildRecords(entropy, proposal, schema, facts);
  if (built.firstBlockingReport !== null) {
    // A blocking issue is not an imported-invalid value (those are warnings
    // and are kept, FR-4): it is a schema the rows cannot satisfy at all.
    return rejectedPromotion("record-invalid", built.firstBlockingReport, schema);
  }

  // --- step 2: build every root, outside the write transaction -------------
  const appId = createDomainId("app", entropy);
  const lineageId = loaded.stage.lineageId as LineageId;
  const commitId: CommitId = createDomainId("commit", entropy);
  const nowMs = deps.clock.nowEpochMs();
  const expectation = ports.catalog.expectation();
  const revision = expectation.transactionRevision + 1;
  const sealer = rootSealer(ports, loaded.provisionalKey, BigInt(revision));

  const recordPageRefs = await sealRecordPages(sealer, built.records);

  // The original-import baseline: every accepted row exactly as accepted.
  const baselineEntries: BaselineEntryV1[] = built.records.map((record) => ({
    tableId: record.tableId,
    recordId: record.recordId,
    state: "present",
    values: record.values,
  }));
  const baselineRefs: StorageRefV1[] = [];
  for (const entries of paginateBaseline(lineageId, baselineEntries)) {
    baselineRefs.push(
      await sealer.seal("app.baselines", "app.baseline-page", encodeBaselinePage({ pageVersion: 1, scopeId: lineageId, entries })),
    );
  }
  const [firstBaselineRef] = baselineRefs;
  if (firstBaselineRef === undefined) {
    throw new Error("a promoted app has no baseline page");
  }

  const chunkedSha256 = await chunkedSourceDigest(ports.crypto, input.sourceChunks);
  const sourceManifestRef = await sealer.seal(
    "app.source-manifest",
    "app.source-manifest",
    encodeSourceManifest({
      manifestVersion: 1,
      fileName: loaded.stage.fileName,
      byteLength: loaded.stage.sourceByteLength,
      chunkedSha256,
      chunks: input.sourceChunks,
    }),
  );

  const inertItems = inertItemsOf(entropy, proposal, schema.sheets);
  const snapshots = await writeSnapshots({
    sealer,
    sha256,
    proposal,
    sheets: schema.sheets,
    facts,
    inertItems,
    discarded: built.discarded,
    snapshotRevision: SCHEMA_REVISION_AFTER,
  });
  const descriptorOf = (sheetId: SheetId | null): SheetDescriptorV1 | undefined =>
    snapshots.find((entry) => sheetId !== null && compareDomainIds(entry.descriptor.sheetId, sheetId) === 0)?.descriptor;

  const decisions = await decisionsOf(entropy, proposal, sha256);
  const lineage: ImportLineageV1 = {
    lineageId,
    importKind: "initial",
    importOrdinal: 0,
    sourceDisplayName: loaded.stage.fileName,
    // D46: the source's identity is the digest of its chunk digests.
    sourceSha256: chunkedSha256,
    acceptedAtMs: nowMs,
    identityDecisions: cborMap([["kind", "initial"]]),
    acceptedCommitId: commitId,
  };

  // The initial checkpoint. The imported rows live here, not in the tail.
  const theme: AppThemeV1 = DEFAULT_APP_THEME;
  const frontier = [{ deviceId: input.deviceId, commitSequence: 1n }];
  const checkpointBody: Omit<CheckpointManifestV1, "semanticSha256"> = {
    manifestVersion: 1,
    appId,
    schemaRevision: SCHEMA_REVISION_AFTER,
    frontier,
    appState: {
      appId,
      displayName: input.acceptedName,
      createdAtMs: nowMs,
      lastOpenedAtMs: null,
      schemaRevision: SCHEMA_REVISION_AFTER,
      locality: "present",
      durableHomeId: null,
      lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 1,
      theme,
      stateRevision: 1n,
    },
    tables,
    enumOptions: schema.enumOptions,
    sheetSnapshots: snapshots.map((entry) => entry.descriptor),
    relationships: schema.relationships,
    validationRules: schema.rules,
    inertItems,
    inferenceDecisions: decisions.map((decision) => decision.record),
    importLineages: [lineage],
    recordPages: recordPageRefs,
  };
  const checkpointRef = await sealer.seal(
    "app.checkpoint",
    "app.checkpoint-manifest",
    encodeCheckpointManifest({ ...checkpointBody, semanticSha256: await sha256(encodeCheckpointBody(checkpointBody)) }),
  );

  // The one import-class commit: schema-establishing events only.
  const firstSnapshot = snapshots[0];
  if (firstSnapshot === undefined) {
    throw new Error("a promoted proposal has no selected sheet to snapshot");
  }
  const events = buildImportEvents({
    entropy,
    appId,
    lineageId,
    proposal,
    schema,
    decisions,
    descriptorOf,
    theme,
    displayName: input.acceptedName,
    refs: {
      sourceManifestStorageId: decodeStorageId16(sourceManifestRef.storageId),
      snapshotManifestStorageId: decodeStorageId16(firstSnapshot.manifest.storageId),
      checkpointManifestStorageId: decodeStorageId16(checkpointRef.storageId),
      // The event names one baseline root (M01); the head lists every page.
      originalBaselineStorageId: decodeStorageId16(firstBaselineRef.storageId),
    },
    sheetSnapshots: snapshots.map((entry) => ({
      sheetKey: entry.sheetKey,
      snapshotManifestStorageId: decodeStorageId16(entry.manifest.storageId),
    })),
  });

  // The one import-class commit, sealed by the one builder (`import-commit.ts`).
  const { segmentPayload } = await sealImportCommit({
    entropy,
    sha256,
    appId,
    commitId,
    deviceId: input.deviceId,
    chain: EMPTY_IMPORT_CHAIN,
    nowMs,
    schemaRevisionBefore: 0n,
    schemaRevisionAfter: SCHEMA_REVISION_AFTER,
    events,
  });
  const segmentRef = await sealer.seal("app.events", "app.event-segment", segmentPayload);

  const headBody: Omit<AppHeadV1, "semanticSha256"> = {
    headVersion: 1,
    appId,
    headRevision: 1n,
    schemaRevision: SCHEMA_REVISION_AFTER,
    checkpoint: checkpointRef,
    eventSegments: [segmentRef],
    frontier,
    baselinePages: baselineRefs,
    // Explicitly empty, not omitted: this app has these roots and they hold
    // nothing (database.md § `AppHeadV1`).
    conflictPages: [],
    auditPages: [],
    sourceManifests: [sourceManifestRef],
    // Every snapshot manifest the app can reach is listed (CA-22).
    snapshotManifests: snapshots.map((entry) => entry.manifest),
    retainedRoots: [],
  };
  const headStorageId = asStorageId16(entropy.randomBytes(STORAGE_ID_BYTES));
  sealer.frames.push(
    await ports.crypto.seal({
      scope: "app.head",
      storageId: headStorageId,
      logicalRevision: BigInt(revision),
      payloadKind: "app.head",
      payload: encodeAppHead({ ...headBody, semanticSha256: await sha256(encodeAppHeadBody(headBody)) }),
      compression: "deflate-raw-v1",
      key: loaded.provisionalKey,
    }),
  );

  // --- step 3: one transaction ---------------------------------------------
  // The provisional key **becomes** the app key: nothing staged is
  // re-encrypted at the review boundary (database.md § Import staging).
  const appKeyBytes = await readProvisionalKeyBytes(ports, deps.localRoot, loaded.workflowStorageId);
  const wrappedAppKey = serializeEnvelopeTransport(
    await ports.crypto.seal({
      scope: "local.catalog",
      storageId: asStorageId16(entropy.randomBytes(STORAGE_ID_BYTES)),
      logicalRevision: BigInt(revision),
      payloadKind: "local.catalog",
      payload: appKeyBytes,
      compression: "none",
      key: deps.localRoot,
    }),
  );
  appKeyBytes.fill(0);

  // The fact chunks were inference's working material, not the app's: they
  // are ticketed with the stage payload rather than retained.
  const ticketStorageId = asStorageId16(entropy.randomBytes(STORAGE_ID_BYTES));
  const ticketId = encodeStorageId16(ticketStorageId);
  const retained = new Set(input.sourceChunks.map((chunk) => chunk.storageId));
  const temporaries = [
    ...new Set([loaded.stageStorageId, ...stagedChunkStorageIds(loaded.stage)]),
  ]
    .filter((id) => !retained.has(id))
    .sort();
  sealer.frames.push(
    await deps.sealCleanupTicket({ storageId: ticketStorageId, ticketId, storageIds: temporaries, logicalRevision: revision }),
  );

  const tableCount = tables.length;
  const sealedCatalog = await deps.commitCatalog({
    appId,
    displayName: input.acceptedName,
    accentId: accentForApp(appId),
    glyph: glyphForApp(input.acceptedName),
    createdAtEpochMs: nowMs,
    rowCount: built.records.length,
    tableCount,
    wrappedAppKey,
    appHeadStorageId: encodeStorageId16(headStorageId),
    removeWorkflowStorageId: loaded.workflowStorageId,
    addCleanupTicketStorageId: ticketId,
    logicalRevision: revision,
  });
  sealer.frames.push(sealedCatalog.frame);

  const committed = await ports.store.commit({
    expectedRevision: expectation.transactionRevision,
    expectedWriterEpoch: expectation.writerEpoch,
    addFrames: sealer.frames,
    // The workflow envelope goes, exactly as cancellation removes it: the key
    // is now reachable only through the catalog's app entry.
    deleteStorageIds: [decodeStorageId16(loaded.workflowStorageId)],
    bootstrapPatch: { catalogStorageId: sealedCatalog.storageId },
  });
  ports.catalog.adopt(sealedCatalog.storageId, committed);

  // --- step 4: acknowledge, only now ---------------------------------------
  return {
    kind: "promoted",
    receipt: {
      appId,
      appHeadStorageId: encodeStorageId16(headStorageId),
      rowCount: built.records.length,
      tableCount,
      transactionRevision: committed,
      flaggedRecordCount: built.flaggedCount,
    },
  };
}

// -------------------------------------------------------------- the events --

interface BuildEventsInputV1 {
  readonly entropy: EntropyPort;
  readonly appId: AppId;
  readonly lineageId: LineageId;
  readonly proposal: ProposedWorkbookV1;
  readonly schema: AllocatedSchemaV2;
  readonly decisions: readonly DecisionPlanV1[];
  readonly descriptorOf: (sheetId: SheetId | null) => SheetDescriptorV1 | undefined;
  readonly theme: AppThemeV1;
  readonly displayName: string;
  readonly refs: {
    readonly sourceManifestStorageId: StorageId16;
    readonly snapshotManifestStorageId: StorageId16;
    readonly checkpointManifestStorageId: StorageId16;
    readonly originalBaselineStorageId: StorageId16;
  };
  readonly sheetSnapshots: readonly { readonly sheetKey: string; readonly snapshotManifestStorageId: StorageId16 }[];
}

/** The schema-establishing events one promoted table contributes, in commit order. */
export function tableEvents(
  schema: Pick<AllocatedSchemaV2, "enumOptions">,
  plan: TablePlanV1,
  sourceSheet: SheetDescriptorV1,
  push: (kind: DomainEventV1["kind"], payload: unknown, subject: DomainEventV1["subject"]) => void,
  appId: AppId,
): void {
  push(
    "table.created",
    encodeImportEventPayload.tableCreated({ table: plan.table, sourceSheet }),
    { appId, tableId: plan.table.tableId },
  );
  for (const entry of plan.fields) {
    push(
      "field.created",
      encodeImportEventPayload.fieldCreated({
        field: entry.definition,
        statementId: workbookStatementIdOf("field-type", entry.proposed.columnKey),
      }),
      { appId, tableId: plan.table.tableId, fieldId: entry.definition.fieldId },
    );
  }
  for (const entry of plan.fields) {
    const options = schema.enumOptions.filter((option) => compareDomainIds(option.fieldId, entry.definition.fieldId) === 0);
    if (options.length === 0) continue;
    push(
      "enum.changed",
      encodeImportEventPayload.enumChanged({ fieldId: entry.definition.fieldId, priorOptionSetSha256: null, options }),
      { appId, fieldId: entry.definition.fieldId },
    );
  }
}

/** The `inference-decision.recorded` event of one decision, under its pre-allocated id. */
export function decisionEvent(decision: DecisionPlanV1): { readonly eventId: EventId; readonly payload: unknown } {
  return {
    eventId: decision.eventId,
    payload: encodeImportEventPayload.inferenceDecision({
      evidenceFingerprint: decision.fingerprint,
      statement: decision.statement,
      disposition: decision.statement.disposition,
    }),
  };
}

function buildImportEvents(input: BuildEventsInputV1): readonly DomainEventV1[] {
  const { entropy, appId, schema } = input;
  const events: DomainEventV1[] = [];
  const provenance = { source: "initial-import" as const, sourceId: input.lineageId };
  const push = (
    kind: DomainEventV1["kind"],
    payload: unknown,
    subject: DomainEventV1["subject"],
    eventId: EventId = createDomainId("event", entropy),
  ): void => {
    events.push({ eventId, eventIndex: events.length, kind, subject, payload, provenance });
  };

  push(
    "app.created",
    encodeImportEventPayload.appCreated({
      displayName: input.displayName,
      tables: schema.tables.map((plan) => plan.table),
      enumOptions: schema.enumOptions,
      relationships: schema.relationships,
      theme: input.theme,
      importLineageId: input.lineageId,
      schemaRevision: SCHEMA_REVISION_AFTER,
    }),
    { appId },
  );
  for (const plan of schema.tables) {
    const sheet = input.descriptorOf(plan.table.sourceSheetId);
    if (sheet === undefined) throw new Error("a promoted table names a sheet with no snapshot");
    tableEvents(schema, plan, sheet, (kind, payload, subject) => push(kind, payload, subject), appId);
  }
  for (const decision of input.decisions) {
    const { eventId, payload } = decisionEvent(decision);
    push("inference-decision.recorded", payload, { appId }, eventId);
  }
  push(
    "import.accepted",
    encodeImportEventPayload.importAccepted({
      lineageId: input.lineageId,
      ...input.refs,
      proposal: input.proposal,
      sheetSnapshots: input.sheetSnapshots,
      acceptedSchemaRevision: SCHEMA_REVISION_AFTER,
    }),
    { appId },
  );
  return events;
}

export type { TableId, RecordId, SheetId };
