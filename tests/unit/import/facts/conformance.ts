/**
 * The V2 fact-stream conformance suite (CA-17). Every adapter's tests run
 * their streams through {@link assertConformingStream}; S04 and S05 import it
 * for XLSB/BIFF and ODS/HTML exactly as S01 does for delimited and OOXML.
 *
 * It checks the stream contract, not any format's content:
 *
 * - batches are contiguous from 0, non-empty, and within the batch bound;
 * - a complete stream ends with exactly one summary whose counts are the
 *   stream's own; a cancelled stream has none;
 * - sheet scoping: if any `sheet` fact appears, the stream opens with one, and
 *   sheet indexes rise in workbook order;
 * - sparsity: row indexes rise within a sheet, a value (and a cell-format or
 *   formula) belongs to the row just opened, below its `cellCount`, in rising
 *   column order;
 * - every range and anchor lies inside the grid, first ≤ last;
 * - every item maps to the canonical CBOR value domain.
 */

import { CONTAINER_BOUNDS_V1 } from "../../../../src/import/source/bounds.js";
import {
  factStreamItemToCanonicalValue,
  IMPORT_DIAGNOSTIC_CODES,
  WORKBOOK_FACTS_PER_BATCH,
  type CanonicalFactValueV1,
  type RangeV1,
  type WorkbookFactStreamItemV2,
} from "../../../../src/import/facts/index.js";

export interface ConformanceOptionsV1 {
  readonly factsPerBatch?: number;
  /** `false` for a stream that was cancelled: it must carry no summary. */
  readonly isComplete?: boolean;
}

const violation = (message: string): never => {
  throw new Error(`fact stream does not conform: ${message}`);
};

const isIndex = (value: number, limit: number): boolean =>
  Number.isSafeInteger(value) && value >= 0 && value < limit;

const checkRange = (range: RangeV1, what: string): void => {
  const { maxRow, maxColumn } = CONTAINER_BOUNDS_V1;
  if (
    !isIndex(range.firstRow, maxRow) ||
    !isIndex(range.lastRow, maxRow) ||
    !isIndex(range.firstColumn, maxColumn) ||
    !isIndex(range.lastColumn, maxColumn) ||
    range.firstRow > range.lastRow ||
    range.firstColumn > range.lastColumn
  ) {
    violation(`${what} ${JSON.stringify(range)} is outside the grid or inverted`);
  }
};

const checkCanonical = (value: CanonicalFactValueV1, path: string): void => {
  if (value === null || typeof value === "boolean" || typeof value === "bigint" || typeof value === "string") {
    return;
  }
  if (value instanceof Uint8Array) {
    return;
  }
  if (Array.isArray(value)) {
    (value as readonly CanonicalFactValueV1[]).forEach((item, index) => checkCanonical(item, `${path}[${index}]`));
    return;
  }
  if (value instanceof Map) {
    for (const [key, item] of value as ReadonlyMap<unknown, CanonicalFactValueV1>) {
      if (typeof key !== "string") violation(`${path} has a non-string key`);
      checkCanonical(item, `${path}.${String(key)}`);
    }
    return;
  }
  violation(`${path} is not canonically encodable (${typeof value})`);
};

export function assertConformingStream(
  items: readonly WorkbookFactStreamItemV2[],
  options: ConformanceOptionsV1 = {},
): void {
  const factsPerBatch = options.factsPerBatch ?? WORKBOOK_FACTS_PER_BATCH;
  const isComplete = options.isComplete ?? true;
  const { maxRow, maxColumn } = CONTAINER_BOUNDS_V1;

  const summaries = items.filter((item) => item.kind === "summary");
  if (isComplete && (summaries.length !== 1 || items.at(-1)?.kind !== "summary")) {
    violation("a complete stream ends with exactly one summary");
  }
  if (!isComplete && summaries.length !== 0) {
    violation("a cancelled stream carries no summary");
  }

  let batchCount = 0;
  let rowCount = 0;
  let valueCount = 0;
  let columnCount = 0;
  let isFirstFact = true;
  let hasSheets = false;
  let sheetIndex = -1;
  let lastRowIndex = -1;
  let openRow: { rowIndex: number; cellCount: number } | null = null;
  let lastValueColumn = -1;

  for (const item of items) {
    let canonical: CanonicalFactValueV1;
    try {
      canonical = factStreamItemToCanonicalValue(item);
    } catch {
      return violation(`a ${item.kind} item is not canonically encodable`);
    }
    checkCanonical(canonical, item.kind);
    if (item.kind === "summary") {
      continue;
    }
    if (item.batchSeq !== batchCount) {
      violation(`batch ${item.batchSeq} arrived where ${batchCount} was due`);
    }
    batchCount += 1;
    if (item.facts.length === 0 || item.facts.length > factsPerBatch) {
      violation(`batch ${item.batchSeq} holds ${item.facts.length} facts`);
    }

    for (const fact of item.facts) {
      if (isFirstFact) {
        hasSheets = items.some(
          (candidate) => candidate.kind === "batch" && candidate.facts.some((each) => each.kind === "sheet"),
        );
        if (hasSheets && fact.kind !== "sheet") {
          violation(`a stream with sheets opens with a ${fact.kind} fact`);
        }
        isFirstFact = false;
      }
      switch (fact.kind) {
        case "sheet":
          if (fact.sheetIndex <= sheetIndex || !Number.isSafeInteger(fact.sheetIndex)) {
            violation(`sheet ${fact.sheetIndex} follows sheet ${sheetIndex}`);
          }
          sheetIndex = fact.sheetIndex;
          lastRowIndex = -1;
          openRow = null;
          if (fact.declaredRange !== null) checkRange(fact.declaredRange, "declared range");
          break;
        case "row":
          if (!isIndex(fact.rowIndex, maxRow) || fact.rowIndex <= lastRowIndex) {
            violation(`row ${fact.rowIndex} follows row ${lastRowIndex}`);
          }
          if (!Number.isSafeInteger(fact.cellCount) || fact.cellCount < 0 || fact.cellCount > maxColumn) {
            violation(`row ${fact.rowIndex} declares ${fact.cellCount} cells`);
          }
          lastRowIndex = fact.rowIndex;
          openRow = { rowIndex: fact.rowIndex, cellCount: fact.cellCount };
          lastValueColumn = -1;
          rowCount += 1;
          columnCount = Math.max(columnCount, fact.cellCount);
          break;
        case "value":
        case "cell-format":
        case "formula":
          if (openRow === null || fact.rowIndex !== openRow.rowIndex) {
            violation(`${fact.kind} at row ${fact.rowIndex} outside its row`);
          }
          if (!isIndex(fact.columnIndex, (openRow as { cellCount: number }).cellCount)) {
            violation(`${fact.kind} at column ${fact.columnIndex} is at or beyond cellCount`);
          }
          if (fact.kind === "value") {
            if (fact.columnIndex <= lastValueColumn) {
              violation(`value at column ${fact.columnIndex} after column ${lastValueColumn}`);
            }
            lastValueColumn = fact.columnIndex;
            valueCount += 1;
          }
          break;
        case "diagnostic":
          if (!IMPORT_DIAGNOSTIC_CODES.includes(fact.diagnostic.code)) {
            violation(`unknown diagnostic ${fact.diagnostic.code}`);
          }
          break;
        case "declared-table":
        case "validation":
        case "merge":
          checkRange(fact.range, fact.kind);
          break;
        case "preserved-part":
          if (fact.anchor !== null) checkRange(fact.anchor, "preserved-part anchor");
          break;
        case "defined-name":
          break;
        default: {
          const unreachable: never = fact;
          violation(`unknown fact ${JSON.stringify(unreachable)}`);
        }
      }
    }
  }

  const summary = summaries[0];
  if (summary !== undefined) {
    const actual = { rowCount, valueCount, batchCount, columnCount };
    const claimed = {
      rowCount: summary.rowCount,
      valueCount: summary.valueCount,
      batchCount: summary.batchCount,
      columnCount: summary.columnCount,
    };
    if (JSON.stringify(actual) !== JSON.stringify(claimed)) {
      violation(`summary claims ${JSON.stringify(claimed)}, stream holds ${JSON.stringify(actual)}`);
    }
    const codes = summary.diagnostics.map((diagnostic) => diagnostic.code);
    if (new Set(codes).size !== codes.length) {
      violation("summary repeats a diagnostic code");
    }
  }
}
