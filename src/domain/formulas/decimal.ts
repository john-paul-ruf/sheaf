/**
 * Exact decimal arithmetic for the formula evaluator (M03; database.md §
 * Canonical values). A value is a signed bigint coefficient and a base-10
 * scale, so `10.50` is `1050 × 10⁻²` and nothing ever passes through a binary
 * float: currency stays exact.
 *
 * Every operation returns a value inside the v1 decimal domain — at most 34
 * significant digits, adjusted exponent ≥ −6143 — or `null` when the true
 * result's integer part does not fit (the caller's `#NUM!`). Rounding to 34
 * digits is half-even, the decimal128 default; trailing fraction zeros are
 * kept when they fit, so `1200.00 − 200.00` is `1000.00`.
 */

import { DECIMAL_SIGNIFICANT_DIGIT_LIMIT } from "../model/values.js";

export interface DecimalV1 {
  readonly coefficient: bigint;
  /** Digits after the point; never negative. */
  readonly scale: number;
}

export type RoundingModeV1 =
  | "half-even"
  /** Excel's `ROUND`: halves go away from zero. */
  | "half-away"
  /** `ROUNDUP`. */
  | "away"
  /** `ROUNDDOWN`. */
  | "toward-zero"
  | "floor"
  | "ceiling";

const MIN_ADJUSTED_EXPONENT = -6143;
const GUARD_DIGITS = DECIMAL_SIGNIFICANT_DIGIT_LIMIT + 2;

export const DECIMAL_ZERO: DecimalV1 = Object.freeze({ coefficient: 0n, scale: 0 });
export const DECIMAL_ONE: DecimalV1 = Object.freeze({ coefficient: 1n, scale: 0 });

const TEN = 10n;
const pow10 = (exponent: number): bigint => TEN ** BigInt(exponent);
const abs = (value: bigint): bigint => (value < 0n ? -value : value);
const digitCount = (value: bigint): number => (value === 0n ? 0 : abs(value).toString().length);

/** `numerator / denominator` (denominator > 0) rounded to an integer. */
function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingModeV1): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  const isNegative = numerator < 0n;
  const twice = abs(remainder) * 2n;
  const awayFromZero = isNegative ? quotient - 1n : quotient + 1n;
  switch (mode) {
    case "toward-zero":
      return quotient;
    case "away":
      return awayFromZero;
    case "floor":
      return isNegative ? awayFromZero : quotient;
    case "ceiling":
      return isNegative ? quotient : awayFromZero;
    case "half-away":
      return twice >= denominator ? awayFromZero : quotient;
    case "half-even":
      if (twice > denominator) return awayFromZero;
      if (twice < denominator) return quotient;
      return quotient % 2n === 0n ? quotient : awayFromZero;
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

/** Brings a value into the v1 domain, or `null` when its integer part overflows. */
export function normalizeDecimal(value: DecimalV1): DecimalV1 | null {
  let { coefficient, scale } = value;
  while (digitCount(coefficient) > DECIMAL_SIGNIFICANT_DIGIT_LIMIT && scale > 0 && coefficient % TEN === 0n) {
    coefficient /= TEN;
    scale -= 1;
  }
  const excess = digitCount(coefficient) - DECIMAL_SIGNIFICANT_DIGIT_LIMIT;
  if (excess > 0) {
    if (excess > scale) return null;
    coefficient = divideRounded(coefficient, pow10(excess), "half-even");
    scale -= excess;
    // A carry (9.99… → 10.0…) can add one digit back.
    if (digitCount(coefficient) > DECIMAL_SIGNIFICANT_DIGIT_LIMIT) {
      if (scale === 0) return null;
      coefficient = divideRounded(coefficient, TEN, "half-even");
      scale -= 1;
    }
  }
  if (coefficient !== 0n && digitCount(coefficient) - 1 - scale < MIN_ADJUSTED_EXPONENT) {
    return DECIMAL_ZERO;
  }
  return { coefficient, scale };
}

/** Reads a canonical decimal string (`src/domain/model/values.ts` grammar). */
export function parseDecimal(text: string): DecimalV1 {
  const isNegative = text.startsWith("-");
  const [integer = "0", fraction = ""] = (isNegative ? text.slice(1) : text).split(".");
  const magnitude = BigInt(`${integer}${fraction}`);
  return { coefficient: isNegative ? -magnitude : magnitude, scale: fraction.length };
}

/** The canonical spelling; the value must already be normalized. */
export function formatDecimal(value: DecimalV1): string {
  const digits = abs(value.coefficient).toString().padStart(value.scale + 1, "0");
  const integer = digits.slice(0, digits.length - value.scale);
  const fraction = digits.slice(digits.length - value.scale);
  const sign = value.coefficient < 0n ? "-" : "";
  return `${sign}${integer}${fraction === "" ? "" : `.${fraction}`}`;
}

/**
 * A formula's number literal as authored (`2`, `.5`, `1E3`, `2.`) to its
 * canonical decimal, or `null` when it cannot be held exactly in 34 digits.
 * Literals are never rounded.
 */
export function decimalFromNumberText(text: string): string | null {
  const match = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,5}))?$/.exec(text);
  if (match === null) return null;
  const integer = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (integer === "" && fraction === "") return null;
  let coefficient = BigInt(`${integer}${fraction}` || "0");
  let scale = fraction.length - Number(match[3] ?? "0");
  if (scale < 0) {
    if (digitCount(coefficient) - scale > DECIMAL_SIGNIFICANT_DIGIT_LIMIT) return null;
    coefficient *= pow10(-scale);
    scale = 0;
  }
  while (scale > 0 && coefficient % TEN === 0n) {
    coefficient /= TEN;
    scale -= 1;
  }
  if (digitCount(coefficient) > DECIMAL_SIGNIFICANT_DIGIT_LIMIT) return null;
  return formatDecimal({ coefficient, scale });
}

const align = (left: DecimalV1, right: DecimalV1): readonly [bigint, bigint, number] => {
  const scale = Math.max(left.scale, right.scale);
  return [left.coefficient * pow10(scale - left.scale), right.coefficient * pow10(scale - right.scale), scale];
};

export function compareDecimals(left: DecimalV1, right: DecimalV1): number {
  const [a, b] = align(left, right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDecimals(left: DecimalV1, right: DecimalV1): DecimalV1 | null {
  const [a, b, scale] = align(left, right);
  return normalizeDecimal({ coefficient: a + b, scale });
}

export function negateDecimal(value: DecimalV1): DecimalV1 {
  return { coefficient: -value.coefficient, scale: value.scale };
}

export function subtractDecimals(left: DecimalV1, right: DecimalV1): DecimalV1 | null {
  return addDecimals(left, negateDecimal(right));
}

export function multiplyDecimals(left: DecimalV1, right: DecimalV1): DecimalV1 | null {
  return normalizeDecimal({
    coefficient: left.coefficient * right.coefficient,
    scale: left.scale + right.scale,
  });
}

const stripTrailingZeros = (value: DecimalV1): DecimalV1 => {
  let { coefficient, scale } = value;
  while (scale > 0 && coefficient % TEN === 0n) {
    coefficient /= TEN;
    scale -= 1;
  }
  return { coefficient, scale };
};

/** `null` for a zero divisor as well as for overflow; the caller tells them apart. */
export function divideDecimals(left: DecimalV1, right: DecimalV1): DecimalV1 | null {
  if (right.coefficient === 0n) return null;
  const shift = Math.max(0, GUARD_DIGITS + digitCount(right.coefficient) - digitCount(left.coefficient));
  let numerator = left.coefficient * pow10(shift);
  let denominator = right.coefficient;
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  let coefficient = numerator / denominator;
  let scale = left.scale + shift - right.scale;
  if (numerator % denominator !== 0n) {
    // A sticky digit: an inexact quotient can never look like an exact tie.
    coefficient = coefficient * TEN + (numerator < 0n ? -1n : 1n);
    scale += 1;
  }
  if (scale < 0) {
    coefficient *= pow10(-scale);
    scale = 0;
  }
  const normalized = normalizeDecimal({ coefficient, scale });
  return normalized === null ? null : stripTrailingZeros(normalized);
}

/** Rounds to `places` digits after the point (negative: to tens, hundreds…). */
export function roundDecimal(value: DecimalV1, places: number, mode: RoundingModeV1): DecimalV1 | null {
  if (places >= value.scale) return value;
  const dropped = value.scale - places;
  const coefficient = divideRounded(value.coefficient, pow10(dropped), mode);
  return places >= 0
    ? normalizeDecimal({ coefficient, scale: places })
    : normalizeDecimal({ coefficient: coefficient * pow10(-places), scale: 0 });
}

export function isIntegral(value: DecimalV1): boolean {
  return value.coefficient % pow10(value.scale) === 0n;
}

/** The integer part, toward zero. */
export function integerPart(value: DecimalV1): bigint {
  return value.coefficient / pow10(value.scale);
}

export function decimalFromBigInt(value: bigint): DecimalV1 | null {
  return normalizeDecimal({ coefficient: value, scale: 0 });
}

/** A square root correct to 34 significant digits (half-even), or `null` for a negative. */
export function squareRootDecimal(value: DecimalV1): DecimalV1 | null {
  if (value.coefficient < 0n) return null;
  if (value.coefficient === 0n) return DECIMAL_ZERO;
  // Scale so the radicand has an even scale and at least 2 × guard digits.
  let extra = Math.max(0, 2 * GUARD_DIGITS - digitCount(value.coefficient));
  if ((value.scale + extra) % 2 !== 0) extra += 1;
  const radicand = value.coefficient * pow10(extra);
  let root = BigInt(Math.floor(Math.sqrt(Number(radicand))));
  // Newton's method on integers; the float seed only picks the start.
  for (;;) {
    const next = (root + radicand / root) / 2n;
    if (next >= root && next - root <= 1n) break;
    root = next;
  }
  while (root * root > radicand) root -= 1n;
  while ((root + 1n) * (root + 1n) <= radicand) root += 1n;
  const isExact = root * root === radicand;
  const scale = (value.scale + extra) / 2;
  const coefficient = isExact ? root : root * TEN + 1n;
  const normalized = normalizeDecimal({ coefficient, scale: isExact ? scale : scale + 1 });
  return normalized === null ? null : stripTrailingZeros(normalized);
}
