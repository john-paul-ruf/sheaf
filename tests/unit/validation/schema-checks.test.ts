import { describe, expect, it } from "vitest";
import { asDomainId, type FieldId } from "../../../src/domain/model/ids.js";
import type {
  EnumOptionDefV1,
  FieldDefV1,
  FieldTypeV1,
  TableDefV1,
} from "../../../src/domain/model/schema.js";
import { validateSchema } from "../../../src/domain/validation/schema-checks.js";

const tableId = asDomainId("table", new Uint8Array(16).fill(1));
const otherTableId = asDomainId("table", new Uint8Array(16).fill(2));

const fieldId = (n: number): FieldId =>
  asDomainId("field", new Uint8Array(16).fill(n));

const NAME = fieldId(10);
const STATUS = fieldId(11);

const field = (
  id: FieldId,
  type: FieldTypeV1,
  ordinal: number,
  overrides: Partial<FieldDefV1> = {},
): FieldDefV1 => ({
  fieldId: id,
  tableId,
  displayName: "Label",
  fieldOrdinal: ordinal,
  type,
  isRequired: false,
  isActive: true,
  schemaRevision: 1n,
  ...overrides,
});

const option = (
  n: number,
  ordinal: number,
  overrides: Partial<EnumOptionDefV1> = {},
): EnumOptionDefV1 => ({
  optionId: asDomainId("option", new Uint8Array(16).fill(n)),
  fieldId: STATUS,
  displayLabel: "Open",
  optionOrdinal: ordinal,
  isActive: true,
  schemaRevision: 1n,
  ...overrides,
});

const table = (overrides: Partial<TableDefV1> = {}): TableDefV1 => ({
  tableId,
  displayName: "Stock",
  tableOrdinal: 0,
  fields: [field(NAME, { kind: "text" }, 0), field(STATUS, { kind: "enum" }, 1)],
  keyFieldId: null,
  labelFieldId: null,
  sourceSheetId: null,
  isActive: true,
  schemaRevision: 1n,
  ...overrides,
});

const keys = (report: {
  issues: readonly { messageKey: string }[];
}): string[] => report.issues.map((issue) => issue.messageKey);

describe("validateSchema", () => {
  it("accepts a well-formed schema", () => {
    expect(validateSchema([table()], [option(20, 0)])).toEqual({
      isValid: true,
      issues: [],
    });
  });

  it("refuses duplicate identities and ordinals", () => {
    expect(keys(validateSchema([table(), table()], [option(20, 0)]))).toEqual(
      expect.arrayContaining([
        "schema.duplicate-table-id",
        "schema.duplicate-table-ordinal",
        "schema.duplicate-field-id",
      ]),
    );

    expect(
      keys(
        validateSchema(
          [
            table({
              fields: [
                field(NAME, { kind: "text" }, 0),
                field(fieldId(12), { kind: "text" }, 0),
              ],
            }),
          ],
          [],
        ),
      ),
    ).toContain("schema.duplicate-field-ordinal");

    expect(
      keys(validateSchema([table()], [option(20, 0), option(21, 0)])),
    ).toContain("schema.duplicate-option-ordinal");
    expect(
      keys(validateSchema([table()], [option(20, 0), option(20, 1)])),
    ).toContain("schema.duplicate-option-id");
  });

  it("requires every human label the projection declares NOT NULL", () => {
    expect(
      keys(validateSchema([table({ displayName: "" })], [option(20, 0)])),
    ).toContain("schema.missing-table-label");
    expect(
      keys(
        validateSchema(
          [
            table({
              fields: [
                field(NAME, { kind: "text" }, 0, { displayName: "" }),
                field(STATUS, { kind: "enum" }, 1),
              ],
            }),
          ],
          [option(20, 0)],
        ),
      ),
    ).toContain("schema.missing-field-label");
    expect(
      keys(validateSchema([table()], [option(20, 0, { displayLabel: "" })])),
    ).toContain("schema.missing-option-label");
  });

  it("holds enum-option integrity the way migration 005's triggers do", () => {
    // An option on a non-enum field: 005 rejects it outright.
    expect(
      keys(validateSchema([table()], [option(20, 0, { fieldId: NAME })])),
    ).toContain("schema.option-on-non-enum-field");

    // An option whose field is not in this schema at all.
    expect(
      keys(validateSchema([table()], [option(20, 0, { fieldId: fieldId(99) })])),
    ).toContain("schema.option-without-field");

    // An enum field with no active option cannot render a picker.
    expect(keys(validateSchema([table()], []))).toContain(
      "schema.enum-field-without-options",
    );
    expect(
      keys(validateSchema([table()], [option(20, 0, { isActive: false })])),
    ).toContain("schema.enum-field-without-options");
  });

  it("requires a named key or label field to belong to its table", () => {
    expect(
      keys(validateSchema([table({ keyFieldId: fieldId(99) })], [option(20, 0)])),
    ).toContain("schema.named-field-not-in-table");
    expect(
      validateSchema([table({ keyFieldId: NAME, labelFieldId: NAME })], [
        option(20, 0),
      ]).isValid,
    ).toBe(true);
  });

  it("requires a field to name its owning table", () => {
    expect(
      keys(
        validateSchema(
          [
            table({
              fields: [
                field(NAME, { kind: "text" }, 0, { tableId: otherTableId }),
                field(STATUS, { kind: "enum" }, 1),
              ],
            }),
          ],
          [option(20, 0)],
        ),
      ),
    ).toContain("schema.field-in-wrong-table");
  });

  it("refuses negative and fractional ordinals", () => {
    expect(keys(validateSchema([table({ tableOrdinal: -1 })], [option(20, 0)]))).toContain(
      "schema.invalid-table-ordinal",
    );
    expect(
      keys(
        validateSchema(
          [table({ fields: [field(NAME, { kind: "text" }, 1.5)] })],
          [],
        ),
      ),
    ).toContain("schema.invalid-field-ordinal");
    expect(
      keys(validateSchema([table()], [option(20, -1)])),
    ).toContain("schema.invalid-option-ordinal");
  });

  it("refuses a table with no fields", () => {
    expect(keys(validateSchema([table({ fields: [] })], []))).toContain(
      "schema.table-has-no-fields",
    );
  });

  it("reports every schema issue as blocking", () => {
    const report = validateSchema([table({ displayName: "" })], []);

    expect(report.isValid).toBe(false);
    for (const issue of report.issues) {
      expect(issue.kind).toBe("schema");
      expect(issue.severity).toBe("blocking");
    }
  });
});
