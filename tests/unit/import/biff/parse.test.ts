import { describe, expect, it } from "vitest";
import type { WorkbookFactStreamItemV2, WorkbookFactV2 } from "../../../../src/import/facts/index.js";
import { readBiffInventory } from "../../../../src/import/formats/biff/inventory.js";
import { biffAdapter } from "../../../../src/import/formats/biff/parse.js";
import { buildBiffWorkbook } from "../../../fixtures/workbooks/biff/build-biff.js";
import { SST_STRINGS } from "../../../fixtures/workbooks/biff/build-fidelity.js";
import { BIFF_CORPUS } from "../../../fixtures/workbooks/biff/corpus.js";
import { assertConformingStream } from "../facts/conformance.js";
import { fixtureBytes } from "../fixtures.js";
import { openCfb } from "./spy.js";

/** Fixtures pre-flight refuses: they never reach an adapter. */
const REFUSED = new Set(["biff/macro-vba.xls", "biff/xlm-macrosheet.xls", "biff/xlm-fngroup.xls", "biff/encrypted.xls", "biff/cfb-loop.xls"]);

const parse = async (
  bytes: Uint8Array,
  selection?: readonly number[],
  options: { factsPerBatch?: number; abortAfterBatches?: number } = {},
): Promise<WorkbookFactStreamItemV2[]> => {
  const cfb = await openCfb(bytes);
  let chosen = selection;
  if (chosen === undefined) {
    const inventory = await readBiffInventory.readInventory({ kind: "cfb", cfb });
    if (inventory.kind !== "inventory") throw new Error(JSON.stringify(inventory));
    chosen = inventory.inventory.sheets.map((sheet) => sheet.sheetIndex);
  }
  const cancellation = { aborted: false };
  const items: WorkbookFactStreamItemV2[] = [];
  for await (const item of biffAdapter.parseSheets({ kind: "cfb", cfb }, chosen, {
    cancellation,
    ...(options.factsPerBatch === undefined ? {} : { factsPerBatch: options.factsPerBatch }),
  })) {
    items.push(item);
    if (options.abortAfterBatches !== undefined && items.length >= options.abortAfterBatches) cancellation.aborted = true;
  }
  return items;
};

const factsOf = (items: readonly WorkbookFactStreamItemV2[]): WorkbookFactV2[] =>
  items.flatMap((item) => (item.kind === "batch" ? item.facts : []));

/** Fact counts by sheet name and kind — the pinned shape of a fixture. */
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

const fixture = (name: string): Promise<Uint8Array> => fixtureBytes(`biff/${name}`);

describe("BIFF fact streams conform (CA-17)", () => {
  const readable = [...BIFF_CORPUS.keys()].filter((path) => !REFUSED.has(path));

  it("covers the whole readable corpus", () => {
    expect(readable.length).toBeGreaterThanOrEqual(14);
  });

  for (const path of readable) {
    it(`${path}: every sheet, and in batches of 7`, async () => {
      const bytes = await fixtureBytes(path);
      assertConformingStream(await parse(bytes));
      assertConformingStream(await parse(bytes, undefined, { factsPerBatch: 7 }), { factsPerBatch: 7 });
    });
  }
});

describe("BIFF fidelity — pinned facts", () => {
  it("formulas.xls: shared VLOOKUP between sheets, array, data table, cached results", async () => {
    const items = await parse(await fixture("formulas.xls"));
    expect(countsOf(items)).toEqual({
      Jobs: { sheet: 1, "defined-name": 1, row: 5, value: 30, formula: 8, "cell-format": 3, diagnostic: 1 },
      Customers: { sheet: 1, row: 4, value: 8 },
      Calc: { sheet: 1, row: 4, value: 9, formula: 9, "preserved-part": 2 },
    });
    expect(summaryOf(items)).toMatchObject({ rowCount: 13, columnCount: 6, valueCount: 47 });
    expect(summaryOf(items).diagnostics).toEqual([
      { code: "error-value", severity: "warning", firstRowIndex: 3, firstColumnIndex: 2, occurrences: 2 },
    ]);

    const formulas = ofKind(items, "formula");
    expect(formulas.filter((each) => each.columnIndex === 2 && each.sharedGroup === 0).map((each) => [each.rowIndex, each.text])).toEqual([
      [1, "VLOOKUP(B2,Customers!A:B,2,FALSE)"],
      [2, null],
      [3, null],
      [4, null],
    ]);
    expect(formulas.find((each) => each.sharedGroup === 1 && each.text !== null)?.text).toBe("D2-E2");
    expect(formulas.filter((each) => each.isArray)).toEqual([
      { kind: "formula", rowIndex: 1, columnIndex: 0, text: "{1,2}", sharedGroup: null, isArray: true, isExternal: false },
    ]);
    expect(formulas.map((each) => each.text).filter((text) => text !== null)).toEqual([
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
    expect(ofKind(items, "preserved-part").map((each) => [each.partKind, each.location])).toEqual([
      ["formula", "Calc!A3"],
      ["formula", "Calc!B3"],
    ]);
    expect(ofKind(items, "defined-name")).toEqual([
      { kind: "defined-name", name: "CustomerList", ref: "Customers!$A$2:$A$4", sheetIndex: null },
    ]);
    const values = ofKind(items, "value");
    expect(values.find((each) => each.rowIndex === 3 && each.columnIndex === 2)?.value).toEqual({ kind: "invalid-preserved", sourceText: "#N/A" });
    expect(values.find((each) => each.rowIndex === 0 && each.columnIndex === 1 && each.value.kind === "text" && each.value.text === "Ada Lovelace")).toBeDefined();
  });

  it("formulas.xls: only selected sheets are parsed; workbook facts ride with the first selected", async () => {
    const items = await parse(await fixture("formulas.xls"), [1]);
    expect(countsOf(items)).toEqual({ Customers: { sheet: 1, "defined-name": 1, row: 4, value: 8 } });
  });

  it("never parses an unselected sheet, even one whose records are noise", async () => {
    const bytes = buildBiffWorkbook(
      {
        sheets: [
          { name: "Kept", rows: [["a", 1]] },
          { name: "Noise", rows: [["b", 2]] },
          { name: "Also kept", rows: [["c", 3]] },
        ],
      },
      { poisonCells: [1] },
    );
    const items = await parse(bytes, [0, 2]);
    assertConformingStream(items);
    expect(ofKind(items, "sheet").map((each) => each.name)).toEqual(["Kept", "Also kept"]);
    await expect(parse(bytes, [1])).rejects.toThrow();
  });

  it("validation.xls: inline list, range list, whole-number bounds, custom; an undecodable rule is preserved", async () => {
    const items = await parse(await fixture("validation.xls"));
    expect(ofKind(items, "validation")).toEqual([
      {
        kind: "validation",
        range: { firstRow: 1, lastRow: 10, firstColumn: 1, lastColumn: 1 },
        rule: "list",
        operator: null,
        listSource: { kind: "inline", values: ["Scheduled", "In progress", "Complete"] },
        formula1: '"Scheduled,In progress,Complete"',
        formula2: null,
      },
      {
        kind: "validation",
        range: { firstRow: 1, lastRow: 10, firstColumn: 2, lastColumn: 2 },
        rule: "list",
        operator: null,
        listSource: { kind: "range", ref: "Materials!$A$2:$A$9" },
        formula1: "Materials!$A$2:$A$9",
        formula2: null,
      },
      {
        kind: "validation",
        range: { firstRow: 1, lastRow: 10, firstColumn: 3, lastColumn: 3 },
        rule: "whole",
        operator: "between",
        listSource: null,
        formula1: "1",
        formula2: "10",
      },
      {
        kind: "validation",
        range: { firstRow: 1, lastRow: 10, firstColumn: 4, lastColumn: 4 },
        rule: "custom",
        operator: null,
        listSource: null,
        formula1: 'E2<>""',
        formula2: null,
      },
    ]);
    expect(ofKind(items, "preserved-part").map((each) => [each.partKind, each.location])).toEqual([["unsupported-validation", "Jobs!A2:A11"]]);
    expect(countsOf(items)).toEqual({
      Jobs: { sheet: 1, row: 3, value: 15, validation: 4, "preserved-part": 1 },
      Materials: { sheet: 1, row: 9, value: 9 },
    });
  });

  it("date epochs: the workbook's system rides on every sheet fact; date formats classify", async () => {
    for (const [name, system] of [
      ["date-1900.xls", "1900"],
      ["date-1904.xls", "1904"],
    ] as const) {
      const items = await parse(await fixture(name));
      expect(ofKind(items, "sheet").map((each) => each.dateSystem), name).toEqual([system]);
      expect(ofKind(items, "cell-format").map((each) => [each.columnIndex, each.numberFormat, each.formatClass]), name).toEqual([
        [1, "yyyy-mm-dd", "date"],
        [2, "mm-dd-yy", "date"],
      ]);
      expect(ofKind(items, "value").find((each) => each.rowIndex === 2 && each.columnIndex === 1)?.value, name).toEqual({
        kind: "decimal",
        decimal: "45210.5",
      });
    }
  });

  it("merged-header.xls: the merge, blanks that widen rows without values, visual styling", async () => {
    const items = await parse(await fixture("merged-header.xls"));
    expect(ofKind(items, "merge")).toEqual([{ kind: "merge", range: { firstRow: 0, lastRow: 0, firstColumn: 0, lastColumn: 3 } }]);
    expect(ofKind(items, "row")[0]).toEqual({ kind: "row", rowIndex: 0, cellCount: 4 });
    expect(countsOf(items)).toEqual({ Crew: { sheet: 1, row: 3, value: 9, merge: 1, "preserved-part": 1 } });
    expect(ofKind(items, "preserved-part").map((each) => each.partKind)).toEqual(["cell-styling"]);
  });

  it("hidden-sheets.xls: visibility on each sheet fact", async () => {
    const items = await parse(await fixture("hidden-sheets.xls"));
    expect(ofKind(items, "sheet").map((each) => [each.name, each.visibility])).toEqual([
      ["Visible", "visible"],
      ["Hidden", "hidden"],
      ["Very hidden", "very-hidden"],
    ]);
  });

  it("chart.xls: an embedded chart substream and a chart sheet are preserved, never parsed as cells", async () => {
    const items = await parse(await fixture("chart.xls"));
    expect(countsOf(items)).toEqual({
      Data: { sheet: 1, row: 3, value: 6, "preserved-part": 1 },
      Chart1: { sheet: 1, "preserved-part": 1 },
    });
    expect(ofKind(items, "sheet")[1]).toMatchObject({ sheetKind: "chartsheet", declaredRange: null });
    expect(ofKind(items, "preserved-part").map((each) => [each.partKind, each.location, each.reasonKey])).toEqual([
      ["chart", "Data", "chart-not-live-yet"],
      ["chart", "Chart1", "chart-not-live-yet"],
    ]);
  });

  it("annotations.xls and controls.xls: notes, links, pictures, shapes, controls, conditional formatting; NFC", async () => {
    const items = await parse(await fixture("annotations.xls"));
    expect(ofKind(items, "preserved-part").map((each) => [each.partKind, each.location, each.anchor])).toEqual([
      ["image", "Notes", null],
      ["drawing", "Notes", null],
      ["comment", "Notes!B2", { firstRow: 1, firstColumn: 1, lastRow: 1, lastColumn: 1 }],
      ["hyperlink", "Notes!A3", { firstRow: 2, firstColumn: 0, lastRow: 2, lastColumn: 0 }],
      ["conditional-formatting", "Notes", null],
    ]);
    expect(ofKind(items, "value").find((each) => each.rowIndex === 1 && each.columnIndex === 1)?.value).toEqual({
      kind: "text",
      text: "Café on corner",
    });
    expect(summaryOf(items).diagnostics.map((each) => each.code)).toEqual(["text-normalized-nfc"]);

    const controls = await parse(await fixture("controls.xls"));
    expect(ofKind(controls, "preserved-part").map((each) => [each.partKind, each.reasonKey])).toEqual([["form-control", "control-not-run"]]);
  });

  it("error-cells.xls: every error kept as its text with one aggregated diagnostic", async () => {
    const items = await parse(await fixture("error-cells.xls"));
    expect(
      ofKind(items, "value")
        .filter((each) => each.rowIndex === 0)
        .map((each) => (each.value.kind === "invalid-preserved" ? each.value.sourceText : each.value.kind)),
    ).toEqual(["#N/A", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#NULL!"]);
    expect(ofKind(items, "value").filter((each) => each.rowIndex === 1).map((each) => each.value)).toEqual([
      { kind: "boolean", boolean: true },
      { kind: "boolean", boolean: false },
      { kind: "decimal", decimal: "1" },
      { kind: "text", text: "ok" },
    ]);
    expect(summaryOf(items).diagnostics).toEqual([
      { code: "error-value", severity: "warning", firstRowIndex: 0, firstColumnIndex: 0, occurrences: 7 },
    ]);
  });

  it("sst-continue.xls: 600 shared strings across CONTINUE records, re-flagged mid-string, exact", async () => {
    const stream = await (await openCfb(await fixture("sst-continue.xls"))).readStream("Workbook", { maxBytes: 1 << 20 });
    let continues = 0;
    for (let at = 0; at + 4 <= stream.length; at += 4 + ((stream[at + 2] as number) | ((stream[at + 3] as number) << 8))) {
      if (((stream[at] as number) | ((stream[at + 1] as number) << 8)) === 0x003c) continues += 1;
    }
    expect(continues).toBeGreaterThanOrEqual(2);
    const items = await parse(await fixture("sst-continue.xls"));
    const texts = ofKind(items, "value").map((each) => (each.value.kind === "text" ? each.value.text : null));
    expect(texts).toEqual(SST_STRINGS);
  });

  it("plain.xls: RK, MULRK and NUMBER decode exactly; booleans; MULBLANK widens", async () => {
    const items = await parse(await fixture("plain.xls"));
    const at = (row: number, column: number) => ofKind(items, "value").find((each) => each.rowIndex === row && each.columnIndex === column)?.value;
    expect(at(1, 2)).toEqual({ kind: "decimal", decimal: "38" });
    expect(at(1, 3)).toEqual({ kind: "decimal", decimal: "41.5" });
    expect(at(2, 3)).toEqual({ kind: "decimal", decimal: "0.3333333333333333" });
    expect(at(3, 3)).toEqual({ kind: "decimal", decimal: "0.07" });
    expect(at(1, 4)).toEqual({ kind: "boolean", boolean: true });
    expect(at(3, 1)).toBeUndefined();
    expect(ofKind(items, "row").map((each) => each.cellCount)).toEqual([5, 5, 5, 5, 2, 2, 2]);
    expect(ofKind(items, "cell-format").map((each) => [each.columnIndex, each.formatClass, each.currencySymbol])).toEqual([[3, "currency", "$"]]);
    expect(countsOf(items)).toEqual({
      Crew: { sheet: 1, row: 4, value: 18, "cell-format": 1, diagnostic: 1, "preserved-part": 1 },
      Sites: { sheet: 1, row: 3, value: 6 },
    });
  });

  it("code pages: BIFF5 Windows-1252 text reads exactly; an unknown code page keeps U+FFFD and says so", async () => {
    const book = await parse(await fixture("biff5-book.xls"));
    expect(ofKind(book, "value").map((each) => (each.value.kind === "text" ? each.value.text : each.value.kind))).toEqual([
      "Item",
      "Price",
      "Crème brûlée — small",
      "decimal",
      "Espresso",
      "decimal",
    ]);
    expect(summaryOf(book).diagnostics).toEqual([]);

    const unknown = await parse(await fixture("unknown-code-page.xls"));
    expect(ofKind(unknown, "value")[2]?.value).toEqual({ kind: "text", text: "Caf�" });
    expect(summaryOf(unknown).diagnostics).toEqual([
      { code: "replacement-character", severity: "warning", firstRowIndex: 1, firstColumnIndex: 0, occurrences: 1 },
    ]);
    // BIFF5 tokens are never guessed at: the formula is inert and its cached value kept.
    expect(ofKind(unknown, "formula")).toEqual([
      { kind: "formula", rowIndex: 2, columnIndex: 1, text: null, sharedGroup: null, isArray: false, isExternal: false },
    ]);
    expect(ofKind(unknown, "preserved-part").map((each) => [each.partKind, each.location])).toEqual([["formula", "Menu!B3"]]);
  });
});

describe("BIFF cancellation", () => {
  it("stops between batches and ends without a summary", async () => {
    const items = await parse(await fixture("sst-continue.xls"), undefined, { factsPerBatch: 5, abortAfterBatches: 2 });
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.kind === "batch")).toBe(true);
    assertConformingStream(items, { factsPerBatch: 5, isComplete: false });
  });
});
