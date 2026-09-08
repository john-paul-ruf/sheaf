import type { ReactNode } from "react";
import type {
  ImportFitsVm,
  ImportOverBudgetVm,
} from "../../application/view-models/import.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { UnlockedFrame, type SecurityNavigation } from "../security/frames.js";
import { describeRowCount, formatCount } from "./delimited-target-screen.js";
import { ImportStages } from "./import-stages.js";
import {
  ChooseAnotherFileButton,
  type WorkbookPickerProps,
} from "./upload-screen.js";
import styles from "./import.module.css";

/**
 * SCR-018 and SCR-019, delimited variants (import.html, import-large.html; D20).
 *
 * **Both mocks are workbook screens; one table is not a workbook.** import.html
 * offers a per-sheet checklist and import-large.html offers a smaller *scope*
 * to select. A delimited file is exactly one table, so there is nothing to
 * sub-select — and `ImportFitsVm`/`ImportOverBudgetVm` carry no sheet field, so
 * the absence is held by the type rather than by this file remembering. What
 * replaces the checklist is the fact that makes it unnecessary, stated.
 *
 * **The over-budget card carries real numbers.** import-large.html's "2.7 GB
 * against a 620 MB budget" is sample data; SCR-019 renders the measurement
 * that actually refused this file and the F02 ceiling it crossed (D20). The
 * mock's five-budget panel and its capacity-detail link are absent: the five
 * independent budgets are F07's, and a link to a screen that does not exist is
 * a dead control.
 *
 * **Nothing was parsed.** Both screens are pre-flight, so neither may imply a
 * cell was read; `libraryUnchanged` is a literal `true` on the refusal type
 * because there is no state in which it could be false here (FR-2).
 */

const KIBI = 1024;

/** Bytes as a person reads them. Exact below 1 KiB; one decimal above. */
export function describeBytes(bytes: number): string {
  if (bytes < KIBI) {
    return bytes === 1 ? "1 byte" : `${String(bytes)} bytes`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / KIBI;
  let unit = 0;
  while (value >= KIBI && unit < units.length - 1) {
    value /= KIBI;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? "KB"}`;
}

export interface PreflightFitsScreenProps {
  readonly vm: ImportFitsVm;
  readonly nav: SecurityNavigation;
  readonly onStart: () => void;
  readonly onBack: () => void;
  readonly topBarActions?: ReactNode;
}

export function PreflightFitsScreen({
  vm,
  nav,
  onStart,
  onBack,
  topBarActions,
}: PreflightFitsScreenProps): ReactNode {
  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="library"
      nav={nav}
      title="Pre-flight"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-018">
        <ImportStages current="size" />

        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>
            Before cell data is read
          </span>
          <h1 className={cx(styles["title"])}>This file fits this device.</h1>
          <p className={cx(styles["lede"])}>
            Sheaf sized this file from a bounded sample of its bytes, not from
            its cell contents.
          </p>
        </div>

        <section className={cx(styles["card"])}>
          <h2 className={cx(styles["cardTitle"])}>{vm.fileName}</h2>
          <dl className={cx(styles["facts"])}>
            <dt>Size</dt>
            <dd>{describeBytes(vm.sourceByteLength)}</dd>
            <dt>Rows</dt>
            <dd>{describeRowCount(vm.rowCount)}</dd>
            <dt>Columns</dt>
            <dd>{vm.columnCount}</dd>
          </dl>
          <StatusBanner title="Comfortable fit" tone="success">
            {`${describeRowCount(vm.rowCount)} across ${String(
              vm.columnCount,
            )} columns will be imported.`}{" "}
            This file is one table, so there is nothing to select.
          </StatusBanner>
        </section>

        <StatusBanner title="During import" tone="info">
          Progress names how many rows are already durable. Cancel leaves no
          partial app.
        </StatusBanner>

        <div className={cx(styles["actions"])}>
          <Button onPress={onStart} tone="primary">
            Import this table
          </Button>
          <Button onPress={onBack}>Back</Button>
        </div>
        <p className={cx(styles["note"])}>
          Runs locally. The file is not uploaded to Sheaf.
        </p>
      </div>
    </UnlockedFrame>
  );
}

/** D20's composed measurement sentence, from the numbers that refused it. */
export function describeOverBudget(vm: ImportOverBudgetVm): string {
  return vm.exceeded === "source-bytes"
    ? `This file is ${describeBytes(
        vm.sourceByteLength,
      )}. This release imports files up to ${describeBytes(
        vm.maxSourceByteLength,
      )}.`
    : `About ${formatCount(
        vm.estimatedCellCount,
      )} cells were estimated. This release imports up to ${formatCount(
        vm.maxEstimatedCellCount,
      )} cells.`;
}

export interface PreflightOverBudgetScreenProps extends WorkbookPickerProps {
  readonly vm: ImportOverBudgetVm;
  readonly nav: SecurityNavigation;
  readonly topBarActions?: ReactNode;
}

export function PreflightOverBudgetScreen({
  vm,
  nav,
  acceptedFileTypes,
  onSelectFiles,
  topBarActions,
}: PreflightOverBudgetScreenProps): ReactNode {
  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="library"
      nav={nav}
      title="File exceeds this device"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-019">
        <ImportStages current="size" />

        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>
            Pre-flight · before cell parsing
          </span>
          <h1 className={cx(styles["title"])}>
            This file is too large for this device.
          </h1>
          <p className={cx(styles["lede"])}>
            Sheaf read a bounded sample only. No cell data has been parsed and
            no partial app exists.
          </p>
        </div>

        <StatusBanner title="Over this device's import limit" tone="warning">
          {describeOverBudget(vm)} The library is unchanged.
        </StatusBanner>

        <section className={cx(styles["card"])}>
          <h2 className={cx(styles["cardTitle"])}>Use a larger device</h2>
          <p className={cx(styles["lede"])}>
            No work is transferred automatically. Open this same source file in
            Sheaf on a device with a larger local budget.
          </p>
          <dl className={cx(styles["facts"])}>
            <dt>File</dt>
            <dd>{vm.fileName}</dd>
            <dt>Size</dt>
            <dd>{describeBytes(vm.sourceByteLength)}</dd>
            <dt>Estimated cells</dt>
            <dd>{`About ${formatCount(vm.estimatedCellCount)}`}</dd>
          </dl>
        </section>

        <div className={cx(styles["actions"])}>
          <ChooseAnotherFileButton
            acceptedFileTypes={acceptedFileTypes}
            onSelectFiles={onSelectFiles}
          />
        </div>
      </div>
    </UnlockedFrame>
  );
}
