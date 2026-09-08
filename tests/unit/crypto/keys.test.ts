import { describe, expect, it } from "vitest";
import {
  createSecretKey,
  destroySecretKey,
  generateLocalRoot,
  unwrapRoot,
  wrapRoot,
} from "../../../src/crypto/keys.js";
import {
  deriveWrappingKeyFromPassphrase,
  PASSPHRASE_KDF_CONTEXT,
  ARGON2ID_FLOOR,
} from "../../../src/crypto/kdf.js";
import { decryptEnvelope, encryptEnvelope } from "../../../src/crypto/envelope.js";
import { asStorageId16 } from "../../../src/domain/model/bytes.js";
import { CryptoError, IntegrityError } from "../../../src/domain/model/errors.js";
import type { EntropyPort } from "../../../src/application/ports/entropy.js";
import type { Argon2idDescriptorV1 } from "../../../src/migrations/001_local_store_v1.js";

const hex = (text: string): Uint8Array =>
  Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));

const entropy = (seed: number): EntropyPort => ({
  randomBytes: (byteLength) =>
    Uint8Array.from({ length: byteLength }, (_, index) => (seed * 31 + index) % 256),
});

const descriptor: Argon2idDescriptorV1 = {
  algorithm: "argon2id",
  algorithmVersion: 0x13,
  salt: hex("000102030405060708090a0b0c0d0e0f").buffer as ArrayBuffer,
  memoryKiB: ARGON2ID_FLOOR.memoryKiB,
  iterations: ARGON2ID_FLOOR.iterations,
  lanes: 1,
  outputBytes: 32,
  context: PASSPHRASE_KDF_CONTEXT,
};

/** Proves two handles hold the same key without ever reading their bytes. */
const opensEachOther = async (
  sealing: Parameters<typeof encryptEnvelope>[0]["key"],
  opening: Parameters<typeof encryptEnvelope>[0]["key"],
): Promise<boolean> => {
  const frame = await encryptEnvelope({
    scope: "local.catalog",
    storageId: asStorageId16(new Uint8Array(16)),
    logicalRevision: 1n,
    payloadKind: "local.catalog",
    payload: hex("cafebabe"),
    compression: "none",
    key: sealing,
  });
  try {
    const opened = await decryptEnvelope(frame, "local.catalog", opening);
    return opened.payload.byteLength === 4;
  } catch {
    return false;
  }
};

describe("local root key", () => {
  it("is a random 32-byte key behind an opaque handle", () => {
    const root = generateLocalRoot(entropy(1));
    expect(root.purpose).toBe("local-root");
    expect(Object.keys(root)).toEqual(["purpose"]);
    expect(() =>
      generateLocalRoot({ randomBytes: () => new Uint8Array(31) }),
    ).toThrow(/wrong key length/);
  });

  it("fails closed once destroyed", async () => {
    const root = generateLocalRoot(entropy(2));
    const wrapping = createSecretKey(new Uint8Array(32).fill(3), "passphrase-wrapping");
    destroySecretKey(root);
    await expect(wrapRoot(root, wrapping)).rejects.toThrow(
      /unknown or already destroyed/,
    );
  });
});

describe("root wrapping", () => {
  it("round-trips the same root through a passphrase wrapper", async () => {
    const root = generateLocalRoot(entropy(4));
    const wrapping = await deriveWrappingKeyFromPassphrase("open sesame", descriptor);
    const wrapped = await wrapRoot(root, wrapping);

    expect(wrapped.wrapId).toHaveLength(22);
    expect(wrapped.nonce.byteLength).toBe(24);
    expect(wrapped.ciphertext.byteLength).toBe(32 + 16);

    const unwrapped = await unwrapRoot(
      wrapped,
      await deriveWrappingKeyFromPassphrase("open sesame", descriptor),
    );
    expect(unwrapped.purpose).toBe("local-root");
    expect(await opensEachOther(root, unwrapped)).toBe(true);
  });

  it("wraps one root under two independent wrappers", async () => {
    const root = generateLocalRoot(entropy(5));
    const passphraseKey = await deriveWrappingKeyFromPassphrase("first", descriptor);
    const recoveryKey = createSecretKey(new Uint8Array(32).fill(9), "recovery-wrapping");

    const viaPassphrase = await unwrapRoot(
      await wrapRoot(root, passphraseKey),
      passphraseKey,
    );
    const viaRecovery = await unwrapRoot(
      await wrapRoot(root, recoveryKey),
      recoveryKey,
    );
    expect(await opensEachOther(viaPassphrase, viaRecovery)).toBe(true);
  });

  it("uses a fresh wrap id and nonce for every wrap", async () => {
    const root = generateLocalRoot(entropy(6));
    const wrapping = createSecretKey(new Uint8Array(32).fill(1), "passphrase-wrapping");
    const wraps = await Promise.all([
      wrapRoot(root, wrapping),
      wrapRoot(root, wrapping),
      wrapRoot(root, wrapping),
    ]);
    expect(new Set(wraps.map((wrap) => wrap.wrapId)).size).toBe(3);
    expect(new Set(wraps.map((wrap) => wrap.nonce.byteLength)).size).toBe(1);
  });

  it("fails under the wrong passphrase", async () => {
    const root = generateLocalRoot(entropy(7));
    const wrapped = await wrapRoot(
      root,
      await deriveWrappingKeyFromPassphrase("right passphrase", descriptor),
    );
    await expect(
      unwrapRoot(
        wrapped,
        await deriveWrappingKeyFromPassphrase("wrong passphrase", descriptor),
      ),
    ).rejects.toThrow(IntegrityError);
  });

  it("fails when the wrap id, nonce, or ciphertext changes", async () => {
    const root = generateLocalRoot(entropy(8));
    const wrapping = createSecretKey(new Uint8Array(32).fill(4), "passphrase-wrapping");
    const wrapped = await wrapRoot(root, wrapping);

    await expect(
      unwrapRoot({ ...wrapped, wrapId: "AAAAAAAAAAAAAAAAAAAAAA" }, wrapping),
    ).rejects.toThrow(/failed authentication/);

    const nonce = new Uint8Array(wrapped.nonce.slice(0));
    nonce[0] = (nonce[0] as number) ^ 0x01;
    await expect(
      unwrapRoot({ ...wrapped, nonce: nonce.buffer }, wrapping),
    ).rejects.toThrow(IntegrityError);

    const ciphertext = new Uint8Array(wrapped.ciphertext.slice(0));
    ciphertext[7] = (ciphertext[7] as number) ^ 0x80;
    await expect(
      unwrapRoot({ ...wrapped, ciphertext: ciphertext.buffer }, wrapping),
    ).rejects.toThrow(IntegrityError);

    await expect(
      unwrapRoot({ ...wrapped, nonce: new ArrayBuffer(23) }, wrapping),
    ).rejects.toThrow(CryptoError);
  });
});
