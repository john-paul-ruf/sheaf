import { describe, expect, it } from "vitest";
import { parseFormula } from "../../../../src/domain/formulas/index.js";
import {
  decodePtgFormula,
  FIXED_ARITY,
  FUNCTION_NAMES,
  PTG_UNDECODABLE_REASONS,
  ptgExpOf,
  type PtgContextV1,
  type PtgFormatV1,
  type PtgUndecodableReasonV1,
} from "../../../../src/import/formats/biff/ptg.js";
import { ptg, type PtgWriter } from "../../../fixtures/workbooks/biff/ptg-writer.js";
import { CASES, contextFor } from "./ptg-cases.js";

describe("decodePtgFormula — one fixture per token class, both operand widths", () => {
  for (const format of ["biff8", "biff12"] as const) {
    for (const [what, write, expected] of CASES) {
      it(`${format}: ${what}`, () => {
        const writer = write(format);
        expect(decodePtgFormula(writer.rgce, contextFor(format), writer.rgcb)).toEqual({ text: expected });
      });
    }
  }
});

describe("every decoded text parses with M03 (S02's parser)", () => {
  /**
   * `[1]!TaxRate` is Excel's own spelling of an external workbook's defined
   * name; M03's subset refuses it today. Pinned so the day M03 reads it, this
   * test says so.
   */
  const M03_GAPS = new Set(["an external defined name"]);
  for (const format of ["biff8", "biff12"] as const) {
    it(`${format}: all ${CASES.length} fixture texts`, () => {
      for (const [what, write] of CASES) {
        const writer = write(format);
        const decoded = decodePtgFormula(writer.rgce, contextFor(format), writer.rgcb);
        if (!("text" in decoded)) throw new Error(`${what} did not decode`);
        const parsed = parseFormula(decoded.text);
        if (M03_GAPS.has(what)) expect(parsed, what).toEqual({ kind: "unparsed", reason: "unsupported-token" });
        else expect(parsed.kind, `${what}: ${decoded.text}`).toBe("parsed");
      }
    });
  }
});

describe("the function table", () => {
  it("pins the lookup functions by id (MS-XLS Ftab)", () => {
    expect(FUNCTION_NAMES[102]).toBe("VLOOKUP");
    expect(FUNCTION_NAMES[101]).toBe("HLOOKUP");
    expect(FUNCTION_NAMES[28]).toBe("LOOKUP");
    expect(FUNCTION_NAMES[29]).toBe("INDEX");
    expect(FUNCTION_NAMES[64]).toBe("MATCH");
  });

  it("is data: frozen, 0–380, with fixed arities only for assigned ids", () => {
    expect(Object.isFrozen(FUNCTION_NAMES)).toBe(true);
    expect(FUNCTION_NAMES).toHaveLength(381);
    expect(FUNCTION_NAMES[4]).toBe("SUM");
    expect(FUNCTION_NAMES[346]).toBe("COUNTIF");
    expect(FUNCTION_NAMES[380]).toBe("CUBEVALUE");
    for (const id of FIXED_ARITY.keys()) expect(FUNCTION_NAMES[id], String(id)).not.toBe("");
    expect(FIXED_ARITY.get(27)).toBe(2);
    expect(FIXED_ARITY.has(102)).toBe(false);
  });
});

describe("undecodable streams — every reason, never a guess", () => {
  const cases: readonly [PtgUndecodableReasonV1, PtgFormatV1, (format: PtgFormatV1) => PtgWriter, PtgContextV1?][] = [
    ["truncated", "biff8", (f) => ptg(f).raw(0x24, 0x01)],
    ["unknown-token", "biff8", (f) => ptg(f).raw(0x1a)],
    ["unbalanced-stack", "biff12", (f) => ptg(f).int(1).int(2)],
    ["unbalanced-stack", "biff8", (f) => ptg(f).add()],
    ["shared-formula-reference", "biff8", (f) => ptg(f).exp(1, 2)],
    ["data-table", "biff8", (f) => ptg(f).tbl(1, 2)],
    ["structured-reference", "biff12", (f) => ptg(f).raw(0x18, 0x19, ...new Array<number>(12).fill(0))],
    ["unknown-function", "biff8", (f) => ptg(f).func(102)],
    ["unknown-function", "biff12", (f) => ptg(f).funcVar(400, 0)],
    ["macro-function", "biff8", (f) => ptg(f).funcVar(0x8000 | 5, 0)],
    ["unknown-name", "biff8", (f) => ptg(f).name(99)],
    ["unknown-sheet", "biff12", (f) => ptg(f).ref3d(99, 0, 0)],
    ["unknown-sheet", "biff8", (f) => ptg(f).ref3d(2, 0, 0)],
    ["relative-without-cell", "biff8", (f) => ptg(f).refN(-1, 0), contextFor("biff8", null)],
  ];

  it("names every reason in the closed list", () => {
    expect(new Set(cases.map(([reason]) => reason))).toEqual(new Set(PTG_UNDECODABLE_REASONS));
  });

  for (const [reason, format, write, context] of cases) {
    it(`${format}: ${reason}`, () => {
      const writer = write(format);
      expect(decodePtgFormula(writer.rgce, context ?? contextFor(format), writer.rgcb)).toEqual({ undecodable: reason });
    });
  }

  it("an absolute reference outside the format's grid is not text", () => {
    expect(decodePtgFormula(ptg("biff8").ref(0, 300).rgce, contextFor("biff8"))).toEqual({ undecodable: "unknown-token" });
  });

  it("an array constant with its extra data missing is truncated", () => {
    expect(decodePtgFormula(ptg("biff12").array([[1]]).rgce, contextFor("biff12"))).toEqual({ undecodable: "truncated" });
  });
});

describe("ptgExpOf", () => {
  it("finds the master of a shared/array member in both widths", () => {
    expect(ptgExpOf(ptg("biff8").exp(1, 2).rgce, "biff8")).toEqual({ row: 1, column: 2 });
    expect(ptgExpOf(ptg("biff12").exp(40, 0).rgce, "biff12")).toEqual({ row: 40, column: null });
    expect(ptgExpOf(ptg("biff8").int(1).rgce, "biff8")).toBeNull();
    expect(ptgExpOf(Uint8Array.of(0x01, 0x02), "biff8")).toBeNull();
  });
});
