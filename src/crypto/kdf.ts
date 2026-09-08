/**
 * Key derivation: Argon2id for the passphrase wrapper, HKDF-SHA-256 for the
 * recovery wrapper (architecture § Cipher profile, § Local Key Hierarchy).
 *
 * **Floor.** Argon2id v1.3, at least 65,536 KiB, 3 iterations, 1 lane, 32-byte
 * output. {@link calibrateKdf} may raise those numbers and never lowers them.
 *
 * **Domain separation.** libsodium's Argon2id takes a fixed 16-byte salt and
 * has no personalisation input, so the descriptor's `context` string is folded
 * into the salt: `argon2Salt = HMAC-SHA-256(key = descriptor.salt, message =
 * UTF-8(context))[0..16]`. The stored salt may therefore be any length ≥ 16
 * (database.md § bootstrap), and the same passphrase under a different context
 * derives an unrelated key.
 *
 * **HKDF (D3).** The pinned `libsodium-wrappers-sumo` build exposes the
 * `crypto_kdf_hkdf_sha256_*` size constants but not the functions, so RFC 5869
 * is implemented here over `crypto_auth_hmacsha256_{init,update,final}` — the
 * multi-part API, which accepts the arbitrary-length keys extract needs.
 * `tests/unit/crypto/kdf.test.ts` holds the RFC 5869 known-answer vectors.
 */

import { CryptoError } from "../domain/model/errors.js";
import type { ClockPort } from "../application/ports/clock.js";
import type { EntropyPort } from "../application/ports/entropy.js";
import type {
  Argon2idDescriptorV1,
  RecoveryKdfDescriptorV1,
} from "../migrations/001_local_store_v1.js";
import { createSecretKey, type SecretKeyHandle, type SecretKeyPurpose } from "./keys.js";
import { loadSodium, wipe, type Sodium } from "./sodium.js";

export const PASSPHRASE_KDF_CONTEXT = "sheaf/local/passphrase/v1";
export const RECOVERY_KDF_CONTEXT = "sheaf/local/recovery/v1";
export const KDF_OUTPUT_BYTES = 32;
export const KDF_SALT_BYTES = 16;
const ARGON2ID_SALT_BYTES = 16;
const HMAC_SHA256_BYTES = 32;

export interface Argon2idParams {
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly lanes: 1;
}

/** architecture § Cipher profile: 64 MiB, three iterations, one lane. */
export const ARGON2ID_FLOOR: Argon2idParams = Object.freeze({
  memoryKiB: 65_536,
  iterations: 3,
  lanes: 1,
});

/** A reference phone should stay under this while calibrating upward. */
export const ARGON2ID_MEMORY_CEILING_KIB = 262_144;
export const ARGON2ID_ITERATION_CEILING = 10;

const textEncoder = new TextEncoder();

function hmacSha256(sodium: Sodium, key: Uint8Array, message: Uint8Array): Uint8Array {
  const state = sodium.crypto_auth_hmacsha256_init(key);
  sodium.crypto_auth_hmacsha256_update(state, message);
  return sodium.crypto_auth_hmacsha256_final(state);
}

/** RFC 5869 § 2.2. `salt` may be empty, in which case it is 32 zero bytes. */
export function hkdfExtract(
  sodium: Sodium,
  salt: Uint8Array,
  inputKeyingMaterial: Uint8Array,
): Uint8Array {
  return hmacSha256(sodium, salt, inputKeyingMaterial);
}

/** RFC 5869 § 2.3. */
export function hkdfExpand(
  sodium: Sodium,
  pseudoRandomKey: Uint8Array,
  info: Uint8Array,
  outputBytes: number,
): Uint8Array {
  if (outputBytes < 0 || outputBytes > 255 * HMAC_SHA256_BYTES) {
    throw new CryptoError("HKDF output length is out of range");
  }
  const output = new Uint8Array(outputBytes);
  let block: Uint8Array = new Uint8Array(0);
  let written = 0;

  for (let counter = 1; written < outputBytes; counter += 1) {
    const input = new Uint8Array(block.byteLength + info.byteLength + 1);
    input.set(block);
    input.set(info, block.byteLength);
    input[input.byteLength - 1] = counter;
    block = hmacSha256(sodium, pseudoRandomKey, input);
    const take = Math.min(block.byteLength, outputBytes - written);
    output.set(block.subarray(0, take), written);
    written += take;
  }
  return output;
}

/** @internal M08 only — RFC 5869 HKDF-SHA-256 over raw bytes, for KATs. */
export async function hkdfSha256(
  inputKeyingMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  outputBytes: number,
): Promise<Uint8Array> {
  const sodium = await loadSodium();
  const pseudoRandomKey = hkdfExtract(sodium, salt, inputKeyingMaterial);
  const output = hkdfExpand(sodium, pseudoRandomKey, info, outputBytes);
  wipe(pseudoRandomKey);
  return output;
}

export function createPassphraseKdfDescriptor(
  entropy: EntropyPort,
  params: Argon2idParams = ARGON2ID_FLOOR,
): Argon2idDescriptorV1 {
  assertAtOrAboveFloor(params);
  const salt = entropy.randomBytes(KDF_SALT_BYTES);
  if (salt.byteLength !== KDF_SALT_BYTES) {
    throw new CryptoError("entropy port returned the wrong salt length");
  }
  return {
    algorithm: "argon2id",
    algorithmVersion: 0x13,
    salt: toArrayBuffer(salt),
    memoryKiB: params.memoryKiB,
    iterations: params.iterations,
    lanes: params.lanes,
    outputBytes: KDF_OUTPUT_BYTES,
    context: PASSPHRASE_KDF_CONTEXT,
  };
}

export function createRecoveryKdfDescriptor(
  entropy: EntropyPort,
): RecoveryKdfDescriptorV1 {
  const salt = entropy.randomBytes(KDF_SALT_BYTES);
  if (salt.byteLength !== KDF_SALT_BYTES) {
    throw new CryptoError("entropy port returned the wrong salt length");
  }
  return {
    algorithm: "hkdf-sha-256",
    salt: toArrayBuffer(salt),
    outputBytes: KDF_OUTPUT_BYTES,
    context: RECOVERY_KDF_CONTEXT,
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function assertAtOrAboveFloor(params: Argon2idParams): void {
  if (
    !Number.isSafeInteger(params.memoryKiB) ||
    params.memoryKiB < ARGON2ID_FLOOR.memoryKiB ||
    !Number.isSafeInteger(params.iterations) ||
    params.iterations < ARGON2ID_FLOOR.iterations ||
    params.lanes !== ARGON2ID_FLOOR.lanes
  ) {
    throw new CryptoError("Argon2id parameters are below the v1 floor");
  }
}

function assertUsableDescriptor(descriptor: Argon2idDescriptorV1): void {
  if (
    descriptor.algorithm !== "argon2id" ||
    descriptor.algorithmVersion !== 0x13 ||
    descriptor.outputBytes !== KDF_OUTPUT_BYTES
  ) {
    throw new CryptoError("passphrase KDF descriptor is not the v1 suite");
  }
  if (descriptor.context !== PASSPHRASE_KDF_CONTEXT) {
    throw new CryptoError("passphrase KDF descriptor has an unknown context");
  }
  if (descriptor.salt.byteLength < KDF_SALT_BYTES) {
    throw new CryptoError("passphrase KDF salt is shorter than 16 bytes");
  }
  assertAtOrAboveFloor({
    memoryKiB: descriptor.memoryKiB,
    iterations: descriptor.iterations,
    lanes: descriptor.lanes as 1,
  });
}

/** The documented context-into-salt binding; see the module header. */
function argon2Salt(
  sodium: Sodium,
  salt: ArrayBuffer,
  context: string,
): Uint8Array {
  return hmacSha256(
    sodium,
    new Uint8Array(salt),
    textEncoder.encode(context),
  ).slice(0, ARGON2ID_SALT_BYTES);
}

async function argon2id(
  passphrase: string,
  descriptor: Argon2idDescriptorV1,
): Promise<Uint8Array> {
  const sodium = await loadSodium();
  const salt = argon2Salt(sodium, descriptor.salt, descriptor.context);
  try {
    return sodium.crypto_pwhash(
      descriptor.outputBytes,
      passphrase,
      salt,
      descriptor.iterations,
      descriptor.memoryKiB * 1024,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
  } finally {
    wipe(salt);
  }
}

export async function deriveWrappingKeyFromPassphrase(
  passphrase: string,
  descriptor: Argon2idDescriptorV1,
  purpose: SecretKeyPurpose = "passphrase-wrapping",
): Promise<SecretKeyHandle> {
  assertUsableDescriptor(descriptor);
  return createSecretKey(await argon2id(passphrase, descriptor), purpose);
}

export async function deriveWrappingKeyFromRecoveryCode(
  recoveryCodeBytes: Uint8Array,
  descriptor: RecoveryKdfDescriptorV1,
  purpose: SecretKeyPurpose = "recovery-wrapping",
): Promise<SecretKeyHandle> {
  if (
    descriptor.algorithm !== "hkdf-sha-256" ||
    descriptor.outputBytes !== KDF_OUTPUT_BYTES ||
    descriptor.context !== RECOVERY_KDF_CONTEXT
  ) {
    throw new CryptoError("recovery KDF descriptor is not the v1 suite");
  }
  if (descriptor.salt.byteLength < KDF_SALT_BYTES) {
    throw new CryptoError("recovery KDF salt is shorter than 16 bytes");
  }
  return createSecretKey(
    await hkdfSha256(
      recoveryCodeBytes,
      new Uint8Array(descriptor.salt),
      textEncoder.encode(descriptor.context),
      descriptor.outputBytes,
    ),
    purpose,
  );
}

export interface CalibrationOptions {
  /** Target derivation cost on this device, in milliseconds. */
  readonly targetMinMs?: number;
  readonly targetMaxMs?: number;
  readonly maxMemoryKiB?: number;
  readonly maxIterations?: number;
  /**
   * What one derivation costs. Defaults to a real Argon2id run at the
   * candidate parameters; tests inject a scripted probe so calibration logic
   * can be exercised without minute-long unit runs.
   */
  readonly probe?: (params: Argon2idParams) => Promise<void>;
}

/**
 * Raises Argon2id parameters toward ~500–800 ms on this device, memory first,
 * then iterations. It never returns anything below {@link ARGON2ID_FLOOR}: a
 * slow device keeps the floor and pays for it.
 */
export async function calibrateKdf(
  clock: ClockPort,
  options: CalibrationOptions = {},
): Promise<Argon2idParams> {
  const targetMinMs = options.targetMinMs ?? 500;
  const targetMaxMs = options.targetMaxMs ?? 800;
  const maxMemoryKiB = Math.max(
    options.maxMemoryKiB ?? ARGON2ID_MEMORY_CEILING_KIB,
    ARGON2ID_FLOOR.memoryKiB,
  );
  const maxIterations = Math.max(
    options.maxIterations ?? ARGON2ID_ITERATION_CEILING,
    ARGON2ID_FLOOR.iterations,
  );
  const probe = options.probe ?? defaultProbe;

  let candidate: Argon2idParams = ARGON2ID_FLOOR;
  let accepted: Argon2idParams = ARGON2ID_FLOOR;

  for (;;) {
    const started = clock.nowEpochMs();
    await probe(candidate);
    const elapsed = clock.nowEpochMs() - started;

    if (elapsed > targetMaxMs) {
      return accepted;
    }
    accepted = candidate;
    if (elapsed >= targetMinMs) {
      return accepted;
    }

    if (candidate.memoryKiB * 2 <= maxMemoryKiB) {
      candidate = { ...candidate, memoryKiB: candidate.memoryKiB * 2 };
      continue;
    }
    if (candidate.iterations + 1 <= maxIterations) {
      candidate = { ...candidate, iterations: candidate.iterations + 1 };
      continue;
    }
    return accepted;
  }
}

async function defaultProbe(params: Argon2idParams): Promise<void> {
  const sodium = await loadSodium();
  const derived = await argon2id("sheaf-calibration-probe", {
    algorithm: "argon2id",
    algorithmVersion: 0x13,
    salt: toArrayBuffer(sodium.randombytes_buf(KDF_SALT_BYTES)),
    memoryKiB: params.memoryKiB,
    iterations: params.iterations,
    lanes: params.lanes,
    outputBytes: KDF_OUTPUT_BYTES,
    context: PASSPHRASE_KDF_CONTEXT,
  });
  wipe(derived);
}
