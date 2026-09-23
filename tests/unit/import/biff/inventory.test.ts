import { describe, expect, it } from "vitest";
import type { InventoryOutcomeV1, WorkbookInventoryV1 } from "../../../../src/import/facts/index.js";
import { readBiffInventory } from "../../../../src/import/formats/biff/inventory.js";
import { CELL_RECORD_TYPES, RT } from "../../../../src/import/formats/biff/records.js";
import { preflightWorkbook, type WorkbookPreflightOutcomeV1 } from "../../../../src/import/preflight/workbook.js";
import { unreadable } from "../../../../src/import/preflight/refusal.js";
import { sniffContent } from "../../../../src/import/source/sniff.js";
import { buildBiffWorkbook } from "../../../fixtures/workbooks/biff/build-biff.js";
import { BIFF_CORPUS, PLAIN } from "../../../fixtures/workbooks/biff/corpus.js";
import { bytesSource, fixtureBytes } from "../fixtures.js";
import { listRecords, openCfb, spyCfbHandle } from "./spy.js";

const READERS = new Map([["xls" as const, readBiffInventory]]);
const SLICE = 16;

const inventoryOf = async (bytes: Uint8Array): Promise<InventoryOutcomeV1> =>
  readBiffInventory.readInventory({ kind: "cfb", cfb: await openCfb(bytes) });

const expectInventory = (outcome: InventoryOutcomeV1): WorkbookInventoryV1 => {
  if (outcome.kind !== "inventory") throw new Error(`expected an inventory, got ${JSON.stringify(outcome)}`);
  return outcome.inventory;
};

const preflight = async (bytes: Uint8Array, name: string): Promise<WorkbookPreflightOutcomeV1> => {
  const source = bytesSource(bytes);
  return preflightWorkbook(source, await sniffContent(source, name), READERS);
};

/** Workbooks the reader must inventory (not refuse), as specs so a poisoned twin can be built. */
const READABLE = [
  ["plain.xls", PLAIN],
  ["biff5-book.xls", undefined],
] as const;

const workbookStream = async (bytes: Uint8Array, path = "Workbook"): Promise<Uint8Array> =>
  (await openCfb(bytes)).readStream(path, { maxBytes: 64 * 1_048_576 });

describe("BIFF inventory — exact outcome per fixture", () => {
  it("reads the plain workbook's sheets, kinds, dimensions and estimates from metadata", async () => {
    const inventory = expectInventory(await inventoryOf(await fixtureBytes("biff/plain.xls")));
    expect(inventory).toMatchObject({ format: "xls", sheetListKnown: true, dateSystem: "1900", definedNames: [] });
    expect(inventory.sheets.map((sheet) => [sheet.sheetIndex, sheet.name, sheet.kind, sheet.visibility])).toEqual([
      [0, "Crew", "worksheet", "visible"],
      [1, "Sites", "worksheet", "visible"],
    ]);
    expect(inventory.sheets[0]).toMatchObject({
      declaredRange: { firstRow: 0, firstColumn: 0, lastRow: 3, lastColumn: 4 },
      declaredTables: [],
      estimatedRowCount: 4,
      estimatedCellCount: 20,
    });
    expect(inventory.sheets[1]).toMatchObject({
      declaredRange: { firstRow: 0, firstColumn: 0, lastRow: 2, lastColumn: 1 },
      estimatedRowCount: 3,
      estimatedCellCount: 6,
    });
    expect(Object.values(inventory.preservedPartCounts).every((count) => count === 0)).toBe(true);
  });

  it("reads a BIFF5 Book stream through its code page", async () => {
    const inventory = expectInventory(await inventoryOf(await fixtureBytes("biff/biff5-book.xls")));
    expect(inventory.sheets.map((sheet) => [sheet.name, sheet.declaredRange])).toEqual([
      ["Café", { firstRow: 0, firstColumn: 0, lastRow: 2, lastColumn: 1 }],
    ]);
  });

  it("refuses VBA, an XLM macro sheet and an FNGROUPNAME as macro content", async () => {
    expect(await inventoryOf(await fixtureBytes("biff/macro-vba.xls"))).toEqual({
      kind: "macro",
      signal: { kind: "vba-project", partPath: "_VBA_PROJECT_CUR" },
    });
    expect(await inventoryOf(await fixtureBytes("biff/xlm-macrosheet.xls"))).toEqual({
      kind: "macro",
      signal: { kind: "xlm-macro-sheet", partPath: "Workbook" },
    });
    expect(await inventoryOf(await fixtureBytes("biff/xlm-fngroup.xls"))).toEqual({
      kind: "macro",
      signal: { kind: "xlm-macro-sheet", partPath: "Workbook" },
    });
    for (const name of ["macro-vba.xls", "xlm-macrosheet.xls", "xlm-fngroup.xls"]) {
      expect(await preflight(await fixtureBytes(`biff/${name}`), name), name).toEqual({
        kind: "refused",
        refusal: { kind: "macro-content", fileName: name, remedy: "reupload-macro-free-copy" },
      });
    }
  });

  it("refuses FILEPASS as an encrypted workbook", async () => {
    expect(await inventoryOf(await fixtureBytes("biff/encrypted.xls"))).toEqual({
      kind: "unreadable",
      detail: "encrypted-workbook",
    });
    expect(await preflight(await fixtureBytes("biff/encrypted.xls"), "encrypted.xls")).toEqual({
      kind: "refused",
      refusal: unreadable("encrypted.xls", "encrypted-workbook"),
    });
  });

  it("refuses a looping CFB directory before the reader runs", async () => {
    expect(await preflight(await fixtureBytes("biff/cfb-loop.xls"), "cfb-loop.xls")).toEqual({
      kind: "refused",
      refusal: unreadable("cfb-loop.xls", "directory-loop"),
    });
  });

  it("routes the plain workbook through pre-flight as fits, every sheet selected", async () => {
    const outcome = await preflight(await fixtureBytes("biff/plain.xls"), "crew.xls");
    if (outcome.kind !== "proceed") throw new Error(JSON.stringify(outcome));
    expect(outcome.report).toMatchObject({ format: "xls", route: "fits", defaultSelection: [0, 1], formatContradiction: null });
  });

  it("classifies F02's refusals/ledger.xls: a header-only CFB stub, unreadable before any reader", async () => {
    // 1,536 bytes: a CFB header, one FAT sector and one directory sector, all
    // zero — the directory's root entry has no type, so M13 refuses it.
    const ledger = await fixtureBytes("refusals/ledger.xls");
    expect(ledger.length).toBe(1536);
    expect(await preflight(ledger, "ledger.xls")).toEqual({
      kind: "refused",
      refusal: unreadable("ledger.xls", "malformed-structure"),
    });
  });

  it("names chart sheets, dialog sheets, hidden sheets and empty dimensions", async () => {
    const bytes = buildBiffWorkbook({
      date1904: true,
      sheets: [
        { name: "Data", rows: [["a", 1]] },
        { name: "Chart1", type: "chart" },
        { name: "Dialog1", type: "dialog", rows: [["x"]] },
        { name: "Secret", hidden: 1, rows: [[1]] },
        { name: "Buried", hidden: 2, rows: [[1]] },
        { name: "Empty", rows: [] },
        { name: "Undeclared", dimension: null, rows: [[1, 2]] },
      ],
    });
    const inventory = expectInventory(await inventoryOf(bytes));
    expect(inventory.dateSystem).toBe("1904");
    expect(inventory.sheets.map((sheet) => [sheet.name, sheet.kind, sheet.visibility, sheet.estimatedRowCount])).toEqual([
      ["Data", "worksheet", "visible", 1],
      ["Chart1", "chartsheet", "visible", null],
      ["Dialog1", "dialogsheet", "visible", 1],
      ["Secret", "worksheet", "hidden", 1],
      ["Buried", "worksheet", "very-hidden", 1],
      ["Empty", "worksheet", "visible", 0],
      ["Undeclared", "worksheet", "visible", null],
    ]);
    expect(inventory.sheets[1]?.preservedPartCounts.chart).toBe(1);
    expect(inventory.sheets[5]).toMatchObject({ declaredRange: null, estimatedCellCount: 0 });
    expect(inventory.sheets[6]?.declaredRange).toBeNull();
    expect(inventory.sheets[6]?.estimatedCellCount).toBeGreaterThan(0);
  });

  it("refuses a DIMENSIONS beyond Excel's grid as an impossible dimension", async () => {
    const bytes = buildBiffWorkbook({ sheets: [{ name: "Far", dimension: [0, 1_048_576, 0, 1], rows: [[1]] }] });
    expect(await inventoryOf(bytes)).toEqual({ kind: "unreadable", detail: "impossible-dimension" });
  });

  it("bounds the estimate by the sheet's own bytes, never by a hostile DIMENSIONS alone", async () => {
    const bytes = buildBiffWorkbook({ sheets: [{ name: "Liar", dimension: [0, 999_999, 0, 255], rows: [[1]] }] });
    const [sheet] = expectInventory(await inventoryOf(bytes)).sheets;
    expect(sheet?.declaredRange?.lastRow).toBe(999_999);
    expect(sheet?.estimatedCellCount).toBeLessThan(20);
  });
});

describe("BIFF pre-flight reads no cell record (CA-18)", () => {
  const specs = new Map([
    ["plain.xls", PLAIN],
    [
      "wide.xls",
      {
        sheets: [
          { name: "One", rows: Array.from({ length: 40 }, (_, row) => [`r${row}`, row, row / 7, row % 2 === 0]) },
          { name: "Two", rows: Array.from({ length: 40 }, (_, row) => [row * 3, `s${row}`]) },
          { name: "Three", rows: [["last"], [1]] },
        ],
      },
    ],
  ]);

  it("the poisoned twins really have no readable cell record (negative control)", async () => {
    for (const [name, spec] of specs) {
      const clean = listRecords(await workbookStream(buildBiffWorkbook(spec)));
      const poisoned = listRecords(await workbookStream(buildBiffWorkbook(spec, { poisonCells: true })));
      expect(clean.some((each) => CELL_RECORD_TYPES.has(each.type)), name).toBe(true);
      expect(poisoned.some((each) => CELL_RECORD_TYPES.has(each.type)), name).toBe(false);
    }
  });

  it("inventories every readable workbook identically when every cell record is noise", async () => {
    for (const [name, spec] of specs) {
      const clean = await inventoryOf(buildBiffWorkbook(spec));
      expect(clean.kind, name).toBe("inventory");
      expect(await inventoryOf(buildBiffWorkbook(spec, { poisonCells: true })), name).toEqual(clean);
    }
    for (const [name] of READABLE) {
      expect((await inventoryOf(await fixtureBytes(`biff/${name}`))).kind, name).toBe("inventory");
    }
  });

  it("pulls no stream byte past the last sheet's DIMENSIONS", async () => {
    for (const [name, spec] of specs) {
      const bytes = buildBiffWorkbook(spec);
      const stream = await workbookStream(bytes);
      const lastDimensions = listRecords(stream).filter((each) => each.type === RT.DIMENSIONS).at(-1);
      if (lastDimensions === undefined) throw new Error(name);
      // A reader that read the whole stream could not pass this bound.
      expect(lastDimensions.end + SLICE - 1, name).toBeLessThan(stream.length - 20);
      const { handle, reads } = spyCfbHandle(await openCfb(bytes), SLICE);
      expect((await readBiffInventory.readInventory({ kind: "cfb", cfb: handle })).kind, name).toBe("inventory");
      const workbook = reads.get("WORKBOOK");
      expect(workbook?.read ?? 0, name).toBe(0);
      expect(workbook?.streamed ?? 0, name).toBeGreaterThan(0);
      expect(workbook?.streamed ?? 0, name).toBeLessThanOrEqual(lastDimensions.end + SLICE - 1);
    }
  });

  it("covers every generated BIFF fixture", () => {
    expect([...BIFF_CORPUS.keys()].length).toBeGreaterThanOrEqual(7);
  });
});
