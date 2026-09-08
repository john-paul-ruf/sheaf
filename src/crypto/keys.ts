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

import { CryptoError } from "../domain/model/errors.js";
import { wipe } from "./sodium.js";

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
