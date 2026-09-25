import type { BackupAppGraphV1, BackupSnapshotIdentityV1, BackupGraphObjectV1 } from "../../application/ports/backup.js";
import type { DurableHomePort, HeadObjectV1, HeadReceiptV1 } from "../../application/ports/durable-home.js";
import type { EntropyPort } from "../../application/ports/entropy.js";
import type { EnvelopeCryptoPort, EnvelopeKeyRefV1 } from "../../application/ports/envelope-crypto.js";
import type { VaultCryptoPort, VaultKeyRefV1, VaultSecretsV1 } from "../../application/ports/vault-crypto.js";
import { asStorageId16, constantTimeEquals, encodeBase64Url } from "../../domain/model/bytes.js";
import { IntegrityError } from "../../domain/model/errors.js";
import { CURRENT_FORMAT_VERSIONS as versions } from "../../migrations/index.js";
import type { AppManifestV1, VaultAppEntryV1, VaultHeaderV1, VaultIndexV1 } from "../../migrations/006_vault_format_v1.js";
import type { EnvelopeReferenceV1, EnvelopeScopeV1, EnvelopePayloadKindV1 } from "../../migrations/003_envelope_format_v1.js";
import { decodeCanonical, encodeCanonical } from "../../persistence/codecs/canonical-cbor.js";
import { decodeEventSegment } from "../../persistence/codecs/event-commit.js";
import { serializeEnvelopeTransport } from "../../persistence/codecs/envelope-frame.js";
import { assertIndexMatchesHeader, compareBytes, decodeVaultHeader, decodeVaultIndex, encodeAppManifest, encodeVaultHeader, encodeVaultIndex, readFrontier, vaultValue } from "../../persistence/codecs/vault.js";
import { authenticateReference } from "./references.js";
import { verifyBackupFrontier } from "./frontier.js";

export type PublicationBaseV1 =
  | { readonly kind: "create"; readonly secrets: Omit<VaultSecretsV1, "key"> }
  | { readonly kind: "replace"; readonly head: HeadObjectV1; readonly indexBytes: Uint8Array };
export interface PublicationInputV1 {
  readonly base: PublicationBaseV1;
  readonly vaultId: Uint8Array;
  readonly homeId: Uint8Array;
  readonly vaultKey: VaultKeyRefV1;
  readonly appKey: EnvelopeKeyRefV1;
  readonly graph: BackupAppGraphV1;
  readonly app: Pick<VaultAppEntryV1, "displayName" | "appSchemaRevision" | "recordCount" | "lastOpenedAtMs">;
  readonly committedAtMs: bigint;
}
export interface PublicationPortsV1 {
  readonly crypto: EnvelopeCryptoPort;
  readonly vaultCrypto: VaultCryptoPort;
  readonly entropy: EntropyPort;
  readonly hashChunks: (chunks: AsyncIterable<Uint8Array>, signal: AbortSignal) => Promise<Uint8Array>;
}
export interface PublicationCandidateV1 { readonly kind: "vault-publication" }
export interface PublicationContentsV1 {
  readonly headBytes: Uint8Array;
  readonly header: VaultHeaderV1;
  readonly index: VaultIndexV1;
  readonly manifest: AppManifestV1;
  readonly objects: readonly { readonly id: string }[];
  readonly snapshot: BackupSnapshotIdentityV1;
  readonly expectedRevision: string | null;
  readonly expectedHeadSha256: Uint8Array | null;
}
interface StoredCandidateV1 {
  readonly signal: AbortSignal;
  readonly metadata: PublicationContentsV1;
  readonly read: (id: string, signal: AbortSignal) => Promise<Uint8Array>;
}
const candidates = new WeakMap<PublicationCandidateV1, StoredCandidateV1>();
function contents(candidate: PublicationCandidateV1): PublicationContentsV1 {
  const value = candidates.get(candidate);
  if (value === undefined) throw new IntegrityError("unknown publication candidate");
  value.signal.throwIfAborted();
  return value.metadata;
}
/** Copies only: callers cannot mutate the exact bytes held for publication. */
export function readPublicationCandidate(candidate: PublicationCandidateV1): PublicationContentsV1 {
  return structuredClone(contents(candidate));
}
export async function readPublicationObject(candidate: PublicationCandidateV1, id: string, signal: AbortSignal): Promise<Uint8Array> {
  contents(candidate);
  signal = AbortSignal.any([signal, candidates.get(candidate)!.signal]);
  signal.throwIfAborted();
  const bytes = await candidates.get(candidate)!.read(id, signal);
  signal.throwIfAborted();
  return bytes;
}
function same(left: unknown, right: unknown): boolean {
  return constantTimeEquals(encodeCanonical(vaultValue(left)), encodeCanonical(vaultValue(right)));
}
function roots(manifest: BackupAppGraphV1["manifest"]): readonly EnvelopeReferenceV1[] {
  return [manifest.checkpoint, ...manifest.eventSegments, ...manifest.baselinePages, ...manifest.conflictPages,
    ...manifest.auditPages, ...manifest.sourceManifests, ...manifest.snapshotManifests, ...manifest.retainedRoots];
}

async function verifyGraph(graph: BackupAppGraphV1, key: EnvelopeKeyRefV1, crypto: EnvelopeCryptoPort, signal: AbortSignal, hashes: Map<string, Uint8Array>): Promise<bigint> {
  // Exporter owns payload-specific descendant and authored-state reconstruction.
  // This layer authenticates every supplied edge/object and verifies chain closure.
  const objects = new Map<string, BackupGraphObjectV1>();
  for (const object of graph.objects) {
    const id = encodeBase64Url(object.reference.storageId);
    if (objects.has(id)) throw new IntegrityError("duplicate graph object");
    objects.set(id, object);
  }
  const seen = new Set<string>();
  const active = new Set<string>();
  let total = 0n;
  async function visit(reference: EnvelopeReferenceV1): Promise<void> {
    const id = encodeBase64Url(reference.storageId);
    const object = objects.get(id);
    if (object === undefined) throw new IntegrityError("missing graph object");
    if (!same(reference, object.reference)) throw new IntegrityError("graph reference substitution");
    if (active.has(id)) throw new IntegrityError("cyclic graph");
    if (seen.has(id)) return;
    hashes.set(id, await verifyObject(object));
    total += BigInt(reference.paddedBytes);
    active.add(id);
    for (const child of object.children) await visit(child);
    active.delete(id);
    seen.add(id);
  }
  async function verifyObject(object: BackupGraphObjectV1): Promise<Uint8Array> {
    signal.throwIfAborted();
    const bytes = await graph.readObject(object.reference.storageId, signal);
    await authenticateReference(bytes, object.reference, object.payloadKind, key, crypto);
    signal.throwIfAborted();
    return crypto.sha256(bytes);
  }
  async function payload(reference: EnvelopeReferenceV1): Promise<Uint8Array> {
    signal.throwIfAborted();
    const bytes = await graph.readObject(reference.storageId, signal);
    if (!constantTimeEquals(await crypto.sha256(bytes), hashes.get(encodeBase64Url(reference.storageId))!)) throw new IntegrityError("pinned graph bytes changed");
    return authenticateReference(bytes, reference, objects.get(encodeBase64Url(reference.storageId))!.payloadKind, key, crypto);
  }
  for (const reference of roots(graph.manifest)) await visit(reference);
  if (seen.size !== objects.size) throw new IntegrityError("unreachable extra graph object");
  const checkpoint = decodeCanonical(await payload(graph.manifest.checkpoint));
  if (!(checkpoint instanceof Map) || !same(checkpoint.get("appId"), graph.manifest.appId)) throw new IntegrityError("checkpoint belongs to another app");
  const frontier = readFrontier(checkpoint.get("frontier"));
  if (!same(frontier, graph.checkpointChains.map(({ deviceId, commitSequence }) => ({ deviceId, commitSequence })))) throw new IntegrityError("checkpoint chain frontier mismatch");
  async function* segments() {
    for (const reference of graph.manifest.eventSegments) yield decodeEventSegment(await payload(reference));
  }
  const chains = await verifyBackupFrontier(graph.manifest.appId, graph.checkpointChains,
    segments(), graph.manifest.confirmedFrontier, (bytes) => crypto.sha256(bytes), signal);
  if (!same(chains, graph.deviceChains)) throw new IntegrityError("final device chain evidence mismatch");
  if (!constantTimeEquals(graph.authoredAppId, graph.manifest.appId)) throw new IntegrityError("authored state belongs to another app");
  return total;
}

export async function buildPublicationCandidate(input: PublicationInputV1, ports: PublicationPortsV1, signal: AbortSignal = new AbortController().signal): Promise<PublicationCandidateV1> {
  // Snapshot caller buffers before awaiting any crypto or provider work.
  signal = AbortSignal.any([signal, input.graph.signal]);
  signal.throwIfAborted();
  const { readObject, canonicalAuthoredState, signal: lifetime, ...metadata } = input.graph;
  const graph: BackupAppGraphV1 = { ...structuredClone(metadata), signal: lifetime, readObject, canonicalAuthoredState };
  const base = structuredClone(input.base);
  const vaultId = input.vaultId.slice();
  const homeId = input.homeId.slice();
  const app = structuredClone(input.app);
  const committedAtMs = input.committedAtMs;
  if (vaultId.length !== 16 || homeId.length !== 16) throw new IntegrityError("invalid home/vault identity");
  let previousHeader: VaultHeaderV1 | undefined;
  let previousIndex: VaultIndexV1 | undefined;
  let expectedRevision: string | null = null;
  let expectedHeadSha256: Uint8Array | null = null;
  if (base.kind === "replace") {
    if (base.head.revision.length === 0) throw new IntegrityError("empty provider revision");
    previousHeader = decodeVaultHeader(base.head.bytes);
    if (!constantTimeEquals(previousHeader.vaultId, vaultId)) throw new IntegrityError("predecessor belongs to another vault");
    previousIndex = decodeVaultIndex(await authenticateReference(base.indexBytes, previousHeader.currentIndex, "vault.index", input.vaultKey, ports.crypto));
    assertIndexMatchesHeader(previousHeader, previousIndex);
    expectedRevision = base.head.revision;
    expectedHeadSha256 = await ports.crypto.sha256(base.head.bytes);
  }
  const generation = (previousHeader?.generation ?? 0n) + 1n;
  if (generation > 0xffff_ffff_ffff_ffffn) throw new IntegrityError("vault generation exhausted");
  if (previousIndex?.deletionMarkers.some((marker) => constantTimeEquals(marker.appId, graph.manifest.appId))) throw new IntegrityError("permanent deletion marker forbids resurrection");
  const previousApp = previousIndex?.apps.find((entry) => constantTimeEquals(entry.appId, graph.manifest.appId));
  if (previousApp !== undefined) {
    for (const covered of previousApp.confirmedFrontier) {
      const next = graph.manifest.confirmedFrontier.find((entry) => constantTimeEquals(entry.deviceId, covered.deviceId));
      if (next === undefined || next.commitSequence < covered.commitSequence) throw new IntegrityError("candidate frontier regresses");
    }
  }
  const hashes = new Map<string, Uint8Array>();
  const totalPaddedBytes = await verifyGraph(graph, input.appKey, ports.crypto, signal, hashes);
  const manifest: AppManifestV1 = { ...graph.manifest, generation, previousManifestSha256: previousApp?.manifest.ciphertextSha256 ?? null,
    semanticSha256: await ports.hashChunks(graph.canonicalAuthoredState(signal), signal), totalPaddedBytes };
  const objects = graph.objects.map((object) => ({ id: encodeBase64Url(object.reference.storageId) }));
  const generated = new Map<string, Uint8Array>();
  const ids = new Set(objects.map((object) => object.id));
  async function seal(payload: Uint8Array, scope: EnvelopeScopeV1, payloadKind: EnvelopePayloadKindV1, key: EnvelopeKeyRefV1): Promise<EnvelopeReferenceV1> {
    const storageId = asStorageId16(ports.entropy.randomBytes(16));
    const id = encodeBase64Url(storageId);
    if (ids.has(id)) throw new IntegrityError("new object ID collision");
    ids.add(id);
    const frame = await ports.crypto.seal({ scope, payloadKind, storageId, logicalRevision: generation, payload, compression: "none", key });
    generated.set(id, serializeEnvelopeTransport(frame));
    objects.push({ id });
    return { storageId, scope, logicalRevision: frame.logicalRevision, envelopeFormatVersion: frame.envelopeFormatVersion,
      codecVersion: frame.codecVersion, cipherSuiteVersion: frame.cipherSuiteVersion, paddedBytes: frame.paddedBytes,
      ciphertextSha256: await ports.crypto.sha256(frame.ciphertext) };
  }
  const manifestRef = await seal(encodeAppManifest(manifest), "vault.app-manifest", "vault.app-manifest", input.appKey);
  const entry: VaultAppEntryV1 = { ...app, appId: graph.manifest.appId,
    wrappedAppKey: await ports.vaultCrypto.wrapApp(input.appKey, input.vaultKey, vaultId, graph.manifest.appId),
    manifest: manifestRef, lastSuccessfulBackupMs: committedAtMs, totalPaddedBytes, confirmedFrontier: graph.manifest.confirmedFrontier };
  const apps = [...(previousIndex?.apps.filter((entry) => !constantTimeEquals(entry.appId, graph.manifest.appId)) ?? []), entry]
    .sort((a, b) => compareBytes(a.appId, b.appId));
  const index: VaultIndexV1 = { vaultFormatVersion: versions.vault, vaultId, generation,
    previousIndexSha256: previousHeader?.currentIndex.ciphertextSha256 ?? null,
    recoveryCodeForReview: previousIndex?.recoveryCodeForReview ?? (base.kind === "create" ? base.secrets.recoveryCode : ""),
    apps, deletionMarkers: previousIndex?.deletionMarkers ?? [], deviceReceipts: previousIndex?.deviceReceipts ?? [],
    retainedGenerationRoots: previousIndex?.retainedGenerationRoots ?? [],
    createdAtMs: previousIndex?.createdAtMs ?? committedAtMs, committedAtMs };
  const indexRef = await seal(encodeVaultIndex(index), "vault.index", "vault.index", input.vaultKey);
  const bootstrap = previousHeader ?? (base.kind === "create" ? base.secrets : undefined);
  if (bootstrap === undefined) throw new IntegrityError("missing vault bootstrap");
  const header: VaultHeaderV1 = { magic: "SHEAF-VAULT", vaultFormatVersion: versions.vault, minimumReaderVersion: versions.vault,
    codecVersion: versions.codec, envelopeFormatVersion: versions.envelope, cipherSuiteVersion: versions.cipherSuite,
    paddingProfileVersion: versions.paddingProfile, vaultId, passphraseKdf: bootstrap.passphraseKdf, recoveryKdf: bootstrap.recoveryKdf,
    passphraseWrappedVaultKey: bootstrap.passphraseWrappedVaultKey, recoveryWrappedVaultKey: bootstrap.recoveryWrappedVaultKey,
    generation, currentIndex: indexRef, previousHeadSha256: expectedHeadSha256 };
  const headBytes = encodeVaultHeader(header);
  const snapshot: BackupSnapshotIdentityV1 = { appId: graph.manifest.appId, vaultId, homeId, generation,
    confirmedFrontier: graph.manifest.confirmedFrontier, candidateSha256: await ports.crypto.sha256(headBytes),
    retainedGenerationRoots: index.retainedGenerationRoots, retainedRoots: graph.manifest.retainedRoots, deviceChains: graph.deviceChains };
  const candidate: PublicationCandidateV1 = Object.freeze({ kind: "vault-publication" });
  signal.throwIfAborted();
  candidates.set(candidate, {
    signal: graph.signal,
    metadata: structuredClone({ headBytes, header, index, manifest, objects, snapshot, expectedRevision, expectedHeadSha256 }),
    async read(id, readSignal) {
      readSignal.throwIfAborted();
      const sealed = generated.get(id);
      if (sealed !== undefined) return sealed.slice();
      const object = graph.objects.find((object) => encodeBase64Url(object.reference.storageId) === id);
      if (object === undefined) throw new IntegrityError("unknown publication object");
      const bytes = await graph.readObject(object.reference.storageId, readSignal);
      if (!constantTimeEquals(await ports.crypto.sha256(bytes), hashes.get(id)!)) throw new IntegrityError("pinned graph bytes changed");
      return bytes;
    },
  });
  return candidate;
}

/** Immutable objects first, exact conditional head last (architecture invariant 9). */
export async function publishCandidate(candidate: PublicationCandidateV1, home: DurableHomePort,
  signal: AbortSignal, crypto: Pick<EnvelopeCryptoPort, "sha256">): Promise<{ readonly snapshot: BackupSnapshotIdentityV1; readonly receipt: HeadReceiptV1 }> {
  const value = contents(candidate);
  signal = AbortSignal.any([signal, candidates.get(candidate)!.signal]);
  signal.throwIfAborted();
  const observed = await home.readHead(signal);
  if ((observed?.revision ?? null) !== value.expectedRevision ||
      (observed !== null && (value.expectedHeadSha256 === null || !constantTimeEquals(await crypto.sha256(observed.bytes), value.expectedHeadSha256)))) throw new IntegrityError("stale publication predecessor");
  for (const object of value.objects) {
    signal.throwIfAborted();
    await home.createObject(object.id, await readPublicationObject(candidate, object.id, signal), signal);
  }
  signal.throwIfAborted();
  const receipt = await home.compareAndSwapHead(value.expectedRevision, value.headBytes.slice(), signal);
  if (receipt.revision.length === 0 || !constantTimeEquals(receipt.candidateSha256, value.snapshot.candidateSha256)) throw new IntegrityError("receipt does not confirm exact candidate bytes");
  signal.throwIfAborted();
  const published = await home.readHead(signal);
  signal.throwIfAborted();
  if (published === null || published.revision !== receipt.revision || !constantTimeEquals(published.bytes, value.headBytes)) {
    throw new IntegrityError("receipt has no matching published head");
  }
  return structuredClone({ snapshot: value.snapshot, receipt });
}
