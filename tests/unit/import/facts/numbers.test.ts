import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isCanonicalDecimal } from "../../../../src/domain/model/values.js";
import {
  BUILTIN_NUMBER_FORMATS,
  classifyNumberFormat,
  decimalCellOfDouble,
  decimalTextOfDouble,
} from "../../../../src/import/facts/index.js";

describe("doubles as canonical decimals", () => {
  it("writes the shortest round-tripping decimal, exponents expanded", () => {
    const cases: [number, string][] = [
      [0.1, "0.1"],
      [0.30000000000000004, "0.30000000000000004"],
      [-0, "0"],
      [1250.5, "1250.5"],
      [-42, "-42"],
      [1e21, "1000000000000000000000"],
      [1.5e-7, "0.00000015"],
      [123456789.125, "123456789.125"],
      [5e-324, `0.${"0".repeat(323)}5`],
    ];
    for (const [value, text] of cases) {
      expect(decimalTextOfDouble(value), String(value)).toBe(text);
    }
  });

  it("reads back to the same double for every finite double", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (value) => {
        const text = decimalTextOfDouble(value);
        expect(Number(text)).toBe(value === 0 ? 0 : value);
        expect(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)).toBe(true);
        const cell = decimalCellOfDouble(value);
        if (cell !== null) {
          expect(isCanonicalDecimal(text)).toBe(true);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("has no canonical cell for a double past 34 significant digits", () => {
    expect(decimalCellOfDouble(1e40)).toBeNull();
    expect(decimalCellOfDouble(Number.NaN)).toBeNull();
    expect(decimalCellOfDouble(12.75)).toEqual({ kind: "decimal", decimal: "12.75" });
  });
});

describe("number format classes", () => {
  it("classifies authored codes by their tokens, not their literals", () => {
    const cases: [string, string, string | null][] = [
      ['"$"#,##0.00', "currency", "$"],
      ["[$€-407] #,##0.00", "currency", "€"],
      ["£#,##0", "currency", "£"],
      ["yyyy-mm-dd", "date", null],
      ["d mmm yyyy", "date", null],
      ["h:mm AM/PM", "time", null],
      ["[h]:mm", "time", null],
      ["yyyy-mm-dd hh:mm", "datetime", null],
      ["0.0%", "percent", null],
      ['0 "days"', "number", null],
      ["#,##0.00", "number", null],
      ["@", "text", null],
      ["General", "general", null],
      [";;;", "other", null],
    ];
    for (const [code, formatClass, currencySymbol] of cases) {
      expect(classifyNumberFormat(code), code).toEqual({ formatClass, currencySymbol });
    }
  });

  it("names every built-in 0–22 and 37–49 with its class", () => {
    expect(BUILTIN_NUMBER_FORMATS.get(14)).toMatchObject({ formatClass: "date" });
    expect(BUILTIN_NUMBER_FORMATS.get(44)).toMatchObject({ formatClass: "currency", currencySymbol: null });
    expect(BUILTIN_NUMBER_FORMATS.get(49)).toMatchObject({ code: "@", formatClass: "text" });
    expect([...BUILTIN_NUMBER_FORMATS.keys()]).toHaveLength(36);
  });
});
