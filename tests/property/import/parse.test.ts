import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DELIMITERS,
  type DelimitedFormatV1,
} from "../../../src/import/source/sniff.js";
import {
  parseDelimited,
  type DelimitedParseOptionsV1,
} from "../../../src/import/formats/delimited/parse.js";
import type { WorkbookFactStreamItemV1 } from "../../../src/import/formats/delimited/facts.js";
import {
  bytesSource,
  countingSource,
  textSource,
} from "../../unit/import/fixtures.js";
import { rowsOf } from "../../unit/import/parse-harness.js";

/**
 * Every character class a delimited file can carry that the parser has a rule
 * for: all four delimiters, both quote roles, all three line endings, and text
 * that is wider than one UTF-8 byte.
 */
const ALPHABET = [
  "a",
  "B",
  "7",
  "0",
  " ",
  ",",
  ";",
  "\t",
  "|",
  '"',
  "\n",
  "\r\n",
  "\r",
  "é",
  "漢",
  "—",
  "'",
  ".",
  "-",
];

const cell = fc
  .array(fc.constantFrom(...ALPHABET), { maxLength: 10 })
  .map((parts) => parts.join(""));

const tableOf = (columnCount: number) =>
  fc.array(fc.array(cell, { minLength: columnCount, maxLength: columnCount }), {
    minLength: 1,
    maxLength: 25,
  });

const shaped = fc
  .integer({ min: 1, max: 5 })
  .chain((columnCount) => tableOf(columnCount));

const format = (
  delimiter: DelimitedFormatV1["delimiter"],
): DelimitedFormatV1 => ({
  kind: "delimited",
  delimiter,
  encoding: "utf-8",
  bomByteLength: 0,
  newline: "crlf",
});

const serialize = (
  rows: readonly (readonly string[])[],
  delimiter: string,
): string => {
  const quote = (value: string): string =>
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\r") ||
    value.includes("\n")
      ? `"${value.replace(/"/g, '""')}"`
      : value;
  return rows.map((row) => row.map(quote).join(delimiter)).join("\r\n") + "\r\n";
};

const drain = async (
  text: string,
  delimiter: DelimitedFormatV1["delimiter"],
  options: DelimitedParseOptionsV1 = {},
): Promise<WorkbookFactStreamItemV1[]> => {
  const items: WorkbookFactStreamItemV1[] = [];
  for await (const item of parseDelimited(
    textSource(text),
    format(delimiter),
    options,
  )) {
    items.push(item);
  }
  return items;
};

describe("delimited parser properties", () => {
  it("round-trips every table through serialization and back", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DELIMITERS),
        shaped,
        async (delimiter, rows) => {
          const items = await drain(serialize(rows, delimiter), delimiter);

          // NFC normalization at the boundary (D28) is the one rewrite the
          // parser is allowed to make, so the expectation is normalized too.
          expect(rowsOf(items)).toEqual(
            rows.map((row) => row.map((value) => value.normalize("NFC"))),
          );
          expect(items.at(-1)).toMatchObject({
            kind: "summary",
            rowCount: rows.length,
          });
        },
      ),
      { numRuns: 300 },
    );
  });

  it("produces identical facts however the bytes are chunked", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DELIMITERS),
        shaped,
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 4096 }),
        async (delimiter, rows, chunkA, chunkB) => {
          const text = serialize(rows, delimiter);
          const a = await drain(text, delimiter, { chunkBytes: chunkA });
          const b = await drain(text, delimiter, { chunkBytes: chunkB });

          // Batching is by fact count, not by read window, so even the batch
          // boundaries have to match: the chunk size is invisible downstream.
          expect(a).toEqual(b);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("never throws and always terminates on arbitrary bytes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ maxLength: 3000 }),
        fc.constantFrom(...DELIMITERS),
        fc.integer({ min: 1, max: 512 }),
        async (bytes, delimiter, chunkBytes) => {
          const items: WorkbookFactStreamItemV1[] = [];
          for await (const item of parseDelimited(
            bytesSource(bytes),
            format(delimiter),
            { chunkBytes },
          )) {
            items.push(item);
          }

          const summary = items.at(-1);
          expect(summary?.kind).toBe("summary");
          if (summary?.kind === "summary") {
            expect(summary.rowCount).toBeGreaterThanOrEqual(0);
            expect(summary.batchCount).toBe(
              items.filter((item) => item.kind === "batch").length,
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("holds no more than one read window and emits before the file is read", async () => {
    const rowCount = 4000;
    const rows = Array.from({ length: rowCount }, (_unused, index) => [
      `row-${index}`,
      String(index),
      "Ridgeway Depot",
    ]);
    const text = serialize(rows, ",");
    const chunkBytes = 4096;
    const source = countingSource(textSource(text));

    expect(source.byteLength).toBeGreaterThan(chunkBytes * 4);

    let bytesReadAtFirstBatch = Number.POSITIVE_INFINITY;
    let batches = 0;
    let largestBatch = 0;
    for await (const item of parseDelimited(source, format(","), {
      chunkBytes,
      factsPerBatch: 64,
    })) {
      if (item.kind === "batch") {
        batches += 1;
        largestBatch = Math.max(largestBatch, item.facts.length);
        bytesReadAtFirstBatch = Math.min(
          bytesReadAtFirstBatch,
          source.bytesRead,
        );
      }
    }

    // Facts start flowing after one window, not after the whole file: the
    // parser accumulates nothing it does not need (FR-3).
    expect(bytesReadAtFirstBatch).toBeLessThanOrEqual(chunkBytes);
    expect(source.largestRead).toBeLessThanOrEqual(chunkBytes);
    expect(largestBatch).toBeLessThanOrEqual(64);
    expect(batches).toBeGreaterThan(60);
  });

  it("leaves no read outstanding when the consumer stops early", async () => {
    const rows = Array.from({ length: 2000 }, (_unused, index) => [
      String(index),
      "value",
    ]);
    const source = countingSource(textSource(serialize(rows, ",")));

    for await (const item of parseDelimited(source, format(","), {
      chunkBytes: 256,
      factsPerBatch: 4,
    })) {
      if (item.kind === "batch") {
        break;
      }
    }
    const readsAtBreak = source.reads.length;
    await Promise.resolve();

    expect(source.reads.length).toBe(readsAtBreak);
    expect(source.bytesRead).toBeLessThan(source.byteLength);
  });
});
