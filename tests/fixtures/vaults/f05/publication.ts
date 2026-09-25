import { sha256Chunks } from "../../../../src/crypto/hash.js";
import { referenceFromLocal } from "../../../../src/sync/protocol/references.js";
import { encodeBase64Url } from "../../../../src/domain/model/bytes.js";
import { createVaultCrypto } from "../../../../src/crypto/vault-port.js";
import { encryptEnvelope } from "../../../../src/crypto/envelope.js";
import type { SecretKeyHandle } from "../../../../src/crypto/keys.js";
import { asDomainId } from "../../../../src/domain/model/ids.js";
import { encodeCanonicalChunks } from "../../../../src/persistence/codecs/canonical-cbor.js";
import { encodeCheckpointBody, encodeCheckpointManifest, type CheckpointManifestV1 } from "../../../../src/import/staging/roots.js";
import { DEFAULT_APP_THEME } from "../../../../src/import/staging/theme.js";
import type { PublicationInputV1, PublicationPortsV1 } from "../../../../src/sync/protocol/publication.js";
import { crypto, entropy, id, manifest, sealed } from "./helpers.js";

/** Deterministic entropy/nonces are confined to this test fixture. */
export async function publicationFixture() {
  const random = entropy();
  const vaultCrypto = createVaultCrypto(random);
  const secrets = await vaultCrypto.create("F05 fixture passphrase", id(3));
  const appId = asDomainId("app", id(2));
  const checkpoint: Omit<CheckpointManifestV1, "semanticSha256"> = {
    manifestVersion: 1, appId, schemaRevision: 1n, frontier: [],
    appState: { appId, displayName: "PRIVATE-F05-SENTINEL", createdAtMs: 1000, lastOpenedAtMs: null,
      schemaRevision: 1n, locality: "present", durableHomeId: null, lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 0, theme: DEFAULT_APP_THEME, stateRevision: 1n },
    tables: [], enumOptions: [], sheetSnapshots: [], recordPages: [],
  };
  const payload = encodeCheckpointManifest({ ...checkpoint, semanticSha256: await crypto.sha256(encodeCheckpointBody(checkpoint)) });
  const object = await sealed("app.checkpoint", "app.checkpoint-manifest", payload);
  const reference = await referenceFromLocal({ local: { storageId: encodeBase64Url(object.frame.storageId), semanticSha256: await crypto.sha256(payload) },
    bytes: object.bytes, scope: "app.checkpoint", payloadKind: "app.checkpoint-manifest", key: object.key, crypto });
  const { generation: _generation, previousManifestSha256: _previous, semanticSha256: _semantic, totalPaddedBytes: _total, ...graphManifest } = manifest();
  void _generation; void _previous; void _semantic; void _total;
  const { key: vaultKey, ...bootstrap } = secrets;
  const input: PublicationInputV1 = { base: { kind: "create", secrets: bootstrap }, vaultId: id(3), homeId: id(8),
    vaultKey, appKey: object.key, committedAtMs: 1000n,
    app: { displayName: "PRIVATE-F05-SENTINEL", appSchemaRevision: 1n, recordCount: 0n },
    graph: { signal: new AbortController().signal, manifest: { ...graphManifest, checkpoint: reference },
      objects: [{ reference, payloadKind: "app.checkpoint-manifest", children: [] }],
      readObject: (storageId) => {
        if (encodeBase64Url(storageId) !== encodeBase64Url(reference.storageId)) throw new Error("missing fixture object");
        return Promise.resolve(object.bytes.slice());
      },
      authoredAppId: appId,
      canonicalAuthoredState: (signal) => encodeCanonicalChunks(new Map([["appId", appId], ["checkpointBody", encodeCheckpointBody(checkpoint)]]), signal),
      checkpointChains: [], deviceChains: [] } };
  const ports: PublicationPortsV1 = { hashChunks: sha256Chunks, crypto: { ...crypto,
    seal: (request) => encryptEnvelope({ ...request, key: request.key as SecretKeyHandle, nonce: random.randomBytes(24) }) },
    entropy: random, vaultCrypto };
  return { input, ports, object };
}
