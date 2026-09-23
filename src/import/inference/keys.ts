/**
 * Keys and labels (M21; FR-7, FR-11; CAP-23/CAP-24).
 *
 * **Key:** the first column whose heading reads as an identifier and whose
 * values are unique and never blank across *every* row — measured, never
 * assumed: a column whose distinct values outgrew the sketch is not proven
 * unique and is not proposed. A declared table's columns are its declared
 * names, so its identifier column wins by coming first in the same rule.
 *
 * **Label:** the first text column after the key whose values are mostly
 * distinct (≥ {@link LABEL_DISTINCT_SHARE}); else the key itself; else none.
 */

import type { ColumnStats } from "./types.js";
import type { ProposedFieldTypeV1 } from "./values.js";

/** Whole words that make a heading an identifier, case-insensitive; `#` anywhere. */
export const IDENTIFIER_WORDS = Object.freeze(["id", "code", "no", "key", "#"] as const);

/** The share of distinct values a label column needs. */
export const LABEL_DISTINCT_SHARE = 0.8;

const IDENTIFIER = /(?:^|[^a-z0-9])(?:id|code|no|key)(?:$|[^a-z0-9])/i;

export const isIdentifierHeading = (heading: string): boolean => heading.includes("#") || IDENTIFIER.test(heading);

/** Unique and non-blank in every one of `rowCount` rows, fully measured. */
export const isUniqueAndComplete = (stats: ColumnStats, rowCount: number): boolean =>
  rowCount > 0 && !stats.distinctOverflow && stats.nonEmpty === rowCount && stats.distinct.size === stats.nonEmpty;

export interface KeyedColumnV1 {
  readonly columnKey: string;
  readonly fieldName: string;
  readonly type: ProposedFieldTypeV1 | { readonly kind: "reference" };
  readonly stats: ColumnStats;
}

export function chooseKey(columns: readonly KeyedColumnV1[], rowCount: number): KeyedColumnV1 | null {
  return columns.find((column) => isIdentifierHeading(column.fieldName) && isUniqueAndComplete(column.stats, rowCount)) ?? null;
}

export function chooseLabel(columns: readonly KeyedColumnV1[], key: KeyedColumnV1 | null): KeyedColumnV1 | null {
  const start = key === null ? 0 : columns.indexOf(key) + 1;
  const label = columns
    .slice(start)
    .find(
      (column) =>
        column.type.kind === "text" &&
        column.stats.nonEmpty > 0 &&
        (column.stats.distinctOverflow || column.stats.distinct.size >= column.stats.nonEmpty * LABEL_DISTINCT_SHARE),
    );
  return label ?? key;
}
