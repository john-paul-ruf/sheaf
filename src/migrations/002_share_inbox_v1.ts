/** Initial schema for the service-worker-owned transient share inbox. */

export const SHARE_DATABASE_NAME = "sheaf-share-inbox";
export const SHARE_DATABASE_VERSION = 1;
export const SHARE_INBOX_TTL_MS = 30 * 60 * 1_000;

export const SHARE_STORE_V1 = Object.freeze({
  transfers: "transferId, expiresAtMs",
  chunks: "[transferId+ordinal], transferId, expiresAtMs",
});

/**
 * File name, media type, true length, and source metadata are inside the
 * descriptor ciphertext. The one-time content key is never persisted.
 */
export interface ShareTransferRowV1 {
  readonly transferId: string;
  readonly formatVersion: 1;
  readonly cipherSuiteVersion: 1;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly chunkCount: number;
  readonly paddedBytes: number;
  readonly descriptorNonce: ArrayBuffer;
  readonly descriptorCiphertext: ArrayBuffer;
  readonly ciphertextDigest: ArrayBuffer;
}

export interface ShareChunkRowV1 {
  readonly transferId: string;
  readonly ordinal: number;
  readonly expiresAtMs: number;
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

/** Register before the service worker opens its dedicated Dexie database. */
export function registerShareInboxV1(database: DexieDatabaseLike): void {
  database.version(SHARE_DATABASE_VERSION).stores(SHARE_STORE_V1);
}
