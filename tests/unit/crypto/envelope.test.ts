import { describe, expect, it } from "vitest";
import katFixture from "../../fixtures/vaults/local-v1/envelope-kat.json" with { type: "json" };
import { createSecretKey } from "../../../src/crypto/keys.js";
import { decryptEnvelope, encryptEnvelope } from "../../../src/crypto/envelope.js";
import { IntegrityError } from "../../../src/domain/model/errors.js";
import { asStorageId16 } from "../../../src/domain/model/bytes.js";
import { buildEnvelopeAad } from "../../../src/persistence/codecs/envelope-frame.js";
import {
  PADDED_ENVELOPE_BYTES_V1,
  type EnvelopeFrameV1,
  type EnvelopePayloadKindV1,
  type EnvelopeScopeV1,
} from "../../../src/migrations/003_envelope_format_v1.js";

const hex = (text: string): Uint8Array =>
  Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const key = (bytes: Uint8Array) => createSecretKey(bytes, "envelope");

const storageId = asStorageId16(hex("946df764e699ff8546e074b1cedb7c68"));

describe("CA-02 known-answer vectors", () => {
  it("re-derives every recorded AAD and ciphertext byte for byte", async () => {
    expect(katFixture.cases).toHaveLength(2);

    for (const kat of katFixture.cases) {
      const scope = kat.scope as EnvelopeScopeV1;
      const id = asStorageId16(hex(kat.storageIdHex));
      const logicalRevision = BigInt(kat.logicalRevision);

      expect(
        toHex(
          buildEnvelopeAad({
            scope,
            storageId: id,
            codecVersion: 1,
            cipherSuiteVersion: 1,
            logicalRevision,
          }),
        ),
        kat.name,
      ).toBe(kat.aadHex);

      const frame = await encryptEnvelope({
        scope,
        storageId: id,
        logicalRevision,
        payloadKind: kat.payloadKind as EnvelopePayloadKindV1,
        payload: hex(kat.payloadHex),
        compression: "none",
        key: key(hex(kat.keyHex)),
        nonce: hex(kat.nonceHex),
      });

      expect(frame.paddedBytes, kat.name).toBe(kat.paddedBytes);
      expect(toHex(frame.ciphertext), kat.name).toBe(kat.ciphertextHex);

      const opened = await decryptEnvelope(frame, scope, key(hex(kat.keyHex)));
      expect(toHex(opened.payload), kat.name).toBe(kat.payloadHex);
      expect(opened.payloadKind, kat.name).toBe(kat.payloadKind);
    }
  });

  it("pins the AAD element types to D6", () => {
    const aad = toHex(
      buildEnvelopeAad({
        scope: "local.catalog",
        storageId,
        codecVersion: 1,
        cipherSuiteVersion: 1,
        logicalRevision: 4_294_967_296n,
      }),
    );
    expect(aad).toBe(
      [
        "86", // array of exactly 6 elements
        "65" + "7368656166", // tstr(5) "sheaf"
        "6d" + "6c6f63616c2e636174616c6f67", // tstr(13) "local.catalog"
        "50" + "946df764e699ff8546e074b1cedb7c68", // bstr(16) storage id
        "01", // uint codec version
        "01", // uint cipher suite version
        "1b0000000100000000", // uint64 logical revision
      ].join(""),
    );
  });
});

describe("envelope tamper matrix", () => {
  const scope: EnvelopeScopeV1 = "local.catalog";
  const keyBytes = hex(katFixture.cases[0]!.keyHex);
  const payload = hex(katFixture.cases[0]!.payloadHex);

  const seal = async (): Promise<EnvelopeFrameV1> =>
    encryptEnvelope({
      scope,
      storageId,
      logicalRevision: 7n,
      payloadKind: "local.catalog",
      payload,
      compression: "none",
      key: key(keyBytes),
    });

  it("opens under its own scope, key, id, and revision", async () => {
    const opened = await decryptEnvelope(await seal(), scope, key(keyBytes));
    expect(toHex(opened.payload)).toBe(toHex(payload));
  });

  it("fails when the scope element changes", async () => {
    await expect(
      decryptEnvelope(await seal(), "local.home", key(keyBytes)),
    ).rejects.toThrow(IntegrityError);
  });

  it("fails when the storage id element changes", async () => {
    const frame = await seal();
    const movedId = hex(katFixture.cases[1]!.storageIdHex);
    await expect(
      decryptEnvelope({ ...frame, storageId: movedId }, scope, key(keyBytes)),
    ).rejects.toThrow(/failed authentication/);
  });

  it("fails when the logical revision element changes", async () => {
    const frame = await seal();
    await expect(
      decryptEnvelope({ ...frame, logicalRevision: 8n }, scope, key(keyBytes)),
    ).rejects.toThrow(/failed authentication/);
  });

  it("refuses a changed codec or cipher-suite element before decrypting", async () => {
    const frame = await seal();
    await expect(
      decryptEnvelope(
        { ...frame, codecVersion: 2 } as unknown as EnvelopeFrameV1,
        scope,
        key(keyBytes),
      ),
    ).rejects.toThrow(/Unsupported envelope codec or cipher suite/);
    await expect(
      decryptEnvelope(
        { ...frame, cipherSuiteVersion: 2 } as unknown as EnvelopeFrameV1,
        scope,
        key(keyBytes),
      ),
    ).rejects.toThrow(/Unsupported envelope codec or cipher suite/);
    await expect(
      decryptEnvelope(
        { ...frame, envelopeFormatVersion: 2 } as unknown as EnvelopeFrameV1,
        scope,
        key(keyBytes),
      ),
    ).rejects.toThrow(/Unsupported envelope format version/);
  });

  it("fails under a different key, nonce, or ciphertext byte", async () => {
    const frame = await seal();
    const otherKey = hex(katFixture.cases[1]!.keyHex);
    await expect(decryptEnvelope(frame, scope, key(otherKey))).rejects.toThrow(
      IntegrityError,
    );

    const nonce = Uint8Array.from(frame.nonce);
    nonce[0] = (nonce[0] as number) ^ 0x01;
    await expect(
      decryptEnvelope({ ...frame, nonce }, scope, key(keyBytes)),
    ).rejects.toThrow(IntegrityError);

    const ciphertext = Uint8Array.from(frame.ciphertext);
    ciphertext[1_000] = (ciphertext[1_000] as number) ^ 0x80;
    await expect(
      decryptEnvelope({ ...frame, ciphertext }, scope, key(keyBytes)),
    ).rejects.toThrow(IntegrityError);
  });

  it("rejects a truncated or re-bucketed ciphertext", async () => {
    const frame = await seal();
    await expect(
      decryptEnvelope(
        { ...frame, ciphertext: frame.ciphertext.slice(0, 2_048) },
        scope,
        key(keyBytes),
      ),
    ).rejects.toThrow(/padding bucket/);
    await expect(
      decryptEnvelope({ ...frame, paddedBytes: 4_097 }, scope, key(keyBytes)),
    ).rejects.toThrow(/padding bucket/);
  });

  it("rejects a payload kind that the parent did not expect", async () => {
    await expect(
      decryptEnvelope(await seal(), scope, key(keyBytes), "local.home-state"),
    ).rejects.toThrow(/not the expected kind/);
  });
});

describe("envelope shape", () => {
  it("pads every envelope to a v1 bucket, tag included", async () => {
    const sizes = [0, 1_000, 8_000, 40_000];
    for (const size of sizes) {
      const frame = await encryptEnvelope({
        scope: "local.catalog",
        storageId,
        logicalRevision: 1n,
        payloadKind: "local.catalog",
        payload: new Uint8Array(size),
        compression: "none",
        key: key(hex(katFixture.cases[0]!.keyHex)),
      });
      expect(PADDED_ENVELOPE_BYTES_V1).toContain(frame.paddedBytes);
      expect(frame.ciphertext.byteLength).toBe(frame.paddedBytes);
      expect(frame.nonce.byteLength).toBe(24);
    }
  });

  it("draws a fresh nonce for every envelope", async () => {
    const nonces = new Set<string>();
    for (let index = 0; index < 8; index += 1) {
      const frame = await encryptEnvelope({
        scope: "local.catalog",
        storageId,
        logicalRevision: 1n,
        payloadKind: "local.catalog",
        payload: new Uint8Array(4),
        compression: "none",
        key: key(hex(katFixture.cases[0]!.keyHex)),
      });
      nonces.add(toHex(frame.nonce));
    }
    expect(nonces.size).toBe(8);
  });

  it("round-trips a compressed payload through its declared lengths", async () => {
    const payload = Uint8Array.from({ length: 20_000 }, (_, index) => index % 5);
    const frame = await encryptEnvelope({
      scope: "local.catalog",
      storageId,
      logicalRevision: 3n,
      payloadKind: "local.catalog",
      payload,
      compression: "deflate-raw-v1",
      key: key(hex(katFixture.cases[0]!.keyHex)),
    });

    expect(frame.paddedBytes).toBe(4_096);
    const opened = await decryptEnvelope(
      frame,
      "local.catalog",
      key(hex(katFixture.cases[0]!.keyHex)),
    );
    expect(opened.compression).toBe("deflate-raw-v1");
    expect(toHex(opened.payload)).toBe(toHex(payload));
  });
});
