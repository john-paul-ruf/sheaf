import { describe, expect, it } from "vitest";
import { findLookups, parseFormula } from "../../../../src/domain/formulas/index.js";
import type { WorkbookFactStreamItemV2, WorkbookFactV2 } from "../../../../src/import/facts/index.js";
import { ooxmlAdapter } from "../../../../src/import/formats/ooxml/parse.js";
import { readXlsbInventory } from "../../../../src/import/formats/xlsb/inventory.js";
import { xlsbAdapter } from "../../../../src/import/formats/xlsb/parse.js";
import { openZipContainer } from "../../../../src/import/source/zip.js";
import { DEMO_FACT_COUNTS } from "../../../fixtures/workbooks/ooxml/demo-counts.js";
import { XLSB_CORPUS } from "../../../fixtures/workbooks/xlsb/corpus.js";
import { assertConformingStream } from "../facts/conformance.js";
import { bytesSource, fixtureBytes } from "../fixtures.js";

const REFUSED = new Set(["xlsb/macro-vba.xlsb", "xlsb/xlm-macrosheet.xlsb"]);

const collect = async (
  adapter: typeof xlsbAdapter,
  bytes: Uint8Array,
  selection: readonly number[],
  options: { factsPerBatch?: number; abortAfterBatches?: number } = {},
): Promise<WorkbookFactStreamItemV2[]> => {
  const zip = await openZipContainer(bytesSource(bytes));
  const cancellation = { aborted: false };
  const items: WorkbookFactStreamItemV2[] = [];
  for await (const item of adapter.parseSheets({ kind: "zip", zip }, selection, {
    cancellation,
    ...(options.factsPerBatch === undefined ? {} : { factsPerBatch: options.factsPerBatch }),
  })) {
    items.push(item);
    if (options.abortAfterBatches !== undefined && items.length >= options.abortAfterBatches) cancellation.aborted = true;
  }
  return items;
};

const parse = async (bytes: Uint8Array, selection?: readonly number[], options: { factsPerBatch?: number; abortAfterBatches?: number } = {}) => {
  let chosen = selection;
  if (chosen === undefined) {
    const inventory = await readXlsbInventory.readInventory({ kind: "zip", zip: await openZipContainer(bytesSource(bytes)) });
    if (inventory.kind !== "inventory") throw new Error(JSON.stringify(inventory));
    chosen = inventory.inventory.sheets.map((sheet) => sheet.sheetIndex);
  }
  return collect(xlsbAdapter, bytes, chosen, options);
};

const factsOf = (items: readonly WorkbookFactStreamItemV2[]): WorkbookFactV2[] =>
  items.flatMap((item) => (item.kind === "batch" ? item.facts : []));

const countsOf = (items: readonly WorkbookFactStreamItemV2[]): Record<string, Record<string, number>> => {
  const counts: Record<string, Record<string, number>> = {};
  let sheet = "";
  for (const fact of factsOf(items)) {
    if (fact.kind === "sheet") sheet = fact.name;
    const bucket = (counts[sheet] ??= {});
    bucket[fact.kind] = (bucket[fact.kind] ?? 0) + 1;
  }
  return counts;
};

const ofKind = <K extends WorkbookFactV2["kind"]>(items: readonly WorkbookFactStreamItemV2[], kind: K) =>
  factsOf(items).filter((fact): fact is Extract<WorkbookFactV2, { kind: K }> => fact.kind === kind);

const summaryOf = (items: readonly WorkbookFactStreamItemV2[]) => {
  const last = items.at(-1);
  if (last?.kind !== "summary") throw new Error("no summary");
  return last;
};

const fixture = (name: string): Promise<Uint8Array> => fixtureBytes(`xlsb/${name}`);

describe("XLSB fact streams conform (CA-17)", () => {
  const readable = [...XLSB_CORPUS.keys()].filter((path) => !REFUSED.has(path));

  it("covers the whole readable corpus", () => {
    expect(readable.length).toBeGreaterThanOrEqual(12);
  });

  for (const path of readable) {
    it(`${path}: every sheet, and in batches of 7`, async () => {
      const bytes = await fixtureBytes(path);
      assertConformingStream(await parse(bytes));
      assertConformingStream(await parse(bytes, undefined, { factsPerBatch: 7 }), { factsPerBatch: 7 });
    });
  }
});

describe("XLSB fidelity — pinned facts", () => {
  it("fieldwork-jobs.xlsb: the demo's Jobs + Customers pair has the XLSX demo's exact fact counts", async () => {
    const items = await parse(await fixture("fieldwork-jobs.xlsb"));
    expect(countsOf(items)).toEqual({
      Jobs: DEMO_FACT_COUNTS.Jobs,
      Customers: DEMO_FACT_COUNTS.Customers,
      Materials: DEMO_FACT_COUNTS.Materials,
    });
  });

  it("fieldwork-jobs.xlsb: fact for fact what the OOXML adapter reads from the same sheets of fieldwork-q3.xlsx", async () => {
    const xlsb = factsOf(await parse(await fixture("fieldwork-jobs.xlsb")));
    const xlsx = factsOf(await collect(ooxmlAdapter, await fixtureBytes("ooxml/fieldwork-q3.xlsx"), [0, 1, 4]));
    const withoutIndex = (facts: readonly WorkbookFactV2[]) =>
      facts.map((fact) => (fact.kind === "sheet" ? { ...fact, sheetIndex: -1 } : fact.kind === "preserved-part" ? { ...fact, partPath: null } : fact));
    expect(xlsb.length).toBe(xlsx.length);
    expect(withoutIndex(xlsb)).toEqual(withoutIndex(xlsx));
  });

  it("fieldwork-jobs.xlsb: the VLOOKUP decodes to text M03 parses, with its lookup into Customers", async () => {
    const items = await parse(await fixture("fieldwork-jobs.xlsb"));
    const master = ofKind(items, "formula").find((each) => each.columnIndex === 2 && each.text !== null);
    expect(master).toMatchObject({ rowIndex: 1, text: "VLOOKUP(B2,Customers!A:B,2,FALSE)", sharedGroup: 0 });
    const parsed = parseFormula(master?.text ?? "");
    if (parsed.kind !== "parsed") throw new Error(JSON.stringify(parsed));
    expect(findLookups(parsed.ast)).toMatchObject([
      { functionName: "VLOOKUP", lookupRange: { kind: "columns", firstColumn: 0, lastColumn: 1 }, returnIndex: 2 },
    ]);
    expect(ofKind(items, "formula").filter((each) => each.sharedGroup === 0)).toHaveLength(60);
    expect(ofKind(items, "declared-table").map((each) => [each.name, each.range, each.columns.length])).toEqual([
      ["JobsTable", { firstRow: 0, lastRow: 60, firstColumn: 0, lastColumn: 9 }, 10],
      ["CustomersTable", { firstRow: 0, lastRow: 12, firstColumn: 0, lastColumn: 3 }, 4],
    ]);
    expect(ofKind(items, "validation").map((each) => [each.rule, each.listSource])).toEqual([
      ["list", { kind: "inline", values: ["Scheduled", "In progress", "Waiting", "Complete"] }],
      ["list", { kind: "range", ref: "Materials!$A$2:$A$9" }],
    ]);
    expect(ofKind(items, "cell-format").filter((each) => each.formatClass === "currency").map((each) => each.numberFormat)[0]).toBe('"$"#,##0.00');
  });

  it("formulas.xlsb: shared, array and cached results with BIFF12 widths; an unknown token is inert", async () => {
    const items = await parse(await fixture("formulas.xlsb"));
    expect(countsOf(items)).toEqual({
      Jobs: { sheet: 1, "defined-name": 1, row: 5, value: 30, formula: 8, "cell-format": 3, diagnostic: 1 },
      Customers: { sheet: 1, row: 4, value: 8 },
      Calc: { sheet: 1, row: 4, value: 8, formula: 8, "preserved-part": 1 },
    });
    expect(ofKind(items, "formula").map((each) => each.text).filter((text) => text !== null)).toEqual([
      "VLOOKUP(B2,Customers!A:B,2,FALSE)",
      "D2-E2",
      "3+4",
      '"Ada"&" Lovelace"',
      "1=1",
      "1/0",
      "{1,2}",
      '""',
      "SUM(Jobs!D2:D5)",
    ]);
    expect(ofKind(items, "formula").filter((each) => each.isArray).map((each) => [each.rowIndex, each.columnIndex])).toEqual([[1, 0]]);
    expect(ofKind(items, "preserved-part").map((each) => [each.partKind, each.location])).toEqual([["formula", "Calc!A3"]]);
    expect(summaryOf(items)).toMatchObject({ rowCount: 13, columnCount: 6, valueCount: 46 });
  });

  it("validation.xlsb: the same validations the BIFF fixture declares", async () => {
    const items = await parse(await fixture("validation.xlsb"));
    expect(ofKind(items, "validation").map((each) => [each.rule, each.operator, each.listSource, each.formula1, each.formula2])).toEqual([
      ["list", null, { kind: "inline", values: ["Scheduled", "In progress", "Complete"] }, '"Scheduled,In progress,Complete"', null],
      ["list", null, { kind: "range", ref: "Materials!$A$2:$A$9" }, "Materials!$A$2:$A$9", null],
      ["whole", "between", null, "1", "10"],
      ["custom", null, null, 'E2<>""', null],
    ]);
    expect(ofKind(items, "preserved-part").map((each) => [each.partKind, each.location])).toEqual([["unsupported-validation", "Jobs!A2:A11"]]);
  });

  it("date epochs, merges, hidden sheets", async () => {
    for (const [name, system] of [
      ["date-1900.xlsb", "1900"],
      ["date-1904.xlsb", "1904"],
    ] as const) {
      const items = await parse(await fixture(name));
      expect(ofKind(items, "sheet").map((each) => each.dateSystem), name).toEqual([system]);
      expect(ofKind(items, "cell-format").map((each) => [each.columnIndex, each.numberFormat, each.formatClass]), name).toEqual([
        [1, "yyyy-mm-dd", "date"],
        [2, "mm-dd-yy", "date"],
      ]);
    }
    const merged = await parse(await fixture("merged-header.xlsb"));
    expect(countsOf(merged)).toEqual({ Crew: { sheet: 1, row: 3, value: 9, merge: 1, "preserved-part": 1 } });
    const hidden = await parse(await fixture("hidden-sheets.xlsb"));
    expect(ofKind(hidden, "sheet").map((each) => [each.name, each.visibility])).toEqual([
      ["Visible", "visible"],
      ["Hidden", "hidden"],
      ["Very hidden", "very-hidden"],
    ]);
  });

  it("chart.xlsb and annotations.xlsb: charts, a chart sheet, pictures, shapes, comments, links, formatting", async () => {
    const chart = await parse(await fixture("chart.xlsb"));
    expect(ofKind(chart, "preserved-part").map((each) => [each.partKind, each.location, each.partPath])).toEqual([
      ["chart", "Data!D2:I11", "xl/charts/chart1.xml"],
      ["chart", "Chart1!A1:K21", "xl/charts/chart2.xml"],
    ]);
    expect(ofKind(chart, "sheet")[1]).toMatchObject({ sheetKind: "chartsheet", declaredRange: null });

    const notes = await parse(await fixture("annotations.xlsb"));
    expect(ofKind(notes, "preserved-part").map((each) => [each.partKind, each.location, each.partPath])).toEqual([
      ["image", "Notes!A5:C9", "xl/media/image1.png"],
      ["drawing", "Notes!D5:F9", "xl/drawings/drawing1.xml"],
      ["comment", "Notes!B2", "xl/comments1.bin"],
      ["hyperlink", "Notes!A3", null],
      ["conditional-formatting", "Notes", null],
    ]);
    expect(ofKind(notes, "value").map((each) => (each.value.kind === "text" ? each.value.text : each.value.kind))).toEqual([
      "Site",
      "Note",
      "North",
      "Café on corner",
      "Inline text",
      "decimal",
    ]);
  });

  it("error-cells.xlsb and short-cells.xlsb: errors kept as text; BrtShort* columns follow the previous cell", async () => {
    const errors = await parse(await fixture("error-cells.xlsb"));
    expect(
      ofKind(errors, "value")
        .filter((each) => each.rowIndex === 0)
        .map((each) => (each.value.kind === "invalid-preserved" ? each.value.sourceText : each.value.kind)),
    ).toEqual(["#N/A", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#NULL!"]);
    expect(summaryOf(errors).diagnostics).toEqual([
      { code: "error-value", severity: "warning", firstRowIndex: 0, firstColumnIndex: 0, occurrences: 7 },
    ]);

    const short = await parse(await fixture("short-cells.xlsb"));
    expect(ofKind(short, "value").filter((each) => each.rowIndex > 0).map((each) => [each.rowIndex, each.columnIndex, each.value])).toEqual([
      [1, 0, { kind: "text", text: "rk" }],
      [1, 1, { kind: "decimal", decimal: "41.5" }],
      [1, 2, { kind: "boolean", boolean: true }],
      [2, 0, { kind: "text", text: "real" }],
      [2, 1, { kind: "decimal", decimal: "0.3333333333333333" }],
      [2, 2, { kind: "invalid-preserved", sourceText: "#N/A" }],
      [2, 3, { kind: "text", text: "inline" }],
    ]);
    expect(ofKind(short, "row").map((each) => each.cellCount)).toEqual([4, 4, 4]);
  });

  it("only selected sheets are parsed; workbook facts ride with the first selected", async () => {
    const items = await parse(await fixture("formulas.xlsb"), [1]);
    expect(countsOf(items)).toEqual({ Customers: { sheet: 1, "defined-name": 1, row: 4, value: 8 } });
  });
});

describe("XLSB cancellation", () => {
  it("stops between batches and ends without a summary", async () => {
    const items = await parse(await fixture("fieldwork-jobs.xlsb"), undefined, { factsPerBatch: 5, abortAfterBatches: 3 });
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.kind === "batch")).toBe(true);
    assertConformingStream(items, { factsPerBatch: 5, isComplete: false });
  });
});
