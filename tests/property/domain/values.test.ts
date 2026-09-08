import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { encodeCanonical } from "../../../src/persistence/codecs/canonical-cbor.js";
import {
  BLANK_VALUE,
  MAX_EPOCH_DAY,
  MIN_EPOCH_DAY,
  MISSING_VALUE,
  canonicalizeDecimal,
  cellValuesEqual,
  dateValue,
  invalidPreservedValue,
  isCanonicalDecimal,
  isNfcText,
  textValue,
} from "../../../src/domain/model/values.js";

/** Grammar-valid decimals, including the negative zeroes that get rewritten. */
const canonicalDecimalArbitrary = fc
  .tuple(
    fc.boolean(),
    fc.oneof(
      fc.constant("0"),
      fc
        .tuple(
          fc.integer({ min: 1, max: 9 }),
          fc.stringMatching(/^[0-9]{0,10}$/),
        )
        .map(([lead, rest]) => `${lead}${rest}`),
    ),
    fc.option(fc.stringMatching(/^[0-9]{1,10}$/), { nil: undefined }),
  )
  .map(
    ([negative, integerPart, fraction]) =>
      `${negative ? "-" : ""}${integerPart}${fraction === undefined ? "" : `.${fraction}`}`,
  );

describe("value canonicalization", () => {
  it("is idempotent for every decimal it accepts", () => {
    fc.assert(
      fc.property(canonicalDecimalArbitrary, (decimal) => {
        const once = canonicalizeDecimal(decimal);
        expect(canonicalizeDecimal(once)).toBe(once);
        expect(isCanonicalDecimal(once)).toBe(true);

        // Zero has exactly one spelling; a negative value with a nonzero
        // digit (-0.10) keeps its sign and is not a negative zero.
        const allDigitsZero = /^0+$/.test(once.replace("-", "").replace(".", ""));
        expect(once.startsWith("-") && allDigitsZero).toBe(false);
      }),
    );
  });

  it("keeps NFC text unchanged and refuses the rest", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const nfc = text.normalize("NFC");
        expect(isNfcText(nfc)).toBe(true);
        expect(textValue(nfc)).toEqual({ kind: "text", text: nfc });
        // The codec that will carry this value applies the same rule, so a
        // domain-accepted string always encodes.
        expect(() => encodeCanonical(nfc)).not.toThrow();

        if (!isNfcText(text)) {
          expect(() => textValue(text)).toThrow();
        }
      }),
    );
  });

  it("accepts exactly the epoch days it declares", () => {
    fc.assert(
      fc.property(fc.integer(), (day) => {
        if (day >= MIN_EPOCH_DAY && day <= MAX_EPOCH_DAY) {
          expect(dateValue(day)).toEqual({ kind: "date", epochDay: day });
        } else {
          expect(() => dateValue(day)).toThrow();
        }
      }),
    );
  });

  it("never equates an absent state with a preserved source value", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const preserved = invalidPreservedValue(text.normalize("NFC"));

        expect(cellValuesEqual(preserved, MISSING_VALUE)).toBe(false);
        expect(cellValuesEqual(preserved, BLANK_VALUE)).toBe(false);
        expect(cellValuesEqual(MISSING_VALUE, BLANK_VALUE)).toBe(false);
        expect(cellValuesEqual(preserved, preserved)).toBe(true);
      }),
    );
  });
});
