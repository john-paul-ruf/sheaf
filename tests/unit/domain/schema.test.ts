import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { asDomainId } from "../../../src/domain/model/ids.js";
import {
  FIELD_TYPE_KINDS,
  isComputedField,
  STORAGE_KINDS,
  storageKindForFieldType,
  type FieldTypeV1,
} from "../../../src/domain/model/schema.js";

const everyFieldType: readonly FieldTypeV1[] = [
  { kind: "date" },
  { kind: "currency", currencyCode: "USD" },
  { kind: "number" },
  { kind: "phone" },
  { kind: "email" },
  { kind: "url" },
  { kind: "address" },
  { kind: "boolean" },
  { kind: "enum" },
  { kind: "text" },
  { kind: "reference" },
];

describe("schema definitions", () => {
  it("closes the logical-type list at migration 005's eleven types", async () => {
    const sql = await readFile("src/migrations/005_projection_v1.sql", "utf8");

    expect(FIELD_TYPE_KINDS).toHaveLength(11);
    expect(Object.isFrozen(FIELD_TYPE_KINDS)).toBe(true);
    for (const kind of FIELD_TYPE_KINDS) {
      expect(sql, kind).toContain(`'${kind}'`);
    }
    expect(everyFieldType.map((type) => type.kind)).toEqual([
      ...FIELD_TYPE_KINDS,
    ]);
  });

  it("maps every field type to the lane migration 005 requires", () => {
    expect(
      Object.fromEntries(
        everyFieldType.map((type) => [type.kind, storageKindForFieldType(type)]),
      ),
    ).toEqual({
      date: "integer",
      boolean: "integer",
      currency: "decimal",
      number: "decimal",
      enum: "id",
      reference: "id",
      phone: "text",
      email: "text",
      url: "text",
      address: "text",
      text: "text",
    });

    for (const type of everyFieldType) {
      expect(STORAGE_KINDS).toContain(storageKindForFieldType(type));
    }
  });

  it("pins the mapping against the projection's row CHECK", async () => {
    const sql = await readFile("src/migrations/005_projection_v1.sql", "utf8");

    expect(sql).toContain(
      "(logical_type IN ('currency', 'number') AND storage_kind = 'decimal')",
    );
    expect(sql).toContain(
      "(logical_type IN ('date', 'boolean') AND storage_kind = 'integer')",
    );
    expect(sql).toContain(
      "(logical_type IN ('enum', 'reference') AND storage_kind = 'id')",
    );
    expect(sql).toContain(
      "(logical_type IN ('phone', 'email', 'url', 'address', 'text') AND storage_kind = 'text')",
    );
  });

  it("marks a field computed exactly when it names its formula, as migration 005 pins is_computed", async () => {
    const sql = await readFile("src/migrations/005_projection_v1.sql", "utf8");
    expect(sql).toContain("(is_computed = 0 AND formula_id IS NULL) OR");
    expect(sql).toContain("(is_computed = 1 AND formula_id IS NOT NULL)");

    const authored = {
      fieldId: asDomainId("field", new Uint8Array(16).fill(1)),
      tableId: asDomainId("table", new Uint8Array(16).fill(2)),
      displayName: "Balance",
      fieldOrdinal: 0,
      type: { kind: "currency", currencyCode: "USD" } as const,
      isRequired: false,
      isActive: true,
      schemaRevision: 1n,
    };
    expect(isComputedField(authored)).toBe(false);
    expect(isComputedField({ ...authored, formulaId: asDomainId("formula", new Uint8Array(16).fill(3)) })).toBe(true);
  });
});
