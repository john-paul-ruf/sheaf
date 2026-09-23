import type { FormEvent, ReactNode } from "react";
import { Label, Radio, RadioGroup } from "react-aria-components";
import type {
  AppendEstimateVm,
  DelimitedTargetVm,
  FormatContradictionVm,
  ImportDestinationOptionVm,
  ImportRowCountVm,
  NameProblemVm,
} from "../../application/view-models/import.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { TextField } from "../primitives/text-field.js";
import { UnlockedFrame, type SecurityNavigation } from "../security/frames.js";
import {
  ChooseAnotherFileButton,
  type WorkbookPickerProps,
} from "./upload-screen.js";
import styles from "./import.module.css";

/**
 * SCR-017 — the delimited table target (delimited-import.html, CAP-10, FR-1).
 *
 * **"About N rows", not "N + header" (D24).** delimited-import.html writes
 * "Rows declared: 4,806 + header", which claims two things pre-flight cannot
 * know: an exact count, and that row one is a header. Pre-flight read a
 * bounded sample and the header row is inference's *finding* at review, so the
 * count renders as the estimate it is and the header question waits for the
 * screen that can answer it (S03 followUp 7).
 *
 * **"Add a table to an existing app" is on when it can finish (D38).** It
 * needs an app on this device and a file whose estimate fits the one commit an
 * append is; otherwise it is offered off with the fact that turned it off. The
 * app list is a CTL-044 radio list nested under it, because the mock's
 * destination is already a radio choice and one app is chosen from several.
 *
 * **MOD-004 states the contradiction; content still decides.** A name that
 * disagrees with the bytes is reported here as a fact about the name — the
 * format was already decided from content (FR-1) and is not up for a vote.
 *
 * CTL-044 (radio choice, with its disabled state) has no M38 wrapper yet, so
 * the groups are composed from React Aria here; the control contract —
 * visible label, reason in text, 44px target — is met by this module's own
 * rules.
 */

/** The delimiters S03 can detect, named. An unknown value is shown verbatim. */
const DELIMITER_NAME: Readonly<Record<string, string>> = Object.freeze({
  ",": "Comma",
  "\t": "Tab",
  ";": "Semicolon",
  "|": "Pipe",
});

const ENCODING_NAME: Readonly<Record<string, string>> = Object.freeze({
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16 (little-endian)",
  "utf-16be": "UTF-16 (big-endian)",
  "windows-1252": "Windows-1252",
});

const DESTINATION_HINT: Readonly<
  Record<ImportDestinationOptionVm["id"], string>
> = Object.freeze({
  // delimited-import.html, verbatim.
  "new-app": "Start a new app with one table.",
  "existing-app":
    "Append values as a new table; never merge them into an existing table.",
});

/**
 * Why the append is off, in the Content Patterns' facts-then-remedy voice.
 * The too-large reason is composed from D38's real arithmetic (D43): the
 * estimate stays an estimate, and the cap is the segment's.
 */
export function describeDestinationReason(
  reason: NonNullable<ImportDestinationOptionVm["reason"]>,
  estimate: AppendEstimateVm,
): string {
  switch (reason) {
    case "listing-local-apps":
      return "Checking which apps are on this device.";
    case "local-apps-not-listed":
      return "Sheaf could not list the apps on this device, so this is off.";
    case "no-local-apps":
      return "There is no app on this device to add a table to yet.";
    case "too-large-to-append":
      return `${describeRowCount(estimate.estimatedRows)} would add about ${formatCount(
        estimate.estimatedEvents,
      )} changes to an app, and one addition holds at most ${formatCount(
        estimate.eventCap,
      )}. This file can become a new app instead.`;
  }
}

const NAME_PROBLEM: Readonly<Record<NameProblemVm, string>> = Object.freeze({
  required: "Enter a name.",
});

/**
 * Counts as the mocks write them — "12,482 rows", not "12482". View models
 * hold no locale (M37 must-not), so the grouping is chosen here, by the
 * browser, from the reader's own locale.
 */
const groupedNumber = new Intl.NumberFormat();

export function formatCount(value: number): string {
  return groupedNumber.format(value);
}

/** D24: an estimated count is written as an estimate, every time. */
export function describeRowCount(count: ImportRowCountVm): string {
  const rows =
    count.value === 1 ? "1 row" : `${formatCount(count.value)} rows`;
  return count.kind === "estimated" ? `About ${rows}` : rows;
}

export function describeContradiction(
  contradiction: FormatContradictionVm,
): string {
  return `This file is named “.${contradiction.declaredExtension}”, which usually holds ${contradiction.expectedKind}, but its content is ${contradiction.detectedKind}. Sheaf goes by the content.`;
}

export interface DelimitedTargetScreenProps extends WorkbookPickerProps {
  readonly vm: DelimitedTargetVm;
  readonly nav: SecurityNavigation;
  readonly onChooseNewApp: () => void;
  readonly onChooseApp: (appId: string) => void;
  readonly onSetAppName: (text: string) => void;
  readonly onSetTableName: (text: string) => void;
  readonly onContinue: () => void;
  readonly topBarActions?: ReactNode;
}

export function DelimitedTargetScreen({
  vm,
  nav,
  onChooseNewApp,
  onChooseApp,
  onSetAppName,
  onSetTableName,
  onContinue,
  acceptedFileTypes,
  onSelectFiles,
  topBarActions,
}: DelimitedTargetScreenProps): ReactNode {
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (vm.canContinue) onContinue();
  };

  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="library"
      nav={nav}
      title="Delimited table target"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-017">
        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>Value-only import</span>
          <h1 className={cx(styles["title"])}>Place this delimited table.</h1>
          <p className={cx(styles["lede"])}>
            CSV and TSV carry values, not workbook structure. Choose exactly
            where the new table belongs.
          </p>
        </div>

        {vm.contradiction !== null && (
          <StatusBanner title="The name and the content disagree" tone="warning">
            {describeContradiction(vm.contradiction)}
          </StatusBanner>
        )}

        <section className={cx(styles["card"])}>
          <h2 className={cx(styles["cardTitle"])}>Detected content</h2>
          <dl className={cx(styles["facts"])}>
            <dt>File</dt>
            <dd>{vm.fileName}</dd>
            <dt>Delimiter</dt>
            <dd>{DELIMITER_NAME[vm.delimiter] ?? vm.delimiter}</dd>
            <dt>Encoding</dt>
            <dd>{ENCODING_NAME[vm.encoding] ?? vm.encoding}</dd>
            <dt>Rows</dt>
            <dd>{describeRowCount(vm.rowCount)}</dd>
            <dt>Columns</dt>
            <dd>{vm.columnCount}</dd>
          </dl>
          <StatusBanner title="Values only" tone="info">
            Types may be inferred from values during review. No formula,
            validation, chart, or relationship structure is claimed.
          </StatusBanner>
        </section>

        <form className={cx(styles["card"])} noValidate onSubmit={submit}>
          <RadioGroup
            className={cx(styles["choices"])}
            onChange={(value) => {
              if (value === "new-app") {
                onChooseNewApp();
                return;
              }
              const chosen =
                vm.appChoices.find((app) => app.isSelected) ?? vm.appChoices[0];
              if (chosen !== undefined) onChooseApp(chosen.appId);
            }}
            value={vm.destination}
          >
            <Label className={cx(styles["cardTitle"])}>Destination</Label>
            {vm.destinations.map((destination) => (
              <Radio
                className={cx(styles["choice"])}
                isDisabled={!destination.enabled}
                key={destination.id}
                value={destination.id}
              >
                <span aria-hidden="true" className={cx(styles["choiceMark"])} />
                <span className={cx(styles["choiceLabel"])}>
                  {destination.label}
                </span>
                <span className={cx(styles["choiceHint"])}>
                  {DESTINATION_HINT[destination.id]}
                </span>
                {destination.reason !== undefined && (
                  <span className={cx(styles["choiceHint"])}>
                    {describeDestinationReason(destination.reason, vm.appendEstimate)}
                  </span>
                )}
              </Radio>
            ))}
          </RadioGroup>

          {vm.destination === "existing-app" && (
            <RadioGroup
              className={cx(styles["choices"])}
              onChange={onChooseApp}
              value={vm.appChoices.find((app) => app.isSelected)?.appId ?? null}
            >
              <Label className={cx(styles["cardTitle"])}>Which app</Label>
              {vm.appChoices.map((app) => (
                <Radio className={cx(styles["choice"])} key={app.appId} value={app.appId}>
                  <span aria-hidden="true" className={cx(styles["choiceMark"])} />
                  <span className={cx(styles["choiceLabel"])}>{app.displayName}</span>
                  <span className={cx(styles["choiceHint"])}>
                    {app.tableCount === 1
                      ? "1 table. The new table is added beside it."
                      : `${formatCount(app.tableCount)} tables. The new table is added beside them.`}
                  </span>
                </Radio>
              ))}
            </RadioGroup>
          )}

          <div className={cx(styles["fieldGroup"])}>
            {vm.needsAppName && (
              <TextField
                autoComplete="off"
                isInvalid={vm.appNameProblem !== null}
                isRequired
                label="App name"
                onChange={onSetAppName}
                value={vm.appName}
                {...(vm.appNameProblem === null
                  ? {}
                  : { errorMessage: NAME_PROBLEM[vm.appNameProblem] })}
              />
            )}
            <TextField
              autoComplete="off"
              isInvalid={vm.tableNameProblem !== null}
              isRequired
              label="Table name"
              onChange={onSetTableName}
              value={vm.tableName}
              {...(vm.tableNameProblem === null
                ? {}
                : { errorMessage: NAME_PROBLEM[vm.tableNameProblem] })}
            />
          </div>

          <div className={cx(styles["actions"])}>
            {vm.canContinue ? (
              <Button tone="primary" type="submit">
                Check size first
              </Button>
            ) : (
              <Button
                disabledReason={
                  vm.needsAppName
                    ? "Name the app and the table first."
                    : "Name the table first."
                }
                isDisabled
                tone="primary"
                type="submit"
              >
                Check size first
              </Button>
            )}
            <ChooseAnotherFileButton
              acceptedFileTypes={acceptedFileTypes}
              onSelectFiles={onSelectFiles}
              tone="secondary"
            />
          </div>
        </form>
      </div>
    </UnlockedFrame>
  );
}
