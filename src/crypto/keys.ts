/**
 * Opaque secret-key handles.
 *
 * Key bytes never leave this module in an exported value: a handle is a frozen
 * label object and the bytes live in a module-private `WeakMap`, so a handle
 * has no enumerable byte property, does not serialize across `postMessage`,
 * and cannot be logged into existence (architecture § Cipher profile, "key
 * bytes confined to worker memory"). {@link readKeyBytes} is the M08-internal
 * accessor: `tests/unit/crypto/module-boundaries.test.ts` asserts that nothing
 * outside `src/crypto/` names it.
 */

import { CryptoError, IntegrityError } from "../domain/model/errors.js";
import { encodeBase64Url } from "../domain/model/bytes.js";
import { encodeCanonical } from "../persistence/codecs/canonical-cbor.js";
import type { EntropyPort } from "../application/ports/entropy.js";
import type { WrappedLocalRootV1 } from "../migrations/001_local_store_v1.js";
import { ENVELOPE_NONCE_BYTES } from "../migrations/003_envelope_format_v1.js";
import { loadSodium, wipe } from "./sodium.js";

export const SECRET_KEY_BYTES = 32;

export type SecretKeyPurpose =
  | "local-root"
  | "passphrase-wrapping"
  | "recovery-wrapping"
  | "envelope";

export interface SecretKeyHandle {
  readonly purpose: SecretKeyPurpose;
}

export type LocalRootKeyHandle = SecretKeyHandle & {
  readonly purpose: "local-root";
};

const keyBytes = new WeakMap<SecretKeyHandle, Uint8Array>();

/** Takes ownership of `bytes`; callers must not retain their reference. */
export function createSecretKey(
  bytes: Uint8Array,
  purpose: SecretKeyPurpose,
): SecretKeyHandle {
  if (bytes.byteLength !== SECRET_KEY_BYTES) {
    throw new CryptoError("secret keys are 32 bytes");
  }
  const handle: SecretKeyHandle = Object.freeze({ purpose });
  keyBytes.set(handle, bytes);
  return handle;
}

/** @internal M08 only — never re-export or call from outside `src/crypto/`. */
export function readKeyBytes(handle: SecretKeyHandle): Uint8Array {
  const bytes = keyBytes.get(handle);
  if (bytes === undefined) {
    throw new CryptoError("secret key handle is unknown or already destroyed");
  }
  return bytes;
}

/** Zeroizes the handle's bytes and makes further use fail closed. */
export function destroySecretKey(handle: SecretKeyHandle): void {
  const bytes = keyBytes.get(handle);
  if (bytes === undefined) {
    return;
  }
  wipe(bytes);
  keyBytes.delete(handle);
}

const WRAP_ID_BYTES = 16;
const WRAP_SCOPE = "local.wrap";

/**
 * The wrap-domain AAD: canonical CBOR `["sheaf", "local.wrap", wrapId]`. It is
 * deliberately not an envelope AAD — a wrapped root is a bootstrap-row field,
 * not an envelope row, and the two must not be substitutable for each other.
 */
function wrapAad(wrapId: string): Uint8Array {
  return encodeCanonical(["sheaf", WRAP_SCOPE, wrapId]);
}

/** A fresh random 256-bit local root key (architecture § Local key hierarchy). */
export function generateLocalRoot(entropy: EntropyPort): LocalRootKeyHandle {
  const bytes = entropy.randomBytes(SECRET_KEY_BYTES);
  if (bytes.byteLength !== SECRET_KEY_BYTES) {
    throw new CryptoError("entropy port returned the wrong key length");
  }
  return createSecretKey(bytes, "local-root") as LocalRootKeyHandle;
}

/**
 * Wraps the local root under a wrapping key with a fresh wrap ID and nonce.
 * Both the passphrase and the recovery wrapper wrap the same root, so a
 * passphrase change re-wraps and never rewrites app data.
 */
export async function wrapRoot(
  root: LocalRootKeyHandle,
  wrappingKey: SecretKeyHandle,
): Promise<WrappedLocalRootV1> {
  const sodium = await loadSodium();
  const wrapId = encodeBase64Url(sodium.randombytes_buf(WRAP_ID_BYTES));
  const nonce = sodium.randombytes_buf(ENVELOPE_NONCE_BYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    readKeyBytes(root),
    wrapAad(wrapId),
    null,
    nonce,
    readKeyBytes(wrappingKey),
  );

  return {
    wrapId,
    nonce: nonce.slice().buffer,
    ciphertext: ciphertext.slice().buffer,
  };
}

/** Fails closed on a wrong key, a changed wrap ID, or a mutated ciphertext. */
export async function unwrapRoot(
  wrapped: WrappedLocalRootV1,
  wrappingKey: SecretKeyHandle,
): Promise<LocalRootKeyHandle> {
  const sodium = await loadSodium();
  if (wrapped.nonce.byteLength !== ENVELOPE_NONCE_BYTES) {
    throw new CryptoError("wrapped root nonce must be 24 bytes");
  }

  let bytes: Uint8Array;
  try {
    bytes = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      new Uint8Array(wrapped.ciphertext),
      wrapAad(wrapped.wrapId),
      new Uint8Array(wrapped.nonce),
      readKeyBytes(wrappingKey),
    );
  } catch {
    throw new IntegrityError("wrapped local root failed authentication");
  }

  if (bytes.byteLength !== SECRET_KEY_BYTES) {
    wipe(bytes);
    throw new IntegrityError("wrapped local root is not a 32-byte key");
  }
  return createSecretKey(bytes, "local-root") as LocalRootKeyHandle;
}
