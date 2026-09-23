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
 *
 * **Computed fields (D51).** A field with a `formulaId` is skipped by the
 * required and type checks: its value is derived, or — for a frozen or
 * unsupported formula — an imported literal kept with its provenance. A value
 * this write authors for it (`source: "user"`) is a blocking `formula` issue
 * `computed-not-authored`, unless it is the frozen literal the command
 * evaluated once (`evidence.frozen`).
 *
 * **Record rules.** v1 and v2 rules evaluate through one path. A v2
 * comparison over a missing value or mismatched types is undetermined and
 * does not fire; `all`/`any`/`not` combine undetermined results the way
 * three-valued logic does, so a v1 rule — always determined — evaluates
 * exactly as before.
 */

import type { RecordId, TableId } from "../model/ids.js";
import { encodeDomainId, type FieldId } from "../model/ids.js";
import type { ValueProvenanceV1 } from "../model/provenance.js";
import type { EnumOptionDefV1, FieldDefV1, TableDefV1 } from "../model/schema.js";
import { expectedCellKindForFieldType, isComputedField } from "../model/schema.js";
import {
  cellValuesEqual,
  isAbsentCellValue,
  MISSING_VALUE,
  type CellValueV1,
} from "../model/values.js";
import {
  buildReport,
  type CompareOperatorV1,
  type RuleConditionV2,
  type RuleMeasureV2,
  type ValidationIssueV1,
  type ValidationReport,
  type ValidationRuleIR,
  type ValidationRuleIRV2,
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
  readonly rules: readonly (ValidationRuleIR | ValidationRuleIRV2)[];
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

const provenanceNow = (
  record: RecordUnderValidationV1,
  field: FieldDefV1,
): ValueProvenanceV1 | undefined =>
  [...(record.provenance ?? [])].find(
    ([fieldId]) => encodeDomainId(fieldId) === encodeDomainId(field.fieldId),
  )?.[1];

const isAuthoredNow = (
  record: RecordUnderValidationV1,
  field: FieldDefV1,
): boolean => provenanceNow(record, field)?.source === "user";

/** The literal a frozen formula's one evaluation produced (D51). */
const isFrozenLiteral = (provenance: ValueProvenanceV1): boolean =>
  typeof provenance.evidence === "object" &&
  provenance.evidence !== null &&
  "frozen" in provenance.evidence;

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

/** Code-point order of NFC text — not UTF-16 unit order, not a locale collation. */
const compareText = (left: string, right: string): number => {
  const a = [...left.normalize("NFC")];
  const b = [...right.normalize("NFC")];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index]?.codePointAt(0) ?? 0) - (b[index]?.codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
};

/** Numeric order of two canonical decimal strings, without a float. */
const compareDecimalText = (left: string, right: string): number => {
  const sign = (text: string): number =>
    text.startsWith("-") ? -1 : /^0(\.0+)?$/.test(text) ? 0 : 1;
  if (sign(left) !== sign(right)) return sign(left) - sign(right);
  const [leftInteger = "", leftFraction = ""] = left.replace("-", "").split(".");
  const [rightInteger = "", rightFraction = ""] = right.replace("-", "").split(".");
  const width = Math.max(leftFraction.length, rightFraction.length);
  const a = `${leftInteger.padStart(40, "0")}${leftFraction.padEnd(width, "0")}`;
  const b = `${rightInteger.padStart(40, "0")}${rightFraction.padEnd(width, "0")}`;
  const magnitude = a < b ? -1 : a > b ? 1 : 0;
  return sign(left) < 0 ? -magnitude : magnitude;
};

/** The typed order of two values, or `null` when they are not comparable. */
function compareTyped(left: CellValueV1, right: CellValueV1): number | null {
  if (left.kind === "decimal" && right.kind === "decimal") return compareDecimalText(left.decimal, right.decimal);
  if (left.kind === "date" && right.kind === "date") return left.epochDay - right.epochDay;
  if (left.kind === "text" && right.kind === "text") return compareText(left.text, right.text);
  return null;
}

const measured = (value: CellValueV1, measure: RuleMeasureV2 | undefined): CellValueV1 | null => {
  if (isAbsentCellValue(value)) return null;
  if (measure === undefined) return value;
  return value.kind === "text"
    ? { kind: "decimal", decimal: String([...value.text].length) }
    : null;
};

const holds = (operator: CompareOperatorV1, order: number): boolean => {
  switch (operator) {
    case "lt":
      return order < 0;
    case "le":
      return order <= 0;
    case "gt":
      return order > 0;
    case "ge":
      return order >= 0;
    case "eq":
      return order === 0;
    case "ne":
      return order !== 0;
    default: {
      const unreachable: never = operator;
      return unreachable;
    }
  }
};

/** `true`/`false`, or `null` when a comparison cannot be decided (three-valued). */
function evaluateCondition(
  condition: RuleConditionV2,
  record: RecordUnderValidationV1,
): boolean | null {
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
    case "all": {
      const results = condition.conditions.map((nested) => evaluateCondition(nested, record));
      return results.includes(false) ? false : results.includes(null) ? null : true;
    }
    case "any": {
      const results = condition.conditions.map((nested) => evaluateCondition(nested, record));
      return results.includes(true) ? true : results.includes(null) ? null : false;
    }
    case "not": {
      const result = evaluateCondition(condition.condition, record);
      return result === null ? null : !result;
    }
    case "compare": {
      const left = measured(valueOf(record, condition.left), condition.measure);
      const right =
        "field" in condition.right
          ? measured(valueOf(record, condition.right.field), condition.measure)
          : condition.right.value;
      const order = left === null || right === null ? null : compareTyped(left, right);
      return order === null ? null : holds(condition.op, order);
    }
    case "between":
    case "not-between": {
      const value = measured(valueOf(record, condition.fieldId), condition.measure);
      const low = value === null ? null : compareTyped(value, condition.low);
      const high = value === null ? null : compareTyped(value, condition.high);
      if (low === null || high === null) return null;
      const isInside = low >= 0 && high <= 0;
      return condition.kind === "between" ? isInside : !isInside;
    }
    default: {
      const unreachable: never = condition;
      return unreachable;
    }
  }
}

/**
 * True unless the record definitely breaks the rule. An undetermined v2
 * comparison does not fire. Schema-impact analysis counts failing records
 * through this same function (CA-27).
 */
export function ruleHolds(
  rule: ValidationRuleIR | ValidationRuleIRV2,
  record: RecordUnderValidationV1,
): boolean {
  return evaluateCondition(rule.condition, record) !== false;
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
    if (isComputedField(field)) {
      const provenance = provenanceNow(record, field);
      if (provenance?.source === "user" && !isFrozenLiteral(provenance)) {
        issues.push(
          fieldIssue(field, "formula", "blocking", "computed-not-authored"),
        );
      }
      continue;
    }
    issues.push(
      ...checkField(context, record, field, valueOf(record, field.fieldId)),
    );
  }

  for (const rule of context.rules) {
    if (!ruleHolds(rule, record)) {
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
