import { describe, expect, it } from "vitest";
import {
  extractReferences,
  findLookups,
  parseFormula,
  type FormulaAstV1,
} from "../../../src/domain/formulas/index.js";
import type { WorkbookFactStreamItemV2 } from "../../../src/import/facts/index.js";
import { ooxmlAdapter } from "../../../src/import/formats/ooxml/index.js";
import { openZipContainer } from "../../../src/import/source/zip.js";
import { fixtureSource } from "../import/fixtures.js";

const ast = (text: string): FormulaAstV1 => {
  const result = parseFormula(text);
  if (result.kind !== "parsed") throw new Error(`${text} did not parse: ${result.reason}`);
  return result.ast;
};

const demoFormulaTexts = async (): Promise<string[]> => {
  const zip = await openZipContainer(await fixtureSource("ooxml/fieldwork-q3.xlsx"));
  const items: WorkbookFactStreamItemV2[] = [];
  for await (const item of ooxmlAdapter.parseSheets({ kind: "zip", zip }, [0, 1, 2, 3, 4, 5, 6], { cancellation: { aborted: false } })) {
    items.push(item);
  }
  return items.flatMap((item) =>
    item.kind === "batch" ? item.facts.flatMap((fact) => (fact.kind === "formula" && fact.text !== null ? [fact.text] : [])) : [],
  );
};

describe("findLookups", () => {
  it("parses every formula the demo workbook carries and finds its VLOOKUP", async () => {
    const texts = await demoFormulaTexts();
    // Two shared-formula masters on Jobs, four on Overview; children carry no text.
    expect(texts).toEqual([
      "VLOOKUP(B2,Customers!A:B,2,FALSE)",
      "E2-F2",
      'COUNTIF(Jobs!D2:D61,"In progress")',
      "SUM(Jobs!E2:E61)",
      "SUM(Jobs!F2:F61)",
      "B4-B5",
    ]);
    for (const text of texts) {
      expect(parseFormula(text).kind, text).toBe("parsed");
    }
    const lookups = texts.flatMap((text) => findLookups(ast(text)));
    expect(lookups).toEqual([
      {
        functionName: "VLOOKUP",
        keyReferences: [
          { kind: "cell", scope: null, cell: { row: 1, column: 1, isRowAbsolute: false, isColumnAbsolute: false } },
        ],
        lookupRange: {
          kind: "columns",
          scope: { workbook: null, firstSheet: "Customers", lastSheet: null },
          firstColumn: 0,
          lastColumn: 1,
        },
        returnIndex: 2,
      },
    ]);
    expect(extractReferences(ast(texts[2] as string))).toMatchObject([{ kind: "area", scope: { firstSheet: "Jobs" } }]);
  });

  it("names the lookup range for every supported form", () => {
    expect(findLookups(ast("=HLOOKUP(A1,Rates!$A$1:$F$2,2,FALSE)"))).toMatchObject([
      { functionName: "HLOOKUP", lookupRange: { kind: "columns", firstColumn: 0, lastColumn: 5 }, returnIndex: 2 },
    ]);
    expect(findLookups(ast("=_xlfn.XLOOKUP([@[Customer ID]],CustomersTable[Customer ID],CustomersTable[Name])"))).toMatchObject([
      {
        functionName: "XLOOKUP",
        keyReferences: [{ kind: "structured", firstColumn: "Customer ID", isThisRow: true }],
        lookupRange: { kind: "table-columns", table: "CustomersTable", firstColumn: "Customer ID" },
        returnIndex: null,
      },
    ]);
    expect(findLookups(ast("=LOOKUP(B2,Codes!A2:A9,Codes!B2:B9)"))).toMatchObject([
      { functionName: "LOOKUP", lookupRange: { kind: "columns", firstColumn: 0, lastColumn: 0 } },
    ]);
    expect(findLookups(ast("=INDEX(Customers!B:B,MATCH(B2,Customers!A:A,0))"))).toMatchObject([
      { functionName: "INDEX-MATCH", lookupRange: { kind: "columns", firstColumn: 0, lastColumn: 0 }, keyReferences: [{ kind: "cell" }] },
    ]);
    expect(findLookups(ast("=VLOOKUP(B2,MaterialList,1,FALSE)"))).toMatchObject([
      { lookupRange: { kind: "name", name: "MaterialList" } },
    ]);
    expect(findLookups(ast("=IFERROR(VLOOKUP(B2,Customers!A:B,COLUMN(),FALSE),\"\")"))).toMatchObject([
      { functionName: "VLOOKUP", returnIndex: null },
    ]);
  });

  it("is not fooled by look-alikes", () => {
    // Approximate MATCH is not a key lookup; MATCH alone is not a lookup.
    expect(findLookups(ast("=INDEX(B:B,MATCH(A2,A:A,1))"))).toEqual([]);
    expect(findLookups(ast("=MATCH(A2,A:A,0)"))).toEqual([]);
    expect(findLookups(ast("=VLOOKUP(A2)"))).toEqual([]);
    expect(findLookups(ast("=SUM(A:A)"))).toEqual([]);
    expect(findLookups(ast("=VLOOKUP(A2,{1,2},1)"))).toMatchObject([{ lookupRange: { kind: "other" } }]);
  });
});
