import { describe, expect, it } from "vitest";
import { asDomainId, type FieldId } from "../../../src/domain/model/ids.js";
import type { TableDefV1 } from "../../../src/domain/model/schema.js";
import { dateValue, decimalValue, MISSING_VALUE, textValue, type CellValueV1 } from "../../../src/domain/model/values.js";
import {
  FORMULA_ISSUE_MESSAGE_KEYS,
  RULE_V2_MESSAGE_KEYS,
  type RuleConditionV2,
  type ValidationRuleIR,
  type ValidationRuleIRV2,
} from "../../../src/domain/validation/rules.js";
import { ruleHolds, validateRecord, type RecordUnderValidationV1 } from "../../../src/domain/validation/validate-record.js";

const tableId = asDomainId("table", new Uint8Array(16).fill(1));
const recordId = asDomainId("record", new Uint8Array(16).fill(2));
const ruleId = asDomainId("rule", new Uint8Array(16).fill(3));
const field = (n: number): FieldId => asDomainId("field", new Uint8Array(16).fill(n));
const START = field(10);
const FINISH = field(11);
const PRICE = field(12);
const CODE = field(13);

const table: TableDefV1 = {
  tableId,
  displayName: "Jobs",
  tableOrdinal: 0,
  fields: [
    { fieldId: START, tableId, displayName: "Start date", fieldOrdinal: 0, type: { kind: "date" }, isRequired: false, isActive: true, schemaRevision: 1n },
    { fieldId: FINISH, tableId, displayName: "Finish by", fieldOrdinal: 1, type: { kind: "date" }, isRequired: false, isActive: true, schemaRevision: 1n },
    { fieldId: PRICE, tableId, displayName: "Price", fieldOrdinal: 2, type: { kind: "number" }, isRequired: false, isActive: true, schemaRevision: 1n },
    { fieldId: CODE, tableId, displayName: "Code", fieldOrdinal: 3, type: { kind: "text" }, isRequired: false, isActive: true, schemaRevision: 1n },
  ],
  keyFieldId: null,
  labelFieldId: null,
  sourceSheetId: null,
  isActive: true,
  schemaRevision: 1n,
};

const record = (values: readonly (readonly [FieldId, CellValueV1])[]): RecordUnderValidationV1 => ({ recordId, tableId, values: new Map(values) });

const rule = (condition: RuleConditionV2): ValidationRuleIRV2 => ({
  irVersion: 2,
  ruleId,
  condition,
  severity: "blocking",
  messageKey: "rule-compare",
  messageParameters: { leftLabel: "Finish by", rightLabel: "Start date" },
});

const finishAfterStart = rule({ kind: "compare", left: FINISH, op: "ge", right: { field: START } });

describe("record rule IR v2 (D52, CA-27)", () => {
  it("states 'Finish by is on or after Start date' and enforces it through validateRecord", () => {
    const context = { table, enumOptions: new Map(), rules: [finishAfterStart], referenceExists: () => false };
    const late = validateRecord(context, record([[START, dateValue(20_000)], [FINISH, dateValue(19_999)]]));
    expect(late.isValid).toBe(false);
    expect(late.issues).toEqual([
      {
        fieldId: null,
        ruleId,
        kind: "record-rule",
        severity: "blocking",
        messageKey: "rule-compare",
        messageParameters: { leftLabel: "Finish by", rightLabel: "Start date" },
      },
    ]);
    expect(validateRecord(context, record([[START, dateValue(20_000)], [FINISH, dateValue(20_000)]])).isValid).toBe(true);
  });

  it("does not fire over a missing operand or mismatched types", () => {
    expect(ruleHolds(finishAfterStart, record([[FINISH, dateValue(1)]]))).toBe(true);
    expect(ruleHolds(finishAfterStart, record([[START, dateValue(5)], [FINISH, textValue("soon")]]))).toBe(true);
    expect(ruleHolds(rule({ kind: "not", condition: finishAfterStart.condition }), record([]))).toBe(true);
    expect(
      ruleHolds(rule({ kind: "all", conditions: [finishAfterStart.condition, { kind: "field-present", fieldId: PRICE }] }), record([])),
    ).toBe(false);
  });

  it("orders decimals numerically, dates by day, and text by NFC code point", () => {
    const priceAtMost = (limit: string) => rule({ kind: "compare", left: PRICE, op: "le", right: { value: decimalValue(limit) } });
    expect(ruleHolds(priceAtMost("100"), record([[PRICE, decimalValue("99.99")]]))).toBe(true);
    expect(ruleHolds(priceAtMost("100"), record([[PRICE, decimalValue("100.00")]]))).toBe(true);
    expect(ruleHolds(priceAtMost("100"), record([[PRICE, decimalValue("100.01")]]))).toBe(false);
    expect(ruleHolds(priceAtMost("-5"), record([[PRICE, decimalValue("-10")]]))).toBe(true);
    expect(ruleHolds(priceAtMost("-5"), record([[PRICE, decimalValue("-4.5")]]))).toBe(false);
    expect(ruleHolds(priceAtMost("0"), record([[PRICE, decimalValue("0.00")]]))).toBe(true);
    const codeBefore = (limit: string) => rule({ kind: "compare", left: CODE, op: "lt", right: { value: textValue(limit) } });
    expect(ruleHolds(codeBefore("a"), record([[CODE, textValue("Z")]]))).toBe(true);
    expect(ruleHolds(codeBefore("Z"), record([[CODE, textValue("a")]]))).toBe(false);
    expect(ruleHolds(codeBefore("\u{1F600}"), record([[CODE, textValue("�")]]))).toBe(true);
    expect(ruleHolds(rule({ kind: "compare", left: CODE, op: "eq", right: { value: textValue("Café") } }), record([[CODE, textValue("Café")]]))).toBe(true);
  });

  it("checks inclusive bounds, their negation, and a text length", () => {
    const between = rule({ kind: "between", fieldId: PRICE, low: decimalValue("1"), high: decimalValue("10") });
    const outside = rule({ kind: "not-between", fieldId: PRICE, low: decimalValue("1"), high: decimalValue("10") });
    for (const [price, inside] of [["1", true], ["10", true], ["10.5", false], ["0.99", false]] as const) {
      expect(ruleHolds(between, record([[PRICE, decimalValue(price)]])), price).toBe(inside);
      expect(ruleHolds(outside, record([[PRICE, decimalValue(price)]])), price).toBe(!inside);
    }
    expect(ruleHolds(between, record([[PRICE, MISSING_VALUE]]))).toBe(true);
    const shortCode = rule({ kind: "between", fieldId: CODE, low: decimalValue("1"), high: decimalValue("4"), measure: "text-length" });
    expect(ruleHolds(shortCode, record([[CODE, textValue("J-42")]]))).toBe(true);
    expect(ruleHolds(shortCode, record([[CODE, textValue("J-420")]]))).toBe(false);
    expect(ruleHolds(shortCode, record([[CODE, textValue("\u00e9\u00e9\u00e9\u00e9")]]))).toBe(true);
  });

  it("evaluates a v1 rule exactly as before", () => {
    const v1: ValidationRuleIR = {
      irVersion: 1,
      ruleId,
      condition: { kind: "any", conditions: [{ kind: "field-present", fieldId: PRICE }, { kind: "not", condition: { kind: "field-absent", fieldId: CODE } }] },
      severity: "warning",
      messageKey: "rule.price-or-code",
      messageParameters: {},
    };
    expect(ruleHolds(v1, record([]))).toBe(false);
    expect(ruleHolds(v1, record([[CODE, textValue("x")]]))).toBe(true);
  });

  it("closes the v2 and formula message keys", () => {
    expect([...RULE_V2_MESSAGE_KEYS]).toEqual(["rule-compare", "rule-between"]);
    expect([...FORMULA_ISSUE_MESSAGE_KEYS]).toEqual([
      "computed-not-authored",
      "formula-result-type",
      "formula-error",
      "formula-cycle",
      "unsupported-formula",
      "missing-unsupported-formula",
    ]);
  });
});
