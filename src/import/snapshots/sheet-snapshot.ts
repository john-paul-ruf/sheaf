/**
 * The normalized sheet snapshot, format v2 (M22; CA-22, D41).
 *
 * A snapshot is what a sheet looked like, kept read-only so nothing an import
 * interpreted — or declined to — is lost: discarded rows, cells outside any
 * table, merged regions, and the anchors of the inert content the app lists.
 * It is **not** the app's data, and it is **only text**: every cell is a
 * rendered string plus a closed kind, so no workbook markup, script, link, or
 * image is expressible in it (invariant 8). F02's delimited value grid
 * (`delimited-snapshot.ts`, format v1) stays readable beside it: the reader
 * below presents both as the same page shape.
 *
 * **Chunks are row ranges.** Each chunk holds a sorted, sparse run of rows and
 * is at most {@link SNAPSHOT_CHUNK_MAX_DECODED_BYTES} decoded (database.md §
 * Checkpoint and page boundaries). The manifest records every chunk's first
 * and last row beside its reference — a refinement of the plain chunk
 * reference, so a page read opens exactly the chunks it needs and nothing
 * else.
 *
 * **Number formats are a bounded subset (D41).** {@link formatForSnapshot}
 * renders General, fixed decimals, thousands separators, currency symbols,
 * percent, and common date/time codes. Any other code renders the canonical
 * value text and claims no format fidelity.
 */

import { CodecError } from "../../domain/model/errors.js";
import type { InertItemId, SheetId } from "../../domain/model/ids.js";
import {
  SHEET_CLASSIFICATIONS,
  type CellRangeV1,
  type SheetClassificationV1,
} from "../../domain/model/snapshots.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import {
  decodeCanonical,
  encodeCanonical,
  type CborValue,
  type DecodedKey,
  type DecodedValue,
} from "../../persistence/codecs/canonical-cbor.js";
import { decodeCellRange, encodeCellRange } from "../staging/roots.js";
import {
  asMap,
  bytesOfLength,
  cborMap,
  count,
  exactKeys,
  field,
  list,
  nfcText,
  oneOf,
} from "../staging/proposal-codec.js";
import { decodeSnapshotChunk, decodeSnapshotManifest } from "./delimited-snapshot.js";
import {
  decodeChunkRef,
  encodeChunkRef,
  type ManifestChunkRefV1,
} from "./source-chunks.js";

const MANIFEST_VERSION = 2;
const ID_BYTES = 16;

/** database.md: a normalized snapshot chunk carries at most 1 MiB decoded. */
export const SNAPSHOT_CHUNK_MAX_DECODED_BYTES = 1_048_576;

/** F02's delimited snapshots hold this many rows per chunk (format v1). */
const V1_ROWS_PER_CHUNK = 512;

/** How a cell's text was produced; the viewer styles by it, nothing else. */
export const SNAPSHOT_CELL_KINDS = Object.freeze([
  "text",
  "number",
  "date",
  "boolean",
  "error",
  "formula-result",
] as const);

export type SnapshotCellKindV1 = (typeof SNAPSHOT_CELL_KINDS)[number];

/** Why a row stayed out of every table; M21's discard reasons, restated. */
export const SNAPSHOT_DISCARD_REASONS = Object.freeze([
  "above-header",
  "empty-row",
] as const);

export type SnapshotDiscardReasonV1 = (typeof SNAPSHOT_DISCARD_REASONS)[number];

export interface SnapshotCellV2 {
  readonly columnIndex: number;
  /** Rendered display text — never markup. */
  readonly text: string;
  readonly kind: SnapshotCellKindV1;
}

export interface SnapshotRowV2 {
  readonly rowIndex: number;
  /** Sparse and sorted by column: an absent cell is empty. */
  readonly cells: readonly SnapshotCellV2[];
}

export interface SheetSnapshotChunkV2 {
  readonly chunkVersion: typeof MANIFEST_VERSION;
  readonly firstRow: number;
  /** Sorted by row, sparse, every row at or after `firstRow`. */
  readonly rows: readonly SnapshotRowV2[];
}

/** A chunk reference plus the rows it covers, inclusive. */
export interface SheetSnapshotChunkRefV2 extends ManifestChunkRefV1 {
  readonly firstRow: number;
  readonly lastRow: number;
}

export interface SheetSnapshotManifestV2 {
  readonly manifestVersion: typeof MANIFEST_VERSION;
  readonly sheetId: SheetId;
  readonly sheetOrdinal: number;
  readonly displayName: string;
  readonly classification: readonly SheetClassificationV1[];
  readonly rowCount: number;
  readonly columnCount: number;
  readonly chunks: readonly SheetSnapshotChunkRefV2[];
  readonly merges: readonly CellRangeV1[];
  readonly inertAnchors: readonly {
    readonly inertItemId: InertItemId;
    readonly range: CellRangeV1;
  }[];
  readonly discardedRows: readonly {
    readonly rowIndex: number;
    readonly reason: SnapshotDiscardReasonV1;
  }[];
}

// ------------------------------------------------------------------- codecs --

const encodeRow = (row: SnapshotRowV2): CborValue =>
  cborMap([
    ["rowIndex", row.rowIndex],
    [
      "cells",
      row.cells.map((cell) =>
        cborMap([
          ["columnIndex", cell.columnIndex],
          ["text", cell.text],
          ["kind", cell.kind],
        ]),
      ),
    ],
  ]);

const assertAscending = (indexes: readonly number[], floor: number, what: string): void => {
  let previous = floor - 1;
  for (const index of indexes) {
    if (index <= previous) {
      throw new CodecError(`${what} are not strictly ascending`);
    }
    previous = index;
  }
};

/** Refuses an unsorted chunk or one over the 1 MiB decoded cap. */
export function encodeSheetSnapshotChunk(chunk: SheetSnapshotChunkV2): Uint8Array {
  assertAscending(chunk.rows.map((row) => row.rowIndex), chunk.firstRow, "snapshot rows");
  for (const row of chunk.rows) {
    assertAscending(row.cells.map((cell) => cell.columnIndex), 0, "snapshot cells");
  }
  const bytes = encodeCanonical(
    cborMap([
      ["chunkVersion", chunk.chunkVersion],
      ["firstRow", chunk.firstRow],
      ["rows", chunk.rows.map(encodeRow)],
    ]),
  );
  if (bytes.byteLength > SNAPSHOT_CHUNK_MAX_DECODED_BYTES) {
    throw new CodecError("a snapshot chunk exceeds the 1 MiB decoded cap");
  }
  return bytes;
}

export function decodeSheetSnapshotChunk(payload: Uint8Array): SheetSnapshotChunkV2 {
  if (payload.byteLength > SNAPSHOT_CHUNK_MAX_DECODED_BYTES) {
    throw new CodecError("a snapshot chunk exceeds the 1 MiB decoded cap");
  }
  const map = exactKeys(
    asMap(decodeCanonical(payload), "a snapshot chunk"),
    ["chunkVersion", "firstRow", "rows"],
    "a snapshot chunk",
  );
  if (count(field(map, "chunkVersion"), "a chunk version") !== MANIFEST_VERSION) {
    throw new CodecError("snapshot chunk declares an unsupported version");
  }
  const firstRow = count(field(map, "firstRow"), "a first row");
  const rows = list(field(map, "rows"), "snapshot rows").map((value): SnapshotRowV2 => {
    const row = exactKeys(asMap(value, "a snapshot row"), ["rowIndex", "cells"], "a snapshot row");
    const cells = list(field(row, "cells"), "snapshot cells").map((entry): SnapshotCellV2 => {
      const cell = exactKeys(
        asMap(entry, "a snapshot cell"),
        ["columnIndex", "text", "kind"],
        "a snapshot cell",
      );
      return {
        columnIndex: count(field(cell, "columnIndex"), "a column index"),
        text: nfcText(field(cell, "text"), "snapshot cell text"),
        kind: oneOf(field(cell, "kind"), SNAPSHOT_CELL_KINDS, "a snapshot cell kind"),
      };
    });
    assertAscending(cells.map((cell) => cell.columnIndex), 0, "snapshot cells");
    return { rowIndex: count(field(row, "rowIndex"), "a row index"), cells };
  });
  assertAscending(rows.map((row) => row.rowIndex), firstRow, "snapshot rows");
  return { chunkVersion: MANIFEST_VERSION, firstRow, rows };
}

export function encodeSheetSnapshotManifest(manifest: SheetSnapshotManifestV2): Uint8Array {
  return encodeCanonical(
    cborMap([
      ["manifestVersion", manifest.manifestVersion],
      ["sheetId", manifest.sheetId],
      ["sheetOrdinal", manifest.sheetOrdinal],
      ["displayName", manifest.displayName],
      ["classification", [...manifest.classification]],
      ["rowCount", manifest.rowCount],
      ["columnCount", manifest.columnCount],
      [
        "chunks",
        manifest.chunks.map((chunk) =>
          cborMap([
            ["ref", encodeChunkRef(chunk)],
            ["firstRow", chunk.firstRow],
            ["lastRow", chunk.lastRow],
          ]),
        ),
      ],
      ["merges", manifest.merges.map(encodeCellRange)],
      [
        "inertAnchors",
        manifest.inertAnchors.map((anchor) =>
          cborMap([
            ["inertItemId", anchor.inertItemId],
            ["range", encodeCellRange(anchor.range)],
          ]),
        ),
      ],
      [
        "discardedRows",
        manifest.discardedRows.map((row) =>
          cborMap([
            ["rowIndex", row.rowIndex],
            ["reason", row.reason],
          ]),
        ),
      ],
    ]),
  );
}

const MANIFEST_V2_KEYS = [
  "manifestVersion",
  "sheetId",
  "sheetOrdinal",
  "displayName",
  "classification",
  "rowCount",
  "columnCount",
  "chunks",
  "merges",
  "inertAnchors",
  "discardedRows",
];

function decodeManifestV2(map: ReadonlyMap<DecodedKey, DecodedValue>): SheetSnapshotManifestV2 {
  exactKeys(map, MANIFEST_V2_KEYS, "a sheet snapshot manifest");
  const classification = list(field(map, "classification"), "a classification").map((role) =>
    oneOf(role, SHEET_CLASSIFICATIONS, "a sheet role"),
  );
  if (classification.length === 0) {
    throw new CodecError("a sheet snapshot names no role");
  }
  const chunks = list(field(map, "chunks"), "snapshot chunks").map((value) => {
    const entry = exactKeys(
      asMap(value, "a snapshot chunk ref"),
      ["ref", "firstRow", "lastRow"],
      "a snapshot chunk ref",
    );
    const firstRow = count(field(entry, "firstRow"), "a first row");
    const lastRow = count(field(entry, "lastRow"), "a last row");
    if (lastRow < firstRow) {
      throw new CodecError("a snapshot chunk ends before it starts");
    }
    return { ...decodeChunkRef(field(entry, "ref")), firstRow, lastRow };
  });
  chunks.forEach((chunk, index) => {
    const previous = chunks[index - 1];
    if (previous !== undefined && chunk.firstRow <= previous.lastRow) {
      throw new CodecError("snapshot chunks overlap or are out of order");
    }
  });
  return {
    manifestVersion: MANIFEST_VERSION,
    sheetId: bytesOfLength(field(map, "sheetId"), ID_BYTES, "a sheet id") as SheetId,
    sheetOrdinal: count(field(map, "sheetOrdinal"), "a sheet ordinal"),
    displayName: nfcText(field(map, "displayName"), "a sheet name"),
    classification,
    rowCount: count(field(map, "rowCount"), "a row count"),
    columnCount: count(field(map, "columnCount"), "a column count"),
    chunks,
    merges: list(field(map, "merges"), "merges").map(decodeCellRange),
    inertAnchors: list(field(map, "inertAnchors"), "inert anchors").map((value) => {
      const anchor = exactKeys(
        asMap(value, "an inert anchor"),
        ["inertItemId", "range"],
        "an inert anchor",
      );
      return {
        inertItemId: bytesOfLength(
          field(anchor, "inertItemId"),
          ID_BYTES,
          "an inert item id",
        ) as InertItemId,
        range: decodeCellRange(field(anchor, "range")),
      };
    }),
    discardedRows: list(field(map, "discardedRows"), "discarded rows").map((value) => {
      const row = exactKeys(asMap(value, "a discarded row"), ["rowIndex", "reason"], "a discarded row");
      return {
        rowIndex: count(field(row, "rowIndex"), "a row index"),
        reason: oneOf(field(row, "reason"), SNAPSHOT_DISCARD_REASONS, "a discard reason"),
      };
    }),
  };
}

export function decodeSheetSnapshotManifest(payload: Uint8Array): SheetSnapshotManifestV2 {
  return decodeManifestV2(asMap(decodeCanonical(payload), "a sheet snapshot manifest"));
}

// ------------------------------------------------------- one page, both formats --

/** The page shape a viewer reads, whichever format wrote the sheet. */
export interface SnapshotPageV1 {
  readonly format: "sheet-v2" | "delimited-v1";
  readonly displayName: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly firstRow: number;
  /** The rows in `[firstRow, firstRow + rowCount)` that hold anything. */
  readonly rows: readonly SnapshotRowV2[];
  /** Merges and anchors that intersect the page. */
  readonly merges: readonly CellRangeV1[];
  readonly inertAnchors: SheetSnapshotManifestV2["inertAnchors"];
  /**
   * Discarded rows inside the page. A delimited (F02) snapshot records no
   * discard markers, so its discarded rows are present as rows but unmarked.
   */
  readonly discardedRows: SheetSnapshotManifestV2["discardedRows"];
}

/** Loads one chunk's decrypted payload; the caller verifies its digest. */
export type SnapshotChunkLoader = (ref: ManifestChunkRefV1) => Promise<Uint8Array>;

/** The largest page a reader serves; a viewer pages rather than asks for all. */
export const MAX_SNAPSHOT_PAGE_ROWS = 1_000;

interface OpenedSnapshot {
  readonly format: SnapshotPageV1["format"];
  readonly displayName: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly chunks: readonly SheetSnapshotChunkRefV2[];
  readonly merges: readonly CellRangeV1[];
  readonly inertAnchors: SheetSnapshotManifestV2["inertAnchors"];
  readonly discardedRows: SheetSnapshotManifestV2["discardedRows"];
  readonly rowsOf: (payload: Uint8Array) => readonly SnapshotRowV2[];
}

/**
 * Opens either format. F02's v1 manifest names no row ranges, but its writer
 * put exactly 512 consecutive rows in each chunk from row zero, so the ranges
 * follow from the sequence; its cells are all text, and an empty string is an
 * empty cell.
 */
function openSnapshot(manifestBytes: Uint8Array): OpenedSnapshot {
  const map = asMap(decodeCanonical(manifestBytes), "a snapshot manifest");
  const version = count(field(map, "manifestVersion"), "a manifest version");

  if (version === MANIFEST_VERSION) {
    const manifest = decodeManifestV2(map);
    return {
      format: "sheet-v2",
      displayName: manifest.displayName,
      rowCount: manifest.rowCount,
      columnCount: manifest.columnCount,
      chunks: manifest.chunks,
      merges: manifest.merges,
      inertAnchors: manifest.inertAnchors,
      discardedRows: manifest.discardedRows,
      rowsOf: (payload) => decodeSheetSnapshotChunk(payload).rows,
    };
  }

  const manifest = decodeSnapshotManifest(manifestBytes);
  return {
    format: "delimited-v1",
    displayName: manifest.sheetName,
    rowCount: manifest.rowCount,
    columnCount: manifest.columnCount,
    chunks: [...manifest.chunks]
      .sort((left, right) => left.sequence - right.sequence)
      .map((chunk) => ({
        ...chunk,
        firstRow: chunk.sequence * V1_ROWS_PER_CHUNK,
        lastRow: chunk.sequence * V1_ROWS_PER_CHUNK + V1_ROWS_PER_CHUNK - 1,
      })),
    merges: [],
    inertAnchors: [],
    discardedRows: [],
    rowsOf: (payload) =>
      decodeSnapshotChunk(payload).rows.map((row) => ({
        rowIndex: row.rowIndex,
        cells: row.cells.flatMap((cellText, columnIndex) =>
          cellText === "" ? [] : [{ columnIndex, text: cellText, kind: "text" as const }],
        ),
      })),
  };
}

const intersectsRows = (range: CellRangeV1, first: number, last: number): boolean =>
  range.firstRow <= last && range.lastRow >= first;

/**
 * One page of a snapshot, decrypting only the chunks whose rows it covers.
 * Accepts the v2 sheet format and F02's delimited v1 format alike.
 */
export async function readSnapshotPage(
  manifestBytes: Uint8Array,
  loadChunk: SnapshotChunkLoader,
  request: { readonly firstRow: number; readonly rowCount: number },
): Promise<SnapshotPageV1> {
  if (
    !Number.isInteger(request.firstRow) ||
    request.firstRow < 0 ||
    !Number.isInteger(request.rowCount) ||
    request.rowCount < 1 ||
    request.rowCount > MAX_SNAPSHOT_PAGE_ROWS
  ) {
    throw new RangeError("a snapshot page is outside the bounded range");
  }
  const snapshot = openSnapshot(manifestBytes);
  const first = request.firstRow;
  const last = request.firstRow + request.rowCount - 1;

  const rows: SnapshotRowV2[] = [];
  for (const chunk of snapshot.chunks) {
    if (chunk.lastRow < first || chunk.firstRow > last) {
      continue;
    }
    for (const row of snapshot.rowsOf(await loadChunk(chunk))) {
      if (row.rowIndex >= first && row.rowIndex <= last) {
        rows.push(row);
      }
    }
  }

  return {
    format: snapshot.format,
    displayName: snapshot.displayName,
    rowCount: snapshot.rowCount,
    columnCount: snapshot.columnCount,
    firstRow: first,
    rows,
    merges: snapshot.merges.filter((range) => intersectsRows(range, first, last)),
    inertAnchors: snapshot.inertAnchors.filter((anchor) =>
      intersectsRows(anchor.range, first, last),
    ),
    discardedRows: snapshot.discardedRows.filter(
      (row) => row.rowIndex >= first && row.rowIndex <= last,
    ),
  };
}

/**
 * The next cell after `afterRow` whose text contains `text` (case-insensitive),
 * scanning chunk by chunk and stopping at the first match. Null when there is
 * none, or when `text` is blank.
 */
export async function findInSnapshot(
  manifestBytes: Uint8Array,
  loadChunk: SnapshotChunkLoader,
  request: { readonly text: string; readonly afterRow: number | null },
): Promise<{ readonly rowIndex: number; readonly columnIndex: number } | null> {
  const needle = request.text.trim().toLocaleLowerCase();
  if (needle.length === 0) {
    return null;
  }
  const snapshot = openSnapshot(manifestBytes);
  const start = request.afterRow === null ? 0 : request.afterRow + 1;

  for (const chunk of snapshot.chunks) {
    if (chunk.lastRow < start) {
      continue;
    }
    for (const row of snapshot.rowsOf(await loadChunk(chunk))) {
      if (row.rowIndex < start) {
        continue;
      }
      const cell = row.cells.find((candidate) =>
        candidate.text.toLocaleLowerCase().includes(needle),
      );
      if (cell !== undefined) {
        return { rowIndex: row.rowIndex, columnIndex: cell.columnIndex };
      }
    }
  }
  return null;
}

// ------------------------------------------------------ the format subset (D41) --

export type SnapshotDateSystemV1 = "1900" | "1904";

export interface RenderedSnapshotCellV1 {
  readonly text: string;
  readonly kind: SnapshotCellKindV1;
}

const MONTHS = Object.freeze([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

const DAY_MS = 86_400_000;

/**
 * Rounds a canonical decimal string to `places` fraction digits, half away
 * from zero — exact, on the digits, never through a float.
 */
function roundDecimal(decimal: string, places: number): string {
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? decimal.slice(1) : decimal).split(".");
  const padded = fraction.padEnd(places + 1, "0");
  let scaled = BigInt(`${whole}${padded.slice(0, places)}`);
  if (Number(padded.charAt(places)) >= 5) {
    scaled += 1n;
  }
  const digits = scaled.toString().padStart(places + 1, "0");
  const integer = digits.slice(0, digits.length - places);
  const rounded = places === 0 ? integer : `${integer}.${digits.slice(-places)}`;
  return negative && /[1-9]/.test(rounded) ? `-${rounded}` : rounded;
}

/** Multiplies a canonical decimal by 100 by moving its point. */
function timesHundred(decimal: string): string {
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? decimal.slice(1) : decimal).split(".");
  const shifted = `${whole}${fraction.padEnd(2, "0").slice(0, 2)}`.replace(/^0+(?=\d)/, "");
  const rest = fraction.slice(2);
  const result = rest.length === 0 ? shifted : `${shifted}.${rest}`;
  return negative ? `-${result}` : result;
}

const groupThousands = (integer: string): string =>
  integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** The format's literal text with quoted strings, escapes, and brackets removed. */
const formatCode = (section: string): string =>
  section
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[_*]./g, "");

const CURRENCY_SYMBOLS = /[$€£¥₹]/;

/** The currency symbol a section names, bracketed (`[$€-407]`) or literal. */
function currencyOf(section: string): { symbol: string; leading: boolean } | null {
  const bracketed = /\[\$([^\]-]*)[^\]]*\]/.exec(section);
  const symbol = bracketed?.[1] ?? CURRENCY_SYMBOLS.exec(section.replace(/"[^"]*"/g, ""))?.[0];
  if (symbol === undefined || symbol.length === 0) {
    return null;
  }
  const at = section.indexOf(symbol);
  const digit = section.search(/[0#?]/);
  return { symbol, leading: digit === -1 || at < digit };
}

function renderNumber(decimal: string, section: string): string | null {
  const code = formatCode(section);
  if (/[^0#?.,% ]/.test(code.replace(/[$€£¥₹]/g, "").replace(/[-+()]/g, ""))) {
    return null;
  }
  const isPercent = code.includes("%");
  const value = isPercent ? timesHundred(decimal) : decimal;
  const places = /\.([0#?]+)/.exec(code)?.[1]?.length ?? 0;
  const rounded = roundDecimal(value, places);
  const negative = rounded.startsWith("-");
  const [integer = "0", fraction] = (negative ? rounded.slice(1) : rounded).split(".");
  const grouped = code.includes(",") ? groupThousands(integer) : integer;
  let body = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  if (isPercent) {
    body = `${body}%`;
  }
  const currency = currencyOf(section);
  if (currency !== null) {
    body = currency.leading ? `${currency.symbol}${body}` : `${body}${currency.symbol}`;
  }
  // A negative section's own sign: parentheses, or a literal leading minus.
  if (code.includes("(") && code.includes(")")) {
    body = `(${body})`;
  } else if (code.trimStart().startsWith("-")) {
    body = `-${body}`;
  }
  return negative ? `-${body}` : body;
}

/** A serial day number to UTC milliseconds, in the workbook's date system. */
function serialToMs(serial: number, system: SnapshotDateSystemV1): number {
  if (system === "1904") {
    return Date.UTC(1904, 0, 1) + serial * DAY_MS;
  }
  // The 1900 system counts a 29 February 1900 that never existed (serial 60).
  const epoch = serial < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return epoch + serial * DAY_MS;
}

const DATE_TOKEN = /yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am\/pm|a\/p/g;

function renderDate(ms: number, section: string): string | null {
  const code = formatCode(section).toLowerCase();
  if (!/[ymdhs]/.test(code) || /[0#?]/.test(code)) {
    return null;
  }
  const date = new Date(Math.round(ms / 1000) * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const twelveHour = /am\/pm|a\/p/.test(code);
  const matches = [...code.matchAll(DATE_TOKEN)];
  const pad = (value: number) => String(value).padStart(2, "0");
  const hours = date.getUTCHours();

  let rendered = "";
  let cursor = 0;
  for (const [index, match] of matches.entries()) {
    const token = match[0];
    const at = match.index;
    rendered += code.slice(cursor, at);
    cursor = at + token.length;
    const previous = matches[index - 1]?.[0];
    const next = matches[index + 1]?.[0];
    // `m`/`mm` beside an hour or second is minutes, not months.
    const isMinute =
      (token === "m" || token === "mm") &&
      (previous?.startsWith("h") === true || next?.startsWith("s") === true);
    switch (token) {
      case "yyyy":
        rendered += String(date.getUTCFullYear());
        break;
      case "yy":
        rendered += pad(date.getUTCFullYear() % 100);
        break;
      case "mmmm":
        rendered += MONTHS[date.getUTCMonth()] ?? "";
        break;
      case "mmm":
        rendered += (MONTHS[date.getUTCMonth()] ?? "").slice(0, 3);
        break;
      case "mm":
        rendered += pad(isMinute ? date.getUTCMinutes() : date.getUTCMonth() + 1);
        break;
      case "m":
        rendered += String(isMinute ? date.getUTCMinutes() : date.getUTCMonth() + 1);
        break;
      case "dddd":
      case "ddd":
        return null;
      case "dd":
        rendered += pad(date.getUTCDate());
        break;
      case "d":
        rendered += String(date.getUTCDate());
        break;
      case "hh":
        rendered += pad(twelveHour ? hours % 12 || 12 : hours);
        break;
      case "h":
        rendered += String(twelveHour ? hours % 12 || 12 : hours);
        break;
      case "ss":
        rendered += pad(date.getUTCSeconds());
        break;
      case "s":
        rendered += String(date.getUTCSeconds());
        break;
      case "am/pm":
        rendered += hours < 12 ? "AM" : "PM";
        break;
      case "a/p":
        rendered += hours < 12 ? "A" : "P";
        break;
      default:
        return null;
    }
  }
  return rendered + code.slice(cursor);
}

/**
 * A cell's display text under its number format, from D41's bounded subset.
 * The value is the imported literal (a formula's cached result is rendered the
 * same way; the writer marks its kind). Anything outside the subset renders
 * the canonical value text — never a guess at the workbook's appearance.
 */
export function formatForSnapshot(
  value: CellValueV1,
  numberFormat: string | null,
  dateSystem: SnapshotDateSystemV1 = "1900",
): RenderedSnapshotCellV1 {
  switch (value.kind) {
    case "text":
      return { text: value.text, kind: "text" };
    case "boolean":
      return { text: value.boolean ? "TRUE" : "FALSE", kind: "boolean" };
    case "invalid-preserved":
      // An error cell (`#N/A`) or text a typed column could not hold.
      return { text: value.sourceText, kind: "error" };
    case "date":
      return {
        text: new Date(value.epochDay * DAY_MS).toISOString().slice(0, 10),
        kind: "date",
      };
    case "missing":
    case "blank":
    case "enum":
    case "reference":
      return { text: "", kind: "text" };
    case "decimal":
      break;
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }

  const canonical = { text: value.decimal, kind: "number" as const };
  const code = numberFormat?.trim() ?? "";
  if (code === "" || /^general$/i.test(code) || code === "@") {
    return canonical;
  }
  const negative = value.decimal.startsWith("-");
  const sections = code.split(";");
  const section = negative && sections[1] !== undefined ? sections[1] : (sections[0] ?? "");
  const magnitude =
    negative && sections[1] !== undefined ? value.decimal.slice(1) : value.decimal;

  const serial = Number(value.decimal);
  const asDate = Number.isFinite(serial) ? renderDate(serialToMs(serial, dateSystem), section) : null;
  if (asDate !== null) {
    return { text: asDate, kind: "date" };
  }
  const asNumber = renderNumber(magnitude, section);
  return asNumber === null ? canonical : { text: asNumber, kind: "number" };
}

/** Re-exported so a writer needs one import for the whole format. */
export type { ManifestChunkRefV1 };
