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
 * `is_computed` and `formula_id` travel together (D51): migration 005 refuses
 * one without the other, and `formula_id` is a deferred reference, so a
 * computed field may land before the formula that names it inside one
 * transaction.
 */
export const INSERT_SCHEMA_FIELD = `
INSERT INTO schema_fields (
  field_id, table_id, display_name, field_ordinal, logical_type, storage_kind,
  is_required, is_computed, is_active, formula_id, source_evidence_cbor,
  schema_revision
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?);`;

/** `field.changed`: everything but identity and owning table (D57). */
export const UPDATE_SCHEMA_FIELD = `
UPDATE schema_fields
   SET display_name = ?, field_ordinal = ?, logical_type = ?, storage_kind = ?,
       is_required = ?, is_computed = ?, is_active = ?, formula_id = ?,
       schema_revision = ?
 WHERE field_id = ?;`;

/**
 * Moves a field out of the way before a reorder lands: `(table_id,
 * field_ordinal)` is unique, so swapping two ordinals one event at a time
 * would collide half way.
 */
export const UPDATE_SCHEMA_FIELD_ORDINAL = `
UPDATE schema_fields SET field_ordinal = ? WHERE field_id = ?;`;

/** `table.changed`: name, order, key and label; the key trigger re-checks both. */
export const UPDATE_SCHEMA_TABLE = `
UPDATE schema_tables
   SET display_name = ?, table_ordinal = ?, key_field_id = ?, label_field_id = ?,
       is_active = ?, schema_revision = ?
 WHERE table_id = ?;`;

export const UPDATE_APP_STATE_NAME = `
UPDATE app_state SET display_name = ? WHERE singleton = 1;`;

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

/** `rule.changed`: a new rule, or the complete replacement of one. */
export const UPSERT_VALIDATION_RULE = `
INSERT INTO validation_rules (
  rule_id, table_id, display_name, rule_ir_cbor, message_key,
  message_parameters_cbor, is_active, schema_revision
) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
ON CONFLICT (rule_id) DO UPDATE SET
  table_id = excluded.table_id, display_name = excluded.display_name,
  rule_ir_cbor = excluded.rule_ir_cbor, message_key = excluded.message_key,
  message_parameters_cbor = excluded.message_parameters_cbor, is_active = 1,
  schema_revision = excluded.schema_revision;`;

/**
 * `rule.removed` retires the row rather than deleting it: an issue may still
 * name it, and history reads it (migration 005's restricted reference).
 */
export const DEACTIVATE_VALIDATION_RULE = `
UPDATE validation_rules SET is_active = 0, schema_revision = ? WHERE rule_id = ?;`;

/**
 * `formula.changed`: the trigger requires a computed column's field to name
 * this formula already, so the field lands first (the same commit).
 */
export const UPSERT_FORMULA = `
INSERT INTO formulas (
  formula_id, target_kind, table_id, target_field_id, display_name,
  original_text, formula_ir_cbor, disposition, determinism, metadata_cbor,
  is_active, schema_revision
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (formula_id) DO UPDATE SET
  target_kind = excluded.target_kind, table_id = excluded.table_id,
  target_field_id = excluded.target_field_id,
  display_name = excluded.display_name, original_text = excluded.original_text,
  formula_ir_cbor = excluded.formula_ir_cbor, disposition = excluded.disposition,
  determinism = excluded.determinism, metadata_cbor = excluded.metadata_cbor,
  is_active = excluded.is_active, schema_revision = excluded.schema_revision;`;

/** `formula.removed`: the row stays so the computed field still resolves. */
export const DEACTIVATE_FORMULA = `
UPDATE formulas SET is_active = 0, schema_revision = ? WHERE formula_id = ?;`;

export const DELETE_FORMULA_DEPENDENCIES = `
DELETE FROM formula_dependencies WHERE formula_id = ?;`;

/** The existence trigger refuses an edge to a field or formula that is not there. */
export const INSERT_FORMULA_DEPENDENCY = `
INSERT INTO formula_dependencies (formula_id, dependency_kind, dependency_id)
VALUES (?, ?, ?);`;

/** The endpoint trigger refuses a source that is not a reference, or a key that is not the target's. */
export const INSERT_RELATIONSHIP = `
INSERT INTO relationships (
  relationship_id, from_table_id, from_field_id, to_table_id, to_key_field_id,
  detection_source, is_active, schema_revision
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`;

/** `relationship.changed` on an existing relationship: retarget, enable, disable. */
export const UPDATE_RELATIONSHIP = `
UPDATE relationships
   SET from_table_id = ?, from_field_id = ?, to_table_id = ?, to_key_field_id = ?,
       detection_source = ?, is_active = ?, schema_revision = ?
 WHERE relationship_id = ?;`;

/** Nothing references a relationship row; its former definition lives in history. */
export const DELETE_RELATIONSHIP = `
DELETE FROM relationships WHERE relationship_id = ?;`;

export const INSERT_INERT_CONTENT = `
INSERT INTO inert_content (
  inert_item_id, sheet_id, item_kind, source_location, reason_key,
  snapshot_anchor_cbor, preserved_manifest_storage_id
) VALUES (?, ?, ?, ?, ?, ?, ?);`;

export const INSERT_IMPORT_LINEAGE = `
INSERT INTO import_lineages (
  lineage_id, import_kind, import_ordinal, source_display_name, source_sha256,
  accepted_at_ms, identity_decisions_cbor, accepted_commit_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`;

export const INSERT_INFERENCE_DECISION = `
INSERT INTO inference_decisions (
  decision_id, decision_kind, evidence_fingerprint_sha256, disposition,
  statement_cbor, evidence_cbor, recorded_event_id
) VALUES (?, ?, ?, ?, ?, ?, ?);`;

export const INSERT_RECORD = `
INSERT INTO records (
  record_id, table_id, record_revision, created_commit_id, updated_commit_id,
  authored_cbor
) VALUES (?, ?, ?, ?, ?, ?);`;

/** The key SQLite just assigned; `record_pk` is the join and FTS row key. */
export const SELECT_LAST_INSERT_ROWID = "SELECT last_insert_rowid();";

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

/**
 * A record mutation rewrites the authored lanes only. The computed lanes are
 * recalculation's, and it recomputes just the downstream ones (D60).
 */
export const DELETE_AUTHORED_CELLS_FOR_RECORD =
  "DELETE FROM cells WHERE record_pk = ? AND origin = 'authored';";

export const INSERT_RECORD_ISSUE = `
INSERT INTO record_issues (
  issue_id, record_pk, field_id, rule_id, issue_kind, severity, message_key,
  message_parameters_cbor, provenance_cbor
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL);`;

/**
 * The five keys recalculation writes (CA-26; M02's `FORMULA_ISSUE_MESSAGE_KEYS`
 * minus the validator's own `computed-not-authored`, pinned by
 * `tests/unit/projection/statements.test.ts`). A record write replaces the
 * validator's verdict and leaves these to recalculation.
 */
const RECALCULATED_ISSUE_KEYS = `
  'formula-result-type', 'formula-error', 'formula-cycle',
  'unsupported-formula', 'missing-unsupported-formula'`;

export const DELETE_VALIDATOR_ISSUES_FOR_RECORD = `
DELETE FROM record_issues
 WHERE record_pk = ?
   AND NOT (issue_kind = 'formula' AND message_key IN (${RECALCULATED_ISSUE_KEYS}));`;

/** One computed field's recalculated issue on one record, before it is re-derived. */
export const DELETE_RECALCULATED_ISSUES_FOR_CELL = `
DELETE FROM record_issues
 WHERE record_pk = ? AND field_id = ?
   AND issue_kind = 'formula' AND message_key IN (${RECALCULATED_ISSUE_KEYS});`;

/** A removed or deactivated computed column keeps no lane and no flag. */
export const DELETE_RECALCULATED_ISSUES_FOR_FIELD = `
DELETE FROM record_issues
 WHERE field_id = ?
   AND issue_kind = 'formula' AND message_key IN (${RECALCULATED_ISSUE_KEYS});`;

export const SELECT_RECALCULATED_ISSUES_FOR_RECORD = `
SELECT field_id, message_key, message_parameters_cbor
  FROM record_issues
 WHERE record_pk = ?
   AND issue_kind = 'formula' AND message_key IN (${RECALCULATED_ISSUE_KEYS});`;

/** One computed lane, before recalculation re-derives it. */
export const DELETE_COMPUTED_CELL = `
DELETE FROM cells WHERE record_pk = ? AND field_id = ? AND origin = 'computed';`;

export const DELETE_COMPUTED_CELLS_FOR_FIELD = `
DELETE FROM cells WHERE field_id = ? AND origin = 'computed';`;

export const SELECT_COMPUTED_CELLS_FOR_RECORD = `
SELECT field_id, value_kind, text_value, decimal_value, integer_value, id_value
  FROM cells
 WHERE record_pk = ? AND origin = 'computed';`;

/**
 * A metric's or dashboard value's result, stamped with the session clock that
 * produced it (D60). The table disappears on lock; nothing here is ever an
 * event, a checkpoint, or an envelope (invariant 7).
 */
export const UPSERT_SCALAR_RESULT = `
INSERT INTO scalar_formula_results (formula_id, status, value_cbor, evaluated_at_ms)
VALUES (?, ?, ?, ?)
ON CONFLICT (formula_id) DO UPDATE SET
  status = excluded.status, value_cbor = excluded.value_cbor,
  evaluated_at_ms = excluded.evaluated_at_ms;`;

export const DELETE_SCALAR_RESULT = `
DELETE FROM scalar_formula_results WHERE formula_id = ?;`;

export const SELECT_SCALAR_RESULTS = `
SELECT formula_id, status, value_cbor, evaluated_at_ms
  FROM scalar_formula_results
 ORDER BY formula_id;`;

export const SELECT_SCALAR_RESULT = `
SELECT status, value_cbor FROM scalar_formula_results WHERE formula_id = ?;`;

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
       storage_kind, is_required, is_active, schema_revision, formula_id
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

const RELATIONSHIP_COLUMNS = `
       rel.relationship_id, rel.from_table_id, rel.from_field_id, rel.to_table_id,
       rel.to_key_field_id, rel.detection_source, rel.is_active,
       rel.schema_revision, from_table.display_name, to_table.display_name`;

export const SELECT_ALL_RELATIONSHIPS = `
SELECT ${RELATIONSHIP_COLUMNS}
  FROM relationships AS rel
  JOIN schema_tables AS from_table ON from_table.table_id = rel.from_table_id
  JOIN schema_tables AS to_table ON to_table.table_id = rel.to_table_id
 ORDER BY from_table.table_ordinal, rel.relationship_id;`;

/** Both directions: the table as child (source) and as parent (target). */
export const SELECT_RELATIONSHIPS_FOR_TABLE = `
SELECT ${RELATIONSHIP_COLUMNS}
  FROM relationships AS rel
  JOIN schema_tables AS from_table ON from_table.table_id = rel.from_table_id
  JOIN schema_tables AS to_table ON to_table.table_id = rel.to_table_id
 WHERE rel.from_table_id = ? OR rel.to_table_id = ?
 ORDER BY from_table.table_ordinal, rel.relationship_id;`;

export const SELECT_RELATIONSHIP_BY_ID = `
SELECT ${RELATIONSHIP_COLUMNS}
  FROM relationships AS rel
  JOIN schema_tables AS from_table ON from_table.table_id = rel.from_table_id
  JOIN schema_tables AS to_table ON to_table.table_id = rel.to_table_id
 WHERE rel.relationship_id = ?;`;

/**
 * Reverse navigation: the children whose reference cell names this parent.
 * `idx_cells_field_id` on `(field_id, id_value, record_pk)` answers it without
 * a table scan, and the page boundary is a row key (CA-14).
 */
export const PAGE_CHILDREN_FIRST = `
SELECT r.record_pk, r.record_id, r.authored_cbor
  FROM cells AS c
  JOIN records AS r ON r.record_pk = c.record_pk
 WHERE c.field_id = ? AND c.value_kind = 'id' AND c.id_value = ?
 ORDER BY r.record_pk
 LIMIT ?;`;

export const PAGE_CHILDREN_AFTER = `
SELECT r.record_pk, r.record_id, r.authored_cbor
  FROM cells AS c
  JOIN records AS r ON r.record_pk = c.record_pk
 WHERE c.field_id = ? AND c.value_kind = 'id' AND c.id_value = ?
   AND r.record_pk > ?
 ORDER BY r.record_pk
 LIMIT ?;`;

export const COUNT_CHILDREN = `
SELECT count(*) FROM cells
 WHERE field_id = ? AND value_kind = 'id' AND id_value = ?;`;

/** The most recent delete of a record, with its restoration payload. */
export const SELECT_LATEST_DELETE_FOR_RECORD = `
SELECT event_id, wall_time_ms, restoration_cbor
  FROM change_history
 WHERE subject_kind = 'record' AND subject_id = ? AND event_kind = 'record.deleted'
 ORDER BY wall_time_ms DESC, logical_counter DESC, event_id DESC
 LIMIT 1;`;

export const SELECT_SHEET_SNAPSHOTS = `
SELECT sheet_id, display_name, sheet_ordinal, classification_cbor,
       snapshot_manifest_storage_id, declared_row_count, declared_column_count,
       snapshot_revision
  FROM sheet_snapshots
 ORDER BY sheet_ordinal;`;

/** Per-sheet, per-kind counts through `idx_inert_content_sheet`. */
export const COUNT_INERT_BY_SHEET_AND_KIND = `
SELECT sheet_id, item_kind, count(*)
  FROM inert_content
 GROUP BY sheet_id, item_kind
 ORDER BY sheet_id, item_kind;`;

const INERT_COLUMNS = `
       inert_item_id, sheet_id, item_kind, source_location, reason_key,
       snapshot_anchor_cbor, preserved_manifest_storage_id`;

export const SELECT_ALL_INERT_ITEMS = `
SELECT ${INERT_COLUMNS}
  FROM inert_content
 ORDER BY sheet_id, item_kind, inert_item_id;`;

export const SELECT_INERT_ITEMS_FOR_SHEET = `
SELECT ${INERT_COLUMNS}
  FROM inert_content
 WHERE sheet_id = ?
 ORDER BY item_kind, inert_item_id;`;

const DECISION_COLUMNS = `
       decision_id, decision_kind, evidence_fingerprint_sha256, disposition,
       statement_cbor, evidence_cbor, recorded_event_id`;

export const SELECT_ALL_INFERENCE_DECISIONS = `
SELECT ${DECISION_COLUMNS}
  FROM inference_decisions
 ORDER BY decision_kind, evidence_fingerprint_sha256;`;

export const SELECT_INFERENCE_DECISIONS_OF_KIND = `
SELECT ${DECISION_COLUMNS}
  FROM inference_decisions
 WHERE decision_kind = ?
 ORDER BY evidence_fingerprint_sha256;`;

/** The resolver's predicate: a live record, in exactly the named table. */
export const SELECT_RECORD_IS_LIVE = `
SELECT 1 FROM records WHERE record_id = ? AND table_id = ?;`;

/** The only exact count in the engine (CA-14): `count(*)`, never a page total. */
export const COUNT_RECORDS_FOR_TABLE =
  "SELECT count(*) AS exact_count FROM records WHERE table_id = ?;";

/**
 * A record summary's columns, in `query-exec.ts`'s read order. Exported as a
 * fragment for the records query `filter-sql.ts` composes (CA-29): one
 * definition, so a composed page and a fixed page read the same row.
 */
export const RECORD_SUMMARY_COLUMNS = `
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
  FROM record_search
  JOIN records AS r ON r.record_pk = record_search.rowid
 WHERE record_search MATCH ? AND r.table_id = ?
 ORDER BY r.record_pk
 LIMIT ?;`;

export const SEARCH_RECORDS_AFTER = `
SELECT ${RECORD_SUMMARY_COLUMNS}
  FROM record_search
  JOIN records AS r ON r.record_pk = record_search.rowid
 WHERE record_search MATCH ? AND r.table_id = ? AND r.record_pk > ?
 ORDER BY r.record_pk
 LIMIT ?;`;

export const SELECT_RECORD_BY_ID = `
SELECT ${RECORD_SUMMARY_COLUMNS}, r.created_commit_id, r.updated_commit_id
  FROM records AS r
 WHERE r.record_id = ?;`;

/** What replay needs before it may touch a record: identity, then state. */
export const SELECT_RECORD_STATE_BY_ID = `
SELECT record_pk, table_id, record_revision, created_commit_id, authored_cbor
  FROM records WHERE record_id = ?;`;

/** Bounded by one table; used to rebuild search text after an enum rename. */
export const SELECT_RECORDS_FOR_TABLE = `
SELECT record_pk, authored_cbor FROM records WHERE table_id = ? ORDER BY record_pk;`;

/** One table's rows as recalculation reads them: key, identity, authored state. */
export const SELECT_RECORD_ROWS_FOR_TABLE = `
SELECT record_pk, record_id, authored_cbor FROM records WHERE table_id = ? ORDER BY record_pk;`;

export const SELECT_PROJECTION_APP_ID =
  "SELECT app_id FROM projection_meta WHERE singleton = 1;";

export const SELECT_SCHEMA_REVISION =
  "SELECT schema_revision FROM app_state WHERE singleton = 1;";

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
 * Turns a person's search text into an FTS5 query in which their words stay
 * words: `*`, `-`, `:`, `NEAR`, `OR`, and a stray quote are things to match, not
 * syntax to obey.
 *
 * Each word becomes one quoted term and the terms are joined with an explicit
 * `AND`. Two details force that shape rather than the more obvious quoted
 * phrase: migration 005 creates `record_search` with `detail=column`, which
 * stores no positions and therefore **cannot answer a phrase query at all**;
 * and juxtaposed terms in FTS5 *are* a phrase, so the `AND` has to be written.
 * Splitting on non-alphanumeric characters mirrors the `unicode61` tokenizer,
 * so each quoted term is exactly one token and never a phrase in disguise.
 *
 * The last word carries a `*`, which is what the index's `prefix='2 3'`
 * configuration is for and what search-as-you-type needs. Text with no word
 * characters yields `null`, and a caller answers that with an empty result
 * rather than by matching everything.
 */
export function toFtsMatchQuery(text: string): string | null {
  const words = text.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
  if (words.length === 0) {
    return null;
  }
  return words
    .map((word, index) => `"${word}"${index === words.length - 1 ? "*" : ""}`)
    .join(" AND ");
}
