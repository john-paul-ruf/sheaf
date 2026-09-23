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
export type PreservedPartKindVm = ImportReviewVm["sheets"][number]["inertItems"][number]["kind"];
export type PreservedReasonKeyVm = ImportReviewVm["sheets"][number]["inertItems"][number]["reasonKey"];

/** How a preserved part is named in a sentence (D40's closed list). */
export const PART_LABEL: Readonly<Record<PreservedPartKindVm, readonly [string, string]>> =
  Object.freeze({
    formula: ["formula region", "formula regions"],
    chart: ["chart", "charts"],
    "pivot-table": ["pivot table", "pivot tables"],
    drawing: ["drawing object", "drawing objects"],
    image: ["image", "images"],
    comment: ["comment", "comments"],
    "external-link": ["external link", "external links"],
    hyperlink: ["hyperlink", "hyperlinks"],
    "embedded-object": ["embedded object", "embedded objects"],
    "form-control": ["form control", "form controls"],
    "data-connection": ["data connection", "data connections"],
    "conditional-formatting": ["conditional formatting rule set", "conditional formatting rule sets"],
    "cell-styling": ["cell styling", "cell styling"],
    sparkline: ["sparkline", "sparklines"],
    script: ["script", "scripts"],
    "unsupported-validation": [
      "validation rule Sheaf cannot express",
      "validation rules Sheaf cannot express",
    ],
  });

export function describeParts(kind: PreservedPartKindVm, count: number): string {
  const [one, many] = PART_LABEL[kind];
  return count === 1 ? `1 ${one}` : `${formatCount(count)} ${many}`;
}

/**
 * Why each preserved part is kept rather than made live (D40), in STA-012's
 * "type, location, reason" voice. The F03-era keys say what is true after F04
 * (D50, D62); nothing is said to keep working, and nothing is promised.
 */
export const INERT_REASON: Readonly<Record<PreservedReasonKeyVm, string>> = Object.freeze({
  "formula-not-live-yet":
    "Imported results are kept as values. The formula is preserved; you can add a live calculation in App structure.",
  "chart-not-live-yet": "Kept as a snapshot of the workbook's chart. It is not a live chart.",
  "pivot-not-live-yet": "Kept as a snapshot of the workbook's pivot table. It is not a live chart.",
  "visual-only": "Preserved in the snapshot; Sheaf cannot make it interactive.",
  "note-kept-as-text": "Kept as text in the snapshot.",
  "link-not-followed": "Kept as text; Sheaf never follows it.",
  "external-source-not-fetched": "Kept as text; Sheaf never fetches it.",
  "object-not-opened": "Kept in the source workbook; Sheaf never opens it.",
  "control-not-run": "Kept in the source workbook; Sheaf never runs it.",
  "connection-not-refreshed": "Kept in the source workbook; Sheaf never refreshes it.",
  "formatting-not-reproduced": "The values are kept; the formatting is not reproduced.",
  "script-not-run": "Kept in the source workbook; Sheaf never runs it.",
  "validation-not-expressible": "The values are kept; Sheaf cannot enforce this rule.",
  "chart-not-rebuilt": "Kept as a snapshot. Sheaf could not rebuild it as a live chart.",
  "formula-not-supported": "Sheaf cannot calculate this formula. The imported values are kept; new rows stay empty and flagged.",
});

/**
 * The visible tag beside a statement. review.html's own vocabulary where it
 * has one ("Excel validation rule", "Workbook number format", "Your VLOOKUP
 * formula", "Original formula preserved"). A validation rule is only called
 * Excel's when the workbook is an Excel one.
 */
export function evidenceTag(evidence: EvidenceVm, isExcel = true): string {
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
    case "declared-table":
      return "Workbook declared table";
    case "number-format":
      return "Workbook number format";
    case "validation-rule":
      return isExcel ? "Excel validation rule" : "Workbook validation rule";
    case "lookup-formula":
      return `Your ${evidence.functionName} formula`;
    case "key-match":
      return "Matching IDs";
    case "matching-headings":
      return "Matching headings";
    case "blank-row-gap":
      return "Blank rows";
    case "column-gap":
      return "Blank columns";
    case "formula-text":
      return "Original formula preserved";
    case "sheet-shape":
      return "Sheet layout";
    case "preserved-part":
      return "Preserved content";
    case "previously-rejected":
      return "You rejected this before";
    case "formula-outcome":
      // review.html's badges for a live and an unsupported calculation.
      return evidence.disposition === "live"
        ? "Live computed value"
        : evidence.disposition === "frozen"
          ? "Frozen at import"
          : "Needs attention";
    case "chart-mapping":
      return "Workbook chart";
  }
}

type ChartMappingVm = Extract<EvidenceVm, { kind: "chart-mapping" }>;

/** D62's chart evidence line: what grouping does to a chart Excel drew row by row. */
function describeMapping(evidence: ChartMappingVm): string {
  if (evidence.chartType === "scatter") {
    return `It plots “${evidence.yFieldName ?? ""}” against “${evidence.xFieldName ?? ""}” from “${evidence.tableName}”, one point per record.`;
  }
  const field = `“${evidence.measureFieldName ?? ""}”`;
  const measure =
    evidence.measure === "count"
      ? "counts them"
      : evidence.measure === "average"
        ? `averages ${field}`
        : evidence.measure === "min"
          ? `keeps the lowest ${field}`
          : evidence.measure === "max"
            ? `keeps the highest ${field}`
            : `adds ${field}`;
  const group = `“${evidence.groupFieldName ?? ""}”`;
  return evidence.categoriesRepeat
    ? `Excel plotted each row; Sheaf groups rows with the same ${group} and ${measure}.`
    : `It groups the rows of “${evidence.tableName}” by ${group} and ${measure}.`;
}

type FormulaOutcomeVm = Extract<EvidenceVm, { kind: "formula-outcome" }>;

/** Why a formula is kept as imported values, from the reason's own facts (D62). */
function keptBecause(evidence: FormulaOutcomeVm): string {
  const name = evidence.detail ?? "one of its functions";
  switch (evidence.reason) {
    case "unparsed":
      return "Sheaf could not read this formula.";
    case "external-source":
      return "It refers to another workbook, which Sheaf never opens.";
    case "three-d-reference":
      return "It reads a range across several sheets.";
    case "whole-row-reference":
      return "It reads whole rows.";
    case "unresolved-name":
      return "It uses a name Sheaf could not find in this workbook.";
    case "outside-imported-structure":
      return "It reads cells outside the tables Sheaf is creating.";
    case "row-specific-reference":
      return "It reads one particular row rather than a whole column.";
    case "multi-column-range":
      return "It reads a range spanning several columns.";
    case "unsupported-lookup":
      return "Its lookup does not go through a connection Sheaf is creating.";
    case "unsupported-function":
      return `${name} is not supported yet.`;
    case "arity":
      return `${name} is used with a number of arguments Sheaf does not accept.`;
    case "unsupported-operator":
      return "It uses an operator Sheaf does not calculate.";
    case "array-constant":
    case "array-formula":
      return "It is an array formula.";
    case "unsupported-error-literal":
      return "It names an error value Sheaf does not use.";
    case "number-out-of-range":
      return "It holds a number too large for Sheaf to calculate exactly.";
    case "not-filled-down":
      return `Only ${formatCount(evidence.shapeMatchCount)} of ${formatCount(evidence.rowCount ?? 0)} rows hold the same formula${
        evidence.shapeBreakRowIndex === null ? "" : `; row ${formatCount(evidence.shapeBreakRowIndex + 1)} differs`
      }.`;
    case "unreadable":
      return "The workbook's formula text could not be read.";
    case "value-not-kept":
      return "It draws random numbers, and a summary value has no row to keep a frozen result in.";
    case null:
      return "Sheaf cannot calculate this formula.";
  }
}

/** What a formula becomes, in review.html's voice. */
function describeOutcome(evidence: FormulaOutcomeVm): string {
  const isColumn = evidence.target === "computed-column";
  switch (evidence.disposition) {
    case "live": {
      const rows = isColumn
        ? `All ${formatCount(evidence.rowCount ?? 0)} rows hold the same formula, so every row will recalculate immediately when its inputs change, including rows you add later.`
        : "It will recalculate immediately whenever the rows it reads change.";
      const related = evidence.relatedTableName === null ? "" : ` It reads “${evidence.relatedTableName}” through its connection.`;
      const clock = evidence.determinism === "clock-volatile" ? " It reads today's date, so it is recalculated rather than stored." : "";
      return `${rows}${related}${clock}`;
    }
    case "frozen":
      return "It draws random numbers, so each imported row keeps the value the workbook calculated, frozen. A row you add gets its own value once.";
    case "unsupported":
      return `${keptBecause(evidence)} Existing imported results stay visible.${
        isColumn ? " New rows will leave this value empty and flagged—not silently set it to zero." : " The value stays in the sheet snapshot."
      }`;
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
    case "declared-table":
      return `The workbook declares a table named “${evidence.name}” here.`;
    case "number-format":
      return `${formatCount(evidence.matched)} of ${formatCount(
        evidence.sampled,
      )} values Sheaf looked at use the workbook format “${evidence.numberFormat}”.`;
    case "validation-rule":
      return evidence.listOptions === null
        ? "The workbook checks what may be entered in this column."
        : `The workbook allows only ${formatCount(evidence.listOptions.length)} choices in this column.`;
    case "lookup-formula":
      return `A ${evidence.functionName} formula, ${evidence.formulaText}, looks up “${evidence.parentColumnName}” in “${evidence.parentTableName}”.`;
    case "key-match":
      return `${formatCount(evidence.matched)} of ${formatCount(evidence.measured)} values${
        evidence.isSampled ? " Sheaf looked at" : ""
      } match a “${evidence.parentColumnName}” in “${evidence.parentTableName}”.`;
    case "matching-headings":
      return `The headings repeat on both sides of row ${formatCount(evidence.rowIndex + 1)}.`;
    case "blank-row-gap":
      return `Blank rows separate row ${formatCount(evidence.afterRowIndex + 1)} from row ${formatCount(
        evidence.beforeRowIndex + 1,
      )}.`;
    case "column-gap":
      return `Blank columns separate column ${formatCount(evidence.afterColumnIndex + 1)} from column ${formatCount(
        evidence.beforeColumnIndex + 1,
      )}.`;
    case "formula-text":
      return evidence.text === null
        ? `${formatCount(evidence.formulaCount)} formulas are preserved as the workbook wrote them.`
        : `The formula ${evidence.text} is preserved${evidence.isArray ? " as an array formula" : ""}${
            evidence.isExternal ? ". It refers to another workbook, which Sheaf never opens" : ""
          }.`;
    case "sheet-shape":
      return `“${evidence.sheetName}” has ${formatCount(evidence.usedCellCount)} used cells, ${formatCount(
        evidence.formulaCellCount,
      )} of them formulas, and ${formatCount(evidence.tableCount)} declared tables.`;
    case "preserved-part":
      return `${describeParts(evidence.partKind, evidence.count)} kept as preserved content.`;
    case "previously-rejected":
      return "You rejected this in an earlier import, so it is proposed as rejected.";
    case "formula-outcome":
      return describeOutcome(evidence);
    case "chart-mapping":
      return describeMapping(evidence);
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
    case "validation-rule":
      return evidence.listOptions ?? [];
    case "matching-headings":
      return evidence.headings;
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
  readonly isExcel?: boolean;
}

export function EvidenceSheet({
  isOpen,
  onClose,
  statement,
  evidence,
  isExcel = true,
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
              <span className={cx(styles["badge"])}>{evidenceTag(item, isExcel)}</span>
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
  "error-value":
    "Some cells hold spreadsheet error values such as #N/A. They are kept exactly as written.",
  "malformed-value":
    "Some values could not be read as the kind their cell declared. They are kept as the original text.",
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
