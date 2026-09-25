import type { EnvelopeKeyRefV1 } from "./envelope-crypto.js";
import type { VaultArgon2idDescriptorV1, VaultRecoveryKdfDescriptorV1, WrappedKeyV1 } from "../../migrations/006_vault_format_v1.js";

export interface VaultKeyRefV1 extends EnvelopeKeyRefV1 { readonly purpose: "vault-root" }
export interface VaultSecretsV1 {
  readonly key: VaultKeyRefV1;
  readonly recoveryCode: string;
  readonly passphraseKdf: VaultArgon2idDescriptorV1;
  readonly recoveryKdf: VaultRecoveryKdfDescriptorV1;
  readonly passphraseWrappedVaultKey: WrappedKeyV1;
  readonly recoveryWrappedVaultKey: WrappedKeyV1;
}
export interface VaultCryptoPort {
  create(passphrase: string, vaultId: Uint8Array): Promise<VaultSecretsV1>;
  openWithPassphrase(passphrase: string, vaultId: Uint8Array, kdf: VaultArgon2idDescriptorV1, wrapped: WrappedKeyV1): Promise<VaultKeyRefV1>;
  openWithRecovery(code: string, vaultId: Uint8Array, kdf: VaultRecoveryKdfDescriptorV1, wrapped: WrappedKeyV1): Promise<VaultKeyRefV1>;
  wrapApp(app: EnvelopeKeyRefV1, vault: VaultKeyRefV1, vaultId: Uint8Array, appId: Uint8Array): Promise<WrappedKeyV1>;
  openApp(wrapped: WrappedKeyV1, vault: VaultKeyRefV1, vaultId: Uint8Array, appId: Uint8Array): Promise<EnvelopeKeyRefV1>;
  protectLocally(vault: VaultKeyRefV1, local: EnvelopeKeyRefV1, vaultId: Uint8Array): Promise<WrappedKeyV1>;
  openLocally(wrapped: WrappedKeyV1, local: EnvelopeKeyRefV1, vaultId: Uint8Array): Promise<VaultKeyRefV1>;
  destroy(key: EnvelopeKeyRefV1): void;
}
