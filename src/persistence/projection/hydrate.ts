/**
 * Loading one app into an open projection (database.md § Projection load order).
 *
 * The order is not a preference. Tables reference their key and label fields,
 * fields reference their table, and enum options reference their field — so
 * tables land first with their references null, fields follow, and only then do
 * the references resolve. The deferred foreign keys let the cycle close inside
 * one transaction; the triggers refuse it if it does not.
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

import { CodecError } from "../../domain/model/errors.js";
import { compareDomainIds } from "../../domain/model/ids.js";
import { storageKindForFieldType } from "../../domain/model/schema.js";
import type { EnumOptionDefV1, FieldDefV1, TableDefV1 } from "../../domain/model/schema.js";
import { encodeCanonical } from "../codecs/canonical-cbor.js";
import { applyEvents } from "./apply-events.js";
import {
  encodeAppTheme,
  encodeFrontier,
  encodeMessageParameters,
  encodeRuleIR,
} from "./cbor-values.js";
import {
  assertUsable,
  EVENT_FORMAT_VERSION,
  PROJECTION_FORMAT_VERSION,
  run,
  toSqlInteger,
  withTransaction,
  type ProjectionHandleV1,
} from "./engine.js";
import { idKey, insertRecord } from "./record-rows.js";
import {
  DECIMAL_ORDER_KEY_VERSION,
  TEXT_SORT_KEY_VERSION,
} from "./sort-keys.js";
import {
  INSERT_APP_STATE,
  INSERT_ENUM_OPTION,
  INSERT_PROJECTION_META,
  INSERT_SCHEMA_FIELD,
  INSERT_SCHEMA_TABLE,
  INSERT_SHEET_SNAPSHOT,
  INSERT_VALIDATION_RULE,
  UPDATE_SCHEMA_TABLE_FIELD_REFS,
} from "./statements.js";
import type {
  ProjectionCheckpointV1,
  ProjectionCommitV1,
  ProjectionSchemaCacheV1,
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
): Promise<void> {
  assertUsable(handle);
  if (handle.hydrated) {
    throw new CodecError("this projection already holds an app");
  }
  assertCheckpointShape(checkpoint);

  await withTransaction(handle, () => {
    loadMetadata(handle, checkpoint);
  });

  for (const page of checkpoint.recordPages) {
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

  for (const entry of checkpoint.frontier) {
    handle.frontier.set(idKey(entry.deviceId), entry);
  }
  handle.hydrated = true;

  await applyEvents(handle, tailCommits);
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
    run(handle, INSERT_SHEET_SNAPSHOT, [
      sheet.sheetId,
      sheet.displayName,
      sheet.sheetOrdinal,
      encodeCanonical([...sheet.classification]),
      sheet.snapshotManifestStorageId,
      sheet.declaredRowCount,
      sheet.declaredColumnCount,
      toSqlInteger(sheet.snapshotRevision),
    ]);
  }

  for (const table of checkpoint.tables) {
    run(handle, INSERT_SCHEMA_TABLE, [
      table.tableId,
      table.displayName,
      table.tableOrdinal,
      table.sourceSheetId,
      table.isActive ? 1 : 0,
      toSqlInteger(table.schemaRevision),
    ]);
  }

  for (const table of checkpoint.tables) {
    for (const field of table.fields) {
      insertField(handle, table, field);
    }
  }

  for (const table of checkpoint.tables) {
    if (table.keyFieldId !== null || table.labelFieldId !== null) {
      run(handle, UPDATE_SCHEMA_TABLE_FIELD_REFS, [
        table.keyFieldId,
        table.labelFieldId,
        table.tableId,
      ]);
    }
  }

  for (const option of checkpoint.enumOptions) {
    insertEnumOption(handle, option);
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

  cacheSchema(handle.schema, checkpoint.tables, checkpoint.enumOptions);
}

function insertField(
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
    field.isActive ? 1 : 0,
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
