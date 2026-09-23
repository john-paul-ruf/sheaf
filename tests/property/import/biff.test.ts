import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { WorkbookFactStreamItemV2 } from "../../../src/import/facts/index.js";
import { readBiffInventory } from "../../../src/import/formats/biff/inventory.js";
import { biffAdapter } from "../../../src/import/formats/biff/parse.js";
import { decodePtgFormula, PTG_UNDECODABLE_REASONS, type PtgFormatV1 } from "../../../src/import/formats/biff/ptg.js";
import { isBoundExceeded } from "../../../src/import/source/bounds.js";
import { openCfbContainer } from "../../../src/import/source/cfb.js";
import { buildBiffWorkbook } from "../../fixtures/workbooks/biff/build-biff.js";
import { BIFF_FIDELITY } from "../../fixtures/workbooks/biff/build-fidelity.js";
import { CASES, contextFor } from "../../unit/import/biff/ptg-cases.js";
import { assertConformingStream } from "../../unit/import/facts/conformance.js";
import { bytesSource } from "../../unit/import/fixtures.js";

const FIDELITY_FORMULAS = BIFF_FIDELITY.get("formulas.xls") ?? (() => {
  throw new Error("formulas.xls");
})();

const FORMATS = fc.constantFrom<PtgFormatV1>("biff8", "biff12");
const CELL = fc.option(fc.record({ row: fc.nat({ max: 70_000 }), column: fc.nat({ max: 300 }) }), { nil: null });

const isResult = (result: ReturnType<typeof decodePtgFormula>): boolean =>
  "text" in result ? typeof result.text === "string" : PTG_UNDECODABLE_REASONS.includes(result.undecodable);

describe("Ptg decoder bounds (property)", () => {
  it("never throws on arbitrary token and extra bytes, in either width", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 96 }), fc.uint8Array({ maxLength: 64 }), FORMATS, CELL, (rgce, rgcb, format, cell) => {
        expect(isResult(decodePtgFormula(rgce, contextFor(format, cell), rgcb))).toBe(true);
      }),
      { numRuns: 3000 },
    );
  });

  it("never throws when a valid stream has bytes flipped", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: CASES.length - 1 }),
        FORMATS,
        fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 4 }),
        (index, format, flips) => {
          const writer = (CASES[index] as (typeof CASES)[number])[1](format);
          const rgce = Uint8Array.from(writer.rgce);
          for (const [at, value] of flips) rgce[at % Math.max(1, rgce.length)] = value;
          expect(isResult(decodePtgFormula(rgce, contextFor(format), writer.rgcb))).toBe(true);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("produces no text for an invalid stream: an extra operand, or an unknown token, after any valid formula", () => {
    fc.assert(
      fc.property(fc.nat({ max: CASES.length - 1 }), FORMATS, fc.constantFrom(0x1a, 0x1b, 0x3e, 0x3f), (index, format, unknown) => {
        const writer = (CASES[index] as (typeof CASES)[number])[1](format);
        const context = contextFor(format);
        const extraOperand = Uint8Array.from([...writer.rgce, 0x1e, 0x01, 0x00]);
        expect(decodePtgFormula(extraOperand, context, writer.rgcb)).toEqual({ undecodable: "unbalanced-stack" });
        const unknownToken = Uint8Array.from([...writer.rgce, unknown]);
        expect(decodePtgFormula(unknownToken, context, writer.rgcb)).toEqual({ undecodable: "unknown-token" });
      }),
    );
  });

  it("produces no text for a valid formula cut inside its last operand", () => {
    fc.assert(
      fc.property(fc.nat({ max: CASES.length - 1 }), FORMATS, (index, format) => {
        const writer = (CASES[index] as (typeof CASES)[number])[1](format);
        // Every case ends in an operand-carrying token or a one-byte operator;
        // dropping the final byte of a multi-byte token leaves it truncated.
        const last = writer.rgce.at(-1);
        const cut = writer.rgce.slice(0, -1);
        const result = decodePtgFormula(cut, contextFor(format), writer.rgcb);
        if (last !== undefined && [0x03, 0x04, 0x05, 0x07, 0x08, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15].includes(last)) {
          return;
        }
        expect("undecodable" in result, CASES[index]?.[0]).toBe(true);
      }),
    );
  });
});

describe("BIFF reader bounds (property)", () => {
  const VALID = buildBiffWorkbook(FIDELITY_FORMULAS);

  it("inventory and adapter end in a bound refusal or a conforming stream when the file is corrupted", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.nat({ max: VALID.length - 1 }), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 6 }),
        async (flips) => {
          const bytes = Uint8Array.from(VALID);
          for (const [at, value] of flips) bytes[at] = value;
          try {
            const cfb = await openCfbContainer(bytesSource(bytes));
            const inventory = await readBiffInventory.readInventory({ kind: "cfb", cfb });
            if (inventory.kind !== "inventory") return;
            const items: WorkbookFactStreamItemV2[] = [];
            for await (const item of biffAdapter.parseSheets(
              { kind: "cfb", cfb },
              inventory.inventory.sheets.map((sheet) => sheet.sheetIndex),
              { cancellation: { aborted: false } },
            )) {
              items.push(item);
            }
            assertConformingStream(items);
          } catch (cause) {
            if (!isBoundExceeded(cause)) throw cause;
          }
        },
      ),
      { numRuns: 400 },
    );
  }, 120_000);
});
