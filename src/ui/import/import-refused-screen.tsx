import type { ReactNode } from "react";
import type {
  ImportRefusedVm,
  RefusalCopyTokenV1,
} from "../../application/view-models/import.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { UnlockedFrame, type SecurityNavigation } from "../security/frames.js";
import styles from "./import.module.css";

/**
 * SCR-021 — the refusals (import-refused.html, MOD-005/006, CAP-09, FR-2).
 *
 * **Six tokens, one card each, no fallthrough.** The map is a total
 * `Record<RefusalCopyTokenV1, …>`, so a seventh refusal kind added upstream is
 * a compile error here rather than a card that silently prints nothing.
 *
 * **D19's later-release card is composed, not invented.** XLSX/XLSB/XLS/ODS and
 * HTML tables are identified and refused whole in this release; the card keeps
 * import-refused.html's structure — what happened, why, what to do — and fills
 * it with the one fact this release actually has. The family name comes from
 * the refusal, never from the extension the user typed.
 *
 * **Every remedy has to end somewhere this release can read.** The mock's
 * Numbers instruction ends at an exported `.xlsx`, which F02 refuses; the
 * approved wording is kept (D19 names it) and the release fact is stated once,
 * for every card, so no instruction dead-ends silently.
 *
 * `macro-content` has no F02 producer — S03's classifier reaches it only for
 * containers F03 opens — but the token exists, so its card does too, and its
 * final "choose the macro-free copy here" step is not printed while workbook
 * formats are still refused.
 */

interface RefusalCardV1 {
  readonly heading: string;
  /** Why Sheaf refused, in the mock's no-blame voice. */
  readonly body: string;
  /** What to do, in order. Empty when the remedy is the page action itself. */
  readonly steps: readonly string[];
}

const LATER_RELEASE_FORMAT: Readonly<Record<string, string>> = Object.freeze({
  ooxml: "an Excel workbook (.xlsx)",
  xlsb: "an Excel binary workbook (.xlsb)",
  xls: "a legacy Excel workbook (.xls)",
  ods: "an OpenDocument spreadsheet (.ods)",
  html: "an HTML table",
});

function laterReleaseCard(format: string | null): RefusalCardV1 {
  const family =
    format === null ? "a workbook" : (LATER_RELEASE_FORMAT[format] ?? "a workbook");
  return {
    heading: "Workbook format",
    body: `Sheaf can tell this file is ${family}, but this release does not read workbook structure. Refusing it whole is how Sheaf avoids claiming a table it has not read.`,
    steps: [
      "Open the workbook in the application that made it.",
      "Export the sheet you need as CSV or TSV.",
      "Choose that delimited file here.",
    ],
  };
}

/** import-refused.html, verbatim where the mock has the words. */
const REFUSAL_CARD: Readonly<Record<RefusalCopyTokenV1, RefusalCardV1>> =
  Object.freeze({
    "macro-content": {
      heading: "Macro-enabled workbook",
      body: "Macros can contain behavior Sheaf cannot safely preserve or execute. Sheaf will not strip them and pretend the workbook is unchanged.",
      steps: [
        "Open the workbook in Microsoft Excel.",
        "Save a copy as Excel Workbook (.xlsx).",
      ],
    },
    "numbers-file": {
      heading: "Apple Numbers",
      body: "Numbers keeps its tables in its own document format, which Sheaf does not read.",
      steps: [
        "In Numbers: Share → Export and Send → Excel, then choose the exported XLSX.",
      ],
    },
    "pages-file": {
      heading: "Apple Pages",
      body: "Pages is a document, not a workbook, so there is no cell model to read.",
      steps: [
        "Copy tabular data into Numbers or Excel and export as XLSX, CSV, or TSV.",
      ],
    },
    "pdf-file": {
      heading: "PDF",
      body: "A PDF has no reliable cell model. Guessing one would invent values you never wrote.",
      steps: [
        "Return to the spreadsheet that produced the PDF and export XLSX or delimited text.",
      ],
    },
    "workbook-format-later-release": laterReleaseCard(null),
    "binary-unreadable": {
      heading: "Unreadable file",
      body: "Sheaf could not recognise this file's contents as a spreadsheet or as delimited text.",
      steps: [],
    },
  });

export function refusalCard(vm: ImportRefusedVm): RefusalCardV1 {
  return vm.refusal === "workbook-format-later-release"
    ? laterReleaseCard(vm.laterReleaseFormat)
    : REFUSAL_CARD[vm.refusal];
}

/** D19, said once so no instruction above it can dead-end unnoticed. */
export const RELEASE_SCOPE =
  "This release reads CSV and TSV. Workbook formats arrive in a later release.";

export interface ImportRefusedScreenProps {
  readonly vm: ImportRefusedVm;
  readonly nav: SecurityNavigation;
  readonly onChooseAnotherFile: () => void;
  readonly onReturnToLibrary: () => void;
  readonly topBarActions?: ReactNode;
}

export function ImportRefusedScreen({
  vm,
  nav,
  onChooseAnotherFile,
  onReturnToLibrary,
  topBarActions,
}: ImportRefusedScreenProps): ReactNode {
  const card = refusalCard(vm);

  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="library"
      nav={nav}
      title="Import refused"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-021">
        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>Input blocked safely</span>
          <h1 className={cx(styles["title"])}>
            This file cannot become a Sheaf app.
          </h1>
          <p className={cx(styles["lede"])}>
            The refusal is whole-file. Nothing partial was added to the library.
          </p>
        </div>

        <section className={cx(styles["card"])} data-refusal={vm.refusal}>
          <div className={cx(styles["cardHead"])}>
            <h2 className={cx(styles["cardTitle"])}>{card.heading}</h2>
            <span className={cx(styles["badge"])}>Refused</span>
          </div>
          <dl className={cx(styles["facts"])}>
            <dt>File</dt>
            <dd>{vm.fileName}</dd>
          </dl>
          <p className={cx(styles["lede"])}>{card.body}</p>
          {card.steps.length > 0 && (
            <ol className={cx(styles["steps"])}>
              {card.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
        </section>

        <StatusBanner title="What this release reads" tone="info">
          {RELEASE_SCOPE}
        </StatusBanner>

        <div className={cx(styles["actions"])}>
          <Button onPress={onChooseAnotherFile} tone="primary">
            Choose another file
          </Button>
          <Button onPress={onReturnToLibrary}>Return to library</Button>
        </div>
      </div>
    </UnlockedFrame>
  );
}
