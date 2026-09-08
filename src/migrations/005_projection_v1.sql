-- Sheaf in-memory SQLite projection, version 1.
-- The database is always opened as :memory: inside data.worker.ts.

PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS projection_meta (
    singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
    projection_format_version INTEGER NOT NULL CHECK (projection_format_version = 1),
    event_format_version INTEGER NOT NULL CHECK (event_format_version = 1),
    app_id BLOB NOT NULL CHECK (length(app_id) = 16),
    checkpoint_storage_id BLOB CHECK (
        checkpoint_storage_id IS NULL OR length(checkpoint_storage_id) = 16
    ),
    checkpoint_semantic_sha256 BLOB CHECK (
        checkpoint_semantic_sha256 IS NULL OR length(checkpoint_semantic_sha256) = 32
    ),
    frontier_cbor BLOB NOT NULL CHECK (length(frontier_cbor) > 0),
    text_sort_key_version INTEGER NOT NULL CHECK (text_sort_key_version > 0),
    decimal_order_key_version INTEGER NOT NULL CHECK (decimal_order_key_version = 1),
    hydrated_at_ms INTEGER NOT NULL CHECK (hydrated_at_ms >= 0),
    CHECK (
        (checkpoint_storage_id IS NULL AND checkpoint_semantic_sha256 IS NULL) OR
        (checkpoint_storage_id IS NOT NULL AND checkpoint_semantic_sha256 IS NOT NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS app_state (
    singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
    app_id BLOB NOT NULL UNIQUE CHECK (length(app_id) = 16),
    display_name TEXT NOT NULL CHECK (length(display_name) > 0),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    last_opened_at_ms INTEGER CHECK (last_opened_at_ms IS NULL OR last_opened_at_ms >= 0),
    schema_revision INTEGER NOT NULL CHECK (schema_revision >= 0),
    locality TEXT NOT NULL CHECK (locality IN ('present', 'oversized-local')),
    durable_home_id BLOB CHECK (durable_home_id IS NULL OR length(durable_home_id) = 16),
    last_successful_backup_ms INTEGER CHECK (
        last_successful_backup_ms IS NULL OR last_successful_backup_ms >= 0
    ),
    device_only_change_count INTEGER NOT NULL CHECK (device_only_change_count >= 0),
    theme_cbor BLOB NOT NULL CHECK (length(theme_cbor) > 0),
    state_revision INTEGER NOT NULL CHECK (state_revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS sheet_snapshots (
    sheet_id BLOB NOT NULL PRIMARY KEY CHECK (length(sheet_id) = 16),
    display_name TEXT NOT NULL CHECK (length(display_name) > 0),
    sheet_ordinal INTEGER NOT NULL UNIQUE CHECK (sheet_ordinal >= 0),
    classification_cbor BLOB NOT NULL CHECK (length(classification_cbor) > 0),
    snapshot_manifest_storage_id BLOB NOT NULL CHECK (
        length(snapshot_manifest_storage_id) = 16
    ),
    declared_row_count INTEGER CHECK (declared_row_count IS NULL OR declared_row_count >= 0),
    declared_column_count INTEGER CHECK (
        declared_column_count IS NULL OR declared_column_count >= 0
    ),
    snapshot_revision INTEGER NOT NULL CHECK (snapshot_revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS schema_tables (
    table_id BLOB NOT NULL PRIMARY KEY CHECK (length(table_id) = 16),
    display_name TEXT NOT NULL CHECK (length(display_name) > 0),
    table_ordinal INTEGER NOT NULL UNIQUE CHECK (table_ordinal >= 0),
    source_sheet_id BLOB REFERENCES sheet_snapshots(sheet_id) ON DELETE SET NULL,
    key_field_id BLOB REFERENCES schema_fields(field_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
        CHECK (key_field_id IS NULL OR length(key_field_id) = 16),
    label_field_id BLOB REFERENCES schema_fields(field_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
        CHECK (label_field_id IS NULL OR length(label_field_id) = 16),
    is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
    schema_revision INTEGER NOT NULL CHECK (schema_revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS schema_fields (
    field_id BLOB NOT NULL PRIMARY KEY CHECK (length(field_id) = 16),
    table_id BLOB NOT NULL REFERENCES schema_tables(table_id) ON DELETE RESTRICT,
    display_name TEXT NOT NULL CHECK (length(display_name) > 0),
    field_ordinal INTEGER NOT NULL CHECK (field_ordinal >= 0),
    logical_type TEXT NOT NULL CHECK (
        logical_type IN (
            'date', 'currency', 'number', 'phone', 'email', 'url',
            'address', 'boolean', 'enum', 'text', 'reference'
        )
    ),
    storage_kind TEXT NOT NULL CHECK (
        storage_kind IN ('text', 'decimal', 'integer', 'id')
    ),
    is_required INTEGER NOT NULL CHECK (is_required IN (0, 1)),
    is_computed INTEGER NOT NULL CHECK (is_computed IN (0, 1)),
    is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
    formula_id BLOB REFERENCES formulas(formula_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
        CHECK (formula_id IS NULL OR length(formula_id) = 16),
    source_evidence_cbor BLOB CHECK (
        source_evidence_cbor IS NULL OR length(source_evidence_cbor) > 0
    ),
    schema_revision INTEGER NOT NULL CHECK (schema_revision >= 0),
    UNIQUE (table_id, field_ordinal),
    CHECK (
        (logical_type IN ('currency', 'number') AND storage_kind = 'decimal') OR
        (logical_type IN ('date', 'boolean') AND storage_kind = 'integer') OR
        (logical_type IN ('enum', 'reference') AND storage_kind = 'id') OR
        (logical_type IN ('phone', 'email', 'url', 'address', 'text') AND storage_kind = 'text')
    ),
    CHECK (
        (is_computed = 0 AND formula_id IS NULL) OR
        (is_computed = 1 AND formula_id IS NOT NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS enum_options (
    option_id BLOB NOT NULL PRIMARY KEY CHECK (length(option_id) = 16),
    field_id BLOB NOT NULL REFERENCES schema_fields(field_id) ON DELETE RESTRICT,
    display_label TEXT NOT NULL CHECK (length(display_label) > 0),
    option_ordinal INTEGER NOT NULL CHECK (option_ordinal >= 0),
    is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
    source_value_cbor BLOB CHECK (source_value_cbor IS NULL OR length(source_value_cbor) > 0),
    schema_revision INTEGER NOT NULL CHECK (schema_revision >= 0),
    UNIQUE (field_id, option_ordinal)
) STRICT;

CREATE TABLE IF NOT EXISTS relationships (
    relationship_id BLOB NOT NULL PRIMARY KEY CHECK (length(relationship_id) = 16),
    from_table_id BLOB NOT NULL REFERENCES schema_tables(table_id) ON DELETE RESTRICT,
    from_field_id BLOB NOT NULL UNIQUE REFERENCES schema_fields(field_id) ON DELETE RESTRICT,
    to_table_id BLOB NOT NULL REFERENCES schema_tables(table_id) ON DELETE RESTRICT,
    to_key_field_id BLOB NOT NULL REFERENCES schema_fields(field_id) ON DELETE RESTRICT,
    detection_source TEXT NOT NULL CHECK (
        detection_source IN ('declared', 'lookup-formula', 'key-match', 'user')
    ),
    is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
    schema_revision INTEGER NOT NULL CHECK (schema_revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS validation_rules (
    rule_id BLOB NOT NULL PRIMARY KEY CHECK (length(rule_id) = 16),
    table_id BLOB NOT NULL REFERENCES schema_tables(table_id) ON DELETE RESTRICT,
    display_name TEXT NOT NULL CHECK (length(display_name) > 0),
    rule_ir_cbor BLOB NOT NULL CHECK (length(rule_ir_cbor) > 0),
    message_key TEXT NOT NULL CHECK (length(message_key) > 0),
    message_parameters_cbor BLOB NOT NULL CHECK (length(message_parameters_cbor) > 0),
    is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
    schema_revision INTEGER NOT NULL CHECK (schema_revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS formulas (
    formula_id BLOB NOT NULL PRIMARY KEY CHECK (length(formula_id) = 16),
    target_kind TEXT NOT NULL CHECK (
        target_kind IN ('computed-column', 'table-metric', 'dashboard-value')
    ),
    table_id BLOB REFERENCES schema_tables(table_id) ON DELETE RESTRICT,
    target_field_id BLOB REFERENCES schema_fields(field_id) ON DELETE RESTRICT,
    display_name TEXT CHECK (display_name IS NULL OR length(display_name) > 0),
    original_text TEXT NOT NULL CHECK (length(original_text) > 0),
    formula_ir_cbor BLOB CHECK (formula_ir_cbor IS NULL OR length(formula_ir_cbor) > 0),
    disposition TEXT NOT NULL CHECK (disposition IN ('live', 'frozen', 'unsupported')),
    determinism TEXT NOT NULL CHECK (
        determinism IN (
            'deterministic', 'clock-volatile', 'frozen-nondeterministic', 'unsupported'
        )
    ),
    metadata_cbor BLOB NOT NULL CHECK (length(metadata_cbor) > 0),
    is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
    schema_revision INTEGER NOT NULL CHECK (schema_revision >= 0),
    CHECK (
        (target_kind = 'computed-column' AND table_id IS NOT NULL AND target_field_id IS NOT NULL) OR
        (target_kind = 'table-metric' AND table_id IS NOT NULL AND target_field_id IS NULL) OR
        (target_kind = 'dashboard-value' AND target_field_id IS NULL)
    ),
    CHECK (
        (disposition = 'live' AND determinism IN ('deterministic', 'clock-volatile')) OR
        (disposition = 'frozen' AND determinism = 'frozen-nondeterministic') OR
        (disposition = 'unsupported' AND determinism = 'unsupported')
    ),
    CHECK (disposition = 'unsupported' OR formula_ir_cbor IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS formula_dependencies (
    formula_id BLOB NOT NULL REFERENCES formulas(formula_id) ON DELETE CASCADE,
    dependency_kind TEXT NOT NULL CHECK (dependency_kind IN ('field', 'formula')),
    dependency_id BLOB NOT NULL CHECK (length(dependency_id) = 16),
    PRIMARY KEY (formula_id, dependency_kind, dependency_id)
) STRICT;

CREATE TABLE IF NOT EXISTS scalar_formula_results (
    formula_id BLOB NOT NULL PRIMARY KEY REFERENCES formulas(formula_id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('ok', 'empty', 'unsupported', 'cycle', 'error')),
    value_cbor BLOB CHECK (value_cbor IS NULL OR length(value_cbor) > 0),
    evaluated_at_ms INTEGER NOT NULL CHECK (evaluated_at_ms >= 0),
    CHECK ((status = 'ok' AND value_cbor IS NOT NULL) OR status <> 'ok')
) STRICT;

CREATE TABLE IF NOT EXISTS records (
    record_pk INTEGER PRIMARY KEY,
    record_id BLOB NOT NULL UNIQUE CHECK (length(record_id) = 16),
    table_id BLOB NOT NULL REFERENCES schema_tables(table_id) ON DELETE RESTRICT,
    record_revision INTEGER NOT NULL CHECK (record_revision >= 0),
    created_commit_id BLOB NOT NULL CHECK (length(created_commit_id) = 16),
    updated_commit_id BLOB NOT NULL CHECK (length(updated_commit_id) = 16),
    authored_cbor BLOB NOT NULL CHECK (length(authored_cbor) > 0)
) STRICT;

CREATE TABLE IF NOT EXISTS cells (
    record_pk INTEGER NOT NULL REFERENCES records(record_pk) ON DELETE CASCADE,
    field_id BLOB NOT NULL REFERENCES schema_fields(field_id) ON DELETE RESTRICT,
    origin TEXT NOT NULL CHECK (origin IN ('authored', 'computed')),
    value_kind TEXT NOT NULL CHECK (value_kind IN ('text', 'decimal', 'integer', 'id')),
    text_value TEXT,
    text_sort_key BLOB,
    decimal_value TEXT,
    decimal_order_key BLOB,
    integer_value INTEGER,
    id_value BLOB,
    PRIMARY KEY (record_pk, field_id),
    CHECK (
        (
            value_kind = 'text' AND text_value IS NOT NULL AND text_sort_key IS NOT NULL AND
            decimal_value IS NULL AND decimal_order_key IS NULL AND
            integer_value IS NULL AND id_value IS NULL
        ) OR
        (
            value_kind = 'decimal' AND decimal_value IS NOT NULL AND
            decimal_order_key IS NOT NULL AND length(decimal_order_key) = 20 AND
            text_value IS NULL AND text_sort_key IS NULL AND
            integer_value IS NULL AND id_value IS NULL
        ) OR
        (
            value_kind = 'integer' AND integer_value IS NOT NULL AND
            text_value IS NULL AND text_sort_key IS NULL AND
            decimal_value IS NULL AND decimal_order_key IS NULL AND id_value IS NULL
        ) OR
        (
            value_kind = 'id' AND id_value IS NOT NULL AND length(id_value) = 16 AND
            text_value IS NULL AND text_sort_key IS NULL AND
            decimal_value IS NULL AND decimal_order_key IS NULL AND integer_value IS NULL
        )
    )
) STRICT;

CREATE TABLE IF NOT EXISTS record_issues (
    issue_id BLOB NOT NULL PRIMARY KEY CHECK (length(issue_id) = 16),
    record_pk INTEGER NOT NULL REFERENCES records(record_pk) ON DELETE CASCADE,
    field_id BLOB REFERENCES schema_fields(field_id) ON DELETE RESTRICT,
    rule_id BLOB REFERENCES validation_rules(rule_id) ON DELETE RESTRICT,
    issue_kind TEXT NOT NULL CHECK (
        issue_kind IN (
            'type', 'required', 'enum', 'broken-reference', 'record-rule',
            'formula', 'schema', 'conflict', 'unsupported'
        )
    ),
    severity TEXT NOT NULL CHECK (severity IN ('warning', 'blocking')),
    message_key TEXT NOT NULL CHECK (length(message_key) > 0),
    message_parameters_cbor BLOB NOT NULL CHECK (length(message_parameters_cbor) > 0),
    provenance_cbor BLOB CHECK (provenance_cbor IS NULL OR length(provenance_cbor) > 0)
) STRICT;

CREATE VIRTUAL TABLE IF NOT EXISTS record_search USING fts5(
    searchable_text,
    content='',
    contentless_delete=1,
    detail=column,
    tokenize='unicode61 remove_diacritics 2',
    prefix='2 3'
);

CREATE TABLE IF NOT EXISTS charts (
    chart_id BLOB NOT NULL PRIMARY KEY CHECK (length(chart_id) = 16),
    display_name TEXT NOT NULL CHECK (length(display_name) > 0),
    chart_type TEXT NOT NULL CHECK (chart_type IN ('bar', 'line', 'pie', 'scatter', 'stacked')),
    definition_cbor BLOB NOT NULL CHECK (length(definition_cbor) > 0),
    is_pinned INTEGER NOT NULL CHECK (is_pinned IN (0, 1)),
    chart_ordinal INTEGER NOT NULL CHECK (chart_ordinal >= 0),
    provenance TEXT NOT NULL CHECK (provenance IN ('imported', 'user')),
    chart_revision INTEGER NOT NULL CHECK (chart_revision >= 0),
    UNIQUE (chart_ordinal)
) STRICT;

CREATE TABLE IF NOT EXISTS inert_content (
    inert_item_id BLOB NOT NULL PRIMARY KEY CHECK (length(inert_item_id) = 16),
    sheet_id BLOB NOT NULL REFERENCES sheet_snapshots(sheet_id) ON DELETE RESTRICT,
    item_kind TEXT NOT NULL CHECK (length(item_kind) > 0),
    source_location TEXT NOT NULL CHECK (length(source_location) > 0),
    reason_key TEXT NOT NULL CHECK (length(reason_key) > 0),
    snapshot_anchor_cbor BLOB CHECK (
        snapshot_anchor_cbor IS NULL OR length(snapshot_anchor_cbor) > 0
    ),
    preserved_manifest_storage_id BLOB CHECK (
        preserved_manifest_storage_id IS NULL OR length(preserved_manifest_storage_id) = 16
    )
) STRICT;

CREATE TABLE IF NOT EXISTS import_lineages (
    lineage_id BLOB NOT NULL PRIMARY KEY CHECK (length(lineage_id) = 16),
    import_kind TEXT NOT NULL CHECK (import_kind IN ('initial', 'reupload')),
    import_ordinal INTEGER NOT NULL UNIQUE CHECK (import_ordinal >= 0),
    source_display_name TEXT NOT NULL CHECK (length(source_display_name) > 0),
    source_sha256 BLOB NOT NULL CHECK (length(source_sha256) = 32),
    accepted_at_ms INTEGER NOT NULL CHECK (accepted_at_ms >= 0),
    identity_decisions_cbor BLOB NOT NULL CHECK (length(identity_decisions_cbor) > 0),
    accepted_commit_id BLOB NOT NULL CHECK (length(accepted_commit_id) = 16)
) STRICT;

CREATE TABLE IF NOT EXISTS inference_decisions (
    decision_id BLOB NOT NULL PRIMARY KEY CHECK (length(decision_id) = 16),
    decision_kind TEXT NOT NULL CHECK (
        decision_kind IN (
            'header', 'discarded-row', 'table-split', 'table-merge', 'column-type',
            'enum', 'relationship', 'formula', 'sheet-classification', 'record-rule'
        )
    ),
    evidence_fingerprint_sha256 BLOB NOT NULL CHECK (
        length(evidence_fingerprint_sha256) = 32
    ),
    disposition TEXT NOT NULL CHECK (disposition IN ('accepted', 'rejected', 'edited')),
    statement_cbor BLOB NOT NULL CHECK (length(statement_cbor) > 0),
    evidence_cbor BLOB NOT NULL CHECK (length(evidence_cbor) > 0),
    recorded_event_id BLOB NOT NULL CHECK (length(recorded_event_id) = 16),
    UNIQUE (decision_kind, evidence_fingerprint_sha256)
) STRICT;

CREATE TABLE IF NOT EXISTS baseline_scopes (
    baseline_scope_id BLOB NOT NULL PRIMARY KEY CHECK (length(baseline_scope_id) = 16),
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('import', 'durable-home')),
    import_lineage_id BLOB REFERENCES import_lineages(lineage_id) ON DELETE RESTRICT,
    durable_home_id BLOB CHECK (durable_home_id IS NULL OR length(durable_home_id) = 16),
    counterpart_id BLOB CHECK (counterpart_id IS NULL OR length(counterpart_id) = 16),
    established_generation INTEGER CHECK (
        established_generation IS NULL OR established_generation > 0
    ),
    established_frontier_cbor BLOB NOT NULL CHECK (length(established_frontier_cbor) > 0),
    established_at_ms INTEGER NOT NULL CHECK (established_at_ms >= 0),
    CHECK (
        (scope_kind = 'import' AND import_lineage_id IS NOT NULL AND
            durable_home_id IS NULL AND counterpart_id IS NULL AND
            established_generation IS NULL) OR
        (scope_kind = 'durable-home' AND import_lineage_id IS NULL AND
            durable_home_id IS NOT NULL AND counterpart_id IS NOT NULL AND
            established_generation IS NOT NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS baseline_records (
    baseline_scope_id BLOB NOT NULL REFERENCES baseline_scopes(baseline_scope_id) ON DELETE CASCADE,
    table_id BLOB NOT NULL REFERENCES schema_tables(table_id) ON DELETE RESTRICT,
    record_id BLOB NOT NULL CHECK (length(record_id) = 16),
    baseline_state TEXT NOT NULL CHECK (baseline_state IN ('present', 'deleted', 'absent')),
    value_cbor BLOB,
    absent_reason TEXT,
    source_frontier_cbor BLOB NOT NULL CHECK (length(source_frontier_cbor) > 0),
    PRIMARY KEY (baseline_scope_id, table_id, record_id),
    CHECK (value_cbor IS NULL OR length(value_cbor) > 0),
    CHECK (absent_reason IS NULL OR length(absent_reason) > 0),
    CHECK (
        (baseline_state = 'present' AND value_cbor IS NOT NULL AND absent_reason IS NULL) OR
        (baseline_state = 'deleted' AND value_cbor IS NULL AND absent_reason IS NULL) OR
        (baseline_state = 'absent' AND value_cbor IS NULL AND absent_reason IS NOT NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS pending_conflicts (
    conflict_id BLOB NOT NULL PRIMARY KEY CHECK (length(conflict_id) = 16),
    table_id BLOB NOT NULL REFERENCES schema_tables(table_id) ON DELETE RESTRICT,
    record_id BLOB NOT NULL CHECK (length(record_id) = 16),
    baseline_scope_id BLOB REFERENCES baseline_scopes(baseline_scope_id) ON DELETE RESTRICT,
    conflict_kind TEXT NOT NULL CHECK (
        conflict_kind IN (
            'field', 'key', 'delete-edit', 'baseline-absent',
            'record-validation', 'schema', 'identity'
        )
    ),
    baseline_cbor BLOB CHECK (baseline_cbor IS NULL OR length(baseline_cbor) > 0),
    local_version_cbor BLOB NOT NULL CHECK (length(local_version_cbor) > 0),
    incoming_version_cbor BLOB NOT NULL CHECK (length(incoming_version_cbor) > 0),
    conflicting_fields_cbor BLOB NOT NULL CHECK (length(conflicting_fields_cbor) > 0),
    validation_report_cbor BLOB CHECK (
        validation_report_cbor IS NULL OR length(validation_report_cbor) > 0
    ),
    local_source TEXT NOT NULL CHECK (local_source IN ('this-device', 'another-device', 'uploaded-file')),
    incoming_source TEXT NOT NULL CHECK (
        incoming_source IN ('this-device', 'another-device', 'uploaded-file')
    ),
    local_timestamp_ms INTEGER NOT NULL CHECK (local_timestamp_ms >= 0),
    incoming_timestamp_ms INTEGER NOT NULL CHECK (incoming_timestamp_ms >= 0),
    detected_at_ms INTEGER NOT NULL CHECK (detected_at_ms >= 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'resolved')),
    detected_event_id BLOB NOT NULL CHECK (length(detected_event_id) = 16),
    resolved_event_id BLOB CHECK (resolved_event_id IS NULL OR length(resolved_event_id) = 16),
    CHECK (
        conflict_kind IN ('schema', 'identity') OR baseline_scope_id IS NOT NULL
    ),
    CHECK (
        conflict_kind IN ('schema', 'identity') OR baseline_cbor IS NOT NULL
    ),
    CHECK (
        conflict_kind NOT IN ('record-validation', 'schema') OR
        validation_report_cbor IS NOT NULL
    ),
    CHECK (
        (status = 'pending' AND resolved_event_id IS NULL) OR
        (status = 'resolved' AND resolved_event_id IS NOT NULL)
    )
) STRICT;

CREATE TABLE IF NOT EXISTS applied_merges (
    merge_id BLOB NOT NULL PRIMARY KEY CHECK (length(merge_id) = 16),
    table_id BLOB NOT NULL REFERENCES schema_tables(table_id) ON DELETE RESTRICT,
    record_id BLOB NOT NULL CHECK (length(record_id) = 16),
    baseline_scope_id BLOB NOT NULL REFERENCES baseline_scopes(baseline_scope_id) ON DELETE RESTRICT,
    local_commit_id BLOB NOT NULL CHECK (length(local_commit_id) = 16),
    incoming_commit_id BLOB NOT NULL CHECK (length(incoming_commit_id) = 16),
    result_commit_id BLOB NOT NULL CHECK (length(result_commit_id) = 16),
    validation_report_cbor BLOB NOT NULL CHECK (length(validation_report_cbor) > 0),
    explanation_cbor BLOB NOT NULL CHECK (length(explanation_cbor) > 0),
    applied_at_ms INTEGER NOT NULL CHECK (applied_at_ms >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS change_history (
    event_id BLOB NOT NULL PRIMARY KEY CHECK (length(event_id) = 16),
    commit_id BLOB NOT NULL CHECK (length(commit_id) = 16),
    event_index INTEGER NOT NULL CHECK (event_index >= 0),
    event_kind TEXT NOT NULL CHECK (length(event_kind) > 0),
    event_class TEXT NOT NULL CHECK (
        event_class IN ('authored', 'import', 'reconciliation', 'system')
    ),
    subject_kind TEXT NOT NULL CHECK (
        subject_kind IN ('app', 'table', 'field', 'record', 'chart', 'rule', 'formula', 'home', 'conflict')
    ),
    subject_id BLOB NOT NULL CHECK (length(subject_id) = 16),
    wall_time_ms INTEGER NOT NULL CHECK (wall_time_ms >= 0),
    logical_counter INTEGER NOT NULL CHECK (logical_counter >= 0),
    device_id BLOB NOT NULL CHECK (length(device_id) = 16),
    summary_cbor BLOB NOT NULL CHECK (length(summary_cbor) > 0),
    restoration_cbor BLOB CHECK (restoration_cbor IS NULL OR length(restoration_cbor) > 0),
    UNIQUE (commit_id, event_index)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_schema_fields_table_ordinal
    ON schema_fields (table_id, field_ordinal);
CREATE INDEX IF NOT EXISTS idx_enum_options_field_ordinal
    ON enum_options (field_id, option_ordinal);
CREATE INDEX IF NOT EXISTS idx_relationships_parent
    ON relationships (to_table_id, to_key_field_id, is_active);
CREATE INDEX IF NOT EXISTS idx_validation_rules_table_active
    ON validation_rules (table_id, is_active);
CREATE INDEX IF NOT EXISTS idx_formulas_table_target
    ON formulas (table_id, target_kind, is_active);
CREATE INDEX IF NOT EXISTS idx_formula_dependencies_dependency
    ON formula_dependencies (dependency_kind, dependency_id, formula_id);
CREATE INDEX IF NOT EXISTS idx_records_table_row
    ON records (table_id, record_pk);
CREATE INDEX IF NOT EXISTS idx_cells_field_text
    ON cells (field_id, text_sort_key, record_pk)
    WHERE value_kind = 'text';
CREATE INDEX IF NOT EXISTS idx_cells_field_decimal
    ON cells (field_id, decimal_order_key, record_pk)
    WHERE value_kind = 'decimal';
CREATE INDEX IF NOT EXISTS idx_cells_field_integer
    ON cells (field_id, integer_value, record_pk)
    WHERE value_kind = 'integer';
CREATE INDEX IF NOT EXISTS idx_cells_field_id
    ON cells (field_id, id_value, record_pk)
    WHERE value_kind = 'id';
CREATE INDEX IF NOT EXISTS idx_record_issues_record
    ON record_issues (record_pk, severity, issue_kind);
CREATE INDEX IF NOT EXISTS idx_charts_pinned_ordinal
    ON charts (is_pinned, chart_ordinal);
CREATE INDEX IF NOT EXISTS idx_inert_content_sheet
    ON inert_content (sheet_id, item_kind);
CREATE INDEX IF NOT EXISTS idx_baseline_records_record
    ON baseline_records (table_id, record_id, baseline_scope_id);
CREATE INDEX IF NOT EXISTS idx_pending_conflicts_queue
    ON pending_conflicts (status, detected_at_ms, conflict_id);
CREATE INDEX IF NOT EXISTS idx_pending_conflicts_record
    ON pending_conflicts (table_id, record_id, status);
CREATE INDEX IF NOT EXISTS idx_applied_merges_recent
    ON applied_merges (applied_at_ms DESC, merge_id);
CREATE INDEX IF NOT EXISTS idx_applied_merges_record
    ON applied_merges (table_id, record_id, applied_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_change_history_recent
    ON change_history (wall_time_ms DESC, logical_counter DESC, event_id);
CREATE INDEX IF NOT EXISTS idx_change_history_subject
    ON change_history (subject_kind, subject_id, wall_time_ms DESC, event_id);

CREATE TRIGGER IF NOT EXISTS trg_app_state_insert_guard
BEFORE INSERT ON app_state
WHEN NOT EXISTS (
    SELECT 1 FROM projection_meta AS p
     WHERE p.singleton = 1 AND p.app_id = NEW.app_id
)
BEGIN
    SELECT RAISE(ABORT, 'app state does not match projection metadata');
END;

CREATE TRIGGER IF NOT EXISTS trg_app_state_update_guard
BEFORE UPDATE OF app_id ON app_state
WHEN NOT EXISTS (
    SELECT 1 FROM projection_meta AS p
     WHERE p.singleton = 1 AND p.app_id = NEW.app_id
)
BEGIN
    SELECT RAISE(ABORT, 'app state does not match projection metadata');
END;

CREATE TRIGGER IF NOT EXISTS trg_projection_identity_immutable
BEFORE UPDATE OF app_id ON projection_meta
BEGIN
    SELECT RAISE(ABORT, 'projection app identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_schema_tables_field_refs_insert_guard
BEFORE INSERT ON schema_tables
WHEN (
    NEW.key_field_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM schema_fields AS f
         WHERE f.field_id = NEW.key_field_id
           AND f.table_id = NEW.table_id
           AND f.is_active = 1
           AND f.is_computed = 0
    )
) OR (
    NEW.label_field_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM schema_fields AS f
         WHERE f.field_id = NEW.label_field_id
           AND f.table_id = NEW.table_id
           AND f.is_active = 1
    )
)
BEGIN
    SELECT RAISE(ABORT, 'table key/label fields must belong to the table');
END;

CREATE TRIGGER IF NOT EXISTS trg_schema_tables_field_refs_update_guard
BEFORE UPDATE OF key_field_id, label_field_id ON schema_tables
WHEN (
    NEW.key_field_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM schema_fields AS f
         WHERE f.field_id = NEW.key_field_id
           AND f.table_id = NEW.table_id
           AND f.is_active = 1
           AND f.is_computed = 0
    )
) OR (
    NEW.label_field_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM schema_fields AS f
         WHERE f.field_id = NEW.label_field_id
           AND f.table_id = NEW.table_id
           AND f.is_active = 1
    )
)
BEGIN
    SELECT RAISE(ABORT, 'table key/label fields must belong to the table');
END;

CREATE TRIGGER IF NOT EXISTS trg_schema_fields_update_table_refs_guard
BEFORE UPDATE OF is_active, is_computed ON schema_fields
WHEN (
    (NEW.is_active <> 1 OR NEW.is_computed <> 0) AND EXISTS (
        SELECT 1 FROM schema_tables AS t WHERE t.key_field_id = NEW.field_id
    )
) OR (
    NEW.is_active <> 1 AND EXISTS (
        SELECT 1 FROM schema_tables AS t WHERE t.label_field_id = NEW.field_id
    )
)
BEGIN
    SELECT RAISE(ABORT, 'active table key/label references must remain valid');
END;

CREATE TRIGGER IF NOT EXISTS trg_cells_insert_guard
BEFORE INSERT ON cells
WHEN NOT EXISTS (
    SELECT 1
      FROM records AS r
      JOIN schema_fields AS f ON f.field_id = NEW.field_id
     WHERE r.record_pk = NEW.record_pk
       AND r.table_id = f.table_id
       AND f.storage_kind = NEW.value_kind
       AND f.is_computed = CASE NEW.origin WHEN 'computed' THEN 1 ELSE 0 END
       AND (f.logical_type <> 'boolean' OR NEW.integer_value IN (0, 1))
)
BEGIN
    SELECT RAISE(ABORT, 'cell violates field/table/type ownership');
END;

CREATE TRIGGER IF NOT EXISTS trg_cells_update_guard
BEFORE UPDATE ON cells
WHEN NOT EXISTS (
    SELECT 1
      FROM records AS r
      JOIN schema_fields AS f ON f.field_id = NEW.field_id
     WHERE r.record_pk = NEW.record_pk
       AND r.table_id = f.table_id
       AND f.storage_kind = NEW.value_kind
       AND f.is_computed = CASE NEW.origin WHEN 'computed' THEN 1 ELSE 0 END
       AND (f.logical_type <> 'boolean' OR NEW.integer_value IN (0, 1))
)
BEGIN
    SELECT RAISE(ABORT, 'cell violates field/table/type ownership');
END;

CREATE TRIGGER IF NOT EXISTS trg_enum_options_insert_guard
BEFORE INSERT ON enum_options
WHEN NOT EXISTS (
    SELECT 1 FROM schema_fields AS f
     WHERE f.field_id = NEW.field_id AND f.logical_type = 'enum'
)
BEGIN
    SELECT RAISE(ABORT, 'enum option belongs to a non-enum field');
END;

CREATE TRIGGER IF NOT EXISTS trg_enum_options_update_guard
BEFORE UPDATE ON enum_options
WHEN NOT EXISTS (
    SELECT 1 FROM schema_fields AS f
     WHERE f.field_id = NEW.field_id AND f.logical_type = 'enum'
)
BEGIN
    SELECT RAISE(ABORT, 'enum option belongs to a non-enum field');
END;

CREATE TRIGGER IF NOT EXISTS trg_relationships_insert_guard
BEFORE INSERT ON relationships
WHEN NOT EXISTS (
    SELECT 1
      FROM schema_fields AS source_field
      JOIN schema_fields AS target_field ON target_field.field_id = NEW.to_key_field_id
      JOIN schema_tables AS target_table ON target_table.table_id = NEW.to_table_id
     WHERE source_field.field_id = NEW.from_field_id
       AND source_field.table_id = NEW.from_table_id
       AND source_field.logical_type = 'reference'
       AND target_field.table_id = NEW.to_table_id
       AND target_table.key_field_id = NEW.to_key_field_id
)
BEGIN
    SELECT RAISE(ABORT, 'relationship endpoints do not match their tables and keys');
END;

CREATE TRIGGER IF NOT EXISTS trg_relationships_update_guard
BEFORE UPDATE ON relationships
WHEN NOT EXISTS (
    SELECT 1
      FROM schema_fields AS source_field
      JOIN schema_fields AS target_field ON target_field.field_id = NEW.to_key_field_id
      JOIN schema_tables AS target_table ON target_table.table_id = NEW.to_table_id
     WHERE source_field.field_id = NEW.from_field_id
       AND source_field.table_id = NEW.from_table_id
       AND source_field.logical_type = 'reference'
       AND target_field.table_id = NEW.to_table_id
       AND target_table.key_field_id = NEW.to_key_field_id
)
BEGIN
    SELECT RAISE(ABORT, 'relationship endpoints do not match their tables and keys');
END;

CREATE TRIGGER IF NOT EXISTS trg_formulas_insert_guard
BEFORE INSERT ON formulas
WHEN NEW.target_kind = 'computed-column' AND NOT EXISTS (
    SELECT 1 FROM schema_fields AS f
     WHERE f.field_id = NEW.target_field_id
       AND f.table_id = NEW.table_id
       AND f.is_computed = 1
       AND f.formula_id = NEW.formula_id
)
BEGIN
    SELECT RAISE(ABORT, 'computed formula target does not match its field');
END;

CREATE TRIGGER IF NOT EXISTS trg_formulas_update_guard
BEFORE UPDATE ON formulas
WHEN NEW.target_kind = 'computed-column' AND NOT EXISTS (
    SELECT 1 FROM schema_fields AS f
     WHERE f.field_id = NEW.target_field_id
       AND f.table_id = NEW.table_id
       AND f.is_computed = 1
       AND f.formula_id = NEW.formula_id
)
BEGIN
    SELECT RAISE(ABORT, 'computed formula target does not match its field');
END;

CREATE TRIGGER IF NOT EXISTS trg_formula_dependencies_insert_guard
BEFORE INSERT ON formula_dependencies
WHEN (
    NEW.dependency_kind = 'field' AND NOT EXISTS (
        SELECT 1 FROM schema_fields AS f WHERE f.field_id = NEW.dependency_id
    )
) OR (
    NEW.dependency_kind = 'formula' AND NOT EXISTS (
        SELECT 1 FROM formulas AS f WHERE f.formula_id = NEW.dependency_id
    )
)
BEGIN
    SELECT RAISE(ABORT, 'formula dependency target does not exist');
END;

CREATE TRIGGER IF NOT EXISTS trg_formula_dependencies_update_guard
BEFORE UPDATE OF dependency_kind, dependency_id ON formula_dependencies
WHEN (
    NEW.dependency_kind = 'field' AND NOT EXISTS (
        SELECT 1 FROM schema_fields AS f WHERE f.field_id = NEW.dependency_id
    )
) OR (
    NEW.dependency_kind = 'formula' AND NOT EXISTS (
        SELECT 1 FROM formulas AS f WHERE f.formula_id = NEW.dependency_id
    )
)
BEGIN
    SELECT RAISE(ABORT, 'formula dependency target does not exist');
END;

CREATE TRIGGER IF NOT EXISTS trg_record_issues_insert_guard
BEFORE INSERT ON record_issues
WHEN (
    NEW.field_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM records AS r
          JOIN schema_fields AS f ON f.field_id = NEW.field_id
         WHERE r.record_pk = NEW.record_pk AND r.table_id = f.table_id
    )
) OR (
    NEW.rule_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM records AS r
          JOIN validation_rules AS v ON v.rule_id = NEW.rule_id
         WHERE r.record_pk = NEW.record_pk AND r.table_id = v.table_id
    )
)
BEGIN
    SELECT RAISE(ABORT, 'record issue source belongs to another table');
END;

CREATE TRIGGER IF NOT EXISTS trg_record_issues_update_guard
BEFORE UPDATE OF record_pk, field_id, rule_id ON record_issues
WHEN (
    NEW.field_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM records AS r
          JOIN schema_fields AS f ON f.field_id = NEW.field_id
         WHERE r.record_pk = NEW.record_pk AND r.table_id = f.table_id
    )
) OR (
    NEW.rule_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
          FROM records AS r
          JOIN validation_rules AS v ON v.rule_id = NEW.rule_id
         WHERE r.record_pk = NEW.record_pk AND r.table_id = v.table_id
    )
)
BEGIN
    SELECT RAISE(ABORT, 'record issue source belongs to another table');
END;

CREATE TRIGGER IF NOT EXISTS trg_record_identity_immutable
BEFORE UPDATE OF record_id, table_id ON records
BEGIN
    SELECT RAISE(ABORT, 'record identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_table_identity_immutable
BEFORE UPDATE OF table_id ON schema_tables
BEGIN
    SELECT RAISE(ABORT, 'table identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_field_identity_immutable
BEFORE UPDATE OF field_id, table_id ON schema_fields
BEGIN
    SELECT RAISE(ABORT, 'field identity and ownership are immutable');
END;

PRAGMA user_version = 1;

COMMIT;
