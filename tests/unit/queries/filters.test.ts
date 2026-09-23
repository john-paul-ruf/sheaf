/**
 * M35's records-query compiler (CA-29): each `FilterV1` operand becomes the
 * lane predicate its field's type means, every filter passes the domain's one
 * validator first, and a refusal names the filter at fault.
 */

import { describe, expect, it } from "vitest";
import {
  compileRecordQuery,
  MAX_FILTER_SET_SIZE,
  MAX_RECORD_FILTERS,
  readTableDefinition,
  type CompiledRecordQueryV1,
} from "../../../src/application/queries/filters.js";
import type { FilterV1 } from "../../../src/domain/model/filters.js";
import { asDomainId, type FieldId } from "../../../src/domain/model/ids.js";
import type { EnumOptionDefV1, FieldDefV1, TableDefV1 } from "../../../src/domain/model/schema.js";
import { FakeProjection } from "../commands/fakes.js";

const bytes = (fill: number): Uint8Array => new Uint8Array(16).fill(fill);
const TABLE_ID = asDomainId("table", bytes(1));

const field = (fill: number, type: FieldDefV1["type"], overrides: Partial<FieldDefV1> = {}): FieldDefV1 => ({
  fieldId: asDomainId("field", bytes(fill)),
  tableId: TABLE_ID,
  displayName: `Field ${String(fill)}`,
  fieldOrdinal: fill,
  type,
  isRequired: false,
  isActive: true,
  schemaRevision: 1n,
  ...overrides,
});

const NAME = field(0x10, { kind: "text" });
const EMAIL = field(0x11, { kind: "email" });
const STATUS = field(0x12, { kind: "enum" });
const DUE = field(0x13, { kind: "date" });
const QUOTED = field(0x14, { kind: "currency", currencyCode: "USD" });
const COUNT = field(0x15, { kind: "number" });
const URGENT = field(0x16, { kind: "boolean" });
const CUSTOMER = field(0x17, { kind: "reference" });
const BALANCE = field(0x18, { kind: "number" }, { formulaId: asDomainId("formula", bytes(0x40)) });
const RETIRED = field(0x19, { kind: "text" }, { isActive: false });

const TABLE: TableDefV1 = {
  tableId: TABLE_ID,
  displayName: "Jobs",
  tableOrdinal: 0,
  fields: [NAME, EMAIL, STATUS, DUE, QUOTED, COUNT, URGENT, CUSTOMER, BALANCE, RETIRED],
  keyFieldId: null,
  labelFieldId: NAME.fieldId,
  sourceSheetId: null,
  isActive: true,
  schemaRevision: 1n,
};

const OPEN = asDomainId("option", bytes(0x20));
const CLOSED = asDomainId("option", bytes(0x21));
const OPTIONS: readonly EnumOptionDefV1[] = [
  { optionId: OPEN, fieldId: STATUS.fieldId, displayLabel: "Open", optionOrdinal: 0, isActive: true, schemaRevision: 1n },
  // A retired option still filters: records may hold it.
  { optionId: CLOSED, fieldId: STATUS.fieldId, displayLabel: "Closed", optionOrdinal: 1, isActive: false, schemaRevision: 1n },
];

const PARENT = asDomainId("record", bytes(0x30));

const compile = (filters: readonly FilterV1[], sort: Parameters<typeof compileRecordQuery>[3] = null): CompiledRecordQueryV1 =>
  compileRecordQuery(TABLE, OPTIONS, filters, sort);

const onlyTerm = (filter: FilterV1) => {
  const compiled = compile([filter]);
  if (compiled.outcome !== "compiled") throw new Error(`refused: ${compiled.refusal.reason}`);
  return compiled.filters[0];
};

const refusalOf = (filters: readonly FilterV1[], sort: Parameters<typeof compileRecordQuery>[3] = null) => {
  const compiled = compile(filters, sort);
  return compiled.outcome === "refused" ? compiled.refusal : null;
};

describe("each operand compiles onto its field's lane", () => {
  it("enum and reference sets become id sets", () => {
    expect(onlyTerm({ fieldId: STATUS.fieldId, operand: { kind: "enum-in", optionIds: [OPEN, CLOSED] } })).toEqual({
      kind: "id-in",
      fieldId: STATUS.fieldId,
      ids: [OPEN, CLOSED],
    });
    expect(onlyTerm({ fieldId: CUSTOMER.fieldId, operand: { kind: "reference-in", recordIds: [PARENT] } })).toEqual({
      kind: "id-in",
      fieldId: CUSTOMER.fieldId,
      ids: [PARENT],
    });
  });

  it("dates and booleans use the integer lane", () => {
    expect(onlyTerm({ fieldId: DUE.fieldId, operand: { kind: "date-range", from: 20_000, to: null } })).toEqual({
      kind: "integer-range",
      fieldId: DUE.fieldId,
      min: 20_000,
      max: null,
    });
    expect(onlyTerm({ fieldId: URGENT.fieldId, operand: { kind: "boolean-is", value: true } })).toEqual({
      kind: "integer-range",
      fieldId: URGENT.fieldId,
      min: 1,
      max: 1,
    });
    expect(onlyTerm({ fieldId: URGENT.fieldId, operand: { kind: "boolean-is", value: false } })).toMatchObject({ min: 0, max: 0 });
  });

  it("numbers and currencies keep their exact decimal text", () => {
    expect(onlyTerm({ fieldId: QUOTED.fieldId, operand: { kind: "number-range", min: "10.50", max: null } })).toEqual({
      kind: "decimal-range",
      fieldId: QUOTED.fieldId,
      min: "10.50",
      max: null,
    });
    expect(onlyTerm({ fieldId: COUNT.fieldId, operand: { kind: "number-range", min: null, max: "-3" } })).toMatchObject({
      kind: "decimal-range",
      max: "-3",
    });
  });

  it("text stays exact, on any text-like field", () => {
    expect(onlyTerm({ fieldId: EMAIL.fieldId, operand: { kind: "text-contains", text: "@cedar" } })).toEqual({
      kind: "text-contains",
      fieldId: EMAIL.fieldId,
      text: "@cedar",
    });
    expect(onlyTerm({ fieldId: NAME.fieldId, operand: { kind: "text-equals", text: "Ada" } })).toMatchObject({ kind: "text-equals" });
  });

  it("empty is judged from the authored value, or from the computed lane", () => {
    expect(onlyTerm({ fieldId: DUE.fieldId, operand: { kind: "is-empty" } })).toEqual({
      kind: "is-empty",
      fieldId: DUE.fieldId,
      isComputed: false,
    });
    expect(onlyTerm({ fieldId: BALANCE.fieldId, operand: { kind: "not-empty" } })).toEqual({
      kind: "not-empty",
      fieldId: BALANCE.fieldId,
      isComputed: true,
    });
  });

  it("a computed column's range filters its computed lane like any other", () => {
    expect(onlyTerm({ fieldId: BALANCE.fieldId, operand: { kind: "number-range", min: "0", max: null } })).toMatchObject({
      kind: "decimal-range",
      fieldId: BALANCE.fieldId,
    });
  });

  it("broken references stay a reference predicate", () => {
    expect(onlyTerm({ fieldId: CUSTOMER.fieldId, operand: { kind: "reference-broken" } })).toEqual({
      kind: "reference-broken",
      fieldId: CUSTOMER.fieldId,
    });
  });
});

describe("sort", () => {
  const sortKey = (fieldId: FieldId) => {
    const compiled = compile([], { fieldId, direction: "desc" });
    return compiled.outcome === "compiled" ? compiled.sort : null;
  };

  it("reads the lane each type orders by", () => {
    expect(sortKey(NAME.fieldId)).toEqual({ fieldId: NAME.fieldId, direction: "desc", key: "text" });
    expect(sortKey(EMAIL.fieldId)?.key).toBe("text");
    expect(sortKey(QUOTED.fieldId)?.key).toBe("decimal");
    expect(sortKey(COUNT.fieldId)?.key).toBe("decimal");
    expect(sortKey(DUE.fieldId)?.key).toBe("integer");
    expect(sortKey(URGENT.fieldId)?.key).toBe("integer");
    expect(sortKey(STATUS.fieldId)?.key).toBe("option-ordinal");
    expect(sortKey(CUSTOMER.fieldId)?.key).toBe("reference-label");
    expect(sortKey(BALANCE.fieldId)?.key).toBe("decimal");
  });

  it("refuses a field the table does not hold, or no longer shows", () => {
    expect(refusalOf([], { fieldId: RETIRED.fieldId, direction: "asc" })).toEqual({ reason: "unknown-field", fieldId: RETIRED.fieldId });
    const stranger = asDomainId("field", bytes(0x7f));
    expect(refusalOf([], { fieldId: stranger, direction: "asc" })?.reason).toBe("unknown-field");
  });
});

describe("refusals come from the one validator, naming the filter", () => {
  it("refuses an inverted range (SHT-005/006)", () => {
    expect(refusalOf([{ fieldId: DUE.fieldId, operand: { kind: "date-range", from: 20_002, to: 20_001 } }])).toEqual({
      reason: "inverted-range",
      fieldId: DUE.fieldId,
    });
    expect(refusalOf([{ fieldId: QUOTED.fieldId, operand: { kind: "number-range", min: "10", max: "9.99" } }])?.reason).toBe(
      "inverted-range",
    );
  });

  it("refuses an operator that does not fit the field", () => {
    expect(refusalOf([{ fieldId: NAME.fieldId, operand: { kind: "date-range", from: 1, to: 2 } }])?.reason).toBe(
      "operator-type-mismatch",
    );
  });

  it("refuses an unknown option, an empty set, and a non-canonical decimal", () => {
    const stranger = asDomainId("option", bytes(0x7e));
    expect(refusalOf([{ fieldId: STATUS.fieldId, operand: { kind: "enum-in", optionIds: [stranger] } }])?.reason).toBe("unknown-option");
    expect(refusalOf([{ fieldId: STATUS.fieldId, operand: { kind: "enum-in", optionIds: [] } }])?.reason).toBe("empty-filter");
    expect(refusalOf([{ fieldId: QUOTED.fieldId, operand: { kind: "number-range", min: "1e3", max: null } }])?.reason).toBe(
      "invalid-value",
    );
  });

  it("stops at the first refusal and names that filter", () => {
    const refusal = refusalOf([
      { fieldId: NAME.fieldId, operand: { kind: "text-equals", text: "Ada" } },
      { fieldId: RETIRED.fieldId, operand: { kind: "is-empty" } },
      { fieldId: DUE.fieldId, operand: { kind: "date-range", from: 3, to: 1 } },
    ]);
    expect(refusal).toEqual({ reason: "unknown-field", fieldId: RETIRED.fieldId });
  });

  it("refuses more filters, or more values in one, than a query carries", () => {
    const many = Array.from({ length: MAX_RECORD_FILTERS + 1 }, (): FilterV1 => ({ fieldId: NAME.fieldId, operand: { kind: "not-empty" } }));
    expect(refusalOf(many)?.reason).toBe("invalid-value");
    expect(compile(many.slice(0, MAX_RECORD_FILTERS)).outcome).toBe("compiled");
    const wide = Array.from({ length: MAX_FILTER_SET_SIZE + 1 }, (_, index) => {
      const id = new Uint8Array(16);
      new DataView(id.buffer).setUint32(0, index);
      return asDomainId("record", id);
    });
    expect(refusalOf([{ fieldId: CUSTOMER.fieldId, operand: { kind: "reference-in", recordIds: wide } }])?.reason).toBe("invalid-value");
  });
});

describe("readTableDefinition", () => {
  it("reads the table, its fields and its enum options from the projection", () => {
    const projection = new FakeProjection({ table: TABLE, enumOptions: OPTIONS, records: [], trace: [] });
    const read = readTableDefinition(projection, TABLE_ID);
    expect(read?.table.fields.map((definition) => definition.displayName)).toEqual(TABLE.fields.map((definition) => definition.displayName));
    expect(read?.enumOptions.map((option) => option.displayLabel)).toEqual(["Open", "Closed"]);
    expect(readTableDefinition(projection, asDomainId("table", bytes(0x7d)))).toBeNull();
  });
});
