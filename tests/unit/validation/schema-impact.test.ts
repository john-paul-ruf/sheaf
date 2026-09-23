import { describe, expect, it } from "vitest";
import type { EvaluationResultV1, FormulaDefinitionV1 } from "../../../src/domain/formulas/index.js";
import { asDomainId, encodeDomainId, type FieldId, type RecordId } from "../../../src/domain/model/ids.js";
import type { EnumOptionDefV1, FieldDefV1, FieldTypeV1, RelationshipDefV1, TableDefV1 } from "../../../src/domain/model/schema.js";
import {
  booleanValue,
  dateValue,
  decimalValue,
  enumValue,
  invalidPreservedValue,
  MISSING_VALUE,
  referenceValue,
  textValue,
  type CellValueV1,
} from "../../../src/domain/model/values.js";
import {
  analyzeSchemaChange,
  convertValueForType,
  validateSchemaTransition,
  type ImpactEnvV1,
  type SchemaSnapshotV1,
} from "../../../src/domain/validation/schema-impact.js";
import type { RecordUnderValidationV1 } from "../../../src/domain/validation/validate-record.js";
import { isCanonicalDecimalText, isoDateToEpochDay } from "../../../src/ui/records/values.js";

const id = <K extends "table" | "field" | "record" | "option" | "relationship" | "rule" | "formula">(kind: K, n: number) =>
  asDomainId(kind, new Uint8Array(16).fill(n));

const JOBS = id("table", 1);
const CUSTOMERS = id("table", 2);
const JOB_ID = id("field", 10);
const CUSTOMER = id("field", 11);
const AMOUNT = id("field", 12);
const STATUS = id("field", 13);
const BALANCE = id("field", 14);
const CUSTOMER_ID = id("field", 20);
const OPEN = id("option", 30);
const PAID = id("option", 31);
const LINK = id("relationship", 40);
const BALANCE_FORMULA = id("formula", 50);

const fieldDef = (fieldId: FieldId, tableId: typeof JOBS, ordinal: number, type: FieldTypeV1, extra: Partial<FieldDefV1> = {}): FieldDefV1 => ({
  fieldId,
  tableId,
  displayName: `field ${fieldId[0] ?? 0}`,
  fieldOrdinal: ordinal,
  type,
  isRequired: false,
  isActive: true,
  schemaRevision: 1n,
  ...extra,
});

const table = (tableId: typeof JOBS, ordinal: number, fields: readonly FieldDefV1[], keyFieldId: FieldId): TableDefV1 => ({
  tableId,
  displayName: `table ${tableId[0] ?? 0}`,
  tableOrdinal: ordinal,
  fields,
  keyFieldId,
  labelFieldId: null,
  sourceSheetId: null,
  isActive: true,
  schemaRevision: 1n,
});

const option = (optionId: typeof OPEN, label: string, ordinal: number, isActive = true): EnumOptionDefV1 => ({
  optionId,
  fieldId: STATUS,
  displayLabel: label,
  optionOrdinal: ordinal,
  isActive,
  schemaRevision: 1n,
});

const balanceFormula: FormulaDefinitionV1 = {
  formulaId: BALANCE_FORMULA,
  target: { kind: "computed-column", tableId: JOBS, fieldId: BALANCE },
  displayName: null,
  originalText: "[Amount]*2",
  document: null,
  disposition: "unsupported",
  determinism: "unsupported",
  dependencies: [],
};

const schema: SchemaSnapshotV1 = {
  tables: [
    table(
      JOBS,
      0,
      [
        fieldDef(JOB_ID, JOBS, 0, { kind: "text" }),
        fieldDef(CUSTOMER, JOBS, 1, { kind: "text" }),
        fieldDef(AMOUNT, JOBS, 2, { kind: "text" }),
        fieldDef(STATUS, JOBS, 3, { kind: "enum" }),
        fieldDef(BALANCE, JOBS, 4, { kind: "number" }, { formulaId: BALANCE_FORMULA }),
      ],
      JOB_ID,
    ),
    table(CUSTOMERS, 1, [fieldDef(CUSTOMER_ID, CUSTOMERS, 0, { kind: "text" })], CUSTOMER_ID),
  ],
  enumOptions: [option(OPEN, "Open", 0), option(PAID, "Paid", 1)],
  relationships: [],
  rules: [],
  formulas: [balanceFormula],
};

const record = (n: number, values: readonly (readonly [FieldId, CellValueV1])[]): RecordUnderValidationV1 => ({
  recordId: id("record", n),
  tableId: JOBS,
  values: new Map(values),
});

const records = [
  record(1, [[AMOUNT, textValue("12")], [CUSTOMER, textValue("C-1")], [STATUS, enumValue(OPEN)]]),
  record(2, [[AMOUNT, textValue(" 7.50 ")], [CUSTOMER, textValue("C-9")], [STATUS, enumValue(PAID)]]),
  record(3, [[AMOUNT, textValue("TBD")], [STATUS, enumValue(PAID)]]),
  record(4, [[AMOUNT, invalidPreservedValue("1e3")]]),
  record(5, []),
];

const CUSTOMER_ONE: RecordId = id("record", 90);
const env: ImpactEnvV1 = {
  resolveKey: (tableId, keyText) => (encodeDomainId(tableId) === encodeDomainId(CUSTOMERS) && keyText === "C-1" ? CUSTOMER_ONE : null),
  referenceExists: (_, recordId) => encodeDomainId(recordId) === encodeDomainId(CUSTOMER_ONE),
  formulaResult: (_, row): EvaluationResultV1 =>
    row.values.has(AMOUNT) ? { kind: "error", code: "#VALUE!" } : { kind: "empty" },
};

describe("analyzeSchemaChange (CA-28, D57)", () => {
  it("counts a type change exactly and returns every rewritten value, discarding none", () => {
    const report = analyzeSchemaChange({ kind: "change-field-type", fieldId: AMOUNT, type: { kind: "number" } }, schema, records, env);
    expect(report).toMatchObject({ change: "change-field-type", total: 5, affected: 4, converted: 2, keptAndFlagged: 2, unchanged: 1 });
    expect(report.patches).toEqual([
      { recordId: id("record", 1), fieldId: AMOUNT, value: decimalValue("12") },
      { recordId: id("record", 2), fieldId: AMOUNT, value: decimalValue("7.50") },
      { recordId: id("record", 3), fieldId: AMOUNT, value: invalidPreservedValue("TBD") },
    ]);
  });

  it("counts required, removed enum options, and failing rules", () => {
    expect(analyzeSchemaChange({ kind: "set-required", fieldId: CUSTOMER, isRequired: true }, schema, records, env)).toMatchObject({
      missingNow: 3,
      affected: 3,
      unchanged: 2,
    });
    expect(analyzeSchemaChange({ kind: "set-required", fieldId: CUSTOMER, isRequired: false }, schema, records, env).affected).toBe(0);
    const options = [option(OPEN, "Open", 0), option(PAID, "Paid", 1, false)];
    expect(analyzeSchemaChange({ kind: "set-enum-options", fieldId: STATUS, options }, schema, records, env)).toMatchObject({
      onRemovedOptions: 2,
      patches: [],
    });
    const rule = {
      irVersion: 2 as const,
      ruleId: id("rule", 60),
      condition: { kind: "field-present" as const, fieldId: CUSTOMER },
      severity: "warning" as const,
      messageKey: "rule-compare",
      messageParameters: {},
    };
    expect(analyzeSchemaChange({ kind: "save-rule", tableId: JOBS, displayName: "Customer set", rule }, schema, records, env).failingRule).toBe(3);
    expect(analyzeSchemaChange({ kind: "remove-rule", ruleId: rule.ruleId }, { ...schema, rules: [rule] }, records, env).failingRule).toBe(3);
  });

  it("matches keys when a text field becomes a reference, keeping unmatched keys", () => {
    const relationship: RelationshipDefV1 = {
      relationshipId: LINK,
      fromTableId: JOBS,
      fromFieldId: CUSTOMER,
      toTableId: CUSTOMERS,
      toKeyFieldId: CUSTOMER_ID,
      detectionSource: "user",
      isActive: true,
      schemaRevision: 2n,
    };
    const report = analyzeSchemaChange({ kind: "set-relationship", relationship }, schema, records, env);
    expect(report).toMatchObject({ matchedKeys: 1, unmatchedKeys: 1, affected: 2, unchanged: 3 });
    expect(report.patches).toEqual([
      { recordId: id("record", 1), fieldId: CUSTOMER, value: referenceValue(CUSTOMER_ONE) },
      { recordId: id("record", 2), fieldId: CUSTOMER, value: invalidPreservedValue("C-9") },
    ]);

    const linked: SchemaSnapshotV1 = {
      ...schema,
      tables: schema.tables.map((candidate) => ({
        ...candidate,
        fields: candidate.fields.map((field) => (field.fieldId === CUSTOMER ? { ...field, type: { kind: "reference" as const } } : field)),
      })),
      relationships: [relationship],
    };
    const linkedRecords = [record(1, [[CUSTOMER, referenceValue(CUSTOMER_ONE)]]), record(2, [[CUSTOMER, referenceValue(id("record", 91))]]), record(3, [])];
    expect(analyzeSchemaChange({ kind: "set-relationship", relationship }, linked, linkedRecords, env)).toMatchObject({
      matchedKeys: 1,
      unmatchedKeys: 1,
      patches: [],
    });
    expect(analyzeSchemaChange({ kind: "remove-relationship", relationshipId: LINK, rejectionFingerprint: null }, linked, linkedRecords, env)).toMatchObject({
      unlinkedReferences: 2,
      patches: [],
    });
  });

  it("counts records a saved computed column would put in error, through the injected evaluator", () => {
    expect(analyzeSchemaChange({ kind: "save-formula", formula: balanceFormula, field: null }, schema, records, env)).toMatchObject({
      formulaErrors: 4,
      unchanged: 1,
    });
    expect(analyzeSchemaChange({ kind: "rename-field", fieldId: AMOUNT, name: "Amount" }, schema, records, env)).toMatchObject({
      total: 5,
      affected: 0,
      unchanged: 5,
      patches: [],
    });
  });
});

describe("convertValueForType", () => {
  it("reads numbers and dates with the authored form's policy (M44 → wire)", () => {
    for (const text of ["12", " 7.50 ", "-0.5", "1e3", "1,200", "0012", "TBD", "", "-0", ".5"]) {
      const converted = convertValueForType(textValue(text), { kind: "number" }, []);
      const authored = text.trim() !== "" && isCanonicalDecimalText(text.trim());
      expect(converted.kind === "converted", text).toBe(authored);
    }
    for (const text of ["2026-03-09", " 2026-02-29 ", "2024-02-29", "03/09/2026", "2026-13-01", "-0001-01-01"]) {
      const converted = convertValueForType(textValue(text), { kind: "date" }, []);
      const authored = isoDateToEpochDay(text.trim());
      expect(converted, text).toEqual(
        authored === null ? { kind: "kept", value: invalidPreservedValue(text) } : { kind: "converted", value: dateValue(authored) },
      );
    }
  });

  it("keeps what does not parse, reads text back from every kind, and leaves fitting values alone", () => {
    const options = [option(OPEN, "Open", 0), option(PAID, "Paid", 1)];
    expect(convertValueForType(textValue("Paid"), { kind: "enum" }, options)).toEqual({ kind: "converted", value: enumValue(PAID) });
    expect(convertValueForType(textValue("Closed"), { kind: "enum" }, options)).toEqual({ kind: "kept", value: invalidPreservedValue("Closed") });
    expect(convertValueForType(enumValue(OPEN), { kind: "text" }, options)).toEqual({ kind: "converted", value: textValue("Open") });
    expect(convertValueForType(decimalValue("10.50"), { kind: "text" }, [])).toEqual({ kind: "converted", value: textValue("10.50") });
    expect(convertValueForType(dateValue(20_521), { kind: "email" }, [])).toEqual({ kind: "converted", value: textValue("2026-03-09") });
    expect(convertValueForType(booleanValue(true), { kind: "text" }, [])).toEqual({ kind: "converted", value: textValue("TRUE") });
    expect(convertValueForType(textValue("false"), { kind: "boolean" }, [])).toEqual({ kind: "converted", value: booleanValue(false) });
    expect(convertValueForType(invalidPreservedValue("42"), { kind: "currency", currencyCode: "USD" }, [])).toEqual({
      kind: "converted",
      value: decimalValue("42"),
    });
    expect(convertValueForType(invalidPreservedValue("n/a"), { kind: "number" }, [])).toEqual({ kind: "kept", value: invalidPreservedValue("n/a") });
    expect(convertValueForType(textValue("x"), { kind: "phone" }, [])).toEqual({ kind: "unchanged" });
    expect(convertValueForType(MISSING_VALUE, { kind: "number" }, [])).toEqual({ kind: "unchanged" });
    expect(convertValueForType(textValue("C-1"), { kind: "reference" }, [])).toEqual({ kind: "kept", value: invalidPreservedValue("C-1") });
  });
});

describe("validateSchemaTransition", () => {
  const withTables = (edit: (field: FieldDefV1) => FieldDefV1, extra: Partial<SchemaSnapshotV1> = {}): SchemaSnapshotV1 => ({
    ...schema,
    tables: schema.tables.map((candidate) => ({ ...candidate, fields: candidate.fields.map(edit) })),
    ...extra,
  });

  it("allows a rename and a deactivated non-key field", () => {
    const after = withTables((field) => (field.fieldId === AMOUNT ? { ...field, displayName: "Amount", isActive: false } : field));
    expect(validateSchemaTransition(schema, after)).toEqual({ isAllowed: true, refusals: [] });
  });

  it("refuses a computed or inactive key, a vanished field, and a reference with no relationship", () => {
    const computedKey = withTables((field) => (field.fieldId === JOB_ID ? { ...field, formulaId: BALANCE_FORMULA } : field));
    expect(validateSchemaTransition(schema, computedKey).refusals.map((refusal) => refusal.kind)).toContain("key-field-computed");
    const inactiveKey = withTables((field) => (field.fieldId === JOB_ID ? { ...field, isActive: false } : field));
    expect(validateSchemaTransition(schema, inactiveKey).refusals).toEqual([{ kind: "key-field-inactive", fieldId: JOB_ID, messageKey: null }]);
    const dropped: SchemaSnapshotV1 = {
      ...schema,
      tables: schema.tables.map((candidate) => ({ ...candidate, fields: candidate.fields.filter((field) => field.fieldId !== CUSTOMER) })),
    };
    expect(validateSchemaTransition(schema, dropped).refusals).toContainEqual({ kind: "field-removed", fieldId: CUSTOMER, messageKey: null });
    const bareReference = withTables((field) => (field.fieldId === CUSTOMER ? { ...field, type: { kind: "reference" } } : field));
    expect(validateSchemaTransition(schema, bareReference).refusals).toEqual([
      { kind: "reference-without-relationship", fieldId: CUSTOMER, messageKey: null },
    ]);
  });

  it("keeps enum option IDs stable and formula targets matched", () => {
    expect(validateSchemaTransition(schema, { ...schema, enumOptions: [option(OPEN, "Open", 0)] }).refusals).toEqual([
      { kind: "enum-option-removed", fieldId: STATUS, messageKey: null },
    ]);
    expect(validateSchemaTransition(schema, { ...schema, enumOptions: [option(OPEN, "Open", 0), option(PAID, "Paid", 1, false)] }).isAllowed).toBe(true);
    expect(validateSchemaTransition(schema, { ...schema, formulas: [] }).refusals).toEqual([
      { kind: "formula-target-mismatch", fieldId: BALANCE, messageKey: null },
    ]);
    const retargeted = { ...balanceFormula, target: { kind: "computed-column" as const, tableId: JOBS, fieldId: AMOUNT } };
    expect(validateSchemaTransition(schema, { ...schema, formulas: [retargeted] }).refusals.map((refusal) => refusal.kind)).toEqual([
      "formula-target-mismatch",
      "formula-target-mismatch",
    ]);
  });

  it("reuses validateSchema for relationship endpoints", () => {
    const relationship: RelationshipDefV1 = {
      relationshipId: LINK,
      fromTableId: JOBS,
      fromFieldId: CUSTOMER,
      toTableId: CUSTOMERS,
      toKeyFieldId: CUSTOMER,
      detectionSource: "user",
      isActive: true,
      schemaRevision: 2n,
    };
    const after = withTables((field) => (field.fieldId === CUSTOMER ? { ...field, type: { kind: "reference" } } : field), {
      relationships: [relationship],
    });
    expect(validateSchemaTransition(schema, after).refusals).toEqual([
      { kind: "schema-invalid", fieldId: CUSTOMER, messageKey: "schema.relationship-target-not-key" },
    ]);
  });
});

describe("set-table-key (D64; CA-28 \"set key\" → table.changed)", () => {
  it("counts records with no key value and records repeating an earlier key, changing none", () => {
    const keyed = [
      record(1, [[CUSTOMER, textValue("C-1")]]),
      record(2, [[CUSTOMER, textValue(" C-1 ")]]),
      record(3, [[CUSTOMER, textValue("C-2")]]),
      record(4, []),
      record(5, [[CUSTOMER, MISSING_VALUE]]),
    ];
    expect(analyzeSchemaChange({ kind: "set-table-key", tableId: JOBS, keyFieldId: CUSTOMER }, schema, keyed, env)).toEqual({
      change: "set-table-key",
      total: 5,
      affected: 3,
      unchanged: 2,
      converted: 0,
      keptAndFlagged: 1,
      missingNow: 2,
      onRemovedOptions: 0,
      matchedKeys: 0,
      unmatchedKeys: 0,
      unlinkedReferences: 0,
      failingRule: 0,
      formulaErrors: 0,
      patches: [],
    });
    // Clearing the key has nothing to count.
    expect(analyzeSchemaChange({ kind: "set-table-key", tableId: JOBS, keyFieldId: null }, schema, keyed, env).affected).toBe(0);
  });

  it("refuses a key a relationship still points at, or one that is computed or inactive", () => {
    const relationship: RelationshipDefV1 = {
      relationshipId: LINK,
      fromTableId: JOBS,
      fromFieldId: CUSTOMER,
      toTableId: CUSTOMERS,
      toKeyFieldId: CUSTOMER_ID,
      detectionSource: "user",
      isActive: true,
      schemaRevision: 2n,
    };
    const customers = schema.tables[1]!;
    const second = { ...customers.fields[0]!, fieldId: id("field", 21), fieldOrdinal: 1 };
    const before: SchemaSnapshotV1 = {
      ...schema,
      tables: [
        { ...schema.tables[0]!, fields: schema.tables[0]!.fields.map((field) => (field.fieldId === CUSTOMER ? { ...field, type: { kind: "reference" } } : field)) },
        { ...customers, fields: [...customers.fields, second] },
      ],
      relationships: [relationship],
    };
    const moved: SchemaSnapshotV1 = { ...before, tables: [before.tables[0]!, { ...before.tables[1]!, keyFieldId: second.fieldId }] };
    expect(validateSchemaTransition(before, moved).refusals).toEqual([
      { kind: "schema-invalid", fieldId: CUSTOMER, messageKey: "schema.relationship-target-not-key" },
    ]);
    // With nothing pointing at it, the same move is allowed.
    const unlinked = { ...moved, relationships: [], tables: [schema.tables[0]!, moved.tables[1]!] };
    expect(validateSchemaTransition({ ...before, relationships: [], tables: [schema.tables[0]!, before.tables[1]!] }, unlinked).isAllowed).toBe(true);

    const onComputed: SchemaSnapshotV1 = { ...schema, tables: [{ ...schema.tables[0]!, keyFieldId: BALANCE }, schema.tables[1]!] };
    expect(validateSchemaTransition(schema, onComputed).refusals.map((refusal) => refusal.kind)).toContain("key-field-computed");
  });
});
