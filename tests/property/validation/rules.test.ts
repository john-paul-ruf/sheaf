import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { asDomainId, type FieldId } from "../../../src/domain/model/ids.js";
import type { EnumOptionDefV1, FieldTypeV1, TableDefV1 } from "../../../src/domain/model/schema.js";
import { cellValuesEqual, isAbsentCellValue, MISSING_VALUE, type CellValueV1 } from "../../../src/domain/model/values.js";
import type { RuleConditionV1, ValidationRuleIR } from "../../../src/domain/validation/rules.js";
import { analyzeSchemaChange, type SchemaSnapshotV1 } from "../../../src/domain/validation/schema-impact.js";
import { ruleHolds, validateRecord, type RecordUnderValidationV1 } from "../../../src/domain/validation/validate-record.js";

const tableId = asDomainId("table", new Uint8Array(16).fill(1));
const ruleId = asDomainId("rule", new Uint8Array(16).fill(2));
const FIELDS: readonly FieldId[] = [1, 2, 3].map((n) => asDomainId("field", new Uint8Array(16).fill(10 + n)));
const OPTIONS: readonly EnumOptionDefV1[] = ["Open", "Paid"].map((label, index) => ({
  optionId: asDomainId("option", new Uint8Array(16).fill(40 + index)),
  fieldId: FIELDS[0] as FieldId,
  displayLabel: label,
  optionOrdinal: index,
  isActive: true,
  schemaRevision: 1n,
}));

const value: fc.Arbitrary<CellValueV1> = fc.oneof(
  fc.constantFrom("12", " 7.50 ", "TBD", "2026-03-09", "Paid", "true", "", "-0", "1,000", "Open").map((text): CellValueV1 => ({ kind: "text", text })),
  fc.constantFrom("0", "10.50", "-3").map((decimal): CellValueV1 => ({ kind: "decimal", decimal })),
  fc.integer({ min: -1000, max: 30_000 }).map((epochDay): CellValueV1 => ({ kind: "date", epochDay })),
  fc.boolean().map((boolean): CellValueV1 => ({ kind: "boolean", boolean })),
  fc.constantFrom<CellValueV1>(MISSING_VALUE, { kind: "blank" }, { kind: "invalid-preserved", sourceText: "n/a" }, { kind: "invalid-preserved", sourceText: "42" }),
);

const condition: fc.Arbitrary<RuleConditionV1> = fc.letrec<{ node: RuleConditionV1 }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small" },
    fc.constantFrom(...FIELDS).map((fieldId): RuleConditionV1 => ({ kind: "field-present", fieldId })),
    fc.constantFrom(...FIELDS).map((fieldId): RuleConditionV1 => ({ kind: "field-absent", fieldId })),
    fc.record({ kind: fc.constant("field-equals" as const), fieldId: fc.constantFrom(...FIELDS), value }),
    fc.record({ kind: fc.constant("all" as const), conditions: fc.array(tie("node"), { maxLength: 3 }) }),
    fc.record({ kind: fc.constant("any" as const), conditions: fc.array(tie("node"), { maxLength: 3 }) }),
    fc.record({ kind: fc.constant("not" as const), condition: tie("node") }),
  ),
})).node;

/** The F02/F03 v1 evaluator, verbatim in meaning: two-valued and total. */
const v1Holds = (rule: RuleConditionV1, record: RecordUnderValidationV1): boolean => {
  const read = (fieldId: FieldId) => record.values.get(fieldId) ?? MISSING_VALUE;
  switch (rule.kind) {
    case "field-present":
      return !isAbsentCellValue(read(rule.fieldId));
    case "field-absent":
      return isAbsentCellValue(read(rule.fieldId));
    case "field-equals":
      return cellValuesEqual(read(rule.fieldId), rule.value);
    case "all":
      return rule.conditions.every((nested) => v1Holds(nested, record));
    case "any":
      return rule.conditions.some((nested) => v1Holds(nested, record));
    case "not":
      return !v1Holds(rule.condition, record);
  }
};

const records = fc.array(fc.array(value, { minLength: 3, maxLength: 3 }), { maxLength: 30 }).map((rows) =>
  rows.map(
    (values, index): RecordUnderValidationV1 => ({
      recordId: asDomainId("record", new Uint8Array(16).fill(index + 1)),
      tableId,
      values: new Map(FIELDS.map((fieldId, column) => [fieldId, values[column] as CellValueV1])),
    }),
  ),
);

const tableWith = (type: FieldTypeV1): TableDefV1 => ({
  tableId,
  displayName: "Jobs",
  tableOrdinal: 0,
  fields: FIELDS.map((fieldId, index) => ({
    fieldId,
    tableId,
    displayName: `field ${index}`,
    fieldOrdinal: index,
    type: index === 0 ? type : { kind: "text" },
    isRequired: false,
    isActive: true,
    schemaRevision: 1n,
  })),
  keyFieldId: null,
  labelFieldId: null,
  sourceSheetId: null,
  isActive: true,
  schemaRevision: 1n,
});

const newType = fc.constantFrom<FieldTypeV1>({ kind: "number" }, { kind: "currency", currencyCode: "USD" }, { kind: "date" }, { kind: "text" }, { kind: "boolean" }, { kind: "enum" }, { kind: "email" });

describe("record rule properties", () => {
  it("evaluates every v1 rule identically through the v2 path", () => {
    fc.assert(
      fc.property(condition, records, (rule, rows) => {
        const ir: ValidationRuleIR = { irVersion: 1, ruleId, condition: rule, severity: "warning", messageKey: "rule.x", messageParameters: {} };
        for (const row of rows) expect(ruleHolds(ir, row)).toBe(v1Holds(rule, row));
      }),
    );
  });
});

describe("schema impact properties", () => {
  const schemaFor = (type: FieldTypeV1): SchemaSnapshotV1 => ({
    tables: [tableWith({ kind: "text" })],
    enumOptions: type.kind === "enum" ? OPTIONS : [],
    relationships: [],
    rules: [],
    formulas: [],
  });
  const env = { resolveKey: () => null, referenceExists: () => false, formulaResult: () => ({ kind: "empty" as const }) };

  it("counts sum to the table size for every change", () => {
    fc.assert(
      fc.property(records, newType, fc.boolean(), (rows, type, isRequired) => {
        const field = FIELDS[0] as FieldId;
        for (const change of [
          { kind: "change-field-type" as const, fieldId: field, type },
          { kind: "set-required" as const, fieldId: field, isRequired },
          { kind: "rename-field" as const, fieldId: field, name: "Renamed" },
        ]) {
          const report = analyzeSchemaChange(change, schemaFor(type), rows, env);
          expect(report.total).toBe(rows.length);
          expect(report.affected + report.unchanged).toBe(rows.length);
          if (change.kind === "change-field-type") expect(report.converted + report.keptAndFlagged + report.unchanged).toBe(rows.length);
        }
      }),
    );
  });

  it("re-validating every converted record yields exactly keptAndFlagged type issues", () => {
    fc.assert(
      fc.property(records, newType, (rows, type) => {
        const field = FIELDS[0] as FieldId;
        const report = analyzeSchemaChange({ kind: "change-field-type", fieldId: field, type }, schemaFor(type), rows, env);
        const patched = new Map(report.patches.map((patch) => [patch.recordId.join(), patch.value]));
        const context = { table: tableWith(type), enumOptions: new Map([[field, OPTIONS]]), rules: [], referenceExists: () => false };
        const typeIssues = rows
          .map((row) => {
            const values = new Map(row.values);
            const replacement = patched.get(row.recordId.join());
            if (replacement !== undefined) values.set(field, replacement);
            return validateRecord(context, { ...row, values }).issues.filter((issue) => issue.kind === "type" && issue.fieldId === field).length;
          })
          .reduce((sum, count) => sum + count, 0);
        expect(typeIssues).toBe(report.keptAndFlagged);
      }),
    );
  });
});
