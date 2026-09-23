/**
 * The review ledger's vocabulary: what Sheaf decided, why, and how to change it
 * (CA-16; FR-8).
 *
 * Every inference in a proposal is one {@link InferenceStatementV1}. A
 * statement names three things a review screen needs and cannot invent:
 *
 * - its **evidence**, as facts rather than prose — the wording is the view
 *   model's job, so the same evidence can be phrased for a phone and for a
 *   screen reader without either restating what the parser found;
 * - the **edit** that revises it, so the screen never offers an edit that has
 *   nowhere to land; and
 * - its **fingerprint input**, the stable string S04 hashes into
 *   `inference-decision.recorded`.
 *
 * **The fingerprint rule.** The input names *what the decision was about* —
 * subject, column, heading text, pattern, option labels, file name — and never
 * *how much of it was seen*: no counts, no examples, no row indexes. Re-import
 * the same file with a thousand rows appended and every fingerprint is
 * unchanged, which is what lets a rejection the user recorded once keep
 * standing (FR-7's "not silently re-detected"). Two different decisions never
 * share an input, because the terms are JSON-encoded and therefore unambiguous
 * about where one ends and the next begins.
 */

import type { FormulaDeterminismV1, FormulaDispositionV1 } from "../../domain/formulas/index.js";
import type { InferenceDispositionV1 } from "../../domain/model/events.js";
import type {
  FormatClassV1,
  PreservedPartKindV1,
  RangeV1,
  SheetKindV1,
  ValidationListSourceV1,
  ValidationOperatorV1,
  ValidationRuleV1,
} from "../facts/index.js";
import type { FormulaKeepReasonV1, ProposedChartTypeV1 } from "./workbook-proposal.js";

export const INFERENCE_SUBJECTS = Object.freeze([
  "app-name",
  "table-name",
  "header-row",
  "discarded-rows",
  "field-name",
  "field-type",
  "enum-options",
] as const);

export type InferenceSubjectV1 = (typeof INFERENCE_SUBJECTS)[number];

export const REVIEW_EDIT_KINDS = Object.freeze([
  "rename-app",
  "rename-table",
  "rename-field",
  "override-type",
  "set-header-row",
  "edit-enum-options",
] as const);

export type ReviewEditKindV1 = (typeof REVIEW_EDIT_KINDS)[number];

export const VALUE_PATTERNS = Object.freeze([
  "iso-date",
  "slash-date",
  "currency-amount",
  "decimal-number",
  "boolean-word",
  "email-address",
  "web-url",
  "telephone-number",
] as const);

export type ValuePatternV1 = (typeof VALUE_PATTERNS)[number];

/** At most this many illustrative values travel with any evidence. */
export const EVIDENCE_EXAMPLE_LIMIT = 3;

export type EvidenceV1 =
  | {
      readonly kind: "value-pattern";
      readonly pattern: ValuePatternV1;
      /** For a currency column, the symbol every counted value carried. */
      readonly detail: string | null;
      readonly matched: number;
      readonly sampled: number;
      readonly examples: readonly string[];
    }
  | {
      readonly kind: "distinct-values";
      readonly distinct: number;
      readonly sampled: number;
      readonly options: readonly string[];
    }
  | { readonly kind: "header-text"; readonly rowIndex: number; readonly text: string }
  | { readonly kind: "file-name"; readonly fileName: string }
  | {
      readonly kind: "row-shape";
      readonly rowIndex: number;
      readonly cellCount: number;
      readonly valueCount: number;
    }
  | {
      readonly kind: "value-conflict";
      readonly count: number;
      readonly examples: readonly {
        readonly rowIndex: number;
        readonly sourceText: string;
      }[];
    };

export interface InferenceStatementV1 {
  /** Stable across edits: `<subject>` or `<subject>:<columnIndex>`. */
  readonly statementId: string;
  readonly subject: InferenceSubjectV1;
  /** The one edit that revises this statement; null when nothing can. */
  readonly editKind: ReviewEditKindV1 | null;
  readonly columnIndex: number | null;
  readonly evidence: readonly EvidenceV1[];
  /**
   * The exact string S04 hashes for `inference-decision.recorded`. Hashing
   * happens there because M08 is the digest owner; the *input* is fixed here so
   * the same decision always hashes the same way.
   */
  readonly evidenceFingerprint: string;
  /** `accepted` until a review edit touches it (CA-16). */
  readonly disposition: InferenceDispositionV1;
}

export const statementIdOf = (
  subject: InferenceSubjectV1,
  columnIndex: number | null,
): string => (columnIndex === null ? subject : `${subject}:${columnIndex}`);

/**
 * The qualitative terms of one piece of evidence — deliberately not its
 * magnitudes. `distinct-values` contributes its option labels but not how often
 * each appeared; `value-pattern` contributes the pattern but not the tally.
 */
const fingerprintTermsOf = (evidence: EvidenceV1): readonly string[] => {
  switch (evidence.kind) {
    case "value-pattern":
      return ["value-pattern", evidence.pattern, evidence.detail ?? ""];
    case "distinct-values":
      return ["distinct-values", ...[...evidence.options].sort()];
    case "header-text":
      return ["header-text", evidence.text];
    case "file-name":
      return ["file-name", evidence.fileName];
    case "row-shape":
      return ["row-shape"];
    case "value-conflict":
      return ["value-conflict"];
    default: {
      const unreachable: never = evidence;
      return unreachable;
    }
  }
};

/** Builds the fingerprint input; see the module note for the rule it follows. */
export function evidenceFingerprintInput(
  subject: InferenceSubjectV1,
  columnIndex: number | null,
  evidence: readonly EvidenceV1[],
): string {
  return JSON.stringify([
    "sheaf.inference.v1",
    subject,
    columnIndex,
    ...evidence.flatMap(fingerprintTermsOf),
  ]);
}

export function inferenceStatement(
  subject: InferenceSubjectV1,
  columnIndex: number | null,
  editKind: ReviewEditKindV1 | null,
  evidence: readonly EvidenceV1[],
): InferenceStatementV1 {
  return {
    statementId: statementIdOf(subject, columnIndex),
    subject,
    editKind,
    columnIndex,
    evidence,
    evidenceFingerprint: evidenceFingerprintInput(subject, columnIndex, evidence),
    disposition: "accepted",
  };
}

// ------------------------------------------------------------ workbook (F03) --
//
// The workbook vocabulary is a strict superset of the F02 one above, declared
// beside it rather than by widening it: the F02 unions are pinned member for
// member by consumers in other leases (the staged proposal codec, the worker
// wire, the review view model), and widening a closed union breaks every
// exhaustive map over it (D32's rule). A delimited stream's workbook proposal
// still uses only the F02 members, with the F02 fingerprint inputs.

export const WORKBOOK_INFERENCE_SUBJECTS = Object.freeze([
  ...INFERENCE_SUBJECTS,
  "table-split",
  "table-merge",
  "relationship",
  "formula",
  "sheet-classification",
  "record-rule",
  "table-key",
  "table-label",
  /** F04: an OOXML chart or pivot rebuilt as a chart (D55). */
  "chart",
] as const);

export type WorkbookInferenceSubjectV1 = (typeof WORKBOOK_INFERENCE_SUBJECTS)[number];

export const WORKBOOK_REVIEW_EDIT_KINDS = Object.freeze([
  ...REVIEW_EDIT_KINDS,
  "reject-relationship",
  "restore-relationship",
  "retarget-relationship",
  "reject-statement",
  "restore-statement",
  "set-key",
  "set-label",
] as const);

export type WorkbookReviewEditKindV1 = (typeof WORKBOOK_REVIEW_EDIT_KINDS)[number];

/**
 * migration 005's `inference_decisions.decision_kind` CHECK, restated: M21
 * reaches the domain only through `values`/`schema`/`events` (the pipeline
 * sweep), so the list is repeated here and pinned member for member against
 * `src/domain/model/snapshots.ts` by `tests/unit/import/inference/`.
 */
export const INFERENCE_DECISION_KINDS = Object.freeze([
  "header",
  "discarded-row",
  "table-split",
  "table-merge",
  "column-type",
  "enum",
  "relationship",
  "formula",
  "sheet-classification",
  "record-rule",
] as const);

export type InferenceDecisionKindV1 = (typeof INFERENCE_DECISION_KINDS)[number];

const DECISION_KIND_OF: Readonly<Record<WorkbookInferenceSubjectV1, InferenceDecisionKindV1 | null>> = Object.freeze({
  "header-row": "header",
  "discarded-rows": "discarded-row",
  "table-split": "table-split",
  "table-merge": "table-merge",
  "field-type": "column-type",
  "enum-options": "enum",
  relationship: "relationship",
  formula: "formula",
  "sheet-classification": "sheet-classification",
  "record-rule": "record-rule",
  "app-name": null,
  "table-name": null,
  "field-name": null,
  "table-key": null,
  "table-label": null,
  // migration 005 has no chart decision kind: a chart choice is durable
  // evidence, not a projected decision.
  chart: null,
});

/**
 * The one subject → `decision_kind` mapping (binding on S03/S06). `null` means
 * **not projectable**: a naming or labelling choice, kept in the durable
 * decision list but never an `inference_decisions` row.
 */
export function decisionKindOf(subject: WorkbookInferenceSubjectV1): InferenceDecisionKindV1 | null {
  return DECISION_KIND_OF[subject];
}

/**
 * Evidence a workbook adds. Each carries structured facts only; the wording is
 * M37's. Counts may ride along for the review screen, but never enter a
 * fingerprint (see {@link workbookFingerprintInput}).
 */
export type WorkbookStructureEvidenceV1 =
  | {
      readonly kind: "declared-table";
      readonly name: string;
      readonly range: RangeV1;
      readonly headerRowCount: number;
      readonly totalsRowCount: number;
    }
  | {
      readonly kind: "number-format";
      readonly numberFormat: string;
      readonly formatClass: FormatClassV1;
      readonly currencySymbol: string | null;
      readonly matched: number;
      readonly sampled: number;
    }
  | {
      readonly kind: "validation-rule";
      readonly rule: ValidationRuleV1;
      readonly operator: ValidationOperatorV1 | null;
      readonly listSource: ValidationListSourceV1 | null;
      readonly formula1: string | null;
      readonly formula2: string | null;
      /**
       * A list's options as read from its source; `null` when the rule is not a
       * list, or its source range could not be read from what inference kept
       * (the field's options then come from its own values).
       */
      readonly listOptions: readonly string[] | null;
    }
  | {
      readonly kind: "lookup-formula";
      readonly functionName: string;
      /** The first formula that carried the lookup, as authored. */
      readonly formulaText: string;
      readonly parentSheetName: string;
      readonly parentTableName: string;
      readonly parentColumnName: string;
      /** `parent-key-differs`: the parent's key is another column, so nothing was proposed. */
      readonly outcome: "relationship" | "parent-key-differs";
    }
  | {
      readonly kind: "key-match";
      readonly parentTableName: string;
      readonly parentColumnName: string;
      /** Child values found among the parent's keys, out of `measured`. */
      readonly matched: number;
      readonly measured: number;
      /** True when the child column exceeded the sketch and only a sample was measured. */
      readonly isSampled: boolean;
    }
  | { readonly kind: "matching-headings"; readonly headings: readonly string[]; readonly rowIndex: number }
  | { readonly kind: "blank-row-gap"; readonly afterRowIndex: number; readonly beforeRowIndex: number }
  | { readonly kind: "column-gap"; readonly afterColumnIndex: number; readonly beforeColumnIndex: number }
  | {
      readonly kind: "formula-text";
      /** The column's first master formula; null when none could be decoded. */
      readonly text: string | null;
      readonly isArray: boolean;
      readonly isExternal: boolean;
      readonly formulaCount: number;
    }
  | {
      readonly kind: "sheet-shape";
      readonly sheetName: string;
      readonly sheetKind: SheetKindV1;
      readonly usedCellCount: number;
      readonly formulaCellCount: number;
      readonly tableCount: number;
    }
  | { readonly kind: "preserved-part"; readonly partKind: PreservedPartKindV1; readonly count: number }
  | { readonly kind: "previously-rejected" }
  | {
      /** What an imported formula becomes (F04, D51), re-derived after every review edit. */
      readonly kind: "formula-outcome";
      readonly target: "computed-column" | "table-metric" | "dashboard-value";
      readonly disposition: FormulaDispositionV1;
      readonly determinism: FormulaDeterminismV1;
      readonly reason: FormulaKeepReasonV1 | null;
      readonly detail: string | null;
      /** Cells holding the formula's shape, and (for a column) the rows it must fill. */
      readonly shapeMatchCount: number;
      readonly rowCount: number | null;
      readonly shapeBreakRowIndex: number | null;
      /** The parent table a lookup reads through its relationship. */
      readonly relatedTableName: string | null;
    }
  | {
      /** What an imported chart becomes (F04, D55), in the proposal's current names. */
      readonly kind: "chart-mapping";
      readonly chartType: ProposedChartTypeV1;
      readonly chartName: string;
      readonly tableName: string;
      readonly groupFieldName: string | null;
      readonly measure: "count" | "sum" | "average" | "min" | "max" | null;
      readonly measureFieldName: string | null;
      readonly xFieldName: string | null;
      readonly yFieldName: string | null;
      /** Excel plotted each row; Sheaf groups rows with the same category (D62). */
      readonly categoriesRepeat: boolean;
    };

export type WorkbookEvidenceV1 = EvidenceV1 | WorkbookStructureEvidenceV1;

const workbookTermsOf = (evidence: WorkbookEvidenceV1): readonly string[] => {
  switch (evidence.kind) {
    case "declared-table":
      return ["declared-table", evidence.name];
    case "number-format":
      return ["number-format", evidence.numberFormat];
    case "validation-rule": {
      const source = evidence.listSource;
      return [
        "validation-rule",
        evidence.rule,
        evidence.operator ?? "",
        ...(source === null ? [] : source.kind === "inline" ? source.values : [source.ref]),
        evidence.formula1 ?? "",
        evidence.formula2 ?? "",
      ];
    }
    case "lookup-formula":
      return ["lookup-formula", evidence.functionName, evidence.parentSheetName, evidence.parentColumnName, evidence.outcome];
    case "key-match":
      return ["key-match", evidence.parentTableName, evidence.parentColumnName];
    case "matching-headings":
      return ["matching-headings", ...evidence.headings];
    case "blank-row-gap":
      return ["blank-row-gap"];
    case "column-gap":
      return ["column-gap"];
    case "formula-text":
      return ["formula-text", evidence.text ?? ""];
    case "sheet-shape":
      return ["sheet-shape", evidence.sheetName];
    case "preserved-part":
      return ["preserved-part", evidence.partKind];
    case "previously-rejected":
      // A stored rejection is *why* the statement stands rejected, not what
      // it is about; letting it in would change the fingerprint it matched.
      return [];
    case "formula-outcome":
    case "chart-mapping":
      // Derived from the part and the structure, and re-derived by review
      // edits: the decision is about the formula text or the chart part.
      return [];
    default:
      return fingerprintTermsOf(evidence);
  }
};

/**
 * The workbook fingerprint input. `scope` names where the decision sits — the
 * sheet by name, the table by its declared name or its ordinal region on the
 * sheet, the column by position — and the evidence adds its qualitative terms.
 * The F02 rule holds: no counts, no examples, no row indexes, so appending
 * rows to a sheet leaves every fingerprint unchanged.
 */
export function workbookFingerprintInput(
  subject: WorkbookInferenceSubjectV1,
  scope: readonly (string | number)[],
  evidence: readonly WorkbookEvidenceV1[],
): string {
  return JSON.stringify(["sheaf.inference.v2", subject, ...scope, ...evidence.flatMap(workbookTermsOf)]);
}

export interface WorkbookStatementV1 {
  /** Stable across edits: `<subject>` or `<subject>:<targetKey>`. */
  readonly statementId: string;
  readonly subject: WorkbookInferenceSubjectV1;
  /** The edit that revises it; `null` when nothing can. */
  readonly editKind: WorkbookReviewEditKindV1 | null;
  /** The sheet, table, column, relationship or rule key it is about. */
  readonly targetKey: string | null;
  /** The sheet column, for a column statement. */
  readonly columnIndex: number | null;
  readonly evidence: readonly WorkbookEvidenceV1[];
  /** The exact string the promoting session hashes (M08 is the digest owner). */
  readonly evidenceFingerprint: string;
  readonly disposition: InferenceDispositionV1;
}

export const workbookStatementIdOf = (subject: WorkbookInferenceSubjectV1, targetKey: string | null): string =>
  targetKey === null ? subject : `${subject}:${targetKey}`;
