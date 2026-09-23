import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BoundExceededError, CONTAINER_BOUNDS_V1 } from "../../../src/import/source/bounds.js";
import { openCfbContainer } from "../../../src/import/source/cfb.js";
import { MAX_SLICE_BYTES } from "../../../src/import/source/source.js";
import { openZipContainer } from "../../../src/import/source/zip.js";
import { writeCfb } from "../../fixtures/workbooks/build/cfb-writer.js";
import { PAYROLL } from "../../fixtures/workbooks/build/corpus.js";
import { buildOoxml } from "../../fixtures/workbooks/build/ooxml-builder.js";
import { bytesSource, countingSource } from "../../unit/import/fixtures.js";

const VALID_ZIP = buildOoxml(PAYROLL);
const VALID_CFB = writeCfb([
  { path: "Workbook", data: Uint8Array.from({ length: 5000 }, (_, index) => index % 251) },
  { path: "\u0005SummaryInformation", data: Uint8Array.from({ length: 300 }, (_, index) => index % 7) },
]);

/** The small bound any read at open may use: the end-record search window. */
const LARGEST_OPEN_READ = 22 + 65_535;

/** Hostile variants: arbitrary bytes, and a valid container with bytes flipped. */
const mutated = (valid: Uint8Array) =>
  fc.oneof(
    fc.uint8Array({ maxLength: 2048 }),
    fc
      .array(fc.tuple(fc.nat({ max: valid.length - 1 }), fc.integer({ min: 0, max: 255 })), {
        minLength: 1,
        maxLength: 8,
      })
      .map((flips) => {
        const bytes = Uint8Array.from(valid);
        for (const [index, value] of flips) bytes[index] = value;
        return bytes;
      }),
    fc.nat({ max: valid.length }).map((length) => valid.slice(0, length)),
  );

const expectOnlyBounds = async (work: () => Promise<void>): Promise<void> => {
  try {
    await work();
  } catch (cause) {
    expect(cause).toBeInstanceOf(BoundExceededError);
  }
};

describe("containers on hostile bytes", () => {
  it("zip: finishes, throws only BoundExceededError, and reads within its caps", async () => {
    await fc.assert(
      fc.asyncProperty(mutated(VALID_ZIP), async (bytes) => {
        const source = countingSource(bytesSource(bytes));
        await expectOnlyBounds(async () => {
          const zip = await openZipContainer(source);
          expect(source.largestRead).toBeLessThanOrEqual(LARGEST_OPEN_READ);
          for (const entry of zip.entries) {
            await expectOnlyBounds(async () => {
              await zip.readEntry(entry.name, { maxBytes: 1_048_576 });
            });
          }
          expect(zip.expandedByteCount).toBeLessThanOrEqual(CONTAINER_BOUNDS_V1.maxTotalExpandedBytes);
        });
        expect(source.largestRead).toBeLessThanOrEqual(MAX_SLICE_BYTES);
        expect(source.bytesRead).toBeLessThanOrEqual(LARGEST_OPEN_READ + 4 * bytes.length);
      }),
      { numRuns: 300 },
    );
  }, 60_000);

  it("cfb: finishes, throws only BoundExceededError, and reads within its caps", async () => {
    await fc.assert(
      fc.asyncProperty(mutated(VALID_CFB), async (bytes) => {
        const source = countingSource(bytesSource(bytes));
        await expectOnlyBounds(async () => {
          const cfb = await openCfbContainer(source);
          for (const stream of cfb.listStreams()) {
            await expectOnlyBounds(async () => {
              await cfb.readStream(stream.path, { maxBytes: 1_048_576 });
            });
          }
        });
        expect(source.largestRead).toBeLessThanOrEqual(65_536);
        expect(source.bytesRead).toBeLessThanOrEqual(512 + 4 * bytes.length);
      }),
      { numRuns: 300 },
    );
  }, 60_000);
});
