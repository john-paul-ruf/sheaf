import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  CATALOG_FUNCTION_NAMES,
  downstreamOf,
  evaluateRow,
  evaluateScalar,
  IR_BINARY_OPERATORS,
  type EvaluationEnvV1,
  type EvaluationResultV1,
  type FieldReadV1,
  type FormulaIRV1,
  type FormulaNodeV1,
  type RowAccessV1,
} from "../../../src/domain/formulas/index.js";
import { compareDecimals, formatDecimal, parseDecimal } from "../../../src/domain/formulas/decimal.js";
import { asDomainId, encodeDomainId, type FieldId, type FormulaId } from "../../../src/domain/model/ids.js";

const field = (n: number): FieldId => asDomainId("field", new Uint8Array(16).fill(n));
const formula = (n: number): FormulaId => asDomainId("formula", new Uint8Array(16).fill(n));
const TABLE = asDomainId("table", new Uint8Array(16).fill(1));
const RELATIONSHIP = asDomainId("relationship", new Uint8Array(16).fill(2));
const RECORD = asDomainId("record", new Uint8Array(16).fill(3));

const decimalText = fc
  .record({ coefficient: fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), scale: fc.integer({ min: 0, max: 6 }) })
  .map((value) => formatDecimal(value));

const read: fc.Arbitrary<FieldReadV1> = fc.oneof(
  decimalText.map((decimal): FieldReadV1 => ({ kind: "decimal", decimal })),
  fc.string({ maxLength: 8 }).map((text): FieldReadV1 => ({ kind: "text", text: text.normalize("NFC") })),
  fc.integer({ min: -100_000, max: 100_000 }).map((epochDay): FieldReadV1 => ({ kind: "date", epochDay })),
  fc.boolean().map((boolean): FieldReadV1 => ({ kind: "boolean", boolean })),
  fc.constantFrom<FieldReadV1>({ kind: "missing" }, { kind: "blank" }, { kind: "error", code: "#N/A" }),
);

const ir: fc.Arbitrary<FormulaIRV1> = fc.letrec<{ node: FormulaIRV1 }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    decimalText.map((decimal): FormulaIRV1 => ({ kind: "literal", value: { kind: "decimal", decimal } })),
    fc.string({ maxLength: 6 }).map((text): FormulaIRV1 => ({ kind: "literal", value: { kind: "text", text: text.normalize("NFC") } })),
    fc.boolean().map((boolean): FormulaIRV1 => ({ kind: "literal", value: { kind: "boolean", boolean } })),
    fc.constantFrom<FormulaIRV1>(
      { kind: "error", code: "#DIV/0!" },
      { kind: "field", fieldId: field(1) },
      { kind: "field", fieldId: field(2) },
      { kind: "column", tableId: TABLE, fieldId: field(1) },
      { kind: "related", relationshipId: RELATIONSHIP, referenceFieldId: field(3), fieldId: field(2) },
      { kind: "formula", formulaId: formula(1) },
    ),
    fc.record({
      kind: fc.constant("unary" as const),
      operator: fc.constantFrom("+" as const, "-" as const, "%" as const),
      operand: tie("node"),
    }),
    fc.record({
      kind: fc.constant("binary" as const),
      operator: fc.constantFrom(...IR_BINARY_OPERATORS),
      left: tie("node"),
      right: tie("node"),
    }),
    fc.record({
      kind: fc.constant("call" as const),
      name: fc.constantFrom(...CATALOG_FUNCTION_NAMES),
      version: fc.constant(1),
      args: fc.array(fc.option(tie("node"), { nil: null }), { maxLength: 4 }),
    }),
  ),
})).node;

const rowOf = (values: readonly FieldReadV1[]): RowAccessV1 => ({
  recordId: RECORD,
  valueOf: (fieldId) => values[(fieldId[0] ?? 1) - 1] ?? { kind: "missing" },
});

const envOf = (values: readonly FieldReadV1[], epochDay: number): EvaluationEnvV1 => ({
  clock: () => ({ epochDay, epochMs: epochDay * 86_400_000 }),
  columns: { valuesOf: () => values },
  formulaResults: (): EvaluationResultV1 => ({ kind: "ok", value: { kind: "decimal", decimal: "7" } }),
  relatedRow: () => rowOf(values),
  optionLabel: () => "Option",
});

describe("evaluator properties", () => {
  it("never throws on any IR, and is deterministic for the same inputs and clock", () => {
    fc.assert(
      fc.property(ir, fc.array(read, { minLength: 3, maxLength: 3 }), fc.integer({ min: -1000, max: 40_000 }), (root, values, day) => {
        const document = { irVersion: 1 as const, root };
        const first = evaluateRow(document, rowOf(values), envOf(values, day));
        const second = evaluateRow(document, rowOf(values), envOf(values, day));
        expect(second).toEqual(first);
        expect(["ok", "empty", "error", "cycle", "unsupported"]).toContain(first.kind);
        expect(() => evaluateScalar(document, envOf(values, day))).not.toThrow();
      }),
      { numRuns: 400 },
    );
  });

  it("adds and subtracts decimals exactly: a + b − b ≡ a", () => {
    fc.assert(
      fc.property(decimalText, decimalText, (a, b) => {
        const literal = (decimal: string): FormulaIRV1 => ({ kind: "literal", value: { kind: "decimal", decimal } });
        const root: FormulaIRV1 = { kind: "binary", operator: "-", left: { kind: "binary", operator: "+", left: literal(a), right: literal(b) }, right: literal(b) };
        const result = evaluateScalar({ irVersion: 1, root }, envOf([], 0));
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok" || result.value.kind !== "decimal") return;
        expect(compareDecimals(parseDecimal(result.value.decimal), parseDecimal(a))).toBe(0);
        if (parseDecimal(b).scale <= parseDecimal(a).scale) expect(result.value.decimal).toBe(a);
      }),
    );
  });
});

const graphInput: fc.Arbitrary<readonly FormulaNodeV1[]> = fc
  .array(
    fc.record({
      computes: fc.boolean(),
      reads: fc.array(fc.oneof(fc.integer({ min: 1, max: 12 }).map((n) => ({ kind: "field" as const, n })), fc.integer({ min: 1, max: 12 }).map((n) => ({ kind: "formula" as const, n }))), { maxLength: 3 }),
    }),
    { minLength: 1, maxLength: 12 },
  )
  .map((specs) =>
    specs.map((spec, index) => ({
      formulaId: formula(index + 1),
      // Formula n computes field 100 + n; fields 1–12 are authored, 101–112 computed.
      targetFieldId: spec.computes ? field(100 + index + 1) : null,
      dependencies: spec.reads.map((dependency) =>
        dependency.kind === "field"
          ? { kind: "field" as const, fieldId: field(dependency.n % 2 === 0 ? 100 + dependency.n : dependency.n) }
          : { kind: "formula" as const, formulaId: formula(dependency.n) },
      ),
    })),
  );

describe("dependency graph properties", () => {
  it("orders each formula after its producers and never orders a cycle member", () => {
    fc.assert(
      fc.property(graphInput, (formulas) => {
        const graph = buildDependencyGraph(formulas);
        const ordered = graph.order.map(encodeDomainId);
        const cyclic = graph.cycles.map(encodeDomainId);
        expect(ordered.filter((key) => cyclic.includes(key))).toEqual([]);
        expect(new Set([...ordered, ...cyclic])).toEqual(new Set(formulas.map((node) => encodeDomainId(node.formulaId))));
        for (const [producer, readers] of graph.readersOfFormula) {
          for (const reader of readers.map(encodeDomainId)) {
            if (!ordered.includes(reader)) continue;
            expect(ordered.indexOf(producer), `${producer} before ${reader}`).toBeLessThan(ordered.indexOf(reader));
          }
        }
      }),
    );
  });

  it("returns a downstream set inside the graph, in order, and closed under readers", () => {
    fc.assert(
      fc.property(graphInput, fc.array(fc.integer({ min: 1, max: 112 }), { maxLength: 4 }), (formulas, changed) => {
        const graph = buildDependencyGraph(formulas);
        const affected = downstreamOf(graph, changed.map(field)).map(encodeDomainId);
        const ordered = graph.order.map(encodeDomainId);
        expect(affected).toEqual(ordered.filter((key) => affected.includes(key)));
        for (const key of affected) {
          for (const reader of (graph.readersOfFormula.get(key) ?? []).map(encodeDomainId)) {
            if (ordered.includes(reader)) expect(affected).toContain(reader);
          }
        }
        for (const fieldId of changed.map(field)) {
          for (const reader of (graph.readersOfField.get(encodeDomainId(fieldId)) ?? []).map(encodeDomainId)) {
            if (ordered.includes(reader)) expect(affected).toContain(reader);
          }
        }
      }),
    );
  });
});
