import { useState, type ReactNode } from "react";
import type {
  ImportRefusedVm,
  RefusalCopyTokenV1,
  UnreadableDetailVm,
} from "../../application/view-models/import.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { UnlockedFrame, type SecurityNavigation } from "../security/frames.js";
import {
  ChooseAnotherFileButton,
  type WorkbookPickerProps,
} from "./upload-screen.js";
import styles from "./import.module.css";

/**
 * SCR-021 — the refusals (import-refused.html, MOD-005/006, CAP-09, CAP-19,
 * FR-2).
 *
 * **Five tokens, one card each, no fallthrough.** The map is a total
 * `Record<RefusalCopyTokenV1, …>`, so a refusal kind added upstream is a
 * compile error here rather than a card that silently prints nothing. D19's
 * later-release card is gone with the refusal it explained: this page accepts
 * workbooks, and the kind has no producer (D42).
 *
 * **A macro workbook is refused whole, and says so first (MOD-005).**
 * import-refused.html's macro card is the page; MOD-005 opens over it with
 * import.html's blocked-file sentence — the file named, the macros named, the
 * remedy offered — so the refusal is announced before the page is read.
 *
 * **An unsafe container names its reason (D42, D43).** `binary-unreadable`
 * carries a closed detail token, and each token gets a heading and a sentence
 * composed in this card's own structure — what happened, why, what to do —
 * from nothing but that token. No file content is ever shown.
 */

interface RefusalCardV1 {
  readonly heading: string;
  /** Why Sheaf refused, in the mock's no-blame voice. */
  readonly body: string;
  /** What to do, in order. Empty when the remedy is the page action itself. */
  readonly steps: readonly string[];
}

/**
 * What each closed unreadable-detail token means, in one sentence. SCR-022
 * uses the same sentences for a parse that failed mid-stream (CA-24).
 */
export const UNREADABLE_DETAIL_SENTENCE: Readonly<Record<UnreadableDetailVm, string>> =
  Object.freeze({
    "truncated-container": "The file ends before its own structure says it should.",
    "expansion-limit": "Part of the file expands to far more data than its stored size.",
    "directory-loop": "The file's internal directory points back into itself.",
    "impossible-dimension": "A sheet declares a size no spreadsheet can have.",
    "entity-declaration": "The workbook's XML declares entities, which Sheaf never expands.",
    "encrypted-workbook": "The workbook is protected with a password, so its cells cannot be read.",
    "malformed-structure": "The file's internal structure is damaged.",
    "unrecognized-content":
      "Sheaf could not recognise this file's contents as a spreadsheet or as delimited text.",
  });

const UNREADABLE_HEADING: Readonly<Record<UnreadableDetailVm, string>> = Object.freeze({
  "truncated-container": "Incomplete file",
  "expansion-limit": "Unsafe compression",
  "directory-loop": "Unsafe file structure",
  "impossible-dimension": "Impossible sheet size",
  "entity-declaration": "Unsafe XML",
  "encrypted-workbook": "Password-protected workbook",
  "malformed-structure": "Damaged file",
  "unrecognized-content": "Unreadable file",
});

/** import-refused.html's shape of remedy, for a file a fresh copy may fix. */
const FRESH_COPY_STEPS: readonly string[] = Object.freeze([
  "Open the file in the application that made it.",
  "Save a fresh copy, then choose that copy here.",
]);

function unreadableCard(detail: UnreadableDetailVm | null): RefusalCardV1 {
  const token = detail ?? "unrecognized-content";
  return {
    heading: UNREADABLE_HEADING[token],
    body: `${UNREADABLE_DETAIL_SENTENCE[token]} Sheaf stopped before reading any cell.`,
    steps:
      token === "unrecognized-content"
        ? []
        : token === "encrypted-workbook"
          ? [
              "Open the workbook in the application that made it.",
              "Remove the password, save a copy, then choose that copy here.",
            ]
          : FRESH_COPY_STEPS,
  };
}

/** import-refused.html, verbatim where the mock has the words. */
const REFUSAL_CARD: Readonly<
  Record<Exclude<RefusalCopyTokenV1, "binary-unreadable">, RefusalCardV1>
> = Object.freeze({
  "macro-content": {
    heading: "Macro-enabled workbook",
    body: "Macros can contain behavior Sheaf cannot safely preserve or execute. Sheaf will not strip them and pretend the workbook is unchanged.",
    steps: [
      "Open the workbook in Microsoft Excel.",
      "Save a copy as Excel Workbook (.xlsx).",
      "Choose that macro-free copy here.",
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
});

export function refusalCard(vm: ImportRefusedVm): RefusalCardV1 {
  return vm.refusal === "binary-unreadable"
    ? unreadableCard(vm.unreadableDetail)
    : REFUSAL_CARD[vm.refusal];
}

export interface ImportRefusedScreenProps extends WorkbookPickerProps {
  readonly vm: ImportRefusedVm;
  readonly nav: SecurityNavigation;
  readonly onReturnToLibrary: () => void;
  readonly topBarActions?: ReactNode;
}

export function ImportRefusedScreen({
  vm,
  nav,
  acceptedFileTypes,
  onSelectFiles,
  onReturnToLibrary,
  topBarActions,
}: ImportRefusedScreenProps): ReactNode {
  const card = refusalCard(vm);
  const isMacro = vm.refusal === "macro-content";
  const [macroNoticeOpen, setMacroNoticeOpen] = useState(isMacro);

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
          {isMacro && (
            <div className={cx(styles["actions"])}>
              <ChooseAnotherFileButton
                acceptedFileTypes={acceptedFileTypes}
                label="Choose macro-free copy"
                onSelectFiles={onSelectFiles}
              />
            </div>
          )}
        </section>

        <div className={cx(styles["actions"])}>
          <ChooseAnotherFileButton
            acceptedFileTypes={acceptedFileTypes}
            onSelectFiles={onSelectFiles}
            tone={isMacro ? "secondary" : "primary"}
          />
          <Button onPress={onReturnToLibrary}>Return to library</Button>
        </div>

        <Dialog
          footer={
            <>
              <Button
                onPress={() => {
                  setMacroNoticeOpen(false);
                }}
              >
                Close
              </Button>
              <ChooseAnotherFileButton
                acceptedFileTypes={acceptedFileTypes}
                label="Choose macro-free copy"
                onSelectFiles={onSelectFiles}
              />
            </>
          }
          isOpen={macroNoticeOpen}
          onOpenChange={setMacroNoticeOpen}
          title={`“${vm.fileName}” contains macros`}
        >
          {/* import.html's blocked-file language, with the real file name. */}
          <p>
            Sheaf never runs or strips macros, so no app was created. Save a
            macro-free .xlsx copy and choose it instead.
          </p>
        </Dialog>
      </div>
    </UnlockedFrame>
  );
}
