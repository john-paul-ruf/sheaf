import { describe, expect, it } from "vitest";
import { CodecError } from "../../../src/domain/model/errors.js";
import { asDomainId } from "../../../src/domain/model/ids.js";
import {
  BLANK_VALUE,
  DECIMAL_SIGNIFICANT_DIGIT_LIMIT,
  MAX_EPOCH_DAY,
  MIN_EPOCH_DAY,
  MISSING_VALUE,
  booleanValue,
  canonicalizeDecimal,
  cellValuesEqual,
  dateValue,
  decimalValue,
  enumValue,
  invalidPreservedValue,
  isAbsentCellValue,
  isCanonicalDecimal,
  isNfcText,
  referenceValue,
  textValue,
} from "../../../src/domain/model/values.js";

const optionId = asDomainId("option", new Uint8Array(16).fill(1));
const otherOptionId = asDomainId("option", new Uint8Array(16).fill(2));
const recordId = asDomainId("record", new Uint8Array(16).fill(3));

describe("cell values", () => {
  it("keeps missing, blank, and invalid-preserved distinct", () => {
    const invalid = invalidPreservedValue("not a number");

    expect(cellValuesEqual(MISSING_VALUE, BLANK_VALUE)).toBe(false);
    expect(cellValuesEqual(MISSING_VALUE, invalid)).toBe(false);
    expect(cellValuesEqual(BLANK_VALUE, invalid)).toBe(false);
    expect(cellValuesEqual(BLANK_VALUE, textValue(""))).toBe(false);
    expect(cellValuesEqual(MISSING_VALUE, decimalValue("0"))).toBe(false);

    expect(isAbsentCellValue(MISSING_VALUE)).toBe(true);
    expect(isAbsentCellValue(BLANK_VALUE)).toBe(true);
    // An invalid preserved value still holds text a user can see and fix.
    expect(isAbsentCellValue(invalid)).toBe(false);
    expect(invalid).toEqual({
      kind: "invalid-preserved",
      sourceText: "not a number",
    });
  });

  it("refuses text that is not NFC rather than normalizing it", () => {
    const nfd = "é";
    const nfc = "é";

    expect(isNfcText(nfc)).toBe(true);
    expect(isNfcText(nfd)).toBe(false);
    expect(() => textValue(nfd)).toThrow(CodecError);
    expect(() => invalidPreservedValue(nfd)).toThrow(CodecError);
    expect(textValue(nfc)).toEqual({ kind: "text", text: nfc });
  });

  it("accepts canonical decimals and rejects every other spelling", () => {
    for (const accepted of ["0", "1", "-1", "10.50", "0.001", "-12345.6789"]) {
      expect(isCanonicalDecimal(accepted), accepted).toBe(true);
      expect(decimalValue(accepted)).toEqual({
        kind: "decimal",
        decimal: accepted,
      });
    }

    for (const rejected of [
      "1e5",
      "1E5",
      "+5",
      ".5",
      "5.",
      "01",
      "-01",
      "1,000",
      " 1",
      "1 ",
      "",
      "-",
      "Infinity",
      "NaN",
      "0x10",
      "1.2.3",
    ]) {
      expect(isCanonicalDecimal(rejected), rejected).toBe(false);
      expect(() => decimalValue(rejected), rejected).toThrow(CodecError);
    }
  });

  it("normalizes negative zero to one spelling", () => {
    expect(canonicalizeDecimal("-0")).toBe("0");
    expect(canonicalizeDecimal("-0.00")).toBe("0.00");
    expect(canonicalizeDecimal("-0.01")).toBe("-0.01");
    expect(isCanonicalDecimal("-0")).toBe(false);
    expect(decimalValue("-0")).toEqual({ kind: "decimal", decimal: "0" });
  });

  it("caps decimals at 34 significant digits", () => {
    const thirtyFour = "1".repeat(DECIMAL_SIGNIFICANT_DIGIT_LIMIT);

    expect(isCanonicalDecimal(thirtyFour)).toBe(true);
    expect(isCanonicalDecimal(`${thirtyFour}1`)).toBe(false);
    expect(() => decimalValue(`${thirtyFour}1`)).toThrow(
      /34 significant digits/,
    );

    // Leading zeroes are not significant; trailing ones are.
    expect(isCanonicalDecimal(`0.${"0".repeat(20)}${thirtyFour}`)).toBe(true);
    expect(isCanonicalDecimal(`${thirtyFour.slice(0, 33)}.0`)).toBe(true);
    expect(isCanonicalDecimal(`${thirtyFour}.0`)).toBe(false);
  });

  it("bounds dates to whole representable epoch days", () => {
    expect(dateValue(0)).toEqual({ kind: "date", epochDay: 0 });
    expect(dateValue(MIN_EPOCH_DAY).kind).toBe("date");
    expect(dateValue(MAX_EPOCH_DAY).kind).toBe("date");

    for (const rejected of [
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MIN_EPOCH_DAY - 1,
      MAX_EPOCH_DAY + 1,
    ]) {
      expect(() => dateValue(rejected), String(rejected)).toThrow(CodecError);
    }
  });

  it("compares typed values by their own semantics", () => {
    expect(cellValuesEqual(enumValue(optionId), enumValue(optionId))).toBe(true);
    expect(cellValuesEqual(enumValue(optionId), enumValue(otherOptionId))).toBe(
      false,
    );
    expect(cellValuesEqual(booleanValue(true), booleanValue(false))).toBe(false);
    expect(cellValuesEqual(dateValue(1), dateValue(1))).toBe(true);
    expect(cellValuesEqual(decimalValue("1.0"), decimalValue("1"))).toBe(false);
    expect(
      cellValuesEqual(referenceValue(recordId), referenceValue(recordId)),
    ).toBe(true);
    // An enum and a reference both carry 16 bytes; they are never equal.
    expect(
      cellValuesEqual(
        enumValue(optionId),
        referenceValue(asDomainId("record", new Uint8Array(16).fill(1))),
      ),
    ).toBe(false);
  });
});
