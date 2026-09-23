/**
 * D60 / CA-26, the pure half (S03 CP2): which formulas and rows a change
 * reaches, and what each result state becomes. The SQL half — lanes, issues
 * and scalar rows actually written — is `tests/browser/projection/recalc.spec.ts`.
 */

import { describe, expect, it } from "vitest";
import type { FormulaDefinitionV1, FormulaIRV1, FormulaResultValueV1 } from "../../../src/domain/formulas/index.js";
import { asDomainId, encodeDomainId, type FieldId, type TableId } from "../../../src/domain/model/ids.js";
import type { FieldDefV1 } from "../../../src/domain/model/schema.js";
import {
  dateValue,
  decimalValue,
  invalidPreservedValue,
  MISSING_VALUE,
  textValue,
  type CellValueV1,
} from "../../../src/domain/model/values.js";
import {
  COMPUTED_CELL_STATES,
  computedCellOutcome,
  isRowLocal,
  planRecalculation,
  readComputedCell,
  type ComputedSourceV1,
  type RecalcPlanV1,
} from "../../../src/persistence/projection/recalc-plan.js";

const evaluatedOk = (value: CellValueV1): ComputedSourceV1 => ({
  kind: "evaluated",
  result: { kind: "ok", value: value as FormulaResultValueV1 },
});

const id = <K extends "table" | "field" | "formula">(kind: K, fill: number) => asDomainId(kind, new Uint8Array(16).fill(fill));

const JOBS: TableId = id("table", 1);
const OTHER: TableId = id("table", 2);
const QUOTED: FieldId = id("field", 0x10);
const PAID: FieldId = id("field", 0x11);
const DUE: FieldId = id("field", 0x12);
const BALANCE: FieldId = id("field", 0x20);
const DOUBLED: FieldId = id("field", 0x21);
const SHARE: FieldId = id("field", 0x22);
const AGE: FieldId = id("field", 0x23);
const LOOP_A: FieldId = id("field", 0x24);
const LOOP_B: FieldId = id("field", 0x25);
const KEPT: FieldId = id("field", 0x26);

const field = (fieldId: FieldId): FormulaIRV1 => ({ kind: "field", fieldId });
const column = (fieldId: FieldId): FormulaIRV1 => ({ kind: "column", tableId: JOBS, fieldId });

const computed = (
  fill: number,
  target: FieldId,
  root: FormulaIRV1 | null,
  dependencies: readonly FieldId[],
  overrides: Partial<FormulaDefinitionV1> = {},
): FormulaDefinitionV1 => ({
  formulaId: id("formula", fill),
  target: { kind: "computed-column", tableId: JOBS, fieldId: target },
  displayName: null,
  originalText: "…",
  document: root === null ? null : { irVersion: 1, root },
  disposition: "live",
  determinism: "deterministic",
  dependencies: dependencies.map((fieldId) => ({ kind: "field" as const, fieldId })),
  ...overrides,
});

// Balance = [Quoted]-[Paid]            row-local
// Doubled = [Balance]*2                 row-local, reads Balance
// Share   = [Quoted]/SUM(Jobs[Quoted])  reads a whole column
// Age     = TODAY()-[Due]               clock-volatile, row-local
// LoopA/LoopB read each other           a cycle
// Kept    = CUBE()                      unsupported, reads nothing
const balance = computed(0x40, BALANCE, { kind: "binary", operator: "-", left: field(QUOTED), right: field(PAID) }, [QUOTED, PAID]);
const doubled = computed(0x41, DOUBLED, { kind: "binary", operator: "*", left: field(BALANCE), right: { kind: "literal", value: { kind: "decimal", decimal: "2" } } }, [BALANCE]);
const share = computed(
  0x42,
  SHARE,
  { kind: "binary", operator: "/", left: field(QUOTED), right: { kind: "call", name: "SUM", version: 1, args: [column(QUOTED)] } },
  [QUOTED],
);
const age = computed(
  0x43,
  AGE,
  { kind: "binary", operator: "-", left: { kind: "call", name: "TODAY", version: 1, args: [] }, right: field(DUE) },
  [DUE],
  { determinism: "clock-volatile" },
);
const loopA = computed(0x44, LOOP_A, field(LOOP_B), [LOOP_B]);
const loopB = computed(0x45, LOOP_B, field(LOOP_A), [LOOP_A]);
const kept = computed(0x46, KEPT, null, [], { disposition: "unsupported", determinism: "unsupported" });
const metric: FormulaDefinitionV1 = {
  formulaId: id("formula", 0x47),
  target: { kind: "table-metric", tableId: JOBS },
  displayName: "Quoted total",
  originalText: "SUM(Jobs[Quoted])",
  document: { irVersion: 1, root: { kind: "call", name: "SUM", version: 1, args: [column(QUOTED)] } },
  disposition: "live",
  determinism: "deterministic",
  dependencies: [{ kind: "field", fieldId: QUOTED }],
};
const FORMULAS = [balance, doubled, share, age, loopA, loopB, kept, metric];

const text = (plan: RecalcPlanV1): string[] =>
  plan.steps.map((step) => {
    const rows = step.rows === null ? "scalar" : step.rows === "all" ? "all" : `rows:${step.rows.length}`;
    return `${encodeDomainId(step.formula.formulaId).slice(0, 2)}:${rows}${step.isCycle ? ":cycle" : ""}`;
  });
const name = (formula: FormulaDefinitionV1): string => encodeDomainId(formula.formulaId).slice(0, 2);

describe("planning recalculation (D60)", () => {
  it("evaluates everything at hydration, in dependency order, and only flags a cycle", () => {
    const plan = planRecalculation(FORMULAS, { kind: "all" });
    const order = plan.steps.map((step) => name(step.formula));
    expect(order.indexOf(name(balance))).toBeLessThan(order.indexOf(name(doubled)));
    expect(plan.steps.filter((step) => step.isCycle).map((step) => name(step.formula)).sort()).toEqual(
      [name(loopA), name(loopB)].sort(),
    );
    // Cycle members come last and are never in the evaluable prefix.
    expect(plan.steps.slice(-2).every((step) => step.isCycle)).toBe(true);
    expect(plan.steps.every((step) => step.isCycle || step.rows === "all" || step.rows === null)).toBe(true);
    expect(plan.recalculatedFieldIds).toHaveLength(7);
  });

  it("recomputes only what a patched field reaches, and only the patched row where it can", () => {
    const plan = planRecalculation(FORMULAS, {
      kind: "records",
      changedFieldIds: [PAID],
      recordKeys: ["job-7"],
      insertedTableIds: [],
    });
    // Paid reaches Balance and, through it, Doubled — nothing else: not Share,
    // not the metric, not the clock column, not the cycle.
    expect(text(plan)).toEqual([`${name(balance)}:rows:1`, `${name(doubled)}:rows:1`]);
    expect(plan.recalculatedFieldIds.map((fieldId) => encodeDomainId(fieldId))).toEqual(
      [BALANCE, DOUBLED].map((fieldId) => encodeDomainId(fieldId)),
    );
  });

  it("widens a column read to every row, and the metric with it", () => {
    const plan = planRecalculation(FORMULAS, {
      kind: "records",
      changedFieldIds: [QUOTED],
      recordKeys: ["job-7"],
      insertedTableIds: [],
    });
    const steps = new Map(plan.steps.map((step) => [name(step.formula), step.rows]));
    expect(steps.get(name(balance))).toEqual(["job-7"]);
    // Share divides by the whole column's sum, so every row's share moved.
    expect(steps.get(name(share))).toBe("all");
    expect(steps.get(name(metric))).toBeNull();
    expect(steps.has(name(age))).toBe(false);
  });

  it("widens a row-local reader of a widened column", () => {
    const readsShare = computed(0x48, id("field", 0x27), field(SHARE), [SHARE]);
    const plan = planRecalculation([...FORMULAS, readsShare], {
      kind: "records",
      changedFieldIds: [QUOTED],
      recordKeys: ["job-7"],
      insertedTableIds: [],
    });
    expect(plan.steps.find((step) => name(step.formula) === name(readsShare))?.rows).toBe("all");
  });

  it("covers a new row in every column of its table, cycle and unsupported included", () => {
    const plan = planRecalculation(FORMULAS, {
      kind: "records",
      changedFieldIds: [QUOTED, PAID, DUE, BALANCE, DOUBLED, SHARE, AGE, LOOP_A, LOOP_B, KEPT],
      recordKeys: ["new"],
      insertedTableIds: [JOBS],
    });
    const byName = new Map(plan.steps.map((step) => [name(step.formula), step]));
    expect(byName.get(name(kept))?.rows).toEqual(["new"]);
    expect(byName.get(name(loopA))).toMatchObject({ rows: ["new"], isCycle: true });
    expect(byName.get(name(age))?.rows).toEqual(["new"]);
    // An insert into another table touches nothing here.
    const elsewhere = planRecalculation(FORMULAS, {
      kind: "records",
      changedFieldIds: [],
      recordKeys: ["x"],
      insertedTableIds: [OTHER],
    });
    expect(elsewhere.steps).toEqual([]);
  });

  it("refreshes only the clock-volatile formulas and what reads them", () => {
    const readsAge = computed(0x49, id("field", 0x28), field(AGE), [AGE]);
    const plan = planRecalculation([...FORMULAS, readsAge], { kind: "volatile" });
    // The clock re-flags no cycle: only what reads TODAY() moves.
    expect(plan.steps.map((step) => name(step.formula))).toEqual([name(age), name(readsAge)]);
  });

  it("knows a row-local formula from one that reads beyond its row", () => {
    expect(isRowLocal(balance)).toBe(true);
    expect(isRowLocal(kept)).toBe(true);
    expect(isRowLocal(share)).toBe(false);
  });
});

describe("CA-26: what a result becomes", () => {
  const numberField: FieldDefV1 = {
    fieldId: BALANCE,
    tableId: JOBS,
    displayName: "Balance",
    fieldOrdinal: 4,
    type: { kind: "number" },
    isRequired: false,
    isActive: true,
    schemaRevision: 1n,
    formulaId: balance.formulaId,
  };

  const cases: readonly { readonly source: ComputedSourceV1; readonly state: string; readonly lane: boolean; readonly key: string | null }[] = [
    { source: evaluatedOk(decimalValue("100")), state: "ok", lane: true, key: null },
    { source: evaluatedOk(textValue("n/a")), state: "type", lane: false, key: "formula-result-type" },
    { source: { kind: "evaluated", result: { kind: "empty" } }, state: "empty", lane: false, key: null },
    { source: { kind: "evaluated", result: { kind: "error", code: "#DIV/0!" } }, state: "error", lane: false, key: "formula-error" },
    { source: { kind: "cycle" }, state: "cycle", lane: false, key: "formula-cycle" },
    { source: { kind: "literal", disposition: "unsupported", literal: decimalValue("41") }, state: "unsupported", lane: true, key: "unsupported-formula" },
    { source: { kind: "literal", disposition: "unsupported", literal: null }, state: "unsupported-new-row", lane: false, key: "missing-unsupported-formula" },
    { source: { kind: "literal", disposition: "frozen", literal: decimalValue("0.37") }, state: "frozen", lane: true, key: null },
  ];

  it("keeps every state distinct, with its lane and issue exactly per the table", () => {
    const states = new Set<string>();
    for (const entry of cases) {
      const outcome = computedCellOutcome(numberField, entry.source);
      states.add(outcome.state);
      expect({ state: outcome.state, lane: outcome.lane !== null, key: outcome.issue?.messageKey ?? null }).toEqual({
        state: entry.state,
        lane: entry.lane,
        key: entry.key,
      });
    }
    expect([...states].sort()).toEqual([...COMPUTED_CELL_STATES].sort());
  });

  it("never turns an unsupported new row into a zero, and names the error code, not a value", () => {
    const newRow = computedCellOutcome(numberField, { kind: "literal", disposition: "unsupported", literal: MISSING_VALUE });
    expect(newRow).toMatchObject({ state: "unsupported-new-row", lane: null });
    const error = computedCellOutcome(numberField, { kind: "evaluated", result: { kind: "error", code: "#VALUE!" } });
    expect(error.issue?.messageParameters).toEqual({ fieldLabel: "Balance", code: "#VALUE!" });
    // An imported literal that no longer fits keeps its state and loses only its lane.
    const preserved = computedCellOutcome(numberField, { kind: "literal", disposition: "unsupported", literal: invalidPreservedValue("TBD") });
    expect(preserved).toMatchObject({ state: "unsupported", lane: null });
  });

  it("reads each stored lane and issue back as the state that wrote it", () => {
    for (const entry of cases) {
      const outcome = computedCellOutcome(numberField, entry.source);
      const literal = entry.source.kind === "literal" ? entry.source.literal : null;
      const disposition = entry.source.kind === "literal" ? entry.source.disposition : "live";
      const read = readComputedCell(
        disposition,
        outcome.lane,
        outcome.issue === null ? null : { messageKey: outcome.issue.messageKey, code: outcome.issue.messageParameters["code"] ?? null },
        literal,
      );
      expect(read.state).toBe(outcome.state);
    }
    expect(readComputedCell("live", dateValue(20_000), null, null)).toEqual({ state: "ok", value: dateValue(20_000) });
    expect(readComputedCell("live", null, { messageKey: "formula-error", code: "#N/A" }, null)).toEqual({ state: "error", code: "#N/A" });
  });
});
