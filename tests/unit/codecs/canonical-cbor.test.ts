import { describe, expect, it } from "vitest";
import {
  DEFAULT_DECODE_BUDGET,
  decodeCanonical,
  decodeCanonicalPrefix,
  encodeCanonical,
  type CborKey,
  type CborValue,
} from "../../../src/persistence/codecs/canonical-cbor.js";
import { CodecError } from "../../../src/domain/model/errors.js";

const hex = (text: string): Uint8Array =>
  Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** RFC 8949 § Appendix A, restricted to the value domain of codec v1. */
const RFC_8949_VECTORS: readonly (readonly [CborValue, string])[] = [
  [0n, "00"],
  [1n, "01"],
  [10n, "0a"],
  [23n, "17"],
  [24n, "1818"],
  [25n, "1819"],
  [100n, "1864"],
  [1000n, "1903e8"],
  [1000000n, "1a000f4240"],
  [1000000000000n, "1b000000e8d4a51000"],
  [18446744073709551615n, "1bffffffffffffffff"],
  [-1n, "20"],
  [-10n, "29"],
  [-100n, "3863"],
  [-1000n, "3903e7"],
  [-18446744073709551616n, "3bffffffffffffffff"],
  [false, "f4"],
  [true, "f5"],
  [null, "f6"],
  [new Uint8Array([]), "40"],
  [new Uint8Array([1, 2, 3, 4]), "4401020304"],
  ["", "60"],
  ["a", "6161"],
  ["IETF", "6449455446"],
  ['"\\', "62225c"],
  ["ü", "62c3bc"],
  ["水", "63e6b0b4"],
  [[], "80"],
  [[1n, 2n, 3n], "83010203"],
  [[1n, [2n, 3n], [4n, 5n]], "8301820203820405"],
  [
    Array.from({ length: 25 }, (_, index) => BigInt(index + 1)),
    "98190102030405060708090a0b0c0d0e0f101112131415161718181819",
  ],
  [new Map<CborKey, CborValue>(), "a0"],
  [
    new Map<CborKey, CborValue>([
      [1n, 2n],
      [3n, 4n],
    ]),
    "a201020304",
  ],
  [
    new Map<CborKey, CborValue>([
      ["a", 1n],
      ["b", [2n, 3n]],
    ]),
    "a26161016162820203",
  ],
  [["a", new Map<CborKey, CborValue>([["b", "c"]])], "826161a161626163"],
  [
    new Map<CborKey, CborValue>([
      ["a", "A"],
      ["b", "B"],
      ["c", "C"],
      ["d", "D"],
      ["e", "E"],
    ]),
    "a56161614161626142616361436164614461656145",
  ],
];

describe("canonical CBOR vectors", () => {
  it("encodes every RFC 8949 vector to its published bytes", () => {
    for (const [value, expected] of RFC_8949_VECTORS) {
      expect(toHex(encodeCanonical(value)), expected).toBe(expected);
    }
  });

  it("decodes every RFC 8949 vector back to the same bytes", () => {
    for (const [, expected] of RFC_8949_VECTORS) {
      expect(toHex(encodeCanonical(decodeCanonical(hex(expected)))), expected).toBe(
        expected,
      );
    }
  });

  it("encodes safe-integer numbers exactly like the equivalent bigint", () => {
    expect(toHex(encodeCanonical(1000))).toBe("1903e8");
    expect(decodeCanonical(encodeCanonical(-7))).toBe(-7n);
  });
});

describe("canonical CBOR canonicality rules", () => {
  it("sorts map keys by encoded bytes regardless of insertion order", () => {
    const shuffled = new Map<CborKey, CborValue>([
      ["b", 3n],
      ["aa", 2n],
      ["a", 1n],
    ]);
    // Length precedes content in the encoded key: "b" (6162) before "aa" (626161).
    expect(toHex(encodeCanonical(shuffled))).toBe("a361610161620362616102");
  });

  it("rejects a map whose keys are out of canonical order", () => {
    expect(() => decodeCanonical(hex("a2616201616101"))).toThrow(
      /not in canonical order/,
    );
  });

  it("rejects duplicate keys on both sides", () => {
    expect(() => decodeCanonical(hex("a2616101616102"))).toThrow(/duplicate keys/);
    const duplicating: ReadonlyMap<CborKey, CborValue> = new Map<CborKey, CborValue>(
      [
        [1n, 1n],
        [1, 2n],
      ],
    );
    expect(() => encodeCanonical(duplicating)).toThrow(/duplicate keys/);
  });

  it("rejects non-shortest integer arguments", () => {
    expect(() => decodeCanonical(hex("1817"))).toThrow(/shortest-form/);
    expect(() => decodeCanonical(hex("190018"))).toThrow(/shortest-form/);
    expect(() => decodeCanonical(hex("1a000000ff"))).toThrow(/shortest-form/);
    expect(() => decodeCanonical(hex("1b00000000ffffffff"))).toThrow(
      /shortest-form/,
    );
  });

  it("rejects indefinite lengths, tags, floats, and undefined", () => {
    expect(() => decodeCanonical(hex("5f42010243030405ff"))).toThrow(/indefinite/);
    expect(() => decodeCanonical(hex("9f0102ff"))).toThrow(/indefinite/);
    expect(() => decodeCanonical(hex("c11a514b67b0"))).toThrow(/tags/);
    expect(() => decodeCanonical(hex("fb3ff199999999999a"))).toThrow(/floats/);
    expect(() => decodeCanonical(hex("f97e00"))).toThrow(/floats/);
    expect(() => decodeCanonical(hex("f7"))).toThrow(/undefined/);
    expect(() => encodeCanonical(1.5)).toThrow(/safe-integer/);
    expect(() => encodeCanonical(Number.MAX_SAFE_INTEGER + 2)).toThrow(
      /safe-integer/,
    );
  });

  it("rejects values with no canonical encoding", () => {
    expect(() => encodeCanonical(undefined as unknown as CborValue)).toThrow(
      CodecError,
    );
    expect(() => encodeCanonical({ a: 1 } as unknown as CborValue)).toThrow(
      /no canonical CBOR encoding/,
    );
    expect(() => encodeCanonical(new Date(0) as unknown as CborValue)).toThrow(
      /no canonical CBOR encoding/,
    );
  });

  it("rejects non-NFC text on both sides", () => {
    expect(() => encodeCanonical("é")).toThrow(/NFC/);
    expect(() => decodeCanonical(hex("6365cc81"))).toThrow(/NFC/);
    expect(decodeCanonical(hex("62c3a9"))).toBe("é");
  });

  it("rejects invalid UTF-8", () => {
    expect(() => decodeCanonical(hex("62c328"))).toThrow(/UTF-8/);
  });

  it("rejects byte-string and composite map keys", () => {
    expect(() => decodeCanonical(hex("a1410101"))).toThrow(/map keys/);
  });

  it("rejects trailing bytes unless the caller decodes a prefix", () => {
    const withTail = hex("0100");
    expect(() => decodeCanonical(withTail)).toThrow(/trailing bytes/);
    expect(decodeCanonicalPrefix(withTail)).toEqual({ value: 1n, byteLength: 1 });
  });
});

describe("canonical CBOR bounds", () => {
  it("refuses input larger than the budget before reading it", () => {
    expect(() =>
      decodeCanonical(new Uint8Array(9), { ...DEFAULT_DECODE_BUDGET, maxBytes: 8 }),
    ).toThrow(/larger than the decode budget/);
  });

  it("refuses a declared length that exceeds the remaining input", () => {
    expect(() => decodeCanonical(hex("5affffffff"))).toThrow(
      /exceeds the remaining input/,
    );
    expect(() => decodeCanonical(hex("990100"))).toThrow(
      /exceeds the remaining input/,
    );
  });

  it("refuses more entries than the budget allows", () => {
    expect(() => decodeCanonical(hex("9bffffffffffffffff"))).toThrow(
      /more entries than the budget/,
    );
    expect(() =>
      decodeCanonical(hex("9903e8"), { ...DEFAULT_DECODE_BUDGET, maxEntries: 4 }),
    ).toThrow(/more entries than the budget/);
  });

  it("refuses nesting deeper than the budget on both sides", () => {
    const nest = (depth: number): CborValue => (depth === 0 ? 1n : [nest(depth - 1)]);
    const deep = encodeCanonical(nest(DEFAULT_DECODE_BUDGET.maxDepth - 1));

    expect(decodeCanonical(deep)).toBeDefined();
    expect(() =>
      decodeCanonical(deep, { ...DEFAULT_DECODE_BUDGET, maxDepth: 4 }),
    ).toThrow(/deeper than the decode budget/);
    expect(() => encodeCanonical(nest(DEFAULT_DECODE_BUDGET.maxDepth + 1))).toThrow(
      /deeper than the codec depth bound/,
    );
  });

  it("refuses an input that ends inside a value", () => {
    expect(() => decodeCanonical(hex("18"))).toThrow(/ended inside a value/);
    expect(() => decodeCanonical(new Uint8Array())).toThrow(/ended inside a value/);
  });
});
