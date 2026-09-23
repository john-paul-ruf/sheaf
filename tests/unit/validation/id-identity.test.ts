/**
 * Field ids are compared by value, never by object identity (CA-27, CAP-36).
 *
 * A rule, a table definition or an enum-option map reaches M02 decoded on its
 * own — from the wire, a checkpoint, or the projection — so its ids are never
 * the same objects as a record's map keys. Every case here is evaluated twice:
 * once with the record's own key objects, once with every id decoded apart
 * (`structuredClone`, or a round trip through the id codec). The two must agree,
 * and each case pins the expected answer in both directions.
 */

import { describe, expect, it } from "vitest";
import { asDomainId, decodeDomainId, encodeDomainId, type FieldId, type OptionId } from "../../../src/domain/model/ids.js";
import type { EnumOptionDefV1, FieldDefV1, TableDefV1 } from "../../../src/domain/model/schema.js";
import { dateValue, decimalValue, enumValue, textValue, type CellValueV1 } from "../../../src/domain/model/values.js";
import type { RuleConditionV1, RuleConditionV2, ValidationRuleIR, ValidationRuleIRV2 } from "../../../src/domain/validation/rules.js";
import { analyzeSchemaChange, type SchemaSnapshotV1 } from "../../../src/domain/validation/schema-impact.js";
import {
  ruleHolds,
  validateRecord,
  type RecordUnderValidationV1,
  type ValidationContext,
} from "../../../src/domain/validation/validate-record.js";

const tableId = asDomainId("table", new Uint8Array(16).fill(1));
const recordId = asDomainId("record", new Uint8Array(16).fill(2));
const ruleId = asDomainId("rule", new Uint8Array(16).fill(3));
const field = (n: number): FieldId => asDomainId("field", new Uint8Array(16).fill(n));
const START = field(10);
const FINISH = field(11);
const PRICE = field(12);
const CODE = field(13);
const STATUS = field(14);
const OPEN: OptionId = asDomainId("option", new Uint8Array(16).fill(20));

/** The same id, decoded again through the codec: equal bytes, another object. */
const redecoded = (id: FieldId): FieldId => decodeDomainId("field", encodeDomainId(id));

const definition = (fieldId: FieldId, fieldOrdinal: number, displayName: string, type: FieldDefV1["type"], isRequired = false): FieldDefV1 => ({
  fieldId,
  tableId,
  displayName,
  fieldOrdinal,
  type,
  isRequired,
  isActive: true,
  schemaRevision: 1n,
});

const table: TableDefV1 = {
  tableId,
  displayName: "Jobs",
  tableOrdinal: 0,
  fields: [
    definition(START, 0, "Start date", { kind: "date" }),
    definition(FINISH, 1, "Finish by", { kind: "date" }),
    definition(PRICE, 2, "Price", { kind: "number" }, true),
    definition(CODE, 3, "Code", { kind: "text" }),
    definition(STATUS, 4, "Status", { kind: "enum" }),
  ],
  keyFieldId: null,
  labelFieldId: null,
  sourceSheetId: null,
  isActive: true,
  schemaRevision: 1n,
};

const openOption: EnumOptionDefV1 = { optionId: OPEN, fieldId: STATUS, displayLabel: "Open", optionOrdinal: 0, isActive: true, schemaRevision: 1n };

/** Keys are always the shared objects above: the record never moves. */
const record = (values: readonly (readonly [FieldId, CellValueV1])[]): RecordUnderValidationV1 => ({ recordId, tableId, values: new Map(values) });

const v2 = (condition: RuleConditionV2): ValidationRuleIRV2 => ({
  irVersion: 2,
  ruleId,
  condition,
  severity: "blocking",
  messageKey: "rule-compare",
  messageParameters: {},
});

const v1 = (condition: RuleConditionV1): ValidationRuleIR => ({
  irVersion: 1,
  ruleId,
  condition,
  severity: "blocking",
  messageKey: "rule-v1",
  messageParameters: {},
});

interface Case {
  readonly name: string;
  readonly rule: ValidationRuleIR | ValidationRuleIRV2;
  readonly passes: RecordUnderValidationV1;
  readonly fails: RecordUnderValidationV1;
}

const cases: readonly Case[] = [
  {
    name: "compare field against field",
    rule: v2({ kind: "compare", left: FINISH, op: "ge", right: { field: START } }),
    passes: record([[START, dateValue(10)], [FINISH, dateValue(12)]]),
    fails: record([[START, dateValue(10)], [FINISH, dateValue(9)]]),
  },
  {
    name: "compare field against a literal",
    rule: v2({ kind: "compare", left: PRICE, op: "le", right: { value: decimalValue("100") } }),
    passes: record([[PRICE, decimalValue("99.5")]]),
    fails: record([[PRICE, decimalValue("100.01")]]),
  },
  {
    name: "between",
    rule: v2({ kind: "between", fieldId: PRICE, low: decimalValue("10"), high: decimalValue("20") }),
    passes: record([[PRICE, decimalValue("15")]]),
    fails: record([[PRICE, decimalValue("21")]]),
  },
  {
    name: "not-between",
    rule: v2({ kind: "not-between", fieldId: PRICE, low: decimalValue("10"), high: decimalValue("20") }),
    passes: record([[PRICE, decimalValue("5")]]),
    fails: record([[PRICE, decimalValue("12")]]),
  },
  {
    name: "text-length measure",
    rule: v2({ kind: "compare", left: CODE, op: "le", right: { value: decimalValue("3") }, measure: "text-length" }),
    passes: record([[CODE, textValue("abc")]]),
    fails: record([[CODE, textValue("abcd")]]),
  },
  {
    name: "v2 field-present",
    rule: v2({ kind: "field-present", fieldId: PRICE }),
    passes: record([[PRICE, decimalValue("1")]]),
    fails: record([[CODE, textValue("x")]]),
  },
  {
    name: "v1 field-present",
    rule: v1({ kind: "field-present", fieldId: CODE }),
    passes: record([[CODE, textValue("x")]]),
    fails: record([]),
  },
  {
    name: "v1 field-absent",
    rule: v1({ kind: "field-absent", fieldId: CODE }),
    passes: record([]),
    fails: record([[CODE, textValue("x")]]),
  },
  {
    name: "v1 field-equals",
    rule: v1({ kind: "field-equals", fieldId: CODE, value: textValue("A") }),
    passes: record([[CODE, textValue("A")]]),
    fails: record([[CODE, textValue("B")]]),
  },
  {
    name: "v1 all / any / not",
    rule: v1({
      kind: "all",
      conditions: [
        { kind: "any", conditions: [{ kind: "field-present", fieldId: CODE }, { kind: "field-present", fieldId: PRICE }] },
        { kind: "not", condition: { kind: "field-equals", fieldId: CODE, value: textValue("void") } },
      ],
    }),
    passes: record([[PRICE, decimalValue("1")]]),
    fails: record([[CODE, textValue("void")]]),
  },
];

const context = (rules: ValidationContext["rules"]): ValidationContext => ({
  table,
  enumOptions: new Map([[STATUS, [openOption]]]),
  rules,
  referenceExists: () => false,
});

describe("rule operands decoded apart from the record's keys (CA-27)", () => {
  for (const { name, rule, passes, fails } of cases) {
    it(`${name}: evaluates exactly as with shared ids`, () => {
      const apart = structuredClone(rule);
      expect(ruleHolds(rule, passes)).toBe(true);
      expect(ruleHolds(rule, fails)).toBe(false);
      expect(ruleHolds(apart, passes)).toBe(true);
      expect(ruleHolds(apart, fails)).toBe(false);
      expect(validateRecord(context([apart]), fails).issues.filter((issue) => issue.kind === "record-rule")).toHaveLength(1);
      expect(validateRecord(context([apart]), passes).issues.filter((issue) => issue.kind === "record-rule")).toEqual([]);
    });
  }

  it("a field id re-decoded through the codec finds the record's value", () => {
    const present = v2({ kind: "field-present", fieldId: redecoded(PRICE) });
    expect(ruleHolds(present, record([[PRICE, decimalValue("1")]]))).toBe(true);
  });
});

describe("field checks over a table and enum options decoded apart (CA-27)", () => {
  const apart: ValidationContext = {
    table: structuredClone(table),
    enumOptions: structuredClone(new Map([[STATUS, [openOption]]])),
    rules: [],
    referenceExists: () => false,
  };

  it("a present required value is not reported missing, and an absent one is", () => {
    const kinds = (values: readonly (readonly [FieldId, CellValueV1])[]) =>
      validateRecord(apart, record(values)).issues.map((issue) => issue.kind);
    expect(kinds([[PRICE, decimalValue("1")]])).toEqual([]);
    expect(kinds([])).toEqual(["required"]);
  });

  it("a value of the wrong type is reported as one", () => {
    const report = validateRecord(apart, record([[PRICE, textValue("lots")]]));
    expect(report.issues.map((issue) => issue.messageKey)).toEqual(["validation.wrong-type"]);
  });

  it("an active enum option is found among its field's options", () => {
    const report = validateRecord(apart, record([[PRICE, decimalValue("1")], [STATUS, enumValue(OPEN)]]));
    expect(report.issues).toEqual([]);
  });
});

describe("schema impact counts failing records with a rule decoded apart (CA-28)", () => {
  const schema: SchemaSnapshotV1 = { tables: [table], enumOptions: [openOption], relationships: [], rules: [], formulas: [] };
  const env = { resolveKey: () => null, referenceExists: () => false, formulaResult: () => ({ kind: "empty" }) as const };

  it("counts exactly the records the rule flags", () => {
    const rows = [
      record([[PRICE, decimalValue("5")]]),
      record([[PRICE, decimalValue("150")]]),
      record([[PRICE, decimalValue("101")]]),
      record([]),
    ];
    const rule = structuredClone(v2({ kind: "compare", left: PRICE, op: "le", right: { value: decimalValue("100") } }));
    const report = analyzeSchemaChange({ kind: "save-rule", tableId, displayName: "Cheap", rule }, schema, rows, env);
    expect(report).toMatchObject({ total: 4, failingRule: 2, affected: 2 });
    const present = structuredClone(v2({ kind: "field-present", fieldId: PRICE }));
    expect(analyzeSchemaChange({ kind: "save-rule", tableId, displayName: "Priced", rule: present }, schema, rows, env).failingRule).toBe(1);
  });
});
