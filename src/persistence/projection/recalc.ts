/**
 * Recalculation, applied to the projection (D60; CA-26; load order step 6).
 *
 * `recalc-plan.ts` decides which formulas and rows; this module evaluates
 * them through M03's bounded interpreter (invariant 8) and writes what
 * CA-26 says each result becomes: a computed lane (`origin = 'computed'`), a
 * recalculated `formula` issue, or a `scalar_formula_results` row stamped
 * with the session clock. It runs inside the caller's transaction — the
 * record write's own, or hydration's — so a projection never shows a record
 * beside stale results.
 *
 * **Nothing here leaves the projection.** A result is written to three
 * ephemeral tables that lock destroys; no event, checkpoint or envelope is
 * built from it (invariant 7), and `TODAY()`/`NOW()` read only the clock the
 * data worker injected. Computed values are not searchable text: the search
 * row is the authored record's (database.md § `record_search`).
 */

import {
  evaluateAggregate,
  evaluateRow,
  evaluateScalar,
  type EvaluationClockReadingV1,
  type EvaluationEnvV1,
  type EvaluationResultV1,
  type FieldReadV1,
  type FormulaDefinitionV1,
  type RowAccessV1,
} from "../../domain/formulas/index.js";
import type { FieldId, FormulaId, RecordId, TableId } from "../../domain/model/ids.js";
import { isComputedField, type FieldDefV1 } from "../../domain/model/schema.js";
import {
  booleanValue,
  dateValue,
  decimalValue,
  enumValue,
  MISSING_VALUE,
  referenceValue,
  textValue,
  type CellValueV1,
} from "../../domain/model/values.js";
import { asDomainId } from "../../domain/model/ids.js";
import {
  decodeAuthoredRecord,
  decodeMessageParameters,
  decodeScalarValue,
  encodeScalarValue,
} from "./cbor-values.js";
import { run, selectRow, selectRows, withTransaction, type ProjectionHandleV1 } from "./engine.js";
import {
  computedCellOutcome,
  planRecalculation,
  readComputedCell,
  type ComputedCellOutcomeV1,
  type ComputedCellV1,
  type RecalcStepV1,
  type RecalcTriggerV1,
} from "./recalc-plan.js";
import { idKey, writeComputedCell } from "./record-rows.js";
import {
  SELECT_COMPUTED_CELLS_FOR_RECORD,
  SELECT_RECALCULATED_ISSUES_FOR_RECORD,
  SELECT_RECORD_ROWS_FOR_TABLE,
  SELECT_SCALAR_RESULT,
  UPSERT_SCALAR_RESULT,
} from "./statements.js";

export interface RecalcOutcomeV1 {
  /** The computed columns re-derived — the `recalculated` notice's field IDs. */
  readonly recalculatedFieldIds: readonly FieldId[];
  /** Evaluator calls made; D60's \"downstream only\" is observable through it. */
  readonly evaluations: number;
}

interface RowV1 {
  readonly recordPk: number;
  readonly recordId: RecordId;
  readonly tableId: TableId;
  readonly values: ReadonlyMap<string, CellValueV1>;
}

interface TableRowsV1 {
  readonly rows: readonly RowV1[];
  readonly byRecordKey: ReadonlyMap<string, RowV1>;
}

/**
 * The formulas recalculation may run: active, and — for a computed column —
 * aimed at a field that is itself active and still names it.
 */
export function activeFormulas(handle: ProjectionHandleV1): readonly FormulaDefinitionV1[] {
  return [...handle.schema.formulas.values()]
    .filter((entry) => {
      if (!entry.isActive) return false;
      const target = entry.formula.target;
      if (target.kind !== "computed-column") return true;
      const field = handle.schema.fields.get(idKey(target.fieldId));
      return (
        field !== undefined &&
        field.isActive &&
        field.formulaId !== undefined &&
        idKey(field.formulaId) === idKey(entry.formula.formulaId)
      );
    })
    .map((entry) => entry.formula);
}

/** Runs one trigger's plan. The caller holds the transaction. */
export function recalculate(handle: ProjectionHandleV1, trigger: RecalcTriggerV1): RecalcOutcomeV1 {
  const plan = planRecalculation(activeFormulas(handle), trigger);
  if (plan.steps.length === 0) {
    return { recalculatedFieldIds: [], evaluations: 0 };
  }
  const reading = handle.clock();
  const pass = new RecalcPass(handle, reading);
  for (const step of plan.steps) {
    pass.run(step);
  }
  if (trigger.kind !== "records") {
    handle.volatileReading = reading;
  }
  return { recalculatedFieldIds: plan.recalculatedFieldIds, evaluations: pass.evaluations };
}

/**
 * Re-evaluates the clock-volatile formulas when the reading they were last
 * evaluated at is older than `maxAgeMs` or on another local day — so a
 * session left open across midnight shows today's `TODAY()`. The data worker
 * calls it before serving a record or metric read (policy: one minute).
 */
export async function refreshVolatile(
  handle: ProjectionHandleV1,
  maxAgeMs: number,
): Promise<readonly FieldId[]> {
  const last = handle.volatileReading;
  const now = handle.clock();
  if (last !== null && last.epochDay === now.epochDay && now.epochMs - last.epochMs < maxAgeMs) {
    return [];
  }
  const outcome = await withTransaction(handle, () => recalculate(handle, { kind: "volatile" }));
  handle.volatileReading = now;
  return outcome.recalculatedFieldIds;
}

/** One recalculation: the rows it read and the results it produced so far. */
class RecalcPass {
  evaluations = 0;
  readonly #tables = new Map<string, TableRowsV1>();
  /** Results produced in this pass, by record row key then field key. */
  readonly #computed = new Map<number, Map<string, FieldReadV1>>();
  /** Stored results read back for columns this pass did not re-derive. */
  readonly #stored = new Map<number, ReadonlyMap<string, FieldReadV1>>();
  readonly #scalars = new Map<string, EvaluationResultV1>();
  readonly #env: EvaluationEnvV1;

  constructor(
    private readonly handle: ProjectionHandleV1,
    private readonly reading: EvaluationClockReadingV1,
  ) {
    this.#env = {
      clock: () => this.reading,
      columns: {
        valuesOf: (tableId, fieldId) =>
          this.#rowsOf(tableId).rows.map((row) => this.#valueOf(row, fieldId)),
      },
      formulaResults: (formulaId) => this.#scalarResult(formulaId),
      relatedRow: (relationshipId, recordId) => this.#relatedRow(relationshipId, recordId),
      optionLabel: (optionId) => handle.schema.optionLabels.get(idKey(optionId)) ?? null,
    };
  }

  run(step: RecalcStepV1): void {
    const { formula } = step;
    if (formula.target.kind !== "computed-column") {
      this.#runScalar(formula, step.isCycle);
      return;
    }
    const field = this.handle.schema.fields.get(idKey(formula.target.fieldId));
    if (field === undefined) {
      return;
    }
    const table = this.#rowsOf(formula.target.tableId);
    const rows =
      step.rows === "all" || step.rows === null
        ? table.rows
        : step.rows.flatMap((recordKey) => {
            const row = table.byRecordKey.get(recordKey);
            return row === undefined ? [] : [row];
          });
    for (const row of rows) {
      this.#writeCell(row, field, this.#outcome(formula, field, row, step.isCycle));
    }
  }

  #outcome(formula: FormulaDefinitionV1, field: FieldDefV1, row: RowV1, isCycle: boolean): ComputedCellOutcomeV1 {
    if (isCycle) {
      return computedCellOutcome(field, { kind: "cycle" });
    }
    if (formula.disposition !== "live" || formula.document === null) {
      // Frozen and unsupported columns are never re-evaluated: the record's
      // authored literal is the value, projected into the computed lane (D51).
      return computedCellOutcome(field, {
        kind: "literal",
        disposition: formula.disposition === "frozen" ? "frozen" : "unsupported",
        literal: row.values.get(idKey(field.fieldId)) ?? null,
      });
    }
    this.evaluations += 1;
    return computedCellOutcome(field, {
      kind: "evaluated",
      result: evaluateRow(formula.document, this.#rowAccess(row), this.#env),
    });
  }

  #writeCell(row: RowV1, field: FieldDefV1, outcome: ComputedCellOutcomeV1): void {
    const fitted = writeComputedCell(this.handle, row.recordPk, field, outcome.lane, outcome.issue);
    const settled = fitted
      ? outcome
      : computedCellOutcome(field, { kind: "evaluated", result: { kind: "error", code: "#NUM!" } });
    if (!fitted) {
      writeComputedCell(this.handle, row.recordPk, field, null, settled.issue);
    }
    const readings = this.#computed.get(row.recordPk) ?? new Map<string, FieldReadV1>();
    readings.set(idKey(field.fieldId), readOf(settled, row.values.get(idKey(field.fieldId)) ?? null));
    this.#computed.set(row.recordPk, readings);
  }

  #runScalar(formula: FormulaDefinitionV1, isCycle: boolean): void {
    let result: EvaluationResultV1;
    if (isCycle) {
      result = { kind: "cycle" };
    } else if (formula.disposition !== "live" || formula.document === null) {
      // A frozen metric has no row to hold its literal, so it states the one
      // truthful thing it can: its value is not live (reported to S07).
      result = { kind: "unsupported" };
    } else {
      this.evaluations += 1;
      result =
        formula.target.kind === "table-metric"
          ? evaluateAggregate(formula.document, this.#env)
          : evaluateScalar(formula.document, this.#env);
    }
    this.#scalars.set(idKey(formula.formulaId), result);
    run(this.handle, UPSERT_SCALAR_RESULT, [
      formula.formulaId,
      result.kind,
      encodeScalarValue(result),
      this.reading.epochMs,
    ]);
  }

  #scalarResult(formulaId: FormulaId): EvaluationResultV1 {
    const produced = this.#scalars.get(idKey(formulaId));
    if (produced !== undefined) return produced;
    const entry = this.handle.schema.formulas.get(idKey(formulaId));
    if (entry === undefined || !entry.isActive) {
      return { kind: "error", code: "#REF!" };
    }
    const row = selectRow(this.handle, SELECT_SCALAR_RESULT, [formulaId]);
    return row === null
      ? { kind: "empty" }
      : decodeScalarValue(row[0] as string, row[1] instanceof Uint8Array ? row[1] : null);
  }

  #rowsOf(tableId: Uint8Array): TableRowsV1 {
    const tableKey = idKey(tableId);
    const cached = this.#tables.get(tableKey);
    if (cached !== undefined) return cached;
    const rows = selectRows(this.handle, SELECT_RECORD_ROWS_FOR_TABLE, [tableId]).map((row): RowV1 => {
      const authored = decodeAuthoredRecord(row[2] as Uint8Array);
      return {
        recordPk: Number(row[0]),
        recordId: authored.recordId,
        tableId: authored.tableId,
        values: new Map([...authored.values].map(([fieldId, value]) => [idKey(fieldId), value])),
      };
    });
    const loaded = { rows, byRecordKey: new Map(rows.map((row) => [idKey(row.recordId), row])) };
    this.#tables.set(tableKey, loaded);
    return loaded;
  }

  #rowAccess(row: RowV1): RowAccessV1 {
    return { recordId: row.recordId, valueOf: (fieldId) => this.#valueOf(row, fieldId) };
  }

  #valueOf(row: RowV1, fieldId: FieldId): FieldReadV1 {
    const field = this.handle.schema.fields.get(idKey(fieldId));
    if (field === undefined || !isComputedField(field)) {
      return row.values.get(idKey(fieldId)) ?? MISSING_VALUE;
    }
    const fresh = this.#computed.get(row.recordPk)?.get(idKey(fieldId));
    if (fresh !== undefined) return fresh;
    return this.#storedOf(row).get(idKey(fieldId)) ?? MISSING_VALUE;
  }

  /** A record's computed values as the projection already holds them. */
  #storedOf(row: RowV1): ReadonlyMap<string, FieldReadV1> {
    const cached = this.#stored.get(row.recordPk);
    if (cached !== undefined) return cached;
    const readings = new Map<string, FieldReadV1>();
    for (const [fieldKey, cell] of readComputedCells(this.handle, row.recordPk, row.tableId, row.values)) {
      readings.set(fieldKey, readOfCell(cell));
    }
    this.#stored.set(row.recordPk, readings);
    return readings;
  }

  #relatedRow(relationshipId: Uint8Array, recordId: RecordId): RowAccessV1 | null {
    const relationship = [...this.handle.schema.relationships.values()].find(
      (candidate) => candidate.isActive && idKey(candidate.relationshipId) === idKey(relationshipId),
    );
    if (relationship === undefined) return null;
    const child = this.#rowsOf(relationship.fromTableId).byRecordKey.get(idKey(recordId));
    const value = child === undefined ? MISSING_VALUE : this.#valueOf(child, relationship.fromFieldId);
    if (value.kind !== "reference") return null;
    const parent = this.#rowsOf(relationship.toTableId).byRecordKey.get(idKey(value.recordId));
    return parent === undefined ? null : this.#rowAccess(parent);
  }
}

/** What a downstream formula reads from a cell recalculation just settled. */
function readOf(outcome: ComputedCellOutcomeV1, literal: CellValueV1 | null): FieldReadV1 {
  switch (outcome.state) {
    case "ok":
    case "frozen":
      return outcome.lane ?? MISSING_VALUE;
    case "unsupported":
      return outcome.lane ?? literal ?? MISSING_VALUE;
    case "error":
      return { kind: "error", code: (outcome.issue?.messageParameters.code ?? "#VALUE!") as never };
    default:
      return MISSING_VALUE;
  }
}

function readOfCell(cell: ComputedCellV1): FieldReadV1 {
  switch (cell.state) {
    case "ok":
    case "frozen":
    case "unsupported":
      return cell.value;
    case "error":
      return { kind: "error", code: cell.code as never };
    default:
      return MISSING_VALUE;
  }
}

/**
 * Every active computed column of a record's table, as the projection holds
 * it: CA-26's state from the stored lane and recalculated issue, with the
 * authored literal of a frozen or unsupported column. Keyed by field key.
 */
export function readComputedCells(
  handle: ProjectionHandleV1,
  recordPk: number,
  tableId: TableId,
  authored: ReadonlyMap<string, CellValueV1>,
): ReadonlyMap<string, ComputedCellV1> {
  const fields = (handle.schema.fieldsByTable.get(idKey(tableId)) ?? []).filter(
    (field) => field.isActive && isComputedField(field),
  );
  if (fields.length === 0) return new Map();

  const lanes = new Map(
    selectRows(handle, SELECT_COMPUTED_CELLS_FOR_RECORD, [recordPk]).map((row) => [
      idKey(row[0] as Uint8Array),
      row,
    ]),
  );
  const issues = new Map(
    selectRows(handle, SELECT_RECALCULATED_ISSUES_FOR_RECORD, [recordPk]).map((row) => {
      const parameters = decodeMessageParameters(row[2] as Uint8Array);
      return [
        idKey(row[0] as Uint8Array),
        {
          messageKey: row[1] as string,
          code: typeof parameters["code"] === "string" ? parameters["code"] : null,
        },
      ] as const;
    }),
  );
  const cells = new Map<string, ComputedCellV1>();
  for (const field of fields) {
    const entry = handle.schema.formulas.get(idKey(field.formulaId as FormulaId));
    if (entry === undefined || !entry.isActive) continue;
    const fieldKey = idKey(field.fieldId);
    const lane = lanes.get(fieldKey);
    cells.set(
      fieldKey,
      readComputedCell(
        entry.formula.disposition,
        lane === undefined ? null : laneValue(field, lane),
        issues.get(fieldKey) ?? null,
        authored.get(fieldKey) ?? null,
      ),
    );
  }
  return cells;
}

/** A computed lane read back as the value it indexes, by the field's type. */
function laneValue(field: FieldDefV1, row: readonly unknown[]): CellValueV1 {
  switch (row[1]) {
    case "text":
      return textValue(String(row[2]));
    case "decimal":
      return decimalValue(String(row[3]));
    case "integer":
      return field.type.kind === "boolean" ? booleanValue(Number(row[4]) === 1) : dateValue(Number(row[4]));
    default:
      return field.type.kind === "enum"
        ? enumValue(asDomainId("option", row[5] as Uint8Array))
        : referenceValue(asDomainId("record", row[5] as Uint8Array));
  }
}
