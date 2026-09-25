import { asDomainId, compareDomainIds } from "../../domain/model/ids.js";
import { IntegrityError } from "../../domain/model/errors.js";
import { decodeMessageParameters, decodeRuleIR } from "./cbor-values.js";
import { assertUsable, selectRows, type ProjectionHandleV1 } from "./engine.js";
import { executeQuery } from "./query-exec.js";
import type { ProjectionCheckpointV1 } from "./types.js";

/** Exports authored definitions, including disabled schema; records are streamed separately. */
export function checkpointMetadata(handle: ProjectionHandleV1, prior: ProjectionCheckpointV1): ProjectionCheckpointV1 {
  assertUsable(handle);
  if (!handle.hydrated) throw new IntegrityError("projection holds no authored state");
  const validationRules = selectRows(handle, "SELECT table_id, display_name, rule_ir_cbor, message_parameters_cbor, is_active, schema_revision FROM validation_rules ORDER BY rule_id")
    .map((row) => ({ tableId: asDomainId("table", row[0] as Uint8Array), displayName: row[1] as string,
      rule: decodeRuleIR(row[2] as Uint8Array, decodeMessageParameters(row[3] as Uint8Array)), isActive: row[4] === 1, schemaRevision: BigInt(row[5] as number) }));
  return { ...prior, frontier: [...handle.frontier.values()].sort((a, b) => compareDomainIds(a.deviceId, b.deviceId)),
    appState: executeQuery(handle, { kind: "app-state" }),
    tables: [...handle.schema.tables].map(([key, table]) => ({ ...table, fields: [...(handle.schema.fieldsByTable.get(key) ?? [])] }))
      .sort((a, b) => a.tableOrdinal - b.tableOrdinal),
    enumOptions: [...handle.schema.enumOptions.values()].flat(), relationships: [...handle.schema.relationships.values()], validationRules,
    sheetSnapshots: executeQuery(handle, { kind: "list-sheet-snapshots" }).map(({ sheet }) => sheet),
    formulas: [...handle.schema.formulas.values()], charts: executeQuery(handle, { kind: "list-charts" }),
    inertItems: executeQuery(handle, { kind: "list-inert-items", sheetId: null }),
    inferenceDecisions: executeQuery(handle, { kind: "list-inference-decisions", decisionKind: null }), recordPages: [] };
}
