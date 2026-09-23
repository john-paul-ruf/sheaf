/**
 * The HTML-table inventory reader (M20; CA-18, D35).
 *
 * A legacy HTML export has no separate metadata — its tables *are* its
 * content — so there is no cell part to avoid. What the reader promises is a
 * bound: it reads **at most {@link SNIFF_SAMPLE_BYTES}**, the leading sample
 * content sniffing already read, and counts what that prefix holds.
 *
 * - When the whole file fits in the sample, the sheet list is exact: one
 *   sheet per top-level `<table>`, named as the adapter names it
 *   (`<caption>`, else Excel's `x:Name`, else `Table N`), with its `<tr>`
 *   rows and `<td>`/`<th>` cells counted.
 * - When it does not, the list is flagged `sheetListKnown: false` (more tables
 *   may follow the prefix, and their names are unknowable without reading
 *   on). The last table seen — or a single `Table 1` when none was — carries
 *   the rest of the file, extrapolated from the prefix's bytes per row; with no
 *   row seen at all, rows are `null` and cells are bounded by
 *   `bytes / 5` (`<td>x` is the smallest populated cell).
 *
 * Scripts, links and images seen in the prefix are counted workbook-wide.
 * Nothing in the file is refused as macro content: HTML behavior is inert
 * here and inventoried, never executed (invariant 8).
 */

import { isBoundExceeded } from "../../source/bounds.js";
import { SNIFF_SAMPLE_BYTES } from "../../source/sniff.js";
import type { RandomAccessSource } from "../../source/source.js";
import {
  PRESERVED_PART_KINDS,
  type ContainerHandleV1,
  type InventoryOutcomeV1,
  type InventoryReaderV1,
  type PreservedPartKindV1,
  type SheetInventoryItemV1,
} from "../../facts/index.js";
import { createTableWalker } from "./structure.js";
import { detectHtmlEncoding, tokenizeHtml } from "./tokenizer.js";

/** The smallest populated cell's markup: `<td>x`. */
export const MIN_HTML_CELL_MARKUP_BYTES = 5;

const emptyCounts = (): Record<PreservedPartKindV1, number> =>
  Object.fromEntries(PRESERVED_PART_KINDS.map((kind) => [kind, 0])) as Record<PreservedPartKindV1, number>;

/** Decoded text of `bytes`, the encoding decided by the same rule the adapter uses. */
export const decodePrefix = (bytes: Uint8Array): string => {
  const { encoding, bomByteLength } = detectHtmlEncoding(bytes);
  return new TextDecoder(encoding).decode(bytes.subarray(bomByteLength));
};

/** Whether the adapter can name every sheet: the whole file is in the sample. */
export const isSheetListKnown = (source: RandomAccessSource): boolean => source.byteLength <= SNIFF_SAMPLE_BYTES;

async function readInventory(container: ContainerHandleV1): Promise<InventoryOutcomeV1> {
  if (container.kind !== "text") {
    return { kind: "unreadable", detail: "unrecognized-content" };
  }
  const source = container.source;
  try {
    const sample = await source.slice(0, SNIFF_SAMPLE_BYTES);
    const isKnown = isSheetListKnown(source);
    const tables: { name: string; rows: number; cells: number }[] = [];
    const counts = emptyCounts();
    const walker = createTableWalker({
      onTable: (name) => tables.push({ name, rows: 0, cells: 0 }),
      onRow: () => {
        const table = tables.at(-1);
        if (table !== undefined) table.rows += 1;
      },
      onCell: () => {
        const table = tables.at(-1);
        if (table !== undefined) table.cells += 1;
      },
      onPart: (partKind) => {
        counts[partKind] += 1;
      },
    });
    for await (const token of tokenizeHtml([decodePrefix(sample)])) walker.accept(token);
    walker.finish();

    const rowsSeen = tables.reduce((sum, table) => sum + table.rows, 0);
    const remaining = Math.max(0, source.byteLength - sample.byteLength);
    const sheets = (tables.length > 0 ? tables : [{ name: "Table 1", rows: 0, cells: 0 }]).map(
      (table, sheetIndex, all): SheetInventoryItemV1 => {
        const isLast = sheetIndex === all.length - 1;
        let estimatedRowCount: number | null = table.rows;
        let estimatedCellCount: number | null = table.cells;
        if (isLast && remaining > 0) {
          if (rowsSeen === 0) {
            estimatedRowCount = null;
            estimatedCellCount = Math.floor(source.byteLength / MIN_HTML_CELL_MARKUP_BYTES);
          } else {
            const extraRows = Math.ceil((remaining * rowsSeen) / sample.byteLength);
            const cellsPerRow = Math.max(1, Math.ceil(table.cells / Math.max(1, table.rows)));
            estimatedRowCount = table.rows + extraRows;
            estimatedCellCount = table.cells + extraRows * cellsPerRow;
          }
        }
        return {
          sheetIndex,
          name: table.name,
          kind: "worksheet",
          visibility: "visible",
          declaredRange: null,
          declaredTables: [],
          estimatedRowCount,
          estimatedCellCount,
          preservedPartCounts: emptyCounts(),
        };
      },
    );
    return {
      kind: "inventory",
      inventory: {
        format: "html-table",
        sheets,
        sheetListKnown: isKnown,
        definedNames: [],
        dateSystem: "1900",
        preservedPartCounts: counts,
      },
    };
  } catch (cause) {
    if (isBoundExceeded(cause)) {
      return { kind: "unreadable", detail: cause.detail };
    }
    throw cause;
  }
}

/** The HTML-table inventory reader the import worker registers (D35). */
export const readHtmlTableInventory: InventoryReaderV1 = Object.freeze({
  format: "html-table",
  readInventory,
});
