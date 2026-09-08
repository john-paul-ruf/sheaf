import { describe, expect, it } from "vitest";
import {
  STORAGE_ID_BYTE_LENGTH,
  STORAGE_ID_TEXT_LENGTH,
  asStorageId16,
  constantTimeEquals,
  decodeBase64Url,
  decodeStorageId16,
  encodeBase64Url,
  encodeStorageId16,
} from "../../../src/domain/model/bytes.js";
import { CodecError } from "../../../src/domain/model/errors.js";
import { STORAGE_ID_BYTES } from "../../../src/migrations/003_envelope_format_v1.js";

const sequential = (length: number): Uint8Array =>
  Uint8Array.from({ length }, (_, index) => index);

describe("storage identifiers", () => {
  it("pins the domain byte length to the migration constant", () => {
    expect(STORAGE_ID_BYTE_LENGTH).toBe(STORAGE_ID_BYTES);
    expect(STORAGE_ID_TEXT_LENGTH).toBe(22);
  });

  it("round-trips 16 bytes through canonical 22-character base64url", () => {
    const id = asStorageId16(sequential(16));
    const text = encodeStorageId16(id);

    expect(text).toHaveLength(STORAGE_ID_TEXT_LENGTH);
    expect(text).toBe("AAECAwQFBgcICQoLDA0ODw");
    expect([...decodeStorageId16(text)]).toEqual([...id]);
  });

  it("rejects a length other than 16 bytes", () => {
    expect(() => asStorageId16(sequential(15))).toThrow(CodecError);
    expect(() => asStorageId16(sequential(17))).toThrow(/16 bytes/);
  });

  it("rejects a non-canonical spelling of the same bytes", () => {
    // The final character carries 2 data bits; 4 trailing bits must be zero.
    expect(() => decodeStorageId16("AAECAwQFBgcICQoLDA0ODx")).toThrow(
      /non-canonical trailing bits/,
    );
    expect(() => decodeStorageId16("AAECAwQFBgcICQoLDA0OD")).toThrow(
      /22 characters/,
    );
    expect(() => decodeStorageId16("AAECAwQFBgcICQoLDA0OD=")).toThrow(
      /non-alphabet character/,
    );
    expect(() => decodeStorageId16("AAECAwQFBgcICQoLDA0OD+")).toThrow(
      /non-alphabet character/,
    );
  });
});

describe("base64url", () => {
  it("encodes without padding across every remainder", () => {
    expect(encodeBase64Url(new Uint8Array())).toBe("");
    expect(encodeBase64Url(Uint8Array.from([0xff]))).toBe("_w");
    expect(encodeBase64Url(Uint8Array.from([0xff, 0xee]))).toBe("_-4");
    expect(encodeBase64Url(Uint8Array.from([0xff, 0xee, 0xdd]))).toBe("_-7d");
    expect([...decodeBase64Url("_-7d")]).toEqual([0xff, 0xee, 0xdd]);
  });

  it("rejects an impossible length", () => {
    expect(() => decodeBase64Url("A")).toThrow(/impossible length/);
  });
});

describe("constant-time equality", () => {
  it("compares content, not identity", () => {
    expect(constantTimeEquals(sequential(32), sequential(32))).toBe(true);
    const changed = sequential(32);
    changed[31] = 0xff;
    expect(constantTimeEquals(sequential(32), changed)).toBe(false);
    expect(constantTimeEquals(sequential(32), sequential(31))).toBe(false);
  });
});
