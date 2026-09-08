/**
 * Every SQL statement the projection runs, in one place.
 *
 * This module exists so that "all SQL is generated from closed templates with
 * bound parameters" (database.md § SQLite Query Patterns) is a property a
 * reader can check by reading one file rather than a claim in a comment. Every
 * constant below is a complete, literal statement with `?` placeholders; no
 * function here concatenates, interpolates, or formats a value into SQL. A
 * user's text can therefore never become an identifier, an operator, a
 * collation, or a fragment — only a bound value.
 *
 * There is no DDL here either. The schema is Genesis-owned and arrives as the
 * migration asset (CA-06); `tests/unit/projection/module-boundaries.test.ts`
 * proves no `CREATE TABLE` string exists anywhere in this module tree.
 *
 * The query shapes are the ones database.md § SQLite Query Patterns names, with
 * the indexes it names: page a table by `record_pk`, open a record by its
 * stable ID, search through `record_search` joined back to `records`, count
 * with `count(*)`, and read history through its two ordered indexes.
 */

export const READ_USER_VERSION = "PRAGMA user_version;";

// ------------------------------------------------------------------- write --

export const INSERT_PROJECTION_META = `
INSERT INTO projection_meta (
  singleton, projection_format_version, event_format_version, app_id,
  checkpoint_storage_id, checkpoint_semantic_sha256, frontier_cbor,
  text_sort_key_version, decimal_order_key_version, hydrated_at_ms
) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;

export const UPDATE_PROJECTION_FRONTIER = `
UPDATE projection_meta SET frontier_cbor = ? WHERE singleton = 1;`;

export const INSERT_APP_STATE = `
INSERT INTO app_state (
  singleton, app_id, display_name, created_at_ms, last_opened_at_ms,
  schema_revision, locality, durable_home_id, last_successful_backup_ms,
  device_only_change_count, theme_cbor, state_revision
) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;

export const UPDATE_APP_STATE_THEME = `
UPDATE app_state
   SET theme_cbor = ?, state_revision = state_revision + 1
 WHERE singleton = 1;`;

export const UPDATE_APP_STATE_SCHEMA_REVISION = `
UPDATE app_state SET schema_revision = ? WHERE singleton = 1;`;

export const INSERT_SHEET_SNAPSHOT = `
INSERT INTO sheet_snapshots (
  sheet_id, display_name, sheet_ordinal, classification_cbor,
  snapshot_manifest_storage_id, declared_row_count, declared_column_count,
  snapshot_revision
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`;

/**
 * Key and label references are written null and filled in after the fields
 * exist: the ownership triggers require the referenced field to be present and
 * to belong to this table (database.md § Projection load order, step 2).
 */
export const INSERT_SCHEMA_TABLE = `
INSERT INTO schema_tables (
  table_id, display_name, table_ordinal, source_sheet_id,
  key_field_id, label_field_id, is_active, schema_revision
) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?);`;

export const UPDATE_SCHEMA_TABLE_FIELD_REFS = `
UPDATE schema_tables
   SET key_field_id = ?, label_field_id = ?
 WHERE table_id = ?;`;

/**
 * `is_computed` is written `0` for every field this feature can hold: F02 has
 * no formula engine, and `FieldDefV1` deliberately declares no computed half
 * (invariant 7), so a computed field is not expressible rather than merely
 * absent.
 */
export const INSERT_SCHEMA_FIELD = `
INSERT INTO schema_fields (
  field_id, table_id, display_name, field_ordinal, logical_type, storage_kind,
  is_required, is_computed, is_active, formula_id, source_evidence_cbor,
  schema_revision
) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?);`;

export const INSERT_ENUM_OPTION = `
INSERT INTO enum_options (
  option_id, field_id, display_label, option_ordinal, is_active,
  source_value_cbor, schema_revision
) VALUES (?, ?, ?, ?, ?, NULL, ?);`;

export const DELETE_ENUM_OPTIONS_FOR_FIELD = `
DELETE FROM enum_options WHERE field_id = ?;`;

export const INSERT_VALIDATION_RULE = `
INSERT INTO validation_rules (
  rule_id, table_id, display_name, rule_ir_cbor, message_key,
  message_parameters_cbor, is_active, schema_revision
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`;

export const INSERT_RECORD = `
INSERT INTO records (
  record_id, table_id, record_revision, created_commit_id, updated_commit_id,
  authored_cbor
) VALUES (?, ?, ?, ?, ?, ?);`;

export const UPDATE_RECORD = `
UPDATE records
   SET record_revision = ?, updated_commit_id = ?, authored_cbor = ?
 WHERE record_pk = ?;`;

export const DELETE_RECORD = "DELETE FROM records WHERE record_pk = ?;";

export const INSERT_CELL = `
INSERT INTO cells (
  record_pk, field_id, origin, value_kind, text_value, text_sort_key,
  decimal_value, decimal_order_key, integer_value, id_value
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;

export const DELETE_CELLS_FOR_RECORD =
  "DELETE FROM cells WHERE record_pk = ?;";

export const INSERT_RECORD_ISSUE = `
INSERT INTO record_issues (
  issue_id, record_pk, field_id, rule_id, issue_kind, severity, message_key,
  message_parameters_cbor, provenance_cbor
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL);`;

export const DELETE_ISSUES_FOR_RECORD =
  "DELETE FROM record_issues WHERE record_pk = ?;";

/**
 * `record_search` is contentless with `contentless_delete=1`, so a row is
 * replaced by deleting and re-inserting it at the same rowid — the rowid is
 * `records.record_pk`, which is what joins a hit back to its record.
 */
export const INSERT_SEARCH_ROW = `
INSERT INTO record_search (rowid, searchable_text) VALUES (?, ?);`;

export const DELETE_SEARCH_ROW = "DELETE FROM record_search WHERE rowid = ?;";

export const INSERT_CHANGE_HISTORY = `
INSERT INTO change_history (
  event_id, commit_id, event_index, event_kind, event_class, subject_kind,
  subject_id, wall_time_ms, logical_counter, device_id, summary_cbor,
  restoration_cbor
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;

// -------------------------------------------------------------------- read --

export const SELECT_PROJECTION_META = `
SELECT app_id, checkpoint_storage_id, checkpoint_semantic_sha256, frontier_cbor,
       text_sort_key_version, decimal_order_key_version, hydrated_at_ms
  FROM projection_meta WHERE singleton = 1;`;

export const SELECT_APP_STATE = `
SELECT app_id, display_name, created_at_ms, last_opened_at_ms, schema_revision,
       locality, durable_home_id, last_successful_backup_ms,
       device_only_change_count, theme_cbor, state_revision
  FROM app_state WHERE singleton = 1;`;

export const SELECT_ACTIVE_TABLES = `
SELECT table_id, display_name, table_ordinal, source_sheet_id, key_field_id,
       label_field_id, is_active, schema_revision
  FROM schema_tables
 WHERE is_active = 1
 ORDER BY table_ordinal;`;

export const SELECT_FIELDS_FOR_TABLE = `
SELECT field_id, table_id, display_name, field_ordinal, logical_type,
       storage_kind, is_required, is_active, schema_revision
  FROM schema_fields
 WHERE table_id = ?
 ORDER BY field_ordinal;`;

export const SELECT_ENUM_OPTIONS_FOR_FIELD = `
SELECT option_id, field_id, display_label, option_ordinal, is_active,
       schema_revision
  FROM enum_options
 WHERE field_id = ?
 ORDER BY option_ordinal;`;

export const SELECT_RULES_FOR_TABLE = `
SELECT rule_id, table_id, display_name, rule_ir_cbor, message_key,
       message_parameters_cbor, is_active, schema_revision
  FROM validation_rules
 WHERE table_id = ? AND is_active = 1;`;

/** The only exact count in the engine (CA-14): `count(*)`, never a page total. */
export const COUNT_RECORDS_FOR_TABLE =
  "SELECT count(*) AS exact_count FROM records WHERE table_id = ?;";

const RECORD_SUMMARY_COLUMNS = `
       r.record_pk, r.record_id, r.table_id, r.record_revision, r.authored_cbor,
       (SELECT count(*) FROM record_issues AS i
         WHERE i.record_pk = r.record_pk AND i.severity = 'blocking')
         AS blocking_count,
       (SELECT count(*) FROM record_issues AS i
         WHERE i.record_pk = r.record_pk AND i.severity = 'warning')
         AS warning_count`;

export const PAGE_RECORDS_FIRST = `
SELECT ${RECORD_SUMMARY_COLUMNS}
  FROM records AS r
 WHERE r.table_id = ?
 ORDER BY r.record_pk
 LIMIT ?;`;

export const PAGE_RECORDS_AFTER = `
SELECT ${RECORD_SUMMARY_COLUMNS}
  FROM records AS r
 WHERE r.table_id = ? AND r.record_pk > ?
 ORDER BY r.record_pk
 LIMIT ?;`;

/**
 * Search returns candidate rows only: the FTS index proposes row IDs and the
 * join back to `records` applies the table scope, so a hit for another table —
 * or for a record deleted since the index was written — cannot appear.
 */
export const SEARCH_RECORDS_FIRST = `
SELECT ${RECORD_SUMMARY_COLUMNS}
  FROM record_search AS s
  JOIN records AS r ON r.record_pk = s.rowid
 WHERE s MATCH ? AND r.table_id = ?
 ORDER BY r.record_pk
 LIMIT ?;`;

export const SEARCH_RECORDS_AFTER = `
SELECT ${RECORD_SUMMARY_COLUMNS}
  FROM record_search AS s
  JOIN records AS r ON r.record_pk = s.rowid
 WHERE s MATCH ? AND r.table_id = ? AND r.record_pk > ?
 ORDER BY r.record_pk
 LIMIT ?;`;

export const SELECT_RECORD_BY_ID = `
SELECT ${RECORD_SUMMARY_COLUMNS}, r.created_commit_id, r.updated_commit_id
  FROM records AS r
 WHERE r.record_id = ?;`;

export const SELECT_RECORD_PK_BY_ID =
  "SELECT record_pk, table_id, record_revision, created_commit_id" +
  " FROM records WHERE record_id = ?;";

export const SELECT_CELLS_FOR_RECORD = `
SELECT field_id, origin, value_kind, text_value, text_sort_key, decimal_value,
       decimal_order_key, integer_value, id_value
  FROM cells
 WHERE record_pk = ?
 ORDER BY field_id;`;

export const SELECT_ISSUES_FOR_RECORD = `
SELECT issue_id, field_id, rule_id, issue_kind, severity, message_key,
       message_parameters_cbor
  FROM record_issues
 WHERE record_pk = ?
 ORDER BY issue_id;`;

const CHANGE_HISTORY_COLUMNS = `
       event_id, commit_id, event_index, event_kind, event_class, subject_kind,
       subject_id, wall_time_ms, logical_counter, device_id, summary_cbor,
       restoration_cbor`;

/**
 * History pages descend `(wall_time_ms, logical_counter, event_id)`; the cursor
 * is the last row of the previous page, compared as a row value so the boundary
 * stays stable when rows share a wall time.
 */
export const PAGE_CHANGE_HISTORY_FIRST = `
SELECT ${CHANGE_HISTORY_COLUMNS}
  FROM change_history
 ORDER BY wall_time_ms DESC, logical_counter DESC, event_id DESC
 LIMIT ?;`;

export const PAGE_CHANGE_HISTORY_AFTER = `
SELECT ${CHANGE_HISTORY_COLUMNS}
  FROM change_history
 WHERE (wall_time_ms, logical_counter, event_id) < (?, ?, ?)
 ORDER BY wall_time_ms DESC, logical_counter DESC, event_id DESC
 LIMIT ?;`;

export const SELECT_HISTORY_FOR_RECORD = `
SELECT ${CHANGE_HISTORY_COLUMNS}
  FROM change_history
 WHERE subject_kind = 'record' AND subject_id = ?
 ORDER BY wall_time_ms DESC, logical_counter DESC, event_id DESC
 LIMIT ?;`;

export const SELECT_DELETE_EVENT_FOR_RECORD = `
SELECT subject_id, summary_cbor, restoration_cbor
  FROM change_history
 WHERE event_id = ? AND event_kind = 'record.deleted';`;

export const SELECT_SEARCH_ROWIDS = `
SELECT rowid FROM record_search WHERE record_search MATCH ?;`;

/**
 * Turns a person's search text into one FTS5 phrase, so their words stay words:
 * an embedded quote, `*`, `-`, `:`, `NEAR`, or `OR` is data to match, never
 * query syntax. The trailing `*` makes the last word a prefix, which is what
 * the index's `prefix='2 3'` configuration is for and what search-as-you-type
 * needs. Empty or whitespace-only text yields `null` — a caller answers it with
 * an empty result rather than by matching everything.
 */
export function toFtsMatchQuery(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return `"${trimmed.replaceAll('"', '""')}"*`;
}
