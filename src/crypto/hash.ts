/**
 * SHA-256 over exact canonical bytes (database.md § Identifiers: "Hash |
 * SHA-256, 32 bytes | Computed over the exact canonical bytes named by the
 * field").
 *
 * Every durable hash in Sheaf — commit hashes, semantic hashes, prior-state
 * hashes — is this function applied to a canonical encoding. It goes through
 * the one libsodium bootstrap (D3) like the rest of M08, so a caller never
 * touches the library directly and no second digest implementation exists.
 *
 * M09 must stay third-party-free, so the event codec receives this function as
 * an injected dependency rather than importing it.
 */

import { loadSodium } from "./sodium.js";

export const SHA256_BYTES = 32;

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const sodium = await loadSodium();
  return sodium.crypto_hash_sha256(bytes);
}
