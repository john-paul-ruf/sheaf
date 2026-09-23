import { describe, expect, it, vi } from "vitest";
import type {
  DelimitedTargetVm,
  ImportEndedVm,
  ImportProgressVm,
  WorkbookPreflightVm,
  WorkbookSheetRowVm,
} from "../../../../src/application/view-models/import.js";
import { ROUTE_HREFS } from "../../../../src/routes/guards.js";
import { WORKBOOK_FILE_EXTENSIONS } from "../../../../src/platform/file-pick.js";
import { DelimitedTargetScreen } from "../../../../src/ui/import/delimited-target-screen.js";
import { ImportFailedScreen } from "../../../../src/ui/import/import-failed-screen.js";
import { ImportProgressScreen } from "../../../../src/ui/import/import-progress-screen.js";
import {
  WorkbookPreflightScreen,
  describeSheet,
} from "../../../../src/ui/import/workbook-preflight-screen.js";
import "../../../../src/ui/theme/base.css";
import { TARGET_MIN, interact, query, queryAll, render } from "../render.js";

/**
 * The F03 import surfaces as rendered (CAP-19, CAP-20, CAP-21, CAP-26;
 * SCR-017–022, MOD-004, MOD-008).
 *
 * Fixtures are typed by the view model they stand for, so a shape change
 * upstream fails here at compile time; what is under test is which token
 * becomes which sentence, and which state may make which claim.
 */

const nav = ROUTE_HREFS;
const noop = (): void => undefined;

const buttonNamed = (name: string): HTMLButtonElement | undefined =>
  queryAll<HTMLButtonElement>("button").find((button) => button.textContent === name);

function sheet(overrides: Partial<WorkbookSheetRowVm> & Pick<WorkbookSheetRowVm, "sheetIndex" | "name">): WorkbookSheetRowVm {
  return {
    isSelected: true,
    isHidden: false,
    shape: "declared-table",
    rows: { kind: "estimated", value: 60 },
    cells: { kind: "estimated", value: 600 },
    badge: "use",
    ...overrides,
  };
}

function preflight(overrides: Partial<WorkbookPreflightVm> = {}): WorkbookPreflightVm {
  return {
    screen: "SCR-018",
    step: "workbookFits",
    fileName: "fieldwork-q3.xlsx",
    format: "xlsx",
    sourceByteLength: 48_000,
    declaredExtension: "xlsx",
    contradiction: null,
    sheets: [
      sheet({ sheetIndex: 0, name: "Jobs" }),
      sheet({ sheetIndex: 1, name: "Crew", shape: "table-region", badge: "inspect", rows: { kind: "estimated", value: 39 } }),
      sheet({
        sheetIndex: 2,
        name: "Overview",
        shape: "charts-and-summary",
        badge: "dashboard",
        cells: { kind: "estimated", value: 42 },
      }),
      sheet({ sheetIndex: 3, name: "Archive 2018", isSelected: false, shape: "table-region", badge: "excluded", rows: { kind: "estimated", value: 2_001 } }),
    ],
    selection: {
      selectedCount: 3,
      sheetCount: 4,
      estimatedRows: { kind: "estimated", value: 104 },
      estimatedCells: 1_242,
      maxEstimatedCells: 250_000,
      blocker: null,
    },
    workbookEstimatedCells: { kind: "estimated", value: 9_246 },
    drawingNotices: [{ sheetName: "Overview", drawingCount: 2 }],
    canStart: true,
    handoff: null,
    announcement: "This workbook fits this device. 3 of 4 sheets are selected.",
    ...overrides,
  };
}

async function renderPreflight(vm: WorkbookPreflightVm, handlers: Partial<Record<string, () => void>> = {}) {
  return render(
    <WorkbookPreflightScreen
      acceptedFileTypes={WORKBOOK_FILE_EXTENSIONS}
      nav={nav}
      onCancel={handlers["cancel"] ?? noop}
      onClearAll={handlers["clearAll"] ?? noop}
      onCopyHandoff={handlers["copy"] ?? noop}
      onSelectFiles={noop}
      onStart={handlers["start"] ?? noop}
      onToggleSheet={noop}
      vm={vm}
    />,
  );
}

describe("SCR-018 — the workbook checklist, sized before a cell is read", () => {
  it("draws every sheet with import.html's line and badge, estimates written 'about'", async () => {
    await renderPreflight(preflight());
    const text = document.body.textContent;
    expect(query('[data-screen="SCR-018"]')).toBeTruthy();
    expect(text).toContain("This workbook fits this device.");
    expect(text).toContain("Declared table · about 60 rows");
    expect(text).toContain("Table region · about 39 rows");
    expect(text).toContain("Charts and summary values · about 42 used cells");
    expect(text).toContain("About 2,001 rows · preserved if selected");
    for (const badge of ["Use", "Inspect", "Dashboard", "Excluded"]) expect(text).toContain(badge);
    expect(text).toContain("3 of 4 selected");
    expect(text).toContain("Content matches .xlsx");
    expect(queryAll('[role="checkbox"], input[type="checkbox"]').length).toBeGreaterThanOrEqual(4);
  });

  it("states the drawing notice from the report's count, never claiming interactivity", async () => {
    await renderPreflight(preflight());
    expect(document.body.textContent).toContain("2 drawing objects may remain read-only");
    expect(document.body.textContent).toContain(
      "They will be preserved in the “Overview” sheet snapshot and named during review. Sheaf will not imply they became interactive.",
    );
  });

  it("writes an undeclared size as 'not declared', never as 0 (CA-18)", () => {
    const undeclared = sheet({ sheetIndex: 0, name: "Summary", rows: { kind: "not-declared" } });
    expect(describeSheet(undeclared)).toBe("Declared table · size not declared");
    expect(describeSheet({ ...undeclared, isHidden: true })).toBe("Declared table · size not declared · hidden");
    expect(describeSheet(undeclared)).not.toMatch(/\b0\b/u);
  });

  it("starts only a selection that can start, and says why otherwise", async () => {
    const start = vi.fn();
    await renderPreflight(preflight(), { start });
    await interact(() => {
      buttonNamed("Import 3 selected sheets")?.click();
    });
    expect(start).toHaveBeenCalledTimes(1);

    await renderPreflight(
      preflight({ canStart: false, selection: { ...preflight().selection, selectedCount: 0, blocker: "nothing-selected" } }),
    );
    const disabled = queryAll<HTMLButtonElement>("button").filter((button) => button.textContent === "Import 0 selected sheets");
    expect(disabled.at(-1)?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Select at least one sheet to import.");
  });

  it("opens MOD-004 for a format contradiction; Cancel leaves, Continue stays", async () => {
    const cancel = vi.fn();
    await renderPreflight(
      preflight({ format: "xlsb", contradiction: { declaredExtension: "xlsx", detectedFormat: "xlsb" } }),
      { cancel },
    );
    const dialog = query('[role="dialog"]');
    expect(dialog.textContent).toContain("Content/extension mismatch");
    expect(dialog.textContent).toContain(
      "This file is named “.xlsx”, but its content is Excel binary workbook content. Sheaf goes by the content.",
    );
    expect(document.body.textContent).not.toContain("Content matches");
    await interact(() => {
      buttonNamed("Continue")?.click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("SCR-019 — a smaller scope, or the desktop handoff", () => {
  const handoff = { instructions: "Import everything on desktop: “big.xlsx”.\nNo work is transferred automatically.", copy: null };

  it("subset: offers the smaller scope beside the handoff, with the budget stated", async () => {
    const clearAll = vi.fn();
    await renderPreflight(
      preflight({ screen: "SCR-019", step: "workbookSubset", handoff, drawingNotices: [] }),
      { clearAll },
    );
    const text = document.body.textContent;
    expect(query('[data-screen="SCR-019"]')).toBeTruthy();
    expect(text).toContain("This workbook is too large for this device.");
    expect(text).toContain("Choose a smaller scope");
    expect(text).toContain("This release imports up to 250,000 cells across the selected sheets.");
    expect(text).toContain("Selected scope fits");
    expect(text).toContain("Unselected sheets are not imported and remain in the source workbook.");
    expect(text).toContain("Import everything on desktop.");
    // F07's five budgets and capacity detail are not drawn.
    expect(text).not.toContain("Five budgets");
    await interact(() => {
      buttonNamed("Clear all")?.click();
    });
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it("subset: an over-budget selection is a reason, not a start", async () => {
    await renderPreflight(
      preflight({
        screen: "SCR-019",
        step: "workbookSubset",
        handoff,
        canStart: false,
        selection: { ...preflight().selection, estimatedCells: 301_005, blocker: "over-budget" },
      }),
    );
    expect(document.body.textContent).toContain("Selected scope is still too large");
    expect(document.body.textContent).toContain(
      "The selected sheets are more than this device imports. Leave some out.",
    );
  });

  it("D43 watchpoint — handoff copy instructions: copy is offered, and its real result is stated", async () => {
    const copy = vi.fn();
    const { rerender } = await renderPreflight(
      preflight({ screen: "SCR-019", step: "workbookHandoff", handoff, canStart: false }),
      { copy },
    );
    // Nothing to start: no checklist, no stream plan.
    expect(document.body.textContent).not.toContain("Sheets to import");
    expect(document.body.textContent).not.toContain("Stream plan");
    await interact(() => {
      buttonNamed("Copy handoff instructions")?.click();
    });
    expect(copy).toHaveBeenCalledTimes(1);

    await rerender(
      <WorkbookPreflightScreen
        acceptedFileTypes={WORKBOOK_FILE_EXTENSIONS}
        nav={nav}
        onCancel={noop}
        onClearAll={noop}
        onCopyHandoff={noop}
        onSelectFiles={noop}
        onStart={noop}
        onToggleSheet={noop}
        vm={preflight({ screen: "SCR-019", step: "workbookHandoff", handoff: { ...handoff, copy: "unavailable" }, canStart: false })}
      />,
    );
    // A copy that did not happen is not claimed; the text is shown instead.
    expect(document.body.textContent).toContain("This browser did not allow copying");
    expect(query("pre").textContent).toBe(handoff.instructions);
  });

  it("gives every action the 44px floor", async () => {
    await renderPreflight(preflight({ screen: "SCR-019", step: "workbookSubset", handoff }));
    for (const button of queryAll<HTMLElement>("button")) {
      expect(getComputedStyle(button).minHeight).toBe(TARGET_MIN);
    }
  });
});

describe("SCR-017 — an existing app as the destination (D38, CAP-26)", () => {
  const vm: DelimitedTargetVm = {
    screen: "SCR-017",
    step: "delimitedTarget",
    fileName: "crew-roster.tsv",
    delimiter: "\t",
    encoding: "utf-8",
    columnCount: 3,
    rowCount: { kind: "estimated", value: 4 },
    contradiction: null,
    destinations: [
      { id: "new-app", label: "Create a new app", enabled: true, isSelected: false },
      { id: "existing-app", label: "Add a table to an existing app", enabled: true, isSelected: true },
    ],
    destination: "existing-app",
    appChoices: [
      { appId: "app-1", displayName: "Fieldwork Q3", tableCount: 7, isSelected: true },
      { appId: "app-2", displayName: "Field Log", tableCount: 1, isSelected: false },
    ],
    appendEstimate: { estimatedEvents: 9, estimatedRows: { kind: "estimated", value: 4 }, eventCap: 10_000 },
    needsAppName: false,
    appName: "",
    tableName: "Crew",
    appNameProblem: null,
    tableNameProblem: null,
    canContinue: true,
    announcement: "About 4 rows across 3 columns were detected.",
  };

  it("lists the apps as CTL-044 radios and asks only for the table's name", async () => {
    const chooseApp = vi.fn();
    await render(
      <DelimitedTargetScreen
        acceptedFileTypes={WORKBOOK_FILE_EXTENSIONS}
        nav={nav}
        onChooseApp={chooseApp}
        onChooseNewApp={noop}
        onContinue={noop}
        onSelectFiles={noop}
        onSetAppName={noop}
        onSetTableName={noop}
        vm={vm}
      />,
    );
    expect(document.body.textContent).toContain("Which app");
    expect(document.body.textContent).toContain("7 tables. The new table is added beside them.");
    expect(queryAll('input[type="radio"]')).toHaveLength(4);
    expect(document.body.textContent).not.toContain("App name");
    expect(document.body.textContent).toContain("Table name");

    const fieldLog = queryAll<HTMLInputElement>('input[type="radio"]').find((input) => input.value === "app-2");
    await interact(() => {
      fieldLog?.click();
    });
    expect(chooseApp).toHaveBeenCalledWith("app-2");
  });

  it("D43 watchpoint — append-too-large reason: composed from D38's real numbers", async () => {
    await render(
      <DelimitedTargetScreen
        acceptedFileTypes={WORKBOOK_FILE_EXTENSIONS}
        nav={nav}
        onChooseApp={noop}
        onChooseNewApp={noop}
        onContinue={noop}
        onSelectFiles={noop}
        onSetAppName={noop}
        onSetTableName={noop}
        vm={{
          ...vm,
          destinations: [
            { id: "new-app", label: "Create a new app", enabled: true, isSelected: true },
            { id: "existing-app", label: "Add a table to an existing app", enabled: false, isSelected: false, reason: "too-large-to-append" },
          ],
          destination: "new-app",
          appChoices: [],
          needsAppName: true,
          appName: "Over segment",
          appendEstimate: { estimatedEvents: 10_055, estimatedRows: { kind: "estimated", value: 10_050 }, eventCap: 10_000 },
        }}
      />,
    );
    expect(document.body.textContent).toContain(
      "About 10,050 rows would add about 10,055 changes to an app, and one addition holds at most 10,000. This file can become a new app instead.",
    );
    expect(queryAll<HTMLInputElement>('input[type="radio"]')[1]?.disabled).toBe(true);
  });
});

describe("SCR-020 — a workbook names the sheet being read", () => {
  const vm: ImportProgressVm = {
    screen: "SCR-020",
    step: "parsing",
    fileName: "fieldwork-q3.xlsx",
    phase: "parsing",
    rowsSoFar: 1_240,
    sheet: { ordinal: 3, count: 7, name: "Crew" },
    batchesCommitted: 4,
    cancellable: true,
    cancellationContract: "removes-every-committed-batch",
    announcement: "Importing fieldwork-q3.xlsx. Sheet 3 of 7: Crew. 1240 rows are durable so far.",
  };

  it("shows 'Sheet k of n · name' in text and in the progress region's name, and no percentage", async () => {
    await render(<ImportProgressScreen nav={nav} onCancel={noop} vm={vm} />);
    expect(document.body.textContent).toContain("Sheet 3 of 7");
    expect(query("h2").textContent).toBe("Crew");
    expect(query('[role="progressbar"]').getAttribute("aria-label")).toBe(
      "Reading rows and committing them in batches · Sheet 3 of 7: Crew",
    );
    expect(document.body.textContent).toContain("1,240 rows are durable");
    expect(document.body.textContent).not.toMatch(/\d+%/u);
  });
});

describe("SCR-022 / MOD-008 — a streamed failure names stage, sheet and diagnostic", () => {
  const vm: ImportEndedVm = {
    screen: "SCR-022",
    step: "failed",
    outcome: "failed",
    busy: false,
    fileName: "hostile-repeat.ods",
    reason: "parse-failed",
    detail: { stage: "sheet-stream", diagnostic: "expansion-limit", sheet: { ordinal: 1, count: 1, name: "Sheet1" } },
    cleanup: { kind: "removed", deletedCount: 2, completed: true, reason: "import-failed" },
    announcement: "The import did not complete. No partial app remains.",
  };

  it("keeps the raw diagnostic token beside its user-language sentence", async () => {
    await render(
      <ImportFailedScreen
        acceptedFileTypes={WORKBOOK_FILE_EXTENSIONS}
        nav={nav}
        onReturnToLibrary={noop}
        onSelectFiles={noop}
        vm={vm}
      />,
    );
    const text = document.body.textContent;
    expect(query("h1").textContent).toBe("Sheet1 could not be read.");
    expect(text).toContain("Part of the file expands to far more data than its stored size. It stopped while reading sheet 1 of 1.");
    expect(text).toContain("Cell stream");
    expect(query("code").textContent).toBe("expansion-limit");
    expect(text).toContain("No partial app remains.");

    await interact(() => {
      buttonNamed("Details")?.click();
    });
    const dialog = query('[role="dialog"]');
    expect(dialog.textContent).toContain("Failed stage");
    expect(dialog.textContent).toContain("Sheet1");
    expect(dialog.textContent).toContain("expansion-limit");
  });
});
