/**
 * Drawing and comment parts, read as inert inventory (M15; FR-9, D40).
 *
 * A drawing part lists anchored objects — shapes, pictures, chart frames —
 * each covering a range of cells. Sheaf never renders, runs, or fetches any of
 * them: it records what kind of object sits where, and which part holds it, so
 * the review and the snapshot can say so. Both the inventory reader (counts)
 * and the sheet parser (preserved-part facts) read them through here, so the
 * two cannot disagree.
 */

import { CONTAINER_BOUNDS_V1 } from "../../source/bounds.js";
import { partEvents, readRelationships } from "../../source/opc.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import type { RangeV1 } from "../../facts/index.js";
import {
  CHART_NAMESPACES,
  DRAWING_NAMESPACES,
  isSheetElement,
  parseRange,
  relationshipAttribute,
} from "./parts.js";

export interface DrawingObjectV1 {
  readonly partKind: "chart" | "image" | "drawing";
  readonly anchor: RangeV1 | null;
  /** The chart or image part, when the object has one. */
  readonly partPath: string | null;
}

const ANCHORS = new Set(["twoCellAnchor", "oneCellAnchor", "absoluteAnchor"]);
const SHAPES = new Set(["sp", "grpSp", "cxnSp", "contentPart"]);

const markerRange = (
  from: { row: number; column: number } | null,
  to: { row: number; column: number } | null,
): RangeV1 | null => {
  const end = to ?? from;
  if (from === null || end === null) return null;
  const inGrid = (at: { row: number; column: number }) =>
    at.row >= 0 && at.row < CONTAINER_BOUNDS_V1.maxRow && at.column >= 0 && at.column < CONTAINER_BOUNDS_V1.maxColumn;
  if (!inGrid(from) || !inGrid(end)) return null;
  return {
    firstRow: Math.min(from.row, end.row),
    firstColumn: Math.min(from.column, end.column),
    lastRow: Math.max(from.row, end.row),
    lastColumn: Math.max(from.column, end.column),
  };
};

/** Every anchored object in one drawing part, in document order. */
export async function readDrawingObjects(
  zip: ZipContainerHandleV1,
  drawingPart: string,
): Promise<DrawingObjectV1[]> {
  const relationships = new Map(
    (await readRelationships(zip, drawingPart)).map((relationship) => [relationship.id, relationship]),
  );
  const internalTarget = (id: string | null): string | null => {
    const relationship = id === null ? undefined : relationships.get(id);
    return relationship === undefined || relationship.isExternal ? null : relationship.target;
  };

  const objects: DrawingObjectV1[] = [];
  let depth = 0;
  let anchorDepth: number | null = null;
  let marker: "from" | "to" | null = null;
  let field: "col" | "row" | null = null;
  let current: { row: number; column: number } = { row: -1, column: -1 };
  let from: { row: number; column: number } | null = null;
  let to: { row: number; column: number } | null = null;
  let kind: DrawingObjectV1["partKind"] | null = null;
  let partPath: string | null = null;

  for await (const event of partEvents(zip, drawingPart)) {
    if (event.kind === "start") {
      depth += 1;
      const isDrawing = DRAWING_NAMESPACES.has(event.uri);
      if (anchorDepth === null) {
        if (isDrawing && ANCHORS.has(event.local)) {
          anchorDepth = depth;
          from = null;
          to = null;
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
        if (event.local === "pic") kind = "image";
        else if (event.local === "graphicFrame") kind = "drawing";
        else if (SHAPES.has(event.local)) kind = "drawing";
      } else if (kind === "image" && event.local === "blip" && partPath === null) {
        partPath = internalTarget(relationshipAttribute(event, "embed"));
      } else if (CHART_NAMESPACES.has(event.uri) && event.local === "chart") {
        kind = "chart";
        partPath = internalTarget(relationshipAttribute(event));
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
          objects.push({ partKind: kind, anchor: markerRange(from, to), partPath });
        }
        anchorDepth = null;
      }
      depth -= 1;
    }
  }
  return objects;
}

/** The cell each comment is attached to, in document order. */
export async function readCommentAnchors(
  zip: ZipContainerHandleV1,
  commentsPart: string,
): Promise<(RangeV1 | null)[]> {
  const anchors: (RangeV1 | null)[] = [];
  for await (const event of partEvents(zip, commentsPart)) {
    if (event.kind === "start" && event.local === "comment" && isSheetElement(event.uri)) {
      const ref = event.attributes.find((each) => each.local === "ref" && each.uri === "")?.value ?? "";
      anchors.push(parseRange(ref));
    }
  }
  return anchors;
}
