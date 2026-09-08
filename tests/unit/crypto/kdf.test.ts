import { describe, expect, it } from "vitest";
import {
  ARGON2ID_FLOOR,
  KDF_OUTPUT_BYTES,
  PASSPHRASE_KDF_CONTEXT,
  RECOVERY_KDF_CONTEXT,
  calibrateKdf,
  createPassphraseKdfDescriptor,
  createRecoveryKdfDescriptor,
  deriveWrappingKeyFromPassphrase,
  deriveWrappingKeyFromRecoveryCode,
  hkdfSha256,
  type Argon2idParams,
} from "../../../src/crypto/kdf.js";
import { encryptEnvelope } from "../../../src/crypto/envelope.js";
import { asStorageId16 } from "../../../src/domain/model/bytes.js";
import { CryptoError } from "../../../src/domain/model/errors.js";
import type { ClockPort } from "../../../src/application/ports/clock.js";
import type { EntropyPort } from "../../../src/application/ports/entropy.js";
import type {
  Argon2idDescriptorV1,
  RecoveryKdfDescriptorV1,
} from "../../../src/migrations/001_local_store_v1.js";

const hex = (text: string): Uint8Array =>
  Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const countingEntropy = (seed: number): EntropyPort => ({
  randomBytes: (byteLength) =>
    Uint8Array.from({ length: byteLength }, (_, index) => (seed + index) % 256),
});

const passphraseDescriptor = (
  overrides: Partial<Argon2idDescriptorV1> = {},
): Argon2idDescriptorV1 => ({
  algorithm: "argon2id",
  algorithmVersion: 0x13,
  salt: hex("000102030405060708090a0b0c0d0e0f").buffer as ArrayBuffer,
  memoryKiB: ARGON2ID_FLOOR.memoryKiB,
  iterations: ARGON2ID_FLOOR.iterations,
  lanes: 1,
  outputBytes: 32,
  context: PASSPHRASE_KDF_CONTEXT,
  ...overrides,
});

const recoveryDescriptor = (
  overrides: Partial<RecoveryKdfDescriptorV1> = {},
): RecoveryKdfDescriptorV1 => ({
  algorithm: "hkdf-sha-256",
  salt: hex("101112131415161718191a1b1c1d1e1f").buffer as ArrayBuffer,
  outputBytes: 32,
  context: RECOVERY_KDF_CONTEXT,
  ...overrides,
});

/**
 * A derived key never leaves the module, so a derivation is pinned through the
 * bytes it produces: this is `encryptEnvelope` under a fixed storage id,
 * revision, payload, and nonce, keyed by the derived wrapping key.
 */
const sealWith = async (key: Awaited<ReturnType<typeof deriveWrappingKeyFromPassphrase>>) =>
  toHex(
    (
      await encryptEnvelope({
        scope: "local.catalog",
        storageId: asStorageId16(new Uint8Array(16)),
        logicalRevision: 1n,
        payloadKind: "local.catalog",
        payload: hex("0102030405060708"),
        compression: "none",
        key,
        nonce: hex("000102030405060708090a0b0c0d0e0f1011121314151617"),
      })
    ).ciphertext,
  ).slice(0, 64);

describe("Argon2id passphrase derivation", () => {
  it("derives the recorded known answer at the v1 floor", async () => {
    const derived = await deriveWrappingKeyFromPassphrase(
      "correct horse battery staple",
      passphraseDescriptor(),
    );
    expect(await sealWith(derived)).toBe(
      "8066a3884fd44b7f7148262e60fa944bb9ff8efba4b71ca0227925c8b3610823",
    );
  });

  it("derives a different key for a different passphrase or salt", async () => {
    const base = await sealWith(
      await deriveWrappingKeyFromPassphrase("passphrase", passphraseDescriptor()),
    );
    const otherPassphrase = await sealWith(
      await deriveWrappingKeyFromPassphrase("passphrasf", passphraseDescriptor()),
    );
    const otherSalt = await sealWith(
      await deriveWrappingKeyFromPassphrase(
        "passphrase",
        passphraseDescriptor({
          salt: hex("0f0e0d0c0b0a09080706050403020100").buffer as ArrayBuffer,
        }),
      ),
    );

    expect(new Set([base, otherPassphrase, otherSalt]).size).toBe(3);
  });

  it("refuses a descriptor below the floor or outside the v1 suite", async () => {
    const cases: readonly Partial<Argon2idDescriptorV1>[] = [
      { memoryKiB: ARGON2ID_FLOOR.memoryKiB - 1 },
      { iterations: 2 },
      { lanes: 2 },
      { algorithmVersion: 0x10 as never },
      { algorithm: "argon2i" as never },
      { outputBytes: 16 as never },
      { context: "sheaf/local/other/v1" as never },
      { salt: new ArrayBuffer(15) },
    ];
    for (const overrides of cases) {
      await expect(
        deriveWrappingKeyFromPassphrase("p", passphraseDescriptor(overrides)),
        JSON.stringify(Object.keys(overrides)),
      ).rejects.toThrow(CryptoError);
    }
  });

  it("creates descriptors at the floor with a fresh 16-byte salt", () => {
    const descriptor = createPassphraseKdfDescriptor(countingEntropy(3));
    expect(descriptor).toMatchObject({
      algorithm: "argon2id",
      algorithmVersion: 0x13,
      memoryKiB: ARGON2ID_FLOOR.memoryKiB,
      iterations: ARGON2ID_FLOOR.iterations,
      lanes: 1,
      outputBytes: KDF_OUTPUT_BYTES,
      context: PASSPHRASE_KDF_CONTEXT,
    });
    expect(descriptor.salt.byteLength).toBe(16);
    expect(() =>
      createPassphraseKdfDescriptor(countingEntropy(3), {
        ...ARGON2ID_FLOOR,
        iterations: 1,
      }),
    ).toThrow(/below the v1 floor/);
  });
});

describe("RFC 5869 HKDF-SHA-256", () => {
  /** RFC 5869 § Appendix A, test cases 1–3. */
  const VECTORS = [
    {
      name: "A.1 basic",
      ikm: "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
      salt: "000102030405060708090a0b0c",
      info: "f0f1f2f3f4f5f6f7f8f9",
      length: 42,
      okm:
        "3cb25f25faacd57a90434f64d0362f2a" +
        "2d2d0a90cf1a5a4c5db02d56ecc4c5bf" +
        "34007208d5b887185865",
    },
    {
      name: "A.2 longer inputs",
      ikm:
        "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f" +
        "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f" +
        "404142434445464748494a4b4c4d4e4f",
      salt:
        "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f" +
        "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f" +
        "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf",
      info:
        "b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecf" +
        "d0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeef" +
        "f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
      length: 82,
      okm:
        "b11e398dc80327a1c8e7f78c596a4934" +
        "4f012eda2d4efad8a050cc4c19afa97c" +
        "59045a99cac7827271cb41c65e590e09" +
        "da3275600c2f09b8367793a9aca3db71" +
        "cc30c58179ec3e87c14c01d5c1f3434f" +
        "1d87",
    },
    {
      name: "A.3 zero-length salt and info",
      ikm: "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
      salt: "",
      info: "",
      length: 42,
      okm:
        "8da4e775a563c18f715f802a063c5a31" +
        "b8a11f5c5ee1879ec3454e5f3c738d2d" +
        "9d201395faa4b61a96c8",
    },
  ] as const;

  it("matches every published vector", async () => {
    for (const vector of VECTORS) {
      expect(
        toHex(
          await hkdfSha256(
            hex(vector.ikm),
            vector.salt === "" ? new Uint8Array(32) : hex(vector.salt),
            hex(vector.info),
            vector.length,
          ),
        ),
        vector.name,
      ).toBe(vector.okm);
    }
  });
});

describe("recovery-code derivation", () => {
  it("binds the derived key to the recovery secret and salt", async () => {
    const secret = hex(
      "b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecf",
    );
    const key = await deriveWrappingKeyFromRecoveryCode(secret, recoveryDescriptor());
    expect(key.purpose).toBe("recovery-wrapping");

    const again = await deriveWrappingKeyFromRecoveryCode(
      secret,
      recoveryDescriptor(),
    );
    const otherSecret = await deriveWrappingKeyFromRecoveryCode(
      hex("b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcec0"),
      recoveryDescriptor(),
    );
    const otherSalt = await deriveWrappingKeyFromRecoveryCode(
      secret,
      recoveryDescriptor({ salt: new ArrayBuffer(16) }),
    );

    expect(await sealWith(again)).toBe(await sealWith(key));
    expect(new Set([await sealWith(key), await sealWith(otherSecret), await sealWith(otherSalt)]).size).toBe(3);
  });

  it("refuses a descriptor outside the v1 suite", async () => {
    const secret = new Uint8Array(32);
    await expect(
      deriveWrappingKeyFromRecoveryCode(
        secret,
        recoveryDescriptor({ algorithm: "hkdf-sha-512" as never }),
      ),
    ).rejects.toThrow(/not the v1 suite/);
    await expect(
      deriveWrappingKeyFromRecoveryCode(
        secret,
        recoveryDescriptor({ salt: new ArrayBuffer(8) }),
      ),
    ).rejects.toThrow(/shorter than 16 bytes/);
  });

  it("creates a recovery descriptor with an independent salt", () => {
    const descriptor = createRecoveryKdfDescriptor(countingEntropy(9));
    expect(descriptor.algorithm).toBe("hkdf-sha-256");
    expect(descriptor.context).toBe(RECOVERY_KDF_CONTEXT);
    expect(descriptor.salt.byteLength).toBe(16);
    expect(toHex(new Uint8Array(descriptor.salt))).not.toBe(
      toHex(new Uint8Array(createPassphraseKdfDescriptor(countingEntropy(1)).salt)),
    );
  });
});

describe("calibration", () => {
  /** A clock that advances by the scripted cost of each probed parameter set. */
  const scriptedClock = (cost: (params: Argon2idParams) => number) => {
    let now = 1_000;
    const clock: ClockPort = { nowEpochMs: () => now };
    return {
      clock,
      probe: (params: Argon2idParams) => {
        now += cost(params);
        return Promise.resolve();
      },
    };
  };

  it("stops at the first parameters inside the target window", async () => {
    const scripted = scriptedClock((params) => params.memoryKiB / 256);
    const calibrated = await calibrateKdf(scripted.clock, {
      probe: scripted.probe,
    });

    // 65,536 KiB → 256 ms, 131,072 → 512 ms: inside 500–800 ms.
    expect(calibrated).toEqual({
      memoryKiB: 131_072,
      iterations: 3,
      lanes: 1,
    });
  });

  it("never returns parameters below the floor on a slow device", async () => {
    const scripted = scriptedClock(() => 5_000);
    expect(await calibrateKdf(scripted.clock, { probe: scripted.probe })).toEqual(
      ARGON2ID_FLOOR,
    );
  });

  it("raises iterations once memory reaches its ceiling", async () => {
    const scripted = scriptedClock(() => 1);
    const calibrated = await calibrateKdf(scripted.clock, {
      probe: scripted.probe,
      maxMemoryKiB: 131_072,
      maxIterations: 5,
    });
    expect(calibrated).toEqual({ memoryKiB: 131_072, iterations: 5, lanes: 1 });
  });

  it("keeps the last accepted parameters when the next probe overshoots", async () => {
    const scripted = scriptedClock((params) =>
      params.memoryKiB > 131_072 ? 4_000 : 100,
    );
    expect(await calibrateKdf(scripted.clock, { probe: scripted.probe })).toEqual({
      memoryKiB: 131_072,
      iterations: 3,
      lanes: 1,
    });
  });

  it.runIf(process.env["SHEAF_SLOW_TESTS"] === "1")(
    "calibrates against real Argon2id runs",
    async () => {
      const calibrated = await calibrateKdf({ nowEpochMs: () => Date.now() });
      expect(calibrated.memoryKiB).toBeGreaterThanOrEqual(
        ARGON2ID_FLOOR.memoryKiB,
      );
      expect(calibrated.iterations).toBeGreaterThanOrEqual(
        ARGON2ID_FLOOR.iterations,
      );
    },
    60_000,
  );
});
