/**
 * Number facts every spreadsheet adapter shares (M65).
 *
 * Two rules live here so that OOXML, XLSB and BIFF — which store the same
 * IEEE doubles and the same Excel number-format model — say the same thing
 * about the same cell:
 *
 * - **Doubles become canonical decimals, never float strings.** A stored
 *   double is written as the *shortest* decimal that reads back to the same
 *   double — ECMAScript's `Number.prototype.toString` digits, which the
 *   language guarantees are the shortest round-tripping ones — with any
 *   exponent expanded into plain positional notation. `0.1` stays `0.1`, never
 *   `0.1000000000000000055511151231257827`.
 * - **Formats are classified, not applied.** A number format's class
 *   (currency, date, percent …) is evidence for inference; whether a
 *   date-formatted number *is* a date is inference's call, not the adapter's.
 */

import {
  decimalValue,
  isCanonicalDecimal,
  type CellValueV1,
} from "../../domain/model/values.js";
import type { FormatClassV1 } from "./workbook-facts.js";

/**
 * The shortest round-tripping decimal spelling of a finite double, in the
 * domain's canonical grammar (no exponent, no negative zero).
 */
export function decimalTextOfDouble(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError("only a finite double has a decimal spelling");
  }
  if (value === 0) {
    return "0";
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(value));
  if (match === null) {
    throw new RangeError("unexpected number spelling");
  }
  const [, sign = "", whole = "", fraction = "", exponentText] = match;
  if (exponentText === undefined) {
    return `${sign}${whole}${fraction === "" ? "" : `.${fraction}`}`;
  }
  const digits = `${whole}${fraction}`.replace(/^0+/, "");
  const point = whole.replace(/^0+/, "").length + Number(exponentText);
  if (point <= 0) {
    return `${sign}0.${"0".repeat(-point)}${digits}`;
  }
  if (point >= digits.length) {
    return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  }
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * A stored double as a cell value, or `null` when it has no canonical decimal
 * (beyond 34 significant digits, e.g. `1e40`): the adapter then keeps the
 * source text as an invalid-preserved value with a diagnostic.
 */
export function decimalCellOfDouble(value: number): CellValueV1 | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const text = decimalTextOfDouble(value);
  return isCanonicalDecimal(text) ? decimalValue(text) : null;
}

export interface NumberFormatClassV1 {
  readonly formatClass: FormatClassV1;
  readonly currencySymbol: string | null;
}

interface BuiltinFormat extends NumberFormatClassV1 {
  readonly code: string;
}

const builtin = (
  code: string,
  formatClass: FormatClassV1,
  currencySymbol: string | null = null,
): BuiltinFormat => ({ code, formatClass, currencySymbol });

/**
 * Excel's built-in formats 0–49 (ECMA-376 Part 1 §18.8.30), as an en-US
 * workbook renders them. 5–8 and 42/44 are the *locale's* currency, so they
 * classify as currency with no symbol: the file does not say which one.
 */
export const BUILTIN_NUMBER_FORMATS: ReadonlyMap<number, BuiltinFormat> = new Map([
  [0, builtin("General", "general")],
  [1, builtin("0", "number")],
  [2, builtin("0.00", "number")],
  [3, builtin("#,##0", "number")],
  [4, builtin("#,##0.00", "number")],
  [5, builtin("#,##0_);(#,##0)", "currency")],
  [6, builtin("#,##0_);[Red](#,##0)", "currency")],
  [7, builtin("#,##0.00_);(#,##0.00)", "currency")],
  [8, builtin("#,##0.00_);[Red](#,##0.00)", "currency")],
  [9, builtin("0%", "percent")],
  [10, builtin("0.00%", "percent")],
  [11, builtin("0.00E+00", "number")],
  [12, builtin("# ?/?", "number")],
  [13, builtin("# ??/??", "number")],
  [14, builtin("mm-dd-yy", "date")],
  [15, builtin("d-mmm-yy", "date")],
  [16, builtin("d-mmm", "date")],
  [17, builtin("mmm-yy", "date")],
  [18, builtin("h:mm AM/PM", "time")],
  [19, builtin("h:mm:ss AM/PM", "time")],
  [20, builtin("h:mm", "time")],
  [21, builtin("h:mm:ss", "time")],
  [22, builtin("m/d/yy h:mm", "datetime")],
  [37, builtin("#,##0 ;(#,##0)", "number")],
  [38, builtin("#,##0 ;[Red](#,##0)", "number")],
  [39, builtin("#,##0.00;(#,##0.00)", "number")],
  [40, builtin("#,##0.00;[Red](#,##0.00)", "number")],
  [41, builtin('_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)', "number")],
  [42, builtin('_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)', "currency")],
  [43, builtin('_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)', "number")],
  [44, builtin('_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)', "currency")],
  [45, builtin("mm:ss", "time")],
  [46, builtin("[h]:mm:ss", "time")],
  [47, builtin("mmss.0", "time")],
  [48, builtin("##0.0E+0", "number")],
  [49, builtin("@", "text")],
]);

const CURRENCY_SYMBOL = /[$€£¥₹₩₽¢₪₺₫₱₴₦]/;

/**
 * Classifies a format code as authored. Quoted literals, escaped and padding
 * characters, and bracketed modifiers are removed before the tokens are read,
 * so a literal `"days"` never makes a number format a date; the currency
 * symbol is taken from a `[$€-407]` locale tag, a quoted symbol, or a bare one.
 */
export function classifyNumberFormat(code: string): NumberFormatClassV1 {
  if (/^\s*general\s*$/i.test(code)) {
    return { formatClass: "general", currencySymbol: null };
  }
  let currencySymbol: string | null = null;
  const locale = /\[\$([^\]-]+)(?:-[^\]]*)?\]/.exec(code);
  if (locale?.[1] !== undefined) {
    currencySymbol = locale[1];
  }
  for (const quoted of code.matchAll(/"([^"]*)"/g)) {
    const literal = (quoted[1] ?? "").trim();
    if (currencySymbol === null && literal !== "" && CURRENCY_SYMBOL.test(literal) && literal.length <= 3) {
      currencySymbol = literal;
    }
  }
  const tokens = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/[_*]./g, "")
    .replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, "")
    .toLowerCase();
  const bare = CURRENCY_SYMBOL.exec(tokens);
  if (currencySymbol === null && bare !== null) {
    currencySymbol = bare[0];
  }

  const hasHour = /h/.test(tokens);
  const hasSecond = /s/.test(tokens);
  const hasAmPm = /am\/pm|a\/p/.test(tokens);
  const isTime = hasHour || hasSecond || hasAmPm;
  const isDate = /[yd]/.test(tokens) || (/m/.test(tokens) && !isTime);
  const hasDigits = /[0#?]/.test(tokens);

  let formatClass: FormatClassV1;
  if (isDate && isTime) formatClass = "datetime";
  else if (isDate) formatClass = "date";
  else if (isTime) formatClass = "time";
  else if (/%/.test(tokens)) formatClass = "percent";
  else if (currencySymbol !== null && hasDigits) formatClass = "currency";
  else if (tokens.includes("@") && !hasDigits) formatClass = "text";
  else if (hasDigits) formatClass = "number";
  else if (/general/.test(tokens)) formatClass = "general";
  else formatClass = "other";

  return {
    formatClass,
    currencySymbol: formatClass === "currency" ? currencySymbol : null,
  };
}
