import type { EntropyPort } from "../application/ports/entropy.js";
import type { VaultCryptoPort } from "../application/ports/vault-crypto.js";
import { destroySecretKey, type LocalRootKeyHandle, type SecretKeyHandle } from "./keys.js";
import { deriveVaultPassphraseKey, deriveVaultRecoveryKey } from "./kdf.js";
import { parseRecoveryCode } from "./recovery-code.js";
import { wipe } from "./sodium.js";
import { createVaultSecrets, openLocalVaultKey, protectVaultKeyLocally, unwrapAppKey, unwrapVaultKey, wrapAppKey } from "./vault.js";

export function createVaultCrypto(entropy: EntropyPort): VaultCryptoPort {
  return {
    create: (passphrase, vaultId) => createVaultSecrets(passphrase, vaultId, entropy),
    async openWithPassphrase(passphrase, vaultId, kdf, wrapped) {
      const key = await deriveVaultPassphraseKey(passphrase, kdf);
      try { return await unwrapVaultKey(wrapped, key, vaultId, kdf); }
      finally { destroySecretKey(key); }
    },
    async openWithRecovery(code, vaultId, kdf, wrapped) {
      const secret = await parseRecoveryCode(code);
      let key: SecretKeyHandle | undefined;
      try {
        key = await deriveVaultRecoveryKey(secret, kdf);
        return await unwrapVaultKey(wrapped, key, vaultId, kdf);
      } finally {
        wipe(secret);
        if (key !== undefined) destroySecretKey(key);
      }
    },
    wrapApp: (app, vault, vaultId, appId) => wrapAppKey(app as SecretKeyHandle, vault, vaultId, appId, entropy),
    openApp: unwrapAppKey,
    protectLocally: (vault, local, vaultId) => protectVaultKeyLocally(vault, local as LocalRootKeyHandle, vaultId, entropy),
    openLocally: (wrapped, local, vaultId) => openLocalVaultKey(wrapped, local as LocalRootKeyHandle, vaultId),
    destroy: (key) => destroySecretKey(key as SecretKeyHandle),
  };
}
