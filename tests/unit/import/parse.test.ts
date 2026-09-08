import { describe, expect, it } from "vitest";
import { encodeCanonical } from "../../../src/persistence/codecs/canonical-cbor.js";
import { CodecError } from "../../../src/domain/model/errors.js";
import {
  factStreamItemToCanonicalValue,
  type ImportDiagnosticCodeV1,
  type WorkbookFactStreamItemV1,
  type WorkbookSummaryV1,
} from "../../../src/import/formats/delimited/facts.js";
import {
  DELIMITED_FACTS_PER_BATCH,
  parseDelimited,
} from "../../../src/import/formats/delimited/parse.js";
import { sniffContent } from "../../../src/import/source/sniff.js";
import { parseFixture, parseText } from "./parse-harness.js";
import { countingSource, fixtureSource } from "./fixtures.js";

const codes = (summary: WorkbookSummaryV1): ImportDiagnosticCodeV1[] =>
  summary.diagnostics.map((diagnostic) => diagnostic.code).sort();

describe("delimited parsing", () => {
  it("reads plain rows and reports exact counts in the summary", async () => {
    const { rows, summary } = await parseText("a,b,c\n1,2,3\n4,5,6\n");

    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
    expect(summary).toMatchObject({
      rowCount: 3,
      columnCount: 3,
      valueCount: 9,
      diagnostics: [],
    });
  });

  it("handles quoted fields, embedded delimiters, newlines and escaped quotes", async () => {
    const { rows, summary } = await parseFixture(
      "delimited/quoted-notes.csv",
      "quoted-notes.csv",
    );

    expect(rows).toEqual([
      ["Note ID", "Author", "Note"],
      ["1", "Rae", "Comma, inside a quoted field"],
      ["2", "Ibrahim", "Line one\nLine two"],
      ["3", "Wen", 'He said "bring the ladder" twice'],
      ["4", "Rae", "Trailing spaces   "],
      ["5", "Ibrahim", "plain unquoted value"],
    ]);
    expect(summary.diagnostics).toEqual([]);
  });

  it("reads CRLF, LF and CR line endings as the same rows", async () => {
    const body = ["a,b", "1,2", "3,4"];

    for (const [newline, joiner] of [
      ["crlf", "\r\n"],
      ["lf", "\n"],
      ["cr", "\r"],
    ] as const) {
      const { rows, summary } = await parseText(body.join(joiner) + joiner);
      expect(rows, newline).toEqual([
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ]);
      expect(summary.rowCount, newline).toBe(3);
    }

    const legacy = await parseFixture(
      "delimited/cr-only-legacy.csv",
      "cr-only-legacy.csv",
    );
    expect(legacy.rows).toHaveLength(4);
    expect(legacy.rows[0]).toEqual(["Reading", "Depth", "Crew"]);
  });

  it("decodes tab, UTF-16 and latin-1 sources through the detected format", async () => {
    const tsv = await parseFixture("delimited/crew-roster.tsv", "crew-roster.tsv");
    expect(tsv.rows[1]).toEqual(["North", "Rae Bennet", "4"]);

    const utf16 = await parseFixture(
      "delimited/site-visits-utf16.csv",
      "site-visits-utf16.csv",
    );
    expect(utf16.rows[0]).toEqual(["Site", "Visits", "Notes"]);
    expect(utf16.rows[3]).toEqual(["Bramble Yard", "5", "Dog on site"]);

    const latin1 = await parseFixture(
      "delimited/suppliers-latin1.csv",
      "suppliers-latin1.csv",
    );
    expect(latin1.rows[1]).toEqual(["Rivière Timber", "Chloé Rivière", "Nîmes"]);
    expect(latin1.summary.diagnostics).toEqual([]);
  });

  it("distinguishes a blank cell from a cell the short row never had", async () => {
    const { items } = await parseFixture(
      "delimited/ragged-rows.csv",
      "ragged-rows.csv",
    );
    const facts = items
      .filter((item) => item.kind === "batch")
      .flatMap((batch) => batch.facts);

    // "Alder Court,South" — two cells, so columns 2 and 3 are *missing*.
    expect(
      facts.find((fact) => fact.kind === "row" && fact.rowIndex === 2),
    ).toEqual({ kind: "row", rowIndex: 2, cellCount: 2 });
    expect(
      facts.filter((fact) => fact.kind === "value" && fact.rowIndex === 2),
    ).toHaveLength(2);

    // "Cedar Mill,,4.25,yes" — four cells, so column 1 is *blank*.
    expect(
      facts.find((fact) => fact.kind === "row" && fact.rowIndex === 4),
    ).toEqual({ kind: "row", rowIndex: 4, cellCount: 4 });
    expect(
      facts
        .filter((fact) => fact.kind === "value" && fact.rowIndex === 4)
        .map((fact) => (fact.kind === "value" ? fact.columnIndex : -1)),
    ).toEqual([0, 2, 3]);
  });

  it("flags ragged rows without dropping or padding anything", async () => {
    const { rows, summary } = await parseFixture(
      "delimited/ragged-rows.csv",
      "ragged-rows.csv",
    );

    expect(rows[3]).toEqual(["Bramble Yard", "East", "6.0", "no", "extra", "cells"]);
    expect(codes(summary)).toEqual(["ragged-row"]);
    expect(summary.columnCount).toBe(6);
  });

  it("degrades malformed quoting to preserved text and diagnostics", async () => {
    const unterminated = await parseText('a,b\n"open,1\n');
    expect(unterminated.rows).toEqual([
      ["a", "b"],
      ["open,1\n"],
    ]);
    expect(codes(unterminated.summary)).toContain("unterminated-quote");

    const stray = await parseText('a,b\nva"lue,2\n');
    expect(stray.rows[1]).toEqual(['va"lue', "2"]);
    expect(codes(stray.summary)).toContain("quote-inside-unquoted-field");

    const glued = await parseText('a,b\n"quoted"tail,2\n');
    expect(glued.rows[1]).toEqual(["quotedtail", "2"]);
    expect(codes(glued.summary)).toContain("quote-inside-unquoted-field");
  });

  it("ends an unbounded row at the row-length bound instead of growing", async () => {
    const { rows, summary } = await parseText('a,b\n"' + "x".repeat(200), {
      maxRowCharacters: 50,
    });

    expect(codes(summary)).toContain("row-length-bound-reached");
    expect(rows.slice(1).every((row) => row.join("").length <= 51)).toBe(true);
    expect(rows.slice(1).map((row) => row.join("")).join("")).toBe(
      "x".repeat(200),
    );
  });

  it("parses an empty file as no rows at all", async () => {
    const { rows, summary } = await parseFixture("delimited/empty.csv", "empty.csv");

    expect(rows).toEqual([]);
    expect(summary).toMatchObject({ rowCount: 0, columnCount: 0, valueCount: 0 });
  });

  it("never exceeds the batch bound and numbers batches contiguously", async () => {
    const { items } = await parseFixture(
      "delimited/field-log-messy.csv",
      "field-log-messy.csv",
      { factsPerBatch: 16 },
    );
    const batches = items.filter((item) => item.kind === "batch");

    expect(batches.length).toBeGreaterThan(1);
    for (const [index, batch] of batches.entries()) {
      expect(batch.batchSeq).toBe(index);
      expect(batch.facts.length).toBeLessThanOrEqual(16);
    }
    expect(DELIMITED_FACTS_PER_BATCH).toBe(1024);
  });

  it("stops between batches when the cancellation token is aborted", async () => {
    const cancellation = { aborted: false };
    const format = (
      await sniffContent(
        await fixtureSource("delimited/field-log-messy.csv"),
        "field-log-messy.csv",
      )
    ).format;
    if (format.kind !== "delimited") {
      throw new Error("fixture must sniff as delimited");
    }
    const source = countingSource(
      await fixtureSource("delimited/field-log-messy.csv"),
    );

    const seen: WorkbookFactStreamItemV1[] = [];
    for await (const item of parseDelimited(source, format, {
      chunkBytes: 512,
      factsPerBatch: 8,
      cancellation,
    })) {
      seen.push(item);
      cancellation.aborted = true;
    }
    const readsAtStop = source.reads.length;

    expect(seen).toHaveLength(1);
    expect(seen.every((item) => item.kind === "batch")).toBe(true);
    // No summary: an abandoned parse never claims to have completed.
    expect(seen.some((item) => item.kind === "summary")).toBe(false);
    // And no read is left outstanding once the consumer stops.
    await Promise.resolve();
    expect(source.reads.length).toBe(readsAtStop);
    expect(source.bytesRead).toBeLessThan(source.byteLength);
  });
});

describe("CA-10 — facts stage canonically (D28 parse half)", () => {
  it("normalizes NFD source text and says so, with no CodecError anywhere", async () => {
    const { rows, summary, items } = await parseFixture(
      "delimited/nfd-crew.csv",
      "nfd-crew.csv",
    );

    // The fixture on disk is decomposed; every value that leaves the parser is
    // composed, which is the only form the domain and the codec accept (D28).
    const decomposed = await fixtureSource("delimited/nfd-crew.csv");
    const raw = new TextDecoder().decode(
      await decomposed.slice(0, decomposed.byteLength),
    );
    expect(raw.normalize("NFC")).not.toBe(raw);
    expect(rows[1]).toEqual(["North", "José Muñoz", "Málaga Yard"]);
    for (const row of rows) {
      for (const cell of row) {
        expect(cell.normalize("NFC")).toBe(cell);
      }
    }

    const normalization = summary.diagnostics.find(
      (diagnostic) => diagnostic.code === "text-normalized-nfc",
    );
    expect(normalization).toMatchObject({
      severity: "info",
      firstRowIndex: 1,
      firstColumnIndex: 1,
    });
    expect(normalization?.occurrences).toBeGreaterThan(1);

    for (const item of items) {
      const encoded = encodeCanonical(factStreamItemToCanonicalValue(item));
      expect(encoded.byteLength).toBeGreaterThan(0);
    }
  });

  it("encodes every corpus fixture's facts canonically and identically twice", async () => {
    for (const name of [
      "field-log-messy.csv",
      "quoted-notes.csv",
      "crew-roster.tsv",
      "site-visits-utf16.csv",
      "suppliers-latin1.csv",
      "nfd-crew.csv",
      "headerless-readings.csv",
      "single-column.csv",
      "empty.csv",
      "ragged-rows.csv",
      "cr-only-legacy.csv",
    ]) {
      const { items } = await parseFixture(`delimited/${name}`, name);
      expect(items.length, name).toBeGreaterThan(0);
      for (const item of items) {
        const value = factStreamItemToCanonicalValue(item);
        expect(encodeCanonical(value), name).toEqual(encodeCanonical(value));
      }
    }
  });

  it("refuses to encode a fact carrying text the codec would reject", () => {
    // The negative control for the assertion above: without the parser's
    // normalization these bytes are exactly what would reach the codec.
    expect(() =>
      encodeCanonical(
        factStreamItemToCanonicalValue({
          kind: "batch",
          batchSeq: 0,
          facts: [
            {
              kind: "value",
              rowIndex: 0,
              columnIndex: 0,
              // Constructed directly, bypassing `textValue`, so the shape is
              // reachable only in this control.
              value: { kind: "text", text: "Jose\u0301" },
            },
          ],
        }),
      ),
    ).toThrow(CodecError);
  });
});
