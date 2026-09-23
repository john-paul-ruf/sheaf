/**
 * CAP-25 view models (SCR-030, SCR-031, SHT-016, STA-012; CA-22).
 *
 * The assertions that matter are the ones a plausible grid would get wrong: a
 * size nobody declared is not zero, a merged region spans instead of
 * repeating, an inert item appears at its anchor with its type, location and
 * reason, a discarded row stays in the grid marked, and export is present but
 * disabled with its reason.
 */

import { describe, expect, it } from "vitest";
import {
  EXPORT_SHEET_LATER,
  columnLetters,
  liveTableForSheet,
  pageStartFor,
  selectSnapshotOptionsVm,
  selectSnapshotViewerVm,
  selectSnapshotsListVm,
  sheetUseTag,
  toSnapshotFindVm,
} from "../../../src/application/view-models/records.js";
import type {
  AppTableViewV1,
  InertItemViewV1,
  SheetSnapshotViewV1,
  SnapshotPageViewV1,
} from "../../../src/workers/protocol/messages.js";

function sheet(overrides: Partial<SheetSnapshotViewV1> = {}): SheetSnapshotViewV1 {
  return {
    sheetId: "s-jobs",
    displayName: "Jobs",
    sheetOrdinal: 0,
    classification: ["table"],
    declaredRowCount: 61,
    declaredColumnCount: 10,
    snapshotRevision: 1,
    inertCounts: [],
    ...overrides,
  };
}

function page(overrides: Partial<SnapshotPageViewV1> = {}): SnapshotPageViewV1 {
  return {
    sheetId: "s-overview",
    format: "sheet-v2",
    displayName: "Overview",
    rowCount: 6,
    columnCount: 2,
    firstRow: 0,
    rows: [
      { rowIndex: 0, cells: [{ columnIndex: 0, text: "Fieldwork Q3 overview", kind: "text" }] },
      {
        rowIndex: 2,
        cells: [
          { columnIndex: 0, text: "Open jobs", kind: "text" },
          { columnIndex: 1, text: "15", kind: "formula-result" },
        ],
      },
    ],
    merges: [],
    inertAnchors: [],
    discardedRows: [],
    ...overrides,
  };
}

const CHART: InertItemViewV1 = {
  inertItemId: "i-chart",
  sheetId: "s-overview",
  sheetName: "Overview",
  kind: "chart",
  location: "Overview!D2:K18",
  reasonKey: "chart-not-live-yet",
  anchor: { firstRow: 1, firstColumn: 3, lastRow: 17, lastColumn: 10 },
};

describe("the snapshot list (SCR-030)", () => {
  it("tags each sheet by its use, in the mock's three words", () => {
    expect(sheetUseTag(["table"])).toBe("interactive-table");
    expect(sheetUseTag(["lookup"])).toBe("interactive-table");
    expect(sheetUseTag(["summary", "chart"])).toBe("read-only-snapshot");
    expect(sheetUseTag([])).toBe("read-only-snapshot");
    expect(sheetUseTag(["table", "summary"])).toBe("mixed-use");
  });

  it("orders sheets, counts inert items, and never reads an undeclared size as zero", () => {
    const vm = selectSnapshotsListVm([
      sheet({
        sheetId: "s-overview",
        displayName: "Overview",
        sheetOrdinal: 5,
        classification: ["summary", "chart"],
        declaredRowCount: null,
        declaredColumnCount: null,
        inertCounts: [
          { kind: "chart", count: 1 },
          { kind: "drawing", count: 2 },
          { kind: "formula", count: 4 },
        ],
      }),
      sheet(),
    ]);
    expect(vm.sheets.map((row) => row.displayName)).toEqual(["Jobs", "Overview"]);
    expect(vm.sheets[0]).toMatchObject({
      tagLabel: "Interactive table",
      sizeLine: "61 rows · 10 columns in the source",
      inertLine: null,
      inertTotal: 0,
    });
    expect(vm.sheets[1]).toMatchObject({
      tagLabel: "Read-only snapshot",
      sizeLine: "Size not declared in the source",
      inertTotal: 7,
      inertLine: "1 chart, 2 drawing objects and 4 formulas preserved, not interactive.",
    });
    expect(vm.announcement).toBe("2 sheet snapshots kept with this app.");
  });

  it("says when there is nothing to list", () => {
    const vm = selectSnapshotsListVm([]);
    expect(vm.emptiness).toBe("no-sheets");
    expect(vm.announcement).toBe("This app has no sheet snapshots.");
  });
});

describe("the snapshot viewer (SCR-031)", () => {
  it("names columns as the source does", () => {
    expect([0, 3, 25, 26, 27, 701].map(columnLetters)).toEqual(["A", "D", "Z", "AA", "AB", "ZZ"]);
  });

  it("puts an inert marker at its anchor, with type, location and reason (CTL-079)", () => {
    const vm = selectSnapshotViewerVm({ page: page({ inertAnchors: [{ inertItemId: "i-chart", range: CHART.anchor! }] }), inertItems: [CHART] });
    // The chart sits in column D, beyond the two columns with text.
    expect(vm.columns.map((column) => column.letters)).toEqual(["A", "B", "C", "D"]);
    const row = vm.rows.find((candidate) => candidate.rowIndex === 1);
    expect(row).toBeDefined();
    const slot = row?.slots.find((candidate) => candidate.columnIndex === 3);
    expect(slot?.markers).toEqual([
      {
        inertItemId: "i-chart",
        sheetId: "s-overview",
        sheetName: "Overview",
        kind: "chart",
        kindName: "Chart",
        location: "Overview!D2:K18",
        reason: "Kept as a snapshot; rebuilt as a live chart in a later release.",
        anchorRow: 1,
      },
    ]);
    expect(vm.inertHeadline).toBe("1 inert item on this sheet");
  });

  it("spans a merged region once, instead of repeating its cells", () => {
    const vm = selectSnapshotViewerVm({
      page: page({
        displayName: "Crew",
        columnCount: 4,
        rows: [{ rowIndex: 0, cells: [{ columnIndex: 0, text: "Cedar & Finch — Crew roster", kind: "text" }] }],
        merges: [{ firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 3 }],
      }),
      inertItems: [],
    });
    const [first] = vm.rows;
    expect(first?.slots).toHaveLength(1);
    expect(first?.slots[0]).toMatchObject({ colSpan: 4, rowSpan: 1, isMerged: true });
  });

  it("keeps discarded rows in the grid, marked with why (FR-4)", () => {
    const vm = selectSnapshotViewerVm({
      page: page({
        rows: [
          { rowIndex: 0, cells: [{ columnIndex: 0, text: "Cedar & Finch — Crew roster", kind: "text" }] },
          { rowIndex: 3, cells: [{ columnIndex: 0, text: "Name", kind: "text" }] },
        ],
        discardedRows: [
          { rowIndex: 0, reason: "above-header" },
          { rowIndex: 28, reason: "empty-row" },
        ],
        rowCount: 40,
      }),
      inertItems: [],
    });
    expect(vm.rows.map((row) => [row.rowNumber, row.discarded])).toEqual([
      [1, "Not imported · above the header row"],
      [4, null],
      [29, "Not imported · empty row"],
    ]);
  });

  it("pages at 50 rows and says where the page is", () => {
    const vm = selectSnapshotViewerVm({ page: page({ rowCount: 61, firstRow: 50, rows: [] }), inertItems: [] });
    expect(vm).toMatchObject({ firstRow: 50, endRow: 61, hasPrevious: true, hasNext: false });
    expect(vm.announcement).toBe("Overview, rows 51 to 61 of 61. Read only.");
    expect(pageStartFor(54)).toBe(50);
    expect(pageStartFor(49)).toBe(0);
  });

  it("marks a find match and says where it is", () => {
    const find = toSnapshotFindVm("Open", null, { outcome: "found", rowIndex: 2, columnIndex: 0 });
    const vm = selectSnapshotViewerVm({ page: page(), inertItems: [], find });
    expect(vm.announcement).toBe("Found “Open” in A3.");
    const matched = vm.rows.flatMap((row) => row.slots).filter((slot) => slot.isMatch);
    expect(matched.map((slot) => slot.text)).toEqual(["Open jobs"]);
  });

  it("tells a search that found nothing from one that found no more", () => {
    expect(toSnapshotFindVm("zzz", null, { outcome: "not-found" })).toMatchObject({
      sentence: "No cell in this snapshot contains “zzz”.",
    });
    expect(toSnapshotFindVm("J-10", 54, { outcome: "not-found" })).toMatchObject({
      sentence: "No more cells contain “J-10” after row 55.",
    });
  });
});

describe("snapshot options (SHT-016)", () => {
  const tables: readonly AppTableViewV1[] = [
    {
      tableId: "t-jobs",
      displayName: "Jobs",
      tableOrdinal: 0,
      recordCount: 60,
      isRecordCountExact: true,
      fields: [],
    },
  ];

  it("offers find, inert items and the way back, and export disabled with its reason", () => {
    const vm = selectSnapshotOptionsVm({ inertCount: 3, liveTable: liveTableForSheet("Jobs", tables) });
    expect(vm.options.map((option) => [option.id, option.label, option.isEnabled])).toEqual([
      ["find", "Find in sheet", true],
      ["inert-items", "Inert items (3)", true],
      ["return", "Return to live Jobs", true],
      ["export", "Export sheet", false],
    ]);
    expect(vm.options.at(-1)).toMatchObject({ disabledReason: EXPORT_SHEET_LATER });
    expect(EXPORT_SHEET_LATER).toBe("Export arrives in a later release.");
  });

  it("returns to the app home when no table carries the sheet's name", () => {
    const vm = selectSnapshotOptionsVm({ inertCount: 0, liveTable: liveTableForSheet("Overview", tables) });
    expect(vm.options.find((option) => option.id === "return")).toMatchObject({
      label: "Return to app home",
      tableId: null,
    });
  });
});
