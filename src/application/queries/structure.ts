/**
 * The app's structure and its metrics, as SCR-035 and app home read them
 * (M35; CAP-28/29/35/36; CA-25, CA-26, CA-27).
 *
 * Everything here is read through M07's closed query surface and nothing is
 * evaluated: a formula's text is **rendered from its IR** with the names the
 * app has now (D58), so a rename never leaves a stale expression on screen;
 * a metric's value is the projection's last recalculation (D60), with its
 * truthful status. A rule is its structured clause (D52), never free text.
 */

import {
  renderFormula,
  type FormulaDefinitionV1,
  type NameLookupV1,
} from "../../domain/formulas/index.js";
import { encodeDomainId, type FieldId, type FormulaId, type TableId } from "../../domain/model/ids.js";
import type { EnumOptionDefV1, FieldDefV1, RelationshipDefV1 } from "../../domain/model/schema.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import type { RecordRuleIRV1 } from "../ports/event-repository.js";
import type { ProjectionEnginePort, ProjectionScalarResultV1 } from "../ports/projection.js";

export interface StructureFieldV1 {
  readonly field: FieldDefV1;
  /** Empty for every field that is not an enum. */
  readonly enumOptions: readonly EnumOptionDefV1[];
}

export interface StructureRuleV1 {
  readonly displayName: string;
  readonly rule: RecordRuleIRV1;
}

export interface StructureTableV1 {
  readonly tableId: TableId;
  readonly displayName: string;
  readonly tableOrdinal: number;
  readonly keyFieldId: FieldId | null;
  readonly labelFieldId: FieldId | null;
  /** Exact: `count(*)` (CA-14). */
  readonly recordCount: number;
  /** Every field, active and deactivated, in form order. */
  readonly fields: readonly StructureFieldV1[];
  readonly rules: readonly StructureRuleV1[];
}

export interface StructureRelationshipV1 {
  readonly relationship: RelationshipDefV1;
  readonly fromTableName: string;
  readonly toTableName: string;
}

export interface StructureFormulaV1 {
  readonly formula: FormulaDefinitionV1;
  /** The expression in the app's current names (D58); the original text when there is no IR. */
  readonly renderedText: string;
  readonly isActive: boolean;
}

export interface AppStructureV1 {
  readonly displayName: string;
  readonly schemaRevision: bigint;
  readonly tables: readonly StructureTableV1[];
  readonly relationships: readonly StructureRelationshipV1[];
  readonly formulas: readonly StructureFormulaV1[];
}

const key = (id: Uint8Array): string => encodeDomainId(id as FieldId);

export function readAppStructure(projection: ProjectionEnginePort): AppStructureV1 {
  const state = projection.execute({ kind: "app-state" });
  const tables = projection.execute({ kind: "list-tables" }).map((table): StructureTableV1 => {
    const fields = projection.execute({ kind: "list-fields", tableId: table.tableId });
    return {
      tableId: table.tableId,
      displayName: table.displayName,
      tableOrdinal: table.tableOrdinal,
      keyFieldId: table.keyFieldId,
      labelFieldId: table.labelFieldId,
      recordCount: projection.execute({ kind: "count-records", tableId: table.tableId }),
      fields: fields.map((field) => ({
        field,
        enumOptions: field.type.kind === "enum" ? projection.execute({ kind: "list-enum-options", fieldId: field.fieldId }) : [],
      })),
      rules: projection
        .execute({ kind: "list-validation-rules", tableId: table.tableId })
        .map((entry) => ({ displayName: entry.displayName, rule: entry.rule })),
    };
  });
  const formulas = projection.execute({ kind: "list-formulas", tableId: null });
  const names = nameLookup(tables, formulas.map((entry) => entry.formula));
  return {
    displayName: state.displayName,
    schemaRevision: state.schemaRevision,
    tables,
    relationships: projection
      .execute({ kind: "list-relationships", tableId: null })
      .map(({ relationship, fromTableName, toTableName }) => ({ relationship, fromTableName, toTableName })),
    formulas: formulas.map((entry) => ({
      formula: entry.formula,
      renderedText: entry.formula.document === null ? entry.formula.originalText : renderFormula(entry.formula.document, names),
      isActive: entry.isActive,
    })),
  };
}

/** Current names by stable ID, for the renderer. An unknown ID renders as `?`. */
function nameLookup(tables: readonly StructureTableV1[], formulas: readonly FormulaDefinitionV1[]): NameLookupV1 {
  const fieldNames = new Map(tables.flatMap((table) => table.fields.map(({ field }) => [key(field.fieldId), field.displayName] as const)));
  const tableNames = new Map(tables.map((table) => [key(table.tableId), table.displayName] as const));
  const formulaNames = new Map(formulas.map((formula) => [key(formula.formulaId), formula.displayName ?? "?"] as const));
  return {
    fieldName: (fieldId) => fieldNames.get(key(fieldId)) ?? "?",
    tableName: (tableId) => tableNames.get(key(tableId)) ?? "?",
    formulaName: (formulaId) => formulaNames.get(key(formulaId)) ?? "?",
  };
}

// ------------------------------------------------------------------- metrics --

export interface MetricV1 {
  readonly formulaId: FormulaId;
  readonly displayName: string;
  readonly status: ProjectionScalarResultV1["status"];
  /** Present only for an `ok` result. */
  readonly value: CellValueV1 | null;
  /** An error's code, for an `error` result. */
  readonly code: string | null;
  readonly evaluatedAtMs: number | null;
}

export interface AppMetricsV1 {
  /** Each table's metrics, in table order then formula ID. */
  readonly tables: readonly { readonly tableId: TableId; readonly metrics: readonly MetricV1[] }[];
  /** The dashboard values (\"At a glance\"). */
  readonly dashboard: readonly MetricV1[];
}

/**
 * Table metrics and dashboard values with the status the last recalculation
 * gave each (CA-26): a metric that has not been evaluated says `empty`, never
 * zero.
 */
export function readAppMetrics(projection: ProjectionEnginePort): AppMetricsV1 {
  const results = new Map(projection.execute({ kind: "scalar-results" }).map((result) => [key(result.formulaId), result] as const));
  const active = projection
    .execute({ kind: "list-formulas", tableId: null })
    .filter((entry) => entry.isActive && entry.formula.target.kind !== "computed-column");
  const metricOf = (formula: FormulaDefinitionV1): MetricV1 => {
    const result = results.get(key(formula.formulaId));
    return {
      formulaId: formula.formulaId,
      displayName: formula.displayName ?? formula.originalText,
      status: result?.status ?? "empty",
      value: result?.value ?? null,
      code: result?.code ?? null,
      evaluatedAtMs: result?.evaluatedAtMs ?? null,
    };
  };
  return {
    tables: projection.execute({ kind: "list-tables" }).map((table) => ({
      tableId: table.tableId,
      metrics: active
        .filter((entry) => entry.formula.target.kind === "table-metric" && key(entry.formula.target.tableId) === key(table.tableId))
        .map((entry) => metricOf(entry.formula)),
    })),
    dashboard: active.filter((entry) => entry.formula.target.kind === "dashboard-value").map((entry) => metricOf(entry.formula)),
  };
}
