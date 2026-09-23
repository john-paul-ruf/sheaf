import { useState, type ReactNode } from "react";
import type {
  SheetEstimateVm,
  WorkbookFormatVm,
  WorkbookHandoffVm,
  WorkbookPreflightVm,
  WorkbookSheetBadgeV1,
  WorkbookSheetRowVm,
} from "../../application/view-models/import.js";
import { Button } from "../primitives/button.js";
import { Checkbox } from "../primitives/checkbox.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { UnlockedFrame, type SecurityNavigation } from "../security/frames.js";
import { formatCount } from "./delimited-target-screen.js";
import { ImportStages } from "./import-stages.js";
import { describeBytes } from "./preflight-screens.js";
import {
  ChooseAnotherFileButton,
  type WorkbookPickerProps,
} from "./upload-screen.js";
import styles from "./import.module.css";

/**
 * SCR-018 and SCR-019 for a workbook (import.html, import-large.html; CAP-19,
 * CAP-20; D31, D39, D47), and MOD-004 for a format-level contradiction.
 *
 * **Sizing is visually its own stage, before any cell is read.** design.md
 * §Import and review: the checklist may show names and declared dimensions but
 * never implies cell content was read. Every count here is pre-flight's
 * estimate and is written "about" (D24); a count nothing declared says so and
 * is never written as 0.
 *
 * **The route is the report's.** Fits shows import.html's checklist; subset
 * shows import-large.html's smaller scope beside the desktop handoff; handoff
 * shows the handoff alone, because no single sheet fits and there is nothing
 * to start. A selection over the budget is offered as a reason, not a start.
 *
 * **What the mocks show that this release does not have is absent.**
 * import-large.html's five-budget panel and capacity link are F07's;
 * import.html's "adopt the finished app through its durable home" tip needs
 * F05/F06's durable homes. A dead instruction is the same defect as a dead
 * control, so neither is drawn.
 */

/** The formats pre-flight identifies, named for a person. */
export const WORKBOOK_FORMAT_NAME: Readonly<Record<WorkbookFormatVm, string>> = Object.freeze({
  xlsx: "Excel workbook",
  xlsb: "Excel binary workbook",
  xls: "Legacy Excel workbook",
  ods: "OpenDocument spreadsheet",
  "html-table": "HTML table saved as a spreadsheet",
});

/** import.html's badges, verbatim. */
const BADGE: Readonly<Record<WorkbookSheetBadgeV1, string>> = Object.freeze({
  use: "Use",
  inspect: "Inspect",
  dashboard: "Dashboard",
  excluded: "Excluded",
});

/**
 * An estimate, written the only way it may be (D24): "about N", or "size not
 * declared" when nothing declared one. There is no branch that prints a bare
 * number, because `SheetEstimateVm` has no exact member.
 */
export function describeEstimate(
  estimate: SheetEstimateVm,
  singular: string,
  plural: string,
): string {
  if (estimate.kind === "not-declared") return "size not declared";
  return `about ${formatCount(estimate.value)} ${estimate.value === 1 ? singular : plural}`;
}

const capitalized = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** import.html's checklist line, composed from the sheet's declarations. */
export function describeSheet(sheet: WorkbookSheetRowVm): string {
  const rows = describeEstimate(sheet.rows, "row", "rows");
  const line = !sheet.isSelected
    ? `${capitalized(rows)} · preserved if selected`
    : sheet.shape === "declared-table"
      ? `Declared table · ${rows}`
      : sheet.shape === "table-region"
        ? `Table region · ${rows}`
        : `Charts and summary values · ${describeEstimate(sheet.cells, "used cell", "used cells")}`;
  return sheet.isHidden ? `${line} · hidden` : line;
}

export function describeContradiction(vm: WorkbookPreflightVm): string | null {
  const { contradiction } = vm;
  return contradiction === null
    ? null
    : `This file is named “.${contradiction.declaredExtension}”, but its content is ${
        WORKBOOK_FORMAT_NAME[contradiction.detectedFormat]
      } content. Sheaf goes by the content.`;
}

function sheetsWord(count: number): string {
  return count === 1 ? "1 sheet" : `${formatCount(count)} sheets`;
}

export interface WorkbookPreflightScreenProps extends WorkbookPickerProps {
  readonly vm: WorkbookPreflightVm;
  readonly nav: SecurityNavigation;
  readonly onToggleSheet: (sheetIndex: number) => void;
  readonly onClearAll: () => void;
  readonly onStart: () => void;
  /** Leaves the pre-flight for the upload landing; nothing was staged. */
  readonly onCancel: () => void;
  readonly onCopyHandoff: () => void;
  readonly topBarActions?: ReactNode;
}

export function WorkbookPreflightScreen({
  vm,
  nav,
  onToggleSheet,
  onClearAll,
  onStart,
  onCancel,
  onCopyHandoff,
  acceptedFileTypes,
  onSelectFiles,
  topBarActions,
}: WorkbookPreflightScreenProps): ReactNode {
  const [contradictionOpen, setContradictionOpen] = useState(vm.contradiction !== null);
  const fits = vm.step === "workbookFits";
  const contradiction = describeContradiction(vm);

  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="library"
      nav={nav}
      title={fits ? "Pre-flight" : "Workbook exceeds this device"}
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen={vm.screen}>
        <ImportStages current="size" />

        {fits ? (
          <div className={cx(styles["intro"])}>
            <span className={cx(styles["eyebrow"])}>Before cell data is read</span>
            <h1 className={cx(styles["title"])}>This workbook fits this device.</h1>
            <p className={cx(styles["lede"])}>
              Choose what to bring in. Sheaf sized the workbook from its declared
              structure—not its cell contents.
            </p>
          </div>
        ) : (
          <div className={cx(styles["intro"])}>
            <span className={cx(styles["eyebrow"])}>Pre-flight · before cell parsing</span>
            <h1 className={cx(styles["title"])}>This workbook is too large for this device.</h1>
            <p className={cx(styles["lede"])}>
              Sheaf inspected workbook metadata only. No cell payload has been
              parsed and no partial app exists.
            </p>
          </div>
        )}

        {contradiction !== null && (
          <StatusBanner title="The name and the content disagree" tone="warning">
            {contradiction}
          </StatusBanner>
        )}

        <section className={cx(styles["card"])}>
          <div className={cx(styles["cardHead"])}>
            <h2 className={cx(styles["cardTitle"])}>{vm.fileName}</h2>
            {vm.contradiction === null && vm.declaredExtension !== null && (
              <span className={cx(styles["badge"])}>
                Content matches .{vm.declaredExtension}
              </span>
            )}
          </div>
          <p className={cx(styles["lede"])}>
            {`${describeBytes(vm.sourceByteLength)} · ${WORKBOOK_FORMAT_NAME[vm.format]}`}
          </p>

          {fits ? (
            <StatusBanner title="Comfortable fit" tone="success">
              {`${capitalized(describeEstimate(vm.selection.estimatedRows, "row", "rows"))} across ${sheetsWord(
                vm.selection.selectedCount,
              )} will be imported.`}
            </StatusBanner>
          ) : (
            <StatusBanner title="Over this device's import limit" tone="warning">
              {`The whole workbook is estimated at ${describeEstimate(
                vm.workbookEstimatedCells,
                "cell",
                "cells",
              )}. This release imports up to ${formatCount(
                vm.selection.maxEstimatedCells,
              )} cells across the selected sheets. The workbook remains untouched.`}
            </StatusBanner>
          )}
        </section>

        {vm.step !== "workbookHandoff" && (
          <SheetSelection onClearAll={onClearAll} onToggleSheet={onToggleSheet} vm={vm} />
        )}

        {vm.drawingNotices.map((notice) => (
          <StatusBanner
            key={notice.sheetName}
            title={
              notice.drawingCount === 1
                ? "1 drawing object may remain read-only"
                : `${formatCount(notice.drawingCount)} drawing objects may remain read-only`
            }
            tone="info"
          >
            {`They will be preserved in the “${notice.sheetName}” sheet snapshot and named during review. Sheaf will not imply they became interactive.`}
          </StatusBanner>
        ))}

        {vm.step !== "workbookHandoff" && <StreamPlan onStart={onStart} vm={vm} />}

        {vm.handoff !== null && <HandoffCard handoff={vm.handoff} onCopy={onCopyHandoff} />}

        <div className={cx(styles["actions"])}>
          <ChooseAnotherFileButton
            acceptedFileTypes={acceptedFileTypes}
            onSelectFiles={onSelectFiles}
            tone="secondary"
          />
        </div>

        <Dialog
          footer={
            <>
              <Button
                onPress={() => {
                  setContradictionOpen(false);
                  onCancel();
                }}
              >
                Cancel
              </Button>
              <Button
                onPress={() => {
                  setContradictionOpen(false);
                }}
                tone="primary"
              >
                Continue
              </Button>
            </>
          }
          isOpen={contradictionOpen}
          onOpenChange={setContradictionOpen}
          title="Content/extension mismatch"
        >
          <p>{contradiction}</p>
          <p>Nothing has been read beyond the workbook's own declarations.</p>
        </Dialog>
      </div>
    </UnlockedFrame>
  );
}

function SheetSelection({
  vm,
  onToggleSheet,
  onClearAll,
}: {
  readonly vm: WorkbookPreflightVm;
  readonly onToggleSheet: (sheetIndex: number) => void;
  readonly onClearAll: () => void;
}): ReactNode {
  const fits = vm.step === "workbookFits";
  const { selection } = vm;

  return (
    <section aria-labelledby="sheet-selection" className={cx(styles["card"])}>
      <div className={cx(styles["cardHead"])}>
        <div className={cx(styles["intro"])}>
          {!fits && <span className={cx(styles["extensions"])}>Choose a smaller scope</span>}
          <h2 className={cx(styles["cardTitle"])} id="sheet-selection">
            {fits ? "Sheets to import" : sheetsWord(selection.sheetCount)}
          </h2>
        </div>
        <span className={cx(styles["badge"])}>
          {`${formatCount(selection.selectedCount)} of ${formatCount(selection.sheetCount)} selected`}
        </span>
      </div>
      {!fits && selection.selectedCount > 0 && (
        <div className={cx(styles["actions"])}>
          <Button onPress={onClearAll}>Clear all</Button>
        </div>
      )}
      <ul className={cx(styles["sheetList"])}>
        {vm.sheets.map((sheet) => (
          <li key={sheet.sheetIndex}>
            <Checkbox
              isSelected={sheet.isSelected}
              onChange={() => {
                onToggleSheet(sheet.sheetIndex);
              }}
            >
              <span className={cx(styles["sheetRow"])}>
                <span className={cx(styles["sheetName"])}>{sheet.name}</span>
                <span className={cx(styles["badge"])}>{BADGE[sheet.badge]}</span>
              </span>
              <span className={cx(styles["note"])}>{describeSheet(sheet)}</span>
            </Checkbox>
          </li>
        ))}
      </ul>
      {!fits && <ScopeStatus vm={vm} />}
    </section>
  );
}

/** import-large.html's "Selected scope fits" line, from the real estimate. */
function ScopeStatus({ vm }: { readonly vm: WorkbookPreflightVm }): ReactNode {
  const { selection } = vm;
  switch (selection.blocker) {
    case null:
      return (
        <StatusBanner title="Selected scope fits" tone="success">
          {`About ${formatCount(selection.estimatedCells)} cells estimated. Unselected sheets are not imported and remain in the source workbook.`}
        </StatusBanner>
      );
    case "over-budget":
      return (
        <StatusBanner title="Selected scope is still too large" tone="warning">
          {`About ${formatCount(selection.estimatedCells)} cells estimated. This release imports up to ${formatCount(
            selection.maxEstimatedCells,
          )} cells.`}
        </StatusBanner>
      );
    case "nothing-selected":
      return (
        <StatusBanner title="No sheet is selected" tone="info">
          Select at least one sheet to import.
        </StatusBanner>
      );
  }
}

function startReason(vm: WorkbookPreflightVm): string {
  return vm.selection.blocker === "over-budget"
    ? "The selected sheets are more than this device imports. Leave some out."
    : "Select at least one sheet to import.";
}

/** import.html's stream plan: what has happened, what has not, and the start. */
function StreamPlan({
  vm,
  onStart,
}: {
  readonly vm: WorkbookPreflightVm;
  readonly onStart: () => void;
}): ReactNode {
  const label = `Import ${formatCount(vm.selection.selectedCount)} selected ${
    vm.selection.selectedCount === 1 ? "sheet" : "sheets"
  }`;
  return (
    <section aria-labelledby="stream-plan" className={cx(styles["card"])}>
      <span className={cx(styles["extensions"])}>Stream plan</span>
      <h2 className={cx(styles["cardTitle"])} id="stream-plan">
        {`Ready to import ${sheetsWord(vm.selection.selectedCount)}`}
      </h2>
      <dl className={cx(styles["facts"])}>
        <dt>Pre-flight sizing</dt>
        <dd>Complete</dd>
        <dt>Cell parsing</dt>
        <dd>Not started</dd>
      </dl>
      <StatusBanner title="During import" tone="info">
        Progress names the sheet being read. Cancel leaves no partial app.
      </StatusBanner>
      <div className={cx(styles["actions"])}>
        {vm.canStart ? (
          <Button onPress={onStart} tone="primary">
            {label}
          </Button>
        ) : (
          <Button disabledReason={startReason(vm)} isDisabled tone="primary">
            {label}
          </Button>
        )}
      </div>
      <p className={cx(styles["note"])}>
        Runs locally. The workbook is not uploaded to Sheaf.
      </p>
    </section>
  );
}

/** import-large.html's desktop handoff, with the copy's real result (D31, D43). */
function HandoffCard({
  handoff,
  onCopy,
}: {
  readonly handoff: WorkbookHandoffVm;
  readonly onCopy: () => void;
}): ReactNode {
  return (
    <section aria-labelledby="handoff" className={cx(styles["card"])}>
      <span className={cx(styles["extensions"])}>Use a larger device</span>
      <h2 className={cx(styles["cardTitle"])} id="handoff">
        Import everything on desktop.
      </h2>
      <p className={cx(styles["lede"])}>
        No work is transferred automatically. Open this same source file in
        Sheaf on a device with a larger local budget.
      </p>
      <div className={cx(styles["actions"])}>
        <Button onPress={onCopy}>Copy handoff instructions</Button>
      </div>
      {handoff.copy === "copied" && (
        <StatusBanner title="Handoff instructions copied" tone="success">
          Paste them wherever you will read them on the other device.
        </StatusBanner>
      )}
      {handoff.copy === "unavailable" && (
        <StatusBanner title="This browser did not allow copying" tone="info">
          <pre className={cx(styles["instructions"])}>{handoff.instructions}</pre>
        </StatusBanner>
      )}
    </section>
  );
}
