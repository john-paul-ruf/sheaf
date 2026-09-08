/**
 * The single libsodium bootstrap for the whole program (D3).
 *
 * `libsodium-wrappers-sumo` initialises its WASM asynchronously; every crypto
 * entry point awaits {@link loadSodium}, which resolves the same instance for
 * every caller. Nothing else in `src/crypto/` imports the library directly.
 */

import sodium from "libsodium-wrappers-sumo";

export type Sodium = typeof sodium;

let loading: Promise<Sodium> | undefined;
let loaded: Sodium | undefined;

export async function loadSodium(): Promise<Sodium> {
  loading ??= sodium.ready.then(() => {
    loaded = sodium;
    return sodium;
  });
  return loading;
}

/**
 * Best-effort zeroization of key material (architecture § Cipher profile).
 * Uses libsodium's `memzero` once the library is loaded, which the engine may
 * not elide; a plain fill is the fallback before bootstrap has completed.
 */
export function wipe(view: Uint8Array): void {
  if (loaded !== undefined) {
    loaded.memzero(view);
    return;
  }
  view.fill(0);
}
