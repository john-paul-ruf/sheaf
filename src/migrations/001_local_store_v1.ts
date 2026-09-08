/**
 * Initial durable IndexedDB schema for the encrypted Sheaf local store.
 *
 * This migration intentionally declares only keys and indexes. IndexedDB
 * stores every non-indexed property, but Dexie schema strings must never name
 * semantic fields because all semantic material belongs inside ciphertext.
 */

export const LOCAL_DATABASE_NAME = "sheaf-local";
export const LOCAL_DATABASE_VERSION = 1;
export const LOCAL_BOOTSTRAP_SLOT = "root" as const;

export const LOCAL_STORE_V1 = Object.freeze({
  bootstrap: "slot",
  envelopes: "storageId, revision, [revision+storageId]",
});

export interface Argon2idDescriptorV1 {
  readonly algorithm: "argon2id";
  readonly algorithmVersion: 0x13;
  readonly salt: ArrayBuffer;
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly lanes: number;
  readonly outputBytes: 32;
  readonly context: "sheaf/local/passphrase/v1";
}

export interface RecoveryKdfDescriptorV1 {
  readonly algorithm: "hkdf-sha-256";
  readonly salt: ArrayBuffer;
  readonly outputBytes: 32;
  readonly context: "sheaf/local/recovery/v1";
}

export interface WrappedLocalRootV1 {
  readonly wrapId: string;
  readonly nonce: ArrayBuffer;
  readonly ciphertext: ArrayBuffer;
}

/** The only clear, well-known row in the main local database. */
export interface LocalBootstrapRowV1 {
  readonly slot: typeof LOCAL_BOOTSTRAP_SLOT;
  readonly databaseFormatVersion: 1;
  readonly minimumReaderVersion: 1;
  readonly codecVersion: 1;
  readonly envelopeFormatVersion: 1;
  readonly cipherSuiteVersion: 1;
  readonly paddingProfileVersion: 1;
  readonly transactionRevision: number;
  readonly writerEpoch: number;
  readonly passphraseKdf: Argon2idDescriptorV1;
  readonly recoveryKdf: RecoveryKdfDescriptorV1;
  readonly passphraseWrappedRoot: WrappedLocalRootV1;
  readonly recoveryWrappedRoot: WrappedLocalRootV1;
  readonly catalogStorageId: string;
  readonly migrationStorageId: string | null;
}

/** A generic immutable ciphertext row. Its kind and owner are never indexed. */
export interface LocalEnvelopeRowV1 {
  readonly storageId: string;
  readonly revision: number;
  readonly envelopeFormatVersion: 1;
  readonly codecVersion: 1;
  readonly cipherSuiteVersion: 1;
  readonly paddedBytes: number;
  readonly nonce: ArrayBuffer;
  readonly ciphertext: ArrayBuffer;
}

export interface DexieVersionLike {
  stores(schema: Readonly<Record<string, string>>): unknown;
}

export interface DexieDatabaseLike {
  version(version: number): DexieVersionLike;
}

/** Register before opening Dexie. Re-registering the same v1 declaration is safe. */
export function registerLocalStoreV1(database: DexieDatabaseLike): void {
  database.version(LOCAL_DATABASE_VERSION).stores(LOCAL_STORE_V1);
}

export const migrateLocalStore = registerLocalStoreV1;
