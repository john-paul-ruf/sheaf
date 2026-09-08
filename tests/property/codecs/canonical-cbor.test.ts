import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  decodeCanonical,
  encodeCanonical,
  type CborKey,
  type CborValue,
} from "../../../src/persistence/codecs/canonical-cbor.js";

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** NFC text only: non-NFC input is rejected by contract, not round-tripped. */
const nfcText = fc.string().map((text) => text.normalize("NFC"));

const leaf: fc.Arbitrary<CborValue> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.bigInt({ min: -(2n ** 64n), max: 2n ** 64n - 1n }),
  nfcText,
  fc.uint8Array({ maxLength: 64 }),
);

const key: fc.Arbitrary<CborKey> = fc.oneof(
  nfcText,
  fc.bigInt({ min: -(2n ** 64n), max: 2n ** 64n - 1n }),
);

const value: fc.Arbitrary<CborValue> = fc.letrec<{ node: CborValue }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    leaf,
    fc.array(tie("node"), { maxLength: 8 }),
    fc
      .uniqueArray(fc.tuple(key, tie("node")), {
        maxLength: 8,
        selector: (entry) => `${typeof entry[0]}:${String(entry[0])}`,
      })
      .map((entries) => new Map<CborKey, CborValue>(entries)),
  ),
})).node;

const equalValues = (left: unknown, right: unknown): boolean => {
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return toHex(left) === toHex(right);
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => equalValues(item, right[index]))
    );
  }
  if (left instanceof Map && right instanceof Map) {
    if (left.size !== right.size) {
      return false;
    }
    for (const [entryKey, entryValue] of left as Map<unknown, unknown>) {
      if (!(right as Map<unknown, unknown>).has(entryKey)) {
        return false;
      }
      if (!equalValues(entryValue, (right as Map<unknown, unknown>).get(entryKey))) {
        return false;
      }
    }
    return true;
  }
  if (typeof left === "number") {
    return BigInt(left) === right;
  }
  return Object.is(left, right);
};

describe("canonical CBOR properties", () => {
  it("round-trips every value in the codec v1 domain", () => {
    fc.assert(
      fc.property(value, (subject) => {
        expect(equalValues(subject, decodeCanonical(encodeCanonical(subject)))).toBe(
          true,
        );
      }),
    );
  });

  it("re-encodes decoded bytes to exactly the same bytes", () => {
    fc.assert(
      fc.property(value, (subject) => {
        const bytes = encodeCanonical(subject);
        expect(toHex(encodeCanonical(decodeCanonical(bytes)))).toBe(toHex(bytes));
      }),
    );
  });

  it("encodes a map identically whatever order its keys were inserted in", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(key, leaf), {
          minLength: 1,
          maxLength: 8,
          selector: (entry) => `${typeof entry[0]}:${String(entry[0])}`,
        }),
        fc.integer({ min: 0, max: 5_000 }),
        (entries, rotation) => {
          const rotated = entries.map(
            (_, index) => entries[(index + rotation) % entries.length] as (typeof entries)[number],
          );
          expect(toHex(encodeCanonical(new Map<CborKey, CborValue>(rotated)))).toBe(
            toHex(encodeCanonical(new Map<CborKey, CborValue>(entries))),
          );
        },
      ),
    );
  });
});
