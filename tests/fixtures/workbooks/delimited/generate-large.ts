/**
 * The corpus's large delimited fixture, as a generator rather than a file.
 *
 * A committed 10,000-row CSV would be about a megabyte of repository noise
 * whose content nobody could review; a generator is reviewable, deterministic,
 * and lets one definition serve both the streaming tests (10,000 rows, inside
 * the F02 budget) and the over-budget pre-flight test (30,000 rows, past the
 * 250,000-cell ceiling).
 *
 * `large-sample.csv` beside this file is the committed evidence of what the
 * generator emits — `tests/unit/import/preflight.test.ts` pins the two against
 * each other, so the sample cannot drift away from the generator that made it.
 */

export const LARGE_DELIMITED_HEADER = Object.freeze([
  "Visit ID",
  "Recorded on",
  "Site",
  "Crew",
  "Status",
  "Hours",
  "Quoted amount",
  "Contact email",
  "Notes",
] as const);

/** How many data rows `large-sample.csv` holds. */
export const LARGE_DELIMITED_SAMPLE_ROWS = 20;

const SITES = [
  "Ridgeway Depot",
  "Alder Court",
  "Bramble Yard",
  "Cedar Mill",
  "Dunmore Lot",
];
const CREWS = ["North", "South", "East", "West"];
const STATUSES = ["Scheduled", "In progress", "Waiting", "Complete"];

const at = <T>(values: readonly T[], index: number): T =>
  values[index % values.length] as T;

const epochDayToIso = (epochDay: number): string =>
  new Date(epochDay * 86_400_000).toISOString().slice(0, 10);

/** 2026-03-02, the day the generated log starts. */
const FIRST_EPOCH_DAY = 20_514;

const quote = (cell: string): string =>
  /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;

const row = (index: number): readonly string[] => [
  String(100_000 + index),
  epochDayToIso(FIRST_EPOCH_DAY + (index % 365)),
  at(SITES, index),
  at(CREWS, index),
  at(STATUSES, index),
  ((index % 16) / 4 + 1).toFixed(2),
  `$${String(120 + ((index * 37) % 9000))}.${String(index % 100).padStart(2, "0")}`,
  `crew-${String(index % 250)}@example.org`,
  index % 7 === 0 ? "Gate code changed, call ahead" : "",
];

/**
 * Deterministic by construction — no clock, no randomness — so a test that
 * generates 30,000 rows twice gets the same bytes both times.
 */
export function generateLargeDelimited(rowCount: number): string {
  const lines = [LARGE_DELIMITED_HEADER.join(",")];
  for (let index = 0; index < rowCount; index += 1) {
    lines.push(row(index).map(quote).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
