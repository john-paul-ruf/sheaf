import type { EntropyPort } from "../application/ports/entropy.js";
import { CryptoError, IntegrityError } from "../domain/model/errors.js";
import { encodeCanonical, type CborValue } from "../persistence/codecs/canonical-cbor.js";
import type { VaultArgon2idDescriptorV1, VaultRecoveryKdfDescriptorV1, WrappedKeyV1 } from "../migrations/006_vault_format_v1.js";
import { createSecretKey, destroySecretKey, readKeyBytes, type LocalRootKeyHandle, type SecretKeyHandle, type SecretKeyPurpose } from "./keys.js";
import { createVaultPassphraseKdfDescriptor, createVaultRecoveryKdfDescriptor, deriveVaultPassphraseKey, deriveVaultRecoveryKey, type Argon2idParams } from "./kdf.js";
import { generateRecoveryCode, parseRecoveryCode } from "./recovery-code.js";
import { loadSodium, wipe } from "./sodium.js";

export type VaultKeyHandle = SecretKeyHandle & { readonly purpose: "vault-root" };

function requirePurpose(key: SecretKeyHandle, purpose: SecretKeyPurpose): void {
  if (key.purpose !== purpose) throw new CryptoError("key purpose does not match the wrapping scope");
  readKeyBytes(key);
}

function aad(scope: string, vaultId: Uint8Array, wrapId: Uint8Array, context: CborValue): Uint8Array {
  if (vaultId.byteLength !== 16 || wrapId.byteLength !== 16) throw new CryptoError("wrap identifiers must be 16 bytes");
  return encodeCanonical(["sheaf", scope, vaultId, wrapId, context]);
}

function descriptorContext(descriptor: VaultArgon2idDescriptorV1 | VaultRecoveryKdfDescriptorV1): CborValue {
  return new Map<string, CborValue>(Object.entries(descriptor));
}

async function wrap(key: SecretKeyHandle, protector: SecretKeyHandle, scope: string,
  vaultId: Uint8Array, context: CborValue, entropy: EntropyPort): Promise<WrappedKeyV1> {
  const sodium = await loadSodium();
  const wrapId = entropy.randomBytes(16);
  const nonce = entropy.randomBytes(24);
  if (nonce.byteLength !== 24) throw new CryptoError("wrap nonce must be 24 bytes");
  return { wrapId, nonce, ciphertext: sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    readKeyBytes(key), aad(scope, vaultId, wrapId, context), null, nonce, readKeyBytes(protector)) };
}

async function unwrap(wrapped: WrappedKeyV1, protector: SecretKeyHandle, scope: string,
  vaultId: Uint8Array, context: CborValue, purpose: SecretKeyPurpose): Promise<SecretKeyHandle> {
  const sodium = await loadSodium();
  if (wrapped.nonce.byteLength !== 24 || wrapped.ciphertext.byteLength !== 48) throw new IntegrityError("invalid wrapped key dimensions");
  let bytes: Uint8Array;
  try {
    bytes = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, wrapped.ciphertext,
      aad(scope, vaultId, wrapped.wrapId, context), wrapped.nonce, readKeyBytes(protector));
  } catch {
    throw new IntegrityError("wrapped key failed scope authentication");
  }
  try { return createSecretKey(bytes, purpose); }
  catch (error) { wipe(bytes); throw error; }
}

export function generateVaultKey(entropy: EntropyPort): VaultKeyHandle {
  return createSecretKey(entropy.randomBytes(32), "vault-root") as VaultKeyHandle;
}

export async function wrapVaultKey(key: VaultKeyHandle, protector: SecretKeyHandle,
  vaultId: Uint8Array, descriptor: VaultArgon2idDescriptorV1 | VaultRecoveryKdfDescriptorV1,
  entropy: EntropyPort): Promise<WrappedKeyV1> {
  requirePurpose(key, "vault-root");
  requirePurpose(protector, descriptor.algorithm === "argon2id" ? "vault-passphrase-wrapping" : "vault-recovery-wrapping");
  return wrap(key, protector, "vault.wrap", vaultId, descriptorContext(descriptor), entropy);
}

export async function unwrapVaultKey(wrapped: WrappedKeyV1, protector: SecretKeyHandle,
  vaultId: Uint8Array, descriptor: VaultArgon2idDescriptorV1 | VaultRecoveryKdfDescriptorV1): Promise<VaultKeyHandle> {
  requirePurpose(protector, descriptor.algorithm === "argon2id" ? "vault-passphrase-wrapping" : "vault-recovery-wrapping");
  return await unwrap(wrapped, protector, "vault.wrap", vaultId, descriptorContext(descriptor), "vault-root") as VaultKeyHandle;
}

export async function wrapAppKey(app: SecretKeyHandle, vault: VaultKeyHandle,
  vaultId: Uint8Array, appId: Uint8Array, entropy: EntropyPort): Promise<WrappedKeyV1> {
  requirePurpose(app, "envelope");
  requirePurpose(vault, "vault-root");
  if (appId.byteLength !== 16) throw new CryptoError("app id must be 16 bytes");
  return wrap(app, vault, "vault.app-wrap", vaultId, appId, entropy);
}

export async function unwrapAppKey(wrapped: WrappedKeyV1, vault: VaultKeyHandle,
  vaultId: Uint8Array, appId: Uint8Array): Promise<SecretKeyHandle> {
  requirePurpose(vault, "vault-root");
  if (appId.byteLength !== 16) throw new CryptoError("app id must be 16 bytes");
  return unwrap(wrapped, vault, "vault.app-wrap", vaultId, appId, "envelope");
}

export async function protectVaultKeyLocally(vault: VaultKeyHandle, local: LocalRootKeyHandle,
  vaultId: Uint8Array, entropy: EntropyPort): Promise<WrappedKeyV1> {
  requirePurpose(vault, "vault-root");
  requirePurpose(local, "local-root");
  return wrap(vault, local, "local.vault-wrap", vaultId, null, entropy);
}

export async function openLocalVaultKey(wrapped: WrappedKeyV1, local: LocalRootKeyHandle,
  vaultId: Uint8Array): Promise<VaultKeyHandle> {
  requirePurpose(local, "local-root");
  return await unwrap(wrapped, local, "local.vault-wrap", vaultId, null, "vault-root") as VaultKeyHandle;
}

export async function createVaultSecrets(passphrase: string, vaultId: Uint8Array,
  entropy: EntropyPort, params?: Argon2idParams) {
  const key = generateVaultKey(entropy);
  let passphraseKey: SecretKeyHandle | undefined;
  let recoveryKey: SecretKeyHandle | undefined;
  let secret: Uint8Array | undefined;
  try {
    const passphraseKdf = createVaultPassphraseKdfDescriptor(entropy, params);
    const recoveryKdf = createVaultRecoveryKdfDescriptor(entropy);
    const recoveryCode = await generateRecoveryCode(entropy);
    secret = await parseRecoveryCode(recoveryCode);
    passphraseKey = await deriveVaultPassphraseKey(passphrase, passphraseKdf);
    recoveryKey = await deriveVaultRecoveryKey(secret, recoveryKdf);
    return { key, recoveryCode, passphraseKdf, recoveryKdf,
      passphraseWrappedVaultKey: await wrapVaultKey(key, passphraseKey, vaultId, passphraseKdf, entropy),
      recoveryWrappedVaultKey: await wrapVaultKey(key, recoveryKey, vaultId, recoveryKdf, entropy) };
  } catch (error) { destroySecretKey(key); throw error; }
  finally {
    if (passphraseKey !== undefined) destroySecretKey(passphraseKey);
    if (recoveryKey !== undefined) destroySecretKey(recoveryKey);
    if (secret !== undefined) wipe(secret);
  }
}
