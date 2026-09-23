/**
 * Proleptic Gregorian calendar arithmetic over signed epoch days (M03;
 * database.md § Canonical values: a date is an epoch day with no hidden time
 * zone). Pure integer math — no `Date`, no locale.
 */

export interface CivilDateV1 {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Days since 1970-01-01 of a civil date; month 1–12. */
export function epochDayOf(year: number, month: number, day: number): number {
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

export function civilOf(epochDay: number): CivilDateV1 {
  const shifted = epochDay + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

export function daysInMonth(year: number, month: number): number {
  return month === 12 ? 31 : epochDayOf(year, month + 1, 1) - epochDayOf(year, month, 1);
}

/** The civil month `months` after (year, month), as a year and 1-based month. */
export function addMonths(year: number, month: number, months: number): { readonly year: number; readonly month: number } {
  const index = year * 12 + (month - 1) + months;
  return { year: Math.floor(index / 12), month: index - Math.floor(index / 12) * 12 + 1 };
}

/** 0 = Sunday … 6 = Saturday; 1970-01-01 was a Thursday. */
export function dayOfWeek(epochDay: number): number {
  return (((epochDay + 4) % 7) + 7) % 7;
}

/** `YYYY-MM-DD`, the one unambiguous spelling of a date. */
export function isoDateOf(epochDay: number): string {
  const { year, month, day } = civilOf(epochDay);
  const yearText = year < 0 ? `-${String(-year).padStart(4, "0")}` : String(year).padStart(4, "0");
  return `${yearText}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The epoch day an ISO `YYYY-MM-DD` names, or `null` for anything else or an impossible day. */
export function epochDayOfIsoDate(text: string): number | null {
  const match = /^(-?\d{4,6})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return epochDayOf(year, month, day);
}
