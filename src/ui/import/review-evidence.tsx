import type { ReactNode } from "react";
import type {
  ImportReviewVm,
  ReviewStatementVm,
} from "../../application/view-models/import.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { formatCount } from "./delimited-target-screen.js";
import styles from "./import.module.css";

/**
 * SHT-013 — inference evidence (sheet-atlas.html#sht-013).
 *
 * The sheet's required contents are "declared rule/formula/format/value-pattern
 * detail", and every statement carries exactly that: CA-16 keeps the evidence
 * on the statement, so this surface *projects* it and invents nothing. A
 * statement with no evidence is possible and says so — the alternative would be
 * an empty sheet that reads like a loading state.
 *
 * design.md §Import and review: "Each statement has a visible evidence tag and
 * an **Edit** action." The tag is {@link evidenceTag}; the detail is behind it.
 *
 * The wire shapes are read off the view model rather than imported from
 * `src/workers/`, which `src/ui/**` may never reach into
 * (`tests/unit/ui/architecture.test.ts`). A change to either shape is still a
 * compile error here, because these aliases point at the same types.
 */

export type EvidenceVm = ReviewStatementVm["evidence"][number];
export type ImportDiagnosticVm = ImportReviewVm["diagnostics"][number];

/** The visible tag beside a statement. review.html's own vocabulary. */
export function evidenceTag(evidence: EvidenceVm): string {
  switch (evidence.kind) {
    case "value-pattern":
      return "Value pattern";
    case "distinct-values":
      return "Repeated values";
    case "header-text":
      return "Header text";
    case "file-name":
      return "File name";
    case "row-shape":
      return "Row shape";
    case "value-conflict":
      return "Values that do not match";
  }
}

const VALUE_PATTERN: Readonly<
  Record<Extract<EvidenceVm, { kind: "value-pattern" }>["pattern"], string>
> = Object.freeze({
  "iso-date": "dates written year-month-day",
  "slash-date": "dates written with slashes",
  "currency-amount": "amounts with a currency symbol",
  "decimal-number": "decimal numbers",
  "boolean-word": "yes/no words",
  "email-address": "email addresses",
  "web-url": "web addresses",
  "telephone-number": "telephone numbers",
});

/** One sentence of detail per evidence kind, from its own numbers. */
export function describeEvidence(evidence: EvidenceVm): string {
  switch (evidence.kind) {
    case "value-pattern":
      return `${formatCount(evidence.matched)} of ${formatCount(
        evidence.sampled,
      )} values Sheaf looked at are ${VALUE_PATTERN[evidence.pattern]}${
        evidence.detail === null ? "" : ` (${evidence.detail})`
      }.`;
    case "distinct-values":
      return `${formatCount(
        evidence.distinct,
      )} different values appear across ${formatCount(
        evidence.sampled,
      )} Sheaf looked at.`;
    case "header-text":
      return `Row ${formatCount(evidence.rowIndex + 1)} reads “${
        evidence.text
      }”.`;
    case "file-name":
      return `The file is named “${evidence.fileName}”.`;
    case "row-shape":
      return `Row ${formatCount(evidence.rowIndex + 1)} has ${formatCount(
        evidence.cellCount,
      )} cells, ${formatCount(evidence.valueCount)} of them filled.`;
    case "value-conflict":
      return `${formatCount(
        evidence.count,
      )} values do not fit this field and were kept exactly as they were written.`;
  }
}

/** The examples an evidence item can show, if it has any. */
function evidenceExamples(evidence: EvidenceVm): readonly string[] {
  switch (evidence.kind) {
    case "value-pattern":
      return evidence.examples;
    case "distinct-values":
      return evidence.options;
    case "value-conflict":
      return evidence.examples.map(
        (example) => `Row ${formatCount(example.rowIndex + 1)}: ${example.sourceText}`,
      );
    default:
      return [];
  }
}

export interface EvidenceSheetProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** What the evidence is evidence *for*, so the sheet is self-explanatory. */
  readonly statement: string;
  readonly evidence: readonly EvidenceVm[];
}

export function EvidenceSheet({
  isOpen,
  onClose,
  statement,
  evidence,
}: EvidenceSheetProps): ReactNode {
  return (
    <Dialog
      footer={<Button onPress={onClose}>Close</Button>}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Why Sheaf thinks so"
    >
      <p className={cx(styles["lede"])}>{statement}</p>
      {evidence.length === 0 ? (
        <p className={cx(styles["note"])}>
          Sheaf recorded no evidence for this one. Change it if it looks wrong.
        </p>
      ) : (
        <ul className={cx(styles["evidenceList"])}>
          {evidence.map((item, index) => (
            <li className={cx(styles["evidenceItem"])} key={`${item.kind}-${String(index)}`}>
              <span className={cx(styles["badge"])}>{evidenceTag(item)}</span>
              <p>{describeEvidence(item)}</p>
              {evidenceExamples(item).length > 0 && (
                <ul className={cx(styles["examples"])}>
                  {evidenceExamples(item).map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/**
 * What the parser noticed while reading (D28's NFC normalisation included).
 *
 * FR-4/FR-6: nothing is silent. Each code is a closed token and the map is
 * total, so a new diagnostic upstream is a compile error rather than a row the
 * user never sees.
 */
const DIAGNOSTIC: Readonly<
  Record<ImportDiagnosticVm["code"], string>
> = Object.freeze({
  "text-normalized-nfc":
    "Some text was written in a form that looks identical but is stored differently. Sheaf normalised it so searching and sorting behave.",
  "unterminated-quote":
    "A quoted value was never closed. Sheaf read it to the end of the file rather than guessing where it stopped.",
  "quote-inside-unquoted-field":
    "A quote mark appeared inside an unquoted value. Sheaf kept it as part of the text.",
  "ragged-row": "Some rows have more or fewer cells than the rest.",
  "replacement-character":
    "Some bytes could not be decoded in this file's encoding and were replaced.",
  "row-length-bound-reached":
    "A row was longer than Sheaf reads in one piece and was cut at that bound.",
});

export function describeDiagnostic(
  diagnostic: ImportDiagnosticVm,
): string {
  const where =
    diagnostic.firstRowIndex === null
      ? ""
      : ` First seen at row ${formatCount(diagnostic.firstRowIndex + 1)}.`;
  const many =
    diagnostic.occurrences > 1
      ? ` ${formatCount(diagnostic.occurrences)} times.`
      : "";
  return `${DIAGNOSTIC[diagnostic.code]}${where}${many}`;
}
