import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ooxmlAdapter } from "../../../../src/import/formats/ooxml/index.js";
import type { WorkbookFactStreamItemV2, WorkbookFactV2 } from "../../../../src/import/facts/index.js";
import { openZipContainer } from "../../../../src/import/source/zip.js";
import { buildOoxml, ooxmlEntries } from "../../../fixtures/workbooks/build/ooxml-builder.js";
import { bytesOf, writeZip } from "../../../fixtures/workbooks/build/zip-writer.js";
import { assertConformingStream } from "../facts/conformance.js";
import { bytesSource, fixtureBytes } from "../fixtures.js";

const ALL_SHEETS = Array.from({ length: 16 }, (_, index) => index);

const parse = async (
  bytes: Uint8Array,
  selection: readonly number[] = ALL_SHEETS,
  factsPerBatch?: number,
): Promise<WorkbookFactStreamItemV2[]> => {
  const zip = await openZipContainer(bytesSource(bytes));
  const items: WorkbookFactStreamItemV2[] = [];
  const options = factsPerBatch === undefined
    ? { cancellation: { aborted: false } }
    : { cancellation: { aborted: false }, factsPerBatch };
  for await (const item of ooxmlAdapter.parseSheets({ kind: "zip", zip }, selection, options)) {
    items.push(item);
  }
  return items;
};

const factsOf = (items: readonly WorkbookFactStreamItemV2[]): WorkbookFactV2[] =>
  items.flatMap((item) => (item.kind === "batch" ? [...item.facts] : []));

const fixture = async (name: string): Promise<WorkbookFactV2[]> =>
  factsOf(await parse(await fixtureBytes(`ooxml/${name}`)));

const ofKind = <K extends WorkbookFactV2["kind"]>(facts: readonly WorkbookFactV2[], kind: K) =>
  facts.filter((fact): fact is Extract<WorkbookFactV2, { kind: K }> => fact.kind === kind);

describe("OOXML fact stream", () => {
  it("conforms to V2 on every OOXML fixture, at the default and a tiny batch bound", async () => {
    const names = (await readdir("tests/fixtures/workbooks/ooxml")).filter((name) => /\.xls[xm]?$/.test(name));
    expect(names.length).toBeGreaterThanOrEqual(13);
    for (const name of names) {
      const bytes = await fixtureBytes(`ooxml/${name}`);
      assertConformingStream(await parse(bytes));
      assertConformingStream(await parse(bytes, ALL_SHEETS, 5), { factsPerBatch: 5 });
    }
  });

  it("reads Strict and Transitional workbooks to the same facts", async () => {
    const strict = await fixture("strict-namespace.xlsx");
    expect(ofKind(strict, "declared-table")[0]).toMatchObject({ name: "CrewTable", columns: ["Name", "Role", "Rate"] });
    expect(ofKind(strict, "merge")).toEqual([{ kind: "merge", range: { firstRow: 0, firstColumn: 4, lastRow: 0, lastColumn: 5 } }]);
    const transitional = factsOf(
      await parse(buildOoxml({ sheets: [{ name: "Crew", rows: [["Name", "Role", "Rate"], ["Ada", "Lead", 41.5], ["Grace", "Technician", 38]], tables: [{ name: "CrewTable", ref: "A1:C3", columns: ["Name", "Role", "Rate"] }], merges: ["E1:F1"] }] })),
    );
    expect(transitional).toEqual(strict);
  });

  it("states the date system and number formats, and leaves dates to inference", async () => {
    const facts = await fixture("date-1904.xlsx");
    expect(ofKind(facts, "sheet")[0]?.dateSystem).toBe("1904");
    expect(ofKind(facts, "cell-format")).toEqual([
      { kind: "cell-format", rowIndex: 1, columnIndex: 1, numberFormat: "yyyy-mm-dd", formatClass: "date", currencySymbol: null },
      { kind: "cell-format", rowIndex: 1, columnIndex: 2, numberFormat: "m/d/yy h:mm", formatClass: "datetime", currencySymbol: null },
    ]);
    expect(ofKind(facts, "value").find((fact) => fact.rowIndex === 1 && fact.columnIndex === 1)?.value).toEqual({
      kind: "decimal",
      decimal: "43000",
    });
  });

  it("reads inline and rich strings, NFC-normalizing with a diagnostic", async () => {
    const inline = await fixture("inline-strings.xlsx");
    expect(ofKind(inline, "value").map((fact) => fact.value)).toEqual([
      { kind: "text", text: "Site" },
      { kind: "text", text: " padded " },
      { kind: "text", text: "Café" },
      { kind: "text", text: "Ridgeway" },
    ]);
    expect(ofKind(inline, "diagnostic")[0]?.diagnostic.code).toBe("text-normalized-nfc");
    const rich = await fixture("rich-text.xlsx");
    expect(ofKind(rich, "value")[1]?.value).toEqual({ kind: "text", text: "Due Friday at noon" });
  });

  it("carries plain, shared, array and external formulas with their cached values", async () => {
    const formulas = ofKind(await fixture("formulas.xlsx"), "formula");
    expect(formulas.map(({ rowIndex, columnIndex, text, sharedGroup, isArray, isExternal }) => [rowIndex, columnIndex, text, sharedGroup, isArray, isExternal])).toEqual([
      [1, 2, "A2*B2", 0, false, false],
      [1, 3, "A2:A3*2", null, true, false],
      [1, 4, "[1]Sheet1!A1", null, false, true],
      [2, 2, null, 0, false, false],
      [3, 2, null, 0, false, false],
      [4, 0, "SUM(A2:A4)", null, false, false],
      [4, 2, 'IF(C2>5,"high","low")', null, false, false],
    ]);
  });

  it("keeps hidden sheets' visibility as a fact and names a chart sheet", async () => {
    expect(ofKind(await fixture("hidden-sheets.xlsx"), "sheet").map((fact) => fact.visibility)).toEqual([
      "visible",
      "hidden",
      "very-hidden",
    ]);
    const chart = await fixture("chartsheet.xlsx");
    expect(ofKind(chart, "sheet")[1]).toMatchObject({ sheetKind: "chartsheet", declaredRange: null });
    expect(ofKind(chart, "preserved-part")).toEqual([
      {
        kind: "preserved-part",
        partKind: "chart",
        location: "'Jobs chart'!A1",
        reasonKey: "chart-not-live-yet",
        anchor: { firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 0 },
        partPath: "xl/charts/chart1.xml",
      },
    ]);
  });

  it("keeps malformed and error values verbatim with diagnostics", async () => {
    const facts = await fixture("malformed-values.xlsx");
    expect(ofKind(facts, "value").slice(3).map((fact) => fact.value)).toEqual([
      { kind: "invalid-preserved", sourceText: "12,5" },
      { kind: "invalid-preserved", sourceText: "2" },
      { kind: "invalid-preserved", sourceText: "#N/A" },
      { kind: "invalid-preserved", sourceText: "1e400" },
      { kind: "invalid-preserved", sourceText: "99" },
      { kind: "invalid-preserved", sourceText: "#DIV/0!" },
      { kind: "decimal", decimal: "7.25" },
      { kind: "boolean", boolean: true },
      { kind: "text", text: "2024-03-01" },
    ]);
    const summary = (await parse(await fixtureBytes("ooxml/malformed-values.xlsx"))).at(-1);
    expect(summary).toMatchObject({
      diagnostics: [
        { code: "malformed-value", occurrences: 4 },
        { code: "error-value", occurrences: 2 },
      ],
    });
  });

  it("preserves every inert part it cannot make interactive", async () => {
    const parts = ofKind(await fixture("preserved-parts.xlsx"), "preserved-part").map((fact) => [fact.partKind, fact.location, fact.reasonKey]);
    expect(parts).toEqual([
      ["external-link", "Workbook", "external-source-not-fetched"],
      ["data-connection", "Workbook", "connection-not-refreshed"],
      ["drawing", "'Site log'!D2:F6", "visual-only"],
      ["image", "'Site log'!D8:E12", "visual-only"],
      ["comment", "'Site log'!A2", "note-kept-as-text"],
      ["embedded-object", "Site log", "object-not-opened"],
      ["form-control", "Site log", "control-not-run"],
      ["hyperlink", "'Site log'!B2", "link-not-followed"],
      ["sparkline", "Site log", "chart-not-live-yet"],
      ["conditional-formatting", "Site log", "formatting-not-reproduced"],
      ["cell-styling", "Site log", "formatting-not-reproduced"],
    ]);
    const pivot = ofKind(await fixture("pivot-table.xlsx"), "preserved-part");
    expect(pivot).toMatchObject([{ partKind: "pivot-table", location: "Summary!A3:C5" }]);
  });

  it("stays sparse across separated regions", async () => {
    const facts = await fixture("multiple-regions.xlsx");
    expect(ofKind(facts, "row").map((fact) => [fact.rowIndex, fact.cellCount])).toEqual([
      [0, 7],
      [1, 7],
      [2, 7],
      [3, 3],
      [7, 2],
      [8, 2],
      [9, 2],
    ]);
    expect(ofKind(facts, "value")).toHaveLength(24);
  });

  it("refuses a cell past the grid instead of allocating toward it", async () => {
    const spec = { sheets: [{ name: "Far", dimension: null, rows: [["a"]] }] };
    const far = writeZip(
      ooxmlEntries(spec).map((entry) =>
        entry.name === "xl/worksheets/sheet1.xml"
          ? { ...entry, data: new TextDecoder().decode(bytesOf(entry.data)).replace('<c r="A1"', '<c r="XFE1"') }
          : entry,
      ),
    );
    await expect(parse(far)).rejects.toThrow("impossible-dimension");
  });
});
