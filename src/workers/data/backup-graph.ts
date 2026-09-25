import type { BackupAppGraphV1, BackupGraphObjectV1, DeviceChainEvidenceV1 } from "../../application/ports/backup.js";
import type { EnvelopeKeyRefV1 } from "../../application/ports/envelope-crypto.js";
import type { ProjectionAuthoredStatePort } from "../../application/ports/projection.js";
import { asDomainId, encodeDomainId, compareDomainIds } from "../../domain/model/ids.js";
import { constantTimeEquals, decodeStorageId16, encodeBase64Url } from "../../domain/model/bytes.js";
import { IntegrityError } from "../../domain/model/errors.js";
import { sha256, sha256Chunks } from "../../crypto/hash.js";
import { decodeAppHead, encodeAppHeadBody, decodeCheckpointManifest, decodeRecordPage, decodeBaselinePage,
  checkpointSemanticBody, type StorageRefV1, type PageRefV1 } from "../../import/staging/roots.js";
import { decodeSourceManifest } from "../../import/snapshots/source-chunks.js";
import { decodeSnapshotManifest } from "../../import/snapshots/delimited-snapshot.js";
import { decodeSheetSnapshotManifest } from "../../import/snapshots/sheet-snapshot.js";
import type { EnvelopeScopeV1, EnvelopePayloadKindV1 } from "../../migrations/003_envelope_format_v1.js";
import type { EventCommitV1 } from "../../migrations/004_event_format_v1.js";
import { CanonicalArray, decodeCanonical, encodeCanonical, type CanonicalStreamValue, type CborValue } from "../../persistence/codecs/canonical-cbor.js";
import { decodeEventSegment, compareCommits } from "../../persistence/codecs/event-commit.js";
import { serializeEnvelopeTransport } from "../../persistence/codecs/envelope-frame.js";
import { authoredState, openProjection, hydrateApp, applyEvents, disposeProjection } from "../../persistence/projection/index.js";
import { referenceFromLocal, authenticateReference } from "../../sync/protocol/references.js";
import { verifyBackupFrontier } from "../../sync/protocol/frontier.js";
import { engineAdapter, tableContexts, toProjectionCheckpoint, toProjectionRecord, toProjectionCommit } from "./app-session.js";
import type { AppStoragePortsV1, LoadedAppV1 } from "./event-store.js";
import type { AppManifestV1 } from "../../migrations/006_vault_format_v1.js";
import { vaultValue } from "../../persistence/codecs/vault.js";
import type { BackupPinV1 } from "./home-state.js";

interface LocalObject {
  readonly local: StorageRefV1;
  readonly scope: EnvelopeScopeV1;
  readonly kind: EnvelopePayloadKindV1;
  readonly page?: PageRefV1;
  readonly byteLength?: number;
}
const ROOT_KINDS = {
  eventSegments: ["app.events", "app.event-segment"], baselinePages: ["app.baselines", "app.baseline-page"],
  conflictPages: ["app.conflicts", "app.conflict-page"], auditPages: ["app.audit", "app.audit-page"],
  sourceManifests: ["app.source-manifest", "app.source-manifest"], snapshotManifests: ["app.snapshot-manifest", "app.snapshot-manifest"],
} as const;

/** One immutable pin, never the mutable catalog's current head or projection. */
export async function exportBackupGraph(ports: { readonly crypto: AppStoragePortsV1["crypto"]; readonly store: Pick<AppStoragePortsV1["store"], "getEnvelope"> }, appKey: EnvelopeKeyRefV1,
  pin: Pick<BackupPinV1, "appId" | "headStorageId">, signal: AbortSignal): Promise<BackupAppGraphV1> {
  const readBytes = async (storageId: Uint8Array, readSignal: AbortSignal) => {
    signal.throwIfAborted();
    readSignal.throwIfAborted();
    const frame = await ports.store.getEnvelope(decodeStorageId16(encodeBase64Url(storageId)));
    signal.throwIfAborted();
    readSignal.throwIfAborted();
    if (frame === undefined) throw new IntegrityError("missing pinned graph object");
    return serializeEnvelopeTransport(frame);
  };
  signal.throwIfAborted();
  const headFrame = await ports.store.getEnvelope(decodeStorageId16(pin.headStorageId));
  if (headFrame === undefined) throw new IntegrityError("missing pinned app head");
  const headPayload = (await ports.crypto.open(headFrame, "app.head", appKey, "app.head")).payload;
  const head = decodeAppHead(headPayload);
  if (encodeDomainId(head.appId) !== pin.appId || !constantTimeEquals(await sha256(encodeAppHeadBody(head)), head.semanticSha256)) {
    throw new IntegrityError("pinned head identity or digest mismatch");
  }
  const headLocal: LocalObject = { local: { storageId: pin.headStorageId, semanticSha256: await sha256(headPayload) }, scope: "app.head", kind: "app.head" };
  const descriptors = new Map<string, BackupGraphObjectV1>();
  const pending: LocalObject[] = [headLocal];
  const expectations = new Map<string, LocalObject>();
  const edges = new Map<string, string[]>();
  const byteHashes = new Map<string, Uint8Array>();
  let baselineCount = 0;
  const enqueue = (object: LocalObject) => {
    const previous = expectations.get(object.local.storageId);
    if (previous !== undefined) {
      if (previous.scope !== object.scope || previous.kind !== object.kind ||
          !constantTimeEquals(previous.local.semanticSha256, object.local.semanticSha256)) throw new IntegrityError("graph scope/kind or digest substitution");
    } else { expectations.set(object.local.storageId, object); pending.push(object); }
  };
  expectations.set(pin.headStorageId, headLocal);
  for (let next = 0; next < pending.length; next++) {
    signal.throwIfAborted();
    const object = pending[next]!;
    const bytes = await readBytes(decodeStorageId16(object.local.storageId), signal);
    const reference = await referenceFromLocal({ ...object, bytes, payloadKind: object.kind, key: appKey, crypto: ports.crypto });
    const payload = await authenticateReference(bytes, reference, object.kind, appKey, ports.crypto);
    byteHashes.set(object.local.storageId, await sha256(bytes));
    if (object.byteLength !== undefined && payload.length !== object.byteLength) throw new IntegrityError("chunk length mismatch");
    const children: LocalObject[] = [];
    if (object.kind === "app.head") {
      const current = decodeAppHead(payload);
      if (!constantTimeEquals(current.appId, head.appId)) throw new IntegrityError("head belongs to another app");
      if (current.conflictPages.length !== 0 || current.auditPages.length !== 0) {
        throw new IntegrityError("graph requires an unavailable conflict/audit payload reader");
      }
      children.push({ local: current.checkpoint, scope: "app.checkpoint", kind: "app.checkpoint-manifest" });
      for (const name of Object.keys(ROOT_KINDS) as (keyof typeof ROOT_KINDS)[]) {
        const [scope, kind] = ROOT_KINDS[name];
        children.push(...current[name].map((local) => ({ local, scope, kind })));
      }
      // No writer before compaction emits these unscoped roots. Never guess
      // AAD for a nonempty legacy list; its owning format reader must supply it.
      if (current.retainedRoots.length !== 0) throw new IntegrityError("retained roots require authenticated scope metadata");
    } else if (object.kind === "app.checkpoint-manifest") {
      const checkpoint = decodeCheckpointManifest(payload);
      if (!constantTimeEquals(checkpoint.appId, head.appId) ||
          !constantTimeEquals(await sha256(checkpointSemanticBody(payload)), checkpoint.semanticSha256)) throw new IntegrityError("checkpoint identity or digest mismatch");
      children.push(...checkpoint.recordPages.map((local) => ({ local, scope: "app.records" as const, kind: "app.record-page" as const, page: local, byteLength: local.decodedByteLength })));
      for (const sheet of checkpoint.sheetSnapshots) {
        if (!head.snapshotManifests.some((ref) => ref.storageId === sheet.snapshotManifestStorageId)) throw new IntegrityError("missing sheet snapshot root");
      }
    } else if (object.kind === "app.record-page") {
      const records = decodeRecordPage(payload).records;
      const page = object.page!;
      if (records.length !== page.decodedCount) throw new IntegrityError("record page count mismatch");
      const keys = records.map((record) => {
        const key = new Uint8Array(32); key.set(record.tableId); key.set(record.recordId, 16); return key;
      });
      const sameKey = (actual: Uint8Array | undefined, expected: Uint8Array | null) =>
        actual === undefined ? expected === null : expected !== null && constantTimeEquals(actual, expected);
      if (!sameKey(keys[0], page.firstKey) || !sameKey(keys.at(-1), page.lastKey) ||
          keys.some((key, i) => i > 0 && compareDomainIds(keys[i - 1]!, key) >= 0)) throw new IntegrityError("record page range mismatch");
    } else if (object.kind === "app.baseline-page") {
      baselineCount += decodeBaselinePage(payload).entries.length;
    } else if (object.kind === "app.source-manifest" || object.kind === "app.snapshot-manifest") {
      const source = object.kind === "app.source-manifest";
      const decoded = source ? decodeSourceManifest(payload) :
        (decodeCanonical(payload) as ReadonlyMap<string, CborValue>).get("manifestVersion") === 2n ?
          decodeSheetSnapshotManifest(payload) : decodeSnapshotManifest(payload);
      if ("chunkedSha256" in decoded &&
          (decoded.byteLength !== decoded.chunks.reduce((total, chunk) => total + chunk.decodedByteLength, 0) ||
          !constantTimeEquals(await sha256Chunks(decoded.chunks.map((chunk) => chunk.sha256), signal), decoded.chunkedSha256))) {
        throw new IntegrityError("source manifest length or ordered digest mismatch");
      }
      const kind: "app.source-chunk" | "app.snapshot-chunk" = source ? "app.source-chunk" : "app.snapshot-chunk";
      children.push(...decoded.chunks.map((chunk) => ({ local: { storageId: chunk.storageId, semanticSha256: chunk.sha256 },
        scope: kind, kind, byteLength: chunk.decodedByteLength })));
    } else if (object.kind === "app.conflict-page" || object.kind === "app.audit-page") {
      throw new IntegrityError("graph requires an unavailable conflict/audit payload reader");
    }
    for (const child of children) enqueue(child);
    edges.set(object.local.storageId, children.map((child) => child.local.storageId));
    descriptors.set(object.local.storageId, { reference, payloadKind: object.kind, children: [] });
  }
  for (const [id, object] of descriptors) {
    descriptors.set(id, { ...object, children: edges.get(id)!.map((child) => descriptors.get(child)!.reference) });
  }
  const readObject = async (id: Uint8Array, readSignal: AbortSignal) => {
    const digest = byteHashes.get(encodeBase64Url(id));
    if (digest === undefined) throw new IntegrityError("object is outside pinned graph");
    const bytes = await readBytes(id, readSignal);
    if (!constantTimeEquals(await sha256(bytes), digest)) throw new IntegrityError("pinned graph bytes changed");
    signal.throwIfAborted();
    readSignal.throwIfAborted();
    return bytes;
  };
  const payload = async (id: string, readSignal: AbortSignal) => {
    const object = descriptors.get(id);
    if (object === undefined) throw new IntegrityError("missing graph descriptor");
    return authenticateReference(await readObject(object.reference.storageId, readSignal), object.reference, object.payloadKind, appKey, ports.crypto);
  };
  const checkpoint = decodeCheckpointManifest(await payload(head.checkpoint.storageId, signal));
  const covered = new Map(checkpoint.frontier.map((entry) => [encodeBase64Url(entry.deviceId), entry.commitSequence]));
  const checkpointChains: DeviceChainEvidenceV1[] = [];
  const tail: string[] = [];
  let genesis: EventCommitV1 | undefined;
  async function* segments(readSignal: AbortSignal) {
    for (const ref of head.eventSegments) yield decodeEventSegment(await payload(ref.storageId, readSignal));
  }
  const deviceChains = await verifyBackupFrontier(head.appId, [], segments(signal), head.frontier, sha256, signal);
  for (const ref of head.eventSegments) {
    const segment = decodeEventSegment(await payload(ref.storageId, signal));
    let after = 0;
    for (const commit of segment.commits) {
      const limit = covered.get(encodeBase64Url(commit.deviceId)) ?? 0n;
      if (commit.deviceCommitSequence === limit) checkpointChains.push({ deviceId: commit.deviceId, commitSequence: limit, commitSha256: commit.commitSha256 });
      if (commit.deviceCommitSequence <= limit) {
        if (genesis === undefined || compareCommits(genesis, commit) < 0) genesis = commit;
      } else { after++; }
    }
    if (after !== 0 && after !== segment.commits.length) throw new IntegrityError("event segment straddles checkpoint frontier");
    if (after !== 0) tail.push(ref.storageId);
  }
  checkpointChains.sort((a, b) => compareDomainIds(a.deviceId, b.deviceId));
  if (genesis === undefined || checkpointChains.length !== covered.size) throw new IntegrityError("checkpoint chain evidence is incomplete");
  const initial: LoadedAppV1 = { appId: head.appId, head, headStorageId: pin.headStorageId, checkpoint, recordPages: [], commits: [genesis] };
  const live = new Set<string>();
  for (const ref of checkpoint.recordPages) {
    for (const record of decodeRecordPage(await payload(ref.storageId, signal)).records) live.add(`${encodeDomainId(record.tableId)}:${encodeDomainId(record.recordId)}`);
  }
  const contexts = tableContexts(checkpoint, (table, record) => live.has(`${encodeDomainId(table)}:${encodeDomainId(record)}`));
  const refs = (values: readonly StorageRefV1[]) => values.map((ref) => descriptors.get(ref.storageId)!.reference).sort((a, b) => a.logicalRevision < b.logicalRevision ? -1 : a.logicalRevision > b.logicalRevision ? 1 : compareDomainIds(a.storageId, b.storageId));
  const cursor: ProjectionAuthoredStatePort = {
    async *authoredState(requestSignal) {
      const readSignal = AbortSignal.any([signal, requestSignal]);
      readSignal.throwIfAborted();
      const handle = await openProjection({ sha256, clock: () => ({ epochMs: 0, epochDay: 0 }) });
      const close = () => { disposeProjection(handle); };
      readSignal.addEventListener("abort", close, { once: true });
      try {
        readSignal.throwIfAborted();
        async function* pages() {
          for (const ref of checkpoint.recordPages) {
            readSignal.throwIfAborted();
            yield { records: decodeRecordPage(await payload(ref.storageId, readSignal)).records.map((record) =>
              toProjectionRecord(record, contexts, asDomainId("commit", genesis!.commitId))) };
          }
        }
        await hydrateApp(handle, toProjectionCheckpoint(initial, checkpoint, contexts, 0), [], pages());
        for (const chain of checkpointChains) handle.appliedChains.set(encodeBase64Url(chain.deviceId), { sequence: chain.commitSequence, hash: chain.commitSha256 });
        const projection = engineAdapter(handle);
        for (const id of tail) {
          for (const commit of decodeEventSegment(await payload(id, readSignal)).commits) {
            readSignal.throwIfAborted();
            await applyEvents(handle, [toProjectionCommit(projection, commit)]);
          }
        }
        const extras = new Map<string, CanonicalStreamValue>([["baselines", new CanonicalArray(baselineCount, async function* () {
          for (const ref of head.baselinePages) {
            const page = decodeCanonical(await payload(ref.storageId, readSignal)) as ReadonlyMap<string, CborValue>;
            for (const entry of page.get("entries") as readonly CborValue[]) yield [page.get("scopeId")!, entry];
          }
        })]]);
        yield* authoredState(handle, readSignal, extras);
      } finally { readSignal.removeEventListener("abort", close); close(); }
    },
  };
  return {
    signal,
    manifest: { vaultFormatVersion: 1, appId: head.appId, checkpoint: descriptors.get(head.checkpoint.storageId)!.reference,
      eventSegments: tail.map((id) => descriptors.get(id)!.reference), baselinePages: refs(head.baselinePages),
      conflictPages: refs(head.conflictPages), auditPages: refs(head.auditPages), sourceManifests: refs(head.sourceManifests),
      snapshotManifests: refs(head.snapshotManifests), retainedRoots: [descriptors.get(pin.headStorageId)!.reference], confirmedFrontier: head.frontier },
    objects: [...descriptors.values()], readObject, authoredAppId: head.appId,
    canonicalAuthoredState: (readSignal) => cursor.authoredState(readSignal), checkpointChains, deviceChains,
  };
}

/** Rebuilds the current-format artifact graph without a local root or database. */
export async function recoverBackupGraph(crypto: AppStoragePortsV1["crypto"], app: {
  readonly manifest: AppManifestV1;
  readonly appKey: EnvelopeKeyRefV1;
  readonly readFrame: AppStoragePortsV1["store"]["getEnvelope"];
}, signal: AbortSignal): Promise<BackupAppGraphV1> {
  const { manifest } = app;
  if (manifest.retainedRoots.length !== 1 || manifest.retainedRoots[0]!.scope !== "app.head") {
    throw new IntegrityError("bundle requires a supported pinned app head");
  }
  const graph = await exportBackupGraph({ crypto, store: { getEnvelope: app.readFrame } }, app.appKey,
    { appId: encodeDomainId(asDomainId("app", manifest.appId)), headStorageId: encodeBase64Url(manifest.retainedRoots[0]!.storageId) }, signal);
  const { generation, previousManifestSha256, semanticSha256, totalPaddedBytes, ...roots } = manifest;
  void generation; void previousManifestSha256;
  if (!constantTimeEquals(encodeCanonical(vaultValue(graph.manifest)), encodeCanonical(vaultValue(roots))) ||
      graph.objects.reduce((total, object) => total + BigInt(object.reference.paddedBytes), 0n) !== totalPaddedBytes ||
      !constantTimeEquals(await sha256Chunks(graph.canonicalAuthoredState(signal), signal), semanticSha256)) {
    throw new IntegrityError("recovered bundle graph or authored state mismatch");
  }
  signal.throwIfAborted();
  return graph;
}
