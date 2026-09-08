/**
 * The validation vocabulary: what can be wrong, how loudly, and the closed IR
 * for record-level rules.
 *
 * Issue kinds and severities are migration 005's `record_issues` closed sets —
 * a report row must be storable as a projection row without translation, so
 * the two lists are pinned against each other in
 * `tests/unit/validation/rules.test.ts`.
 *
 * **Reasons are structured, never prose.** An issue carries a `messageKey` and
 * typed `messageParameters`; the user-language sentence is a view-model
 * concern (M37). Parameters carry field labels, expected types, and counts —
 * never the offending cell value, which the caller already holds and which
 * must not travel through error-shaped channels (CA-12).
 *
 * F02's CSV import emits no record-level rules (there is nothing in a
 * delimited file that declares one), but the engine that evaluates them ships
 * here so CRUD, restore, merge, and adoption replay all run the same one
 * (invariant 5).
 */

import type { FieldId, RuleId } from "../model/ids.js";
import type { CellValueV1 } from "../model/values.js";

export const VALIDATION_ISSUE_KINDS = Object.freeze([
  "type",
  "required",
  "enum",
  "broken-reference",
  "record-rule",
  "formula",
  "schema",
  "conflict",
  "unsupported",
] as const);

export type ValidationIssueKindV1 = (typeof VALIDATION_ISSUE_KINDS)[number];

export const VALIDATION_SEVERITIES = Object.freeze([
  "warning",
  "blocking",
] as const);

export type ValidationSeverityV1 = (typeof VALIDATION_SEVERITIES)[number];

/** Safe structured details: labels, types, and counts — never cell values. */
export type MessageParameterV1 = string | number | bigint | boolean;

export interface ValidationIssueV1 {
  /** Null for a whole-record issue. */
  readonly fieldId: FieldId | null;
  /** Set only when a record-level rule produced the issue. */
  readonly ruleId: RuleId | null;
  readonly kind: ValidationIssueKindV1;
  readonly severity: ValidationSeverityV1;
  readonly messageKey: string;
  readonly messageParameters: Readonly<Record<string, MessageParameterV1>>;
}

export interface ValidationReport {
  /** True when no issue is `blocking`; warnings never refuse a write. */
  readonly isValid: boolean;
  readonly issues: readonly ValidationIssueV1[];
}

export function buildReport(
  issues: readonly ValidationIssueV1[],
): ValidationReport {
  return {
    isValid: !issues.some((issue) => issue.severity === "blocking"),
    issues,
  };
}

/**
 * The closed record-rule IR. A record satisfies a rule when its `condition`
 * evaluates true; the rule's `messageKey` explains the failure otherwise.
 *
 * The language is deliberately tiny and total: no arithmetic, no function
 * calls, no user-supplied text to interpret — nothing that could execute
 * imported behavior (invariant 8). Formula-backed conditions arrive with the
 * formula engine in F04, as a new IR version.
 */
export type RuleConditionV1 =
  | { readonly kind: "field-present"; readonly fieldId: FieldId }
  | { readonly kind: "field-absent"; readonly fieldId: FieldId }
  | {
      readonly kind: "field-equals";
      readonly fieldId: FieldId;
      readonly value: CellValueV1;
    }
  | { readonly kind: "all"; readonly conditions: readonly RuleConditionV1[] }
  | { readonly kind: "any"; readonly conditions: readonly RuleConditionV1[] }
  | { readonly kind: "not"; readonly condition: RuleConditionV1 };

export interface ValidationRuleIR {
  readonly irVersion: 1;
  readonly ruleId: RuleId;
  readonly condition: RuleConditionV1;
  readonly severity: ValidationSeverityV1;
  readonly messageKey: string;
  readonly messageParameters: Readonly<Record<string, MessageParameterV1>>;
}
