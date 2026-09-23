/**
 * Workbook validations as record rules (M21; CA-27, D52; CAP-36, FR-12).
 *
 * A `whole`, `decimal`, `date` or `text-length` validation with literal
 * bounds becomes one single-field rule over its column, in rule IR v2 terms:
 * `between` / `not-between` keep their inclusive bounds, every other operator
 * is a `compare` against the literal, and a `text-length` rule compares the
 * text's length. Excel's default operator is `between`. A `list` is an enum
 * (`types.ts`), and anything else — `custom`, `time`, a bound that is a
 * formula or a cell — stays an inert `unsupported-validation`: never a
 * guessed rule.
 */

import { dateValue, decimalValue, type CellValueV1 } from "../../domain/model/values.js";
import type { DateSystemV1, ValidationOperatorV1, WorkbookStructureFactV1 } from "../facts/index.js";
import { readDecimal, serialToEpochDay } from "./values.js";
import type { ProposedRuleConditionV1, RuleCompareOperatorV1 } from "./workbook-proposal.js";

type ValidationFact = Extract<WorkbookStructureFactV1, { kind: "validation" }>;

const COMPARE_OF: Readonly<Record<Exclude<ValidationOperatorV1, "between" | "not-between">, RuleCompareOperatorV1>> = Object.freeze({
  equal: "eq",
  "not-equal": "ne",
  "less-than": "lt",
  "less-than-or-equal": "le",
  "greater-than": "gt",
  "greater-than-or-equal": "ge",
});

/** One bound as the value it compares against, or `null` when it is not a literal of the rule's kind. */
const boundOf = (validation: ValidationFact, text: string | null, dateSystem: DateSystemV1 | null): CellValueV1 | null => {
  const trimmed = text?.trim() ?? "";
  if (validation.rule === "date") {
    const epochDay = dateSystem === null ? null : serialToEpochDay(trimmed, dateSystem);
    return epochDay === null ? null : dateValue(epochDay);
  }
  const decimal = readDecimal(trimmed);
  const isWhole = validation.rule === "whole" || validation.rule === "text-length";
  return decimal === null || (isWhole && decimal.includes(".")) ? null : decimalValue(decimal);
};

/** The rule a validation states over one column, or `null` when the rule IR cannot state it. */
export function ruleConditionOf(
  validation: ValidationFact,
  columnKey: string,
  dateSystem: DateSystemV1 | null,
): ProposedRuleConditionV1 | null {
  if (validation.rule !== "whole" && validation.rule !== "decimal" && validation.rule !== "date" && validation.rule !== "text-length") {
    return null;
  }
  const measure = validation.rule === "text-length" ? "text-length" : null;
  const operator = validation.operator ?? "between";
  const low = boundOf(validation, validation.formula1, dateSystem);
  if (low === null) return null;
  if (operator === "between" || operator === "not-between") {
    const high = boundOf(validation, validation.formula2, dateSystem);
    return high === null ? null : { kind: operator, columnKey, low, high, measure };
  }
  return { kind: "compare", columnKey, op: COMPARE_OF[operator], value: low, measure };
}
