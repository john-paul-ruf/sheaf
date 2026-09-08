import { describe, expect, it } from "vitest";
import {
  compressBounded,
  decompressBounded,
} from "../../../src/persistence/codecs/compression.js";
import { CodecError } from "../../../src/domain/model/errors.js";

const repeating = (length: number): Uint8Array =>
  Uint8Array.from({ length }, (_, index) => index % 7);

describe("deflate-raw-v1", () => {
  it("round-trips a payload against its declared decoded length", async () => {
    const payload = repeating(8_192);
    const compressed = await compressBounded(payload, "deflate-raw-v1");

    expect(compressed.byteLength).toBeLessThan(payload.byteLength);
    expect([
      ...(await decompressBounded(compressed, "deflate-raw-v1", payload.byteLength)),
    ]).toEqual([...payload]);
  });

  it("round-trips an empty payload", async () => {
    const compressed = await compressBounded(new Uint8Array(), "deflate-raw-v1");
    expect(await decompressBounded(compressed, "deflate-raw-v1", 0)).toHaveLength(0);
  });

  it("refuses a stream that expands past its declared length", async () => {
    const compressed = await compressBounded(repeating(64_000), "deflate-raw-v1");
    await expect(
      decompressBounded(compressed, "deflate-raw-v1", 1_024),
    ).rejects.toThrow(/more bytes than declared/);
  });

  it("refuses a stream that stops short of its declared length", async () => {
    const compressed = await compressBounded(repeating(1_000), "deflate-raw-v1");
    await expect(
      decompressBounded(compressed, "deflate-raw-v1", 1_001),
    ).rejects.toThrow(/fewer bytes than declared/);
  });

  it("refuses input that is not a deflate-raw stream", async () => {
    await expect(
      decompressBounded(Uint8Array.from([1, 2, 3, 4]), "deflate-raw-v1", 4),
    ).rejects.toThrow();
  });

  it("refuses a declared length that is not a safe length", async () => {
    await expect(
      decompressBounded(new Uint8Array(), "deflate-raw-v1", -1),
    ).rejects.toThrow(CodecError);
    await expect(
      decompressBounded(new Uint8Array(), "none", 1.5),
    ).rejects.toThrow(/not a safe length/);
  });

  it("bounds the compressed output when the caller declares a ceiling", async () => {
    await expect(
      compressBounded(repeating(64_000), "deflate-raw-v1", 8),
    ).rejects.toThrow(/more bytes than declared/);
  });
});

describe("none", () => {
  it("passes the payload through and enforces the declared length", async () => {
    const payload = repeating(37);
    expect(await compressBounded(payload, "none")).toBe(payload);
    expect(await decompressBounded(payload, "none", 37)).toBe(payload);
    await expect(decompressBounded(payload, "none", 36)).rejects.toThrow(
      /differs from the declared length/,
    );
  });
});
