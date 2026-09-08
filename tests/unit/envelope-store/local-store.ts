/**
 * Shared setup for the fake-indexeddb unit suites (D8).
 *
 * `fake-indexeddb/auto` installs the shim on globalThis; the real-browser
 * authority for IndexedDB semantics stays `tests/browser/envelope-store/`.
 */

import "fake-indexeddb/auto";
import {
  LOCAL_BOOTSTRAP_SLOT,
  type Argon2idDescriptorV1,
  type LocalBootstrapRowV1,
  type RecoveryKdfDescriptorV1,
  type WrappedLocalRootV1,
} from "../../../src/migrations/001_local_store_v1.js";
import { asStorageId16, encodeStorageId16 } from "../../../src/domain/model/bytes.js";
import {
  ENVELOPE_NONCE_BYTES,
  PADDED_ENVELOPE_BYTES_V1,
  type EnvelopeFrameV1,
} from "../../../src/migrations/003_envelope_format_v1.js";
import {
  closeLocalDatabase,
  openLocalDatabase,
} from "../../../src/persistence/envelope-store/db.js";

const SMALLEST_BUCKET = PADDED_ENVELOPE_BYTES_V1[0];

/** Drops every row and the database file itself, then forgets the handle. */
export async function resetLocalDatabase(): Promise<void> {
  const database = await openLocalDatabase();
  await database.delete({ disableAutoOpen: true });
  closeLocalDatabase();
}

export function bytes(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (seed + index * 31) % 256);
}

export function buffer(length: number, seed: number): ArrayBuffer {
  const target = new ArrayBuffer(length);
  new Uint8Array(target).set(bytes(length, seed));
  return target;
}

export function storageId(seed: number) {
  return asStorageId16(bytes(16, seed));
}

export function storageIdText(seed: number): string {
  return encodeStorageId16(storageId(seed));
}

/**
 * An opaque frame: the store never decrypts, so unit coverage of its
 * transactional behavior does not need real ciphertext. The CA-02 byte-exact
 * proof in `frame-row.test.ts` uses production `encryptEnvelope` output.
 */
export function opaqueFrame(seed: number, logicalRevision: bigint): EnvelopeFrameV1 {
  return {
    envelopeFormatVersion: 1,
    codecVersion: 1,
    cipherSuiteVersion: 1,
    storageId: storageId(seed),
    logicalRevision,
    paddedBytes: SMALLEST_BUCKET,
    nonce: bytes(ENVELOPE_NONCE_BYTES, seed + 1),
    ciphertext: bytes(SMALLEST_BUCKET, seed + 2),
  };
}

const argon2id: Argon2idDescriptorV1 = {
  algorithm: "argon2id",
  algorithmVersion: 0x13,
  salt: new ArrayBuffer(16),
  memoryKiB: 65_536,
  iterations: 3,
  lanes: 1,
  outputBytes: 32,
  context: "sheaf/local/passphrase/v1",
};

const recoveryKdf: RecoveryKdfDescriptorV1 = {
  algorithm: "hkdf-sha-256",
  salt: new ArrayBuffer(16),
  outputBytes: 32,
  context: "sheaf/local/recovery/v1",
};

export function wrappedRoot(seed: number): WrappedLocalRootV1 {
  return {
    wrapId: storageIdText(seed),
    nonce: buffer(ENVELOPE_NONCE_BYTES, seed),
    ciphertext: buffer(48, seed + 1),
  };
}

export function passphraseKdf(saltSeed: number): Argon2idDescriptorV1 {
  return { ...argon2id, salt: buffer(16, saltSeed) };
}

export function bootstrapRow(
  overrides: Partial<LocalBootstrapRowV1> = {},
): LocalBootstrapRowV1 {
  return {
    slot: LOCAL_BOOTSTRAP_SLOT,
    databaseFormatVersion: 1,
    minimumReaderVersion: 1,
    codecVersion: 1,
    envelopeFormatVersion: 1,
    cipherSuiteVersion: 1,
    paddingProfileVersion: 1,
    transactionRevision: 1,
    writerEpoch: 0,
    passphraseKdf: passphraseKdf(3),
    recoveryKdf,
    passphraseWrappedRoot: wrappedRoot(5),
    recoveryWrappedRoot: wrappedRoot(7),
    catalogStorageId: storageIdText(11),
    migrationStorageId: null,
    ...overrides,
  };
}
