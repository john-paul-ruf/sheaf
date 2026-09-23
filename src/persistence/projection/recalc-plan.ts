/**
 * What recalculation has to do, decided without SQLite (D60; CA-26).
 *
 * Two pure decisions live here so node can test them; `recalc.ts` applies
 * them to the database:
 *
 * - **Which formulas, which rows.** {@link planRecalculation} orders the
 *   formulas a change reaches through M03's dependency graph. After a record
 *   write it is only `downstreamOf` the fields that moved, and a computed
 *   column whose formula reads nothing but its own row is re-evaluated for
 *   the written records alone; anything that reads a whole column, another
 *   row, or another formula's result is re-evaluated for every row of its
 *   table. A cycle member, or anything downstream of one, is never evaluated:
 *   it is flagged.
 * - **What a result becomes.** {@link computedCellOutcome} is CA-26's table:
 *   an evaluator result (or a frozen/unsupported literal) becomes a computed
 *   lane, a `formula` issue, or neither — and never an authored fact.
 */

import {
  buildDependencyGraph,
  downstreamOf,
  irNodesOf,
  type EvaluationResultV1,
  type FormulaDefinitionV1,
  type FormulaTargetV1,
} from "../../domain/formulas/index.js";
import { encodeDomainId, type FieldId, type FormulaId } from "../../domain/model/ids.js";
import { expectedCellKindForFieldType, type FieldDefV1 } from "../../domain/model/schema.js";
import { isAbsentCellValue, type CellValueV1 } from "../../domain/model/values.js";

/** What set recalculation off. */
export type RecalcTriggerV1 =
  /** Hydration (load order step 6) or a schema commit: every formula, every row. */
  | { readonly kind: "all" }
  /** The clock moved: every clock-volatile formula and everything that reads one. */
  | { readonly kind: "volatile" }
  /**
   * A record write. `changedFieldIds` are the fields whose values moved (for
   * a create, delete or restore: every field of the table, because a column
   * aggregate counts rows); `recordKeys` the written records still live.
   * `insertedTableIds` names the tables that gained a row: every computed
   * column there covers the new row whatever it reads — a cycle is flagged
   * on it, and an unsupported column with no literal is flagged empty.
   */
  | {
      readonly kind: "records";
      readonly changedFieldIds: readonly FieldId[];
      readonly recordKeys: readonly string[];
      readonly insertedTableIds: readonly Uint8Array[];
    };

/** One formula to evaluate (or flag), with the rows it covers. */
export interface RecalcStepV1 {
  readonly formula: FormulaDefinitionV1;
  /** `null` for a table metric or dashboard value, which has no row. */
  readonly rows: "all" | readonly string[] | null;
  /** In or downstream of a cycle: flagged, never evaluated. */
  readonly isCycle: boolean;
}

export interface RecalcPlanV1 {
  readonly steps: readonly RecalcStepV1[];
  /** The computed columns this plan touches — the `recalculated` notice's field IDs. */
  readonly recalculatedFieldIds: readonly FieldId[];
}

const key = (id: Uint8Array): string => encodeDomainId(id as FieldId);

/**
 * True when a formula reads only its own row: no whole column, no related
 * parent, no other formula. Only such a formula may be re-evaluated for the
 * written records alone.
 */
export function isRowLocal(formula: FormulaDefinitionV1): boolean {
  if (formula.document === null) return true;
  return irNodesOf(formula.document.root).every(
    (node) => node.kind !== "column" && node.kind !== "related" && node.kind !== "formula",
  );
}

const targetFieldOf = (target: FormulaTargetV1): FieldId | null =>
  target.kind === "computed-column" ? target.fieldId : null;

const isColumnOf = (formula: FormulaDefinitionV1 | undefined, tableKeys: ReadonlySet<string>): boolean =>
  formula?.target.kind === "computed-column" && tableKeys.has(key(formula.target.tableId));

/**
 * Orders the active formulas a trigger reaches. Evaluable formulas come in
 * the graph's evaluation order, then every cycle member (flagged only). Each
 * computed column carries the rows to recompute, widened to `"all"` when it
 * reads beyond its own row or when anything it reads was itself widened.
 */
export function planRecalculation(
  formulas: readonly FormulaDefinitionV1[],
  trigger: RecalcTriggerV1,
): RecalcPlanV1 {
  const byKey = new Map(formulas.map((formula) => [key(formula.formulaId), formula]));
  const graph = buildDependencyGraph(
    formulas.map((formula) => ({
      formulaId: formula.formulaId,
      targetFieldId: targetFieldOf(formula.target),
      dependencies: formula.dependencies,
    })),
  );

  let affected: readonly FormulaId[];
  switch (trigger.kind) {
    case "all":
      affected = graph.order;
      break;
    case "volatile": {
      const volatile = formulas
        .filter((formula) => formula.determinism === "clock-volatile")
        .map((formula) => formula.formulaId);
      const reached = new Set(
        [...volatile, ...downstreamOf(graph, [], volatile)].map((formulaId) => key(formulaId)),
      );
      affected = graph.order.filter((formulaId) => reached.has(key(formulaId)));
      break;
    }
    case "records": {
      const inserted = new Set(trigger.insertedTableIds.map((tableId) => key(tableId)));
      const reached = new Set(downstreamOf(graph, trigger.changedFieldIds).map((formulaId) => key(formulaId)));
      affected = graph.order.filter(
        (formulaId) =>
          reached.has(key(formulaId)) || isColumnOf(byKey.get(key(formulaId)), inserted),
      );
      break;
    }
    default: {
      const unreachable: never = trigger;
      return unreachable;
    }
  }

  // A producer re-evaluated for every row widens every row-local reader.
  const widened = new Set<string>();
  const producersOf = (formula: FormulaDefinitionV1): string[] =>
    formula.dependencies.flatMap((dependency) => {
      if (dependency.kind === "formula") return [key(dependency.formulaId)];
      const producer = formulas.find(
        (candidate) =>
          candidate.target.kind === "computed-column" &&
          key(candidate.target.fieldId) === key(dependency.fieldId),
      );
      return producer === undefined ? [] : [key(producer.formulaId)];
    });

  const steps: RecalcStepV1[] = [];
  for (const formulaId of affected) {
    const formula = byKey.get(key(formulaId)) as FormulaDefinitionV1;
    if (formula.target.kind !== "computed-column") {
      steps.push({ formula, rows: null, isCycle: false });
      continue;
    }
    const isNarrow =
      trigger.kind === "records" &&
      isRowLocal(formula) &&
      !producersOf(formula).some((producer) => widened.has(producer));
    if (!isNarrow) widened.add(key(formulaId));
    steps.push({ formula, rows: isNarrow ? trigger.recordKeys : "all", isCycle: false });
  }

  // Neither a record write nor the clock can change which formulas form a
  // cycle, so their flags stand — except on a row a write inserted, which
  // has none yet. A full pass re-flags them all.
  for (const formulaId of graph.cycles) {
    const formula = byKey.get(key(formulaId)) as FormulaDefinitionV1;
    if (trigger.kind === "all") {
      steps.push({ formula, rows: formula.target.kind === "computed-column" ? "all" : null, isCycle: true });
    } else if (
      trigger.kind === "records" &&
      isColumnOf(formula, new Set(trigger.insertedTableIds.map((tableId) => key(tableId))))
    ) {
      steps.push({ formula, rows: trigger.recordKeys, isCycle: true });
    }
  }

  return {
    steps,
    recalculatedFieldIds: steps.flatMap((step) => {
      const fieldId = targetFieldOf(step.formula.target);
      return fieldId === null ? [] : [fieldId];
    }),
  };
}

// ------------------------------------------------------------ CA-26 states --

/** The computed-cell states CA-26 keeps distinct. */
export const COMPUTED_CELL_STATES = Object.freeze([
  "ok",
  "type",
  "empty",
  "error",
  "cycle",
  "unsupported",
  "unsupported-new-row",
  "frozen",
] as const);

export type ComputedCellStateV1 = (typeof COMPUTED_CELL_STATES)[number];

/** The recalculated issue a computed cell carries, if any (M02's formula keys). */
export interface ComputedIssueV1 {
  readonly messageKey:
    | "formula-result-type"
    | "formula-error"
    | "formula-cycle"
    | "unsupported-formula"
    | "missing-unsupported-formula";
  /** The field's label, and for an error its code — never a cell value (CA-12). */
  readonly messageParameters: Readonly<Record<string, string>>;
}

export interface ComputedCellOutcomeV1 {
  readonly state: ComputedCellStateV1;
  /** The value for the computed lane; `null` means no lane row. */
  readonly lane: CellValueV1 | null;
  readonly issue: ComputedIssueV1 | null;
}

/** What a computed cell's source is: an evaluation, the graph's cycle flag, or a kept literal. */
export type ComputedSourceV1 =
  | { readonly kind: "evaluated"; readonly result: EvaluationResultV1 }
  | { readonly kind: "cycle" }
  /** A frozen or unsupported column: the authored literal, when the record holds one. */
  | { readonly kind: "literal"; readonly disposition: "frozen" | "unsupported"; readonly literal: CellValueV1 | null };

const fits = (field: FieldDefV1, value: CellValueV1): boolean =>
  value.kind === expectedCellKindForFieldType(field.type);

/**
 * CA-26, row by row. A live result of the field's type is a lane; of another
 * type it is no lane and `formula-result-type`; an error is no lane and
 * `formula-error` with its code; empty is nothing at all. A frozen literal is
 * a lane with no issue; an unsupported literal is a lane with
 * `unsupported-formula`; an unsupported column with no literal is
 * `missing-unsupported-formula` — never a zero. A live formula the evaluator
 * could not carry through (an unsupported call at run time) is the same
 * truthful absence.
 */
export function computedCellOutcome(field: FieldDefV1, source: ComputedSourceV1): ComputedCellOutcomeV1 {
  const label = { fieldLabel: field.displayName };
  const flagged = (state: ComputedCellStateV1, issue: ComputedIssueV1): ComputedCellOutcomeV1 => ({
    state,
    lane: null,
    issue,
  });
  switch (source.kind) {
    case "cycle":
      return flagged("cycle", { messageKey: "formula-cycle", messageParameters: label });
    case "literal": {
      const literal = source.literal !== null && !isAbsentCellValue(source.literal) ? source.literal : null;
      if (source.disposition === "frozen") {
        if (literal === null) return { state: "empty", lane: null, issue: null };
        return fits(field, literal)
          ? { state: "frozen", lane: literal, issue: null }
          : flagged("type", { messageKey: "formula-result-type", messageParameters: label });
      }
      return literal === null
        ? flagged("unsupported-new-row", { messageKey: "missing-unsupported-formula", messageParameters: label })
        : {
            state: "unsupported",
            lane: fits(field, literal) ? literal : null,
            issue: { messageKey: "unsupported-formula", messageParameters: label },
          };
    }
    case "evaluated": {
      const { result } = source;
      switch (result.kind) {
        case "ok":
          return fits(field, result.value)
            ? { state: "ok", lane: result.value, issue: null }
            : flagged("type", { messageKey: "formula-result-type", messageParameters: label });
        case "empty":
          return { state: "empty", lane: null, issue: null };
        case "error":
          return flagged("error", { messageKey: "formula-error", messageParameters: { ...label, code: result.code } });
        case "cycle":
          return flagged("cycle", { messageKey: "formula-cycle", messageParameters: label });
        case "unsupported":
          return flagged("unsupported-new-row", { messageKey: "missing-unsupported-formula", messageParameters: label });
        default: {
          const unreachable: never = result;
          return unreachable;
        }
      }
    }
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}

/** A computed cell as a read reports it (CA-26); a value only where one exists. */
export type ComputedCellV1 =
  | { readonly state: "ok" | "frozen" | "unsupported"; readonly value: CellValueV1 }
  | { readonly state: "type" | "empty" | "cycle" | "unsupported-new-row" }
  | { readonly state: "error"; readonly code: string };

/**
 * The inverse of {@link computedCellOutcome}: what a stored lane and issue
 * mean. The issue names the state wherever there is one; with none, a lane is
 * `ok` (or `frozen`, by the formula's disposition) and no lane is `empty`. An
 * unsupported cell reads its authored literal, which is the value of record
 * even where it could not take a lane.
 */
export function readComputedCell(
  disposition: FormulaDefinitionV1["disposition"],
  lane: CellValueV1 | null,
  issue: { readonly messageKey: string; readonly code: string | null } | null,
  literal: CellValueV1 | null,
): ComputedCellV1 {
  switch (issue?.messageKey) {
    case "formula-result-type":
      return { state: "type" };
    case "formula-error":
      return { state: "error", code: issue.code ?? "#VALUE!" };
    case "formula-cycle":
      return { state: "cycle" };
    case "missing-unsupported-formula":
      return { state: "unsupported-new-row" };
    case "unsupported-formula":
      return literal === null ? { state: "unsupported-new-row" } : { state: "unsupported", value: literal };
    default:
      if (lane === null) return { state: "empty" };
      return disposition === "frozen" ? { state: "frozen", value: lane } : { state: "ok", value: lane };
  }
}
