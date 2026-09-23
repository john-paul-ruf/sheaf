/**
 * The catalog functions (M03; D49), one implementation each, closed over the
 * evaluator's call context. Arguments arrive as IR nodes so `IF`, `IFS`,
 * `IFERROR` and `IFNA` evaluate only the branch they need.
 *
 * Reference semantics follow the spreadsheet: an aggregate reads numbers from
 * a referenced field, column or formula and skips text there, but coerces a
 * value written directly into the call (`SUM("5")` is 5).
 */

import type { DomainEntropy } from "../model/ids.js";
import { addMonths, civilOf, dayOfWeek, daysInMonth, epochDayOf } from "./calendar.js";
import type { CatalogFunctionNameV1 } from "./catalog.js";
import {
  addDecimals,
  compareDecimals,
  DECIMAL_ZERO,
  divideDecimals,
  formatDecimal,
  integerPart,
  isIntegral,
  moduloDecimals,
  multipleOf,
  multiplyDecimals,
  negateDecimal,
  normalizeDecimal,
  powerDecimal,
  roundDecimal,
  squareRootDecimal,
  type DecimalV1,
  type RoundingModeV1,
} from "./decimal.js";
import type { FormulaIRV1 } from "./ir.js";
import {
  bool,
  compareScalars,
  dateOrOverflow,
  epochMsToDays,
  err,
  num,
  numOrOverflow,
  parseNumberText,
  text,
  toBoolean,
  toEpochDay,
  toInteger,
  toNumber,
  toText,
  UnsupportedEvaluation,
  wildcardMatches,
  type Coerced,
  type ScalarV1,
} from "./scalars.js";

export interface CallContextV1 {
  /** One value; a whole column here is `#VALUE!`. An omitted argument is empty. */
  scalar(node: FormulaIRV1 | null): ScalarV1;
  /** Every value a node denotes: a column's rows, or one scalar. */
  items(node: FormulaIRV1 | null): readonly ScalarV1[];
  /** True for a field, column, related field or formula — a reference, not a written value. */
  isReference(node: FormulaIRV1 | null): boolean;
  readonly clock: () => { readonly epochDay: number; readonly epochMs: number };
  /** Present only inside the one frozen evaluation of a nondeterministic formula. */
  readonly entropy: DomainEntropy | null;
}

type Builtin = (args: readonly (FormulaIRV1 | null)[], context: CallContextV1) => ScalarV1;

const ZERO = DECIMAL_ZERO;
const ONE_HUNDRED: DecimalV1 = { coefficient: 100n, scale: 0 };

/** Evaluates `nodes` to numbers, or the first coercion error. */
const numbers = (context: CallContextV1, nodes: readonly (FormulaIRV1 | null)[]): Coerced<readonly DecimalV1[]> => {
  const values: DecimalV1[] = [];
  for (const node of nodes) {
    const coerced = toNumber(context.scalar(node));
    if (!coerced.ok) return coerced;
    values.push(coerced.value);
  }
  return { ok: true, value: values };
};

const withNumbers =
  (compute: (values: readonly DecimalV1[]) => ScalarV1): Builtin =>
  (args, context) => {
    const coerced = numbers(context, args);
    return coerced.ok ? compute(coerced.value) : coerced.error;
  };

const withText =
  (compute: (value: string, context: CallContextV1, args: readonly (FormulaIRV1 | null)[]) => ScalarV1): Builtin =>
  (args, context) => {
    const coerced = toText(context.scalar(args[0] ?? null));
    return coerced.ok ? compute(coerced.value, context, args) : coerced.error;
  };

const withDay =
  (compute: (day: number, context: CallContextV1, args: readonly (FormulaIRV1 | null)[]) => ScalarV1): Builtin =>
  (args, context) => {
    const coerced = toEpochDay(context.scalar(args[0] ?? null));
    return coerced.ok ? compute(coerced.value, context, args) : coerced.error;
  };

/** Numbers (and dates, as days) an aggregate reads, with reference semantics. */
function numericItems(
  context: CallContextV1,
  args: readonly (FormulaIRV1 | null)[],
): Coerced<{ readonly values: readonly DecimalV1[]; readonly allDates: boolean }> {
  const values: DecimalV1[] = [];
  let allDates = true;
  for (const node of args) {
    if (context.isReference(node)) {
      for (const item of context.items(node)) {
        if (item.t === "err") return { ok: false, error: item };
        if (item.t === "num" || item.t === "date") {
          allDates &&= item.t === "date";
          values.push(item.t === "num" ? item.d : { coefficient: BigInt(item.day), scale: 0 });
        }
      }
    } else {
      const item = context.scalar(node);
      const coerced = toNumber(item);
      if (!coerced.ok) return coerced;
      allDates &&= item.t === "date";
      values.push(coerced.value);
    }
  }
  return { ok: true, value: { values, allDates } };
}

const sum = (values: readonly DecimalV1[]): DecimalV1 | null =>
  values.reduce<DecimalV1 | null>((total, value) => (total === null ? null : addDecimals(total, value)), ZERO);

const extreme =
  (sign: 1 | -1): Builtin =>
  (args, context) => {
    const read = numericItems(context, args);
    if (!read.ok) return read.error;
    const { values, allDates } = read.value;
    if (values.length === 0) return num(ZERO);
    const best = values.reduce((left, right) => (compareDecimals(right, left) * sign > 0 ? right : left));
    return allDates ? dateOrOverflow(Number(integerPart(best))) : num(best);
  };

/** Logical values an `AND`/`OR`/`XOR` reads; text in a reference is skipped. */
function logicalItems(context: CallContextV1, args: readonly (FormulaIRV1 | null)[]): Coerced<readonly boolean[]> {
  const values: boolean[] = [];
  for (const node of args) {
    const isReference = context.isReference(node);
    for (const item of isReference ? context.items(node) : [context.scalar(node)]) {
      if (item.t === "err") return { ok: false, error: item };
      if (isReference && (item.t === "text" || item.t === "empty" || item.t === "enum")) continue;
      const coerced = toBoolean(item);
      if (!coerced.ok) return coerced;
      values.push(coerced.value);
    }
  }
  return values.length === 0 ? { ok: false, error: err("#VALUE!") } : { ok: true, value: values };
}

// ------------------------------------------------------------------ criteria --

type Matcher = (item: ScalarV1) => boolean;

/** A `COUNTIF`-style criterion: a value, or text such as `">=5"`, `"<>Paid"`, `"Jo*"`. */
function criterionMatcher(criterion: ScalarV1): Matcher | ScalarV1 {
  if (criterion.t === "err") return criterion;
  if (criterion.t === "empty") return (item) => item.t === "empty";
  if (criterion.t !== "text") {
    const isNumeric = criterion.t === "num" || criterion.t === "date";
    return (item) => {
      if (item.t === "empty" || item.t === "err") return false;
      const parsed = isNumeric && item.t === "text" ? parseNumberText(item.s) : null;
      return compareScalars(parsed === null ? item : num(parsed), criterion) === 0;
    };
  }
  const match = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(criterion.s) as RegExpExecArray;
  const operator = match[1] ?? "";
  const operand = match[2] ?? "";
  const isEquality = operator === "" || operator === "=";
  if (operand === "") {
    if (operator === "<>") return (item) => item.t !== "empty" && !(item.t === "text" && item.s === "");
    if (isEquality) return (item) => item.t === "empty" || (item.t === "text" && item.s === "");
  }
  const number = parseNumberText(operand);
  const upper = operand.trim().toUpperCase();
  const target: ScalarV1 =
    number !== null ? num(number) : upper === "TRUE" || upper === "FALSE" ? bool(upper === "TRUE") : text(operand);
  const holds = (compared: number): boolean => {
    switch (operator) {
      case "":
      case "=":
        return compared === 0;
      case "<>":
        return compared !== 0;
      case "<":
        return compared < 0;
      case "<=":
        return compared <= 0;
      case ">":
        return compared > 0;
      default:
        return compared >= 0;
    }
  };
  return (item) => {
    if (item.t === "err") return false;
    if (target.t === "text" && (isEquality || operator === "<>")) {
      const subject = toText(item);
      const isMatch = subject.ok && item.t !== "num" && item.t !== "date" && wildcardMatches(operand, subject.value);
      return isEquality ? isMatch : !isMatch;
    }
    const parsed = target.t === "num" && item.t === "text" ? parseNumberText(item.s) : null;
    const subject = parsed === null ? item : num(parsed);
    const sameKind =
      target.t === "num" ? subject.t === "num" || subject.t === "date" : target.t === "bool" ? subject.t === "bool" : subject.t === "text" || subject.t === "enum";
    if (!sameKind) return operator === "<>";
    const compared = compareScalars(subject, target);
    return typeof compared === "number" && holds(compared);
  };
}

/** The indices every `(range, criterion)` pair accepts, or an error. */
function matchingIndices(context: CallContextV1, pairs: readonly (FormulaIRV1 | null)[]): Coerced<{ readonly indices: readonly number[]; readonly length: number }> {
  let accepted: number[] | null = null;
  let length = -1;
  for (let index = 0; index + 1 < pairs.length; index += 2) {
    const items = context.items(pairs[index] ?? null);
    const matcher = criterionMatcher(context.scalar(pairs[index + 1] ?? null));
    if (typeof matcher !== "function") return { ok: false, error: matcher };
    if (length >= 0 && items.length !== length) return { ok: false, error: err("#VALUE!") };
    length = items.length;
    const here = items.flatMap((item, position) => (matcher(item) ? [position] : []));
    accepted = accepted === null ? here : accepted.filter((position) => here.includes(position));
  }
  return { ok: true, value: { indices: accepted ?? [], length: Math.max(length, 0) } };
}

/** The numbers at `indices` of a range (non-numbers skipped), for `SUMIF`/`AVERAGEIF`. */
function numbersAt(items: readonly ScalarV1[], indices: readonly number[]): Coerced<readonly DecimalV1[]> {
  const values: DecimalV1[] = [];
  for (const index of indices) {
    const item = items[index];
    if (item?.t === "err") return { ok: false, error: item };
    if (item?.t === "num") values.push(item.d);
    if (item?.t === "date") values.push({ coefficient: BigInt(item.day), scale: 0 });
  }
  return { ok: true, value: values };
}

const conditionalSum =
  (isAverage: boolean): Builtin =>
  (args, context) => {
    const [range, criterion, target] = args;
    const matched = matchingIndices(context, [range ?? null, criterion ?? null]);
    if (!matched.ok) return matched.error;
    const values = numbersAt(context.items(target ?? range ?? null), matched.value.indices);
    if (!values.ok) return values.error;
    if (!isAverage) return numOrOverflow(sum(values.value));
    if (values.value.length === 0) return err("#DIV/0!");
    const total = sum(values.value);
    return numOrOverflow(total === null ? null : divideDecimals(total, { coefficient: BigInt(values.value.length), scale: 0 }));
  };

// ------------------------------------------------------------------- rounding --

const rounding =
  (mode: RoundingModeV1): Builtin =>
  (args, context) => {
    const value = toNumber(context.scalar(args[0] ?? null));
    if (!value.ok) return value.error;
    const places = toInteger(context.scalar(args[1] ?? null));
    if (!places.ok) return places.error;
    return numOrOverflow(roundDecimal(value.value, Math.max(-40, Math.min(places.value, 10_000)), mode));
  };

const toMultiple =
  (mode: "floor" | "ceiling"): Builtin =>
  withNumbers(([value = ZERO, significance = ZERO]) => {
    if (significance.coefficient === 0n) return mode === "ceiling" ? num(ZERO) : err("#DIV/0!");
    if (value.coefficient > 0n && significance.coefficient < 0n) return err("#NUM!");
    return numOrOverflow(multipleOf(value, significance, mode));
  });

/** `base ^ exponent`, exact for whole exponents and square roots; any other fractional power is unsupported. */
export function power(base: DecimalV1, exponent: DecimalV1): ScalarV1 {
  if (base.coefficient === 0n && exponent.coefficient === 0n) return err("#NUM!");
  if (base.coefficient === 0n && exponent.coefficient < 0n) return err("#DIV/0!");
  if (isIntegral(exponent)) {
    const whole = integerPart(exponent);
    if (whole > 100_000n || whole < -100_000n) {
      // Far past the 34-digit domain unless |base| is exactly 1.
      const one: DecimalV1 = { coefficient: 1n, scale: 0 };
      const magnitude = compareDecimals(base.coefficient < 0n ? negateDecimal(base) : base, one);
      if (magnitude === 0) return num(base.coefficient < 0n && whole % 2n !== 0n ? negateDecimal(one) : one);
      return magnitude > 0 === whole > 0n ? err("#NUM!") : num(ZERO);
    }
    return numOrOverflow(powerDecimal(base, whole));
  }
  if (base.coefficient < 0n) return err("#NUM!");
  // A square root is exact to 34 digits; any other fractional power would be an approximation.
  if (compareDecimals(exponent, { coefficient: 5n, scale: 1 }) === 0) return numOrOverflow(squareRootDecimal(base));
  throw new UnsupportedEvaluation();
}

// ---------------------------------------------------------------------- dates --

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function dateOf(yearValue: number, monthValue: number, dayValue: number): ScalarV1 {
  const year = yearValue >= 0 && yearValue < 1900 ? yearValue + 1900 : yearValue;
  if (year < 0 || year > 9999 || Math.abs(monthValue) > 1_000_000 || Math.abs(dayValue) > 1_000_000_000) return err("#NUM!");
  const target = addMonths(year, 1, monthValue - 1);
  return dateOrOverflow(epochDayOf(target.year, target.month, 1) + dayValue - 1);
}

function shiftMonths(day: number, months: number, isEndOfMonth: boolean): ScalarV1 {
  if (Math.abs(months) > 1_000_000) return err("#NUM!");
  const start = civilOf(day);
  const target = addMonths(start.year, start.month, months);
  const length = daysInMonth(target.year, target.month);
  return dateOrOverflow(epochDayOf(target.year, target.month, isEndOfMonth ? length : Math.min(start.day, length)));
}

function dateDifference(startDay: number, endDay: number, unit: string): ScalarV1 {
  if (startDay > endDay) return err("#NUM!");
  const start = civilOf(startDay);
  const end = civilOf(endDay);
  const months = (end.year - start.year) * 12 + (end.month - start.month) - (end.day < start.day ? 1 : 0);
  const whole = (value: number): ScalarV1 => num({ coefficient: BigInt(value), scale: 0 });
  switch (unit.toUpperCase()) {
    case "D":
      return whole(endDay - startDay);
    case "M":
      return whole(months);
    case "Y":
      return whole(Math.floor(months / 12));
    case "YM":
      return whole(months % 12);
    case "MD": {
      if (end.day >= start.day) return whole(end.day - start.day);
      const previous = addMonths(end.year, end.month, -1);
      return whole(end.day - start.day + daysInMonth(previous.year, previous.month));
    }
    case "YD": {
      const anniversary = (year: number): number =>
        epochDayOf(year, start.month, Math.min(start.day, daysInMonth(year, start.month)));
      const candidate = anniversary(end.year);
      return whole(endDay - (candidate > endDay ? anniversary(end.year - 1) : candidate));
    }
    default:
      return err("#NUM!");
  }
}

function weekday(day: number, type: number): ScalarV1 {
  const sundayBased = dayOfWeek(day);
  const whole = (value: number): ScalarV1 => num({ coefficient: BigInt(value), scale: 0 });
  if (type === 1) return whole(sundayBased + 1);
  if (type === 2) return whole(((sundayBased + 6) % 7) + 1);
  if (type === 3) return whole((sundayBased + 6) % 7);
  if (type >= 11 && type <= 17) return whole(((sundayBased - ((type - 10) % 7) + 7) % 7) + 1);
  return err("#NUM!");
}

// ----------------------------------------------------------------------- text --

const codePoints = (value: string): string[] => [...value];

/** `TEXT` over the bounded format codes (D41 subset); any other code is unsupported. */
function formatWithCode(value: ScalarV1, code: string): ScalarV1 {
  if (/^general$/i.test(code)) {
    const coerced = toText(value);
    return coerced.ok ? text(coerced.value) : coerced.error;
  }
  const numeric = /^([$€£]?)(#,##0|0)(?:\.(0+))?(%?)$/.exec(code);
  if (numeric !== null) {
    const coerced = toNumber(value);
    if (!coerced.ok) return coerced.error;
    const scaled = numeric[4] === "%" ? multiplyDecimals(coerced.value, ONE_HUNDRED) : coerced.value;
    const places = numeric[3]?.length ?? 0;
    const rounded = scaled === null ? null : roundDecimal(scaled, places, "half-away");
    if (rounded === null) return err("#NUM!");
    const padded = normalizeDecimal({ coefficient: rounded.coefficient * 10n ** BigInt(places - Math.min(rounded.scale, places)), scale: places });
    if (padded === null) return err("#NUM!");
    const spelled = formatDecimal(padded);
    const isNegative = spelled.startsWith("-");
    const [integer = "0", fraction] = (isNegative ? spelled.slice(1) : spelled).split(".");
    const grouped = numeric[2] === "#,##0" ? integer.replace(/\B(?=(\d{3})+$)/g, ",") : integer;
    return text(`${isNegative ? "-" : ""}${numeric[1] ?? ""}${grouped}${fraction === undefined ? "" : `.${fraction}`}${numeric[4] ?? ""}`);
  }
  const tokens = code.match(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|[-/ .,]/gi);
  if (tokens === null || tokens.join("") !== code) throw new UnsupportedEvaluation();
  const day = toEpochDay(value);
  if (!day.ok) return day.error;
  const civil = civilOf(day.value);
  const two = (part: number): string => String(part).padStart(2, "0");
  const spelled = tokens.map((token) => {
    switch (token.toLowerCase()) {
      case "yyyy":
        return String(civil.year).padStart(4, "0");
      case "yy":
        return two(((civil.year % 100) + 100) % 100);
      case "mmmm":
        return MONTH_NAMES[civil.month - 1] ?? "";
      case "mmm":
        return (MONTH_NAMES[civil.month - 1] ?? "").slice(0, 3);
      case "mm":
        return two(civil.month);
      case "m":
        return String(civil.month);
      case "dddd":
        return DAY_NAMES[dayOfWeek(day.value)] ?? "";
      case "ddd":
        return (DAY_NAMES[dayOfWeek(day.value)] ?? "").slice(0, 3);
      case "dd":
        return two(civil.day);
      case "d":
        return String(civil.day);
      default:
        return token;
    }
  });
  return text(spelled.join(""));
}

/** 1-based code-point position of `needle` in `haystack` from `start`, or 0. */
function findPosition(needle: string, haystack: string, start: number, isSearch: boolean): number {
  const within = codePoints(haystack);
  if (!isSearch) {
    const wanted = codePoints(needle);
    for (let index = start - 1; index + wanted.length <= within.length; index += 1) {
      if (wanted.every((char, offset) => within[index + offset] === char)) return index + 1;
    }
    return 0;
  }
  for (let index = start - 1; index <= within.length; index += 1) {
    if (wildcardMatches(needle, within.slice(index).join(""), true)) return index + 1;
  }
  return 0;
}

const locate =
  (isSearch: boolean): Builtin =>
  (args, context) => {
    const needle = toText(context.scalar(args[0] ?? null));
    if (!needle.ok) return needle.error;
    const haystack = toText(context.scalar(args[1] ?? null));
    if (!haystack.ok) return haystack.error;
    const start = args[2] === undefined || args[2] === null ? { ok: true as const, value: 1 } : toInteger(context.scalar(args[2]));
    if (!start.ok) return start.error;
    if (start.value < 1 || start.value > codePoints(haystack.value).length + 1) return err("#VALUE!");
    if (needle.value === "") return num({ coefficient: BigInt(start.value), scale: 0 });
    const position = findPosition(needle.value, haystack.value, start.value, isSearch);
    return position === 0 ? err("#VALUE!") : num({ coefficient: BigInt(position), scale: 0 });
  };

const slice =
  (from: "left" | "right"): Builtin =>
  withText((value, context, args) => {
    const count = args[1] === undefined || args[1] === null ? { ok: true as const, value: 1 } : toInteger(context.scalar(args[1]));
    if (!count.ok) return count.error;
    if (count.value < 0) return err("#VALUE!");
    const chars = codePoints(value);
    return text((from === "left" ? chars.slice(0, count.value) : chars.slice(Math.max(0, chars.length - count.value))).join(""));
  });

/** Text of every item a node denotes, for `CONCAT`/`TEXTJOIN`. */
function textItems(context: CallContextV1, nodes: readonly (FormulaIRV1 | null)[]): Coerced<readonly string[]> {
  const values: string[] = [];
  for (const node of nodes) {
    for (const item of context.items(node)) {
      const coerced = toText(item);
      if (!coerced.ok) return coerced;
      values.push(coerced.value);
    }
  }
  return { ok: true, value: values };
}

// --------------------------------------------------------------------- random --

/** A uniform bigint in `[0, bound)` by rejection sampling; `bound` > 0. */
function uniformBelow(entropy: DomainEntropy, bound: bigint): bigint {
  const byteLength = Math.ceil(bound.toString(16).length / 2) + 1;
  const span = 256n ** BigInt(byteLength);
  const limit = span - (span % bound);
  for (;;) {
    const bytes = entropy.randomBytes(byteLength);
    const drawn = bytes.reduce((value, byte) => value * 256n + BigInt(byte), 0n);
    if (drawn < limit) return drawn % bound;
  }
}

const requireEntropy = (context: CallContextV1): DomainEntropy => {
  if (context.entropy === null) throw new UnsupportedEvaluation();
  return context.entropy;
};

// -------------------------------------------------------------------- catalog --

const whole = (value: number): ScalarV1 => num({ coefficient: BigInt(value), scale: 0 });

const BUILTINS: Readonly<Partial<Record<CatalogFunctionNameV1, Builtin>>> = {
  SUM: (args, context) => {
    const read = numericItems(context, args);
    return read.ok ? numOrOverflow(sum(read.value.values)) : read.error;
  },
  AVERAGE: (args, context) => {
    const read = numericItems(context, args);
    if (!read.ok) return read.error;
    if (read.value.values.length === 0) return err("#DIV/0!");
    const total = sum(read.value.values);
    return numOrOverflow(total === null ? null : divideDecimals(total, { coefficient: BigInt(read.value.values.length), scale: 0 }));
  },
  MIN: extreme(-1),
  MAX: extreme(1),
  COUNT: (args, context) =>
    whole(
      args.reduce((count, node) => {
        if (context.isReference(node)) return count + context.items(node).filter((item) => item.t === "num" || item.t === "date").length;
        return count + (toNumber(context.scalar(node)).ok ? 1 : 0);
      }, 0),
    ),
  COUNTA: (args, context) =>
    whole(args.reduce((count, node) => count + context.items(node).filter((item) => item.t !== "empty").length, 0)),
  COUNTBLANK: (args, context) =>
    whole(context.items(args[0] ?? null).filter((item) => item.t === "empty" || (item.t === "text" && item.s === "")).length),
  COUNTIF: (args, context) => {
    const matched = matchingIndices(context, args);
    return matched.ok ? whole(matched.value.indices.length) : matched.error;
  },
  COUNTIFS: (args, context) => {
    if (args.length % 2 !== 0) return err("#VALUE!");
    const matched = matchingIndices(context, args);
    return matched.ok ? whole(matched.value.indices.length) : matched.error;
  },
  SUMIF: conditionalSum(false),
  AVERAGEIF: conditionalSum(true),
  SUMIFS: (args, context) => {
    const [target, ...pairs] = args;
    if (pairs.length % 2 !== 0) return err("#VALUE!");
    const matched = matchingIndices(context, pairs);
    if (!matched.ok) return matched.error;
    const items = context.items(target ?? null);
    if (items.length !== matched.value.length) return err("#VALUE!");
    const values = numbersAt(items, matched.value.indices);
    return values.ok ? numOrOverflow(sum(values.value)) : values.error;
  },
  IF: (args, context) => {
    const condition = toBoolean(context.scalar(args[0] ?? null));
    if (!condition.ok) return condition.error;
    if (condition.value) return context.scalar(args[1] ?? null);
    return args.length < 3 ? bool(false) : context.scalar(args[2] ?? null);
  },
  IFS: (args, context) => {
    if (args.length % 2 !== 0) return err("#VALUE!");
    for (let index = 0; index < args.length; index += 2) {
      const condition = toBoolean(context.scalar(args[index] ?? null));
      if (!condition.ok) return condition.error;
      if (condition.value) return context.scalar(args[index + 1] ?? null);
    }
    return err("#N/A");
  },
  IFERROR: (args, context) => {
    const value = context.scalar(args[0] ?? null);
    return value.t === "err" ? context.scalar(args[1] ?? null) : value;
  },
  IFNA: (args, context) => {
    const value = context.scalar(args[0] ?? null);
    return value.t === "err" && value.code === "#N/A" ? context.scalar(args[1] ?? null) : value;
  },
  AND: (args, context) => {
    const values = logicalItems(context, args);
    return values.ok ? bool(values.value.every(Boolean)) : values.error;
  },
  OR: (args, context) => {
    const values = logicalItems(context, args);
    return values.ok ? bool(values.value.some(Boolean)) : values.error;
  },
  XOR: (args, context) => {
    const values = logicalItems(context, args);
    return values.ok ? bool(values.value.filter(Boolean).length % 2 === 1) : values.error;
  },
  NOT: (args, context) => {
    const value = toBoolean(context.scalar(args[0] ?? null));
    return value.ok ? bool(!value.value) : value.error;
  },
  ROUND: rounding("half-away"),
  ROUNDUP: rounding("away"),
  ROUNDDOWN: rounding("toward-zero"),
  ABS: withNumbers(([value = ZERO]) => num(value.coefficient < 0n ? negateDecimal(value) : value)),
  INT: withNumbers(([value = ZERO]) => numOrOverflow(roundDecimal(value, 0, "floor"))),
  MOD: withNumbers(([dividend = ZERO, divisor = ZERO]) =>
    divisor.coefficient === 0n ? err("#DIV/0!") : numOrOverflow(moduloDecimals(dividend, divisor)),
  ),
  POWER: withNumbers(([base = ZERO, exponent = ZERO]) => power(base, exponent)),
  SQRT: withNumbers(([value = ZERO]) => (value.coefficient < 0n ? err("#NUM!") : numOrOverflow(squareRootDecimal(value)))),
  CEILING: toMultiple("ceiling"),
  FLOOR: toMultiple("floor"),
  TODAY: (_, context) => dateOrOverflow(context.clock().epochDay),
  NOW: (_, context) => num(epochMsToDays(context.clock().epochMs)),
  DATE: (args, context) => {
    const parts = args.map((node) => toInteger(context.scalar(node)));
    for (const part of parts) if (!part.ok) return part.error;
    const [year = 0, month = 0, day = 0] = parts.map((part) => (part.ok ? part.value : 0));
    return dateOf(year, month, day);
  },
  YEAR: withDay((day) => whole(civilOf(day).year)),
  MONTH: withDay((day) => whole(civilOf(day).month)),
  DAY: withDay((day) => whole(civilOf(day).day)),
  WEEKDAY: withDay((day, context, args) => {
    const type = args[1] === undefined || args[1] === null ? { ok: true as const, value: 1 } : toInteger(context.scalar(args[1]));
    return type.ok ? weekday(day, type.value) : type.error;
  }),
  EDATE: withDay((day, context, args) => {
    const months = toInteger(context.scalar(args[1] ?? null));
    return months.ok ? shiftMonths(day, months.value, false) : months.error;
  }),
  EOMONTH: withDay((day, context, args) => {
    const months = toInteger(context.scalar(args[1] ?? null));
    return months.ok ? shiftMonths(day, months.value, true) : months.error;
  }),
  DATEDIF: withDay((start, context, args) => {
    const end = toEpochDay(context.scalar(args[1] ?? null));
    if (!end.ok) return end.error;
    const unit = toText(context.scalar(args[2] ?? null));
    return unit.ok ? dateDifference(start, end.value, unit.value) : unit.error;
  }),
  DAYS: withDay((end, context, args) => {
    const start = toEpochDay(context.scalar(args[1] ?? null));
    return start.ok ? whole(end - start.value) : start.error;
  }),
  LEN: withText((value) => whole(codePoints(value).length)),
  LEFT: slice("left"),
  RIGHT: slice("right"),
  MID: withText((value, context, args) => {
    const start = toInteger(context.scalar(args[1] ?? null));
    if (!start.ok) return start.error;
    const count = toInteger(context.scalar(args[2] ?? null));
    if (!count.ok) return count.error;
    if (start.value < 1 || count.value < 0) return err("#VALUE!");
    return text(codePoints(value).slice(start.value - 1, start.value - 1 + count.value).join(""));
  }),
  UPPER: withText((value) => text(value.toUpperCase())),
  LOWER: withText((value) => text(value.toLowerCase())),
  PROPER: withText((value) => {
    let isWordStart = true;
    return text(
      codePoints(value)
        .map((char) => {
          const isLetter = /\p{L}/u.test(char);
          const cased = isLetter ? (isWordStart ? char.toUpperCase() : char.toLowerCase()) : char;
          isWordStart = !isLetter;
          return cased;
        })
        .join(""),
    );
  }),
  TRIM: withText((value) => text(value.replace(/^ +| +$/g, "").replace(/ {2,}/g, " "))),
  CONCAT: (args, context) => {
    const values = textItems(context, args);
    return values.ok ? text(values.value.join("")) : values.error;
  },
  CONCATENATE: (args, context) => {
    const values: string[] = [];
    for (const node of args) {
      const coerced = toText(context.scalar(node));
      if (!coerced.ok) return coerced.error;
      values.push(coerced.value);
    }
    return text(values.join(""));
  },
  TEXTJOIN: (args, context) => {
    const [delimiterNode, ignoreNode, ...rest] = args;
    const delimiter = toText(context.scalar(delimiterNode ?? null));
    if (!delimiter.ok) return delimiter.error;
    const ignoreEmpty = toBoolean(context.scalar(ignoreNode ?? null));
    if (!ignoreEmpty.ok) return ignoreEmpty.error;
    const values = textItems(context, rest);
    if (!values.ok) return values.error;
    return text((ignoreEmpty.value ? values.value.filter((value) => value !== "") : values.value).join(delimiter.value));
  },
  SUBSTITUTE: withText((value, context, args) => {
    const from = toText(context.scalar(args[1] ?? null));
    if (!from.ok) return from.error;
    const to = toText(context.scalar(args[2] ?? null));
    if (!to.ok) return to.error;
    if (from.value === "") return text(value);
    const parts = value.split(from.value);
    if (args[3] === undefined || args[3] === null) return text(parts.join(to.value));
    const instance = toInteger(context.scalar(args[3]));
    if (!instance.ok) return instance.error;
    if (instance.value < 1) return err("#VALUE!");
    if (instance.value >= parts.length) return text(value);
    return text(
      `${parts.slice(0, instance.value).join(from.value)}${to.value}${parts.slice(instance.value).join(from.value)}`,
    );
  }),
  FIND: locate(false),
  SEARCH: locate(true),
  VALUE: (args, context) => {
    const value = context.scalar(args[0] ?? null);
    if (value.t === "num") return value;
    if (value.t === "date") return num({ coefficient: BigInt(value.day), scale: 0 });
    const coerced = toText(value);
    if (!coerced.ok) return coerced.error;
    const parsed = parseNumberText(coerced.value);
    return parsed === null ? err("#VALUE!") : num(parsed);
  },
  TEXT: (args, context) => {
    const value = context.scalar(args[0] ?? null);
    if (value.t === "err") return value;
    const code = toText(context.scalar(args[1] ?? null));
    return code.ok ? formatWithCode(value, code.value) : code.error;
  },
  ISBLANK: (args, context) => bool(context.scalar(args[0] ?? null).t === "empty"),
  ISNUMBER: (args, context) => {
    const kind = context.scalar(args[0] ?? null).t;
    return bool(kind === "num" || kind === "date");
  },
  ISTEXT: (args, context) => {
    const kind = context.scalar(args[0] ?? null).t;
    return bool(kind === "text" || kind === "enum");
  },
  ISERROR: (args, context) => bool(context.scalar(args[0] ?? null).t === "err"),
  RAND: (_, context) => {
    const drawn = uniformBelow(requireEntropy(context), 10n ** 15n);
    return numOrOverflow(normalizeDecimal({ coefficient: drawn, scale: 15 }));
  },
  RANDBETWEEN: (args, context) => {
    const entropy = requireEntropy(context);
    const bounds = numbers(context, args);
    if (!bounds.ok) return bounds.error;
    const [low = ZERO, high = ZERO] = bounds.value;
    const bottom = roundDecimal(low, 0, "ceiling");
    const top = roundDecimal(high, 0, "floor");
    if (bottom === null || top === null) return err("#NUM!");
    const from = integerPart(bottom);
    const to = integerPart(top);
    if (from > to) return err("#NUM!");
    return numOrOverflow(normalizeDecimal({ coefficient: from + uniformBelow(entropy, to - from + 1n), scale: 0 }));
  },
};

/**
 * Calls a catalog function. A lookup, or a name with no implementation here,
 * is unsupported: translation never produces one, and a stored document that
 * names one is not guessed at.
 */
export function callBuiltin(name: CatalogFunctionNameV1, args: readonly (FormulaIRV1 | null)[], context: CallContextV1): ScalarV1 {
  const builtin = BUILTINS[name];
  if (builtin === undefined) throw new UnsupportedEvaluation();
  return builtin(args, context);
}

