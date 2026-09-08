/**
 * How one piece of source text becomes one cell value (M21; FR-6).
 *
 * This module exists so that **one** rule decides both things that must agree:
 * what inference counts as fitting a proposed type, and what promotion actually
 * stores. If the review screen says "two values do not match their field", the
 * two values it means are exactly the two {@link sourceTextToCellValue} refuses
 * — because it is the same function on both sides.
 *
 * Nothing is ever coerced (FR-6). A value that does not fit becomes
 * `invalid-preserved`, holding its original text verbatim, which the shared
 * validator later reports as a warning rather than a rejection.
 *
 * Two spelling rules follow from the domain's canonical-decimal grammar
 * (`values.ts`), which refuses exponents, redundant leading zeros, and bare
 * points outright:
 *
 * - a leading zero (`007.50`) or a bare point (`.5`, `5.`) is **canonicalized**,
 *   because the quantity and the authored precision both survive the rewrite;
 * - an exponent (`1e3`) is **preserved as invalid**, because rewriting it would
 *   invent an authored spelling the user never wrote, and `1e300` would invent
 *   three hundred digits of it.
 */

import type { FieldTypeV1 } from "../../domain/model/schema.js";
import {
  BLANK_VALUE,
  booleanValue,
  canonicalizeDecimal,
  dateValue,
  decimalValue,
  invalidPreservedValue,
  isCanonicalDecimal,
  MAX_EPOCH_DAY,
  MIN_EPOCH_DAY,
  textValue,
  type CellValueV1,
} from "../../domain/model/values.js";

/**
 * A value-only import can never propose a `reference`: nothing in a delimited
 * file declares a relationship, and F02 ships no producer for one (D25). The
 * exclusion is a type, so a future writer cannot propose one by accident.
 */
export type ProposedFieldTypeV1 = Exclude<FieldTypeV1, { kind: "reference" }>;

export type SourceValueFormatV1 =
  | { readonly kind: "text" }
  | { readonly kind: "iso-date" }
  | { readonly kind: "slash-date"; readonly order: "dmy" | "mdy" }
  | {
      readonly kind: "decimal";
      /** The symbol every value must carry, or null for a bare number. */
      readonly currencySymbol: string | null;
    }
  | { readonly kind: "boolean" }
  | { readonly kind: "enum" };

/** Everything conversion needs, without depending on the proposal's shape. */
export interface SourceTypingV1 {
  readonly type: ProposedFieldTypeV1;
  readonly sourceFormat: SourceValueFormatV1;
  /** Option labels, for an enum field; empty otherwise. */
  readonly enumOptions: readonly string[];
}

/**
 * An enum value cannot be finished here: its `OptionId` is allocated at
 * promotion, when the option set becomes durable. Conversion therefore names
 * the matched option and lets the promoting session bind the identity.
 */
export type SourceCellV1 =
  | { readonly kind: "value"; readonly value: CellValueV1 }
  | { readonly kind: "enum-option"; readonly label: string };

export const CURRENCY_SYMBOLS: ReadonlyMap<string, string> = new Map([
  ["$", "USD"],
  ["€", "EUR"],
  ["£", "GBP"],
  ["¥", "JPY"],
  ["USD", "USD"],
  ["EUR", "EUR"],
  ["GBP", "GBP"],
  ["JPY", "JPY"],
]);

const TRUE_WORDS = new Set(["true", "yes", "y", "t"]);
const FALSE_WORDS = new Set(["false", "no", "n", "f"]);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const LOOSE_DECIMAL = /^[+-]?(?:\d[\d,]*)?(?:\.\d*)?$/;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
const WEB_URL = /^https?:\/\/[^\s]+$/i;
const TELEPHONE = /^\+?[\d(][\d\s().+-]{5,23}$/;

const epochDayOf = (year: number, month: number, day: number): number | null => {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const epochDay = Math.floor(utc / 86_400_000);
  return epochDay < MIN_EPOCH_DAY || epochDay > MAX_EPOCH_DAY ? null : epochDay;
};

const readDate = (
  text: string,
  format: SourceValueFormatV1,
): number | null => {
  if (format.kind === "iso-date") {
    const parts = ISO_DATE.exec(text);
    return parts === null
      ? null
      : epochDayOf(Number(parts[1]), Number(parts[2]), Number(parts[3]));
  }
  if (format.kind !== "slash-date") {
    return null;
  }
  const parts = SLASH_DATE.exec(text);
  if (parts === null) {
    return null;
  }
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  return format.order === "dmy"
    ? epochDayOf(Number(parts[3]), second, first)
    : epochDayOf(Number(parts[3]), first, second);
};

/**
 * The currency symbol this text carries, as a prefix or a suffix, together with
 * what is left once it is removed. `null` when the text carries none.
 */
export const splitCurrency = (
  text: string,
): { readonly symbol: string; readonly amount: string } | null => {
  for (const symbol of CURRENCY_SYMBOLS.keys()) {
    if (text.startsWith(symbol)) {
      return { symbol, amount: text.slice(symbol.length).trim() };
    }
    if (text.endsWith(symbol)) {
      return { symbol, amount: text.slice(0, -symbol.length).trim() };
    }
  }
  return null;
};

/** Canonical spelling of a decimal a person would write, or null if it is not one. */
export const readDecimal = (text: string): string | null => {
  if (!LOOSE_DECIMAL.test(text)) {
    return null;
  }
  const sign = text.startsWith("-") ? "-" : "";
  const unsigned = text.replace(/^[+-]/, "").replace(/,/g, "");
  const [whole = "", fraction] = unsigned.split(".");
  if (whole === "" && (fraction === undefined || fraction === "")) {
    return null;
  }
  const digits = whole.replace(/^0+(?=\d)/, "");
  const body =
    fraction === undefined || fraction === ""
      ? digits === ""
        ? "0"
        : digits
      : `${digits === "" ? "0" : digits}.${fraction}`;
  const candidate = `${sign}${body}`;
  return isCanonicalDecimal(candidate) ? canonicalizeDecimal(candidate) : null;
};

/** True when the text reads as this pattern; the inference evidence's predicate. */
export const matchesPattern = (
  text: string,
  format: SourceValueFormatV1,
): boolean => {
  switch (format.kind) {
    case "iso-date":
    case "slash-date":
      return readDate(text, format) !== null;
    case "boolean": {
      const word = text.toLowerCase();
      return TRUE_WORDS.has(word) || FALSE_WORDS.has(word);
    }
    case "decimal": {
      if (format.currencySymbol === null) {
        return readDecimal(text) !== null;
      }
      const split = splitCurrency(text);
      return (
        split !== null &&
        split.symbol === format.currencySymbol &&
        readDecimal(split.amount) !== null
      );
    }
    case "text":
    case "enum":
      return true;
    default: {
      const unreachable: never = format;
      return unreachable;
    }
  }
};

export const isEmailText = (text: string): boolean => EMAIL.test(text);
export const isWebUrlText = (text: string): boolean => WEB_URL.test(text);

export const isTelephoneText = (text: string): boolean => {
  if (!TELEPHONE.test(text)) {
    return false;
  }
  const digits = text.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
};

/**
 * Converts one source cell for a proposed field. Total: every text either
 * becomes the field's value kind or is preserved verbatim and flagged.
 */
export function sourceTextToCellValue(
  text: string,
  typing: SourceTypingV1,
): SourceCellV1 {
  if (text === "") {
    return { kind: "value", value: BLANK_VALUE };
  }
  const invalid: SourceCellV1 = {
    kind: "value",
    value: invalidPreservedValue(text),
  };

  switch (typing.type.kind) {
    case "date": {
      const epochDay = readDate(text, typing.sourceFormat);
      return epochDay === null
        ? invalid
        : { kind: "value", value: dateValue(epochDay) };
    }
    case "currency":
    case "number": {
      const format = typing.sourceFormat;
      if (format.kind !== "decimal") {
        return invalid;
      }
      if (format.currencySymbol === null) {
        const decimal = readDecimal(text);
        return decimal === null
          ? invalid
          : { kind: "value", value: decimalValue(decimal) };
      }
      const split = splitCurrency(text);
      if (split === null || split.symbol !== format.currencySymbol) {
        return invalid;
      }
      const decimal = readDecimal(split.amount);
      return decimal === null
        ? invalid
        : { kind: "value", value: decimalValue(decimal) };
    }
    case "boolean": {
      const word = text.toLowerCase();
      if (TRUE_WORDS.has(word)) {
        return { kind: "value", value: booleanValue(true) };
      }
      if (FALSE_WORDS.has(word)) {
        return { kind: "value", value: booleanValue(false) };
      }
      return invalid;
    }
    case "enum":
      return typing.enumOptions.includes(text)
        ? { kind: "enum-option", label: text }
        : invalid;
    case "phone":
    case "email":
    case "url":
    case "address":
    case "text":
      // Every one of these stores text, so no source text can fail to fit;
      // a value that does not *look* like a phone number is still a phone
      // number the user typed, and Sheaf does not overrule them.
      return { kind: "value", value: textValue(text) };
    default: {
      const unreachable: never = typing.type;
      return unreachable;
    }
  }
}
