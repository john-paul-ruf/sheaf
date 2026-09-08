import { describe, expect, it } from "vitest";
import { asDomainId } from "../../../src/domain/model/ids.js";
import type { FieldId } from "../../../src/domain/model/ids.js";
import type { FieldDefV1, FieldTypeV1 } from "../../../src/domain/model/schema.js";
import {
  BLANK_VALUE,
  booleanValue,
  dateValue,
  decimalValue,
  enumValue,
  invalidPreservedValue,
  MISSING_VALUE,
  textValue,
} from "../../../src/domain/model/values.js";
import {
  deriveIssueId,
  idKey,
  projectCellValue,
  searchableTextFor,
} from "../../../src/persistence/projection/record-rows.js";
import {
  decimalOrderKeyV1,
  textSortKeyV1,
} from "../../../src/persistence/projection/sort-keys.js";
import type {
  ProjectionRecordV1,
  ProjectionSchemaCacheV1,
} from "../../../src/persistence/projection/types.js";

const tableId = asDomainId("table", new Uint8Array(16).fill(1));
const recordId = asDomainId("record", new Uint8Array(16).fill(2));
const commitId = asDomainId("commit", new Uint8Array(16).fill(3));
const optionId = asDomainId("option", new Uint8Array(16).fill(4));

let nextField = 10;
const field = (type: FieldTypeV1, overrides: Partial<FieldDefV1> = {}): FieldDefV1 => {
  nextField += 1;
  return {
    fieldId: asDomainId("field", new Uint8Array(16).fill(nextField)),
    tableId,
    displayName: `Field ${nextField}`,
    fieldOrdinal: nextField,
    type,
    isRequired: false,
    isActive: true,
    schemaRevision: 1n,
    ...overrides,
  };
};

const lanesOf = (projection: ReturnType<typeof projectCellValue>) =>
  projection.lane === null
    ? null
    : Object.entries(projection.lane)
        .filter(([name, value]) => name !== "valueKind" && value !== null)
        .map(([name]) => name)
        .sort();

describe("typed lanes", () => {
  it("puts each value in exactly one lane, with its order key", () => {
    const text = field({ kind: "text" });
    const money = field({ kind: "currency", currencyCode: "USD" });
    const when = field({ kind: "date" });
    const flag = field({ kind: "boolean" });
    const choice = field({ kind: "enum" });

    const textCell = projectCellValue(text, textValue("Ada"));
    expect(textCell.lane?.valueKind).toBe("text");
    expect(lanesOf(textCell)).toEqual(["textSortKey", "textValue"]);
    expect(textCell.lane?.textSortKey).toEqual(textSortKeyV1("Ada"));

    const moneyCell = projectCellValue(money, decimalValue("10.50"));
    expect(moneyCell.lane?.valueKind).toBe("decimal");
    expect(lanesOf(moneyCell)).toEqual(["decimalOrderKey", "decimalValue"]);
    // The exact authored text is the value of record; the key only indexes it.
    expect(moneyCell.lane?.decimalValue).toBe("10.50");
    expect(moneyCell.lane?.decimalOrderKey).toEqual(decimalOrderKeyV1("10.50"));

    const dateCell = projectCellValue(when, dateValue(-19_000));
    expect(dateCell.lane?.valueKind).toBe("integer");
    expect(dateCell.lane?.integerValue).toBe(-19_000);
    expect(lanesOf(dateCell)).toEqual(["integerValue"]);

    expect(projectCellValue(flag, booleanValue(false)).lane).toMatchObject({
      valueKind: "integer",
      integerValue: 0,
    });
    // False is a value, not an absence: it occupies its lane as 0.
    expect(lanesOf(projectCellValue(flag, booleanValue(false)))).toEqual([
      "integerValue",
    ]);

    const enumCell = projectCellValue(choice, enumValue(optionId));
    expect(enumCell.lane?.valueKind).toBe("id");
    expect(enumCell.lane?.idValue).toEqual(optionId);
    expect(lanesOf(enumCell)).toEqual(["idValue"]);
  });

  it("gives the three absences no lane and no issue of its own", () => {
    const text = field({ kind: "text" });

    for (const value of [
      MISSING_VALUE,
      BLANK_VALUE,
      invalidPreservedValue("twelve dollars"),
    ]) {
      // The shared validator has already ruled on these; the projection keeps
      // them in the authored blob and adds nothing.
      expect(projectCellValue(text, value)).toEqual({ lane: null, issue: null });
    }
  });

  it("refuses to coerce a value into the wrong lane", () => {
    const money = field({ kind: "number" });

    expect(projectCellValue(money, textValue("12"))).toEqual({
      lane: null,
      issue: null,
    });
  });

  it("flags a decimal outside the key domain instead of indexing it", () => {
    const money = field({ kind: "number" });
    const tiny = `0.${"0".repeat(6143)}1`;

    const projected = projectCellValue(money, decimalValue(tiny));

    expect(projected.lane).toBeNull();
    expect(projected.issue).toEqual({
      fieldId: money.fieldId,
      ruleId: null,
      kind: "type",
      severity: "warning",
      messageKey: "validation.decimal-out-of-domain",
      messageParameters: { fieldLabel: money.displayName },
    });
    // Parameters explain the field, never the value.
    expect(JSON.stringify(projected.issue)).not.toContain("0.000");
  });
});

describe("searchable text", () => {
  const name = field({ kind: "text" }, { fieldOrdinal: 0 });
  const amount = field({ kind: "number" }, { fieldOrdinal: 1 });
  const status = field({ kind: "enum" }, { fieldOrdinal: 2 });
  const retired = field({ kind: "text" }, { fieldOrdinal: 3, isActive: false });
  const when = field({ kind: "date" }, { fieldOrdinal: 4 });

  const schema: ProjectionSchemaCacheV1 = {
    tables: new Map(),
    fieldsByTable: new Map([[idKey(tableId), [name, amount, status, retired, when]]]),
    fields: new Map(),
    enumOptions: new Map(),
    optionLabels: new Map([[idKey(optionId), "Overdue"]]),
  };

  const record = (values: readonly [FieldId, ReturnType<typeof textValue>][]): ProjectionRecordV1 => ({
    record: {
      recordId,
      tableId,
      values: new Map(values),
      provenance: new Map(),
    },
    recordRevision: 0n,
    createdCommitId: commitId,
    updatedCommitId: commitId,
    issues: [],
  });

  it("indexes what a person reads, in schema order", () => {
    expect(
      searchableTextFor(
        schema,
        record([
          [status.fieldId, enumValue(optionId)],
          [name.fieldId, textValue("Ada Lovelace")],
          [amount.fieldId, decimalValue("10.50")],
        ]),
      ),
      // Ordinal order, and the option's label rather than its ID.
    ).toBe("Ada Lovelace\n10.50\nOverdue");
  });

  it("indexes a preserved invalid value, because a person can see it", () => {
    expect(
      searchableTextFor(
        schema,
        record([[name.fieldId, invalidPreservedValue("twelve dollars")]]),
      ),
    ).toBe("twelve dollars");
  });

  it("leaves out retired fields, dates, and absent values", () => {
    expect(
      searchableTextFor(
        schema,
        record([
          [retired.fieldId, textValue("old note")],
          [when.fieldId, dateValue(0)],
          [amount.fieldId, MISSING_VALUE],
        ]),
      ),
    ).toBe("");
  });
});

describe("derived issue identity", () => {
  it("is stable for a row and position, and distinct across both", () => {
    expect(deriveIssueId(7, 0)).toEqual(deriveIssueId(7, 0));
    expect(deriveIssueId(7, 0)).toHaveLength(16);
    expect(deriveIssueId(7, 0)).not.toEqual(deriveIssueId(7, 1));
    expect(deriveIssueId(7, 0)).not.toEqual(deriveIssueId(8, 0));
  });
});
