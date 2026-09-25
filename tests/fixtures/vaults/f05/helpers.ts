import type { EntropyPort } from "../../../../src/application/ports/entropy.js";
import type { EnvelopeCryptoPort } from "../../../../src/application/ports/envelope-crypto.js";
import { encryptEnvelope, decryptEnvelope } from "../../../../src/crypto/envelope.js";
import { createSecretKey, destroySecretKey, type SecretKeyHandle } from "../../../../src/crypto/keys.js";
import { sha256 } from "../../../../src/crypto/hash.js";
import { asStorageId16 } from "../../../../src/domain/model/bytes.js";
import { serializeEnvelopeTransport } from "../../../../src/persistence/codecs/envelope-frame.js";
import type { AppManifestV1, VaultHeaderV1, VaultIndexV1 } from "../../../../src/migrations/006_vault_format_v1.js";
import type { EnvelopeReferenceV1, EnvelopeScopeV1, EnvelopePayloadKindV1 } from "../../../../src/migrations/003_envelope_format_v1.js";

export const id = (n: number): Uint8Array => new Uint8Array(16).fill(n);
export const hash = (n: number): Uint8Array => new Uint8Array(32).fill(n);
export const entropy = (): EntropyPort => {
  let state = 0x51f05;
  return { randomBytes: (length) => Uint8Array.from({ length }, () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return state & 255;
  }) };
};
export const crypto: EnvelopeCryptoPort = {
  seal: (request) => encryptEnvelope({ ...request, key: request.key as SecretKeyHandle }),
  open: (frame, scope, key, kind) => decryptEnvelope(frame, scope, key as SecretKeyHandle, kind),
  importKey: (bytes) => createSecretKey(bytes, "envelope"),
  destroyKey: (key) => destroySecretKey(key as SecretKeyHandle), sha256,
};
export const wrapped = { wrapId: id(1), nonce: new Uint8Array(24), ciphertext: new Uint8Array(48) };
export function ref(scope: EnvelopeScopeV1 = "app.checkpoint", n = 1, revision = 1n): EnvelopeReferenceV1 {
  return { storageId: id(n), scope, logicalRevision: revision, envelopeFormatVersion: 1,
    codecVersion: 1, cipherSuiteVersion: 1, paddedBytes: 4096, ciphertextSha256: hash(n) };
}
export function manifest(): AppManifestV1 {
  return { vaultFormatVersion: 1, appId: id(2), generation: 1n, previousManifestSha256: null, checkpoint: ref(),
    eventSegments: [], baselinePages: [], conflictPages: [], auditPages: [], sourceManifests: [], snapshotManifests: [],
    retainedRoots: [], confirmedFrontier: [], semanticSha256: hash(2), totalPaddedBytes: 4096n };
}
export function index(): VaultIndexV1 {
  return { vaultFormatVersion: 1, vaultId: id(3), generation: 1n, previousIndexSha256: null,
    recoveryCodeForReview: "encrypted recovery fixture", apps: [], deletionMarkers: [], deviceReceipts: [],
    retainedGenerationRoots: [], createdAtMs: 10n, committedAtMs: 10n };
}
export function header(): VaultHeaderV1 {
  return { magic: "SHEAF-VAULT", vaultFormatVersion: 1, minimumReaderVersion: 1, codecVersion: 1,
    envelopeFormatVersion: 1, cipherSuiteVersion: 1, paddingProfileVersion: 1, vaultId: id(3),
    passphraseKdf: { algorithm: "argon2id", algorithmVersion: 0x13, salt: id(1), memoryKiB: 65536, iterations: 3, lanes: 1, outputBytes: 32, context: "sheaf/vault/passphrase/v1" },
    recoveryKdf: { algorithm: "hkdf-sha-256", salt: id(2), outputBytes: 32, context: "sheaf/vault/recovery/v1" },
    passphraseWrappedVaultKey: wrapped, recoveryWrappedVaultKey: wrapped, generation: 1n,
    currentIndex: ref("vault.index", 3), previousHeadSha256: null };
}
export async function sealed(scope: EnvelopeScopeV1 = "app.checkpoint", kind: EnvelopePayloadKindV1 = "app.checkpoint-manifest",
  payload: Uint8Array = new Uint8Array([1, 2, 3]), n = 4, logicalRevision = 7n) {
  const key = createSecretKey(hash(5), "envelope");
  const frame = await encryptEnvelope({ scope, payloadKind: kind, storageId: asStorageId16(id(n)), logicalRevision,
    payload, compression: "none", key, nonce: new Uint8Array(24).fill(n) });
  return { key, frame, bytes: serializeEnvelopeTransport(frame), reference: { ...ref(scope, n, logicalRevision),
    paddedBytes: frame.paddedBytes, ciphertextSha256: await sha256(frame.ciphertext) } };
}
