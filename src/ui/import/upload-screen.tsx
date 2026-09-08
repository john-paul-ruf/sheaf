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
 * SCR-016 — the upload landing (upload.html, CAP-09, FR-1/FR-2).
 *
 * **The format cards say what this release does, not what the mock hoped.**
 * upload.html promises that a workbook's "tables, validation, number formats,
 * formulas, and sheets are read where declared". F02 reads none of that: it
 * identifies workbook containers and refuses them (D19). Promising it here
 * and refusing it on the next screen would be the untruthful order to learn it
 * in, so the group carries `availability` and this surface prints the fact.
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

const AVAILABILITY: Readonly<
  Record<AcceptedFormatGroupVm["availability"], string>
> = Object.freeze({
  available: "Read in this release",
  // D19, stated at the landing rather than only at the refusal.
  "later-release": "Arrives in a later release",
});

const GROUP_DETAIL: Readonly<Record<AcceptedFormatGroupVm["id"], string>> =
  Object.freeze({
    // delimited-import.html: what a value-only import claims, and what it does not.
    "value-only": "Values become one new table. No workbook structure is claimed.",
    "spreadsheet-structure":
      "Sheaf recognises these files and refuses them whole. Nothing partial is added to the library.",
  });

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
                <div className={cx(styles["cardHead"])}>
                  <h3 className={cx(styles["cardTitle"])}>{group.label}</h3>
                  <span className={cx(styles["badge"])}>
                    {AVAILABILITY[group.availability]}
                  </span>
                </div>
                <p className={cx(styles["extensions"])}>
                  {group.extensions.join(", ")}
                </p>
                <p className={cx(styles["lede"])}>{GROUP_DETAIL[group.id]}</p>
              </li>
            ))}
          </ul>
        </section>

        <StatusBanner
          title="Macros are refused, never stripped"
          tone="warning"
        >
          Numbers, Pages, and PDF are also refused, each with its own export
          instructions. No refusal leaves a partial app.
        </StatusBanner>
      </div>
    </UnlockedFrame>
  );
}
