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
 *
 * **Broken references (D36).** In a `reference` field, two values are broken:
 *
 * - `invalid-preserved{sourceText}` — an imported key that matched no parent
 *   row. Only an import can produce it (the authored wire type excludes it),
 *   so it is always a **warning**.
 * - `reference{recordId}` that the resolver cannot find live in the field's
 *   target table. Its severity follows the value's **provenance in this
 *   write**: a value the user authors now (`source: "user"`) is **blocking** —
 *   a person cannot point at a record that is not there — while any other
 *   value (imported, or carried unchanged from an earlier write, such as a
 *   child whose parent was later deleted) is a **warning**, preserved and
 *   flagged.
 *
 * Both issue as `broken-reference` with `messageKey "validation.broken-reference"`
 * and parameters `{fieldLabel, targetTable}` — never the key text: a cell value
 * never rides an issue parameter (CA-12). The surface reads the original key
 * from the value itself.
 *
 * Provenance is part of the record, not a flag: {@link RecordUnderValidationV1}
 * states where each value in this write comes from, and a value it does not
 * name is not being authored by this write.
 */

import type { RecordId, TableId } from "../model/ids.js";
import { encodeDomainId, type FieldId } from "../model/ids.js";
import type { ValueProvenanceV1 } from "../model/provenance.js";
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

/**
 * True when `recordId` names a **live** record of `tableId`. One predicate,
 * several sources: the data worker answers it from the projection, promotion
 * from its in-memory key map — both are this type, so both mean the same thing.
 */
export type ReferenceResolver = (
  tableId: TableId,
  recordId: RecordId,
) => boolean;

/** The table a `reference` field's values point into (its relationship). */
export interface ReferenceTargetV1 {
  readonly fieldId: FieldId;
  readonly tableId: TableId;
  /** The target table's label, for the issue's `targetTable` parameter. */
  readonly tableLabel: string;
}

export interface ValidationContext {
  readonly table: TableDefV1;
  /** Active and inactive options, keyed by their enum field. */
  readonly enumOptions: ReadonlyMap<FieldId, readonly EnumOptionDefV1[]>;
  readonly rules: readonly ValidationRuleIR[];
  readonly referenceExists: ReferenceResolver;
  /**
   * The target of each reference field this table holds, from its active
   * relationships. A reference field with no entry points nowhere, so every
   * reference it holds is broken. Absent means the schema declares no
   * relationship — every delimited (F02) app, and exactly equivalent to `[]`.
   */
  readonly referenceTargets?: readonly ReferenceTargetV1[];
}

export interface RecordUnderValidationV1 {
  readonly recordId: RecordId;
  readonly tableId: TableId;
  readonly values: ReadonlyMap<FieldId, CellValueV1>;
  /**
   * Where each value in **this write** comes from. A field with
   * `source: "user"` is authored now; a field it does not name is carried from
   * an earlier write or an import. Absent means nothing is authored now.
   */
  readonly provenance?: ReadonlyMap<FieldId, ValueProvenanceV1>;
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

const brokenReference = (
  context: ValidationContext,
  field: FieldDefV1,
  severity: ValidationIssueV1["severity"],
): ValidationIssueV1 =>
  fieldIssue(field, "broken-reference", severity, "validation.broken-reference", {
    targetTable: targetOf(context, field)?.tableLabel ?? "",
  });

const targetOf = (
  context: ValidationContext,
  field: FieldDefV1,
): ReferenceTargetV1 | undefined =>
  (context.referenceTargets ?? []).find(
    (target) => encodeDomainId(target.fieldId) === encodeDomainId(field.fieldId),
  );

const isAuthoredNow = (
  record: RecordUnderValidationV1,
  field: FieldDefV1,
): boolean =>
  [...(record.provenance ?? [])].some(
    ([fieldId, provenance]) =>
      provenance.source === "user" &&
      encodeDomainId(fieldId) === encodeDomainId(field.fieldId),
  );

function checkField(
  context: ValidationContext,
  record: RecordUnderValidationV1,
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

  if (value.kind === "invalid-preserved" && field.type.kind === "reference") {
    // An imported key that matched no parent row (D36): kept, and flagged as
    // the broken reference it is rather than as a type mismatch.
    return [brokenReference(context, field, "warning")];
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

  if (value.kind === "reference") {
    const target = targetOf(context, field);
    if (target === undefined || !context.referenceExists(target.tableId, value.recordId)) {
      issues.push(
        brokenReference(
          context,
          field,
          isAuthoredNow(record, field) ? "blocking" : "warning",
        ),
      );
    }
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
    issues.push(
      ...checkField(context, record, field, valueOf(record, field.fieldId)),
    );
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
