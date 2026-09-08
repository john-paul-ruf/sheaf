/**
 * The one shared validator (architectural invariant 5).
 *
 * The *same* {@link validateRecord} call decides an authored create, an
 * authored patch, a restore, an import promotion, an automatic merge, and an
 * adoption replay. There is no options argument, no flag, and no second entry
 * point: a caller cannot skip the referential or cross-field checks because
 * the signature gives it nothing to skip them with.
 *
 * What it does **not** do is coerce. An imported value that does not fit its
 * field stays exactly as authored and is reported as a `type` warning (FR-4);
 * a broken reference is preserved and flagged rather than refused the way a
 * SQL foreign key would refuse it. Blocking issues are reserved for what a
 * user authored and can fix now.
 */

import type { RecordId, TableId } from "../model/ids.js";
import { encodeDomainId, type FieldId } from "../model/ids.js";
import type { EnumOptionDefV1, FieldDefV1, TableDefV1 } from "../model/schema.js";
import { expectedCellKindForFieldType } from "../model/schema.js";
import {
  cellValuesEqual,
  isAbsentCellValue,
  MISSING_VALUE,
  type CellValueV1,
} from "../model/values.js";
import {
  buildReport,
  type RuleConditionV1,
  type ValidationIssueV1,
  type ValidationReport,
  type ValidationRuleIR,
} from "./rules.js";

/** Resolves whether a referenced record exists. F02 has no references (D25). */
export type ReferenceResolver = (
  tableId: TableId,
  recordId: RecordId,
) => boolean;

export interface ValidationContext {
  readonly table: TableDefV1;
  /** Active and inactive options, keyed by their enum field. */
  readonly enumOptions: ReadonlyMap<FieldId, readonly EnumOptionDefV1[]>;
  readonly rules: readonly ValidationRuleIR[];
  readonly referenceExists: ReferenceResolver;
}

export interface RecordUnderValidationV1 {
  readonly recordId: RecordId;
  readonly tableId: TableId;
  readonly values: ReadonlyMap<FieldId, CellValueV1>;
}

const valueOf = (
  record: RecordUnderValidationV1,
  fieldId: FieldId,
): CellValueV1 => record.values.get(fieldId) ?? MISSING_VALUE;

const fieldIssue = (
  field: FieldDefV1,
  kind: ValidationIssueV1["kind"],
  severity: ValidationIssueV1["severity"],
  messageKey: string,
  messageParameters: ValidationIssueV1["messageParameters"] = {},
): ValidationIssueV1 => ({
  fieldId: field.fieldId,
  ruleId: null,
  kind,
  severity,
  messageKey,
  messageParameters: { fieldLabel: field.displayName, ...messageParameters },
});

function checkField(
  context: ValidationContext,
  field: FieldDefV1,
  value: CellValueV1,
): readonly ValidationIssueV1[] {
  const issues: ValidationIssueV1[] = [];

  if (isAbsentCellValue(value)) {
    if (field.isRequired) {
      issues.push(
        fieldIssue(field, "required", "blocking", "validation.required"),
      );
    }
    return issues;
  }

  if (value.kind === "invalid-preserved") {
    // Kept verbatim and flagged. Never coerced, never dropped, and never a
    // blocking issue: refusing it would lose the user's data (FR-4).
    return [
      fieldIssue(field, "type", "warning", "validation.preserved-invalid", {
        expectedType: field.type.kind,
      }),
    ];
  }

  const expected = expectedCellKindForFieldType(field.type);
  if (value.kind !== expected) {
    return [
      fieldIssue(field, "type", "blocking", "validation.wrong-type", {
        expectedType: field.type.kind,
        actualKind: value.kind,
      }),
    ];
  }

  if (value.kind === "enum") {
    const options = context.enumOptions.get(field.fieldId) ?? [];
    const member = options.find(
      (option) => encodeDomainId(option.optionId) === encodeDomainId(value.optionId),
    );
    if (member === undefined) {
      issues.push(
        fieldIssue(field, "enum", "blocking", "validation.unknown-option", {
          optionCount: options.length,
        }),
      );
    } else if (!member.isActive) {
      // A removed option stays interpretable in history rather than erasing
      // the value that used it.
      issues.push(
        fieldIssue(field, "enum", "warning", "validation.inactive-option", {
          optionLabel: member.displayLabel,
        }),
      );
    }
  }

  if (
    value.kind === "reference" &&
    !context.referenceExists(field.tableId, value.recordId)
  ) {
    issues.push(
      fieldIssue(
        field,
        "broken-reference",
        "warning",
        "validation.broken-reference",
      ),
    );
  }

  return issues;
}

function evaluateCondition(
  condition: RuleConditionV1,
  record: RecordUnderValidationV1,
): boolean {
  switch (condition.kind) {
    case "field-present":
      return !isAbsentCellValue(valueOf(record, condition.fieldId));
    case "field-absent":
      return isAbsentCellValue(valueOf(record, condition.fieldId));
    case "field-equals":
      return cellValuesEqual(
        valueOf(record, condition.fieldId),
        condition.value,
      );
    case "all":
      return condition.conditions.every((nested) =>
        evaluateCondition(nested, record),
      );
    case "any":
      return condition.conditions.some((nested) =>
        evaluateCondition(nested, record),
      );
    case "not":
      return !evaluateCondition(condition.condition, record);
    default: {
      const unreachable: never = condition;
      return unreachable;
    }
  }
}

/**
 * Validates one record against its table, its enum options, its record-level
 * rules, and the reference resolver — all of them, always.
 */
export function validateRecord(
  context: ValidationContext,
  record: RecordUnderValidationV1,
): ValidationReport {
  const issues: ValidationIssueV1[] = [];

  if (encodeDomainId(record.tableId) !== encodeDomainId(context.table.tableId)) {
    return buildReport([
      {
        fieldId: null,
        ruleId: null,
        kind: "schema",
        severity: "blocking",
        messageKey: "validation.wrong-table",
        messageParameters: { tableLabel: context.table.displayName },
      },
    ]);
  }

  const known = new Set(
    context.table.fields.map((field) => encodeDomainId(field.fieldId)),
  );
  for (const fieldId of record.values.keys()) {
    if (!known.has(encodeDomainId(fieldId))) {
      issues.push({
        fieldId,
        ruleId: null,
        kind: "schema",
        severity: "blocking",
        messageKey: "validation.unknown-field",
        messageParameters: { tableLabel: context.table.displayName },
      });
    }
  }

  for (const field of context.table.fields) {
    if (!field.isActive) {
      // Values of a retired field stay readable; they are not re-validated
      // against a definition the user no longer edits against.
      continue;
    }
    issues.push(...checkField(context, field, valueOf(record, field.fieldId)));
  }

  for (const rule of context.rules) {
    if (!evaluateCondition(rule.condition, record)) {
      issues.push({
        fieldId: null,
        ruleId: rule.ruleId,
        kind: "record-rule",
        severity: rule.severity,
        messageKey: rule.messageKey,
        messageParameters: rule.messageParameters,
      });
    }
  }

  return buildReport(issues);
}
