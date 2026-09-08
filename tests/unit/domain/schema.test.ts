import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  FIELD_TYPE_KINDS,
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
});
