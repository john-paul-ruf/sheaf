/**
 * Loading one app into an open projection (database.md § Projection load order).
 *
 * The order is not a preference. Tables reference their key and label fields,
 * fields reference their table, and enum options reference their field — so
 * tables land first with their references null, fields follow, and only then do
 * the references resolve. The deferred foreign keys let the cycle close inside
 * one transaction; the triggers refuse it if it does not.
 *
 * The workbook roots follow the same law: sheets before the tables that name
 * them; relationships only after fields and the key updates their trigger
 * checks (a relationship to a field that is not its target's key disposes the
 * load); inert items after their sheets; lineages, then decisions. A decision
 * arrives here only if it has a kind — the caller filters the rest.
 *
 * Records arrive in bounded batches, one page per transaction. A failure in any
 * batch rolls that batch back and disposes the entire projection: there is no
 * state in which a half-loaded app answers a query, because a person cannot
 * tell a short answer from a true one.
 *
 * The app's identity and its theme are not hydration's to invent: they come
 * from the checkpoint that promotion wrote (D29). `theme_cbor` is `NOT NULL`,
 * and a default composed here would be a colour nobody chose.
 *
 * The tail is replayed by `applyEvents` — the same call a caller could make
 * itself — so `hydrateApp(checkpoint, tail)` performs exactly the writes of
 * `hydrateApp(checkpoint, [])` followed by `applyEvents(tail)`. That is CA-13's
 * equivalence, held by construction rather than by coincidence.
 */

import { decodeStorageId16 } from "../../domain/model/bytes.js";
import { CodecError } from "../../domain/model/errors.js";
import { compareDomainIds } from "../../domain/model/ids.js";
import { storageKindForFieldType } from "../../domain/model/schema.js";
import type {
  EnumOptionDefV1,
  FieldDefV1,
  RelationshipDefV1,
  TableDefV1,
} from "../../domain/model/schema.js";
import type { SheetDescriptorV1 } from "../../domain/model/snapshots.js";
import { encodeCanonical } from "../codecs/canonical-cbor.js";
import { applyEvents } from "./apply-events.js";
import {
  encodeAppTheme,
  encodeChartDefinition,
  encodeFormulaDocument,
  encodeFormulaMetadata,
  encodeFrontier,
  encodeMessageParameters,
  encodeOpaque,
  encodeRuleIR,
  encodeSnapshotAnchor,
} from "./cbor-values.js";
import {
  assertUsable,
  disposeProjection,
  EVENT_FORMAT_VERSION,
  PROJECTION_FORMAT_VERSION,
  run,
  toSqlInteger,
  withTransaction,
  type ProjectionHandleV1,
} from "./engine.js";
import { recalculate } from "./recalc.js";
import { idKey, insertRecord } from "./record-rows.js";
import {
  DECIMAL_ORDER_KEY_VERSION,
  TEXT_SORT_KEY_VERSION,
} from "./sort-keys.js";
import {
  INSERT_APP_STATE,
  INSERT_ENUM_OPTION,
  INSERT_FORMULA_DEPENDENCY,
  INSERT_IMPORT_LINEAGE,
  INSERT_INERT_CONTENT,
  INSERT_INFERENCE_DECISION,
  INSERT_PROJECTION_META,
  INSERT_RELATIONSHIP,
  INSERT_SCHEMA_FIELD,
  INSERT_SCHEMA_TABLE,
  INSERT_SHEET_SNAPSHOT,
  INSERT_VALIDATION_RULE,
  UPDATE_SCHEMA_TABLE_FIELD_REFS,
  UPSERT_CHART,
  UPSERT_FORMULA,
} from "./statements.js";
import type {
  ProjectionChartV1,
  ProjectionCheckpointV1,
  ProjectionCommitV1,
  ProjectionFormulaV1,
  ProjectionRecordPageV1,
  ProjectionSchemaCacheV1,
  ProjectionSheetSnapshotV1,
} from "./types.js";

/**
 * Hydrates the projection from a decoded checkpoint and replays the commits
 * that follow it. The caller has already decrypted, decoded, and verified the
 * checkpoint's own manifest; this reads no storage of its own.
 */
export async function hydrateApp(
  handle: ProjectionHandleV1,
  checkpoint: ProjectionCheckpointV1,
  tailCommits: readonly ProjectionCommitV1[] = [],
  pages: AsyncIterable<ProjectionRecordPageV1> | Iterable<ProjectionRecordPageV1> = checkpoint.recordPages,
): Promise<void> {
  assertUsable(handle);
  if (handle.hydrated) {
    throw new CodecError("this projection already holds an app");
  }
  assertCheckpointShape(checkpoint);

  try {
    await withTransaction(handle, () => {
      loadMetadata(handle, checkpoint);
    });

    for await (const page of pages) {
      await withTransaction(handle, () => {
        const ordered = [...page.records].sort((left, right) => {
          const byTable = compareDomainIds(
            left.record.tableId,
            right.record.tableId,
          );
          return byTable !== 0
            ? byTable
            : compareDomainIds(left.record.recordId, right.record.recordId);
        });
        for (const record of ordered) {
          insertRecord(handle, record);
        }
      });
    }

    // Load order step 6: every formula, once the whole graph is present (D60).
    await withTransaction(handle, () => recalculate(handle, { kind: "all" }));

    for (const entry of checkpoint.frontier) {
      handle.frontier.set(idKey(entry.deviceId), entry);
    }
    handle.hydrated = true;

    await applyEvents(handle, tailCommits);
  } catch (cause) {
    disposeProjection(handle);
    throw cause;
  }
}

function assertCheckpointShape(checkpoint: ProjectionCheckpointV1): void {
  if (
    compareDomainIds(checkpoint.appId, checkpoint.appState.appId) !== 0
  ) {
    throw new CodecError("checkpoint app state names another app");
  }
  // The two checkpoint columns are paired by a table CHECK: a source without
  // its hash could not be re-verified, and a hash without its source names
  // nothing.
  const hasStorageId = checkpoint.checkpointStorageId !== null;
  const hasHash = checkpoint.checkpointSemanticSha256 !== null;
  if (hasStorageId !== hasHash) {
    throw new CodecError("checkpoint reference and hash must be paired");
  }
  if (
    checkpoint.checkpointSemanticSha256 !== null &&
    checkpoint.checkpointSemanticSha256.byteLength !== 32
  ) {
    throw new CodecError("checkpoint semantic hash must be 32 bytes");
  }
}

/** Steps 1–3 of the load order, in one transaction. */
function loadMetadata(
  handle: ProjectionHandleV1,
  checkpoint: ProjectionCheckpointV1,
): void {
  const state = checkpoint.appState;

  run(handle, INSERT_PROJECTION_META, [
    PROJECTION_FORMAT_VERSION,
    EVENT_FORMAT_VERSION,
    checkpoint.appId,
    checkpoint.checkpointStorageId,
    checkpoint.checkpointSemanticSha256,
    encodeFrontier(checkpoint.frontier),
    TEXT_SORT_KEY_VERSION,
    DECIMAL_ORDER_KEY_VERSION,
    toSqlInteger(checkpoint.hydratedAtMs),
  ]);

  run(handle, INSERT_APP_STATE, [
    state.appId,
    state.displayName,
    toSqlInteger(state.createdAtMs),
    state.lastOpenedAtMs === null ? null : toSqlInteger(state.lastOpenedAtMs),
    toSqlInteger(state.schemaRevision),
    state.locality,
    state.durableHomeId,
    state.lastSuccessfulBackupMs === null
      ? null
      : toSqlInteger(state.lastSuccessfulBackupMs),
    toSqlInteger(state.deviceOnlyChangeCount),
    encodeAppTheme(state.theme),
    toSqlInteger(state.stateRevision),
  ]);

  for (const sheet of checkpoint.sheetSnapshots) {
    insertSheetSnapshot(handle, sheet);
  }

  insertTables(handle, checkpoint.tables);

  for (const option of checkpoint.enumOptions) {
    insertEnumOption(handle, option);
  }

  for (const relationship of checkpoint.relationships) {
    insertRelationship(handle, relationship);
  }

  for (const rule of checkpoint.validationRules) {
    run(handle, INSERT_VALIDATION_RULE, [
      rule.rule.ruleId,
      rule.tableId,
      rule.displayName,
      encodeRuleIR(rule.rule),
      rule.rule.messageKey,
      encodeMessageParameters(rule.rule.messageParameters),
      rule.isActive ? 1 : 0,
      toSqlInteger(rule.schemaRevision),
    ]);
  }

  // Every formula before any dependency: a dashboard value may read another.
  for (const entry of checkpoint.formulas) {
    upsertFormulaRow(handle, entry);
  }
  for (const entry of checkpoint.formulas) {
    insertFormulaDependencies(handle, entry);
  }

  for (const chart of checkpoint.charts ?? []) {
    upsertChartRow(handle, chart);
  }

  for (const item of checkpoint.inertItems) {
    run(handle, INSERT_INERT_CONTENT, [
      item.inertItemId,
      item.sheetId,
      item.kind,
      item.location,
      item.reasonKey,
      item.anchor === null ? null : encodeSnapshotAnchor(item.anchor),
      item.preservedManifestStorageId,
    ]);
  }

  for (const lineage of checkpoint.importLineages) {
    run(handle, INSERT_IMPORT_LINEAGE, [
      lineage.lineageId,
      lineage.importKind,
      lineage.importOrdinal,
      lineage.sourceDisplayName,
      lineage.sourceSha256,
      toSqlInteger(lineage.acceptedAtMs),
      encodeOpaque(lineage.identityDecisions),
      lineage.acceptedCommitId,
    ]);
  }

  for (const decision of checkpoint.inferenceDecisions) {
    run(handle, INSERT_INFERENCE_DECISION, [
      decision.decisionId,
      decision.decisionKind,
      decision.evidenceFingerprint,
      decision.disposition,
      encodeOpaque(decision.statement),
      encodeOpaque(decision.evidence),
      decision.recordedEventId,
    ]);
  }

  cacheSchema(handle.schema, checkpoint.tables, checkpoint.enumOptions);
  for (const relationship of checkpoint.relationships) {
    handle.schema.relationships.set(idKey(relationship.fromFieldId), relationship);
  }
  for (const entry of checkpoint.formulas) {
    handle.schema.formulas.set(idKey(entry.formula.formulaId), entry);
  }
}

/**
 * One `charts` row and its cache entry (CA-30). A second chart at a taken
 * ordinal is refused by `UNIQUE (chart_ordinal)` — an integrity failure, not
 * a reorder.
 */
export function upsertChartRow(handle: ProjectionHandleV1, chart: ProjectionChartV1): void {
  const { definition } = chart;
  run(handle, UPSERT_CHART, [
    definition.chartId,
    chart.displayName,
    definition.type,
    encodeChartDefinition(definition),
    chart.pinned ? 1 : 0,
    chart.ordinal,
    chart.provenance,
    toSqlInteger(chart.chartRevision),
  ]);
  handle.schema.charts.set(idKey(definition.chartId), chart);
}

/**
 * One `formulas` row. A computed column's field must already name this
 * formula (`trg_formulas_insert_guard`), so its field lands first; the
 * definition itself holds no result, and neither does the row (CA-25).
 */
export function upsertFormulaRow(
  handle: ProjectionHandleV1,
  entry: ProjectionFormulaV1,
): void {
  const { formula } = entry;
  run(handle, UPSERT_FORMULA, [
    formula.formulaId,
    formula.target.kind,
    formula.target.tableId,
    formula.target.kind === "computed-column" ? formula.target.fieldId : null,
    formula.displayName,
    formula.originalText,
    formula.document === null ? null : encodeFormulaDocument(formula.document),
    formula.disposition,
    formula.determinism,
    encodeFormulaMetadata(entry.metadata),
    entry.isActive ? 1 : 0,
    toSqlInteger(entry.schemaRevision),
  ]);
}

/** The downstream-invalidation index (`idx_formula_dependencies_dependency`). */
export function insertFormulaDependencies(
  handle: ProjectionHandleV1,
  entry: ProjectionFormulaV1,
): void {
  for (const dependency of entry.formula.dependencies) {
    run(handle, INSERT_FORMULA_DEPENDENCY, [
      entry.formula.formulaId,
      dependency.kind,
      dependency.kind === "field" ? dependency.fieldId : dependency.formulaId,
    ]);
  }
}

export function insertSheetSnapshot(
  handle: ProjectionHandleV1,
  sheet: ProjectionSheetSnapshotV1 | SheetDescriptorV1,
): void {
  run(handle, INSERT_SHEET_SNAPSHOT, [
    sheet.sheetId,
    sheet.displayName,
    sheet.sheetOrdinal,
    encodeCanonical([...sheet.classification]),
    typeof sheet.snapshotManifestStorageId === "string"
      ? decodeStorageId16(sheet.snapshotManifestStorageId)
      : sheet.snapshotManifestStorageId,
    sheet.declaredRowCount,
    sheet.declaredColumnCount,
    toSqlInteger(sheet.snapshotRevision),
  ]);
}

/**
 * Tables with their references null, then their fields, then the references —
 * the one order the key/label triggers accept. Hydration and a tail
 * `table.created` both come through here.
 */
export function insertTables(
  handle: ProjectionHandleV1,
  tables: readonly TableDefV1[],
): void {
  for (const table of tables) {
    run(handle, INSERT_SCHEMA_TABLE, [
      table.tableId,
      table.displayName,
      table.tableOrdinal,
      table.sourceSheetId,
      table.isActive ? 1 : 0,
      toSqlInteger(table.schemaRevision),
    ]);
  }

  for (const table of tables) {
    for (const field of table.fields) {
      insertField(handle, table, field);
    }
  }

  for (const table of tables) {
    if (table.keyFieldId !== null || table.labelFieldId !== null) {
      run(handle, UPDATE_SCHEMA_TABLE_FIELD_REFS, [
        table.keyFieldId,
        table.labelFieldId,
        table.tableId,
      ]);
    }
  }
}

export function insertRelationship(
  handle: ProjectionHandleV1,
  relationship: RelationshipDefV1,
): void {
  run(handle, INSERT_RELATIONSHIP, [
    relationship.relationshipId,
    relationship.fromTableId,
    relationship.fromFieldId,
    relationship.toTableId,
    relationship.toKeyFieldId,
    relationship.detectionSource,
    relationship.isActive ? 1 : 0,
    toSqlInteger(relationship.schemaRevision),
  ]);
}

export function insertField(
  handle: ProjectionHandleV1,
  table: TableDefV1,
  field: FieldDefV1,
): void {
  if (compareDomainIds(field.tableId, table.tableId) !== 0) {
    throw new CodecError("field definition belongs to another table");
  }
  run(handle, INSERT_SCHEMA_FIELD, [
    field.fieldId,
    field.tableId,
    field.displayName,
    field.fieldOrdinal,
    field.type.kind,
    storageKindForFieldType(field.type),
    field.isRequired ? 1 : 0,
    field.formulaId === undefined ? 0 : 1,
    field.isActive ? 1 : 0,
    field.formulaId ?? null,
    toSqlInteger(field.schemaRevision),
  ]);
}

export function insertEnumOption(
  handle: ProjectionHandleV1,
  option: EnumOptionDefV1,
): void {
  run(handle, INSERT_ENUM_OPTION, [
    option.optionId,
    option.fieldId,
    option.displayLabel,
    option.optionOrdinal,
    option.isActive ? 1 : 0,
    toSqlInteger(option.schemaRevision),
  ]);
}

/** The in-memory view of the schema the lanes and search text are built from. */
export function cacheSchema(
  schema: ProjectionSchemaCacheV1,
  tables: readonly TableDefV1[],
  enumOptions: readonly EnumOptionDefV1[],
): void {
  for (const table of tables) {
    const { fields, ...summary } = table;
    schema.tables.set(idKey(table.tableId), summary);
    schema.fieldsByTable.set(
      idKey(table.tableId),
      [...fields].sort((left, right) => left.fieldOrdinal - right.fieldOrdinal),
    );
    for (const field of fields) {
      schema.fields.set(idKey(field.fieldId), field);
    }
  }
  for (const option of enumOptions) {
    cacheEnumOption(schema, option);
  }
}

export function cacheEnumOption(
  schema: ProjectionSchemaCacheV1,
  option: EnumOptionDefV1,
): void {
  const key = idKey(option.fieldId);
  const options = schema.enumOptions.get(key) ?? [];
  options.push(option);
  options.sort((left, right) => left.optionOrdinal - right.optionOrdinal);
  schema.enumOptions.set(key, options);
  schema.optionLabels.set(idKey(option.optionId), option.displayLabel);
}
