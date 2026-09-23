import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { odsAdapter, readOdsInventory } from "../../../../src/import/formats/ods/index.js";
import type { InventoryOutcomeV1, WorkbookInventoryV1 } from "../../../../src/import/facts/index.js";
import { IMPORT_BUDGET_V1 } from "../../../../src/import/preflight/budgets.js";
import { preflightWorkbook, type WorkbookPreflightOutcomeV1 } from "../../../../src/import/preflight/workbook.js";
import { sniffContent } from "../../../../src/import/source/sniff.js";
import { openZipContainer } from "../../../../src/import/source/zip.js";
import { buildOds, odsEntries, rowXml, type OdsPackageSpec } from "../../../fixtures/workbooks/ods/build-ods.js";
import { writeZip } from "../../../fixtures/workbooks/build/zip-writer.js";
import { entryDataRanges, spyZipHandle } from "../containers/spy.js";
import { bytesSource, countingSource, fixtureBytes } from "../fixtures.js";

const READERS = new Map([["ods" as const, readOdsInventory]]);

const TINY: OdsPackageSpec = {
  content: { tables: [{ name: "Sheet1", rows: [rowXml(["a", 1])] }] },
};

/** Every ODS the proof covers: the committed corpus plus F02's refusal fixture. */
const odsWorkbooks = async (): Promise<[string, Uint8Array][]> => {
  const names = (await readdir("tests/fixtures/workbooks/ods")).filter((name) => name.endsWith(".ods"));
  return [
    ...(await Promise.all(names.map(async (name): Promise<[string, Uint8Array]> => [name, await fixtureBytes(`ods/${name}`)]))),
    ["site-plan.ods", await fixtureBytes("refusals/site-plan.ods")],
  ];
};

const inventoryOf = async (bytes: Uint8Array): Promise<InventoryOutcomeV1> =>
  readOdsInventory.readInventory({ kind: "zip", zip: await openZipContainer(bytesSource(bytes)) });

const inventory = async (bytes: Uint8Array): Promise<WorkbookInventoryV1> => {
  const outcome = await inventoryOf(bytes);
  if (outcome.kind !== "inventory") throw new Error(`not an inventory: ${JSON.stringify(outcome)}`);
  return outcome.inventory;
};

const preflight = async (bytes: Uint8Array, name: string): Promise<WorkbookPreflightOutcomeV1> => {
  const source = bytesSource(bytes);
  return preflightWorkbook(source, await sniffContent(source, name), READERS);
};

describe("ODS pre-flight reads no cell (CA-18)", () => {
  it("never reads or streams one byte of content.xml — every fixture", async () => {
    const workbooks = await odsWorkbooks();
    expect(workbooks.length).toBeGreaterThanOrEqual(9);
    for (const [name, bytes] of workbooks) {
      const { handle, reads } = spyZipHandle(await openZipContainer(bytesSource(bytes)));
      await readOdsInventory.readInventory({ kind: "zip", zip: handle });
      expect(reads.get("content.xml"), name).toBeUndefined();
      expect(reads.size, `${name} read no metadata`).toBeGreaterThan(0);
    }
  });

  it("touches no compressed byte of content.xml through the real pre-flight", async () => {
    for (const [name, bytes] of await odsWorkbooks()) {
      const content = entryDataRanges(bytes).get("content.xml");
      expect(content, name).toBeDefined();
      // Sniffing's bounded leading sample is M13's read, not pre-flight's.
      const sniff = await sniffContent(bytesSource(bytes), name);
      const source = countingSource(bytesSource(bytes));
      await preflightWorkbook(source, sniff, READERS);
      const range = content as { start: number; end: number };
      const overlap = source.reads.reduce(
        (sum, read) => sum + Math.max(0, Math.min(read.offset + read.length, range.end) - Math.max(read.offset, range.start)),
        0,
      );
      expect(overlap, name).toBe(0);
    }
  });

  it("would catch a reader that reads cells: the adapter's parse does (negative control)", async () => {
    const bytes = await fixtureBytes("ods/lookup-validation.ods");
    const { handle, reads } = spyZipHandle(await openZipContainer(bytesSource(bytes)));
    for await (const item of odsAdapter.parseSheets({ kind: "zip", zip: handle }, [0], { cancellation: { aborted: false } })) {
      if (item.kind === "summary") break;
    }
    expect(reads.get("content.xml")?.streamed ?? 0).toBeGreaterThan(0);
  });
});

describe("ODS inventory", () => {
  it("names the sheets from settings.xml and estimates from meta.xml", async () => {
    const lookup = await inventory(await fixtureBytes("ods/lookup-validation.ods"));
    expect(lookup).toMatchObject({ format: "ods", sheetListKnown: true, dateSystem: "1900", definedNames: [] });
    expect(lookup.sheets.map((sheet) => [sheet.sheetIndex, sheet.name, sheet.kind, sheet.estimatedRowCount])).toEqual([
      [0, "Orders", "worksheet", null],
      [1, "Products", "worksheet", null],
    ]);
    // meta:cell-count = 31, split across two sheets.
    expect(lookup.sheets.map((sheet) => sheet.estimatedCellCount)).toEqual([16, 15]);
  });

  it("counts the manifest's charts and pictures workbook-wide", async () => {
    const parts = await inventory(await fixtureBytes("ods/annotation-chart.ods"));
    expect(parts.preservedPartCounts).toMatchObject({ chart: 1, image: 1, "embedded-object": 0 });
  });

  it("falls back to placeholder names, flagged unknown, when settings.xml names nothing", async () => {
    const fallback = await inventory(await fixtureBytes("ods/no-settings.ods"));
    expect(fallback.sheetListKnown).toBe(false);
    expect(fallback.sheets.map((sheet) => sheet.name)).toEqual(["Table 1", "Table 2"]);

    const disagreeing = await inventory(buildOds({ ...TINY, meta: { tableCount: 3 } }));
    expect(disagreeing.sheetListKnown).toBe(false);
    expect(disagreeing.sheets).toHaveLength(3);

    const silent = await inventory(buildOds({ ...TINY, meta: null, settings: null }));
    expect(silent.sheetListKnown).toBe(false);
    expect(silent.sheets.map((sheet) => sheet.name)).toEqual(["Table 1"]);
  });

  it("reads F02's site-plan.ods: a bare package with an empty content.xml, no names", async () => {
    const sitePlan = await inventory(await fixtureBytes("refusals/site-plan.ods"));
    expect(sitePlan.sheetListKnown).toBe(false);
    expect(sitePlan.sheets).toMatchObject([{ name: "Table 1", estimatedCellCount: 3 }]);
  });

  it("accepts the template type and refuses every other ODF document", async () => {
    const template = await inventoryOf(buildOds({ ...TINY, mimetype: "application/vnd.oasis.opendocument.spreadsheet-template" }));
    expect(template.kind).toBe("inventory");
    expect(await inventoryOf(buildOds({ ...TINY, mimetype: "application/vnd.oasis.opendocument.text" }))).toEqual({
      kind: "unreadable",
      detail: "unrecognized-content",
    });
    const noMimetype = writeZip(odsEntries(TINY).filter((entry) => entry.name !== "mimetype"));
    expect(await inventoryOf(noMimetype)).toEqual({ kind: "unreadable", detail: "unrecognized-content" });
  });

  it("refuses encryption and script libraries, but not LibreOffice's UI configuration", async () => {
    expect(await inventoryOf(await fixtureBytes("ods/encrypted.ods"))).toEqual({ kind: "unreadable", detail: "encrypted-workbook" });
    expect(await inventoryOf(await fixtureBytes("ods/basic-macro.ods"))).toEqual({
      kind: "macro",
      signal: { kind: "script-part", partPath: "Basic/script-lc.xml" },
    });
    const python = buildOds({
      ...TINY,
      extraEntries: [{ name: "Scripts/python/tidy.py", data: "def tidy(): pass\n", mediaType: "" }],
    });
    expect(await inventoryOf(python)).toMatchObject({ kind: "macro", signal: { partPath: "Scripts/python/tidy.py" } });
    // Every LibreOffice document carries this entry; it holds toolbars, not code.
    const ordinary = buildOds({
      ...TINY,
      extraEntries: [{ name: "Configurations2/accelerator/current.xml", data: "", mediaType: "" }],
      manifestEntries: [{ path: "Configurations2/", mediaType: "application/vnd.sun.xml.ui.configuration" }],
    });
    expect((await inventoryOf(ordinary)).kind).toBe("inventory");
  });

  it("refuses a DTD in metadata before anything is expanded", async () => {
    const entries = odsEntries(TINY).map((entry) =>
      entry.name === "meta.xml"
        ? { ...entry, data: '<?xml version="1.0"?>\n<!DOCTYPE x [<!ENTITY a "b">]><x/>' }
        : entry,
    );
    expect(await inventoryOf(writeZip(entries))).toEqual({ kind: "unreadable", detail: "entity-declaration" });
  });
});

describe("ODS routes (D31, D47)", () => {
  /** A content.xml of `bytes` size (whitespace), stored so the fixture builds fast. */
  const padded = (spec: OdsPackageSpec, bytes: number): Uint8Array =>
    writeZip(
      odsEntries(spec).map((entry) =>
        entry.name === "content.xml"
          ? { ...entry, method: "stored" as const, data: (entry.data as string).replace("<office:body>", `${" ".repeat(bytes)}<office:body>`) }
          : entry,
      ),
    );

  const two: OdsPackageSpec = {
    content: {
      tables: [
        { name: "First", rows: [rowXml(["a"])] },
        { name: "Second", rows: [rowXml(["b"])] },
      ],
    },
  };
  const overBudget = (IMPORT_BUDGET_V1.maxEstimatedCells + 20_000) * 40;

  it("fits: a small workbook preselects every sheet", async () => {
    const outcome = await preflight(await fixtureBytes("ods/lookup-validation.ods"), "orders.ods");
    expect(outcome).toMatchObject({ kind: "proceed", report: { format: "ods", route: "fits", defaultSelection: [0, 1] } });
  });

  it("offers a subset when the names are known, and never when they are not", async () => {
    const known = await preflight(padded(two, overBudget), "big.ods");
    expect(known).toMatchObject({ kind: "proceed", report: { route: "subset", defaultSelection: [0], sheetListKnown: true } });

    const unknown = await preflight(padded({ ...two, settings: null }, overBudget), "big.ods");
    expect(unknown).toMatchObject({ kind: "proceed", report: { route: "handoff", defaultSelection: [], sheetListKnown: false } });

    const fits = await preflight(await fixtureBytes("ods/no-settings.ods"), "notes.ods");
    expect(fits).toMatchObject({ kind: "proceed", report: { route: "fits", defaultSelection: [0, 1], sheetListKnown: false } });
  }, 30_000);

  it("refuses macro and encrypted packages before any stage", async () => {
    expect(await preflight(await fixtureBytes("ods/basic-macro.ods"), "macro.ods")).toMatchObject({
      kind: "refused",
      refusal: { kind: "macro-content" },
    });
    expect(await preflight(await fixtureBytes("ods/encrypted.ods"), "secret.ods")).toMatchObject({
      kind: "refused",
      refusal: { detail: "encrypted-workbook" },
    });
  });
});
