import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DELIMITERS,
  NEWLINE_CONVENTIONS,
  SNIFF_SAMPLE_BYTES,
  sniffContent,
  TEXT_ENCODINGS,
} from "../../../src/import/source/sniff.js";
import { classifyRefusal } from "../../../src/import/preflight/refusal.js";
import { bytesSource, countingSource } from "../../unit/import/fixtures.js";

const NAMES = [
  "notes.csv",
  "book.xlsx",
  "sheet.tsv",
  "legacy.xls",
  "scan.pdf",
  "no-extension",
  ".hidden",
  "trailing.",
];

describe("sniffing arbitrary bytes", () => {
  it("never throws and always lands in the closed format union", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ maxLength: 4096 }),
        fc.constantFrom(...NAMES),
        async (bytes, declaredName) => {
          const result = await sniffContent(bytesSource(bytes), declaredName);

          if (result.format.kind === "delimited") {
            expect(DELIMITERS).toContain(result.format.delimiter);
            expect(TEXT_ENCODINGS).toContain(result.format.encoding);
            expect(NEWLINE_CONVENTIONS).toContain(result.format.newline);
            expect([0, 2, 3]).toContain(result.format.bomByteLength);
          }
          // Refusal routing is total over whatever sniffing produced.
          classifyRefusal(result);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("reads no more than the sample window whatever the file size", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 40_000 }),
        async (bytes) => {
          const source = countingSource(bytesSource(bytes));
          await sniffContent(source, "x.csv");

          expect(source.bytesRead).toBeLessThanOrEqual(SNIFF_SAMPLE_BYTES);
          expect(source.largestRead).toBeLessThanOrEqual(SNIFF_SAMPLE_BYTES);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("decides on content alone — the declared name never moves the verdict", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ maxLength: 2048 }),
        async (bytes) => {
          const verdicts = await Promise.all(
            NAMES.map(async (name) =>
              (await sniffContent(bytesSource(bytes), name)).format,
            ),
          );
          for (const verdict of verdicts) {
            expect(verdict).toEqual(verdicts[0]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
