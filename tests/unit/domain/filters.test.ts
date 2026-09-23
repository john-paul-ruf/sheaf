import { describe, expect, it } from "vitest";
import { compareCanonicalDecimals, validateFilter, type FilterOperandV1, type FilterV1 } from "../../../src/domain/model/filters.js";
import { asDomainId, type FieldId } from "../../../src/domain/model/ids.js";
import type { EnumOptionDefV1, FieldTypeV1, TableDefV1 } from "../../../src/domain/model/schema.js";

const tableId = asDomainId("table", new Uint8Array(16).fill(1));
const field = (n: number): FieldId => asDomainId("field", new Uint8Array(16).fill(n));
const STATUS = field(10);
const DUE = field(11);
const AMOUNT = field(12);
const DONE = field(13);
const CUSTOMER = field(14);
const NOTES = field(15);
const RETIRED = field(16);
const OPEN = asDomainId("option", new Uint8Array(16).fill(20));
const CLOSED = asDomainId("option", new Uint8Array(16).fill(21));

const types: readonly (readonly [FieldId, FieldTypeV1])[] = [
  [STATUS, { kind: "enum" }],
  [DUE, { kind: "date" }],
  [AMOUNT, { kind: "currency", currencyCode: "USD" }],
  [DONE, { kind: "boolean" }],
  [CUSTOMER, { kind: "reference" }],
  [NOTES, { kind: "text" }],
  [RETIRED, { kind: "text" }],
];

const table: TableDefV1 = {
  tableId,
  displayName: "Jobs",
  tableOrdinal: 0,
  fields: types.map(([fieldId, type], index) => ({
    fieldId,
    tableId,
    displayName: `f${index}`,
    fieldOrdinal: index,
    type,
    isRequired: false,
    isActive: fieldId !== RETIRED,
    schemaRevision: 1n,
  })),
  keyFieldId: null,
  labelFieldId: null,
  sourceSheetId: null,
  isActive: true,
  schemaRevision: 1n,
};

const options: readonly EnumOptionDefV1[] = [
  { optionId: OPEN, fieldId: STATUS, displayLabel: "Open", optionOrdinal: 0, isActive: true, schemaRevision: 1n },
  { optionId: CLOSED, fieldId: STATUS, displayLabel: "Closed", optionOrdinal: 1, isActive: false, schemaRevision: 1n },
];

const check = (fieldId: FieldId, operand: FilterOperandV1) => validateFilter({ fieldId, operand } satisfies FilterV1, table, options);

describe("validateFilter (CA-29)", () => {
  it("accepts one well-formed filter per logical type, and empty/not-empty on any field", () => {
    expect(check(STATUS, { kind: "enum-in", optionIds: [OPEN, CLOSED] })).toBeNull();
    expect(check(DUE, { kind: "date-range", from: 20_000, to: null })).toBeNull();
    expect(check(AMOUNT, { kind: "number-range", min: "-5", max: "10.50" })).toBeNull();
    expect(check(DONE, { kind: "boolean-is", value: true })).toBeNull();
    expect(check(CUSTOMER, { kind: "reference-in", recordIds: [asDomainId("record", new Uint8Array(16).fill(9))] })).toBeNull();
    expect(check(CUSTOMER, { kind: "reference-broken" })).toBeNull();
    expect(check(NOTES, { kind: "text-contains", text: "harbor" })).toBeNull();
    for (const fieldId of [STATUS, DUE, AMOUNT, DONE, CUSTOMER, NOTES]) {
      expect(check(fieldId, { kind: "is-empty" })).toBeNull();
      expect(check(fieldId, { kind: "not-empty" })).toBeNull();
    }
  });

  it("refuses the SHT-005/006 invalid states as inverted ranges", () => {
    expect(check(DUE, { kind: "date-range", from: 20_001, to: 20_000 })).toEqual({ reason: "inverted-range", fieldId: DUE });
    expect(check(AMOUNT, { kind: "number-range", min: "10.5", max: "9.99" })).toEqual({ reason: "inverted-range", fieldId: AMOUNT });
    expect(check(AMOUNT, { kind: "number-range", min: "-2", max: "-10" })).toEqual({ reason: "inverted-range", fieldId: AMOUNT });
    expect(check(DUE, { kind: "date-range", from: 20_000, to: 20_000 })).toBeNull();
  });

  it("refuses a mismatched operator, an unknown field or option, and malformed values", () => {
    expect(check(NOTES, { kind: "number-range", min: "1", max: null })).toEqual({ reason: "operator-type-mismatch", fieldId: NOTES });
    expect(check(STATUS, { kind: "text-equals", text: "Open" })).toEqual({ reason: "operator-type-mismatch", fieldId: STATUS });
    expect(check(RETIRED, { kind: "is-empty" })).toEqual({ reason: "unknown-field", fieldId: RETIRED });
    expect(check(field(99), { kind: "is-empty" })).toEqual({ reason: "unknown-field", fieldId: field(99) });
    expect(check(STATUS, { kind: "enum-in", optionIds: [asDomainId("option", new Uint8Array(16).fill(29))] })).toEqual({
      reason: "unknown-option",
      fieldId: STATUS,
    });
    expect(check(STATUS, { kind: "enum-in", optionIds: [] })).toEqual({ reason: "empty-filter", fieldId: STATUS });
    expect(check(DUE, { kind: "date-range", from: null, to: null })).toEqual({ reason: "empty-filter", fieldId: DUE });
    expect(check(DUE, { kind: "date-range", from: 1.5, to: null })).toEqual({ reason: "invalid-value", fieldId: DUE });
    expect(check(AMOUNT, { kind: "number-range", min: "1e3", max: null })).toEqual({ reason: "invalid-value", fieldId: AMOUNT });
    expect(check(NOTES, { kind: "text-equals", text: "Café" })).toEqual({ reason: "invalid-value", fieldId: NOTES });
  });

  it("orders canonical decimals numerically", () => {
    expect(compareCanonicalDecimals("10.50", "10.5")).toBe(0);
    expect(compareCanonicalDecimals("9.99", "10")).toBeLessThan(0);
    expect(compareCanonicalDecimals("-10", "-9.5")).toBeLessThan(0);
    expect(compareCanonicalDecimals("0", "-0.01")).toBeGreaterThan(0);
  });
});
