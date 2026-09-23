/**
 * The records filter IR (CA-29; SHT-004–008). One {@link FilterV1} names a
 * field and a typed operand; a query ANDs its filters with its search. A
 * chart's tapped mark becomes one of these (D54), which the records query
 * accepts verbatim.
 *
 * The IR carries values, never SQL: S04's compiler binds every operand as a
 * parameter over the typed projection lanes. {@link validateFilter} refuses
 * what a filter sheet must never submit — an operator that does not fit the
 * field, an inverted range (SHT-005/006), an unknown field or option — as a
 * typed refusal the sheet can render.
 */

import type { FieldId, OptionId, RecordId } from "./ids.js";
import { encodeDomainId } from "./ids.js";
import type { EnumOptionDefV1, FieldTypeKindV1, TableDefV1 } from "./schema.js";
import { isCanonicalDecimal, isNfcText, MAX_EPOCH_DAY, MIN_EPOCH_DAY } from "./values.js";

export type FilterOperandV1 =
  /** SHT-004: any of these options. */
  | { readonly kind: "enum-in"; readonly optionIds: readonly OptionId[] }
  /** SHT-005: inclusive epoch days; either bound may be open. */
  | { readonly kind: "date-range"; readonly from: number | null; readonly to: number | null }
  /** SHT-006: inclusive canonical decimals; either bound may be open. */
  | { readonly kind: "number-range"; readonly min: string | null; readonly max: string | null }
  /** SHT-007. */
  | { readonly kind: "boolean-is"; readonly value: boolean }
  /** SHT-008: points at any of these records. */
  | { readonly kind: "reference-in"; readonly recordIds: readonly RecordId[] }
  /** SHT-008: holds a key or a record that resolves nowhere (D36). */
  | { readonly kind: "reference-broken" }
  /** Full-text match inside the field. */
  | { readonly kind: "text-contains"; readonly text: string }
  | { readonly kind: "text-equals"; readonly text: string }
  | { readonly kind: "is-empty" }
  | { readonly kind: "not-empty" };

export type FilterOperandKindV1 = FilterOperandV1["kind"];

export interface FilterV1 {
  readonly fieldId: FieldId;
  readonly operand: FilterOperandV1;
}

export const FILTER_REFUSAL_REASONS = Object.freeze([
  "unknown-field",
  /** The operand does not fit the field's logical type. */
  "operator-type-mismatch",
  "unknown-option",
  /** `from > to` or `min > max` (SHT-005/006). */
  "inverted-range",
  /** A range with neither bound, or an empty option/record set. */
  "empty-filter",
  /** A non-canonical decimal, a fractional or out-of-range day, non-NFC text. */
  "invalid-value",
] as const);

export type FilterRefusalReasonV1 = (typeof FILTER_REFUSAL_REASONS)[number];

export interface FilterRefusalV1 {
  readonly reason: FilterRefusalReasonV1;
  readonly fieldId: FieldId;
}

const TEXT_TYPES: readonly FieldTypeKindV1[] = ["text", "phone", "email", "url", "address"];

/** The field types each operand fits; `is-empty`/`not-empty` fit every field. */
const FITS: Readonly<Record<FilterOperandKindV1, readonly FieldTypeKindV1[] | "any">> = {
  "enum-in": ["enum"],
  "date-range": ["date"],
  "number-range": ["number", "currency"],
  "boolean-is": ["boolean"],
  "reference-in": ["reference"],
  "reference-broken": ["reference"],
  "text-contains": TEXT_TYPES,
  "text-equals": TEXT_TYPES,
  "is-empty": "any",
  "not-empty": "any",
};

/** Numeric order of two canonical decimal strings, without a float. */
export function compareCanonicalDecimals(left: string, right: string): number {
  const sign = (text: string): number => (text.startsWith("-") ? -1 : /^0(\.0+)?$/.test(text) ? 0 : 1);
  if (sign(left) !== sign(right)) return sign(left) - sign(right);
  const [leftInteger = "", leftFraction = ""] = left.replace("-", "").split(".");
  const [rightInteger = "", rightFraction = ""] = right.replace("-", "").split(".");
  const width = Math.max(leftFraction.length, rightFraction.length);
  const a = `${leftInteger.padStart(40, "0")}${leftFraction.padEnd(width, "0")}`;
  const b = `${rightInteger.padStart(40, "0")}${rightFraction.padEnd(width, "0")}`;
  const magnitude = a < b ? -1 : a > b ? 1 : 0;
  return sign(left) < 0 ? -magnitude : magnitude;
}

const isDay = (value: number | null): boolean =>
  value === null || (Number.isInteger(value) && value >= MIN_EPOCH_DAY && value <= MAX_EPOCH_DAY);

/**
 * `null` when the filter is well-formed for this table, else the first
 * reason it is not. `enumOptions` holds every option of the table's enum
 * fields, active or not — filtering by a retired option finds its records.
 */
export function validateFilter(
  filter: FilterV1,
  table: TableDefV1,
  enumOptions: readonly EnumOptionDefV1[],
): FilterRefusalV1 | null {
  const refuse = (reason: FilterRefusalReasonV1): FilterRefusalV1 => ({ reason, fieldId: filter.fieldId });
  const key = encodeDomainId(filter.fieldId);
  const field = table.fields.find((candidate) => candidate.isActive && encodeDomainId(candidate.fieldId) === key);
  if (field === undefined) return refuse("unknown-field");
  const fits = FITS[filter.operand.kind];
  if (fits !== "any" && !fits.includes(field.type.kind)) return refuse("operator-type-mismatch");

  const operand = filter.operand;
  switch (operand.kind) {
    case "enum-in": {
      if (operand.optionIds.length === 0) return refuse("empty-filter");
      const known = new Set(
        enumOptions.filter((option) => encodeDomainId(option.fieldId) === key).map((option) => encodeDomainId(option.optionId)),
      );
      return operand.optionIds.every((optionId) => known.has(encodeDomainId(optionId))) ? null : refuse("unknown-option");
    }
    case "date-range":
      if (operand.from === null && operand.to === null) return refuse("empty-filter");
      if (!isDay(operand.from) || !isDay(operand.to)) return refuse("invalid-value");
      return operand.from !== null && operand.to !== null && operand.from > operand.to ? refuse("inverted-range") : null;
    case "number-range":
      if (operand.min === null && operand.max === null) return refuse("empty-filter");
      if ((operand.min !== null && !isCanonicalDecimal(operand.min)) || (operand.max !== null && !isCanonicalDecimal(operand.max))) {
        return refuse("invalid-value");
      }
      return operand.min !== null && operand.max !== null && compareCanonicalDecimals(operand.min, operand.max) > 0
        ? refuse("inverted-range")
        : null;
    case "reference-in":
      return operand.recordIds.length === 0 ? refuse("empty-filter") : null;
    case "text-contains":
    case "text-equals":
      if (operand.text.length === 0) return refuse("empty-filter");
      return isNfcText(operand.text) ? null : refuse("invalid-value");
    case "boolean-is":
    case "reference-broken":
    case "is-empty":
    case "not-empty":
      return null;
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}
