import { describe, expect, it, vi } from "vitest";
import {
  selectChangeHistoryVm,
  selectRestoreRecordDialogVm,
  selectSnapshotOptionsVm,
  selectSnapshotViewerVm,
  selectSnapshotsListVm,
  toSnapshotFindVm,
} from "../../../../src/application/view-models/records.js";
import type {
  InertItemViewV1,
  SnapshotPageViewV1,
} from "../../../../src/workers/protocol/messages.js";
import type { AppIdentity, AppNavigation } from "../../../../src/ui/records/app-frame.js";
import { ChangeHistoryScreen } from "../../../../src/ui/records/change-history-screen.js";
import { RestoreRecordDialog } from "../../../../src/ui/records/restore-record-dialog.js";
import { SnapshotOptionsSheet } from "../../../../src/ui/records/snapshot-options-sheet.js";
import { SnapshotViewerScreen } from "../../../../src/ui/records/snapshot-viewer-screen.js";
import { SnapshotsScreen } from "../../../../src/ui/records/snapshots-screen.js";
import "../../../../src/ui/theme/base.css";
import { interact, query, queryAll, render } from "../render.js";
import { APP_ID, FIELD_IDS, TABLE_ID, historyEntry, historyPage, session, table } from "./fixtures.js";

/**
 * CAP-25's surfaces, rendered (SCR-030, SCR-031, SHT-016, STA-012), plus the
 * SCR-032 table naming and MOD-010's original values (CA-21, CA-22).
 */

const nav: AppNavigation = {
  library: "#/library",
  appHome: `#/app/${APP_ID}`,
  appHistory: `#/app/${APP_ID}/history`,
  appSnapshots: `#/app/${APP_ID}/snapshots`,
  tables: [{ tableId: TABLE_ID, displayName: "Visits", href: `#/app/${APP_ID}/t/${TABLE_ID}` }],
};

const identity: AppIdentity = { appId: APP_ID, displayName: "Fieldwork Q3", theme: session().theme };

const CHART: InertItemViewV1 = {
  inertItemId: "i-chart",
  sheetId: "s-overview",
  sheetName: "Overview",
  kind: "chart",
  location: "Overview!D2:K18",
  reasonKey: "chart-not-live-yet",
  anchor: { firstRow: 1, firstColumn: 3, lastRow: 17, lastColumn: 10 },
};

const OVERVIEW: SnapshotPageViewV1 = {
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
  merges: [{ firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 1 }],
  inertAnchors: [{ inertItemId: "i-chart", range: CHART.anchor! }],
  discardedRows: [{ rowIndex: 4, reason: "empty-row" }],
};

function renderViewer(overrides: Partial<Parameters<typeof SnapshotViewerScreen>[0]> = {}): Promise<unknown> {
  return render(
    <SnapshotViewerScreen
      allSnapshotsHref="#/snapshots"
      app={identity}
      nav={nav}
      onFind={vi.fn()}
      onOpenOptions={vi.fn()}
      onPage={vi.fn()}
      onShowItem={vi.fn()}
      returnLink={{ href: "#/home", label: "Return to app home" }}
      vm={selectSnapshotViewerVm({ page: OVERVIEW, inertItems: [CHART] })}
      {...overrides}
    />,
  );
}

describe("SCR-030 — every imported sheet", () => {
  it("tags each sheet by use, states its size truthfully, and counts inert items", async () => {
    await render(
      <SnapshotsScreen
        app={identity}
        nav={nav}
        snapshotHref={(sheetId) => `#/snapshots/${sheetId}`}
        vm={selectSnapshotsListVm([
          {
            sheetId: "s-jobs",
            displayName: "Jobs",
            sheetOrdinal: 0,
            classification: ["table"],
            declaredRowCount: 61,
            declaredColumnCount: 10,
            snapshotRevision: 1,
            inertCounts: [{ kind: "formula", count: 2 }],
          },
          {
            sheetId: "s-overview",
            displayName: "Overview",
            sheetOrdinal: 5,
            classification: ["summary", "chart"],
            declaredRowCount: null,
            declaredColumnCount: null,
            snapshotRevision: 1,
            inertCounts: [
              { kind: "chart", count: 1 },
              { kind: "drawing", count: 2 },
            ],
          },
        ])}
      />,
    );
    const jobs = query('[data-sheet-row="s-jobs"]');
    expect(jobs.textContent).toContain("Interactive table");
    expect(jobs.textContent).toContain("61 rows · 10 columns in the source");
    expect(jobs.querySelector("a")?.textContent).toBe("View original Jobs sheet");
    const overview = query('[data-sheet-row="s-overview"]');
    expect(overview.textContent).toContain("Read-only snapshot");
    expect(overview.textContent).toContain("Size not declared in the source");
    expect(overview.textContent).not.toContain("0 rows");
    expect(overview.textContent).toContain("1 chart and 2 drawing objects preserved, not interactive.");
    expect(overview.querySelector("a")?.getAttribute("href")).toBe("#/snapshots/s-overview");
  });
});

describe("SCR-031 — one sheet, read only", () => {
  it("draws cells as text, a merge once, the inert marker at its anchor, and a discarded row marked", async () => {
    await renderViewer();
    const grid = query("table");
    expect(grid.querySelector("caption")?.textContent).toBe("Original Overview worksheet, rows 1 to 6 of 6");
    expect([...grid.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual(["Row", "A", "B", "C", "D"]);

    const merged = grid.querySelector('td[data-merged="true"]');
    expect(merged?.getAttribute("colspan")).toBe("2");
    expect(merged?.textContent).toBe("Fieldwork Q3 overview");

    const marker = query('[data-inert-marker="chart"]');
    expect(marker.textContent).toContain("Chart preserved · Overview!D2:K18");
    expect(marker.closest("tr")?.getAttribute("data-row")).toBe("2");

    const discarded = query('tr[data-discarded="true"]');
    expect(discarded.getAttribute("data-row")).toBe("5");
    expect(discarded.textContent).toContain("Not imported · empty row");

    // STA-012: type, location, reason, and the way to it.
    const item = query('[data-inert="chart"]');
    // F04: the F03 durable key keeps decoding, its copy revised (D50, D62).
    expect(item.textContent).toContain("Kept as a snapshot of the workbook's chart. It is not a live chart.");
    expect(query("[data-screen='SCR-031']").textContent).toContain("1 inert item on this sheet");
  });

  it("finds through the worker, and asks for the next match once one is showing", async () => {
    const onFind = vi.fn();
    await renderViewer({
      onFind,
      vm: selectSnapshotViewerVm({
        page: OVERVIEW,
        inertItems: [],
        find: toSnapshotFindVm("Open", null, { outcome: "found", rowIndex: 2, columnIndex: 0 }),
      }),
    });
    expect(query('[aria-current="true"]').textContent).toBe("Open jobs");
    expect(query("[data-find='found']").textContent).toBe("Found “Open” in A3.");
    await interact(() => {
      query<HTMLFormElement>("form[role='search']").requestSubmit();
    });
    expect(onFind).toHaveBeenCalledWith("Open", true);
  });

  it("pages with earlier and later rows", async () => {
    const onPage = vi.fn();
    await renderViewer({
      onPage,
      vm: selectSnapshotViewerVm({
        page: { ...OVERVIEW, rowCount: 120, firstRow: 50, rows: [], merges: [], inertAnchors: [], discardedRows: [] },
        inertItems: [],
      }),
    });
    const buttons = queryAll("button");
    const later = buttons.find((button) => button.textContent === "Later rows");
    const earlier = buttons.find((button) => button.textContent === "Earlier rows");
    await interact(() => {
      later?.click();
    });
    await interact(() => {
      earlier?.click();
    });
    expect(onPage.mock.calls).toEqual([[100], [0]]);
  });
});

describe("SHT-016 — snapshot options", () => {
  it("offers find, inert items and the way back, and export disabled with its reason", async () => {
    const onChoose = vi.fn();
    await render(
      <SnapshotOptionsSheet
        isOpen
        onChoose={onChoose}
        onClose={vi.fn()}
        vm={selectSnapshotOptionsVm({ inertCount: 3, liveTable: { tableId: "t-jobs", displayName: "Jobs" } })}
      />,
    );
    const sheet = query("[data-sheet='SHT-016']");
    const labels = [...sheet.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["Find in sheet", "Inert items (3)", "Return to live Jobs", "Export sheet"]);
    const exportButton = [...sheet.querySelectorAll("button")].at(-1);
    expect(exportButton?.hasAttribute("disabled")).toBe(true);
    expect(sheet.textContent).toContain("Export arrives in a later release.");
    const back = [...sheet.querySelectorAll("button")].find((button) => button.textContent === "Return to live Jobs");
    await interact(() => {
      back?.click();
    });
    expect(onChoose).toHaveBeenCalledWith("return");
  });
});

describe("SCR-032 names each entry's table; MOD-010 shows what comes back", () => {
  it("history lines say which table, and link to the record there", async () => {
    await render(
      <ChangeHistoryScreen
        app={identity}
        fieldNames={new Map([[FIELD_IDS.status, "Status"]])}
        nav={nav}
        onRestore={vi.fn()}
        recordHref={(recordId, tableId) => (tableId === null ? null : `#/t/${tableId}/r/${recordId}`)}
        vm={selectChangeHistoryVm(historyPage({ entries: [historyEntry({ tableId: TABLE_ID })] }), [table()])}
      />,
    );
    const line = query("[data-event]");
    expect(line.textContent).toContain("this device · Visits · Status");
    expect(line.querySelector("a")?.getAttribute("href")).toBe(`#/t/${TABLE_ID}/r/record-1`);
  });

  it("MOD-010 lists the original values before the restore, and a refusal after", async () => {
    const entry = { ...historyEntry({ eventKind: "record.deleted", isRestorable: true }), tableId: TABLE_ID, tableName: "Visits" };
    const deleted = {
      recordId: "record-1",
      tableId: TABLE_ID,
      values: [
        { fieldId: FIELD_IDS.visitId, value: { kind: "text" as const, text: "1018" } },
        { fieldId: FIELD_IDS.status, value: { kind: "text" as const, text: "In progress" } },
      ],
      deletedEventId: "event-9",
      deletedAtEpochMs: 1_757_000_200_000,
      keyValue: null,
    };
    const mounted = (await render(
      <RestoreRecordDialog
        isOpen
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        vm={selectRestoreRecordDialogVm(entry, { deleted, table: table() })}
      />,
    )) as { rerender: (next: unknown) => Promise<void> };
    const dialog = query("[role='alertdialog']");
    expect(dialog.textContent).toContain("from Visits.");
    expect([...dialog.querySelectorAll("[data-original] dt")].map((node) => node.textContent)).toEqual([
      "Visit ID",
      "Status",
    ]);
    expect(dialog.textContent).toContain("In progress");
    expect(dialog.textContent).toContain(
      "Restore validates against the current schema before writing a new append-only event.",
    );

    await mounted.rerender(
      <RestoreRecordDialog
        isOpen
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        vm={selectRestoreRecordDialogVm(entry, {
          deleted,
          table: table(),
          rejection: [
            {
              fieldId: FIELD_IDS.status,
              kind: "value",
              severity: "blocking",
              messageKey: "validation.required",
              messageParameters: {},
            },
          ],
        })}
      />,
    );
    const refused = query("[role='alertdialog']");
    expect(refused.textContent).toContain("This record was not restored");
    expect(refused.textContent).toContain("This field needs a value before the record can be saved.");
  });
});
