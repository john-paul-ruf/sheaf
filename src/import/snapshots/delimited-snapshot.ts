/**
 * The normalized read-only value grid of an imported sheet (M22; D21; FR-4).
 *
 * A snapshot is **not** the app's data. It is what the sheet looked like, kept
 * so the rows the import discarded — the title lines above the header, the
 * empty rows — stay recoverable and inspectable rather than being silently
 * dropped. F02 stores it; F03's SCR-030/031 renders it.
 *
 * **Normalized text only.** The grid holds strings the parser already decoded
 * and NFC-normalised (D28); there is no workbook HTML, XML, SVG, script, or
 * link anywhere in it, and there could not be — a cell is a `string`, so
 * nothing executable is expressible (invariant 8).
 *
 * Absence is preserved rather than flattened: a row's `cellCount` is the width
 * it actually had, so a consumer can still tell a blank cell inside a row from
 * a cell the short row never had (S03's sparsity contract).
 */

import { CodecError } from "../../domain/model/errors.js";
import {
  decodeCanonical,
  encodeCanonical,
  type CborValue,
} from "../../persistence/codecs/canonical-cbor.js";
import type { WorkbookFactStreamItemV1 } from "../formats/delimited/facts.js";
import {
  asMap,
  cborMap,
  count,
  exactKeys,
  field,
  list,
  text,
} from "../staging/proposal-codec.js";
import {
  decodeChunkRef,
  encodeChunkRef,
  type ManifestChunkRefV1,
} from "./source-chunks.js";

const MANIFEST_VERSION = 1;

/** Rows per snapshot chunk, so one chunk stays far inside the 1 MiB cap. */
export const SNAPSHOT_ROWS_PER_CHUNK = 512;

export interface SnapshotRowV1 {
  readonly rowIndex: number;
  /** The row's true width — the frontier between blank and missing. */
  readonly cellCount: number;
  readonly cells: readonly string[];
}

export interface SnapshotChunkV1 {
  readonly chunkVersion: typeof MANIFEST_VERSION;
  readonly sequence: number;
  readonly rows: readonly SnapshotRowV1[];
}

export interface SnapshotManifestV1 {
  readonly manifestVersion: typeof MANIFEST_VERSION;
  readonly sheetName: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly chunks: readonly ManifestChunkRefV1[];
}

/**
 * Rebuilds the value grid from the fact stream the parser produced. Only
 * `text` and `invalid-preserved` values carry source text; every other kind is
 * a typed value the checkpoint holds, and the grid shows the empty cell it
 * came from rather than inventing a rendering for it.
 */
export function snapshotRowsFromFacts(
  items: Iterable<WorkbookFactStreamItemV1>,
): readonly SnapshotRowV1[] {
  const widths = new Map<number, number>();
  const cells = new Map<number, Map<number, string>>();

  for (const item of items) {
    if (item.kind !== "batch") {
      continue;
    }
    for (const fact of item.facts) {
      if (fact.kind === "row") {
        widths.set(fact.rowIndex, fact.cellCount);
      } else if (fact.kind === "value") {
        const value = fact.value;
        const sourceText =
          value.kind === "text"
            ? value.text
            : value.kind === "invalid-preserved"
              ? value.sourceText
              : null;
        if (sourceText === null) {
          continue;
        }
        const row = cells.get(fact.rowIndex) ?? new Map<number, string>();
        row.set(fact.columnIndex, sourceText);
        cells.set(fact.rowIndex, row);
      }
    }
  }

  return [...widths.entries()]
    .sort(([left], [right]) => left - right)
    .map(([rowIndex, cellCount]) => {
      const row = cells.get(rowIndex) ?? new Map<number, string>();
      return {
        rowIndex,
        cellCount,
        cells: Array.from(
          { length: cellCount },
          (_unused, column) => row.get(column) ?? "",
        ),
      };
    });
}

export function chunkSnapshotRows(
  rows: readonly SnapshotRowV1[],
): readonly SnapshotChunkV1[] {
  const chunks: SnapshotChunkV1[] = [];
  for (let start = 0; start < rows.length; start += SNAPSHOT_ROWS_PER_CHUNK) {
    chunks.push({
      chunkVersion: MANIFEST_VERSION,
      sequence: chunks.length,
      rows: rows.slice(start, start + SNAPSHOT_ROWS_PER_CHUNK),
    });
  }
  // A sheet with no rows still gets one chunk: an imported sheet always has
  // exactly one reachable snapshot (`AppHeadV1.snapshotManifests`), and an
  // empty manifest naming nothing would break that.
  return chunks.length === 0
    ? [{ chunkVersion: MANIFEST_VERSION, sequence: 0, rows: [] }]
    : chunks;
}

const encodeRow = (row: SnapshotRowV1): CborValue =>
  cborMap([
    ["rowIndex", row.rowIndex],
    ["cellCount", row.cellCount],
    ["cells", [...row.cells]],
  ]);

export function encodeSnapshotChunk(chunk: SnapshotChunkV1): Uint8Array {
  return encodeCanonical(
    cborMap([
      ["chunkVersion", chunk.chunkVersion],
      ["sequence", chunk.sequence],
      ["rows", chunk.rows.map(encodeRow)],
    ]),
  );
}

export function decodeSnapshotChunk(payload: Uint8Array): SnapshotChunkV1 {
  const map = exactKeys(
    asMap(decodeCanonical(payload), "a snapshot chunk"),
    ["chunkVersion", "sequence", "rows"],
    "a snapshot chunk",
  );
  if (count(field(map, "chunkVersion"), "a chunk version") !== MANIFEST_VERSION) {
    throw new CodecError("snapshot chunk declares an unsupported version");
  }
  return {
    chunkVersion: MANIFEST_VERSION,
    sequence: count(field(map, "sequence"), "a chunk sequence"),
    rows: list(field(map, "rows"), "snapshot rows").map((value) => {
      const row = exactKeys(
        asMap(value, "a snapshot row"),
        ["rowIndex", "cellCount", "cells"],
        "a snapshot row",
      );
      return {
        rowIndex: count(field(row, "rowIndex"), "a row index"),
        cellCount: count(field(row, "cellCount"), "a cell count"),
        cells: list(field(row, "cells"), "row cells").map((cell) =>
          text(cell, "a snapshot cell"),
        ),
      };
    }),
  };
}

export function encodeSnapshotManifest(manifest: SnapshotManifestV1): Uint8Array {
  return encodeCanonical(
    cborMap([
      ["manifestVersion", manifest.manifestVersion],
      ["sheetName", manifest.sheetName],
      ["rowCount", manifest.rowCount],
      ["columnCount", manifest.columnCount],
      ["chunks", manifest.chunks.map(encodeChunkRef)],
    ]),
  );
}

export function decodeSnapshotManifest(payload: Uint8Array): SnapshotManifestV1 {
  const map = exactKeys(
    asMap(decodeCanonical(payload), "a snapshot manifest"),
    ["manifestVersion", "sheetName", "rowCount", "columnCount", "chunks"],
    "a snapshot manifest",
  );
  if (
    count(field(map, "manifestVersion"), "a manifest version") !== MANIFEST_VERSION
  ) {
    throw new CodecError("snapshot manifest declares an unsupported version");
  }
  return {
    manifestVersion: MANIFEST_VERSION,
    sheetName: text(field(map, "sheetName"), "a sheet name"),
    rowCount: count(field(map, "rowCount"), "a row count"),
    columnCount: count(field(map, "columnCount"), "a column count"),
    chunks: list(field(map, "chunks"), "manifest chunks").map(decodeChunkRef),
  };
}
