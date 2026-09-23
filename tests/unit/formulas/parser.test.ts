import { describe, expect, it } from "vitest";
import {
  extractReferences,
  FORMULA_MAX_DEPTH,
  FORMULA_MAX_LENGTH,
  parseFormula,
  type FormulaAstV1,
} from "../../../src/domain/formulas/index.js";

const ast = (text: string): FormulaAstV1 => {
  const result = parseFormula(text);
  if (result.kind !== "parsed") throw new Error(`${text} did not parse: ${result.reason}`);
  return result.ast;
};

const num = (text: string): FormulaAstV1 => ({ kind: "number", text });
const cell = (column: number, row: number) => ({ row, column, isRowAbsolute: false, isColumnAbsolute: false });

describe("parseFormula — grammar", () => {
  it("reads literals with or without the leading =", () => {
    expect(ast("=1.5")).toEqual(num("1.5"));
    expect(ast("1E3")).toEqual(num("1E3"));
    expect(ast('="say ""hi"""')).toEqual({ kind: "string", value: 'say "hi"' });
    expect(ast("=true")).toEqual({ kind: "boolean", value: true });
    expect(ast("=#N/A")).toEqual({ kind: "error", code: "#N/A" });
    expect(ast("=#div/0!")).toEqual({ kind: "error", code: "#DIV/0!" });
    expect(ast("={1,-2;\"a\",TRUE}")).toEqual({
      kind: "array",
      rows: [
        [num("1"), { kind: "unary", operator: "-", operand: num("2") }],
        [{ kind: "string", value: "a" }, { kind: "boolean", value: true }],
      ],
    });
  });

  it("follows Excel precedence and left association", () => {
    expect(ast("=1+2*3")).toEqual({
      kind: "binary",
      operator: "+",
      left: num("1"),
      right: { kind: "binary", operator: "*", left: num("2"), right: num("3") },
    });
    expect(ast("=2^3^2")).toEqual({
      kind: "binary",
      operator: "^",
      left: { kind: "binary", operator: "^", left: num("2"), right: num("3") },
      right: num("2"),
    });
    // Negation binds tighter than ^, and % tighter than ^ as well.
    expect(ast("=-2^2")).toEqual({
      kind: "binary",
      operator: "^",
      left: { kind: "unary", operator: "-", operand: num("2") },
      right: num("2"),
    });
    expect(ast('=A1&"x"=B1')).toMatchObject({ kind: "binary", operator: "=", left: { operator: "&" } });
    expect(ast("=50%*2")).toMatchObject({ kind: "binary", operator: "*", left: { kind: "percent" } });
    expect(ast("=A1<>B1")).toMatchObject({ operator: "<>" });
  });

  it("reads references of every shape", () => {
    expect(ast("=$B$2")).toEqual({
      kind: "reference",
      reference: { kind: "cell", scope: null, cell: { row: 1, column: 1, isRowAbsolute: true, isColumnAbsolute: true } },
    });
    expect(ast("=A1:C10")).toEqual({
      kind: "reference",
      reference: { kind: "area", scope: null, first: cell(0, 0), last: cell(2, 9) },
    });
    expect(ast("=A:B")).toMatchObject({ reference: { kind: "columns", firstColumn: 0, lastColumn: 1 } });
    expect(ast("=1:3")).toMatchObject({ reference: { kind: "rows", firstRow: 0, lastRow: 2 } });
    expect(ast("=Customers!A:B")).toMatchObject({
      reference: { kind: "columns", scope: { workbook: null, firstSheet: "Customers", lastSheet: null } },
    });
    expect(ast("='My Sheet'!A:B")).toMatchObject({ reference: { scope: { firstSheet: "My Sheet" } } });
    expect(ast("='O''Brien'!A1")).toMatchObject({ reference: { scope: { firstSheet: "O'Brien" } } });
    expect(ast("=Sheet1:Sheet3!A1")).toMatchObject({
      reference: { kind: "cell", scope: { firstSheet: "Sheet1", lastSheet: "Sheet3" } },
    });
    expect(ast("=[1]Rates!B2")).toMatchObject({ reference: { scope: { workbook: "1", firstSheet: "Rates" } } });
    expect(ast("='C:\\books\\[Rates.xlsx]Q3'!B2")).toMatchObject({
      reference: { scope: { workbook: "C:\\books\\Rates.xlsx", firstSheet: "Q3" } },
    });
    expect(ast("=Rates!#REF!")).toEqual({ kind: "error", code: "#REF!" });
    expect(ast("=MaterialList")).toEqual({ kind: "reference", reference: { kind: "name", scope: null, name: "MaterialList" } });
    expect(ast("=Jobs!Rate")).toMatchObject({ reference: { kind: "name", name: "Rate", scope: { firstSheet: "Jobs" } } });
  });

  it("reads structured references", () => {
    expect(ast("=JobsTable[Job ID]")).toMatchObject({
      reference: { kind: "structured", table: "JobsTable", specifiers: [], firstColumn: "Job ID", isThisRow: false },
    });
    expect(ast("=JobsTable[[#Headers],[Status]]")).toMatchObject({
      reference: { specifiers: ["#Headers"], firstColumn: "Status" },
    });
    expect(ast("=[@Paid]")).toMatchObject({ reference: { table: null, firstColumn: "Paid", isThisRow: true } });
    expect(ast("=T[@[Quoted amount]]")).toMatchObject({ reference: { table: "T", firstColumn: "Quoted amount", isThisRow: true } });
    expect(ast("=T[[Paid]:[Balance]]")).toMatchObject({ reference: { firstColumn: "Paid", lastColumn: "Balance" } });
    expect(ast("=T[#All]")).toMatchObject({ reference: { specifiers: ["#All"], firstColumn: null } });
    expect(ast("=T['#Tag]")).toMatchObject({ reference: { specifiers: [], firstColumn: "#Tag" } });
  });

  it("reads calls, prefixes, omitted arguments, unions and intersections", () => {
    expect(ast("=_xlfn.XLOOKUP(A2,B:B,C:C)")).toMatchObject({ kind: "call", name: "XLOOKUP", prefix: "_xlfn." });
    expect(ast("=if(A1,,2)")).toEqual({
      kind: "call",
      name: "IF",
      prefix: null,
      args: [{ kind: "reference", reference: { kind: "cell", scope: null, cell: cell(0, 0) } }, null, num("2")],
    });
    expect(ast("=NOW()")).toEqual({ kind: "call", name: "NOW", prefix: null, args: [] });
    expect(ast("=LOG10(100)")).toMatchObject({ kind: "call", name: "LOG10" });
    expect(ast("=SUM((A1,B1))")).toMatchObject({
      args: [{ kind: "group", expression: { kind: "binary", operator: "," } }],
    });
    expect(ast("=SUM(A1:B5 B2:C3)")).toMatchObject({ args: [{ kind: "binary", operator: " " }] });
    expect(ast("= A1 + B1 ")).toMatchObject({ kind: "binary", operator: "+" });
    expect(ast("=A1:INDEX(B:B,2)")).toMatchObject({ kind: "binary", operator: ":", right: { kind: "call", name: "INDEX" } });
  });
});

describe("parseFormula — refusals are closed reasons, never partial trees", () => {
  it("refuses bad syntax", () => {
    for (const text of ["=", "=1+", "=SUM(1", "=(1", "=1)", '="open', "=1 2", "={A1}", "=,1"]) {
      expect(parseFormula(text), text).toEqual({ kind: "unparsed", reason: "syntax" });
    }
  });

  it("refuses tokens outside the grammar", () => {
    for (const text of ["=@A1", "=A1#", "=#BOGUS!", "=A1`", "=Sheet!A1#"]) {
      expect(parseFormula(text), text).toEqual({ kind: "unparsed", reason: "unsupported-token" });
    }
  });

  it("refuses text over 8,192 characters and nesting over 64", () => {
    expect(parseFormula(`=${"1+".repeat(4096)}1`)).toEqual({ kind: "unparsed", reason: "too-long" });
    expect(parseFormula("=" + "1".repeat(FORMULA_MAX_LENGTH - 1)).kind).toBe("parsed");

    const nested = (depth: number) => `=${"(".repeat(depth)}1${")".repeat(depth)}`;
    expect(parseFormula(nested(FORMULA_MAX_DEPTH)).kind).toBe("parsed");
    expect(parseFormula(nested(FORMULA_MAX_DEPTH + 1))).toEqual({ kind: "unparsed", reason: "too-deep" });
    const calls = (depth: number) => `=${"ABS(".repeat(depth)}1${")".repeat(depth)}`;
    expect(parseFormula(calls(FORMULA_MAX_DEPTH + 1))).toEqual({ kind: "unparsed", reason: "too-deep" });
    expect(parseFormula(`=${"-".repeat(FORMULA_MAX_DEPTH + 1)}1`)).toEqual({ kind: "unparsed", reason: "too-deep" });
  });
});

describe("extractReferences", () => {
  it("lists every reference in reading order", () => {
    const references = extractReferences(ast("=SUM(Jobs!E2:E61)+[@Paid]-Rate*'[1]X'!A1"));
    expect(references.map((reference) => reference.kind)).toEqual(["area", "structured", "name", "cell"]);
    expect(references[3]).toMatchObject({ scope: { workbook: "1" } });
  });
});
