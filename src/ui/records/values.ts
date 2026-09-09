import type {
  RecordDetailVm,
  RecordValueVm,
} from "../../application/view-models/records.js";

/**
 * How a cell reads, and how a typed input's text becomes one (M44).
 *
 * A view model holds no clock and no locale (M37 must-not), so every date,
 * amount and instant is formatted here, from the reader's own locale.
 *
 * **A number is never a float.** `RecordValueVm`'s `decimal` is the exact text
 * that was authored, and it is rendered as that text. Grouping separators are
 * applied to a currency only when the amount round-trips through a double
 * without changing — `Intl` takes a `number`, and a 34-significant-digit
 * decimal does not survive one. When it would not, the exact text and the
 * currency code are shown instead of a prettier lie.
 */

/** The field type as the view model carries it — the wire union, by alias. */
export type FieldTypeVm = RecordDetailVm["fields"][number]["type"];

const dateOnly = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeZone: "UTC",
});

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const MS_PER_DAY = 86_400_000;

/** The instant, as a person reads it. */
export function formatInstant(epochMs: number): string {
  return dateTime.format(new Date(epochMs));
}

/** The same instant, machine-readable, for a `<time dateTime>`. */
export function isoInstant(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * A date is a day, not a moment: it crosses as a signed epoch day and is read
 * in UTC at both ends, so a device in Auckland and one in Chicago render the
 * same day for the same value.
 */
export function epochDayToIsoDate(epochDay: number): string {
  return (new Date(epochDay * MS_PER_DAY).toISOString().split("T")[0] ?? "");
}

/** `null` when the text is not a complete `YYYY-MM-DD` day. */
export function isoDateToEpochDay(iso: string): number | null {
  if (!/^-?\d{4,6}-\d{2}-\d{2}$/u.test(iso)) return null;
  const parsed = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return null;
  const day = parsed / MS_PER_DAY;
  return Number.isInteger(day) ? day : null;
}

export function formatEpochDay(epochDay: number): string {
  return dateOnly.format(new Date(epochDay * MS_PER_DAY));
}

/**
 * The canonical decimal grammar, restated so a form can choose the *truthful*
 * wire kind for what was typed (`src/domain/model/values.ts` owns it).
 *
 * This is not a second validator: the domain remains the only authority on
 * whether a value is acceptable. Text that does not match is sent as **text**,
 * and the one validator refuses it as a wrong-type value — which is exactly
 * what a person who typed "TBD" into an amount needs to be told (invariant 5,
 * D23). Being stricter here is therefore safe; being looser would not be, so
 * the significant-digit ceiling is restated with it.
 */
const CANONICAL_DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const DECIMAL_SIGNIFICANT_DIGIT_LIMIT = 34;

export function isCanonicalDecimalText(text: string): boolean {
  if (!CANONICAL_DECIMAL.test(text)) return false;
  const digits = text.replace("-", "").replace(".", "").replace(/^0+/u, "");
  if (digits.length > DECIMAL_SIGNIFICANT_DIGIT_LIMIT) return false;
  // Negative zero is not a value the domain holds.
  return !(text.startsWith("-") && digits.length === 0);
}

/** True when `Intl` can group this amount without changing it. */
function survivesADouble(decimal: string): boolean {
  const numeric = Number(decimal);
  if (!Number.isFinite(numeric)) return false;
  const fraction = decimal.split(".")[1]?.length ?? 0;
  return numeric.toFixed(fraction) === decimal;
}

export function formatCurrency(decimal: string, currencyCode: string): string {
  if (!survivesADouble(decimal)) return `${decimal} ${currencyCode}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).format(Number(decimal));
  } catch {
    // An unknown currency code is still a fact about the field; it is stated
    // rather than dropped.
    return `${decimal} ${currencyCode}`;
  }
}

/** What a cell says, in one line. Absent states stay distinguishable. */
export function describeValue(
  value: RecordValueVm,
  type: FieldTypeVm | undefined,
): string {
  switch (value.kind) {
    case "text":
      return value.text;
    case "number":
      return type?.kind === "currency"
        ? formatCurrency(value.decimal, type.currencyCode)
        : value.decimal;
    case "boolean":
      return value.boolean ? "Yes" : "No";
    case "option":
      return value.label ?? "A choice that is no longer in this field's list";
    case "date":
      return formatEpochDay(value.epochDay);
    case "blank":
      return "Cleared";
    case "missing":
      return "Not given";
    case "invalid-preserved":
      return value.sourceText;
    case "reference":
      // No F02 producer (D25); the member exists because the wire has one.
      return "A related record";
  }
}

/** True where the value carries something a person wrote or imported. */
export function isAbsent(value: RecordValueVm): boolean {
  return value.kind === "blank" || value.kind === "missing";
}

/**
 * The app's initials, for the identity chip. Presentation only: nothing
 * depends on it, and a name with no words still yields something rather than
 * an empty box.
 */
export function monogramFor(displayName: string): string {
  const initials = displayName
    .split(/\s+/u)
    .map((word) => [...word][0])
    .filter((initial): initial is string => initial !== undefined);
  const glyph = initials.slice(0, 2).join("");
  return (glyph === "" ? ([...displayName][0] ?? "?") : glyph).toUpperCase();
}

/** The mocks write counts grouped — "12,482 rows". The locale is the reader's. */
const groupedNumber = new Intl.NumberFormat();

export function formatCount(value: number): string {
  return groupedNumber.format(value);
}

/** "1 record" / "40 records", grouped. */
export function describeRecordCount(count: number): string {
  return count === 1 ? "1 record" : `${formatCount(count)} records`;
}
