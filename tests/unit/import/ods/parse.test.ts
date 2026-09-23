import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { odsAdapter } from "../../../../src/import/formats/ods/index.js";
import { ooxmlAdapter } from "../../../../src/import/formats/ooxml/index.js";
import { convertOpenFormula } from "../../../../src/import/formats/ods/formula.js";
import type { WorkbookFactStreamItemV2, WorkbookFactV2 } from "../../../../src/import/facts/index.js";
import { openZipContainer } from "../../../../src/import/source/zip.js";
import { buildOds, paragraphs, rowXml } from "../../../fixtures/workbooks/ods/build-ods.js";
import { assertConformingStream } from "../facts/conformance.js";
import { bytesSource, fixtureBytes } from "../fixtures.js";

const ALL_SHEETS = Array.from({ length: 8 }, (_, index) => index);

const parse = async (
  bytes: Uint8Array,
  selection: readonly number[] = ALL_SHEETS,
  factsPerBatch?: number,
): Promise<WorkbookFactStreamItemV2[]> => {
  const zip = await openZipContainer(bytesSource(bytes));
  const items: WorkbookFactStreamItemV2[] = [];
  const cancellation = { aborted: false };
  const options = factsPerBatch === undefined ? { cancellation } : { cancellation, factsPerBatch };
  for await (const item of odsAdapter.parseSheets({ kind: "zip", zip }, selection, options)) {
    items.push(item);
  }
  return items;
};

const factsOf = (items: readonly WorkbookFactStreamItemV2[]): WorkbookFactV2[] =>
  items.flatMap((item) => (item.kind === "batch" ? [...item.facts] : []));

const fixture = async (name: string, selection?: readonly number[]): Promise<WorkbookFactV2[]> =>
  factsOf(await parse(await fixtureBytes(`ods/${name}`), selection));

const ofKind = <K extends WorkbookFactV2["kind"]>(facts: readonly WorkbookFactV2[], kind: K) =>
  facts.filter((fact): fact is Extract<WorkbookFactV2, { kind: K }> => fact.kind === kind);

/** Facts per sheet name and kind: the pinned shape of a fixture. */
const countsOf = (facts: readonly WorkbookFactV2[]): Record<string, Record<string, number>> => {
  const counts: Record<string, Record<string, number>> = {};
  let sheet = "(none)";
  for (const fact of facts) {
    if (fact.kind === "sheet") sheet = fact.name;
    const tally = (counts[sheet] ??= {});
    tally[fact.kind] = (tally[fact.kind] ?? 0) + 1;
  }
  return counts;
};

/** Pinned fact counts, every sheet selected. A change here is a CA-17 change S02/S06 must hear about. */
const PINNED: Readonly<Record<string, Record<string, Record<string, number>>>> = {
  "lookup-validation.ods": {
    Orders: { sheet: 1, "defined-name": 1, row: 5, value: 24, formula: 6, validation: 3, "preserved-part": 1 },
    Products: { sheet: 1, row: 4, value: 8, "declared-table": 1, "preserved-part": 1 },
  },
  "repeats.ods": { Repeats: { sheet: 1, row: 5, value: 11 } },
  "formats.ods": {
    Formats: { sheet: 1, row: 13, value: 26, "cell-format": 9, formula: 1, diagnostic: 3, "preserved-part": 1 },
  },
  "annotation-chart.ods": {
    "Site log": { sheet: 1, row: 3, value: 5, merge: 1, "preserved-part": 6 },
    "Hidden notes": { sheet: 1, row: 1, value: 1 },
  },
  "encrypted.ods": { Ledger: { sheet: 1, row: 2, value: 4 } },
  "basic-macro.ods": { Ledger: { sheet: 1, row: 2, value: 4 } },
  "no-settings.ods": { Ledger: { sheet: 1, row: 2, value: 4 }, Notes: { sheet: 1, row: 1, value: 1 } },
  "fieldwork-jobs-customers.ods": {
    Jobs: {
      sheet: 1,
      row: 61,
      value: 610,
      formula: 120,
      "cell-format": 9,
      diagnostic: 1,
      validation: 1,
      "declared-table": 1,
      "preserved-part": 1,
    },
    Customers: { sheet: 1, row: 13, value: 52, "declared-table": 1, "preserved-part": 1 },
  },
};

describe("ODS fact stream (CA-17)", () => {
  it("conforms to V2 on every readable ODS fixture, at the default and a tiny batch bound", async () => {
    const names = (await readdir("tests/fixtures/workbooks/ods")).filter((name) => name.endsWith(".ods") && name !== "hostile-repeat.ods");
    expect(names.length).toBeGreaterThanOrEqual(7);
    for (const name of names) {
      const bytes = await fixtureBytes(`ods/${name}`);
      assertConformingStream(await parse(bytes));
      assertConformingStream(await parse(bytes, ALL_SHEETS, 5), { factsPerBatch: 5 });
    }
  });

  it("pins every fixture's facts per sheet and kind", async () => {
    for (const [name, expected] of Object.entries(PINNED)) {
      expect(countsOf(await fixture(name)), name).toEqual(expected);
    }
  });

  it("reads F02's site-plan.ods as a workbook with no sheets: a summary and nothing else", async () => {
    expect(await parse(await fixtureBytes("refusals/site-plan.ods"))).toEqual([
      { kind: "summary", rowCount: 0, columnCount: 0, valueCount: 0, batchCount: 0, diagnostics: [] },
    ]);
  });

  it("carries OpenFormula lookups as Excel text, and non-mechanical ones as undecodable", async () => {
    const formulas = ofKind(await fixture("lookup-validation.ods"), "formula");
    expect(formulas.map(({ rowIndex, columnIndex, text, isExternal }) => [rowIndex, columnIndex, text, isExternal])).toEqual([
      [1, 2, "VLOOKUP(B2,Products!$A$2:$B$4,2,0)", false],
      [2, 2, "VLOOKUP(B3,Products!$A$2:$B$4,2,0)", false],
      [3, 2, "VLOOKUP(B4,Products!$A$2:$B$4,2,0)", false],
      [4, 4, "SUM(E2:E4)", false],
      [4, 5, null, false],
      [4, 6, null, true],
    ]);
    expect(formulas.every((formula) => formula.sharedGroup === null && !formula.isArray)).toBe(true);
  });

  it("states validations, named ranges and database ranges on the right sheets", async () => {
    const facts = await fixture("lookup-validation.ods");
    expect(ofKind(facts, "validation")).toEqual([
      {
        kind: "validation",
        range: { firstRow: 1, firstColumn: 1, lastRow: 3, lastColumn: 1 },
        rule: "list",
        operator: null,
        listSource: { kind: "range", ref: "Products!$A$2:$A$4" },
        formula1: "Products!$A$2:$A$4",
        formula2: null,
      },
      {
        kind: "validation",
        range: { firstRow: 1, firstColumn: 3, lastRow: 3, lastColumn: 3 },
        rule: "list",
        operator: null,
        listSource: { kind: "inline", values: ["Open", "Shipped", "Closed"] },
        formula1: '"Open,Shipped,Closed"',
        formula2: null,
      },
      {
        kind: "validation",
        range: { firstRow: 1, firstColumn: 4, lastRow: 3, lastColumn: 4 },
        rule: "whole",
        operator: "between",
        listSource: null,
        formula1: "1",
        formula2: "100",
      },
    ]);
    expect(ofKind(facts, "defined-name")).toEqual([
      { kind: "defined-name", name: "ProductIds", ref: "Products!$A$2:$A$4", sheetIndex: null },
    ]);
    // The anonymous autofilter range is not a declared table.
    expect(ofKind(facts, "declared-table")).toEqual([
      {
        kind: "declared-table",
        name: "ProductsTable",
        range: { firstRow: 0, firstColumn: 0, lastRow: 3, lastColumn: 1 },
        headerRowCount: 1,
        totalsRowCount: 0,
        columns: ["Product ID", "Name"],
      },
    ]);
  });

  it("reads every value type as a decimal serial, boolean or text, with its format class", async () => {
    const facts = await fixture("formats.ods");
    const at = (row: number) => ofKind(facts, "value").find((fact) => fact.rowIndex === row && fact.columnIndex === 1)?.value;
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(at)).toEqual([
      { kind: "decimal", decimal: "1234.5" },
      { kind: "decimal", decimal: "0.125" },
      { kind: "decimal", decimal: "45366" },
      { kind: "decimal", decimal: "45366.354166666664" },
      { kind: "decimal", decimal: "0.3541666666666667" },
      { kind: "boolean", boolean: true },
      { kind: "decimal", decimal: "3.14159" },
      { kind: "decimal", decimal: "1" },
      { kind: "invalid-preserved", sourceText: "#DIV/0!" },
      { kind: "invalid-preserved", sourceText: "abc" },
      { kind: "text", text: "Café" },
      { kind: "text", text: "Line one\nLine  two\tend\nlast" },
    ]);
    expect(ofKind(facts, "cell-format").map(({ rowIndex, numberFormat, formatClass, currencySymbol }) => [rowIndex, numberFormat, formatClass, currencySymbol])).toEqual([
      [1, '"$"#,##0.00', "currency", "$"],
      [2, "0.0%", "percent", null],
      [3, "yyyy-mm-dd", "date", null],
      [4, "yyyy-mm-dd hh:mm", "datetime", null],
      [5, "hh:mm:ss", "time", null],
      [6, "BOOLEAN", "other", null],
      [7, "0.00", "number", null],
      [8, "yyyy-mm-dd", "date", null],
      [9, "General", "general", null],
    ]);
    const summary = (await parse(await fixtureBytes("ods/formats.ods"))).at(-1);
    expect(summary).toMatchObject({
      diagnostics: [
        { code: "error-value", occurrences: 1 },
        { code: "malformed-value", occurrences: 1 },
        { code: "text-normalized-nfc", occurrences: 1 },
      ],
    });
  });

  it("expands repeats sparsely: blank runs move the cursor, the million-row tail costs nothing", async () => {
    const facts = await fixture("repeats.ods");
    expect(ofKind(facts, "row").map((fact) => [fact.rowIndex, fact.cellCount])).toEqual([
      [0, 2],
      [1, 6],
      [2, 2],
      [3, 2],
      [9, 1],
    ]);
    expect(ofKind(facts, "value").filter((fact) => fact.rowIndex === 1).map((fact) => fact.columnIndex)).toEqual([0, 1, 2, 5]);
  });

  it("refuses a repeat that would emit past the budget, before emitting it", async () => {
    await expect(parse(await fixtureBytes("ods/hostile-repeat.ods"))).rejects.toThrow("expansion-limit");
  });

  it("refuses a populated cell past the grid instead of allocating toward it", async () => {
    const pastRows = buildOds({
      content: {
        tables: [
          {
            name: "Far",
            rows: [
              rowXml([null], { "table:number-rows-repeated": 1_048_576 }),
              rowXml(["too far"]),
            ],
          },
        ],
      },
    });
    await expect(parse(pastRows)).rejects.toThrow("impossible-dimension");
    const pastColumns = buildOds({
      content: {
        tables: [{ name: "Wide", rows: [rowXml([{ attrs: { "table:number-columns-repeated": 16_384 } }, "too wide"])] }],
      },
    });
    await expect(parse(pastColumns)).rejects.toThrow("impossible-dimension");
  });

  it("preserves every inert part it cannot make interactive, anchored where a person finds it", async () => {
    const facts = await fixture("annotation-chart.ods");
    expect(ofKind(facts, "preserved-part").map(({ partKind, location, reasonKey, partPath }) => [partKind, location, reasonKey, partPath])).toEqual([
      ["image", "Site log", "visual-only", "Pictures/logo.png"],
      ["comment", "'Site log'!A2", "note-kept-as-text", null],
      ["hyperlink", "'Site log'!B2", "link-not-followed", null],
      ["chart", "'Site log'!A4:D8", "chart-not-live-yet", "Object 1"],
      ["conditional-formatting", "Site log", "formatting-not-reproduced", null],
      ["cell-styling", "Site log", "formatting-not-reproduced", null],
    ]);
    expect(ofKind(facts, "merge")).toEqual([{ kind: "merge", range: { firstRow: 2, firstColumn: 0, lastRow: 2, lastColumn: 1 } }]);
    expect(ofKind(facts, "sheet").map((fact) => fact.visibility)).toEqual(["visible", "hidden"]);
    // The annotation's own text is never the cell's value.
    expect(ofKind(facts, "value").some((fact) => fact.value.kind === "text" && fact.value.text.includes("gate code"))).toBe(false);
  });

  it("streams only the selected sheets; an unknown sheet list reads every table for any selection", async () => {
    const products = await fixture("lookup-validation.ods", [1]);
    expect(ofKind(products, "sheet").map((fact) => [fact.sheetIndex, fact.name])).toEqual([[1, "Products"]]);
    // The first selected sheet carries the workbook-wide facts.
    expect(ofKind(products, "defined-name")).toHaveLength(1);

    expect(ofKind(await fixture("no-settings.ods", [0]), "sheet").map((fact) => fact.name)).toEqual(["Ledger", "Notes"]);
    expect(await fixture("no-settings.ods", [])).toEqual([]);
  });

  it("ends a cancelled stream without a summary", async () => {
    const zip = await openZipContainer(bytesSource(await fixtureBytes("ods/lookup-validation.ods")));
    const cancellation = { aborted: false };
    const items: WorkbookFactStreamItemV2[] = [];
    for await (const item of odsAdapter.parseSheets({ kind: "zip", zip }, [0, 1], { cancellation, factsPerBatch: 4 })) {
      items.push(item);
      cancellation.aborted = true;
    }
    expect(items).toHaveLength(1);
    assertConformingStream(items, { factsPerBatch: 4, isComplete: false });
  });

  it("keeps a malformed repeat or span attribute at one", async () => {
    const facts = factsOf(
      await parse(
        buildOds({
          content: {
            tables: [
              {
                name: "Odd",
                rows: [
                  rowXml([
                    { attrs: { "office:value-type": "string", "table:number-columns-repeated": "-4" }, inner: paragraphs("a") },
                    { attrs: { "office:value-type": "string", "table:number-columns-spanned": "x" }, inner: paragraphs("b") },
                  ]),
                ],
              },
            ],
          },
        }),
      ),
    );
    expect(ofKind(facts, "value").map((fact) => fact.columnIndex)).toEqual([0, 1]);
    expect(ofKind(facts, "merge")).toEqual([]);
  });
});

describe("the demo relationship pair as ODS (CAP-27, for S06 CP4)", () => {
  it("holds fieldwork-q3.xlsx's Jobs and Customers values cell for cell", async () => {
    const zip = await openZipContainer(bytesSource(await fixtureBytes("ooxml/fieldwork-q3.xlsx")));
    const xlsx: WorkbookFactStreamItemV2[] = [];
    for await (const item of ooxmlAdapter.parseSheets({ kind: "zip", zip }, [0, 1], { cancellation: { aborted: false } })) {
      xlsx.push(item);
    }
    const ods = await fixture("fieldwork-jobs-customers.ods");
    const cells = (facts: readonly WorkbookFactV2[]) => ofKind(facts, "value").map(({ rowIndex, columnIndex, value }) => [rowIndex, columnIndex, value]);
    expect(cells(ods)).toEqual(cells(factsOf(xlsx)));
    expect(ofKind(ods, "row")).toEqual(ofKind(factsOf(xlsx), "row"));
  });

  it("carries the lookup into Customers as the relationship signal, and both declared tables", async () => {
    const facts = await fixture("fieldwork-jobs-customers.ods");
    const lookups = ofKind(facts, "formula").filter((formula) => formula.columnIndex === 2);
    expect(lookups).toHaveLength(60);
    expect(lookups[0]?.text).toBe("VLOOKUP(B2,Customers!A:B,2,FALSE())");
    expect(ofKind(facts, "declared-table").map((table) => [table.name, table.columns[0]])).toEqual([
      ["JobsTable", "Job ID"],
      ["CustomersTable", "Customer ID"],
    ]);
    expect(ofKind(facts, "validation")[0]?.listSource).toEqual({
      kind: "inline",
      values: ["Scheduled", "In progress", "Waiting", "Complete"],
    });
    expect(ofKind(facts, "cell-format").find((format) => format.columnIndex === 4)).toMatchObject({ formatClass: "currency", currencySymbol: "$" });
  });
});

describe("OpenFormula → Excel text (mechanical only)", () => {
  it.each([
    ["of:=SUM([.A1:.A5])", "SUM(A1:A5)"],
    ["of:=[.A1]+[.$B$2]", "A1+$B$2"],
    ["of:=VLOOKUP([.B2];[$Customers.$A$2:.$B$14];2;0)", "VLOOKUP(B2,Customers!$A$2:$B$14,2,0)"],
    ["of:=COUNTIF(['Job list'.D2:.D61];\"In progress\")", "COUNTIF('Job list'!D2:D61,\"In progress\")"],
    ["of:=IF([.C2]>5;\"a;b\";\"say \"\"hi\"\"\")", 'IF(C2>5,"a;b","say ""hi""")'],
    ["of:=SUM({1;2|3;4})", "SUM({1,2;3,4})"],
    ["of:=SUM([.A:.A])", "SUM(A:A)"],
    ["msoxl:=A1+B1", "A1+B1"],
    ["of:=MaterialList", "MaterialList"],
  ])("%s → %s", (raw, text) => {
    expect(convertOpenFormula(raw)).toEqual({ text, isExternal: false });
  });

  it.each([
    "of:=SUM([.A1:.A2]~[.A4])",
    "of:=SUM([.A1:.B4]![.B1:.C4])",
    "of:=SUM([Sheet1.A1:Sheet2.A1])",
    "of:=COM.MICROSOFT.XLOOKUP([.A1];[.B1:.B4];[.C1:.C4])",
    "of:=[.#REF!]",
    'of:="unterminated',
    "of:=",
    "SUM(A1)",
    "foo:=SUM(A1)",
  ])("%s has no mechanical Excel spelling", (raw) => {
    expect(convertOpenFormula(raw)).toEqual({ text: null, isExternal: false });
  });

  it("marks a reference into another document external", () => {
    expect(convertOpenFormula("of:=['file:///C:/prices.ods'#$Sheet1.A1]")).toEqual({ text: null, isExternal: true });
  });
});
