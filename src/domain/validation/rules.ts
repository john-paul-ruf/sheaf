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
 * imported behavior (invariant 8). Cross-field comparisons are IR version 2
 * ({@link ValidationRuleIRV2}, D52); version 1 keeps decoding and evaluating
 * unchanged.
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

/** The typed order a `compare` condition asks about (D52). */
export const COMPARE_OPERATORS = Object.freeze(["lt", "le", "gt", "ge", "eq", "ne"] as const);

export type CompareOperatorV1 = (typeof COMPARE_OPERATORS)[number];

/**
 * What a v2 comparison measures on its field: the value itself, or — for a
 * workbook `text-length` validation (CA-27) — the text's length in code
 * points. Absent means the value.
 */
export type RuleMeasureV2 = "text-length";

/**
 * The record-rule IR, version 2 (D52, CA-27): every v1 condition, plus
 * `compare` (field against field or against a literal) and `between` /
 * `not-between` (inclusive bounds). Values compare under their typed order —
 * decimals numerically, dates by epoch day, text by NFC code point. A
 * comparison whose operand is missing, or whose operands differ in type, does
 * not fire: `required` and the type check already cover those.
 */
export type RuleConditionV2 =
  | Exclude<RuleConditionV1, { readonly kind: "all" | "any" | "not" }>
  | { readonly kind: "all"; readonly conditions: readonly RuleConditionV2[] }
  | { readonly kind: "any"; readonly conditions: readonly RuleConditionV2[] }
  | { readonly kind: "not"; readonly condition: RuleConditionV2 }
  | {
      readonly kind: "compare";
      readonly left: FieldId;
      readonly op: CompareOperatorV1;
      readonly right: { readonly field: FieldId } | { readonly value: CellValueV1 };
      readonly measure?: RuleMeasureV2;
    }
  | {
      readonly kind: "between" | "not-between";
      readonly fieldId: FieldId;
      readonly low: CellValueV1;
      readonly high: CellValueV1;
      readonly measure?: RuleMeasureV2;
    };

export interface ValidationRuleIRV2 {
  readonly irVersion: 2;
  readonly ruleId: RuleId;
  readonly condition: RuleConditionV2;
  readonly severity: ValidationSeverityV1;
  readonly messageKey: string;
  /** Field labels and the literal's type — never a cell value (CA-12). */
  readonly messageParameters: Readonly<Record<string, MessageParameterV1>>;
}

/** The message keys a v2 rule adds to the v1 keys (CA-27). */
export const RULE_V2_MESSAGE_KEYS = Object.freeze(["rule-compare", "rule-between"] as const);

/**
 * The `formula` issue keys (CA-26): a user write to a computed field, and the
 * computed-cell states the projection flags.
 */
export const FORMULA_ISSUE_MESSAGE_KEYS = Object.freeze([
  "computed-not-authored",
  "formula-result-type",
  "formula-error",
  "formula-cycle",
  "unsupported-formula",
  "missing-unsupported-formula",
] as const);

export type FormulaIssueMessageKeyV1 = (typeof FORMULA_ISSUE_MESSAGE_KEYS)[number];
