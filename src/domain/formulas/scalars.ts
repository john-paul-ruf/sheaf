/**
 * The evaluator's working values and their spreadsheet coercions (M03).
 *
 * A number is an exact {@link DecimalV1}; a date stays a date (an epoch day)
 * until arithmetic needs its number; text is compared case-insensitively on
 * NFC code points; an enum carries its current label so it compares and
 * concatenates as the text a person sees. Nothing here throws: a coercion that
 * cannot succeed returns the error value the spreadsheet would.
 */

import type { OptionId, RecordId } from "../model/ids.js";
import { MAX_EPOCH_DAY, MIN_EPOCH_DAY } from "../model/values.js";
import { isoDateOf, epochDayOfIsoDate } from "./calendar.js";
import {
  compareDecimals,
  decimalFromNumberText,
  divideDecimals,
  formatDecimal,
  parseDecimal,
  roundDecimal,
  type DecimalV1,
} from "./decimal.js";
import type { FormulaErrorCodeV1 } from "./ir.js";

export type ScalarV1 =
  | { readonly t: "num"; readonly d: DecimalV1 }
  | { readonly t: "date"; readonly day: number }
  | { readonly t: "text"; readonly s: string }
  | { readonly t: "bool"; readonly b: boolean }
  | { readonly t: "empty" }
  | { readonly t: "err"; readonly code: FormulaErrorCodeV1 }
  | { readonly t: "enum"; readonly optionId: OptionId; readonly label: string | null }
  | { readonly t: "ref"; readonly recordId: RecordId };

export const EMPTY: ScalarV1 = Object.freeze({ t: "empty" });
export const err = (code: FormulaErrorCodeV1): ScalarV1 => ({ t: "err", code });
export const num = (d: DecimalV1): ScalarV1 => ({ t: "num", d });
export const text = (s: string): ScalarV1 => ({ t: "text", s });
export const bool = (b: boolean): ScalarV1 => ({ t: "bool", b });

/** A decimal result, or `#NUM!` when it overflowed the v1 domain. */
export const numOrOverflow = (d: DecimalV1 | null): ScalarV1 => (d === null ? err("#NUM!") : num(d));

export type Coerced<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ScalarV1 };

const ok = <T>(value: T): Coerced<T> => ({ ok: true, value });
const fail = (error: ScalarV1): Coerced<never> => ({ ok: false, error });

const MS_PER_DAY: DecimalV1 = { coefficient: 86_400_000n, scale: 0 };

/**
 * Text a person would type as a number: optional sign and `$`, thousands
 * commas in groups of three, a fraction, an exponent, a trailing `%`.
 */
export function parseNumberText(raw: string): DecimalV1 | null {
  const match = /^\s*([+-]?)\s*\$?\s*((?:\d{1,3}(?:,\d{3})+|\d*)(?:\.\d*)?(?:[eE][+-]?\d{1,5})?)\s*(%?)\s*$/.exec(raw);
  if (match === null) return null;
  const canonical = decimalFromNumberText((match[2] ?? "").replace(/,/g, ""));
  if (canonical === null) return null;
  let value = parseDecimal(canonical);
  if (match[1] === "-") value = { coefficient: -value.coefficient, scale: value.scale };
  if (match[3] === "%") value = divideDecimals(value, { coefficient: 100n, scale: 0 }) ?? value;
  return value;
}

export function toNumber(value: ScalarV1): Coerced<DecimalV1> {
  switch (value.t) {
    case "num":
      return ok(value.d);
    case "date":
      return ok({ coefficient: BigInt(value.day), scale: 0 });
    case "bool":
      return ok({ coefficient: value.b ? 1n : 0n, scale: 0 });
    case "empty":
      return ok({ coefficient: 0n, scale: 0 });
    case "text": {
      const parsed = parseNumberText(value.s);
      return parsed === null ? fail(err("#VALUE!")) : ok(parsed);
    }
    case "err":
      return fail(value);
    case "enum":
    case "ref":
      return fail(err("#VALUE!"));
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

/** A whole number within ±2³¹, truncated toward zero. */
export function toInteger(value: ScalarV1): Coerced<number> {
  const coerced = toNumber(value);
  if (!coerced.ok) return coerced;
  const whole = coerced.value.coefficient / 10n ** BigInt(coerced.value.scale);
  return whole > 2_147_483_647n || whole < -2_147_483_648n ? fail(err("#NUM!")) : ok(Number(whole));
}

/** An epoch day: a date, a number of days (floored), or ISO `YYYY-MM-DD` text. */
export function toEpochDay(value: ScalarV1): Coerced<number> {
  if (value.t === "date") return ok(value.day);
  if (value.t === "text") {
    const day = epochDayOfIsoDate(value.s.trim());
    if (day !== null) return ok(day);
  }
  const coerced = toNumber(value);
  if (!coerced.ok) return coerced;
  const floored = roundDecimal(coerced.value, 0, "floor");
  const whole = floored === null ? null : floored.coefficient / 10n ** BigInt(floored.scale);
  return whole === null || whole > BigInt(MAX_EPOCH_DAY) || whole < BigInt(MIN_EPOCH_DAY) ? fail(err("#NUM!")) : ok(Number(whole));
}

/** A date result, or `#NUM!` outside the representable range. */
export const dateOrOverflow = (day: number): ScalarV1 =>
  Number.isInteger(day) && day >= MIN_EPOCH_DAY && day <= MAX_EPOCH_DAY ? { t: "date", day } : err("#NUM!");

/** How a number reads as text: exact, without trailing fraction zeros. */
export function generalNumberText(value: DecimalV1): string {
  let { coefficient, scale } = value;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return formatDecimal({ coefficient, scale });
}

export function toText(value: ScalarV1): Coerced<string> {
  switch (value.t) {
    case "text":
      return ok(value.s);
    case "num":
      return ok(generalNumberText(value.d));
    case "date":
      return ok(isoDateOf(value.day));
    case "bool":
      return ok(value.b ? "TRUE" : "FALSE");
    case "empty":
      return ok("");
    case "enum":
      return value.label === null ? fail(err("#N/A")) : ok(value.label);
    case "err":
      return fail(value);
    case "ref":
      return fail(err("#VALUE!"));
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

export function toBoolean(value: ScalarV1): Coerced<boolean> {
  switch (value.t) {
    case "bool":
      return ok(value.b);
    case "num":
      return ok(value.d.coefficient !== 0n);
    case "date":
      return ok(value.day !== 0);
    case "empty":
      return ok(false);
    case "text": {
      const upper = value.s.trim().toUpperCase();
      return upper === "TRUE" ? ok(true) : upper === "FALSE" ? ok(false) : fail(err("#VALUE!"));
    }
    case "err":
      return fail(value);
    case "enum":
    case "ref":
      return fail(err("#VALUE!"));
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

/** Case-folded NFC, the key every text comparison and search uses. */
export const foldText = (value: string): string => value.normalize("NFC").toUpperCase();

const compareText = (left: string, right: string): number => {
  const a = foldText(left);
  const b = foldText(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

/**
 * The spreadsheet's typed order: numbers (and dates) < text < booleans; an
 * empty value compares as the other side's zero, `""` or `FALSE`. Returns an
 * error value for an error operand or an incomparable reference.
 */
export function compareScalars(left: ScalarV1, right: ScalarV1): number | ScalarV1 {
  if (left.t === "err") return left;
  if (right.t === "err") return right;
  if (left.t === "ref" || right.t === "ref") {
    if (left.t === "ref" && right.t === "ref") {
      return left.recordId.every((byte, index) => byte === right.recordId[index]) ? 0 : 1;
    }
    return err("#VALUE!");
  }
  const rank = (value: ScalarV1): number =>
    value.t === "num" || value.t === "date" ? 0 : value.t === "text" || value.t === "enum" ? 1 : value.t === "bool" ? 2 : -1;
  const asOther = (value: ScalarV1, other: ScalarV1): ScalarV1 => {
    if (value.t !== "empty") return value;
    const otherRank = rank(other);
    return otherRank === 1 ? text("") : otherRank === 2 ? bool(false) : num({ coefficient: 0n, scale: 0 });
  };
  const a = asOther(left, right);
  const b = asOther(right, left);
  const rankA = rank(a);
  const rankB = rank(b);
  if (rankA !== rankB) return rankA - rankB;
  if (rankA === -1) return 0;
  if (rankA === 0) {
    const x = toNumber(a);
    const y = toNumber(b);
    return x.ok && y.ok ? compareDecimals(x.value, y.value) : err("#VALUE!");
  }
  if (rankA === 2) return Number((a as { b: boolean }).b) - Number((b as { b: boolean }).b);
  const x = toText(a);
  const y = toText(b);
  if (!x.ok) return x.error;
  if (!y.ok) return y.error;
  return compareText(x.value, y.value);
}

/** `NOW()` as a number of days since the epoch, fraction included. */
export function epochMsToDays(epochMs: number): DecimalV1 {
  return divideDecimals({ coefficient: BigInt(Math.trunc(epochMs)), scale: 0 }, MS_PER_DAY) ?? { coefficient: 0n, scale: 0 };
}

/**
 * Whether `subject` matches a spreadsheet wildcard pattern — `*` any run,
 * `?` any one character, `~` escaping either — over code points, case
 * folded. Linear-time backtracking over the last `*`; no regular expression
 * is ever built from data.
 */
export function wildcardMatches(pattern: string, subject: string, isPrefixOnly = false): boolean {
  const tokens: ({ readonly kind: "star" } | { readonly kind: "one" } | { readonly kind: "char"; readonly char: string })[] = [];
  const characters = [...foldText(pattern)];
  for (let index = 0; index < characters.length; index += 1) {
    const char = characters[index] as string;
    if (char === "~" && index + 1 < characters.length && /[*?~]/.test(characters[index + 1] as string)) {
      tokens.push({ kind: "char", char: characters[index + 1] as string });
      index += 1;
    } else if (char === "*") tokens.push({ kind: "star" });
    else if (char === "?") tokens.push({ kind: "one" });
    else tokens.push({ kind: "char", char });
  }
  if (isPrefixOnly) tokens.push({ kind: "star" });
  const chars = [...foldText(subject)];
  let t = 0;
  let s = 0;
  let starAt = -1;
  let resumeAt = 0;
  while (s < chars.length) {
    const token = tokens[t];
    if (token !== undefined && token.kind !== "star" && (token.kind === "one" || token.char === chars[s])) {
      t += 1;
      s += 1;
    } else if (token?.kind === "star") {
      starAt = t;
      resumeAt = s;
      t += 1;
    } else if (starAt >= 0) {
      t = starAt + 1;
      resumeAt += 1;
      s = resumeAt;
    } else {
      return false;
    }
  }
  while (tokens[t]?.kind === "star") t += 1;
  return t === tokens.length;
}

/**
 * Unwinds an evaluation that cannot be done exactly or at all here (a
 * lookup call, a nondeterministic call outside its one frozen evaluation, a
 * format code outside the bounded set): the result is `unsupported`, never an
 * approximation.
 */
export class UnsupportedEvaluation extends Error {
  constructor() {
    super("unsupported evaluation");
  }
}
