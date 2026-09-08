/**
 * Table and field definitions (database.md § `schema_tables`, `schema_fields`,
 * `enum_options`).
 *
 * Every human-readable name here is a **value**: `displayName` and
 * `displayLabel` are edited freely and carry no identity. Identity is the
 * stable 16-byte ID beside them, which is why renaming a table, a field, or an
 * enum option rewrites no record.
 *
 * The logical-type list is closed for schema version 1 and its mapping to a
 * storage kind is the same mapping migration 005 enforces with a row `CHECK`;
 * `tests/unit/domain/schema.test.ts` pins the two against each other.
 */

import type { FieldId, OptionId, SheetId, TableId } from "./ids.js";

export const FIELD_TYPE_KINDS = Object.freeze([
  "date",
  "currency",
  "number",
  "phone",
  "email",
  "url",
  "address",
  "boolean",
  "enum",
  "text",
  "reference",
] as const);

export type FieldTypeKindV1 = (typeof FIELD_TYPE_KINDS)[number];

/**
 * `reference` is defined but has no F02 producer (D25): value-only CSV apps
 * detect no relationships, and the surfaces that author one arrive in F03. It
 * is declared now so the closed list, the storage mapping, and the validator's
 * reference-shape check are complete rather than retrofitted.
 */
export type FieldTypeV1 =
  | { readonly kind: "date" }
  | { readonly kind: "currency"; readonly currencyCode: string }
  | { readonly kind: "number" }
  | { readonly kind: "phone" }
  | { readonly kind: "email" }
  | { readonly kind: "url" }
  | { readonly kind: "address" }
  | { readonly kind: "boolean" }
  | { readonly kind: "enum" }
  | { readonly kind: "text" }
  | { readonly kind: "reference" };

export const STORAGE_KINDS = Object.freeze([
  "text",
  "decimal",
  "integer",
  "id",
] as const);

export type StorageKindV1 = (typeof STORAGE_KINDS)[number];

/** The typed projection lane a field's values occupy while unlocked. */
export function storageKindForFieldType(type: FieldTypeV1): StorageKindV1 {
  switch (type.kind) {
    case "currency":
    case "number":
      return "decimal";
    case "date":
    case "boolean":
      return "integer";
    case "enum":
    case "reference":
      return "id";
    case "phone":
    case "email":
    case "url":
    case "address":
    case "text":
      return "text";
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

/**
 * There is deliberately no `isComputed`/`formulaId` pair here. F02 has no
 * formula engine, so every field is authored; declaring the computed half now
 * would let a writer assert a computed field that nothing can evaluate
 * (invariant 7). The projection's `is_computed` column is written `0` for
 * every F02 field, and F04's formula work adds the fields with their producer.
 */
export interface FieldDefV1 {
  readonly fieldId: FieldId;
  readonly tableId: TableId;
  /** A user-editable label, never an identifier. */
  readonly displayName: string;
  readonly fieldOrdinal: number;
  readonly type: FieldTypeV1;
  readonly isRequired: boolean;
  readonly isActive: boolean;
  readonly schemaRevision: bigint;
}

export interface EnumOptionDefV1 {
  readonly optionId: OptionId;
  readonly fieldId: FieldId;
  /** A user-editable label; renaming an option rewrites no record. */
  readonly displayLabel: string;
  readonly optionOrdinal: number;
  /** Inactive options stay interpretable so imported history stays readable. */
  readonly isActive: boolean;
  readonly schemaRevision: bigint;
}

export interface TableDefV1 {
  readonly tableId: TableId;
  readonly displayName: string;
  readonly tableOrdinal: number;
  readonly fields: readonly FieldDefV1[];
  /** The authored identity field, when the table has one. */
  readonly keyFieldId: FieldId | null;
  /** The field whose value labels a row in a reference; F03 populates it. */
  readonly labelFieldId: FieldId | null;
  /** The imported sheet this table came from, or null when authored. */
  readonly sourceSheetId: SheetId | null;
  readonly isActive: boolean;
  readonly schemaRevision: bigint;
}
