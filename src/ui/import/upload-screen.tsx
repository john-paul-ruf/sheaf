import type { ReactNode } from "react";
import { FileTrigger } from "react-aria-components";
import type {
  AcceptedFormatGroupVm,
  UploadLandingVm,
} from "../../application/view-models/import.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { UnlockedFrame, type SecurityNavigation } from "../security/frames.js";
import { ImportProgressRegion } from "./import-progress-screen.js";
import styles from "./import.module.css";

/**
 * SCR-016 — the upload landing (upload.html, CAP-09, CAP-19, FR-1/FR-2).
 *
 * **Both format groups are read.** Workbooks are sized, streamed and reviewed
 * (F03), so the "Spreadsheet structure" group carries upload.html's own
 * promise and D19's later-release label is gone with the refusal it announced.
 *
 * **"See table targeting" is a picker, not a link.** SCR-017 places a
 * delimited file the parser has already measured, so there is no targeting
 * screen without a file; the value-only group's action therefore opens the
 * picker narrowed to CSV and TSV, and names what it does.
 *
 * **The picker is not narrowed to what Sheaf can read.** Format is decided by
 * content (FR-1), and SCR-021 exists to refuse a Numbers, Pages or PDF file by
 * name with its own remedy — a picker that hid them would make the approved
 * refusal unreachable (`src/platform/file-pick.ts`).
 *
 * upload.html's "On desktop, you can also drop a file here" is absent: this
 * release has no drop target, and an instruction for an affordance that does
 * not exist is the same defect as a dead control.
 */

/** upload.html, verbatim. */
const GROUP_DETAIL: Readonly<Record<AcceptedFormatGroupVm["id"], string>> =
  Object.freeze({
    "spreadsheet-structure":
      "Tables, validation, number formats, formulas, and sheets are read where declared.",
    "value-only": "Create a new app or add a new table to one you already have.",
  });

/** The value-only group's picker: the two formats SCR-017 places. */
const DELIMITED_FILE_TYPES: readonly string[] = Object.freeze([".csv", ".tsv"]);

/**
 * What every screen that offers "choose another file" actually needs.
 *
 * The machine accepts `CHOOSE_FILE` from any state that is not mid-run, so a
 * refused, over-budget or ended run restarts by *picking a file* — not by
 * navigating back to the landing and picking one there. Making the control a
 * picker rather than a link is what keeps that one press.
 */
export interface WorkbookPickerProps {
  /** The extensions the platform picker offers (M51). */
  readonly acceptedFileTypes: readonly string[];
  readonly onSelectFiles: (files: FileList | null) => void;
}

export function ChooseAnotherFileButton({
  acceptedFileTypes,
  onSelectFiles,
  tone = "primary",
  label = "Choose another file",
}: WorkbookPickerProps & {
  readonly tone?: "primary" | "secondary";
  readonly label?: string;
}): ReactNode {
  return (
    <FileTrigger acceptedFileTypes={acceptedFileTypes} onSelect={onSelectFiles}>
      <Button tone={tone}>{label}</Button>
    </FileTrigger>
  );
}

export interface UploadScreenProps {
  readonly vm: UploadLandingVm;
  readonly nav: SecurityNavigation;
  /** The extensions the platform picker offers (M51). */
  readonly acceptedFileTypes: readonly string[];
  readonly onSelectFiles: (files: FileList | null) => void;
  readonly topBarActions?: ReactNode;
}

export function UploadScreen({
  vm,
  nav,
  acceptedFileTypes,
  onSelectFiles,
  topBarActions,
}: UploadScreenProps): ReactNode {
  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="library"
      nav={nav}
      title="Upload workbook"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-016">
        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>New app</span>
          <h1 className={cx(styles["title"])}>
            Choose the workbook you already use.
          </h1>
          <p className={cx(styles["lede"])}>
            Sheaf reads it on this device. Format is determined from file
            content, never trusted from the filename alone.
          </p>
        </div>

        <section className={cx(styles["card"])}>
          <span aria-hidden="true" className={cx(styles["glyph"])}>
            ＋
          </span>
          <h2 className={cx(styles["cardTitle"])}>
            Choose from Files or a share target.
          </h2>
          <p className={cx(styles["lede"])}>
            Your platform picker may expose iCloud Drive, Google Drive, Dropbox,
            OneDrive, email downloads, and local storage.
          </p>
          <div className={cx(styles["actions"])}>
            <FileTrigger
              acceptedFileTypes={acceptedFileTypes}
              onSelect={onSelectFiles}
            >
              <Button tone="primary">Open file picker</Button>
            </FileTrigger>
          </div>
          {vm.phase !== null && <ImportProgressRegion phase={vm.phase} />}
        </section>

        <section aria-labelledby="upload-formats">
          <h2 className={cx(styles["cardTitle"])} id="upload-formats">
            Accepted formats
          </h2>
          <ul className={cx(styles["groups"])}>
            {vm.formats.map((group) => (
              <li className={cx(styles["card"])} key={group.id}>
                <span className={cx(styles["extensions"])}>{group.label}</span>
                <h3 className={cx(styles["cardTitle"])}>
                  {group.extensions.map((extension) => extension.toUpperCase()).join(", ")}
                </h3>
                <p className={cx(styles["lede"])}>{GROUP_DETAIL[group.id]}</p>
                {group.id === "value-only" && (
                  <div className={cx(styles["actions"])}>
                    <ChooseAnotherFileButton
                      acceptedFileTypes={DELIMITED_FILE_TYPES}
                      label="Choose a CSV or TSV file"
                      onSelectFiles={onSelectFiles}
                      tone="secondary"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <StatusBanner
          title="Macros are refused, never stripped"
          tone="warning"
        >
          Numbers, Pages, and PDF are also refused with exact Excel-export
          instructions. No refusal leaves a partial app.
        </StatusBanner>
      </div>
    </UnlockedFrame>
  );
}
