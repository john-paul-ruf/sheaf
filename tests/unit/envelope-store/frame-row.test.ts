/**
 * CA-02 / D12 / AD-6 mapping gate.
 *
 * The claim under test: a stored row carries everything needed to rebuild the
 * AAD S02 sealed the envelope under — byte for byte — with no side table and
 * no writer-chosen second number. If this ever stops holding, an intact store
 * fails authentication and surfaces as a tamper-shaped integrity error.
 */

import { describe, expect, it } from "vitest";
import katFixture from "../../fixtures/vaults/local-v1/envelope-kat.json" with { type: "json" };
import { createSecretKey } from "../../../src/crypto/keys.js";
import { decryptEnvelope, encryptEnvelope } from "../../../src/crypto/envelope.js";
import { CodecError, IntegrityError } from "../../../src/domain/model/errors.js";
import { asStorageId16 } from "../../../src/domain/model/bytes.js";
import { buildEnvelopeAad } from "../../../src/persistence/codecs/envelope-frame.js";
import type {
  EnvelopePayloadKindV1,
  EnvelopeScopeV1,
} from "../../../src/migrations/003_envelope_format_v1.js";
import {
  frameToRow,
  rowToFrame,
} from "../../../src/persistence/envelope-store/frame-row.js";
import { opaqueFrame, storageIdText } from "./local-store.js";

const hex = (text: string): Uint8Array =>
  Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const kat = katFixture.cases[0]!;
const katScope = kat.scope as EnvelopeScopeV1;
const katKey = () => createSecretKey(hex(kat.keyHex), "envelope");
const katRevision = Number(kat.logicalRevision);

const sealKatEnvelope = async () =>
  encryptEnvelope({
    scope: katScope,
    storageId: asStorageId16(hex(kat.storageIdHex)),
    logicalRevision: BigInt(kat.logicalRevision),
    payloadKind: kat.payloadKind as EnvelopePayloadKindV1,
    payload: hex(kat.payloadHex),
    compression: "none",
    key: katKey(),
    nonce: hex(kat.nonceHex),
  });

describe("CA-02 row reconstruction", () => {
  it("round-trips every frame field byte-identically", async () => {
    const frame = await sealKatEnvelope();
    const row = frameToRow(frame, katRevision);
    const rebuilt = rowToFrame(row);

    expect(row.storageId).toBe(kat.storageIdBase64Url);
    expect(row.revision).toBe(katRevision);
    expect(row.paddedBytes).toBe(kat.paddedBytes);
    expect(row.ciphertext.byteLength).toBe(row.paddedBytes);

    expect(rebuilt.envelopeFormatVersion).toBe(frame.envelopeFormatVersion);
    expect(rebuilt.codecVersion).toBe(frame.codecVersion);
    expect(rebuilt.cipherSuiteVersion).toBe(frame.cipherSuiteVersion);
    expect(rebuilt.paddedBytes).toBe(frame.paddedBytes);
    expect(rebuilt.logicalRevision).toBe(frame.logicalRevision);
    expect(toHex(rebuilt.storageId)).toBe(toHex(frame.storageId));
    expect(toHex(rebuilt.nonce)).toBe(toHex(frame.nonce));
    expect(toHex(rebuilt.ciphertext)).toBe(toHex(frame.ciphertext));
  });

  it("rebuilds the KAT AAD from the stored row alone", async () => {
    const row = frameToRow(await sealKatEnvelope(), katRevision);
    const rebuilt = rowToFrame(row);

    const aad = buildEnvelopeAad({
      scope: katScope,
      storageId: asStorageId16(rebuilt.storageId),
      codecVersion: rebuilt.codecVersion,
      cipherSuiteVersion: rebuilt.cipherSuiteVersion,
      // The identity under test: the row's committed revision IS the logical
      // revision, so no separate column is consulted.
      logicalRevision: BigInt(row.revision),
    });

    expect(toHex(aad)).toBe(kat.aadHex);
  });

  it("decrypts the round-tripped row under the caller-supplied scope", async () => {
    const row = frameToRow(await sealKatEnvelope(), katRevision);
    const opened = await decryptEnvelope(rowToFrame(row), katScope, katKey());
    expect(toHex(opened.payload)).toBe(kat.payloadHex);
  });

  it("fails authentication when the stored revision is mutated", async () => {
    const row = frameToRow(await sealKatEnvelope(), katRevision);
    const moved = rowToFrame({ ...row, revision: row.revision + 1 });

    expect(moved.logicalRevision).toBe(BigInt(row.revision + 1));
    await expect(decryptEnvelope(moved, katScope, katKey())).rejects.toThrow(
      IntegrityError,
    );
  });

  it("refuses to re-label a frame at a different committing revision", async () => {
    const frame = await sealKatEnvelope();
    expect(() => frameToRow(frame, katRevision + 1)).toThrow(CodecError);
    expect(() => frameToRow(frame, katRevision + 1)).toThrow(
      /must equal the committing transaction revision/,
    );
  });
});

describe("frame ↔ row field mapping", () => {
  it("copies bytes instead of aliasing the caller's buffers", () => {
    const frame = opaqueFrame(1, 4n);
    const row = frameToRow(frame, 4);

    frame.nonce[0] = (frame.nonce[0] as number) ^ 0xff;
    frame.ciphertext[0] = (frame.ciphertext[0] as number) ^ 0xff;

    const rebuilt = rowToFrame(row);
    expect(rebuilt.nonce[0]).not.toBe(frame.nonce[0]);
    expect(rebuilt.ciphertext[0]).not.toBe(frame.ciphertext[0]);

    rebuilt.ciphertext[1] = (rebuilt.ciphertext[1] as number) ^ 0xff;
    expect(new Uint8Array(row.ciphertext)[1]).not.toBe(rebuilt.ciphertext[1]);
  });

  it("rejects a logical revision outside the safe-integer range", () => {
    const enormous = katFixture.cases[1]!;
    const frame = opaqueFrame(2, BigInt(enormous.logicalRevision));
    expect(() => frameToRow(frame, Number.MAX_SAFE_INTEGER)).toThrow(CodecError);
  });

  it("rejects a revision that is not a committable safe integer", () => {
    expect(() => frameToRow(opaqueFrame(3, 1n), 0)).toThrow(CodecError);
    expect(() => frameToRow(opaqueFrame(3, 1n), 1.5)).toThrow(CodecError);
    expect(() => rowToFrame({ ...frameToRow(opaqueFrame(3, 1n), 1), revision: 0 })).toThrow(
      CodecError,
    );
  });

  it("rejects a non-canonical storage id on read", () => {
    const row = frameToRow(opaqueFrame(4, 1n), 1);
    expect(() => rowToFrame({ ...row, storageId: `${row.storageId}=` })).toThrow(
      CodecError,
    );
    expect(() => rowToFrame({ ...row, storageId: storageIdText(4).slice(0, 21) })).toThrow(
      CodecError,
    );
  });

  it("rejects a row that declares unsupported versions", () => {
    const row = frameToRow(opaqueFrame(5, 1n), 1);
    expect(() =>
      rowToFrame({ ...row, codecVersion: 2 as unknown as 1 }),
    ).toThrow(/unsupported versions/);
    expect(() =>
      rowToFrame({ ...row, envelopeFormatVersion: 2 as unknown as 1 }),
    ).toThrow(/unsupported versions/);
  });
});
