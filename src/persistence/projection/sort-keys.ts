/**
 * The projection's two order keys (database.md § Global Data Conventions).
 *
 * Both exist for the same reason: SQLite must sort and range-filter Sheaf's
 * values **without** a browser-specific collation and without ever coercing an
 * exact decimal to a float. Both are versioned and deliberately disposable —
 * they live only in the in-memory projection, so changing a comparison rule
 * bumps the version and rebuilds, and never rewrites a durable byte.
 *
 * `TextSortKeyV1` is just the UTF-8 encoding of NFC text: UTF-8 preserves code
 * point order under bytewise comparison, so the key is a deterministic
 * code-point order rather than an unstated locale collation.
 *
 * The decimal key implements § Decimal order key v1 step for step, and its
 * property suite proves the only thing that matters about it: bytewise order
 * equals numeric order, over generated canonical decimals.
 */

import { CodecError } from "../../domain/model/errors.js";
import { isCanonicalDecimal, isNfcText } from "../../domain/model/values.js";

export const TEXT_SORT_KEY_VERSION = 1;
export const DECIMAL_ORDER_KEY_VERSION = 1;

/** Migration 005's `cells` CHECK: `length(decimal_order_key) = 20`. */
export const DECIMAL_ORDER_KEY_BYTES = 20;

/** The v1 decimal domain: 34 significant digits, adjusted exponent range. */
export const DECIMAL_ORDER_KEY_DIGITS = 34;
export const MIN_ADJUSTED_EXPONENT = -6143;
export const MAX_ADJUSTED_EXPONENT = 6144;

const EXPONENT_BIAS = 6143;
const NEGATIVE_PREFIX = 0x00;
const ZERO_PREFIX = 0x01;
const POSITIVE_PREFIX = 0x02;
const COEFFICIENT_BYTES = DECIMAL_ORDER_KEY_DIGITS / 2;

const textEncoder = new TextEncoder();

/**
 * UTF-8 bytes of already-NFC text. Non-NFC text is refused rather than
 * normalized here: normalization belongs at the entry boundaries (D28), and a
 * key computed from text the record does not hold would sort a value that is
 * not there.
 */
export function textSortKeyV1(text: string): Uint8Array {
  if (!isNfcText(text)) {
    throw new CodecError("text sort key requires NFC text");
  }
  return textEncoder.encode(text);
}

/**
 * The 20-byte key for a canonical decimal, or `null` when the value is outside
 * the v1 decimal domain — an out-of-domain value keeps its exact text in the
 * record's authored CBOR, gains a type issue, and gets no decimal cell
 * (database.md § Decimal order key v1, last paragraph).
 *
 * Throws only when the input is not a canonical decimal at all, which is a
 * caller error rather than a domain edge.
 */
export function decimalOrderKeyV1(canonicalDecimal: string): Uint8Array | null {
  if (!isCanonicalDecimal(canonicalDecimal)) {
    throw new CodecError("decimal order key requires a canonical decimal");
  }

  const isNegative = canonicalDecimal.startsWith("-");
  const magnitude = isNegative ? canonicalDecimal.slice(1) : canonicalDecimal;
  const pointIndex = magnitude.indexOf(".");
  const digits =
    pointIndex < 0
      ? magnitude
      : magnitude.slice(0, pointIndex) + magnitude.slice(pointIndex + 1);
  const fractionDigits = pointIndex < 0 ? 0 : magnitude.length - pointIndex - 1;

  const key = new Uint8Array(DECIMAL_ORDER_KEY_BYTES);

  // Step 1: zero is normalized separately — every spelling of it is one key.
  const firstSignificant = firstSignificantIndex(digits);
  if (firstSignificant < 0) {
    key[0] = ZERO_PREFIX;
    return key;
  }

  // Step 1 (continued): strip leading and trailing zeroes, adjusting the
  // exponent by the number of trailing zeroes removed.
  const lastSignificant = lastSignificantIndex(digits);
  const coefficient = digits.slice(firstSignificant, lastSignificant + 1);
  const exponent = digits.length - 1 - lastSignificant - fractionDigits;

  // Step 2: the adjusted exponent, biased into two unsigned big-endian bytes.
  const adjustedExponent = exponent + coefficient.length - 1;
  if (
    adjustedExponent < MIN_ADJUSTED_EXPONENT ||
    adjustedExponent > MAX_ADJUSTED_EXPONENT
  ) {
    return null;
  }
  const biased = adjustedExponent + EXPONENT_BIAS;
  key[1] = (biased >>> 8) & 0xff;
  key[2] = biased & 0xff;

  // Step 3: right-pad to 34 digits and pack two digits per byte.
  const padded = coefficient.padEnd(DECIMAL_ORDER_KEY_DIGITS, "0");
  for (let index = 0; index < COEFFICIENT_BYTES; index += 1) {
    key[3 + index] =
      (digitAt(padded, index * 2) << 4) | digitAt(padded, index * 2 + 1);
  }

  // Step 4: sign prefix, and for a negative value the inverted magnitude — so
  // the larger the magnitude, the smaller the key.
  key[0] = isNegative ? NEGATIVE_PREFIX : POSITIVE_PREFIX;
  if (isNegative) {
    for (let index = 1; index < DECIMAL_ORDER_KEY_BYTES; index += 1) {
      key[index] = (key[index] as number) ^ 0xff;
    }
  }
  return key;
}

/** Bytewise order — the order SQLite uses over these BLOB keys. */
export function compareSortKeys(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = (left[index] as number) - (right[index] as number);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

const firstSignificantIndex = (digits: string): number => {
  for (let index = 0; index < digits.length; index += 1) {
    if (digits[index] !== "0") {
      return index;
    }
  }
  return -1;
};

const lastSignificantIndex = (digits: string): number => {
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] !== "0") {
      return index;
    }
  }
  return -1;
};

const digitAt = (digits: string, index: number): number =>
  (digits.charCodeAt(index) - 0x30) & 0x0f;
