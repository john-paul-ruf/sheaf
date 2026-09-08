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

import type { InferenceDispositionV1 } from "../../domain/model/events.js";

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
