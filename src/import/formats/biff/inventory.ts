/**
 * The BIFF (`.xls`) inventory reader (M17; CA-18, D35, invariant 8).
 *
 * **Metadata only.** It reads the CFB directory, the workbook globals (with
 * the SST skipped unread), and for each sheet a **prefix**: from the sheet's
 * `BOF` — reached by skipping, never parsing, the bytes before it — up to its
 * `DIMENSIONS` record. The prefix stops at the first cell or `ROW` record
 * header, so no cell record body is ever read; the tests prove it on a copy
 * of every fixture whose cell records are overwritten with noise.
 *
 * **Estimated cells** are `min(declared area, sheet substream bytes / 6)`:
 * 6 bytes is the smallest a populated BIFF cell can be (one `MULRK` entry), so
 * the size bound never under-counts a real sheet, while a hostile
 * `DIMENSIONS` over a tiny substream cannot inflate the estimate.
 *
 * **Refusals come first**: a VBA storage refuses before any stream is read; an
 * XLM macro sheet, a VB module sheet or an `FNGROUPNAME` refuses from the
 * globals; a `FILEPASS` record is an encrypted workbook, never decrypted.
 */

import {
  PRESERVED_PART_KINDS,
  type ContainerHandleV1,
  type InventoryOutcomeV1,
  type InventoryReaderV1,
  type PreservedPartKindV1,
  type RangeV1,
  type SheetInventoryItemV1,
  type SheetKindV1,
  type SheetVisibilityV1,
} from "../../facts/index.js";
import { BoundExceededError, CONTAINER_BOUNDS_V1, isBoundExceeded } from "../../source/bounds.js";
import { definedNamesOf, readBiffGlobals, SHEET_TYPE, storageMacroSignal, type BiffSheetEntryV1 } from "./globals.js";
import {
  CELL_RECORD_TYPES,
  malformed,
  RT,
  u16,
  u32,
  type BiffRecordStreamV1,
  type BiffVersionV1,
} from "./records.js";

/** The smallest a populated cell's record bytes can be; see the module comment. */
export const MIN_CELL_RECORD_BYTES = 6;

/** A sheet whose `DIMENSIONS` has not come within 1 MiB of its `BOF` is malformed. */
export const SHEET_PREFIX_MAX_BYTES = 1_048_576;

const WSBOOL_DIALOG = 0x0010;

/** Every kind at zero; a count of zero is exact. */
export const emptyCounts = (): Record<PreservedPartKindV1, number> =>
  Object.fromEntries(PRESERVED_PART_KINDS.map((kind) => [kind, 0])) as Record<PreservedPartKindV1, number>;

export const visibilityOf = (hiddenState: number): SheetVisibilityV1 =>
  hiddenState === 1 ? "hidden" : hiddenState === 2 ? "very-hidden" : "visible";

export type DeclaredDimensionV1 =
  | { readonly kind: "range"; readonly range: RangeV1 }
  | { readonly kind: "empty" }
  | { readonly kind: "none" };

/** `DIMENSIONS` (MS-XLS §2.4.90): last row and column are stored one past the end. */
export function dimensionOf(body: Uint8Array, version: BiffVersionV1): DeclaredDimensionV1 {
  const isBiff8 = version === "biff8";
  const firstRow = isBiff8 ? u32(body, 0) : u16(body, 0);
  const rowEnd = isBiff8 ? u32(body, 4) : u16(body, 2);
  const firstColumn = u16(body, isBiff8 ? 8 : 4);
  const columnEnd = u16(body, isBiff8 ? 10 : 6);
  if (rowEnd > CONTAINER_BOUNDS_V1.maxRow || columnEnd > CONTAINER_BOUNDS_V1.maxColumn) {
    throw new BoundExceededError("impossible-dimension");
  }
  if (rowEnd <= firstRow || columnEnd <= firstColumn) return { kind: "empty" };
  return { kind: "range", range: { firstRow, firstColumn, lastRow: rowEnd - 1, lastColumn: columnEnd - 1 } };
}

export interface SheetPrefixV1 {
  readonly sheetKind: SheetKindV1;
  readonly dimension: DeclaredDimensionV1;
}

/**
 * Reads one sheet's `BOF` and the records before its first cell, stopping at
 * `DIMENSIONS`. Positions `stream` at the sheet's `BOF` first.
 */
export async function readSheetPrefix(
  stream: BiffRecordStreamV1,
  sheet: BiffSheetEntryV1,
  version: BiffVersionV1,
): Promise<SheetPrefixV1> {
  await stream.skipTo(sheet.offset);
  const bof = await stream.next();
  if (bof === null || bof.type !== RT.BOF) malformed();
  if (sheet.sheetType === SHEET_TYPE.CHART) return { sheetKind: "chartsheet", dimension: { kind: "none" } };
  let sheetKind: SheetKindV1 = "worksheet";
  for (;;) {
    if (stream.position - sheet.offset > SHEET_PREFIX_MAX_BYTES) malformed();
    const type = await stream.peekType();
    if (type === null) throw new BoundExceededError("truncated-container");
    if (CELL_RECORD_TYPES.has(type) || type === RT.ROW || type === RT.EOF || type === RT.BOF) {
      return { sheetKind, dimension: { kind: "none" } };
    }
    const record = (await stream.next()) ?? malformed();
    if (type === RT.WSBOOL && ((record.body[0] ?? 0) & WSBOOL_DIALOG) !== 0) sheetKind = "dialogsheet";
    if (type === RT.DIMENSIONS) return { sheetKind, dimension: dimensionOf(record.body, version) };
  }
}

/** Each sheet's substream length: up to the next sheet's `BOF`, or the stream's end. */
const substreamSizes = (sheets: readonly BiffSheetEntryV1[], streamSize: number): Map<number, number> => {
  const byOffset = [...sheets].sort((left, right) => left.offset - right.offset);
  return new Map(
    byOffset.map((sheet, index) => [sheet.sheetIndex, (byOffset[index + 1]?.offset ?? streamSize) - sheet.offset]),
  );
};

async function readInventory(container: ContainerHandleV1): Promise<InventoryOutcomeV1> {
  if (container.kind !== "cfb") {
    return { kind: "unreadable", detail: "unrecognized-content" };
  }
  const cfb = container.cfb;
  try {
    const storageSignal = storageMacroSignal(cfb);
    if (storageSignal !== null) return { kind: "macro", signal: storageSignal };

    const { globals, stream } = await readBiffGlobals(cfb, { withCellData: false });
    try {
      if (globals.isEncrypted) return { kind: "unreadable", detail: "encrypted-workbook" };
      if (globals.macro !== null) return { kind: "macro", signal: globals.macro };

      const sizes = substreamSizes(globals.sheets, globals.streamSize);
      const items = new Map<number, SheetInventoryItemV1>();
      for (const sheet of [...globals.sheets].sort((left, right) => left.offset - right.offset)) {
        const prefix = await readSheetPrefix(stream, sheet, globals.version);
        const counts = emptyCounts();
        let declaredRange: RangeV1 | null = null;
        let estimatedRowCount: number | null = null;
        let estimatedCellCount: number | null = null;
        if (prefix.sheetKind === "chartsheet") {
          counts.chart = 1;
        } else {
          const sizeBound = Math.floor((sizes.get(sheet.sheetIndex) ?? 0) / MIN_CELL_RECORD_BYTES);
          const dimension = prefix.dimension;
          if (dimension.kind === "range") {
            const { firstRow, lastRow, firstColumn, lastColumn } = dimension.range;
            declaredRange = dimension.range;
            estimatedCellCount = Math.min((lastRow - firstRow + 1) * (lastColumn - firstColumn + 1), sizeBound);
            estimatedRowCount = Math.min(lastRow - firstRow + 1, estimatedCellCount);
          } else if (dimension.kind === "empty") {
            estimatedRowCount = 0;
            estimatedCellCount = 0;
          } else {
            estimatedCellCount = sizeBound;
          }
        }
        items.set(sheet.sheetIndex, {
          sheetIndex: sheet.sheetIndex,
          name: sheet.name,
          kind: prefix.sheetKind,
          visibility: visibilityOf(sheet.hiddenState),
          declaredRange,
          declaredTables: [],
          estimatedRowCount,
          estimatedCellCount,
          preservedPartCounts: counts,
        });
      }
      const workbookCounts = emptyCounts();
      workbookCounts["external-link"] = globals.supbooks.filter((book) => book.kind === "external").length;
      workbookCounts["data-connection"] = globals.dataConnectionCount;
      return {
        kind: "inventory",
        inventory: {
          format: "xls",
          sheets: globals.sheets.map((sheet) => items.get(sheet.sheetIndex) as SheetInventoryItemV1),
          sheetListKnown: true,
          definedNames: definedNamesOf(globals),
          dateSystem: globals.is1904 ? "1904" : "1900",
          preservedPartCounts: workbookCounts,
        },
      };
    } finally {
      await stream.close();
    }
  } catch (cause) {
    if (isBoundExceeded(cause)) return { kind: "unreadable", detail: cause.detail };
    throw cause;
  }
}

/** The BIFF (`.xls`) inventory reader the import worker registers (D35). */
export const readBiffInventory: InventoryReaderV1 = Object.freeze({
  format: "xls",
  readInventory,
});
