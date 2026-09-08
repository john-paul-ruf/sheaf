import { describe, expect, it } from "vitest";
import { SHA256_BYTES, sha256 } from "../../../src/crypto/hash.js";

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** FIPS 180-4 / NIST CAVP known answers. */
const VECTORS: readonly (readonly [string, string])[] = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  ],
];

describe("sha256", () => {
  it("matches the published known answers", async () => {
    for (const [input, expected] of VECTORS) {
      expect(hex(await sha256(utf8(input))), input).toBe(expected);
    }
  });

  it("always returns 32 bytes and is deterministic", async () => {
    const long = new Uint8Array(100_000).fill(0xab);

    expect((await sha256(long)).byteLength).toBe(SHA256_BYTES);
    expect(hex(await sha256(long))).toBe(hex(await sha256(long)));
  });

  it("changes completely when a single input byte changes", async () => {
    const base = new Uint8Array(64).fill(1);
    const tweaked = new Uint8Array(base);
    tweaked[31] = 2;

    expect(hex(await sha256(base))).not.toBe(hex(await sha256(tweaked)));
  });
});
