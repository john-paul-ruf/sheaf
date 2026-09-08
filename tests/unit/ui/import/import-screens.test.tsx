import { describe, expect, it, vi } from "vitest";
import type {
  DelimitedTargetVm,
  ImportEndedVm,
  ImportFitsVm,
  ImportOverBudgetVm,
  ImportProgressVm,
  ImportRefusedVm,
  RefusalCopyTokenV1,
  UploadLandingVm,
} from "../../../../src/application/view-models/import.js";
import { ROUTE_HREFS } from "../../../../src/routes/guards.js";
import { WORKBOOK_FILE_EXTENSIONS } from "../../../../src/platform/file-pick.js";
import { DelimitedTargetScreen } from "../../../../src/ui/import/delimited-target-screen.js";
import {
  ImportFailedScreen,
  describeCleanup,
} from "../../../../src/ui/import/import-failed-screen.js";
import {
  CANCELLATION_CONTRACT,
  ImportProgressScreen,
} from "../../../../src/ui/import/import-progress-screen.js";
import {
  ImportRefusedScreen,
  RELEASE_SCOPE,
} from "../../../../src/ui/import/import-refused-screen.js";
import {
  PreflightFitsScreen,
  PreflightOverBudgetScreen,
  describeBytes,
} from "../../../../src/ui/import/preflight-screens.js";
import { UploadScreen } from "../../../../src/ui/import/upload-screen.js";
import "../../../../src/ui/theme/base.css";
import { TARGET_MIN, interact, query, queryAll, render } from "../render.js";

/**
 * SCR-016–022 as rendered (CAP-09–CAP-11).
 *
 * The view models are built as literals rather than driven out of the machine:
 * what is under test is the *mapping from model to surface* — which token
 * becomes which sentence, which state may make which claim — and a shape
 * change upstream still fails here, at compile time, because every fixture is
 * typed by the model it stands for.
 */

const nav = ROUTE_HREFS;
const noop = (): void => undefined;

describe("SCR-016 — the upload landing says what this release reads", () => {
  const vm: UploadLandingVm = {
    screen: "SCR-016",
    step: "choosingFile",
    formats: [
      {
        id: "value-only",
        label: "Value-only",
        extensions: ["csv", "tsv"],
        availability: "available",
      },
      {
        id: "spreadsheet-structure",
        label: "Spreadsheet structure",
        extensions: ["xlsx", "xlsb", "xls", "ods"],
        availability: "later-release",
      },
    ],
    busy: false,
    phase: null,
    announcement: "Choose the workbook you already use.",
  };

  it("states D19 at the landing rather than only at the refusal", async () => {
    await render(
      <UploadScreen
        acceptedFileTypes={WORKBOOK_FILE_EXTENSIONS}
        nav={nav}
        onSelectFiles={noop}
        vm={vm}
      />,
    );

    expect(query('[data-screen="SCR-016"]')).toBeTruthy();
    expect(document.body.textContent).toContain("Read in this release");
    expect(document.body.textContent).toContain("Arrives in a later release");
    // upload.html's workbook promise is exactly what F02 does not do.
    expect(document.body.textContent).not.toContain(
      "formulas, and sheets are read where declared",
    );
    // No affordance is described that this release does not have.
    expect(document.body.textContent).not.toContain("drop a file here");
  });

  it("offers the refused formats too, so their refusal is reachable", async () => {
    await render(
      <UploadScreen
        acceptedFileTypes={WORKBOOK_FILE_EXTENSIONS}
        nav={nav}
        onSelectFiles={noop}
        vm={vm}
      />,
    );

    const input = query<HTMLInputElement>('input[type="file"]');
    const accept = input.getAttribute("accept") ?? "";
    for (const extension of [".csv", ".tsv", ".xlsx", ".numbers", ".pdf"]) {
      expect(accept).toContain(extension);
    }
  });

  it("names the parser's phase while it is detecting", async () => {
    await render(
      <UploadScreen
        acceptedFileTypes={WORKBOOK_FILE_EXTENSIONS}
        nav={nav}
        onSelectFiles={noop}
        vm={{ ...vm, step: "detecting", busy: true, phase: "sniffing" }}
      />,
    );
    expect(query('[role="progressbar"]')).toBeTruthy();
    expect(document.body.textContent).toContain(
      "Reading the first bytes to decide the format",
    );
  });
});

describe("SCR-017 — the delimited target keeps its estimate flagged", () => {
  const vm: DelimitedTargetVm = {
    screen: "SCR-017",
    step: "delimitedTarget",
    fileName: "field-log-messy.csv",
    delimiter: ",",
    encoding: "utf-8",
    columnCount: 9,
    rowCount: { kind: "estimated", value: 43 },
    contradiction: null,
    destinations: [
      { id: "new-app", label: "Create a new app", enabled: true },
      {
        id: "existing-app",
        label: "Add a table to an existing app",
        enabled: false,
        reason: "into-existing-app-not-available-in-this-release",
      },
    ],
    appName: "Field Log Messy",
    tableName: "Field Log Messy",
    appNameProblem: null,
    tableNameProblem: null,
    canContinue: true,
    announcement: "About 43 rows across 9 columns were detected.",
  };

  const screen = (
    overrides: Partial<DelimitedTargetScreenProps> = {},
  ): React.ReactElement => (
    <DelimitedTargetScreen
      nav={nav}
      onChooseAnotherFile={noop}
      onContinue={noop}
      onSetAppName={noop}
      onSetTableName={noop}
      vm={vm}
      {...overrides}
    />
  );

  it("writes the estimate as an estimate and never claims a header (D24)", async () => {
    await render(screen());
    expect(query('[data-screen="SCR-017"]')).toBeTruthy();
    expect(document.body.textContent).toContain("About 43 rows");
    expect(document.body.textContent).not.toContain("+ header");
    expect(document.body.textContent).toContain("Comma");
    expect(document.body.textContent).toContain("UTF-8");
  });

  it("offers the second destination disabled, with D18's reason in text", async () => {
    await render(screen());
    const radios = queryAll<HTMLInputElement>('input[type="radio"]');
    expect(radios).toHaveLength(2);
    expect(radios[1]?.disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "Adding a table to an existing app is not available in this release.",
    );
  });

  it("states MOD-004's contradiction and still goes by the content", async () => {
    await render(
      screen({
        vm: {
          ...vm,
          contradiction: {
            declaredExtension: "xlsx",
            expectedKind: "zip-container",
            detectedKind: "delimited",
          },
        },
      }),
    );
    expect(document.body.textContent).toContain("named “.xlsx”");
    expect(document.body.textContent).toContain("Sheaf goes by the content.");
  });

  it("refuses to continue without names, and says which", async () => {
    await render(
      screen({
        vm: {
          ...vm,
          appName: "",
          appNameProblem: "required",
          canContinue: false,
        },
      }),
    );
    const submit = queryAll("button").find(
      (button) => button.textContent === "Check size first",
    );
    expect(submit?.hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).toContain("Enter a name.");
  });

  it("leaves validation to the worker's typed refusals (F01 S07 lesson)", async () => {
    await render(screen());
    expect(query("form").hasAttribute("novalidate")).toBe(true);
  });
});

type DelimitedTargetScreenProps = Parameters<typeof DelimitedTargetScreen>[0];

describe("SCR-018 / SCR-019 — the size answer (D20)", () => {
  const fits: ImportFitsVm = {
    screen: "SCR-018",
    step: "fits",
    fileName: "field-log-messy.csv",
    sourceByteLength: 4096,
    columnCount: 9,
    rowCount: { kind: "estimated", value: 43 },
    fits: true,
    announcement: "This file fits this device.",
  };

  const over: ImportOverBudgetVm = {
    screen: "SCR-019",
    step: "overBudget",
    fileName: "huge.csv",
    exceeded: "source-bytes",
    sourceByteLength: 78_643_200,
    maxSourceByteLength: 52_428_800,
    estimatedCellCount: 900_000,
    maxEstimatedCellCount: 250_000,
    remedy: "use-larger-device",
    libraryUnchanged: true,
    announcement: "This file is too large for this device.",
  };

  it("fits: says there is nothing to select, because there is one table", async () => {
    await render(
      <PreflightFitsScreen
        nav={nav}
        onBack={noop}
        onStart={noop}
        vm={fits}
      />,
    );
    expect(query('[data-screen="SCR-018"]')).toBeTruthy();
    expect(document.body.textContent).toContain("About 43 rows");
    expect(document.body.textContent).toContain(
      "This file is one table, so there is nothing to select.",
    );
    // The mock's per-sheet checklist has no delimited meaning.
    expect(document.body.textContent).not.toContain("Sheets to import");
  });

  it("over budget: carries the real numbers, both ways it can be exceeded", async () => {
    const { rerender } = await render(
      <PreflightOverBudgetScreen
        nav={nav}
        onChooseAnotherFile={noop}
        vm={over}
      />,
    );
    expect(query('[data-screen="SCR-019"]')).toBeTruthy();
    expect(document.body.textContent).toContain(describeBytes(78_643_200));
    expect(document.body.textContent).toContain(describeBytes(52_428_800));
    expect(document.body.textContent).toContain("The library is unchanged.");

    await rerender(
      <PreflightOverBudgetScreen
        nav={nav}
        onChooseAnotherFile={noop}
        vm={{ ...over, exceeded: "estimated-cells" }}
      />,
    );
    expect(document.body.textContent).toContain("About 900,000 cells");
    expect(document.body.textContent).toContain("up to 250,000 cells");
  });

  it("over budget: offers no sheet subset and no capacity detail (F03/F07)", async () => {
    await render(
      <PreflightOverBudgetScreen
        nav={nav}
        onChooseAnotherFile={noop}
        vm={over}
      />,
    );
    expect(document.body.textContent).not.toContain("Open capacity detail");
    expect(document.body.textContent).not.toContain("Choose a smaller scope");
    expect(document.body.textContent).toContain("Use a larger device");
  });
});

describe("SCR-020 — progress states what it knows, and MOD-007 asks first", () => {
  const vm: ImportProgressVm = {
    screen: "SCR-020",
    step: "parsing",
    fileName: "field-log-messy.csv",
    phase: "parsing",
    rowsSoFar: 1024,
    batchesCommitted: 1,
    cancellable: true,
    cancellationContract: "removes-every-committed-batch",
    announcement: "Importing field-log-messy.csv.",
  };

  it("shows durable rows and no percentage, because there is no total", async () => {
    await render(
      <ImportProgressScreen nav={nav} onCancel={noop} vm={vm} />,
    );
    expect(query('[data-screen="SCR-020"]')).toBeTruthy();
    expect(document.body.textContent).toContain("1,024 rows are durable");
    expect(document.body.textContent).not.toContain("%");
    const bar = query('[role="progressbar"]');
    expect(bar.getAttribute("aria-valuenow")).toBeNull();
  });

  it("confirms the cancellation contract before it cancels anything", async () => {
    const onCancel = vi.fn();
    await render(
      <ImportProgressScreen nav={nav} onCancel={onCancel} vm={vm} />,
    );

    await interact(() => {
      queryAll("button")
        .find((button) => button.textContent === "Cancel import…")
        ?.click();
    });

    const dialog = query('[role="alertdialog"]');
    expect(dialog.textContent).toContain(CANCELLATION_CONTRACT);
    expect(onCancel).not.toHaveBeenCalled();

    await interact(() => {
      queryAll("button")
        .find((button) => button.textContent === "Cancel import")
        ?.click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("states why cancelling is unavailable rather than offering a dead control", async () => {
    await render(
      <ImportProgressScreen
        nav={nav}
        onCancel={noop}
        vm={{ ...vm, step: "beginningStage", cancellable: false }}
      />,
    );
    const cancel = queryAll("button").find(
      (button) => button.textContent === "Cancel import…",
    );
    expect(cancel?.hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).toContain(
      "This step cannot be cancelled; it finishes on its own.",
    );
  });
});

describe("SCR-021 — every refusal names the file and ends somewhere real", () => {
  function refused(
    refusal: RefusalCopyTokenV1,
    laterReleaseFormat: string | null = null,
  ): ImportRefusedVm {
    return {
      screen: "SCR-021",
      step: "refused",
      fileName: "quarterly.pdf",
      refusal,
      remedy: "pdf-export-from-source",
      laterReleaseFormat,
      libraryUnchanged: true,
      announcement: "quarterly.pdf cannot become a Sheaf app.",
    };
  }

  const TOKENS: readonly RefusalCopyTokenV1[] = [
    "macro-content",
    "numbers-file",
    "pages-file",
    "pdf-file",
    "workbook-format-later-release",
    "binary-unreadable",
  ];

  it.each(TOKENS)("%s renders its own card, the file, and the scope", async (
    token,
  ) => {
    await render(
      <ImportRefusedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={refused(token)}
      />,
    );
    expect(query('[data-screen="SCR-021"]')).toBeTruthy();
    expect(query("[data-refusal]").getAttribute("data-refusal")).toBe(token);
    expect(document.body.textContent).toContain("quarterly.pdf");
    expect(document.body.textContent).toContain(
      "The refusal is whole-file. Nothing partial was added to the library.",
    );
    // Every remedy is followed by what this release can actually read.
    expect(document.body.textContent).toContain(RELEASE_SCOPE);
  });

  it("names the workbook family D19 refused, from the refusal not the name", async () => {
    const { rerender } = await render(
      <ImportRefusedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={refused("workbook-format-later-release", "ooxml")}
      />,
    );
    expect(document.body.textContent).toContain("an Excel workbook (.xlsx)");
    expect(document.body.textContent).toContain(
      "Export the sheet you need as CSV or TSV.",
    );

    await rerender(
      <ImportRefusedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={refused("workbook-format-later-release", "ods")}
      />,
    );
    expect(document.body.textContent).toContain(
      "an OpenDocument spreadsheet (.ods)",
    );
  });

  it("keeps the approved per-format instructions for Numbers, Pages and PDF", async () => {
    const { rerender } = await render(
      <ImportRefusedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={refused("pdf-file")}
      />,
    );
    expect(document.body.textContent).toContain(
      "Return to the spreadsheet that produced the PDF and export XLSX or delimited text.",
    );

    await rerender(
      <ImportRefusedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={refused("pages-file")}
      />,
    );
    expect(document.body.textContent).toContain(
      "Copy tabular data into Numbers or Excel and export as XLSX, CSV, or TSV.",
    );
  });
});

describe("SCR-022 — what was left behind is a receipt, not a hope", () => {
  function ended(overrides: Partial<ImportEndedVm> = {}): ImportEndedVm {
    return {
      screen: "SCR-022",
      step: "cancelled",
      outcome: "cancelled",
      busy: false,
      fileName: "large-sample.csv",
      reason: null,
      cleanup: {
        kind: "removed",
        deletedCount: 3,
        completed: true,
        reason: "user-cancelled",
      },
      announcement: "You cancelled the import.",
      ...overrides,
    };
  }

  it("claims 'no partial app remains' only with a receipt", async () => {
    const { rerender } = await render(
      <ImportFailedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={ended()}
      />,
    );
    expect(query('[data-screen="SCR-022"]')).toBeTruthy();
    expect(document.body.textContent).toContain("You cancelled the import.");
    expect(document.body.textContent).toContain("No partial app remains.");
    expect(document.body.textContent).toContain("3 staged items were removed");

    // MOD-007: an unconfirmed cleanup must not borrow that sentence.
    await rerender(
      <ImportFailedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={ended({ cleanup: { kind: "unconfirmed" } })}
      />,
    );
    expect(document.body.textContent).not.toContain("No partial app remains");
    expect(document.body.textContent).toContain(
      "Sheaf could not confirm the cleanup.",
    );

    await rerender(
      <ImportFailedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={ended({ cleanup: { kind: "nothing-to-remove" } })}
      />,
    );
    expect(document.body.textContent).not.toContain("No partial app remains");
    expect(document.body.textContent).toContain("Nothing had been written.");
  });

  it("keeps a cancel free of a diagnostic, and gives a failure one", async () => {
    const { rerender } = await render(
      <ImportFailedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={ended()}
      />,
    );
    expect(document.body.textContent).not.toContain("could not be imported");

    await rerender(
      <ImportFailedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={ended({
          step: "failed",
          outcome: "failed",
          reason: "stage-missing",
          announcement: "The import did not complete.",
        })}
      />,
    );
    expect(document.body.textContent).toContain(
      "large-sample.csv could not be imported.",
    );
    expect(document.body.textContent).toContain(
      "The staged import is no longer on this device",
    );
  });

  it("offers MOD-008's details: file, stage, cleanup fact", async () => {
    await render(
      <ImportFailedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={ended({ step: "failed", outcome: "failed", reason: "parse-failed" })}
      />,
    );

    await interact(() => {
      queryAll("button")
        .find((button) => button.textContent === "Details")
        ?.click();
    });

    const dialog = query('[role="dialog"]');
    expect(dialog.textContent).toContain("large-sample.csv");
    expect(dialog.textContent).toContain(
      "The file could not be read all the way through.",
    );
    expect(dialog.textContent).toContain(
      describeCleanup({
        kind: "removed",
        deletedCount: 3,
        completed: true,
        reason: "user-cancelled",
      }),
    );
  });

  it("offers 'retry same file' only when the page still holds one", async () => {
    const retry = vi.fn();
    const { rerender } = await render(
      <ImportFailedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={ended()}
      />,
    );
    expect(
      queryAll("button").some((b) => b.textContent === "Retry same file"),
    ).toBe(false);

    await rerender(
      <ImportFailedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onRetrySameFile={retry}
        onReturnToLibrary={noop}
        vm={ended()}
      />,
    );
    await interact(() => {
      queryAll("button")
        .find((button) => button.textContent === "Retry same file")
        ?.click();
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("claims nothing at all while the cleanup is still running", async () => {
    await render(
      <ImportFailedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={ended({ step: "cancelling", busy: true })}
      />,
    );
    expect(document.body.textContent).not.toContain("No partial app remains");
    expect(document.body.textContent).toContain(
      "Nothing is claimed until that is confirmed.",
    );
  });
});

describe("every import action meets the minimum hit area", () => {
  it("SCR-021's actions are at least 44px tall", async () => {
    await render(
      <ImportRefusedScreen
        nav={nav}
        onChooseAnotherFile={noop}
        onReturnToLibrary={noop}
        vm={{
          screen: "SCR-021",
          step: "refused",
          fileName: "budget.numbers",
          refusal: "numbers-file",
          remedy: "numbers-export-xlsx",
          laterReleaseFormat: null,
          libraryUnchanged: true,
          announcement: "budget.numbers cannot become a Sheaf app.",
        }}
      />,
    );
    const buttons = queryAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(getComputedStyle(button).minHeight).toBe(TARGET_MIN);
    }
  });
});
