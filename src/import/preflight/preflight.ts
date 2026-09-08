/**
 * Delimited pre-flight sizing (M14; architecture § Import Architecture Stage 1,
 * FR-3).
 *
 * Pre-flight answers "can this device do this at all?" **before** a single cell
 * is parsed for keeps. It is allowed exactly one bounded read — the leading
 * {@link PREFLIGHT_SAMPLE_BYTES} — and it extrapolates from that. Everything it
 * reports about size is therefore an estimate, and the type says so:
 * {@link PreflightReportV1.isEstimate} is the literal `true`, so no view model
 * can be written that renders these counts as exact (D24). Exact counts exist
 * only after the parse, in the fact stream's terminal summary.
 *
 * The F02 budgets are fixed constants rather than measured device capacity
 * (D20). They are deliberately conservative and deliberately reversible: F07's
 * adaptive M04 budgets replace them, and nothing outside this module knows the
 * numbers.
 */

import { parseDelimited } from "../formats/delimited/parse.js";
import type {
  DelimitedFormatV1,
  DelimiterV1,
  NewlineConventionV1,
  SniffResultV1,
  TextEncodingV1,
} from "../source/sniff.js";
import { bytesSource, type RandomAccessSource } from "../source/source.js";
import type { RefusalV1 } from "./refusal.js";

/** D20: the fixed F02 source ceiling — 50 MiB. */
export const F02_IMPORT_MAX_SOURCE_BYTES = 52_428_800;

/** D20: the fixed F02 cell ceiling — 250,000 estimated cells. */
export const F02_IMPORT_MAX_ESTIMATED_CELLS = 250_000;

/** The one window pre-flight may read: 64 KiB. */
export const PREFLIGHT_SAMPLE_BYTES = 65_536;

/** How many rows the target screen previews (SCR-017). */
export const PREFLIGHT_SAMPLE_ROWS = 10;

/** A sniff result already known to be delimited; the precondition is a type. */
export type DelimitedSniffV1 = SniffResultV1 & {
  readonly format: DelimitedFormatV1;
};

export const isDelimitedSniff = (
  sniff: SniffResultV1,
): sniff is DelimitedSniffV1 => sniff.format.kind === "delimited";

export interface PreflightReportV1 {
  readonly fileName: string;
  readonly sourceByteLength: number;
  readonly delimiter: DelimiterV1;
  readonly encoding: TextEncodingV1;
  readonly newline: NewlineConventionV1;
  /** The modal width of the sampled rows — what the table most likely is. */
  readonly columnCount: number;
  /**
   * Every physical row, header included. Which row is the header is inference's
   * finding at review (M21), not a guess pre-flight is entitled to make.
   */
  readonly estimatedRowCount: number;
  readonly estimatedCellCount: number;
  /**
   * Always `true`, as a type and not merely as a value: a bounded sample cannot
   * know a count exactly, so nothing downstream may present these as exact
   * (D24).
   */
  readonly isEstimate: true;
  /** The first rows, for the target screen's preview. */
  readonly sampleRows: readonly (readonly string[])[];
  readonly bytesSampled: number;
}

export type PreflightOutcomeV1 =
  | { readonly kind: "proceed"; readonly report: PreflightReportV1 }
  | { readonly kind: "refused"; readonly refusal: RefusalV1 };

const modalWidth = (rows: readonly (readonly string[])[]): number => {
  const tally = new Map<number, number>();
  for (const row of rows) {
    if (row.length === 0) {
      continue;
    }
    tally.set(row.length, (tally.get(row.length) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [width, count] of tally) {
    if (count > bestCount || (count === bestCount && width > best)) {
      best = width;
      bestCount = count;
    }
  }
  return best;
};

/**
 * Splits the sample into rows through the real parser, so quoting, embedded
 * newlines, and encodings behave here exactly as they will during the import.
 * The final row is dropped whenever the sample stopped short of the file: it
 * was cut mid-row, and a truncated row is not evidence of anything.
 */
const sampleRowsOf = async (
  sample: Uint8Array,
  format: DelimitedFormatV1,
  isWholeFile: boolean,
): Promise<readonly (readonly string[])[]> => {
  const rows = new Map<number, string[]>();
  const sampleFormat: DelimitedFormatV1 = { ...format, bomByteLength: 0 };

  for await (const item of parseDelimited(bytesSource(sample), sampleFormat)) {
    if (item.kind !== "batch") {
      continue;
    }
    for (const fact of item.facts) {
      if (fact.kind === "row") {
        rows.set(
          fact.rowIndex,
          Array.from({ length: fact.cellCount }, () => ""),
        );
      } else if (fact.kind === "value" && fact.value.kind === "text") {
        const row = rows.get(fact.rowIndex);
        if (row !== undefined) {
          row[fact.columnIndex] = fact.value.text;
        }
      }
    }
  }

  const ordered = [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, cells]) => cells);
  return isWholeFile ? ordered : ordered.slice(0, -1);
};

const overBudget = (
  fileName: string,
  exceeded: "source-bytes" | "estimated-cells",
  sourceByteLength: number,
  estimatedCellCount: number,
): PreflightOutcomeV1 => ({
  kind: "refused",
  refusal: {
    kind: "over-import-budget",
    fileName,
    remedy: "use-larger-device",
    exceeded,
    sourceByteLength,
    maxSourceByteLength: F02_IMPORT_MAX_SOURCE_BYTES,
    estimatedCellCount,
    maxEstimatedCellCount: F02_IMPORT_MAX_ESTIMATED_CELLS,
  },
});

/**
 * Sizes a delimited source from one bounded sample and routes it against the
 * F02 budgets. Reads {@link PREFLIGHT_SAMPLE_BYTES} at most, once, whatever the
 * file's size — the over-budget path still samples, because the screen that
 * explains the refusal has to state real numbers (D20/SCR-019).
 */
export async function preflightDelimited(
  source: RandomAccessSource,
  sniff: DelimitedSniffV1,
): Promise<PreflightOutcomeV1> {
  const format = sniff.format;
  const fileName = sniff.declaredName;
  const bodyByteLength = Math.max(0, source.byteLength - format.bomByteLength);

  const sample = await source.slice(
    format.bomByteLength,
    Math.min(PREFLIGHT_SAMPLE_BYTES, bodyByteLength),
  );
  const isWholeFile = sample.byteLength >= bodyByteLength;
  const rows = await sampleRowsOf(sample, format, isWholeFile);

  const columnCount = modalWidth(rows);
  const estimatedRowCount =
    rows.length === 0 || sample.byteLength === 0
      ? rows.length
      : Math.round((rows.length * bodyByteLength) / sample.byteLength);
  const estimatedCellCount = estimatedRowCount * columnCount;

  if (source.byteLength > F02_IMPORT_MAX_SOURCE_BYTES) {
    return overBudget(
      fileName,
      "source-bytes",
      source.byteLength,
      estimatedCellCount,
    );
  }
  if (estimatedCellCount > F02_IMPORT_MAX_ESTIMATED_CELLS) {
    return overBudget(
      fileName,
      "estimated-cells",
      source.byteLength,
      estimatedCellCount,
    );
  }

  return {
    kind: "proceed",
    report: {
      fileName,
      sourceByteLength: source.byteLength,
      delimiter: format.delimiter,
      encoding: format.encoding,
      newline: format.newline,
      columnCount,
      estimatedRowCount,
      estimatedCellCount,
      isEstimate: true,
      sampleRows: rows.slice(0, PREFLIGHT_SAMPLE_ROWS),
      bytesSampled: sample.byteLength,
    },
  };
}
