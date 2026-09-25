import { constantTimeEquals } from "../../domain/model/bytes.js";
import { IntegrityError } from "../../domain/model/errors.js";
import type { FrontierEntryV1 } from "../../migrations/004_event_format_v1.js";
import { encodeCanonical, type CborValue } from "../codecs/canonical-cbor.js";
import { encodeFrontier } from "./cbor-values.js";
import { assertUsable, run, selectRow, toSqlInteger, withTransaction, type ProjectionHandleV1, type SqlParam } from "./engine.js";
const EVIDENCE_TABLES = [
  { table: "baseline_scopes", order: "baseline_scope_id", columns: "baseline_scope_id, scope_kind, import_lineage_id, durable_home_id, counterpart_id, established_generation, established_frontier_cbor, established_at_ms" },
  { table: "baseline_records", order: "baseline_scope_id, table_id, record_id", columns: "baseline_scope_id, table_id, record_id, baseline_state, value_cbor, absent_reason, source_frontier_cbor" },
  { table: "pending_conflicts", order: "conflict_id", columns: "conflict_id, table_id, record_id, baseline_scope_id, conflict_kind, baseline_cbor, local_version_cbor, incoming_version_cbor, conflicting_fields_cbor, validation_report_cbor, local_source, incoming_source, local_timestamp_ms, incoming_timestamp_ms, detected_at_ms, status, detected_event_id, resolved_event_id" },
  { table: "applied_merges", order: "merge_id", columns: "merge_id, table_id, record_id, baseline_scope_id, local_commit_id, incoming_commit_id, result_commit_id, validation_report_cbor, explanation_cbor, applied_at_ms" },
  { table: "change_history", order: "event_id", columns: "event_id, commit_id, event_index, event_kind, event_class, subject_kind, subject_id, wall_time_ms, logical_counter, device_id, summary_cbor, restoration_cbor" },
] as const;

export interface ProjectionBaselineV1 {
  readonly scope: {
    readonly scopeId: Uint8Array;
    readonly scopeKind: "import" | "durable-home";
    readonly importLineageId: Uint8Array | null;
    readonly durableHomeId: Uint8Array | null;
    readonly counterpartId: Uint8Array | null;
    readonly establishedGeneration: bigint | null;
    readonly establishedFrontier: readonly FrontierEntryV1[];
    readonly establishedAtMs: number;
  };
  readonly entries: readonly {
    readonly tableId: Uint8Array;
    readonly recordId: Uint8Array;
    readonly state: "present" | "deleted" | "absent";
    readonly values: Uint8Array | null;
    readonly absentReason: string | null;
    readonly sourceFrontier: readonly FrontierEntryV1[];
  }[];
}

/** Authenticated scope and row facts; conflicts cannot supply missing authority. */
export async function hydrateBaselines(handle: ProjectionHandleV1, pages: AsyncIterable<ProjectionBaselineV1>, signal: AbortSignal): Promise<void> {
  assertUsable(handle);
  for await (const { scope, entries } of pages) {
    signal.throwIfAborted();
    const values: SqlParam[] = [scope.scopeKind, scope.importLineageId, scope.durableHomeId, scope.counterpartId,
      scope.establishedGeneration === null ? null : toSqlInteger(scope.establishedGeneration),
      encodeFrontier(scope.establishedFrontier), toSqlInteger(BigInt(scope.establishedAtMs))];
    await withTransaction(handle, () => {
      const existing = selectRow(handle, "SELECT scope_kind, import_lineage_id, durable_home_id, counterpart_id, established_generation, established_frontier_cbor, established_at_ms FROM baseline_scopes WHERE baseline_scope_id = ?", [scope.scopeId]);
      if (existing === null) {
        run(handle, "INSERT INTO baseline_scopes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [scope.scopeId, ...values]);
      } else if (existing.some((value, index) => value instanceof Uint8Array
        ? !(values[index] instanceof Uint8Array) || !constantTimeEquals(value, values[index])
        : value !== values[index])) throw new IntegrityError("conflicting baseline scope descriptors");
      for (const entry of entries) {
        signal.throwIfAborted();
        run(handle, "INSERT INTO baseline_records VALUES (?, ?, ?, ?, ?, ?, ?)",
          [scope.scopeId, entry.tableId, entry.recordId, entry.state, entry.values, entry.absentReason, encodeFrontier(entry.sourceFrontier)]);
      }
    });
  }
}

/** Copies independently replayed history without applying its mutations twice. */
export async function copyCheckpointHistory(source: ProjectionHandleV1, target: ProjectionHandleV1, signal: AbortSignal): Promise<void> {
  assertUsable(source);
  assertUsable(target);
  signal.throwIfAborted();
  const sourceApp = selectRow(source, "SELECT app_id FROM app_state")?.[0];
  const targetApp = selectRow(target, "SELECT app_id FROM app_state")?.[0];
  if (!(sourceApp instanceof Uint8Array) || !(targetApp instanceof Uint8Array) || !constantTimeEquals(sourceApp, targetApp) ||
      Number(selectRow(target, "SELECT count(*) FROM change_history")?.[0]) !== 0) throw new IntegrityError("history copy requires the same app and an empty target");
  const sequence = (handle: ProjectionHandleV1) => [...handle.frontier].map(([key, entry]) => `${key}:${entry.commitSequence}`).sort().join("|");
  if (sequence(source) !== sequence(target)) throw new IntegrityError("history frontier mismatch");
  for (const { table } of EVIDENCE_TABLES) {
    if (Number(selectRow(target, `SELECT count(*) FROM ${table}`)?.[0]) !== 0) throw new IntegrityError("history copy requires empty evidence tables");
  }
  await withTransaction(target, () => {
    for (const { table, columns, order } of EVIDENCE_TABLES) {
      const statement = source.database.prepare(`SELECT ${columns} FROM ${table} ORDER BY ${order}`);
      const insert = `INSERT INTO ${table} (${columns}) VALUES (${columns.split(",").map(() => "?").join(", ")})`;
      try {
        while (statement.step()) {
          signal.throwIfAborted();
          const values = statement.get([]).map((value): SqlParam => {
            if (typeof value === "bigint") return toSqlInteger(value);
            if (value === null || typeof value === "string" || typeof value === "number" || value instanceof Uint8Array) return value;
            throw new IntegrityError("unexpected evidence SQL value");
          });
          run(target, insert, values);
        }
      } finally { if (!source.disposed) statement.finalize(); }
    }
  });
}


/** Separate from authored-state hashing: every original evidence/history SQL column. */
export function* checkpointEvidence(handle: ProjectionHandleV1, signal: AbortSignal): Iterable<Uint8Array> {
  assertUsable(handle);
  const frontier = encodeFrontier([...handle.frontier.values()]);
  for (const { table, columns, order } of EVIDENCE_TABLES) {
    const statement = handle.database.prepare(`SELECT ${columns} FROM ${table} ORDER BY ${order}`);
    try {
      while (statement.step()) {
        signal.throwIfAborted();
        assertUsable(handle);
        if (!constantTimeEquals(frontier, encodeFrontier([...handle.frontier.values()]))) throw new IntegrityError("evidence export changed");
        yield encodeCanonical([table, statement.get([]) as CborValue[]]);
      }
    } finally { if (!handle.disposed) statement.finalize(); }
  }
}
