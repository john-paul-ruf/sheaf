import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  CATALOG_FUNCTION_NAMES,
  classifyFormula,
  downstreamOf,
  EVALUATION_RESULT_KINDS,
  FORMULA_DEPENDENCY_KINDS,
  FORMULA_DETERMINISMS,
  FORMULA_DISPOSITIONS,
  FORMULA_TARGET_KINDS,
  FUNCTION_CATALOG_V1,
  isAllowedClassification,
  isCycleMember,
  translateAuthored,
  type FormulaIRDocumentV1,
  type FormulaNodeV1,
} from "../../../src/domain/formulas/index.js";
import { encodeDomainId, type FieldId, type FormulaId } from "../../../src/domain/model/ids.js";
import { authoredResolver, id, PAID, QUOTED } from "./fixtures.js";

const D49 =
  "SUM AVERAGE MIN MAX COUNT COUNTA COUNTBLANK COUNTIF COUNTIFS SUMIF SUMIFS AVERAGEIF IF IFS IFERROR IFNA AND OR NOT XOR ROUND ROUNDUP ROUNDDOWN ABS INT MOD POWER SQRT CEILING FLOOR TODAY NOW DATE YEAR MONTH DAY WEEKDAY EDATE EOMONTH DATEDIF DAYS LEN LEFT RIGHT MID UPPER LOWER PROPER TRIM CONCAT CONCATENATE TEXTJOIN SUBSTITUTE FIND SEARCH VALUE TEXT ISBLANK ISNUMBER ISTEXT ISERROR RAND RANDBETWEEN VLOOKUP HLOOKUP XLOOKUP INDEX MATCH";

const document = (text: string): FormulaIRDocumentV1 => {
  const result = translateAuthored(text, authoredResolver());
  if (result.kind !== "translated") throw new Error(JSON.stringify(result));
  return result.document;
};

describe("FUNCTION_CATALOG_V1", () => {
  it("is exactly the D49 list, each entry version 1 with a determinism and cost class", () => {
    expect([...CATALOG_FUNCTION_NAMES]).toEqual(D49.split(" "));
    expect([...FUNCTION_CATALOG_V1.keys()]).toEqual(D49.split(" "));
    for (const entry of FUNCTION_CATALOG_V1.values()) {
      expect(entry.version, entry.name).toBe(1);
      expect(entry.minArgs, entry.name).toBeLessThanOrEqual(entry.maxArgs);
    }
    const byDeterminism = (determinism: string) =>
      [...FUNCTION_CATALOG_V1.values()].filter((entry) => entry.determinism === determinism).map((entry) => entry.name);
    expect(byDeterminism("clock-volatile")).toEqual(["TODAY", "NOW"]);
    expect(byDeterminism("nondeterministic")).toEqual(["RAND", "RANDBETWEEN"]);
    expect([...FUNCTION_CATALOG_V1.values()].filter((entry) => entry.cost === "lookup").map((entry) => entry.name)).toEqual([
      "VLOOKUP",
      "HLOOKUP",
      "XLOOKUP",
      "INDEX",
      "MATCH",
    ]);
  });
});

describe("migration 005 pins (CA-25, CA-26)", () => {
  it("restates the formulas CHECK sets verbatim", async () => {
    const sql = await readFile("src/migrations/005_projection_v1.sql", "utf8");
    const set = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
    expect(sql).toContain(`target_kind IN (${set(FORMULA_TARGET_KINDS)})`);
    expect(sql).toContain(`disposition IN (${set(FORMULA_DISPOSITIONS)})`);
    expect(sql.replace(/\s+/g, " ")).toContain(`determinism IN ( ${set(FORMULA_DETERMINISMS)} )`);
    expect(sql).toContain(`dependency_kind IN (${set(FORMULA_DEPENDENCY_KINDS)})`);
    expect(sql).toContain(`status IN (${set(EVALUATION_RESULT_KINDS)})`);
    expect(sql).toContain("(disposition = 'live' AND determinism IN ('deterministic', 'clock-volatile')) OR");
    expect(sql).toContain("(disposition = 'frozen' AND determinism = 'frozen-nondeterministic') OR");
    expect(sql).toContain("(disposition = 'unsupported' AND determinism = 'unsupported')");
  });
});

describe("classifyFormula", () => {
  it("assigns exactly migration 005's disposition ↔ determinism pairs", () => {
    expect(classifyFormula(document("[Quoted]-[Paid]"))).toEqual({ disposition: "live", determinism: "deterministic" });
    expect(classifyFormula(document("TODAY()-[Quoted]"))).toEqual({ disposition: "live", determinism: "clock-volatile" });
    expect(classifyFormula(document("RAND()*TODAY()"))).toEqual({
      disposition: "frozen",
      determinism: "frozen-nondeterministic",
    });
    expect(classifyFormula(null)).toEqual({ disposition: "unsupported", determinism: "unsupported" });
    const lookup: FormulaIRDocumentV1 = { irVersion: 1, root: { kind: "call", name: "MATCH", version: 1, args: [] } };
    expect(classifyFormula(lookup)).toEqual({ disposition: "unsupported", determinism: "unsupported" });
    const future: FormulaIRDocumentV1 = { irVersion: 1, root: { kind: "call", name: "SUM", version: 2, args: [] } };
    expect(classifyFormula(future).disposition).toBe("unsupported");
    for (const disposition of FORMULA_DISPOSITIONS) {
      for (const determinism of FORMULA_DETERMINISMS) {
        const isPairOfClassifier = [
          ["live", "deterministic"],
          ["live", "clock-volatile"],
          ["frozen", "frozen-nondeterministic"],
          ["unsupported", "unsupported"],
        ].some(([d, k]) => d === disposition && k === determinism);
        expect(isAllowedClassification(disposition, determinism), `${disposition}/${determinism}`).toBe(isPairOfClassifier);
      }
    }
  });
});

describe("buildDependencyGraph", () => {
  const formula = (n: number): FormulaId => id("formula", n);
  const field = (n: number): FieldId => id("field", n);
  const keys = (ids: readonly FormulaId[]) => ids.map(encodeDomainId);

  // A: field 1 → computed field 101. B reads 101 and field 2 → computed 102. C reads formula B.
  const a: FormulaNodeV1 = { formulaId: formula(1), targetFieldId: field(101), dependencies: [{ kind: "field", fieldId: field(1) }] };
  const b: FormulaNodeV1 = {
    formulaId: formula(2),
    targetFieldId: field(102),
    dependencies: [
      { kind: "field", fieldId: field(101) },
      { kind: "field", fieldId: field(2) },
    ],
  };
  const c: FormulaNodeV1 = { formulaId: formula(3), targetFieldId: null, dependencies: [{ kind: "formula", formulaId: formula(2) }] };
  const d: FormulaNodeV1 = { formulaId: formula(4), targetFieldId: null, dependencies: [{ kind: "field", fieldId: field(3) }] };

  it("orders every formula after what it reads, whatever the input order", () => {
    for (const input of [
      [a, b, c, d],
      [c, b, d, a],
      [d, c, a, b],
    ]) {
      const graph = buildDependencyGraph(input);
      expect(keys(graph.order)).toEqual(keys([formula(1), formula(4), formula(2), formula(3)]));
      expect(graph.cycles).toEqual([]);
    }
  });

  it("flags a cycle and everything downstream of it, and never orders them", () => {
    const loopA: FormulaNodeV1 = { formulaId: formula(5), targetFieldId: field(105), dependencies: [{ kind: "field", fieldId: field(106) }] };
    const loopB: FormulaNodeV1 = { formulaId: formula(6), targetFieldId: field(106), dependencies: [{ kind: "field", fieldId: field(105) }] };
    const reader: FormulaNodeV1 = { formulaId: formula(7), targetFieldId: null, dependencies: [{ kind: "formula", formulaId: formula(6) }] };
    const self: FormulaNodeV1 = { formulaId: formula(8), targetFieldId: field(108), dependencies: [{ kind: "field", fieldId: field(108) }] };
    const graph = buildDependencyGraph([a, loopA, loopB, reader, self]);
    expect(keys(graph.order)).toEqual(keys([formula(1)]));
    expect(keys(graph.cycles)).toEqual(keys([formula(5), formula(6), formula(7), formula(8)]));
    expect(isCycleMember(graph, formula(6))).toBe(true);
    expect(isCycleMember(graph, formula(1))).toBe(false);
    expect(keys(downstreamOf(graph, [field(105), field(1)]))).toEqual(keys([formula(1)]));
  });

  it("finds only the downstream formulas of a change, in evaluation order (D60)", () => {
    const graph = buildDependencyGraph([a, b, c, d]);
    expect(keys(downstreamOf(graph, [field(1)]))).toEqual(keys([formula(1), formula(2), formula(3)]));
    expect(keys(downstreamOf(graph, [field(2)]))).toEqual(keys([formula(2), formula(3)]));
    expect(keys(downstreamOf(graph, [field(3)]))).toEqual(keys([formula(4)]));
    expect(downstreamOf(graph, [field(99)])).toEqual([]);
    expect(keys(downstreamOf(graph, [], [formula(2)]))).toEqual(keys([formula(3)]));
  });

  it("takes its edges from translated dependencies", () => {
    const translated = translateAuthored("[Quoted]-[Paid]", authoredResolver());
    const dependencies = translated.kind === "translated" ? translated.dependencies : [];
    const graph = buildDependencyGraph([{ formulaId: formula(9), targetFieldId: field(109), dependencies }]);
    expect(keys(downstreamOf(graph, [PAID]))).toEqual(keys([formula(9)]));
    expect(keys(downstreamOf(graph, [QUOTED]))).toEqual(keys([formula(9)]));
  });
});
