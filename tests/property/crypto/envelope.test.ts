import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createSecretKey } from "../../../src/crypto/keys.js";
import { decryptEnvelope, encryptEnvelope } from "../../../src/crypto/envelope.js";
import { IntegrityError } from "../../../src/domain/model/errors.js";
import { asStorageId16 } from "../../../src/domain/model/bytes.js";
import {
  ENVELOPE_PAYLOAD_KINDS_V1,
  ENVELOPE_SCOPES_V1,
  PADDED_ENVELOPE_BYTES_V1,
  type EnvelopeFrameV1,
  type EnvelopeScopeV1,
} from "../../../src/migrations/003_envelope_format_v1.js";

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const key = () =>
  createSecretKey(Uint8Array.from({ length: 32 }, (_, index) => index), "envelope");

const scope = fc.constantFrom(...ENVELOPE_SCOPES_V1);
const payloadKind = fc.constantFrom(...ENVELOPE_PAYLOAD_KINDS_V1);
const compression = fc.constantFrom("none" as const, "deflate-raw-v1" as const);
const storageId = fc
  .uint8Array({ minLength: 16, maxLength: 16 })
  .map((bytes) => asStorageId16(bytes));
const logicalRevision = fc.bigInt({ min: 1n, max: 2n ** 64n - 1n });
/** Sized to cross the first bucket boundary (4,096 − 16 − frame overhead). */
const payload = fc.uint8Array({ maxLength: 5_000 });

describe("envelope properties", () => {
  it("round-trips across scopes, kinds, compression codecs, and buckets", async () => {
    await fc.assert(
      fc.asyncProperty(
        scope,
        payloadKind,
        compression,
        storageId,
        logicalRevision,
        payload,
        async (
          envelopeScope,
          kind,
          codec,
          id,
          revision,
          bytes,
        ) => {
          const frame = await encryptEnvelope({
            scope: envelopeScope,
            storageId: id,
            logicalRevision: revision,
            payloadKind: kind,
            payload: bytes,
            compression: codec,
            key: key(),
          });

          expect(PADDED_ENVELOPE_BYTES_V1).toContain(frame.paddedBytes);
          expect(frame.ciphertext.byteLength).toBe(frame.paddedBytes);

          const opened = await decryptEnvelope(
            frame,
            envelopeScope,
            key(),
            kind,
          );
          expect(toHex(opened.payload)).toBe(toHex(bytes));
        },
      ),
      { numRuns: 40 },
    );
  });

  it("fails authentication after any single-byte ciphertext mutation", async () => {
    const frame = await encryptEnvelope({
      scope: "local.catalog",
      storageId: asStorageId16(new Uint8Array(16)),
      logicalRevision: 5n,
      payloadKind: "local.catalog",
      payload: Uint8Array.from({ length: 128 }, (_, index) => index),
      compression: "none",
      key: key(),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: frame.ciphertext.byteLength - 1 }),
        fc.integer({ min: 1, max: 255 }),
        async (index, flip) => {
          const ciphertext = Uint8Array.from(frame.ciphertext);
          ciphertext[index] = (ciphertext[index] as number) ^ flip;
          await expect(
            decryptEnvelope({ ...frame, ciphertext }, "local.catalog", key()),
          ).rejects.toThrow(IntegrityError);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("fails authentication after any AAD element mutation", async () => {
    const baseScope: EnvelopeScopeV1 = "local.catalog";
    const base = {
      scope: baseScope,
      storageId: asStorageId16(Uint8Array.from({ length: 16 }, (_, i) => i)),
      logicalRevision: 9n,
      payloadKind: "local.catalog" as const,
      payload: Uint8Array.from([1, 2, 3, 4]),
      compression: "none" as const,
    };
    const frame = await encryptEnvelope({ ...base, key: key() });

    const mutations: readonly (readonly [EnvelopeScopeV1, EnvelopeFrameV1])[] = [
      ...ENVELOPE_SCOPES_V1.filter((candidate) => candidate !== baseScope).map(
        (candidate) => [candidate, frame] as const,
      ),
    ];

    for (const [mutatedScope, mutatedFrame] of mutations) {
      await expect(
        decryptEnvelope(mutatedFrame, mutatedScope, key()),
      ).rejects.toThrow(IntegrityError);
    }

    await fc.assert(
      fc.asyncProperty(
        storageId,
        logicalRevision,
        async (mutatedId, mutatedRevision) => {
          fc.pre(
            toHex(mutatedId) !== toHex(base.storageId) ||
              mutatedRevision !== base.logicalRevision,
          );
          await expect(
            decryptEnvelope(
              { ...frame, storageId: mutatedId, logicalRevision: mutatedRevision },
              baseScope,
              key(),
            ),
          ).rejects.toThrow(IntegrityError);
        },
      ),
      { numRuns: 25 },
    );
  });
});
