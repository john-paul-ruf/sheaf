/**
 * The parts an XLSB sheet declares beside its cells (M16): table parts
 * (binary), drawing parts (DrawingML XML, as in XLSX) and comment parts
 * (binary). The inventory reader counts them and the adapter turns them into
 * facts through the same functions, so the two cannot disagree. Nothing here
 * is rendered, run or fetched (FR-9, invariant 8). The workbook-level
 * `styles.bin` and `sharedStrings.bin` are read here too, for the adapter
 * only: pre-flight never opens either.
 */

import { CONTAINER_BOUNDS_V1, isBoundExceeded } from "../../source/bounds.js";
import { partEvents, readRelationships } from "../../source/opc.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import {
  BUILTIN_NUMBER_FORMATS,
  classifyNumberFormat,
  type FormatClassV1,
  type RangeV1,
} from "../../facts/index.js";
import { BodyReaderV1, BRT, gridRange, openXlsbRecords } from "./records.js";

export interface XlsbTableV1 {
  readonly name: string;
  readonly range: RangeV1;
  readonly headerRowCount: number;
  readonly totalsRowCount: number;
  readonly columns: readonly string[];
}

/** Every record of a small binary part, in order. */
async function* partRecords(zip: ZipContainerHandleV1, partName: string) {
  const records = openXlsbRecords(zip.streamEntry(partName));
  try {
    for (let record = await records.next(); record !== null; record = await records.next()) {
      yield record;
    }
  } finally {
    await records.close();
  }
}

/** A table part: `BrtBeginList` then one `BrtBeginListCol` per column. */
export async function readTablePart(zip: ZipContainerHandleV1, partName: string): Promise<XlsbTableV1 | null> {
  let table: { name: string; range: RangeV1; headerRowCount: number; totalsRowCount: number; columns: string[] } | null = null;
  for await (const record of partRecords(zip, partName)) {
    const reader = new BodyReaderV1(record.body);
    if (record.type === BRT.BEGIN_LIST) {
      const range = gridRange(reader.rfx());
      reader.u32();
      reader.u32();
      const headerRowCount = reader.u32();
      const totalsRowCount = reader.u32();
      reader.skip(8 * 4);
      const name = reader.nullableWide();
      const displayName = reader.wide();
      table = { name: (displayName === "" ? (name ?? "") : displayName).normalize("NFC"), range, headerRowCount, totalsRowCount, columns: [] };
    } else if (record.type === BRT.BEGIN_LIST_COL && table !== null) {
      reader.skip(6 * 4);
      table.columns.push((reader.nullableWide() ?? "").normalize("NFC"));
    }
  }
  return table;
}

export interface DrawingObjectV1 {
  readonly partKind: "chart" | "image" | "drawing";
  readonly anchor: RangeV1 | null;
  readonly partPath: string | null;
}

const DRAWING_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
  "http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing",
]);
const CHART_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/drawingml/2006/chart",
  "http://purl.oclc.org/ooxml/drawingml/chart",
]);
const RELATIONSHIP_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);
const ANCHORS = new Set(["twoCellAnchor", "oneCellAnchor", "absoluteAnchor"]);

const inGrid = (at: { row: number; column: number }): boolean =>
  at.row >= 0 && at.row < CONTAINER_BOUNDS_V1.maxRow && at.column >= 0 && at.column < CONTAINER_BOUNDS_V1.maxColumn;

/** Every anchored object in a DrawingML part, in document order. */
export async function readDrawingObjects(zip: ZipContainerHandleV1, drawingPart: string): Promise<DrawingObjectV1[]> {
  const relationships = new Map((await readRelationships(zip, drawingPart)).map((each) => [each.id, each]));
  const target = (id: string | null): string | null => {
    const relationship = id === null ? undefined : relationships.get(id);
    return relationship === undefined || relationship.isExternal ? null : relationship.target;
  };
  const objects: DrawingObjectV1[] = [];
  let depth = 0;
  let anchorDepth: number | null = null;
  let marker: "from" | "to" | null = null;
  let field: "col" | "row" | null = null;
  let current = { row: -1, column: -1 };
  let from: typeof current | null = null;
  let to: typeof current | null = null;
  let kind: DrawingObjectV1["partKind"] | null = null;
  let partPath: string | null = null;

  for await (const event of partEvents(zip, drawingPart)) {
    if (event.kind === "start") {
      depth += 1;
      const isDrawing = DRAWING_NAMESPACES.has(event.uri);
      if (anchorDepth === null) {
        if (isDrawing && ANCHORS.has(event.local)) {
          anchorDepth = depth;
          from = to = null;
          kind = null;
          partPath = null;
        }
        continue;
      }
      if (isDrawing && depth === anchorDepth + 1 && (event.local === "from" || event.local === "to")) {
        marker = event.local;
        current = { row: -1, column: -1 };
      } else if (marker !== null && isDrawing && (event.local === "col" || event.local === "row")) {
        field = event.local;
      } else if (kind === null && isDrawing && depth === anchorDepth + 1) {
        kind = event.local === "pic" ? "image" : ["graphicFrame", "sp", "grpSp", "cxnSp", "contentPart"].includes(event.local) ? "drawing" : null;
      } else if (kind === "image" && event.local === "blip" && partPath === null) {
        partPath = target(event.attributes.find((each) => each.local === "embed" && RELATIONSHIP_NAMESPACES.has(each.uri))?.value ?? null);
      } else if (CHART_NAMESPACES.has(event.uri) && event.local === "chart") {
        kind = "chart";
        partPath = target(event.attributes.find((each) => each.local === "id" && RELATIONSHIP_NAMESPACES.has(each.uri))?.value ?? null);
      }
    } else if (event.kind === "text") {
      if (field !== null && /^\s*\d+\s*$/.test(event.value)) {
        current = { ...current, [field === "col" ? "column" : "row"]: Number(event.value) };
      }
    } else {
      if (field !== null && (event.local === "col" || event.local === "row")) {
        field = null;
      } else if (marker !== null && depth === (anchorDepth ?? 0) + 1 && event.local === marker) {
        if (marker === "from") from = current;
        else to = current;
        marker = null;
      } else if (depth === anchorDepth) {
        if (kind !== null) {
          const end = to ?? from;
          const anchor =
            from !== null && end !== null && inGrid(from) && inGrid(end)
              ? {
                  firstRow: Math.min(from.row, end.row),
                  firstColumn: Math.min(from.column, end.column),
                  lastRow: Math.max(from.row, end.row),
                  lastColumn: Math.max(from.column, end.column),
                }
              : null;
          objects.push({ partKind: kind, anchor, partPath });
        }
        anchorDepth = null;
      }
      depth -= 1;
    }
  }
  return objects;
}

/** The cell each comment of a binary comments part is attached to (`BrtBeginComment`). */
export async function readCommentAnchors(zip: ZipContainerHandleV1, commentsPart: string): Promise<(RangeV1 | null)[]> {
  const anchors: (RangeV1 | null)[] = [];
  for await (const record of partRecords(zip, commentsPart)) {
    if (record.type !== BRT.BEGIN_COMMENT) continue;
    try {
      anchors.push(gridRange(new BodyReaderV1(record.body).rfx()));
    } catch (cause) {
      if (!isBoundExceeded(cause)) throw cause;
      anchors.push(null);
    }
  }
  return anchors;
}


export interface CellStyleV1 {
  readonly numberFormat: string;
  readonly formatClass: FormatClassV1;
  readonly currencySymbol: string | null;
  readonly isVisuallyStyled: boolean;
}

export const DEFAULT_CELL_STYLE: CellStyleV1 = Object.freeze({
  numberFormat: "General",
  formatClass: "general",
  currencySymbol: null,
  isVisuallyStyled: false,
});

/**
 * Every cell XF of `styles.bin` in order (index = a cell's style), reduced to
 * its number format and whether it is visually styled (a non-default font,
 * fill or border), exactly as the OOXML adapter reduces `cellXfs`.
 */
export async function readCellStyles(zip: ZipContainerHandleV1, partName: string | null): Promise<readonly CellStyleV1[]> {
  if (partName === null || !zip.has(partName)) return [];
  const custom = new Map<number, string>();
  const xfs: { formatId: number; isVisuallyStyled: boolean }[] = [];
  let inCellXfs = false;
  for await (const record of partRecords(zip, partName)) {
    const reader = new BodyReaderV1(record.body);
    if (record.type === BRT.FMT) {
      const id = reader.u16();
      custom.set(id, reader.wide().normalize("NFC"));
    } else if (record.type === BRT.BEGIN_CELL_XFS) {
      inCellXfs = true;
    } else if (record.type === BRT.END_CELL_XFS) {
      inCellXfs = false;
    } else if (record.type === BRT.XF && inCellXfs) {
      reader.u16();
      const formatId = reader.u16();
      const font = reader.u16();
      const fill = reader.u16();
      const border = reader.u16();
      xfs.push({ formatId, isVisuallyStyled: font !== 0 || fill !== 0 || border !== 0 });
    }
  }
  return xfs.map(({ formatId, isVisuallyStyled }) => {
    const code = custom.get(formatId);
    if (code !== undefined) return { numberFormat: code, ...classifyNumberFormat(code), isVisuallyStyled };
    const builtin = BUILTIN_NUMBER_FORMATS.get(formatId);
    return builtin === undefined
      ? { ...DEFAULT_CELL_STYLE, isVisuallyStyled }
      : { numberFormat: builtin.code, formatClass: builtin.formatClass, currencySymbol: builtin.currencySymbol, isVisuallyStyled };
  });
}

/** `sharedStrings.bin`: each `BrtSSTItem`'s text, in order; rich runs and phonetics ignored. */
export async function readSharedStrings(zip: ZipContainerHandleV1, partName: string | null): Promise<readonly string[]> {
  if (partName === null || !zip.has(partName)) return [];
  const strings: string[] = [];
  for await (const record of partRecords(zip, partName)) {
    if (record.type !== BRT.SST_ITEM) continue;
    const reader = new BodyReaderV1(record.body);
    reader.u8();
    strings.push(reader.wide());
  }
  return strings;
}
