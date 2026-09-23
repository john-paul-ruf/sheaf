/**
 * A delimited file too large to append (D38, CA-23), as a generator rather
 * than a committed file — the corpus's own precedent (`delimited/generate-large.ts`):
 * reviewable, deterministic, and no megabyte of repository noise.
 *
 * An append is one commit, a commit is never split across segments, and a
 * segment holds at most 10,000 events (database.md § event segments). One
 * `record.created` per row plus the table's schema events therefore puts any
 * file with {@link OVER_SEGMENT_ROWS} data rows past the cap, while it stays
 * well inside the import budget (3 columns × 10,050 rows ≪ 250,000 cells), so
 * pre-flight, staging and inference all accept it and only the append refuses.
 */

export const OVER_SEGMENT_ROWS = 10_050;

/** `Crew ID,Crew,Members` and one row per crew member slot. */
export function overSegmentCsv(rows: number = OVER_SEGMENT_ROWS): string {
  const lines = ["Crew ID,Crew,Members"];
  for (let index = 0; index < rows; index += 1) {
    lines.push(`CR-${String(index).padStart(5, "0")},Crew ${String(index % 40)},${String((index % 9) + 1)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Long rows at the head of {@link underestimatedOverSegmentCsv}: they fill pre-flight's whole sample. */
const LONG_ROWS = 70;

/**
 * A file too large to append whose **estimate passes** (F03 residual, S07):
 * pre-flight extrapolates from its first 64 KiB, and here those bytes are 70
 * rows of long notes, so it expects a few hundred rows; the short rows after
 * them make it {@link OVER_SEGMENT_ROWS} + 70. The existing-app destination
 * is therefore offered, and only promotion's exact count refuses it
 * (`append-too-large`).
 */
export function underestimatedOverSegmentCsv(): string {
  const lines = ["Crew ID,Crew,Notes"];
  for (let index = 0; index < LONG_ROWS; index += 1) {
    lines.push(`LR-${String(index).padStart(3, "0")},Crew ${String(index % 40)},${"site notes ".repeat(90).trim()}`);
  }
  for (let index = 0; index < OVER_SEGMENT_ROWS; index += 1) {
    lines.push(`CR-${String(index).padStart(5, "0")},Crew ${String(index % 40)},ok`);
  }
  return `${lines.join("\n")}\n`;
}
