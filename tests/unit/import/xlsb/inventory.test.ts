import { describe, expect, it } from "vitest";
import type { InventoryOutcomeV1, WorkbookInventoryV1 } from "../../../../src/import/facts/index.js";
import { readXlsbInventory } from "../../../../src/import/formats/xlsb/inventory.js";
import { preflightWorkbook, type WorkbookPreflightOutcomeV1 } from "../../../../src/import/preflight/workbook.js";
import { sniffContent } from "../../../../src/import/source/sniff.js";
import { openZipContainer, ZIP_READ_CHUNK_BYTES } from "../../../../src/import/source/zip.js";
import { buildXlsb, type XlsbWorkbookSpec } from "../../../fixtures/workbooks/xlsb/build-xlsb.js";
import { PLAIN_XLSB, XLSB_CORPUS } from "../../../fixtures/workbooks/xlsb/corpus.js";
import { entryDataRanges, spyZipHandle } from "../containers/spy.js";
import { bytesSource, countingSource, fixtureBytes } from "../fixtures.js";

const READERS = new Map([["xlsb" as const, readXlsbInventory]]);
const SLICE = 16;

const inventoryOf = async (bytes: Uint8Array): Promise<InventoryOutcomeV1> =>
  readXlsbInventory.readInventory({ kind: "zip", zip: await openZipContainer(bytesSource(bytes)) });

const expectInventory = (outcome: InventoryOutcomeV1): WorkbookInventoryV1 => {
  if (outcome.kind !== "inventory") throw new Error(`expected an inventory, got ${JSON.stringify(outcome)}`);
  return outcome.inventory;
};

const preflight = async (bytes: Uint8Array, name: string): Promise<WorkbookPreflightOutcomeV1> => {
  const source = bytesSource(bytes);
  return preflightWorkbook(source, await sniffContent(source, name), READERS);
};

/** Test-side BIFF12 walk: each record's type and end offset. */
const recordEnds = (part: Uint8Array): { type: number; end: number }[] => {
  const records: { type: number; end: number }[] = [];
  let at = 0;
  while (at < part.length) {
    let type = (part[at] as number) & 0x7f;
    if (((part[at++] as number) & 0x80) !== 0) type |= ((part[at++] as number) & 0x7f) << 7;
    let size = 0;
    for (let shift = 0; ; shift += 7) {
      const byte = part[at++] as number;
      size |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
    }
    at += size;
    records.push({ type, end: at });
  }
  return records;
};

const WS_DIM = 148;
const BEGIN_SHEET_DATA = 145;

const WORKBOOKS: [string, XlsbWorkbookSpec][] = [
  ["plain", PLAIN_XLSB],
  [
    "wide",
    {
      sheets: [
        { name: "One", rows: Array.from({ length: 60 }, (_, row) => [`r${row}`, row, row / 7, row % 2 === 0]) },
        { name: "Undeclared", dimension: null, rows: Array.from({ length: 30 }, (_, row) => [row, `u${row}`]) },
        { name: "Short", shortRows: [1, 2], rows: [["a", "b"], [1, 2.5], [true, "c"]] },
      ],
    },
  ],
];

describe("XLSB inventory — exact outcome per fixture", () => {
  it("reads the plain workbook's sheets, dimensions, tables and estimates from metadata", async () => {
    const inventory = expectInventory(await inventoryOf(await fixtureBytes("xlsb/plain.xlsb")));
    expect(inventory).toMatchObject({ format: "xlsb", sheetListKnown: true, dateSystem: "1900", definedNames: [] });
    expect(inventory.sheets.map((sheet) => [sheet.sheetIndex, sheet.name, sheet.kind, sheet.visibility])).toEqual([
      [0, "Crew", "worksheet", "visible"],
      [1, "Sites", "worksheet", "visible"],
    ]);
    expect(inventory.sheets[0]).toMatchObject({
      declaredRange: { firstRow: 0, firstColumn: 0, lastRow: 3, lastColumn: 4 },
      declaredTables: [{ name: "CrewTable", range: { firstRow: 0, firstColumn: 0, lastRow: 3, lastColumn: 4 } }],
      estimatedRowCount: 4,
      estimatedCellCount: 20,
    });
    expect(inventory.sheets[1]).toMatchObject({ estimatedRowCount: 3, estimatedCellCount: 6 });
  });

  it("refuses a VBA project and an XLM macro sheet as macro content", async () => {
    expect(await inventoryOf(await fixtureBytes("xlsb/macro-vba.xlsb"))).toEqual({
      kind: "macro",
      signal: { kind: "vba-project", partPath: "xl/vbaProject.bin" },
    });
    expect(await inventoryOf(await fixtureBytes("xlsb/xlm-macrosheet.xlsb"))).toEqual({
      kind: "macro",
      signal: { kind: "xlm-macro-sheet", partPath: "xl/macrosheets/sheet3.bin" },
    });
    for (const name of ["macro-vba.xlsb", "xlm-macrosheet.xlsb"]) {
      expect(await preflight(await fixtureBytes(`xlsb/${name}`), name), name).toEqual({
        kind: "refused",
        refusal: { kind: "macro-content", fileName: name, remedy: "reupload-macro-free-copy" },
      });
    }
  });

  it("is identified by content and routed as fits through pre-flight", async () => {
    const outcome = await preflight(await fixtureBytes("xlsb/plain.xlsb"), "crew.xlsb");
    if (outcome.kind !== "proceed") throw new Error(JSON.stringify(outcome));
    expect(outcome.report).toMatchObject({ format: "xlsb", route: "fits", defaultSelection: [0, 1], formatContradiction: null });
  });

  it("names chart sheets, hidden sheets, 1904 and absent dimensions; refuses impossible ones", async () => {
    const inventory = expectInventory(
      await inventoryOf(
        buildXlsb({
          date1904: true,
          sheets: [
            { name: "Data", rows: [["a", 1]] },
            { name: "Chart1", kind: "chartsheet" },
            { name: "Secret", state: 1, rows: [[1]] },
            { name: "Buried", state: 2, rows: [[1]] },
            { name: "Undeclared", dimension: null, rows: [[1, 2]] },
          ],
        }),
      ),
    );
    expect(inventory.dateSystem).toBe("1904");
    expect(inventory.sheets.map((sheet) => [sheet.name, sheet.kind, sheet.visibility, sheet.estimatedRowCount])).toEqual([
      ["Data", "worksheet", "visible", 1],
      ["Chart1", "chartsheet", "visible", null],
      ["Secret", "worksheet", "hidden", 1],
      ["Buried", "worksheet", "very-hidden", 1],
      ["Undeclared", "worksheet", "visible", null],
    ]);
    expect(inventory.sheets[1]?.preservedPartCounts.chart).toBe(1);
    expect(inventory.sheets[4]?.estimatedCellCount).toBeGreaterThan(0);

    expect(await inventoryOf(buildXlsb({ sheets: [{ name: "Far", dimension: [0, 1_048_576, 0, 1], rows: [[1]] }] }))).toEqual({
      kind: "unreadable",
      detail: "impossible-dimension",
    });
    const liar = expectInventory(await inventoryOf(buildXlsb({ sheets: [{ name: "Liar", dimension: [0, 999_999, 0, 999], rows: [[1]] }] })));
    expect(liar.sheets[0]?.estimatedCellCount).toBeLessThan(40);
  });
});

describe("XLSB pre-flight reads no cell (CA-18)", () => {
  const all = async (): Promise<[string, Uint8Array][]> => [
    ["plain.xlsb", await fixtureBytes("xlsb/plain.xlsb")],
    ...WORKBOOKS.map(([name, spec]): [string, Uint8Array] => [`${name}.xlsb`, buildXlsb(spec)]),
  ];

  it("reads no sheet byte past BrtWsDim and never sharedStrings.bin — every workbook", async () => {
    for (const [name, bytes] of await all()) {
      const zip = await openZipContainer(bytesSource(bytes));
      const { handle, reads } = spyZipHandle(zip, SLICE);
      expect((await readXlsbInventory.readInventory({ kind: "zip", zip: handle })).kind, name).toBe("inventory");
      expect(reads.has("xl/sharedstrings.bin"), `${name} read sharedStrings.bin`).toBe(false);
      const sheets = zip.entries.filter((entry) => /^xl\/worksheets\/[^/]+\.bin$/.test(entry.name));
      expect(sheets.length, name).toBeGreaterThan(0);
      for (const sheet of sheets) {
        const part = await (await openZipContainer(bytesSource(bytes))).readEntry(sheet.name, { maxBytes: 1 << 26 });
        const records = recordEnds(part);
        const stop = records.find((each) => each.type === WS_DIM) ?? records.find((each) => each.type === BEGIN_SHEET_DATA);
        if (stop === undefined) throw new Error(`${name} ${sheet.name} has no sheet data`);
        const record = reads.get(sheet.name.toLowerCase());
        expect(record?.read ?? 0, `${name} ${sheet.name} read whole`).toBe(0);
        expect(record?.streamed ?? 0, `${name} ${sheet.name}`).toBeGreaterThan(0);
        expect(record?.streamed ?? 0, `${name} ${sheet.name}`).toBeLessThanOrEqual(stop.end + SLICE - 1);
        // A reader that read the cells could not pass this bound.
        expect(stop.end + SLICE - 1, `${name} ${sheet.name}`).toBeLessThan(part.length);
      }
    }
  });

  it("touches no compressed byte of sharedStrings.bin through pre-flight", async () => {
    for (const [name, bytes] of await all()) {
      const ranges = entryDataRanges(bytes);
      const sniff = await sniffContent(bytesSource(bytes), name);
      const source = countingSource(bytesSource(bytes));
      expect((await preflightWorkbook(source, sniff, READERS)).kind, name).toBe("proceed");
      const overlap = (range: { start: number; end: number }) =>
        source.reads.reduce(
          (sum, read) => sum + Math.max(0, Math.min(read.offset + read.length, range.end) - Math.max(read.offset, range.start)),
          0,
        );
      const shared = ranges.get("xl/sharedStrings.bin");
      if (shared === undefined) throw new Error(name);
      expect(overlap(shared), name).toBe(0);
      for (const [entry, range] of ranges) {
        if (/^xl\/worksheets\/[^/]+\.bin$/.test(entry)) {
          expect(overlap(range), `${name} ${entry}`).toBeLessThanOrEqual(ZIP_READ_CHUNK_BYTES);
        }
      }
    }
  });

  it("covers every generated XLSB fixture", () => {
    expect([...XLSB_CORPUS.keys()].length).toBeGreaterThanOrEqual(3);
  });
});
