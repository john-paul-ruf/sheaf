import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { WorkbookFactStreamItemV2 } from "../../../src/import/facts/index.js";
import { readXlsbInventory } from "../../../src/import/formats/xlsb/inventory.js";
import { xlsbAdapter } from "../../../src/import/formats/xlsb/parse.js";
import { openXlsbRecords } from "../../../src/import/formats/xlsb/records.js";
import { isBoundExceeded } from "../../../src/import/source/bounds.js";
import { openZipContainer } from "../../../src/import/source/zip.js";
import { writeZip } from "../../fixtures/workbooks/build/zip-writer.js";
import { xlsbEntries } from "../../fixtures/workbooks/xlsb/build-xlsb.js";
import { FIELDWORK_JOBS } from "../../fixtures/workbooks/xlsb/build-fidelity.js";
import { assertConformingStream } from "../../unit/import/facts/conformance.js";
import { bytesSource } from "../../unit/import/fixtures.js";

/**
 * Stored (uncompressed) parts, so a flipped byte lands in a BIFF12 record
 * rather than in deflate. The entry CRC still fails at each part's end, but
 * only after every corrupted record has been through the readers.
 */
const VALID = writeZip(
  xlsbEntries({
    ...FIELDWORK_JOBS,
    sheets: FIELDWORK_JOBS.sheets.map((sheet) => ({ ...sheet, rows: (sheet.rows ?? []).slice(0, 12) })),
  }).map((entry) => ({ ...entry, method: "stored" as const })),
);

/** Either a bound refusal, or a complete stream that conforms. */
const expectBoundedOrConforming = async (bytes: Uint8Array): Promise<void> => {
  try {
    const zip = await openZipContainer(bytesSource(bytes));
    const inventory = await readXlsbInventory.readInventory({ kind: "zip", zip });
    if (inventory.kind !== "inventory") return;
    const items: WorkbookFactStreamItemV2[] = [];
    for await (const item of xlsbAdapter.parseSheets(
      { kind: "zip", zip },
      inventory.inventory.sheets.map((sheet) => sheet.sheetIndex),
      { cancellation: { aborted: false } },
    )) {
      items.push(item);
    }
    assertConformingStream(items);
  } catch (cause) {
    if (!isBoundExceeded(cause)) throw cause;
  }
};

describe("XLSB reader bounds (property)", () => {
  it("the record reader only ever refuses with a bound, on arbitrary bytes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 512 }), fc.integer({ min: 1, max: 64 }), async (bytes, chunk) => {
        const chunks: Uint8Array[] = [];
        for (let at = 0; at < bytes.length; at += chunk) chunks.push(bytes.subarray(at, at + chunk));
        const records = openXlsbRecords(
          (async function* () {
            for (const each of chunks) yield await Promise.resolve(each);
          })(),
        );
        try {
          for (let record = await records.next(); record !== null; record = await records.next()) {
            expect(record.body.byteLength).toBeLessThanOrEqual(bytes.length);
          }
        } catch (cause) {
          expect(isBoundExceeded(cause)).toBe(true);
        }
      }),
      { numRuns: 1500 },
    );
  });

  it("inventory and adapter end in a bound refusal or a conforming stream when parts are corrupted", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.nat({ max: VALID.length - 1 }), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 6 }),
        async (flips) => {
          const bytes = Uint8Array.from(VALID);
          for (const [at, value] of flips) bytes[at] = value;
          await expectBoundedOrConforming(bytes);
        },
      ),
      { numRuns: 300 },
    );
  }, 120_000);
});
