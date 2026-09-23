import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readHtmlTableInventory } from "../../../../src/import/formats/html-table/index.js";
import type { WorkbookInventoryV1 } from "../../../../src/import/facts/index.js";
import { preflightWorkbook } from "../../../../src/import/preflight/workbook.js";
import { SNIFF_SAMPLE_BYTES, sniffContent } from "../../../../src/import/source/sniff.js";
import { bytesSource, countingSource, fixtureBytes, textSource } from "../fixtures.js";

const READERS = new Map([["html-table" as const, readHtmlTableInventory]]);

/** Every HTML-table source the proof covers: the corpus plus F02's refusal fixture. */
const htmlWorkbooks = async (): Promise<[string, Uint8Array][]> => {
  const names = await readdir("tests/fixtures/workbooks/html-table");
  const sources = names.filter((name) => /\.(?:html|xls)$/.test(name));
  return [
    ...(await Promise.all(sources.map(async (name): Promise<[string, Uint8Array]> => [name, await fixtureBytes(`html-table/${name}`)]))),
    ["legacy-export.xls", await fixtureBytes("refusals/legacy-export.xls")],
    ["large.html", new TextEncoder().encode(largeTable(2_000))],
  ];
};

const largeTable = (rows: number): string =>
  `<html><body><table><caption>Log</caption>${Array.from({ length: rows }, (_, index) => `<tr><td>Row ${index}</td><td>${index}</td></tr>`).join("\n")}</table></body></html>`;

const inventory = async (bytes: Uint8Array): Promise<WorkbookInventoryV1> => {
  const outcome = await readHtmlTableInventory.readInventory({ kind: "text", source: bytesSource(bytes) });
  if (outcome.kind !== "inventory") throw new Error(`not an inventory: ${JSON.stringify(outcome)}`);
  return outcome.inventory;
};

describe("HTML-table pre-flight reads a bounded prefix (CA-18)", () => {
  it("reads at most the sniff sample bound, from offset 0 — every fixture", async () => {
    for (const [name, bytes] of await htmlWorkbooks()) {
      const source = countingSource(bytesSource(bytes));
      await readHtmlTableInventory.readInventory({ kind: "text", source });
      expect(source.bytesRead, name).toBeLessThanOrEqual(SNIFF_SAMPLE_BYTES);
      expect(source.reads.every((read) => read.offset + read.length <= SNIFF_SAMPLE_BYTES), name).toBe(true);
    }
  });

  it("would catch a reader that reads on: the large fixture is bigger than the bound (negative control)", async () => {
    const large = new TextEncoder().encode(largeTable(2_000));
    expect(large.byteLength).toBeGreaterThan(SNIFF_SAMPLE_BYTES * 4);
    const source = countingSource(bytesSource(large));
    await readHtmlTableInventory.readInventory({ kind: "text", source });
    expect(source.bytesRead).toBe(SNIFF_SAMPLE_BYTES);
  });
});

describe("HTML-table inventory", () => {
  it("names sheets by caption, Excel's x:Name, or Table N, and counts rows and cells exactly", async () => {
    const merged = await inventory(await fixtureBytes("html-table/merged-headers.html"));
    expect(merged.sheetListKnown).toBe(true);
    expect(merged.sheets.map((sheet) => [sheet.sheetIndex, sheet.name, sheet.estimatedRowCount, sheet.estimatedCellCount])).toEqual([
      [0, "Crew roster", 6, 15],
      [1, "Sites", 2, 4],
    ]);
    expect((await inventory(await fixtureBytes("html-table/excel-export.xls"))).sheets.map((sheet) => sheet.name)).toEqual(["Q3 Invoices"]);
    expect((await inventory(await fixtureBytes("refusals/legacy-export.xls"))).sheets).toMatchObject([
      { name: "Table 1", kind: "worksheet", visibility: "visible", estimatedRowCount: 2, estimatedCellCount: 4 },
    ]);
  });

  it("extrapolates a file larger than the sample and flags the list unknown", async () => {
    const large = await inventory(new TextEncoder().encode(largeTable(2_000)));
    expect(large.sheetListKnown).toBe(false);
    const [log] = large.sheets;
    expect(log?.name).toBe("Log");
    // Extrapolated from the prefix's bytes per row: close to the true 2,000.
    expect(log?.estimatedRowCount).toBeGreaterThan(1_800);
    expect(log?.estimatedRowCount).toBeLessThan(2_300);
    // Two cells per row; the sample may cut its last row mid-cell.
    expect(Math.abs((log?.estimatedCellCount ?? 0) - (log?.estimatedRowCount ?? 0) * 2)).toBeLessThanOrEqual(2);
  });

  it("with no row in the sample, states rows as unknown and bounds cells by size", async () => {
    const text = `<html><head><style>${" ".repeat(SNIFF_SAMPLE_BYTES)}</style></head><body><table><tr><td>a</td></tr></table></body></html>`;
    const unknown = await inventory(new TextEncoder().encode(text));
    expect(unknown.sheets).toMatchObject([{ name: "Table 1", estimatedRowCount: null }]);
    expect(unknown.sheets[0]?.estimatedCellCount).toBe(Math.floor(text.length / 5));
  });

  it("inventories active content rather than refusing it", async () => {
    const active = await inventory(await fixtureBytes("html-table/active-content.html"));
    expect(active.preservedPartCounts).toMatchObject({
      script: 6,
      "external-link": 3,
      image: 1,
      hyperlink: 1,
      "embedded-object": 1,
      "form-control": 1,
    });
  });

  it("refuses a non-text container", async () => {
    expect(
      await readHtmlTableInventory.readInventory({ kind: "cfb", cfb: {} as never }),
    ).toEqual({ kind: "unreadable", detail: "unrecognized-content" });
  });
});

describe("HTML-table pre-flight", () => {
  it("states the MOD-004 contradiction: HTML bytes named .xls", async () => {
    for (const [path, name] of [
      ["html-table/excel-export.xls", "q3-invoices.xls"],
      ["refusals/legacy-export.xls", "legacy-export.xls"],
    ] as const) {
      const source = bytesSource(await fixtureBytes(path));
      const outcome = await preflightWorkbook(source, await sniffContent(source, name), READERS);
      expect(outcome, path).toMatchObject({
        kind: "proceed",
        report: {
          format: "html-table",
          formatContradiction: { declaredExtension: "xls", detectedFormat: "html-table" },
          route: "fits",
          defaultSelection: [0],
        },
      });
    }
    const honest = textSource("<html><body><table><tr><td>a</td></tr></table></body></html>");
    const outcome = await preflightWorkbook(honest, await sniffContent(honest, "a.html"), READERS);
    expect(outcome).toMatchObject({ kind: "proceed", report: { formatContradiction: null } });
  });

  it("proceeds on a file full of scripts: inert content is not macro content", async () => {
    const source = bytesSource(await fixtureBytes("html-table/active-content.html"));
    const outcome = await preflightWorkbook(source, await sniffContent(source, "page.html"), READERS);
    expect(outcome).toMatchObject({ kind: "proceed", report: { route: "fits", sheets: [{ name: "Table 1" }] } });
  });
});
