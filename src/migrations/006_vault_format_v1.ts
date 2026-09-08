/** Baseline provider-neutral vault, app-manifest, and bundle contracts. */

import type { EnvelopeReferenceV1 } from "./003_envelope_format_v1.js";
import type { FrontierEntryV1 } from "./004_event_format_v1.js";

export const VAULT_FORMAT_VERSION = 1;
export const VAULT_HEADER_MAGIC = "SHEAF-VAULT";
export const BUNDLE_MAGIC = "SHEAF-BUNDLE";
export const BUNDLE_FOOTER_MAGIC = "SHEAF-END";

export interface VaultArgon2idDescriptorV1 {
  readonly algorithm: "argon2id";
  readonly algorithmVersion: 0x13;
  readonly salt: Uint8Array;
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly lanes: number;
  readonly outputBytes: 32;
  readonly context: "sheaf/vault/passphrase/v1";
}

export interface VaultRecoveryKdfDescriptorV1 {
  readonly algorithm: "hkdf-sha-256";
  readonly salt: Uint8Array;
  readonly outputBytes: 32;
  readonly context: "sheaf/vault/recovery/v1";
}

export interface WrappedKeyV1 {
  readonly wrapId: Uint8Array;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/**
 * This is the small clear provider object replaced with a conditional write.
 * Its object references and hashes are opaque; names and app facts are not here.
 */
export interface VaultHeaderV1 {
  readonly magic: typeof VAULT_HEADER_MAGIC;
  readonly vaultFormatVersion: 1;
  readonly minimumReaderVersion: 1;
  readonly codecVersion: 1;
  readonly envelopeFormatVersion: 1;
  readonly cipherSuiteVersion: 1;
  readonly paddingProfileVersion: 1;
  readonly vaultId: Uint8Array;
  readonly passphraseKdf: VaultArgon2idDescriptorV1;
  readonly recoveryKdf: VaultRecoveryKdfDescriptorV1;
  readonly passphraseWrappedVaultKey: WrappedKeyV1;
  readonly recoveryWrappedVaultKey: WrappedKeyV1;
  readonly generation: bigint;
  readonly currentIndex: EnvelopeReferenceV1;
  readonly previousHeadSha256: Uint8Array | null;
}

export interface VaultAppEntryV1 {
  readonly appId: Uint8Array;
  readonly displayName: string;
  readonly wrappedAppKey: WrappedKeyV1;
  readonly manifest: EnvelopeReferenceV1;
  readonly recordCount?: bigint;
  readonly lastOpenedAtMs?: bigint;
  readonly lastSuccessfulBackupMs: bigint;
  readonly totalPaddedBytes: bigint;
  readonly appSchemaRevision: bigint;
  readonly confirmedFrontier: readonly FrontierEntryV1[];
}

export interface DeletionMarkerV1 {
  readonly markerId: Uint8Array;
  readonly appId: Uint8Array;
  readonly deletedAtMs: bigint;
  readonly deletingDeviceId: Uint8Array;
  readonly deletionGeneration: bigint;
  readonly finalManifestSha256: Uint8Array;
  readonly finalFrontier: readonly FrontierEntryV1[];
  readonly retention: "permanent";
}

export interface VaultDeviceReceiptV1 {
  readonly deviceId: Uint8Array;
  readonly lastObservedGeneration: bigint;
  readonly observedAtMs: bigint;
  readonly appFrontiers: readonly {
    readonly appId: Uint8Array;
    readonly frontier: readonly FrontierEntryV1[];
  }[];
}

/**
 * An exact historical root retained by the current index. Retention lists in
 * historical indexes are non-authoritative when traversing this root.
 */
export interface RetainedGenerationRootV1 {
  readonly generation: bigint;
  readonly index: EnvelopeReferenceV1;
  readonly headSha256: Uint8Array;
}

/** Encrypted with the vault key and reached from VaultHeaderV1.currentIndex. */
export interface VaultIndexV1 {
  readonly vaultFormatVersion: 1;
  readonly vaultId: Uint8Array;
  readonly generation: bigint;
  readonly previousIndexSha256: Uint8Array | null;
  readonly recoveryCodeForReview: string;
  readonly apps: readonly VaultAppEntryV1[];
  readonly deletionMarkers: readonly DeletionMarkerV1[];
  readonly deviceReceipts: readonly VaultDeviceReceiptV1[];
  readonly retainedGenerationRoots: readonly RetainedGenerationRootV1[];
  readonly createdAtMs: bigint;
  readonly committedAtMs: bigint;
}

export interface AppManifestV1 {
  readonly vaultFormatVersion: 1;
  readonly appId: Uint8Array;
  readonly generation: bigint;
  readonly previousManifestSha256: Uint8Array | null;
  readonly checkpoint: EnvelopeReferenceV1;
  readonly eventSegments: readonly EnvelopeReferenceV1[];
  readonly baselinePages: readonly EnvelopeReferenceV1[];
  readonly conflictPages: readonly EnvelopeReferenceV1[];
  readonly auditPages: readonly EnvelopeReferenceV1[];
  readonly sourceManifests: readonly EnvelopeReferenceV1[];
  readonly snapshotManifests: readonly EnvelopeReferenceV1[];
  readonly retainedRoots: readonly EnvelopeReferenceV1[];
  readonly confirmedFrontier: readonly FrontierEntryV1[];
  readonly semanticSha256: Uint8Array;
  readonly totalPaddedBytes: bigint;
}

export interface BundleDirectoryEntryV1 {
  readonly storageId: Uint8Array;
  readonly byteOffset: bigint;
  readonly byteLength: bigint;
  readonly ciphertextSha256: Uint8Array;
}

/** Fixed-size prefix followed by the canonical VaultHeaderV1 bytes. */
export interface BundlePreambleV1 {
  readonly magic: typeof BUNDLE_MAGIC;
  readonly vaultFormatVersion: 1;
  readonly headerByteLength: number;
}

export interface BundleFooterV1 {
  readonly vaultFormatVersion: 1;
  readonly directory: readonly BundleDirectoryEntryV1[];
  readonly directorySha256: Uint8Array;
  readonly complete: true;
}

/** Fixed-size final trailer makes the canonical footer random-accessible. */
export interface BundleTrailerV1 {
  readonly footerByteLength: bigint;
  readonly magic: typeof BUNDLE_FOOTER_MAGIC;
}

/** V1 has no predecessor; future versions append a new forward migration. */
export function migrateVaultIndex(index: VaultIndexV1): VaultIndexV1 {
  if (index.vaultFormatVersion !== VAULT_FORMAT_VERSION) {
    throw new Error("Unsupported vault index version");
  }
  return index;
}

export function migrateAppManifest(manifest: AppManifestV1): AppManifestV1 {
  if (manifest.vaultFormatVersion !== VAULT_FORMAT_VERSION) {
    throw new Error("Unsupported app manifest version");
  }
  return manifest;
}
