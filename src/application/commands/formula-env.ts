/**
 * The formula evaluator's view of an open app, for commands (M34; D51, D57).
 *
 * A command evaluates a formula in three places, always through M03's one
 * bounded interpreter (invariant 8) and never to store a live result:
 *
 * - **impact** — MOD-014 counts the records a new computed column would put
 *   in error (`analyzeSchemaChange`'s injected `formulaResult`);
 * - **frozen once** — a `RAND`-family column's literal for an existing or
 *   new record, evaluated exactly once with `EntropyPort` (D51);
 * - nothing else. Live results are the projection's (D60).
 *
 * Reads go through M07's port only, and are memoized per command, so one
 * command sees one consistent app.
 */

import {
  evaluateNondeterministicOnce,
  evaluateRow,
  type EvaluationClockReadingV1,
  type EvaluationEnvV1,
  type EvaluationResultV1,
  type FieldReadV1,
  type FormulaDefinitionV1,
  type RowAccessV1,
} from "../../domain/formulas/index.js";
import {
  encodeDomainId,
  type DomainEntropy,
  type FieldId,
  type RecordId,
  type TableId,
} from "../../domain/model/ids.js";
import { MISSING_VALUE, type CellValueV1 } from "../../domain/model/values.js";
import type {
  ProjectionComputedCellV1,
  ProjectionEnginePort,
  ProjectionRecordPageResultV1,
  ProjectionRecordSummaryV1,
} from "../ports/projection.js";

/** The page size a command reads a whole table with (the engine's ceiling). */
const PAGE = 1024;

/** A record's values as a formula reads them: authored, and computed results. */
export interface FormulaRowV1 {
  readonly recordId: RecordId;
  readonly values: ReadonlyMap<string, CellValueV1>;
  readonly computed: ReadonlyMap<string, ProjectionComputedCellV1>;
}

const key = (id: Uint8Array): string => encodeDomainId(id as FieldId);

/** What a downstream formula reads from a computed cell. */
export function readComputed(cell: ProjectionComputedCellV1 | undefined): FieldReadV1 {
  if (cell === undefined) return MISSING_VALUE;
  switch (cell.state) {
    case "ok":
    case "frozen":
    case "unsupported":
      return cell.value;
    case "error":
      return { kind: "error", code: cell.code as Extract<FieldReadV1, { kind: "error" }>["code"] };
    default:
      return MISSING_VALUE;
  }
}

export function formulaRowOf(summary: ProjectionRecordSummaryV1): FormulaRowV1 {
  return {
    recordId: summary.recordId,
    values: new Map([...summary.authoredValues].map(([fieldId, value]) => [key(fieldId), value])),
    computed: new Map([...summary.computed].map(([fieldId, cell]) => [key(fieldId), cell])),
  };
}

export function rowAccessOf(row: FormulaRowV1): RowAccessV1 {
  return {
    recordId: row.recordId,
    valueOf: (fieldId) => {
      const computed = row.computed.get(key(fieldId));
      return computed !== undefined ? readComputed(computed) : (row.values.get(key(fieldId)) ?? MISSING_VALUE);
    },
  };
}

/** Every live record of a table, as formula rows; one paged read, memoized. */
export class ProjectionRows {
  readonly #tables = new Map<string, readonly FormulaRowV1[]>();

  constructor(private readonly projection: ProjectionEnginePort) {}

  of(tableId: TableId): readonly FormulaRowV1[] {
    const cached = this.#tables.get(key(tableId));
    if (cached !== undefined) return cached;
    const rows: FormulaRowV1[] = [];
    let after: number | null = null;
    for (;;) {
      const page: ProjectionRecordPageResultV1 = this.projection.execute({ kind: "page-records", tableId, afterRecordPk: after, limit: PAGE });
      rows.push(...page.records.map(formulaRowOf));
      if (!page.hasMore || page.nextRecordPk === null) break;
      after = page.nextRecordPk;
    }
    this.#tables.set(key(tableId), rows);
    return rows;
  }

  summaries(tableId: TableId): readonly ProjectionRecordSummaryV1[] {
    const summaries: ProjectionRecordSummaryV1[] = [];
    let after: number | null = null;
    for (;;) {
      const page: ProjectionRecordPageResultV1 = this.projection.execute({ kind: "page-records", tableId, afterRecordPk: after, limit: PAGE });
      summaries.push(...page.records);
      if (!page.hasMore || page.nextRecordPk === null) break;
      after = page.nextRecordPk;
    }
    return summaries;
  }
}

/** M03's environment over the projection: columns, parents, other formulas' results, labels. */
export function projectionFormulaEnv(
  projection: ProjectionEnginePort,
  rows: ProjectionRows,
  clock: () => EvaluationClockReadingV1,
): EvaluationEnvV1 {
  const relationships = projection.execute({ kind: "list-relationships", tableId: null });
  const scalars = new Map(
    projection.execute({ kind: "scalar-results" }).map((result) => [key(result.formulaId), result] as const),
  );
  const labels = new Map<string, string>();
  for (const table of projection.execute({ kind: "list-tables" })) {
    for (const field of projection.execute({ kind: "list-fields", tableId: table.tableId })) {
      if (field.type.kind !== "enum") continue;
      for (const option of projection.execute({ kind: "list-enum-options", fieldId: field.fieldId })) {
        labels.set(key(option.optionId), option.displayLabel);
      }
    }
  }
  return {
    clock,
    columns: {
      valuesOf: (tableId, fieldId) => rows.of(tableId).map((row) => rowAccessOf(row).valueOf(fieldId)),
    },
    formulaResults: (formulaId): EvaluationResultV1 => {
      const result = scalars.get(key(formulaId));
      if (result === undefined) return { kind: "empty" };
      switch (result.status) {
        case "ok":
          return result.value === null
            ? { kind: "empty" }
            : { kind: "ok", value: result.value as Extract<EvaluationResultV1, { kind: "ok" }>["value"] };
        case "error":
          return { kind: "error", code: (result.code ?? "#VALUE!") as Extract<EvaluationResultV1, { kind: "error" }>["code"] };
        default:
          return { kind: result.status };
      }
    },
    relatedRow: (relationshipId, recordId) => {
      const relationship = relationships.find(
        (entry) => entry.relationship.isActive && key(entry.relationship.relationshipId) === key(relationshipId),
      )?.relationship;
      if (relationship === undefined) return null;
      const child = rows.of(relationship.fromTableId).find((row) => key(row.recordId) === key(recordId));
      const value = child === undefined ? MISSING_VALUE : rowAccessOf(child).valueOf(relationship.fromFieldId);
      if (value.kind !== "reference") return null;
      const parent = rows.of(relationship.toTableId).find((row) => key(row.recordId) === key(value.recordId));
      return parent === undefined ? null : rowAccessOf(parent);
    },
    optionLabel: (optionId) => labels.get(key(optionId)) ?? null,
  };
}

/**
 * A frozen column's literal for one record (D51): the formula's one
 * evaluation, seeded by `EntropyPort`, or `null` when it produced no value.
 * The literal carries provenance `evidence.frozen` = the formula text, which
 * is what lets the validator accept a user write to a computed field.
 */
export function frozenLiteral(
  formula: FormulaDefinitionV1,
  row: FormulaRowV1,
  entropy: DomainEntropy,
  env: EvaluationEnvV1,
): CellValueV1 | null {
  if (formula.disposition !== "frozen" || formula.document === null) return null;
  const result = evaluateNondeterministicOnce(formula.document, entropy, env, rowAccessOf(row));
  return result.kind === "ok" ? result.value : null;
}

/** A live formula's result for one record, for impact counts only. */
export function liveResult(formula: FormulaDefinitionV1, row: FormulaRowV1, env: EvaluationEnvV1): EvaluationResultV1 {
  if (formula.disposition !== "live" || formula.document === null) return { kind: "empty" };
  return evaluateRow(formula.document, rowAccessOf(row), env);
}
