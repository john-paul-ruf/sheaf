import { asDomainId, compareDomainIds } from "../../domain/model/ids.js";
import { IntegrityError } from "../../domain/model/errors.js";
import { CanonicalArray, encodeCanonicalChunks, type CanonicalStreamValue, type CborValue } from "../codecs/canonical-cbor.js";
import { assertUsable, selectRow, type ProjectionHandleV1 } from "./engine.js";
import { executeQuery } from "./query-exec.js";
import type { ProjectionRecordV1 } from "./types.js";

// Only authored facts: no row keys, typed lanes, formula results or local status.
const SECTIONS = [
  ["app", "SELECT app_id, display_name, created_at_ms, schema_revision, theme_cbor FROM app_state ORDER BY app_id", "app_state"],
  ["tables", "SELECT * FROM schema_tables ORDER BY table_id", "schema_tables"],
  ["options", "SELECT * FROM enum_options ORDER BY option_id", "enum_options"],
  ["relationships", "SELECT * FROM relationships ORDER BY relationship_id", "relationships"],
  ["rules", "SELECT * FROM validation_rules ORDER BY rule_id", "validation_rules"],
  ["formulas", "SELECT * FROM formulas ORDER BY formula_id", "formulas"],
  ["dependencies", "SELECT * FROM formula_dependencies ORDER BY formula_id, dependency_kind, dependency_id", "formula_dependencies"],
  ["charts", "SELECT * FROM charts ORDER BY chart_id", "charts"],
  ["sheets", "SELECT * FROM sheet_snapshots ORDER BY sheet_id", "sheet_snapshots"],
  ["inert", "SELECT * FROM inert_content ORDER BY inert_item_id", "inert_content"],
  ["lineages", "SELECT * FROM import_lineages ORDER BY lineage_id", "import_lineages"],
  ["decisions", "SELECT * FROM inference_decisions ORDER BY decision_id", "inference_decisions"],
  ["records", "SELECT record_id, table_id, record_revision, created_commit_id, updated_commit_id, authored_cbor FROM records ORDER BY table_id, record_id", "records"],
  ["restoration", "SELECT event_id, subject_id, summary_cbor, restoration_cbor FROM change_history WHERE restoration_cbor IS NOT NULL ORDER BY event_id", "change_history WHERE restoration_cbor IS NOT NULL"],
] as const;

/** Streams actual SQL row metadata and authored values, excluding computed lanes. */
export function* authoredRecords(handle: ProjectionHandleV1, signal: AbortSignal): Iterable<ProjectionRecordV1> {
  assertUsable(handle);
  if (!handle.hydrated) throw new IntegrityError("projection holds no authored state");
  const frontier = [...handle.frontier].map(([id, entry]) => `${id}:${entry.commitSequence}`).join("|");
  signal.throwIfAborted();
  const statement = handle.database.prepare("SELECT record_id FROM records ORDER BY table_id, record_id");
  let closed = false;
  const close = () => {
    if (!closed && !handle.disposed) statement.finalize();
    closed = true;
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      assertUsable(handle);
      if (frontier !== [...handle.frontier].map(([id, entry]) => `${id}:${entry.commitSequence}`).join("|")) throw new IntegrityError("record export changed during reading");
      if (!statement.step()) break;
      const recordId = asDomainId("record", statement.get([])[0] as Uint8Array);
      const detail = executeQuery(handle, { kind: "record-by-id", recordId });
      if (detail === null) throw new IntegrityError("record disappeared during export");
      yield { record: { recordId, tableId: detail.tableId, values: detail.authoredValues, provenance: detail.provenance },
        recordRevision: detail.recordRevision, createdCommitId: detail.createdCommitId, updatedCommitId: detail.updatedCommitId,
        issues: detail.issues.filter((issue) => issue.issueKind !== "formula" && issue.messageKey !== "validation.decimal-out-of-domain")
          .map((issue) => ({ fieldId: issue.fieldId, ruleId: issue.ruleId, kind: issue.issueKind, severity: issue.severity,
            messageKey: issue.messageKey, messageParameters: issue.messageParameters })) };
    }
  } finally { signal.removeEventListener("abort", close); close(); }
}

/** Caller holds an isolated, hydrated snapshot until the cursor closes. */
export async function* authoredState(handle: ProjectionHandleV1, signal: AbortSignal, extra: ReadonlyMap<string, CanonicalStreamValue> = new Map()): AsyncIterable<Uint8Array> {
  assertUsable(handle);
  if (!handle.hydrated) throw new IntegrityError("projection holds no authored state");
  const frontier = [...handle.frontier].map(([id, entry]) => `${id}:${entry.commitSequence}`).join("|");
  const check = () => {
    signal.throwIfAborted();
    assertUsable(handle);
    if (frontier !== [...handle.frontier].map(([id, entry]) => `${id}:${entry.commitSequence}`).join("|")) {
      throw new IntegrityError("authored-state cursor changed during reading");
    }
  };
  const state = new Map<string, CanonicalStreamValue>([...extra, ["appId", selectRow(handle, "SELECT app_id FROM app_state")![0] as Uint8Array]]);
  for (const [name, sql, table] of SECTIONS) {
    const count = Number(selectRow(handle, `SELECT count(*) FROM ${table}`)![0]);
    state.set(name, new CanonicalArray(count, function* () {
      check();
      const statement = handle.database.prepare(sql);
      let closed = false;
      const close = () => {
        if (!closed && !handle.disposed) statement.finalize();
        closed = true;
      };
      signal.addEventListener("abort", close, { once: true });
      try {
        while (statement.step()) {
          check();
          yield statement.get([]) as CborValue[];
        }
      } finally { signal.removeEventListener("abort", close); close(); }
    }));
  }
  // The field cache preserves complete definitions (e.g. currency code), which
  // the SQL search lanes intentionally do not duplicate.
  const fields = [...handle.schema.fields.values()].sort((a, b) => compareDomainIds(a.fieldId, b.fieldId));
  state.set("fields", new CanonicalArray(fields.length, function* () {
    for (const field of fields) {
      check();
      yield new Map<string, CborValue>([
        ["fieldId", field.fieldId], ["tableId", field.tableId], ["displayName", field.displayName],
        ["fieldOrdinal", field.fieldOrdinal], ["type", new Map(Object.entries(field.type))],
        ["isRequired", field.isRequired], ["isActive", field.isActive],
        ["schemaRevision", field.schemaRevision], ["formulaId", field.formulaId ?? null],
      ]);
    }
  }));
  for await (const chunk of encodeCanonicalChunks(state, signal)) { check(); yield chunk; }
  check();
}
