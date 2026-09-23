import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FORMULA_UNPARSED_REASONS,
  parseFormula,
  type FormulaAstV1,
  type FormulaReferenceV1,
  type SheetScopeV1,
} from "../../../src/domain/formulas/index.js";
import { printFormula } from "./printer.js";

const scope: fc.Arbitrary<SheetScopeV1 | null> = fc.option(
  fc.record({
    workbook: fc.option(fc.constantFrom("1", "2"), { nil: null }),
    firstSheet: fc.constantFrom("Jobs", "My Sheet", "Q3 2026", "O'Brien"),
    lastSheet: fc.option(fc.constantFrom("Crew", "Archive 2018"), { nil: null }),
  }),
  { nil: null },
);

const coordinate = fc.record({
  row: fc.integer({ min: 0, max: 1_048_575 }),
  column: fc.integer({ min: 0, max: 16_383 }),
  isRowAbsolute: fc.boolean(),
  isColumnAbsolute: fc.boolean(),
});

const reference: fc.Arbitrary<FormulaReferenceV1> = fc.oneof(
  fc.record({ kind: fc.constant("cell" as const), scope, cell: coordinate }),
  fc.record({ kind: fc.constant("area" as const), scope, first: coordinate, last: coordinate }),
  fc.record({
    kind: fc.constant("columns" as const),
    scope,
    firstColumn: fc.integer({ min: 0, max: 16_383 }),
    lastColumn: fc.integer({ min: 0, max: 16_383 }),
    isFirstAbsolute: fc.boolean(),
    isLastAbsolute: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("rows" as const),
    scope,
    firstRow: fc.integer({ min: 0, max: 1_048_575 }),
    lastRow: fc.integer({ min: 0, max: 1_048_575 }),
    isFirstAbsolute: fc.boolean(),
    isLastAbsolute: fc.boolean(),
  }),
  fc.record({ kind: fc.constant("name" as const), scope, name: fc.constantFrom("Rate", "Tax_Total", "MaterialList") }),
  fc.record({
    kind: fc.constant("structured" as const),
    table: fc.option(fc.constantFrom("JobsTable", "Visits"), { nil: null }),
    specifiers: fc.constantFrom([], ["#Headers"], ["#Data"], ["#All"]),
    firstColumn: fc.option(fc.constantFrom("Job ID", "Amount", "Rate [net]", "#Tag"), { nil: null }),
    lastColumn: fc.constant(null),
    isThisRow: fc.constant(false),
  }),
);

const constant: fc.Arbitrary<FormulaAstV1> = fc.oneof(
  fc.constantFrom("0", "12", "3.5", "1E3").map((text): FormulaAstV1 => ({ kind: "number", text })),
  fc.string({ maxLength: 6 }).map((value): FormulaAstV1 => ({ kind: "string", value })),
  fc.boolean().map((value): FormulaAstV1 => ({ kind: "boolean", value })),
  fc.constantFrom("#N/A", "#REF!", "#DIV/0!").map((code): FormulaAstV1 => ({ kind: "error", code })),
);

const referenceNode = reference.map((value): FormulaAstV1 => ({ kind: "reference", reference: value }));

const { formula } = fc.letrec<{ formula: FormulaAstV1 }>((tie) => ({
  formula: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    constant,
    referenceNode,
    fc.record({
      kind: fc.constant("array" as const),
      rows: fc.array(fc.array(constant, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 3 }),
    }),
    fc.record({ kind: fc.constant("unary" as const), operator: fc.constantFrom("+" as const, "-" as const), operand: tie("formula") }),
    fc.record({ kind: fc.constant("percent" as const), operand: tie("formula") }),
    fc.record({
      kind: fc.constant("binary" as const),
      operator: fc.constantFrom("^" as const, "*" as const, "/" as const, "+" as const, "-" as const, "&" as const, "=" as const, "<>" as const, "<=" as const, ">" as const),
      left: tie("formula"),
      right: tie("formula"),
    }),
    fc.record({ kind: fc.constant("binary" as const), operator: fc.constantFrom(":" as const, " " as const), left: referenceNode, right: referenceNode }),
    fc.record({
      kind: fc.constant("group" as const),
      expression: fc.oneof(
        tie("formula"),
        fc.record({ kind: fc.constant("binary" as const), operator: fc.constant("," as const), left: referenceNode, right: referenceNode }),
      ),
    }),
    fc.record({
      kind: fc.constant("call" as const),
      name: fc.constantFrom("SUM", "IF", "VLOOKUP", "XLOOKUP"),
      prefix: fc.constantFrom(null, "_xlfn."),
      args: fc.array(fc.option(tie("formula"), { nil: null }), { maxLength: 3 }),
    }),
  ),
}));

describe("parseFormula properties", () => {
  it("never throws on arbitrary text and always names a closed reason", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 60 }), fc.string({ unit: "binary", maxLength: 40 })), (text) => {
        const result = parseFormula(text);
        if (result.kind === "unparsed") expect(FORMULA_UNPARSED_REASONS).toContain(result.reason);
      }),
      { numRuns: 2000 },
    );
  });

  it("never throws on formula-shaped noise", () => {
    const piece = fc.constantFrom("=", "A1", ":", "$", "!", "'", "[", "]", "@", "#", "(", ")", "{", "}", ",", ";", " ", '"', "SUM", "Sheet1", "1", "%", "-", "^", "&", "<>", "_xlfn.");
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 30 }), (pieces) => {
        const result = parseFormula(pieces.join(""));
        expect(["parsed", "unparsed"]).toContain(result.kind);
      }),
      { numRuns: 2000 },
    );
  });

  it("prints a generated tree to text that re-parses to the same text and tree", () => {
    fc.assert(
      fc.property(formula, (ast) => {
        const text = printFormula(ast);
        const first = parseFormula(`=${text}`);
        expect(first.kind, text).toBe("parsed");
        if (first.kind !== "parsed") return;
        expect(printFormula(first.ast)).toBe(text);
        expect(parseFormula(printFormula(first.ast))).toEqual(first);
      }),
      { numRuns: 1000 },
    );
  });
});
