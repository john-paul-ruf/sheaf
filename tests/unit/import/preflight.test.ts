import { describe, expect, it } from "vitest";
import {
  F02_IMPORT_MAX_ESTIMATED_CELLS,
  F02_IMPORT_MAX_SOURCE_BYTES,
  isDelimitedSniff,
  PREFLIGHT_SAMPLE_BYTES,
  PREFLIGHT_SAMPLE_ROWS,
  preflightDelimited,
  type PreflightReportV1,
} from "../../../src/import/preflight/preflight.js";
import { sniffContent } from "../../../src/import/source/sniff.js";
import type { RandomAccessSource } from "../../../src/import/source/source.js";
import {
  generateLargeDelimited,
  LARGE_DELIMITED_SAMPLE_ROWS,
} from "../../fixtures/workbooks/delimited/generate-large.js";
import {
  countingSource,
  fixtureBytes,
  fixtureSource,
  textSource,
  type CountingSource,
} from "./fixtures.js";

const preflight = async (source: RandomAccessSource, declaredName: string) => {
  const sniff = await sniffContent(source, declaredName);
  if (!isDelimitedSniff(sniff)) {
    throw new Error(`${declaredName} did not sniff as delimited`);
  }
  return preflightDelimited(source, sniff);
};

const proceed = async (
  source: RandomAccessSource,
  declaredName: string,
): Promise<PreflightReportV1> => {
  const outcome = await preflight(source, declaredName);
  if (outcome.kind !== "proceed") {
    throw new Error(`${declaredName} was refused: ${outcome.refusal.kind}`);
  }
  return outcome.report;
};

/** Claims a size it does not hold, the way a 60 MiB file on disk would. */
const oversizedSource = (
  body: string,
  byteLength: number,
): CountingSource => {
  const bytes = new TextEncoder().encode(body);
  return countingSource({
    byteLength,
    slice: (offset: number, length: number) =>
      Promise.resolve(bytes.slice(offset, Math.min(offset + length, bytes.length))),
  });
};

describe("delimited pre-flight", () => {
  it("reports the detected facts SCR-017 renders", async () => {
    const report = await proceed(
      await fixtureSource("delimited/field-log-messy.csv"),
      "field-log-messy.csv",
    );

    expect(report).toMatchObject({
      fileName: "field-log-messy.csv",
      delimiter: ",",
      encoding: "utf-8",
      newline: "crlf",
      columnCount: 9,
      estimatedRowCount: 44,
      estimatedCellCount: 396,
      isEstimate: true,
    });
    expect(report.sampleRows).toHaveLength(PREFLIGHT_SAMPLE_ROWS);
    expect(report.sampleRows[0]).toEqual(["Cedar & Finch Field Log"]);
    expect(report.sampleRows[3]?.[0]).toBe("Visit ID");
  });

  it("never reads beyond its sample window, whatever the file size", async () => {
    const large = generateLargeDelimited(10_000);
    const source = countingSource(textSource(large));

    expect(source.byteLength).toBeGreaterThan(PREFLIGHT_SAMPLE_BYTES * 10);

    const sniff = await sniffContent(source, "large.csv");
    if (!isDelimitedSniff(sniff)) {
      throw new Error("generated file must sniff as delimited");
    }
    const readsAfterSniff = source.bytesRead;
    const outcome = await preflightDelimited(source, sniff);

    expect(outcome.kind).toBe("proceed");
    expect(source.bytesRead - readsAfterSniff).toBe(PREFLIGHT_SAMPLE_BYTES);
    expect(source.largestRead).toBeLessThanOrEqual(PREFLIGHT_SAMPLE_BYTES);
    expect(source.reads.filter(({ offset }) => offset === 0)).toHaveLength(2);
  });

  it("estimates a large file's rows within a few percent of the truth", async () => {
    const rowCount = 10_000;
    const report = await proceed(
      textSource(generateLargeDelimited(rowCount)),
      "large.csv",
    );

    const actual = rowCount + 1;
    expect(Math.abs(report.estimatedRowCount - actual) / actual).toBeLessThan(
      0.05,
    );
    expect(report.estimatedRowCount).not.toBe(actual);
    expect(report.isEstimate).toBe(true);
  }, 20_000);

  it("refuses past the estimated-cell ceiling with the numbers SCR-019 states", async () => {
    const outcome = await preflight(
      textSource(generateLargeDelimited(30_000)),
      "field-history.csv",
    );

    expect(outcome).toMatchObject({
      kind: "refused",
      refusal: {
        kind: "over-import-budget",
        fileName: "field-history.csv",
        remedy: "use-larger-device",
        exceeded: "estimated-cells",
        maxSourceByteLength: F02_IMPORT_MAX_SOURCE_BYTES,
        maxEstimatedCellCount: F02_IMPORT_MAX_ESTIMATED_CELLS,
      },
    });
    if (outcome.kind === "refused" && outcome.refusal.kind === "over-import-budget") {
      expect(outcome.refusal.estimatedCellCount).toBeGreaterThan(
        F02_IMPORT_MAX_ESTIMATED_CELLS,
      );
      expect(outcome.refusal.sourceByteLength).toBeLessThan(
        F02_IMPORT_MAX_SOURCE_BYTES,
      );
    }
  }, 30_000);

  it("refuses past the source-byte ceiling and still states real sample facts", async () => {
    const source = oversizedSource(
      generateLargeDelimited(200),
      F02_IMPORT_MAX_SOURCE_BYTES + 1,
    );
    const sniff = await sniffContent(source, "archive.csv");
    if (!isDelimitedSniff(sniff)) {
      throw new Error("must sniff as delimited");
    }

    const outcome = await preflightDelimited(source, sniff);

    expect(outcome).toMatchObject({
      kind: "refused",
      refusal: {
        kind: "over-import-budget",
        exceeded: "source-bytes",
        sourceByteLength: F02_IMPORT_MAX_SOURCE_BYTES + 1,
      },
    });
    // Refusing early is not an excuse to read the file: the bound still holds.
    expect(source.largestRead).toBeLessThanOrEqual(PREFLIGHT_SAMPLE_BYTES);
  });

  it("sizes the whole corpus without refusing anything inside the budget", async () => {
    for (const [name, columnCount, rowCount] of [
      ["quoted-notes.csv", 3, 6],
      ["crew-roster.tsv", 3, 5],
      ["site-visits-utf16.csv", 3, 4],
      ["suppliers-latin1.csv", 3, 4],
      ["nfd-crew.csv", 3, 4],
      ["headerless-readings.csv", 3, 6],
      ["single-column.csv", 1, 5],
      ["ragged-rows.csv", 4, 5],
      ["cr-only-legacy.csv", 3, 4],
      ["large-sample.csv", 9, 21],
    ] as const) {
      const report = await proceed(
        await fixtureSource(`delimited/${name}`),
        name,
      );
      expect([name, report.columnCount, report.estimatedRowCount]).toEqual([
        name,
        columnCount,
        rowCount,
      ]);
    }
  });

  it("reports an empty file as nothing rather than guessing", async () => {
    const report = await proceed(
      await fixtureSource("delimited/empty.csv"),
      "empty.csv",
    );

    expect(report).toMatchObject({
      columnCount: 0,
      estimatedRowCount: 0,
      estimatedCellCount: 0,
      bytesSampled: 0,
      sampleRows: [],
    });
  });

  it("keeps the committed large sample identical to its generator", async () => {
    const committed = new TextDecoder().decode(
      await fixtureBytes("delimited/large-sample.csv"),
    );

    expect(committed).toBe(
      generateLargeDelimited(LARGE_DELIMITED_SAMPLE_ROWS),
    );
    expect(generateLargeDelimited(50)).toBe(generateLargeDelimited(50));
  });
});
