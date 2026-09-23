/**
 * The XLSB inventory reader (M16; CA-18, D35, invariant 8).
 *
 * **Metadata only.** It reads the content types, the package and workbook
 * relationships, `xl/workbook.bin`, table/drawing/comment parts, and — the one
 * read that touches a sheet part — a **prefix** of each worksheet that stops at
 * `BrtWsDim` (or `BrtBeginSheetData`), before any cell record. No cell record,
 * and no byte of `sharedStrings.bin`, is ever read; the spy test in
 * `tests/unit/import/xlsb/inventory.test.ts` proves it for every fixture.
 *
 * **Estimated cells** are `min(declared area, part size / 7)`: 7 bytes is the
 * smallest a populated BIFF12 cell record can be (`BrtShortBool`: a 2-byte
 * header, a 4-byte short cell, one value byte), so the size bound never
 * under-counts a real sheet, while a hostile `BrtWsDim` over a tiny part
 * cannot inflate the estimate.
 *
 * **Macros refuse before anything else is read**: a VBA project, a macro
 * sheet, an ActiveX part or macro-enabled embedding, or a VBA/macro-sheet
 * content type. (Every `.xlsb` main part carries the `macroEnabled` binary
 * content type, so that type alone is not a signal.)
 */

import { BoundExceededError, isBoundExceeded } from "../../source/bounds.js";
import { readContentTypes, readRelationships, relationshipKind, type OpcContentTypesV1, type OpcRelationshipV1 } from "../../source/opc.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import {
  PRESERVED_PART_KINDS,
  type ContainerHandleV1,
  type DeclaredTableSummaryV1,
  type InventoryOutcomeV1,
  type InventoryReaderV1,
  type MacroSignalV1,
  type PreservedPartCountsV1,
  type PreservedPartKindV1,
  type RangeV1,
  type SheetInventoryItemV1,
} from "../../facts/index.js";
import { readCommentAnchors, readDrawingObjects, readTablePart } from "./parts.js";
import { BodyReaderV1, BRT, CELL_RECORD_TYPES, gridRange, openXlsbRecords } from "./records.js";
import { readXlsbWorkbook, type XlsbSheetEntryV1 } from "./workbook.js";

/** The smallest a populated cell's record can be; see the module comment. */
export const MIN_CELL_RECORD_BYTES = 7;

/** A worksheet whose `BrtWsDim` has not come within 1 MiB is malformed. */
export const SHEET_PREFIX_MAX_BYTES = 1_048_576;

const MACRO_CONTENT_TYPES = new Set([
  "application/vnd.ms-office.vbaproject",
  "application/vnd.ms-office.activex",
  "application/vnd.ms-office.activex+xml",
]);
const MACRO_SHEET_CONTENT_TYPES = new Set([
  "application/vnd.ms-excel.macrosheet",
  "application/vnd.ms-excel.intlmacrosheet",
  "application/vnd.ms-excel.macrosheet+xml",
  "application/vnd.ms-excel.intlmacrosheet+xml",
]);
const MACRO_EMBEDDING = /^xl\/embeddings\/.*\.(xlsm|xlsb|xltm|xlam|docm|dotm|pptm|potm|ppsm)$/;

export const emptyCounts = (): Record<PreservedPartKindV1, number> =>
  Object.fromEntries(PRESERVED_PART_KINDS.map((kind) => [kind, 0])) as Record<PreservedPartKindV1, number>;

export function macroSignalOf(zip: ZipContainerHandleV1, contentTypes: OpcContentTypesV1): MacroSignalV1 | null {
  for (const { name } of zip.entries) {
    if (name.toLowerCase().endsWith("vbaproject.bin")) return { kind: "vba-project", partPath: name };
  }
  for (const { name } of zip.entries) {
    const lower = name.toLowerCase();
    if (lower.startsWith("xl/macrosheets/")) return { kind: "xlm-macro-sheet", partPath: name };
    if (lower.startsWith("xl/activex/") || MACRO_EMBEDDING.test(lower)) return { kind: "script-part", partPath: name };
  }
  for (const { target, contentType } of contentTypes.declared) {
    const type = contentType.toLowerCase();
    if (MACRO_SHEET_CONTENT_TYPES.has(type)) return { kind: "xlm-macro-sheet", partPath: target };
    if (MACRO_CONTENT_TYPES.has(type)) return { kind: "macro-content-type", partPath: target };
  }
  return null;
}

/** The declared `BrtWsDim`, read from the part's prefix only. */
export async function readDeclaredDimension(zip: ZipContainerHandleV1, partName: string): Promise<RangeV1 | null> {
  const records = openXlsbRecords(zip.streamEntry(partName));
  try {
    for (;;) {
      if (records.position > SHEET_PREFIX_MAX_BYTES) throw new BoundExceededError("malformed-structure");
      const type = await records.peekType();
      if (type === null || type === BRT.BEGIN_SHEET_DATA || CELL_RECORD_TYPES.has(type)) return null;
      const record = await records.next();
      if (record?.type === BRT.WS_DIM) return gridRange(new BodyReaderV1(record.body).rfx());
    }
  } finally {
    await records.close();
  }
}

/** Counts of the parts a sheet's relationships declare (not its body). */
async function sheetPartCounts(
  zip: ZipContainerHandleV1,
  relationships: readonly OpcRelationshipV1[],
): Promise<{ counts: Record<PreservedPartKindV1, number>; tables: DeclaredTableSummaryV1[] }> {
  const counts = emptyCounts();
  const tables: DeclaredTableSummaryV1[] = [];
  for (const relationship of relationships) {
    const kind = relationshipKind(relationship.type);
    if (relationship.isExternal) {
      if (kind === "hyperlink") counts.hyperlink += 1;
      continue;
    }
    if (!zip.has(relationship.target)) continue;
    switch (kind) {
      case "table": {
        const table = await readTablePart(zip, relationship.target);
        if (table !== null) tables.push({ name: table.name, range: table.range });
        break;
      }
      case "drawing":
        for (const object of await readDrawingObjects(zip, relationship.target)) counts[object.partKind] += 1;
        break;
      case "comments":
        counts.comment += (await readCommentAnchors(zip, relationship.target)).length;
        break;
      case "pivottable":
        counts["pivot-table"] += 1;
        break;
      case "oleobject":
      case "package":
        counts["embedded-object"] += 1;
        break;
      case "ctrlprop":
        counts["form-control"] += 1;
        break;
    }
  }
  return { counts, tables };
}

async function sheetInventory(zip: ZipContainerHandleV1, sheet: XlsbSheetEntryV1): Promise<SheetInventoryItemV1> {
  const { counts, tables } = await sheetPartCounts(zip, await readRelationships(zip, sheet.partName));
  let declaredRange: RangeV1 | null = null;
  let estimatedCellCount: number | null = null;
  let estimatedRowCount: number | null = null;
  if (sheet.kind === "chartsheet") {
    counts.chart = Math.max(counts.chart, 1);
  } else {
    declaredRange = await readDeclaredDimension(zip, sheet.partName);
    const sizeBound = Math.floor((zip.entry(sheet.partName)?.declaredUncompressedSize ?? 0) / MIN_CELL_RECORD_BYTES);
    if (declaredRange === null) {
      estimatedCellCount = sizeBound;
    } else {
      const { firstRow, lastRow, firstColumn, lastColumn } = declaredRange;
      estimatedCellCount = Math.min((lastRow - firstRow + 1) * (lastColumn - firstColumn + 1), sizeBound);
      estimatedRowCount = Math.min(lastRow - firstRow + 1, estimatedCellCount);
    }
  }
  return {
    sheetIndex: sheet.sheetIndex,
    name: sheet.name,
    kind: sheet.kind,
    visibility: sheet.visibility,
    declaredRange,
    declaredTables: tables,
    estimatedRowCount,
    estimatedCellCount,
    preservedPartCounts: counts,
  };
}

export const workbookCounts = (relationships: readonly OpcRelationshipV1[]): PreservedPartCountsV1 => {
  const counts = emptyCounts();
  for (const relationship of relationships) {
    const kind = relationshipKind(relationship.type);
    if (kind === "externallink") counts["external-link"] += 1;
    if (kind === "connections") counts["data-connection"] += 1;
  }
  return counts;
};

async function readInventory(container: ContainerHandleV1): Promise<InventoryOutcomeV1> {
  if (container.kind !== "zip") {
    return { kind: "unreadable", detail: "unrecognized-content" };
  }
  const zip = container.zip;
  try {
    const signal = macroSignalOf(zip, await readContentTypes(zip));
    if (signal !== null) return { kind: "macro", signal };
    const workbook = await readXlsbWorkbook(zip);
    if (workbook.macroSheet !== null) return { kind: "macro", signal: workbook.macroSheet };
    const sheets: SheetInventoryItemV1[] = [];
    for (const sheet of workbook.sheets) sheets.push(await sheetInventory(zip, sheet));
    return {
      kind: "inventory",
      inventory: {
        format: "xlsb",
        sheets,
        sheetListKnown: true,
        definedNames: [],
        dateSystem: workbook.is1904 ? "1904" : "1900",
        preservedPartCounts: workbookCounts(workbook.relationships),
      },
    };
  } catch (cause) {
    if (isBoundExceeded(cause)) return { kind: "unreadable", detail: cause.detail };
    throw cause;
  }
}

/** The XLSB inventory reader the import worker registers (D35). */
export const readXlsbInventory: InventoryReaderV1 = Object.freeze({
  format: "xlsb",
  readInventory,
});
