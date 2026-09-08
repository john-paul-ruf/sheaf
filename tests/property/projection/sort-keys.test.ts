import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CodecError } from "../../../src/domain/model/errors.js";
import { isCanonicalDecimal } from "../../../src/domain/model/values.js";
import {
  compareSortKeys,
  DECIMAL_ORDER_KEY_BYTES,
  decimalOrderKeyV1,
  MAX_ADJUSTED_EXPONENT,
  MIN_ADJUSTED_EXPONENT,
  textSortKeyV1,
} from "../../../src/persistence/projection/sort-keys.js";

/**
 * CA-13's exactness proof: the projection's two order keys must reproduce the
 * orders they claim to index — numeric order for decimals, code-point order for
 * text — over generated values rather than over a handful of examples.
 *
 * The decimal comparison below is exact and integer-only. Comparing through a
 * float would prove the keys agree with the very coercion the projection exists
 * to avoid (database.md § Canonical values: "never coerces these values to
 * SQLite REAL for equality or sort").
 */

interface ParsedDecimal {
  readonly negative: boolean;
  /** Significant digits, leading and trailing zeroes removed. */
  readonly coefficient: string;
  /** Base-10 exponent of the last coefficient digit. */
  readonly exponent: number;
}

const parseExact = (decimal: string): ParsedDecimal => {
  const negative = decimal.startsWith("-");
  const magnitude = negative ? decimal.slice(1) : decimal;
  const pointIndex = magnitude.indexOf(".");
  const digits =
    pointIndex < 0
      ? magnitude
      : magnitude.slice(0, pointIndex) + magnitude.slice(pointIndex + 1);
  const fraction = pointIndex < 0 ? 0 : magnitude.length - pointIndex - 1;
  const trimmed = digits.replace(/^0+/, "").replace(/0+$/, "");
  if (trimmed === "") {
    return { negative: false, coefficient: "", exponent: 0 };
  }
  const trailing = digits.length - digits.replace(/0+$/, "").length;
  return { negative, coefficient: trimmed, exponent: trailing - fraction };
};

/** Exact numeric comparison of two canonical decimals; no floats anywhere. */
const compareDecimals = (left: string, right: string): number => {
  const a = parseExact(left);
  const b = parseExact(right);
  if (a.coefficient === "" && b.coefficient === "") return 0;
  if (a.coefficient === "") return b.negative ? 1 : -1;
  if (b.coefficient === "") return a.negative ? -1 : 1;
  if (a.negative !== b.negative) return a.negative ? -1 : 1;

  const sign = a.negative ? -1 : 1;
  const adjustedA = a.exponent + a.coefficient.length - 1;
  const adjustedB = b.exponent + b.coefficient.length - 1;
  if (adjustedA !== adjustedB) {
    return adjustedA < adjustedB ? -sign : sign;
  }
  const width = Math.max(a.coefficient.length, b.coefficient.length);
  const padded = [a.coefficient.padEnd(width, "0"), b.coefficient.padEnd(width, "0")];
  if (padded[0] === padded[1]) return 0;
  return (padded[0] as string) < (padded[1] as string) ? -sign : sign;
};

const decimalArbitrary = fc
  .tuple(
    fc.boolean(),
    fc.oneof(
      { weight: 1, arbitrary: fc.constant("0") },
      {
        weight: 6,
        arbitrary: fc
          .tuple(fc.integer({ min: 1, max: 9 }), fc.stringMatching(/^[0-9]{0,16}$/))
          .map(([lead, rest]) => `${lead}${rest}`),
      },
    ),
    fc.option(fc.stringMatching(/^[0-9]{1,16}$/), { nil: undefined }),
  )
  .map(
    ([negative, integerPart, fraction]) =>
      `${negative ? "-" : ""}${integerPart}${fraction === undefined ? "" : `.${fraction}`}`,
  )
  .filter(isCanonicalDecimal);

/** Values chosen to sit on the boundaries the key encoding cares about. */
const EDGE_DECIMALS = [
  "0",
  "0.0",
  "1",
  "-1",
  "0.1",
  "-0.1",
  "9.9",
  "10",
  "-10",
  "10.50",
  "10.5",
  "0.001",
  "-0.001",
  "1000000000000000000000000000000000",
  "-1000000000000000000000000000000000",
  "9999999999999999999999999999999999",
  "0.0000000000000000000000000000000001",
];

describe("decimal order key v1", () => {
  it("orders exactly as the numbers order", () => {
    fc.assert(
      fc.property(decimalArbitrary, decimalArbitrary, (left, right) => {
        const leftKey = decimalOrderKeyV1(left);
        const rightKey = decimalOrderKeyV1(right);
        if (leftKey === null || rightKey === null) {
          return;
        }

        expect(leftKey).toHaveLength(DECIMAL_ORDER_KEY_BYTES);
        expect(rightKey).toHaveLength(DECIMAL_ORDER_KEY_BYTES);
        expect(Math.sign(compareSortKeys(leftKey, rightKey))).toBe(
          Math.sign(compareDecimals(left, right)),
        );
      }),
      { numRuns: 2000 },
    );
  });

  it("orders the boundary values exactly as the numbers order", () => {
    for (const left of EDGE_DECIMALS) {
      for (const right of EDGE_DECIMALS) {
        const leftKey = decimalOrderKeyV1(left);
        const rightKey = decimalOrderKeyV1(right);
        expect(leftKey).not.toBeNull();
        expect(rightKey).not.toBeNull();
        expect(
          Math.sign(compareSortKeys(leftKey as Uint8Array, rightKey as Uint8Array)),
        ).toBe(Math.sign(compareDecimals(left, right)));
      }
    }
  });

  it("gives every spelling of zero one key, between the signs", () => {
    const zero = decimalOrderKeyV1("0") as Uint8Array;
    expect(decimalOrderKeyV1("0.0")).toEqual(zero);
    expect(decimalOrderKeyV1("0.000")).toEqual(zero);
    expect(zero[0]).toBe(0x01);
    expect(compareSortKeys(decimalOrderKeyV1("-0.001") as Uint8Array, zero)).toBeLessThan(0);
    expect(compareSortKeys(decimalOrderKeyV1("0.001") as Uint8Array, zero)).toBeGreaterThan(0);
  });

  it("refuses a decimal that is not canonical", () => {
    for (const rejected of ["1e5", "+1", " 1", "1.", ".5", "NaN", "01"]) {
      expect(() => decimalOrderKeyV1(rejected)).toThrow(CodecError);
    }
  });

  it("has no key for a value outside the v1 exponent domain", () => {
    const belowDomain = `0.${"0".repeat(-MIN_ADJUSTED_EXPONENT)}1`;
    const insideDomain = `0.${"0".repeat(-MIN_ADJUSTED_EXPONENT - 1)}1`;

    expect(isCanonicalDecimal(belowDomain)).toBe(true);
    expect(decimalOrderKeyV1(belowDomain)).toBeNull();
    expect(decimalOrderKeyV1(insideDomain)).not.toBeNull();
    expect(MAX_ADJUSTED_EXPONENT).toBe(6144);
  });
});

/**
 * Code-point order, spelled out. JavaScript's `<` compares UTF-16 code units,
 * which disagrees with code-point order above the basic plane — so comparing
 * with `<` here would assert the wrong claim, not a stricter one.
 */
const compareCodePoints = (left: string, right: string): number => {
  const a = [...left];
  const b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference =
      (a[index] as string).codePointAt(0)! - (b[index] as string).codePointAt(0)!;
    if (difference !== 0) {
      return difference;
    }
  }
  return a.length - b.length;
};

const hasLoneSurrogate = (text: string): boolean =>
  /[\uD800-\uDFFF]/.test(text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""));

describe("text sort key v1", () => {
  it("orders exactly as code points order", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "grapheme" }),
        fc.string({ unit: "grapheme" }),
        (left, right) => {
          fc.pre(left.normalize("NFC") === left && right.normalize("NFC") === right);
          fc.pre(!hasLoneSurrogate(left) && !hasLoneSurrogate(right));

          const order = compareSortKeys(textSortKeyV1(left), textSortKeyV1(right));
          expect(Math.sign(order)).toBe(Math.sign(compareCodePoints(left, right)));
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("orders above the basic plane the way UTF-16 would not", () => {
    const astral = "\u{1F600}";
    const bmp = "�";

    expect(astral < bmp).toBe(true);
    expect(compareCodePoints(astral, bmp)).toBeGreaterThan(0);
    expect(
      compareSortKeys(textSortKeyV1(astral), textSortKeyV1(bmp)),
    ).toBeGreaterThan(0);
  });

  it("refuses text that is not NFC", () => {
    // "e" plus a combining acute: the same glyph as NFC "\u00e9", other bytes.
    expect(() => textSortKeyV1("e\u0301")).toThrow(CodecError);
    expect(textSortKeyV1("\u00e9")).toEqual(new Uint8Array([0xc3, 0xa9]));
  });
});
