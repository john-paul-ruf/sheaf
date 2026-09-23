import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { SheetInventoryItemV1 } from "../../../../src/import/facts/index.js";
import { ooxmlInventoryReader } from "../../../../src/import/formats/ooxml/inventory.js";
import { IMPORT_BUDGET_V1 } from "../../../../src/import/preflight/budgets.js";
import {
  preflightWorkbook,
  routeOf,
  type WorkbookPreflightReportV1,
} from "../../../../src/import/preflight/workbook.js";
import { sniffContent } from "../../../../src/import/source/sniff.js";
import { ZIP_READ_CHUNK_BYTES, openZipContainer } from "../../../../src/import/source/zip.js";
import { buildOoxml, ooxmlEntries } from "../../../fixtures/workbooks/build/ooxml-builder.js";
import {
  buildOversizedWorkbook,
  buildSubsetWorkbook,
  OVERSIZED_CELLS,
} from "../../../fixtures/workbooks/build/oversized.js";
import { writeZip } from "../../../fixtures/workbooks/build/zip-writer.js";
import { entryDataRanges, spyZipHandle } from "../containers/spy.js";
import { bytesSource, countingSource, fixtureBytes } from "../fixtures.js";

const READERS = new Map([["xlsx" as const, ooxmlInventoryReader]]);

const SLICE = 16;

const report = async (bytes: Uint8Array, name: string): Promise<WorkbookPreflightReportV1> => {
  const source = bytesSource(bytes);
  const outcome = await preflightWorkbook(source, await sniffContent(source, name), READERS);
  if (outcome.kind !== "proceed") throw new Error(`${name} refused: ${JSON.stringify(outcome.refusal)}`);
  return outcome.report;
};

/** Every OOXML workbook the proof covers: the committed corpus plus the generated ones. */
const ooxmlWorkbooks = async (): Promise<[string, Uint8Array][]> => {
  const names = (await readdir("tests/fixtures/workbooks/ooxml")).filter((name) => /\.xls[xm]?$/.test(name));
  const committed = await Promise.all(
    names.map(async (name): Promise<[string, Uint8Array]> => [name, await fixtureBytes(`ooxml/${name}`)]),
  );
  return [...committed, ["oversized.xlsx", buildOversizedWorkbook()], ["subset.xlsx", buildSubsetWorkbook()]];
};

/** Where `<sheetData …>` ends in a worksheet part: the prefix pre-flight may read. */
const sheetDataPrefixEnd = (xml: string): number => {
  const match = /<(?:\w+:)?sheetData\b[^>]*>/.exec(xml);
  if (match === null) throw new Error("worksheet without sheetData");
  return new TextEncoder().encode(xml.slice(0, match.index + match[0].length)).byteLength;
};

describe("OOXML pre-flight reads no cell (CA-18)", () => {
  it("reads no worksheet byte past <sheetData> and never sharedStrings.xml — every fixture", async () => {
    const workbooks = await ooxmlWorkbooks();
    expect(workbooks.length).toBeGreaterThanOrEqual(14);
    for (const [name, bytes] of workbooks) {
      const zip = await openZipContainer(bytesSource(bytes));
      const { handle, reads } = spyZipHandle(zip, SLICE);
      const outcome = await ooxmlInventoryReader.readInventory({ kind: "zip", zip: handle });
      expect(outcome.kind, name).toBe("inventory");

      expect(reads.has("xl/sharedstrings.xml"), `${name} read sharedStrings.xml`).toBe(false);
      const worksheets = zip.entries.filter((entry) => /^xl\/worksheets\/[^/]+\.xml$/.test(entry.name));
      expect(worksheets.length, name).toBeGreaterThan(0);
      for (const worksheet of worksheets) {
        const record = reads.get(worksheet.name.toLowerCase());
        expect(record?.read ?? 0, `${name} ${worksheet.name} read whole`).toBe(0);
        const full = await (await openZipContainer(bytesSource(bytes))).readEntry(worksheet.name, {
          maxBytes: 64 * 1_048_576,
        });
        const prefixEnd = sheetDataPrefixEnd(new TextDecoder().decode(full));
        expect(record?.streamed ?? 0, `${name} ${worksheet.name}`).toBeGreaterThan(0);
        expect(record?.streamed ?? 0, `${name} ${worksheet.name}`).toBeLessThanOrEqual(prefixEnd + SLICE - 1);
      }
    }
  }, 60_000);

  it("touches no compressed byte of sharedStrings.xml, and one window of a large sheet", async () => {
    for (const [name, bytes] of await ooxmlWorkbooks()) {
      const ranges = entryDataRanges(bytes);
      // Sniffing's bounded leading sample is M13's read, not pre-flight's.
      const sniff = await sniffContent(bytesSource(bytes), name);
      const source = countingSource(bytesSource(bytes));
      const outcome = await preflightWorkbook(source, sniff, READERS);
      expect(outcome.kind, name).toBe("proceed");
      const overlap = (range: { start: number; end: number }) =>
        source.reads.reduce(
          (sum, read) => sum + Math.max(0, Math.min(read.offset + read.length, range.end) - Math.max(read.offset, range.start)),
          0,
        );
      const shared = ranges.get("xl/sharedStrings.xml");
      if (shared !== undefined) expect(overlap(shared), name).toBe(0);
      for (const [entry, range] of ranges) {
        if (/^xl\/worksheets\/[^/]+\.xml$/.test(entry)) {
          expect(overlap(range), `${name} ${entry}`).toBeLessThanOrEqual(ZIP_READ_CHUNK_BYTES);
        }
      }
    }
  }, 60_000);
});

describe("OOXML inventory", () => {
  it("names sheets, kinds, visibility, epochs, tables and part counts from metadata", async () => {
    const hidden = await report(await fixtureBytes("ooxml/hidden-sheets.xlsx"), "hidden-sheets.xlsx");
    expect(hidden.sheets.map((sheet) => [sheet.name, sheet.visibility])).toEqual([
      ["Visible", "visible"],
      ["Hidden", "hidden"],
      ["Very hidden", "very-hidden"],
    ]);

    const strict = await report(await fixtureBytes("ooxml/strict-namespace.xlsx"), "strict-namespace.xlsx");
    expect(strict.sheets[0]).toMatchObject({
      name: "Crew",
      kind: "worksheet",
      declaredRange: { firstRow: 0, firstColumn: 0, lastRow: 2, lastColumn: 2 },
      declaredTables: [{ name: "CrewTable", range: { firstRow: 0, firstColumn: 0, lastRow: 2, lastColumn: 2 } }],
      estimatedRowCount: 3,
      estimatedCellCount: 9,
    });

    expect((await report(await fixtureBytes("ooxml/date-1904.xlsx"), "date-1904.xlsx")).dateSystem).toBe("1904");

    const chart = await report(await fixtureBytes("ooxml/chartsheet.xlsx"), "chartsheet.xlsx");
    expect(chart.sheets[1]).toMatchObject({
      kind: "chartsheet",
      declaredRange: null,
      estimatedRowCount: null,
      estimatedCellCount: null,
      preservedPartCounts: { chart: 1 },
    });

    const pivot = await report(await fixtureBytes("ooxml/pivot-table.xlsx"), "pivot-table.xlsx");
    expect(pivot.sheets[1]?.preservedPartCounts["pivot-table"]).toBe(1);

    const parts = await report(await fixtureBytes("ooxml/preserved-parts.xlsx"), "preserved-parts.xlsx");
    expect(parts.sheets[0]?.preservedPartCounts).toMatchObject({
      comment: 1,
      hyperlink: 1,
      "embedded-object": 1,
      "form-control": 1,
      drawing: 1,
      image: 1,
    });
    expect(parts.totals.preservedPartCounts).toMatchObject({
      "external-link": 1,
      "data-connection": 1,
      comment: 1,
    });
    expect(parts.isEstimate).toBe(true);
  });

  it("states a format-level contradiction: XLSX bytes named .xls", async () => {
    const contradiction = await report(await fixtureBytes("ooxml/contradiction.xls"), "contradiction.xls");
    expect(contradiction.format).toBe("xlsx");
    expect(contradiction.formatContradiction).toEqual({ declaredExtension: "xls", detectedFormat: "xlsx" });
    const honest = await report(await fixtureBytes("ooxml/hidden-sheets.xlsx"), "hidden-sheets.xlsx");
    expect(honest.formatContradiction).toBeNull();
  });

  it("estimates from metadata only: null when nothing declares a count", async () => {
    const bytes = buildOoxml({ sheets: [{ name: "No dimension", dimension: null, rows: [["a", "b"], [1, 2]] }] });
    const sheet = (await report(bytes, "x.xlsx")).sheets[0] as SheetInventoryItemV1;
    expect(sheet.declaredRange).toBeNull();
    expect(sheet.estimatedRowCount).toBeNull();
    expect(sheet.estimatedCellCount).toBeGreaterThan(0);
  });
});

describe("workbook routes (D31, D47)", () => {
  it("fits: every sheet selected", async () => {
    const fits = await report(await fixtureBytes("ooxml/hidden-sheets.xlsx"), "hidden-sheets.xlsx");
    expect(fits.route).toBe("fits");
    expect(fits.defaultSelection).toEqual([0, 1, 2]);
    expect(fits.budgets).toEqual(IMPORT_BUDGET_V1);
  });

  it("handoff: one sheet over the budget on its own", async () => {
    const handoff = await report(buildOversizedWorkbook(), "archive.xlsx");
    expect(handoff.sheets[0]?.estimatedCellCount).toBe(OVERSIZED_CELLS);
    expect(OVERSIZED_CELLS).toBeGreaterThan(IMPORT_BUDGET_V1.maxEstimatedCells);
    expect(handoff.route).toBe("handoff");
    expect(handoff.defaultSelection).toEqual([]);
  }, 30_000);

  it("subset: preselects the sheets that fit together in workbook order", async () => {
    const subset = await report(buildSubsetWorkbook(), "field-history.xlsx");
    expect(subset.route).toBe("subset");
    expect(subset.defaultSelection).toEqual([0]);
    expect(subset.totals.estimatedCellCount).toBe((200 + 60_001 + 50) * 5);
  }, 30_000);

  it("routes an unknown sheet list or too many sheets without offering a subset", () => {
    const sheet = (sheetIndex: number, cells: number): SheetInventoryItemV1 => ({
      sheetIndex,
      name: `S${sheetIndex}`,
      kind: "worksheet",
      visibility: "visible",
      declaredRange: null,
      declaredTables: [],
      estimatedRowCount: null,
      estimatedCellCount: cells,
      preservedPartCounts: Object.fromEntries([]) as SheetInventoryItemV1["preservedPartCounts"],
    });
    expect(routeOf([sheet(0, 200_000), sheet(1, 100_000)], false)).toEqual({ route: "handoff", defaultSelection: [] });
    expect(routeOf([sheet(0, 1000)], false)).toEqual({ route: "fits", defaultSelection: [0] });
    const many = Array.from({ length: IMPORT_BUDGET_V1.maxInventoriedSheets + 1 }, (_, index) => sheet(index, 1));
    expect(routeOf(many, true)).toEqual({ route: "handoff", defaultSelection: [] });
  });

  it("refuses a source over the byte budget with real numbers", async () => {
    const padding = new Uint8Array(IMPORT_BUDGET_V1.maxSourceBytes);
    const bytes = writeZip([
      ...ooxmlEntries({ sheets: [{ name: "Tiny", rows: [["a"]] }] }),
      { name: "xl/media/padding.bin", data: padding, method: "stored" },
    ]);
    const source = bytesSource(bytes);
    const outcome = await preflightWorkbook(source, await sniffContent(source, "big.xlsx"), READERS);
    expect(outcome).toEqual({
      kind: "refused",
      refusal: {
        kind: "over-import-budget",
        fileName: "big.xlsx",
        remedy: "use-larger-device",
        exceeded: "source-bytes",
        sourceByteLength: bytes.length,
        maxSourceByteLength: IMPORT_BUDGET_V1.maxSourceBytes,
        estimatedCellCount: 1,
        maxEstimatedCellCount: IMPORT_BUDGET_V1.maxEstimatedCells,
      },
    });
  }, 30_000);
});
