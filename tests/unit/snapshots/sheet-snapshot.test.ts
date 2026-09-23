/**
 * CA-22's format half: the v2 sheet snapshot codecs, the one page reader over
 * both formats (F02's delimited v1 included — Roshi CL-04's first consumer),
 * the bounded find, and D41's number-format subset.
 */

import { describe, expect, it } from "vitest";

import { CodecError } from "../../../src/domain/model/errors.js";
import { asDomainId } from "../../../src/domain/model/ids.js";
import {
  booleanValue,
  decimalValue,
  invalidPreservedValue,
  textValue,
} from "../../../src/domain/model/values.js";
import { DISCARD_REASONS } from "../../../src/import/inference/infer.js";
import {
  chunkSnapshotRows,
  encodeSnapshotChunk,
  encodeSnapshotManifest,
} from "../../../src/import/snapshots/delimited-snapshot.js";
import {
  SNAPSHOT_CHUNK_MAX_DECODED_BYTES,
  SNAPSHOT_DISCARD_REASONS,
  decodeSheetSnapshotChunk,
  decodeSheetSnapshotManifest,
  encodeSheetSnapshotChunk,
  encodeSheetSnapshotManifest,
  findInSnapshot,
  formatForSnapshot,
  readSnapshotPage,
  type ManifestChunkRefV1,
  type SheetSnapshotChunkV2,
  type SheetSnapshotManifestV2,
} from "../../../src/import/snapshots/sheet-snapshot.js";

const storageId = (seed: number): string =>
  String.fromCharCode(65 + seed).repeat(21) + "A";

/** Three chunks of three rows each, rows 0–8, one cell per row. */
const chunks: readonly SheetSnapshotChunkV2[] = [0, 1, 2].map((sequence) => ({
  chunkVersion: 2,
  firstRow: sequence * 3,
  rows: [0, 1, 2].map((offset) => {
    const rowIndex = sequence * 3 + offset;
    return {
      rowIndex,
      cells: [
        { columnIndex: 0, text: `row ${rowIndex}`, kind: "text" as const },
        ...(rowIndex === 7 ? [{ columnIndex: 2, text: "Needle", kind: "text" as const }] : []),
      ],
    };
  }),
}));

const manifest = (): SheetSnapshotManifestV2 => ({
  manifestVersion: 2,
  sheetId: asDomainId("sheet", new Uint8Array(16).fill(1)),
  sheetOrdinal: 2,
  displayName: "Overview",
  classification: ["summary", "chart"],
  rowCount: 9,
  columnCount: 3,
  chunks: chunks.map((chunk, sequence) => ({
    storageId: storageId(sequence),
    sequence,
    decodedByteLength: encodeSheetSnapshotChunk(chunk).byteLength,
    sha256: new Uint8Array(32).fill(sequence),
    firstRow: chunk.firstRow,
    lastRow: chunk.firstRow + 2,
  })),
  merges: [{ firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 2 }],
  inertAnchors: [
    {
      inertItemId: asDomainId("inert-item", new Uint8Array(16).fill(2)),
      range: { firstRow: 4, firstColumn: 1, lastRow: 6, lastColumn: 2 },
    },
  ],
  discardedRows: [{ rowIndex: 0, reason: "above-header" }],
});

/** A loader over the fixture chunks that records what it was asked for. */
const loaderFor = (payloads: readonly Uint8Array[]) => {
  const asked: number[] = [];
  const load = (ref: ManifestChunkRefV1): Promise<Uint8Array> => {
    asked.push(ref.sequence);
    return Promise.resolve(payloads[ref.sequence] as Uint8Array);
  };
  return { asked, load };
};

describe("sheet snapshot codecs (v2)", () => {
  it("round-trips a chunk and a manifest byte-identically", () => {
    const chunk = chunks[1] as SheetSnapshotChunkV2;
    const bytes = encodeSheetSnapshotChunk(chunk);
    expect(decodeSheetSnapshotChunk(bytes)).toEqual(chunk);
    expect(encodeSheetSnapshotChunk(decodeSheetSnapshotChunk(bytes))).toEqual(bytes);

    const manifestBytes = encodeSheetSnapshotManifest(manifest());
    expect(decodeSheetSnapshotManifest(manifestBytes)).toEqual(manifest());
  });

  it("refuses unsorted rows, unsorted cells, and a chunk over 1 MiB", () => {
    const base = chunks[0] as SheetSnapshotChunkV2;
    expect(() =>
      encodeSheetSnapshotChunk({ ...base, rows: [...base.rows].reverse() }),
    ).toThrow(CodecError);
    expect(() =>
      encodeSheetSnapshotChunk({
        ...base,
        rows: [
          {
            rowIndex: 0,
            cells: [
              { columnIndex: 2, text: "b", kind: "text" },
              { columnIndex: 1, text: "a", kind: "text" },
            ],
          },
        ],
      }),
    ).toThrow(CodecError);
    expect(() =>
      encodeSheetSnapshotChunk({
        chunkVersion: 2,
        firstRow: 0,
        rows: [
          {
            rowIndex: 0,
            cells: [
              {
                columnIndex: 0,
                text: "x".repeat(SNAPSHOT_CHUNK_MAX_DECODED_BYTES),
                kind: "text",
              },
            ],
          },
        ],
      }),
    ).toThrow(/1 MiB/);
  });

  it("refuses overlapping chunk ranges and an empty classification", () => {
    const overlapping = manifest();
    expect(() =>
      decodeSheetSnapshotManifest(
        encodeSheetSnapshotManifest({
          ...overlapping,
          chunks: [
            overlapping.chunks[0]!,
            { ...overlapping.chunks[1]!, firstRow: 2 },
          ],
        }),
      ),
    ).toThrow(CodecError);
    expect(() =>
      decodeSheetSnapshotManifest(
        encodeSheetSnapshotManifest({ ...overlapping, classification: [] }),
      ),
    ).toThrow(CodecError);
  });

  it("restates exactly M21's discard reasons", () => {
    expect([...SNAPSHOT_DISCARD_REASONS]).toEqual([...DISCARD_REASONS]);
  });
});

describe("reading a page", () => {
  const payloads = chunks.map(encodeSheetSnapshotChunk);

  it("crosses a chunk boundary and opens only the chunks it needs", async () => {
    const { asked, load } = loaderFor(payloads);
    const page = await readSnapshotPage(encodeSheetSnapshotManifest(manifest()), load, {
      firstRow: 2,
      rowCount: 3,
    });

    expect(asked).toEqual([0, 1]);
    expect(page.format).toBe("sheet-v2");
    expect(page.rows.map((row) => row.rowIndex)).toEqual([2, 3, 4]);
    // Only what intersects the page comes back.
    expect(page.merges).toEqual([]);
    expect(page.inertAnchors).toHaveLength(1);
    expect(page.discardedRows).toEqual([]);
  });

  it("reads F02's delimited snapshot as the same page shape, pre-header rows included", async () => {
    const rows = Array.from({ length: 600 }, (_unused, rowIndex) => ({
      rowIndex,
      cellCount: 2,
      cells: rowIndex === 0 ? ["Field log, exported", ""] : [`site ${rowIndex}`, "ok"],
    }));
    const v1Chunks = chunkSnapshotRows(rows);
    const v1Payloads = v1Chunks.map(encodeSnapshotChunk);
    const v1Manifest = encodeSnapshotManifest({
      manifestVersion: 1,
      sheetName: "field-log.csv",
      rowCount: rows.length,
      columnCount: 2,
      chunks: v1Chunks.map((chunk) => ({
        storageId: storageId(chunk.sequence),
        sequence: chunk.sequence,
        decodedByteLength: (v1Payloads[chunk.sequence] as Uint8Array).byteLength,
        sha256: new Uint8Array(32),
      })),
    });

    const first = loaderFor(v1Payloads);
    const top = await readSnapshotPage(v1Manifest, first.load, { firstRow: 0, rowCount: 2 });
    expect(first.asked).toEqual([0]);
    expect(top.format).toBe("delimited-v1");
    expect(top.displayName).toBe("field-log.csv");
    // The title row the import discarded is here to be read; its empty cell is absent.
    expect(top.rows[0]).toEqual({
      rowIndex: 0,
      cells: [{ columnIndex: 0, text: "Field log, exported", kind: "text" }],
    });

    const across = loaderFor(v1Payloads);
    const boundary = await readSnapshotPage(v1Manifest, across.load, {
      firstRow: 510,
      rowCount: 4,
    });
    expect(across.asked).toEqual([0, 1]);
    expect(boundary.rows.map((row) => row.rowIndex)).toEqual([510, 511, 512, 513]);
  });

  it("refuses an unbounded page", async () => {
    const { load } = loaderFor(payloads);
    await expect(
      readSnapshotPage(encodeSheetSnapshotManifest(manifest()), load, {
        firstRow: 0,
        rowCount: 100_000,
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe("find", () => {
  const payloads = chunks.map(encodeSheetSnapshotChunk);
  const manifestBytes = encodeSheetSnapshotManifest(manifest());

  it("crosses chunks and stops at the first match", async () => {
    const { asked, load } = loaderFor(payloads);
    expect(await findInSnapshot(manifestBytes, load, { text: "needle", afterRow: null })).toEqual(
      { rowIndex: 7, columnIndex: 2 },
    );
    expect(asked).toEqual([0, 1, 2]);

    const later = loaderFor(payloads);
    expect(await findInSnapshot(manifestBytes, later.load, { text: "row", afterRow: 3 })).toEqual({
      rowIndex: 4,
      columnIndex: 0,
    });
    expect(later.asked).toEqual([1]);
  });

  it("finds nothing past the last match, and nothing for blank text", async () => {
    const { load } = loaderFor(payloads);
    expect(await findInSnapshot(manifestBytes, load, { text: "needle", afterRow: 7 })).toBeNull();
    expect(await findInSnapshot(manifestBytes, load, { text: "  ", afterRow: null })).toBeNull();
  });
});

describe("formatForSnapshot (D41's bounded subset)", () => {
  const as = (decimal: string, format: string | null) =>
    formatForSnapshot(decimalValue(decimal), format);

  it("renders General and text formats as the canonical value", () => {
    expect(as("1234.5", null)).toEqual({ text: "1234.5", kind: "number" });
    expect(as("1234.5", "General")).toEqual({ text: "1234.5", kind: "number" });
    expect(as("7", "@")).toEqual({ text: "7", kind: "number" });
  });

  it("renders fixed decimals, rounding half away from zero on the digits", () => {
    expect(as("2.345", "0.00").text).toBe("2.35");
    expect(as("-2.345", "0.00").text).toBe("-2.35");
    expect(as("2.344", "0.00").text).toBe("2.34");
    expect(as("0.5", "0").text).toBe("1");
    expect(as("-0.004", "0.00").text).toBe("0.00");
  });

  it("renders thousands separators, percent, and currency symbols", () => {
    expect(as("1234567.891", "#,##0.00").text).toBe("1,234,567.89");
    expect(as("0.125", "0.0%").text).toBe("12.5%");
    expect(as("1234.5", "$#,##0.00").text).toBe("$1,234.50");
    expect(as("1234.5", "[$€-407]#,##0.00").text).toBe("€1,234.50");
    expect(as("1234.5", "#,##0.00 [$€-407]").text).toBe("1,234.50€");
    expect(as("-1234.5", "#,##0.00;(#,##0.00)").text).toBe("(1,234.50)");
    expect(as("-5", "0.00;-0.00").text).toBe("-5.00");
  });

  it("renders common date and time codes in both date systems", () => {
    expect(as("45292", "yyyy-mm-dd")).toEqual({ text: "2024-01-01", kind: "date" });
    expect(as("45292.75", "m/d/yyyy h:mm").text).toBe("1/1/2024 18:00");
    expect(as("45292.75", "hh:mm AM/PM").text).toBe("06:00 PM");
    expect(as("45292", "d-mmm-yy").text).toBe("1-Jan-24");
    expect(formatForSnapshot(decimalValue("0"), "yyyy-mm-dd", "1904").text).toBe("1904-01-01");
    // The 1900 system's phantom 29 February: serial 61 is 1 March.
    expect(as("61", "yyyy-mm-dd").text).toBe("1900-03-01");
  });

  it("claims no fidelity it does not have: anything else is the canonical value", () => {
    expect(as("45292", "dddd, mmmm d")).toEqual({ text: "45292", kind: "number" });
    expect(as("3.5", "# ?/?")).toEqual({ text: "3.5", kind: "number" });
    expect(as("12", "0.00E+00")).toEqual({ text: "12", kind: "number" });
  });

  it("keeps text, booleans, and error cells as what they are", () => {
    expect(formatForSnapshot(textValue("North yard"), "0.00")).toEqual({
      text: "North yard",
      kind: "text",
    });
    expect(formatForSnapshot(booleanValue(true), null)).toEqual({ text: "TRUE", kind: "boolean" });
    expect(formatForSnapshot(invalidPreservedValue("#N/A"), null)).toEqual({
      text: "#N/A",
      kind: "error",
    });
  });
});
