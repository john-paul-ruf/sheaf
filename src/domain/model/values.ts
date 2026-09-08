/**
 * Cell values and their canonical forms (database.md § Canonical values).
 *
 * The union's whole point is that **absence has three distinct meanings** and
 * none of them may collapse into another:
 *
 * - `missing` — the field was never given a value here.
 * - `blank` — someone deliberately cleared it.
 * - `invalid-preserved` — an imported source value that does not fit the
 *   field's type. The original text is kept verbatim and flagged; it is never
 *   coerced to zero, to an empty string, or to `missing` (FR-4).
 *
 * Text is NFC. This module states that invariant and refuses text that
 * violates it; normalization itself happens at the entry boundaries (D28) —
 * the import parser (S03, with a diagnostic) and the wire→domain mapping for
 * authored input (S05, silently, as a keyboard artifact). No normalization
 * machinery lives here.
 *
 * Numbers are canonical decimal strings, never floats: the exact authored text
 * is the value of record, and the projection derives its 20-byte order key
 * from it. Dates are signed epoch-day integers with no hidden time zone.
 */

import { CodecError } from "./errors.js";
import { domainIdsEqual, type OptionId, type RecordId } from "./ids.js";

export const CELL_VALUE_KINDS = Object.freeze([
  "text",
  "decimal",
  "date",
  "boolean",
  "enum",
  "reference",
  "missing",
  "blank",
  "invalid-preserved",
] as const);

export type CellValueKindV1 = (typeof CELL_VALUE_KINDS)[number];

export type CellValueV1 =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "decimal"; readonly decimal: string }
  | { readonly kind: "date"; readonly epochDay: number }
  | { readonly kind: "boolean"; readonly boolean: boolean }
  | { readonly kind: "enum"; readonly optionId: OptionId }
  | { readonly kind: "reference"; readonly recordId: RecordId }
  | { readonly kind: "missing" }
  | { readonly kind: "blank" }
  | { readonly kind: "invalid-preserved"; readonly sourceText: string };

/** At most 34 significant digits (database.md § Canonical values). */
export const DECIMAL_SIGNIFICANT_DIGIT_LIMIT = 34;

/**
 * The representable date range, bounded by what a date can round-trip through
 * the platform's `Date` (±8.64e15 ms). A date outside it is not a date Sheaf
 * can display, so it is refused rather than stored unrenderable.
 */
export const MIN_EPOCH_DAY = -100_000_000;
export const MAX_EPOCH_DAY = 100_000_000;

/**
 * Canonical decimal grammar: an optional sign, an integer part with no
 * redundant leading zero, and an optional fraction. Exponent notation, a bare
 * leading or trailing point, `+`, whitespace, `Infinity`, and `NaN` are all
 * outside it — a source string in any of those shapes is the import parser's
 * problem, not a value the domain silently reinterprets.
 *
 * Trailing fraction zeros are preserved: `10.50` is a different spelling from
 * `10.5` and currency scale is authored information.
 */
const CANONICAL_DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

const significantDigitCount = (decimal: string): number => {
  const digits = decimal.replace("-", "").replace(".", "").replace(/^0+/, "");
  return digits.length;
};

const isNegativeZero = (decimal: string): boolean =>
  decimal.startsWith("-") && significantDigitCount(decimal) === 0;

export function isNfcText(text: string): boolean {
  return text.normalize("NFC") === text;
}

export function isCanonicalDecimal(text: string): boolean {
  return (
    CANONICAL_DECIMAL.test(text) &&
    !isNegativeZero(text) &&
    significantDigitCount(text) <= DECIMAL_SIGNIFICANT_DIGIT_LIMIT
  );
}

/**
 * Returns the canonical spelling of an already-well-formed decimal. The single
 * rewrite it performs is dropping a negative zero's sign, because `-0` and `0`
 * denote the same quantity and two spellings of one value would break byte
 * comparison of durable payloads. Anything else non-canonical is rejected.
 */
export function canonicalizeDecimal(text: string): string {
  if (!CANONICAL_DECIMAL.test(text)) {
    throw new CodecError("decimal is not in canonical form");
  }
  if (significantDigitCount(text) > DECIMAL_SIGNIFICANT_DIGIT_LIMIT) {
    throw new CodecError("decimal exceeds 34 significant digits");
  }
  return isNegativeZero(text) ? text.slice(1) : text;
}

export function textValue(text: string): CellValueV1 {
  if (!isNfcText(text)) {
    throw new CodecError("text value is not NFC");
  }
  return { kind: "text", text };
}

export function decimalValue(text: string): CellValueV1 {
  return { kind: "decimal", decimal: canonicalizeDecimal(text) };
}

export function dateValue(epochDay: number): CellValueV1 {
  if (!Number.isInteger(epochDay)) {
    throw new CodecError("date value must be a whole epoch day");
  }
  if (epochDay < MIN_EPOCH_DAY || epochDay > MAX_EPOCH_DAY) {
    throw new CodecError("date value is outside the representable range");
  }
  return { kind: "date", epochDay };
}

export function booleanValue(value: boolean): CellValueV1 {
  return { kind: "boolean", boolean: value };
}

export function enumValue(optionId: OptionId): CellValueV1 {
  return { kind: "enum", optionId };
}

export function referenceValue(recordId: RecordId): CellValueV1 {
  return { kind: "reference", recordId };
}

export const MISSING_VALUE: CellValueV1 = Object.freeze({ kind: "missing" });
export const BLANK_VALUE: CellValueV1 = Object.freeze({ kind: "blank" });

/** Keeps an imported value that does not fit its field, exactly as authored. */
export function invalidPreservedValue(sourceText: string): CellValueV1 {
  if (!isNfcText(sourceText)) {
    throw new CodecError("text value is not NFC");
  }
  return { kind: "invalid-preserved", sourceText };
}

/**
 * True for the two states that carry no value at all. An `invalid-preserved`
 * value is **not** absent: it holds source text a user can still see and fix.
 */
export function isAbsentCellValue(value: CellValueV1): boolean {
  return value.kind === "missing" || value.kind === "blank";
}

export function cellValuesEqual(left: CellValueV1, right: CellValueV1): boolean {
  switch (left.kind) {
    case "text":
      return right.kind === "text" && left.text === right.text;
    case "decimal":
      return right.kind === "decimal" && left.decimal === right.decimal;
    case "date":
      return right.kind === "date" && left.epochDay === right.epochDay;
    case "boolean":
      return right.kind === "boolean" && left.boolean === right.boolean;
    case "enum":
      return (
        right.kind === "enum" && domainIdsEqual(left.optionId, right.optionId)
      );
    case "reference":
      return (
        right.kind === "reference" &&
        domainIdsEqual(left.recordId, right.recordId)
      );
    case "missing":
      return right.kind === "missing";
    case "blank":
      return right.kind === "blank";
    case "invalid-preserved":
      return (
        right.kind === "invalid-preserved" &&
        left.sourceText === right.sourceText
      );
    default: {
      const unreachable: never = left;
      return unreachable;
    }
  }
}
