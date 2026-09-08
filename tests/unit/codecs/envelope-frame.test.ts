import { describe, expect, it } from "vitest";
import {
  buildEnvelopeAad,
  buildEnvelopePlaintext,
  isPaddedBucket,
  padToBucket,
  parseEnvelopePlaintext,
  parseEnvelopeTransport,
  selectPaddedBucket,
  serializeEnvelopeTransport,
  type EnvelopeAadInput,
} from "../../../src/persistence/codecs/envelope-frame.js";
import { CodecError } from "../../../src/domain/model/errors.js";
import { asStorageId16 } from "../../../src/domain/model/bytes.js";
import {
  ENVELOPE_TAG_BYTES,
  PADDED_ENVELOPE_BYTES_V1,
  type EnvelopeFrameV1,
  type EnvelopePlaintextV1,
} from "../../../src/migrations/003_envelope_format_v1.js";

const storageId = asStorageId16(Uint8Array.from({ length: 16 }, (_, i) => i + 1));

const plaintext = (
  overrides: Partial<EnvelopePlaintextV1> = {},
): EnvelopePlaintextV1 => ({
  innerVersion: 1,
  payloadKind: "local.catalog",
  compression: "none",
  encodedPayloadByteLength: 3,
  decodedPayloadByteLength: 3,
  payload: Uint8Array.from([9, 8, 7]),
  ...overrides,
});

describe("AAD tuple (CA-02)", () => {
  it("rejects an element outside its pinned domain", () => {
    const valid = {
      scope: "local.catalog",
      storageId,
      codecVersion: 1,
      cipherSuiteVersion: 1,
      logicalRevision: 1n,
    } as const;

    expect(() => buildEnvelopeAad(valid)).not.toThrow();
    expect(() =>
      buildEnvelopeAad({ ...valid, scope: "local.unknown" as never }),
    ).toThrow(/not a v1 envelope scope/);
    expect(() =>
      buildEnvelopeAad({
        ...valid,
        storageId: asStorageId16(new Uint8Array(16)).subarray(0, 15) as never,
      }),
    ).toThrow(/16 bytes/);
    expect(() => buildEnvelopeAad({ ...valid, logicalRevision: -1n })).toThrow(
      /uint64 range/,
    );
    expect(() =>
      buildEnvelopeAad({ ...valid, logicalRevision: 2n ** 64n }),
    ).toThrow(/uint64 range/);
    expect(() => buildEnvelopeAad({ ...valid, codecVersion: 1.5 })).toThrow(
      /unsigned integers/,
    );
  });

  it("changes bytes when any single element changes", () => {
    const base = {
      scope: "local.catalog",
      storageId,
      codecVersion: 1,
      cipherSuiteVersion: 1,
      logicalRevision: 1n,
    } as const;
    const variants: readonly EnvelopeAadInput[] = [
      base,
      { ...base, scope: "local.home" },
      { ...base, storageId: asStorageId16(new Uint8Array(16)) },
      { ...base, codecVersion: 2 },
      { ...base, cipherSuiteVersion: 2 },
      { ...base, logicalRevision: 2n },
    ];
    const encodings = new Set(
      variants.map((input) => buildEnvelopeAad(input).toString()),
    );
    expect(encodings.size).toBe(variants.length);
  });
});

describe("padding profile v1", () => {
  it("selects the smallest bucket that fits the ciphertext with its tag", () => {
    expect(selectPaddedBucket(0)).toBe(4_096);
    expect(selectPaddedBucket(4_096 - ENVELOPE_TAG_BYTES)).toBe(4_096);
    expect(selectPaddedBucket(4_096 - ENVELOPE_TAG_BYTES + 1)).toBe(16_384);
    expect(selectPaddedBucket(16_777_216 - ENVELOPE_TAG_BYTES)).toBe(16_777_216);
    expect(() => selectPaddedBucket(16_777_216)).toThrow(/largest v1 padding bucket/);
  });

  it("pads to the plaintext size of its bucket with zero bytes", () => {
    const padded = padToBucket(Uint8Array.from([1, 2, 3]), 4_096);
    expect(padded.byteLength).toBe(4_096 - ENVELOPE_TAG_BYTES);
    expect([...padded.subarray(0, 3)]).toEqual([1, 2, 3]);
    expect(padded.subarray(3).every((byte) => byte === 0)).toBe(true);
  });

  it("refuses a non-bucket length or an oversized frame", () => {
    expect(() => padToBucket(new Uint8Array(1), 5_000)).toThrow(
      /not a v1 padding bucket/,
    );
    expect(() => padToBucket(new Uint8Array(4_096), 4_096)).toThrow(
      /does not fit its padding bucket/,
    );
    expect(PADDED_ENVELOPE_BYTES_V1.every(isPaddedBucket)).toBe(true);
    expect(isPaddedBucket(4_097)).toBe(false);
  });
});

describe("inner frame", () => {
  it("round-trips through padding", () => {
    const frame = plaintext();
    const padded = padToBucket(buildEnvelopePlaintext(frame), 4_096);
    expect(parseEnvelopePlaintext(padded)).toEqual(frame);
  });

  it("rejects non-zero padding after the frame", () => {
    const padded = padToBucket(buildEnvelopePlaintext(plaintext()), 4_096);
    padded[padded.byteLength - 1] = 1;
    expect(() => parseEnvelopePlaintext(padded)).toThrow(/padding is not zero bytes/);
  });

  it("rejects a declared length that disagrees with the payload", () => {
    expect(() =>
      buildEnvelopePlaintext(plaintext({ encodedPayloadByteLength: 4 })),
    ).toThrow(/differs from the declared length/);
  });

  it("rejects unknown kinds, codecs, and inner versions", () => {
    expect(() =>
      buildEnvelopePlaintext(plaintext({ payloadKind: "app.unknown" as never })),
    ).toThrow(/not a v1 payload kind/);
    expect(() =>
      buildEnvelopePlaintext(plaintext({ compression: "gzip" as never })),
    ).toThrow(/not a v1 codec/);
    expect(() =>
      buildEnvelopePlaintext(plaintext({ innerVersion: 2 as never })),
    ).toThrow(/version is not 1/);
  });

  it("rejects a plaintext that is not a six-field map", () => {
    expect(() => parseEnvelopePlaintext(Uint8Array.from([0xa0]))).toThrow(
      /exactly six fields/,
    );
    expect(() => parseEnvelopePlaintext(Uint8Array.from([0x01]))).toThrow(/not a map/);
  });
});

describe("SHF1 transport", () => {
  const frame: EnvelopeFrameV1 = {
    envelopeFormatVersion: 1,
    codecVersion: 1,
    cipherSuiteVersion: 1,
    storageId,
    logicalRevision: 18446744073709551615n,
    paddedBytes: 4_096,
    nonce: Uint8Array.from({ length: 24 }, (_, index) => index),
    ciphertext: Uint8Array.from({ length: 4_096 }, (_, index) => index % 251),
  };

  it("round-trips a frame behind the magic", () => {
    const bytes = serializeEnvelopeTransport(frame);
    expect(bytes.byteLength).toBe(62 + 4_096);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("SHF1");
    expect(parseEnvelopeTransport(bytes)).toEqual(frame);
  });

  it("rejects bad magic, versions, buckets, and lengths", () => {
    const bytes = serializeEnvelopeTransport(frame);

    const wrongMagic = Uint8Array.from(bytes);
    wrongMagic[3] = 0x32;
    expect(() => parseEnvelopeTransport(wrongMagic)).toThrow(/SHF1 magic/);

    const wrongVersion = Uint8Array.from(bytes);
    wrongVersion[5] = 2;
    expect(() => parseEnvelopeTransport(wrongVersion)).toThrow(
      /unsupported versions/,
    );

    const wrongBucket = Uint8Array.from(bytes);
    wrongBucket[37] = 1;
    expect(() => parseEnvelopeTransport(wrongBucket)).toThrow(/padding bucket/);

    expect(() => parseEnvelopeTransport(bytes.subarray(0, 61))).toThrow(
      /shorter than its header/,
    );
    expect(() => parseEnvelopeTransport(bytes.subarray(0, 4_000))).toThrow(
      /differs from its header/,
    );
    expect(() =>
      serializeEnvelopeTransport({ ...frame, paddedBytes: 4_097 }),
    ).toThrow(CodecError);
  });
});
