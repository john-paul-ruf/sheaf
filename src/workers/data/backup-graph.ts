import { checkpointMetadata } from "../../persistence/projection/checkpoint-export.js";
import type { BackupAppGraphV1, BackupGraphObjectV1, DeviceChainEvidenceV1 } from "../../application/ports/backup.js";
import type { EnvelopeKeyRefV1 } from "../../application/ports/envelope-crypto.js";
import type { ProjectionHandleV1 } from "../../persistence/projection/engine.js";
import { asDomainId, encodeDomainId, compareDomainIds } from "../../domain/model/ids.js";
import { constantTimeEquals, decodeStorageId16, encodeBase64Url } from "../../domain/model/bytes.js";
import { IntegrityError } from "../../domain/model/errors.js";
import { sha256, sha256Chunks } from "../../crypto/hash.js";
import { decodeAppHead, encodeAppHeadBody, decodeCheckpointManifest, decodeRecordPage, decodeBaselinePage,
  decodeAuditPage, decodeConflictPage, encodeCellValue, checkpointSemanticBody, type StorageRefV1, type PageRefV1, type AppHead, type CommitEvidenceRefV1 } from "../../import/staging/roots.js";
import { hydrateBaselines, type ProjectionBaselineV1 } from "../../persistence/projection/checkpoint-history.js";
import { decodeSourceManifest } from "../../import/snapshots/source-chunks.js";
import { decodeSnapshotManifest, decodeSnapshotChunk } from "../../import/snapshots/delimited-snapshot.js";
import { decodeSheetSnapshotManifest, decodeSheetSnapshotChunk } from "../../import/snapshots/sheet-snapshot.js";
import type { EnvelopeScopeV1, EnvelopePayloadKindV1 } from "../../migrations/003_envelope_format_v1.js";
import type { EventCommitV1 } from "../../migrations/004_event_format_v1.js";
import { CanonicalArray, decodeCanonical, encodeCanonical, type CanonicalStreamValue, type CborValue } from "../../persistence/codecs/canonical-cbor.js";
import { decodeEventSegment, compareCommits, encodeCommitBody } from "../../persistence/codecs/event-commit.js";
import { serializeEnvelopeTransport } from "../../persistence/codecs/envelope-frame.js";
import { authoredState, openProjection, hydrateApp, applyEvents, disposeProjection, copyCheckpointHistory } from "../../persistence/projection/index.js";
import { referenceFromLocal, authenticateReference } from "../../sync/protocol/references.js";
import { verifyBackupFrontier } from "../../sync/protocol/frontier.js";
import { engineAdapter, tableContexts, toProjectionCheckpoint, toProjectionRecord, toProjectionCommit } from "./app-session.js";
import type { AppStoragePortsV1, LoadedAppV1 } from "./event-store.js";
import type { AppManifestV1 } from "../../migrations/006_vault_format_v1.js";
import { vaultValue } from "../../persistence/codecs/vault.js";
import { decodeEvidenceEventPayload, decodeEvidenceState, isEvidenceEventKind } from "./record-event-payloads.js";
import type { BackupPinV1 } from "./home-state.js";

interface LocalObject {
  readonly local: StorageRefV1;
  readonly scope: EnvelopeScopeV1;
  readonly kind: EnvelopePayloadKindV1;
  readonly page?: PageRefV1;
  readonly byteLength?: number;
  readonly chunk?: { readonly sequence: number; readonly firstRow?: number; readonly lastRow?: number };
}
const ROOT_KINDS = {
  eventSegments: ["app.events", "app.event-segment"], baselinePages: ["app.baselines", "app.baseline-page"],
  conflictPages: ["app.conflicts", "app.conflict-page"], auditPages: ["app.audit", "app.audit-page"],
  sourceManifests: ["app.source-manifest", "app.source-manifest"], snapshotManifests: ["app.snapshot-manifest", "app.snapshot-manifest"],
} as const;

interface GraphProjection { readonly handle: ProjectionHandleV1; dispose(): void; }
const projectionReaders = new WeakMap<BackupAppGraphV1, (signal: AbortSignal) => Promise<GraphProjection>>();

const originalReaders = new WeakMap<BackupAppGraphV1, (signal: AbortSignal) => AsyncIterable<EventCommitV1>>();

export function originalGraphCommits(graph: BackupAppGraphV1, signal: AbortSignal): AsyncIterable<EventCommitV1> {
  const read = originalReaders.get(graph);
  if (read === undefined) throw new IntegrityError("graph has no authenticated original reader");
  return read(signal);
}

export function openBackupGraphProjection(graph: BackupAppGraphV1, signal: AbortSignal): Promise<GraphProjection> {
  const read = projectionReaders.get(graph);
  if (read === undefined) throw new IntegrityError("graph has no authenticated projection reader");
  return read(signal);
}

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
  const owners = new Map<string, LocalObject[]>();
  const heads = new Map<string, AppHead>();
  const legacyAliases: StorageRefV1[] = [];
  const edges = new Map<string, string[]>();
  const byteHashes = new Map<string, Uint8Array>();
  const enqueue = (object: LocalObject) => {
    const contexts = owners.get(object.local.storageId) ?? [];
    contexts.push(object);
    owners.set(object.local.storageId, contexts);
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
      if (!constantTimeEquals(current.appId, head.appId) ||
          !constantTimeEquals(await sha256(encodeAppHeadBody(current)), current.semanticSha256)) throw new IntegrityError("head identity or digest mismatch");
      heads.set(object.local.storageId, current);
      if (current.headVersion === 1 && (current.conflictPages.length !== 0 || current.auditPages.length !== 0)) {
        throw new IntegrityError("graph requires an unavailable conflict/audit payload reader");
      }
      children.push({ local: current.checkpoint, scope: "app.checkpoint", kind: "app.checkpoint-manifest" });
      for (const name of Object.keys(ROOT_KINDS) as (keyof typeof ROOT_KINDS)[]) {
        const [scope, kind] = ROOT_KINDS[name];
        children.push(...current[name].map((local) => ({ local, scope, kind })));
      }
      if (current.headVersion === 2) {
        children.push(...current.retainedRoots.map((local) => ({ local, scope: local.scope, kind: local.payloadKind })));
      } else {
        legacyAliases.push(...current.retainedRoots);
      }
    } else if (object.kind === "app.checkpoint-manifest") {
      const checkpoint = decodeCheckpointManifest(payload);
      if (!constantTimeEquals(checkpoint.appId, head.appId) ||
          !constantTimeEquals(await sha256(checkpointSemanticBody(payload)), checkpoint.semanticSha256)) throw new IntegrityError("checkpoint identity or digest mismatch");
      children.push(...checkpoint.recordPages.map((local) => ({ local, scope: "app.records" as const, kind: "app.record-page" as const, page: local, byteLength: local.decodedByteLength })));
    } else if (object.kind === "app.record-page") {
      decodeRecordPage(payload);
    } else if (object.kind === "app.baseline-page") {
      const page = decodeBaselinePage(payload);
      if (page.pageVersion === 2 && !constantTimeEquals(page.appId, head.appId)) throw new IntegrityError("baseline belongs to another app");
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
      if (decoded.chunks.some((chunk, index) => chunk.sequence !== index || chunk.decodedByteLength > 1_048_576)) throw new IntegrityError("chunk ordinal or length exceeds manifest bounds");
      children.push(...decoded.chunks.map((chunk) => ({ local: { storageId: chunk.storageId, semanticSha256: chunk.sha256 },
        scope: kind, kind, byteLength: chunk.decodedByteLength,
        chunk: { sequence: chunk.sequence, ...("firstRow" in chunk ? { firstRow: chunk.firstRow, lastRow: chunk.lastRow } : {}) } })));
    } else if (object.kind === "app.audit-page") {
      const audit = decodeAuditPage(payload);
      if (!constantTimeEquals(audit.appId, head.appId)) throw new IntegrityError("audit page belongs to another app");
      children.push(...audit.entries.map(({ segment }) => ({ local: segment, scope: segment.scope, kind: segment.payloadKind })));
    } else if (object.kind === "app.conflict-page") {
      const conflicts = decodeConflictPage(payload);
      if (!constantTimeEquals(conflicts.appId, head.appId)) throw new IntegrityError("conflict page belongs to another app");
      for (const entry of conflicts.entries) {
        for (const evidence of [entry.detected, entry.resolved]) {
          if (evidence !== null) children.push({ local: evidence.commit.segment, scope: "app.events", kind: "app.event-segment" });
        }
      }
    }
    for (const child of children) enqueue(child);
    edges.set(object.local.storageId, children.map((child) => child.local.storageId));
    descriptors.set(object.local.storageId, { reference, payloadKind: object.kind, children: [] });
  }
  for (const alias of legacyAliases) {
    const typed = expectations.get(alias.storageId);
    if (typed === undefined || !constantTimeEquals(typed.local.semanticSha256, alias.semanticSha256)) {
      throw new IntegrityError("retained roots require authenticated scope metadata");
    }
  }
  for (const [id, current] of heads) {
    edges.get(id)!.push(...current.retainedRoots.map((ref) => ref.storageId));
  }
  const active = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id)) throw new IntegrityError("cyclic app graph");
    if (visited.has(id)) return;
    active.add(id);
    for (const child of edges.get(id) ?? []) visit(child);
    active.delete(id);
    visited.add(id);
  };
  visit(pin.headStorageId);
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
  // Reconcile all owning edges before checking leaves: a bare retained edge
  // encountered first must not hide a later manifest's stronger constraints.
  for (const [id, object] of descriptors) {
    const contexts = owners.get(id) ?? [];
    if (object.payloadKind === "app.record-page") {
      const pages = contexts.flatMap((context) => context.page === undefined ? [] : [context.page]);
      if (pages.length === 0) throw new IntegrityError("retained record page has no owning PageRef");
      const bytes = await payload(id, signal);
      const records = decodeRecordPage(bytes).records;
      const keys = records.map((record) => {
        const key = new Uint8Array(32); key.set(record.tableId); key.set(record.recordId, 16); return key;
      });
      const sameKey = (actual: Uint8Array | undefined, expected: Uint8Array | null) =>
        actual === undefined ? expected === null : expected !== null && constantTimeEquals(actual, expected);
      for (const page of pages) {
        if (bytes.length !== page.decodedByteLength || records.length !== page.decodedCount) throw new IntegrityError("record page count or length mismatch");
        if (!sameKey(keys[0], page.firstKey) || !sameKey(keys.at(-1), page.lastKey)) throw new IntegrityError("record page range mismatch");
      }
    } else if (object.payloadKind === "app.source-chunk" || object.payloadKind === "app.snapshot-chunk") {
      const lengths = contexts.flatMap((context) => context.byteLength === undefined ? [] : [context.byteLength]);
      if (lengths.length === 0) throw new IntegrityError("retained chunk has no owning manifest");
      const bytes = await payload(id, signal);
      if (lengths.some((length) => length !== bytes.length)) throw new IntegrityError("chunk length mismatch");
      const chunks = contexts.flatMap((context) => context.chunk === undefined ? [] : [context.chunk]);
      if (chunks.some((chunk) => chunk.sequence !== chunks[0]!.sequence || chunk.firstRow !== chunks[0]!.firstRow || chunk.lastRow !== chunks[0]!.lastRow)) {
        throw new IntegrityError("conflicting chunk ownership");
      }
      if (object.payloadKind === "app.snapshot-chunk") {
        for (const chunk of chunks) {
          if (chunk.firstRow === undefined) {
            if (decodeSnapshotChunk(bytes).sequence !== chunk.sequence) throw new IntegrityError("snapshot chunk ordinal mismatch");
          } else {
            const decoded = decodeSheetSnapshotChunk(bytes);
            if (decoded.firstRow !== chunk.firstRow || decoded.rows.some((row) => row.rowIndex > chunk.lastRow!)) {
              throw new IntegrityError("snapshot chunk range mismatch");
            }
          }
        }
      }
    } else if (object.payloadKind === "app.checkpoint-manifest") {
      const checkpoint = decodeCheckpointManifest(await payload(id, signal));
      for (const sheet of checkpoint.sheetSnapshots) {
        const descriptor = descriptors.get(sheet.snapshotManifestStorageId);
        if (descriptor?.payloadKind !== "app.snapshot-manifest") throw new IntegrityError("missing owning sheet snapshot manifest");
        const bytes = await payload(sheet.snapshotManifestStorageId, signal);
        if ((decodeCanonical(bytes) as ReadonlyMap<string, CborValue>).get("manifestVersion") === 2n) {
          const snapshot = decodeSheetSnapshotManifest(bytes);
          if (!constantTimeEquals(snapshot.sheetId, sheet.sheetId) || snapshot.sheetOrdinal !== sheet.sheetOrdinal) throw new IntegrityError("snapshot sheet identity mismatch");
        }
      }
    }
  }
  for (const current of heads.values()) {
    const owned = decodeCheckpointManifest(await payload(current.checkpoint.storageId, signal));
    for (const sheet of owned.sheetSnapshots) {
      if (!current.snapshotManifests.some((ref) => ref.storageId === sheet.snapshotManifestStorageId)) throw new IntegrityError("missing sheet snapshot root");
    }
    if (current.headVersion === 1) {
      for (const ref of current.baselinePages) {
        if (decodeBaselinePage(await payload(ref.storageId, signal)).pageVersion !== 1) throw new IntegrityError("V1 head cannot declare a V2 baseline page");
      }
      for (const ref of owned.recordPages) {
        if (decodeRecordPage(await payload(ref.storageId, signal)).pageVersion !== 1) throw new IntegrityError("V1 head cannot declare a V2 record page");
      }
    }
  }
  let baselineCount = 0;
  for (const ref of head.baselinePages) baselineCount += decodeBaselinePage(await payload(ref.storageId, signal)).entries.length;
  const checkpoint = decodeCheckpointManifest(await payload(head.checkpoint.storageId, signal));
  const covered = new Map(checkpoint.frontier.map((entry) => [encodeBase64Url(entry.deviceId), entry.commitSequence]));
  const checkpointChains: DeviceChainEvidenceV1[] = [];
  const tail: string[] = [];
  let genesis: EventCommitV1 | undefined;
  async function resolveCommit(ref: CommitEvidenceRefV1, readSignal: AbortSignal) {
    const segment = decodeEventSegment(await payload(ref.segment.storageId, readSignal));
    const matches = segment.commits.filter((commit) => constantTimeEquals(commit.commitId, ref.commitId));
    const commit = matches[0];
    if (!constantTimeEquals(segment.appId, head.appId) || matches.length !== 1 || commit === undefined ||
        !constantTimeEquals(commit.appId, head.appId) || !constantTimeEquals(commit.commitSha256, ref.commitSha256) ||
        !constantTimeEquals(await sha256(encodeCommitBody(commit)), ref.commitSha256)) throw new IntegrityError("audit original commit mismatch");
    return { segment, commit };
  }
  async function* segments(readSignal: AbortSignal) {
    let previous: EventCommitV1 | undefined;
    const ids = new Set<string>();
    for (const ref of head.auditPages) {
      for (const evidence of decodeAuditPage(await payload(ref.storageId, readSignal)).entries) {
        const { segment, commit } = await resolveCommit(evidence, readSignal);
        if (ids.has(encodeBase64Url(commit.commitId)) || (previous !== undefined && compareCommits(previous, commit) >= 0)) {
          throw new IntegrityError("audit logical order or duplicate identity mismatch");
        }
        if (commit.deviceCommitSequence > (covered.get(encodeBase64Url(commit.deviceId)) ?? 0n)) throw new IntegrityError("audit exceeds checkpoint frontier");
        ids.add(encodeBase64Url(commit.commitId));
        previous = commit;
        yield { ...segment, commits: [commit] };
      }
    }
    for (const ref of head.eventSegments) yield decodeEventSegment(await payload(ref.storageId, readSignal));
  }
  const deviceChains = await verifyBackupFrontier(head.appId, [], segments(signal), head.frontier, sha256, signal);
  const originalRefs = new Map<string, CommitEvidenceRefV1>();
  const conflictEvents = new Map<string, { detected: { commit: CommitEvidenceRefV1; eventId: Uint8Array }; resolved: { commit: CommitEvidenceRefV1; eventId: Uint8Array } | null }>();
  const eventIds = new Set<string>();
  // Source alternatives may live in explicitly retained segments without
  // becoming part of the selected app's applied frontier.
  for (const object of descriptors.values()) {
    if (object.payloadKind !== "app.event-segment") continue;
    const storageId = encodeBase64Url(object.reference.storageId);
    const segment = decodeEventSegment(await payload(storageId, signal));
    if (!constantTimeEquals(segment.appId, head.appId)) throw new IntegrityError("retained segment belongs to another app");
    for (const commit of segment.commits) {
      const id = encodeBase64Url(commit.commitId);
      const previous = originalRefs.get(id);
      if (previous !== undefined && !constantTimeEquals(previous.commitSha256, commit.commitSha256)) throw new IntegrityError("conflicting original commit identity");
      originalRefs.set(id, { segment: { ...expectations.get(storageId)!.local, scope: "app.events", payloadKind: "app.event-segment" },
        commitId: commit.commitId, commitSha256: commit.commitSha256 });
    }
  }
  const sourceOrder: { readonly ref: CommitEvidenceRefV1; readonly deviceId: Uint8Array; readonly sequence: bigint }[] = [];
  for (const ref of originalRefs.values()) {
    const { commit } = await resolveCommit(ref, signal);
    sourceOrder.push({ ref, deviceId: commit.deviceId, sequence: commit.deviceCommitSequence });
  }
  sourceOrder.sort((a, b) => compareDomainIds(a.deviceId, b.deviceId) || (a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0));
  const verifiedSources = new Set<string>();
  async function verifySourceFrontier(frontier: EventCommitV1["basisFrontier"]) {
    const key = frontier.map((entry) => `${encodeBase64Url(entry.deviceId)}:${entry.commitSequence}`).join("|");
    if (verifiedSources.has(key)) return;
    async function* sourceSegments() {
      for (const { ref } of sourceOrder) {
        const resolved = await resolveCommit(ref, signal);
        if (resolved.commit.deviceCommitSequence <= (frontier.find((entry) => constantTimeEquals(entry.deviceId, resolved.commit.deviceId))?.commitSequence ?? 0n)) {
          yield { ...resolved.segment, commits: [resolved.commit] };
        }
      }
    }
    await verifyBackupFrontier(head.appId, [], sourceSegments(), frontier, sha256, signal);
    verifiedSources.add(key);
  }
  const causal = (earlier: EventCommitV1, later: EventCommitV1) => constantTimeEquals(earlier.deviceId, later.deviceId)
    ? earlier.deviceCommitSequence < later.deviceCommitSequence
    : later.basisFrontier.some((entry) => constantTimeEquals(entry.deviceId, earlier.deviceId) && entry.commitSequence >= earlier.deviceCommitSequence);
  async function* baselines(readSignal: AbortSignal): AsyncIterable<ProjectionBaselineV1> {
    let previous: { scopeId: Uint8Array; tableId: Uint8Array; recordId: Uint8Array } | undefined;
    const scopes = new Map<string, Uint8Array>();
    for (const ref of head.baselinePages) {
      const page = decodeBaselinePage(await payload(ref.storageId, readSignal));
      const scopeId = page.pageVersion === 1 ? page.scopeId : page.scope.scopeId;
      let scope: ProjectionBaselineV1["scope"];
      if (page.pageVersion === 1 || page.scope.scopeKind === "import") {
        const lineageId = page.pageVersion === 1 ? scopeId : page.scope.importLineageId!;
        let origin: ProjectionBaselineV1["scope"] | undefined;
        for (const originalRef of originalRefs.values()) {
          const { commit } = await resolveCommit(originalRef, readSignal);
          for (const event of commit.events) {
            if (event.kind !== "import.accepted" || !(event.payload instanceof Map)) continue;
            const id: unknown = event.payload.get("lineageId");
            if (!(id instanceof Uint8Array) || !constantTimeEquals(id, lineageId)) continue;
            const checkpointId: unknown = event.payload.get("checkpointManifestStorageId");
            if (!(checkpointId instanceof Uint8Array) || checkpointId.length !== 16) throw new IntegrityError("missing baseline import checkpoint");
            const original = decodeCheckpointManifest(await payload(encodeBase64Url(checkpointId), readSignal));
            const lineage = original.importLineages.find((entry) => constantTimeEquals(entry.lineageId, lineageId));
            if (origin !== undefined || lineage === undefined || !constantTimeEquals(lineage.acceptedCommitId, commit.commitId) ||
                !constantTimeEquals(event.subject.appId, head.appId) || !constantTimeEquals(original.appId, head.appId) ||
                page.entries.some((entry) => !original.tables.some((table) => constantTimeEquals(table.tableId, entry.tableId)))) {
              throw new IntegrityError("ambiguous or mismatched baseline import origin");
            }
            const frontier = new Map(commit.basisFrontier.map((entry) => [encodeBase64Url(entry.deviceId), entry]));
            frontier.set(encodeBase64Url(commit.deviceId), { deviceId: commit.deviceId, commitSequence: commit.deviceCommitSequence });
            origin = { scopeId, scopeKind: "import", importLineageId: lineageId, durableHomeId: null, counterpartId: null,
              establishedGeneration: null, establishedAtMs: lineage.acceptedAtMs,
              establishedFrontier: [...frontier.values()].sort((a, b) => compareDomainIds(a.deviceId, b.deviceId)) };
          }
        }
        if (origin === undefined) throw new IntegrityError("baseline has no authenticated import origin");
        scope = origin;
        if (page.pageVersion === 2 && !constantTimeEquals(encodeCanonical(vaultValue(scope)), encodeCanonical(vaultValue(page.scope)))) {
          throw new IntegrityError("baseline import descriptor contradicts its origin");
        }
      } else { scope = page.scope; }
      await verifySourceFrontier(scope.establishedFrontier);
      const encodedScope = encodeCanonical(vaultValue(scope));
      const key = encodeBase64Url(scopeId);
      const priorScope = scopes.get(key);
      if (priorScope !== undefined && !constantTimeEquals(priorScope, encodedScope)) throw new IntegrityError("conflicting baseline scope descriptors");
      scopes.set(key, encodedScope);
      const entries: ProjectionBaselineV1["entries"] = page.entries.map((entry) => {
        const current = { scopeId, tableId: entry.tableId, recordId: entry.recordId };
        if (previous !== undefined && (compareDomainIds(previous.scopeId, scopeId) || compareDomainIds(previous.tableId, entry.tableId) ||
          compareDomainIds(previous.recordId, entry.recordId)) >= 0) throw new IntegrityError("baseline logical ranges overlap or reverse");
        previous = current;
        return { tableId: entry.tableId, recordId: entry.recordId, state: entry.state,
          values: entry.state !== "present" ? null : encodeCanonical(entry.values!.map(({ fieldId, value }) => new Map<string, CborValue>([["fieldId", fieldId], ["value", encodeCellValue(value)]]))),
          absentReason: "absentReason" in entry ? entry.absentReason : entry.state === "absent" ? "legacy-reason-not-recorded" : null,
          sourceFrontier: "sourceFrontier" in entry ? entry.sourceFrontier : scope.establishedFrontier };
      });
      yield { scope, entries };
    }
  }
  // Resolve baseline authority before any candidate can be exposed or published.
  for await (const page of baselines(signal)) void page;
  for await (const segment of segments(signal)) {
    for (const commit of segment.commits) {
      for (const wire of commit.events) {
        const eventKey = encodeBase64Url(wire.eventId);
        if (eventIds.has(eventKey)) throw new IntegrityError("duplicate original event identity");
        eventIds.add(eventKey);
        if (!isEvidenceEventKind(wire.kind)) continue;
        const event = decodeEvidenceEventPayload(wire.kind, wire.payload as never);
        if (!constantTimeEquals(wire.subject.appId, head.appId) || wire.subject.fieldId !== undefined) throw new IntegrityError("evidence subject belongs to another app or field");
        if (event.payload.schemaRevision !== commit.schemaRevisionAfter) throw new IntegrityError("evidence schema revision mismatch");
        const evidence = { commit: originalRefs.get(encodeBase64Url(commit.commitId))!, eventId: wire.eventId };
        const equal = (a: Uint8Array | undefined, b: Uint8Array) => a !== undefined && constantTimeEquals(a, b);
        if (event.kind === "conflict.resolved") {
          const prior = conflictEvents.get(encodeBase64Url(event.payload.conflictId));
          if (prior === undefined || prior.resolved !== null || !constantTimeEquals(prior.detected.eventId, event.payload.detectedEventId)) throw new IntegrityError("missing or already resolved original conflict");
          const { commit: detectionCommit } = await resolveCommit(prior.detected.commit, signal);
          const detectionWire = detectionCommit.events.find((entry) => constantTimeEquals(entry.eventId, prior.detected.eventId))!;
          const detection = decodeEvidenceEventPayload("conflict.detected", detectionWire.payload as never);
          if (detection.kind !== "conflict.detected") throw new IntegrityError("invalid detection kind");
          if (!(causal(detectionCommit, commit) || (constantTimeEquals(detectionCommit.commitId, commit.commitId) && detectionWire.eventIndex < wire.eventIndex)) ||
              !equal(wire.subject.objectId, detection.payload.conflictId) || !equal(wire.subject.tableId, detection.payload.tableId) ||
              (detection.payload.targetKind === "record" ? !equal(wire.subject.recordId, detection.payload.targetId) : wire.subject.recordId !== undefined) ||
              wire.provenance.source !== "conflict-resolution") throw new IntegrityError("resolution subject or causal authority mismatch");
          const result = decodeEvidenceState(event.payload.result, detection.payload.targetKind);
          if (detection.payload.targetKind === "record" && result.state === "absent") throw new IntegrityError("record resolution cannot be absent");
          if (event.payload.decision !== "edited") {
            const sourceName = event.payload.decision === "keep-local" ? "local" : "incoming";
            const alternative = (detection.canonical.get(sourceName) as ReadonlyMap<string, CborValue>).get("state")!;
            if (!constantTimeEquals(encodeCanonical(event.payload.result), encodeCanonical(alternative))) throw new IntegrityError("resolution contradicts its selected alternative");
          }
          prior.resolved = evidence;
        } else {
          const data = event.payload;
          const target = event.kind === "conflict.detected" ? event.payload.targetId : event.payload.recordId;
          const targetKind = event.kind === "conflict.detected" ? event.payload.targetKind : "record";
          const objectId = event.kind === "conflict.detected" ? event.payload.conflictId : event.payload.mergeId;
          if (!equal(wire.subject.objectId, objectId) || !equal(wire.subject.tableId, data.tableId) ||
              (targetKind === "record" ? !equal(wire.subject.recordId, target) : wire.subject.recordId !== undefined)) throw new IntegrityError("evidence subject mismatch");
          for (const source of [data.local, data.incoming]) {
            const ref = originalRefs.get(encodeBase64Url(source.commitId));
            if (ref === undefined) throw new IntegrityError("source commit is not retained");
            const { commit: sourceCommit } = await resolveCommit(ref, signal);
            if (!source.frontier.some((entry) => constantTimeEquals(entry.deviceId, sourceCommit.deviceId) && entry.commitSequence >= sourceCommit.deviceCommitSequence)) {
              throw new IntegrityError("source frontier does not cover authenticated originals");
            }
            await verifySourceFrontier(source.frontier);
            if (source.source === "uploaded-file" && !sourceCommit.events.some((entry) => entry.kind === "import.accepted" || entry.kind === "table.created")) throw new IntegrityError("file source lacks import evidence");
            if (targetKind === "record" && source.state.state === "present") {
              const row = source.state.value;
              if (row === null || !("recordId" in row) || !constantTimeEquals(row.recordId, target) || !constantTimeEquals(row.tableId, data.tableId)) throw new IntegrityError("source alternative belongs to another record");
            }
          }
          if (event.kind === "conflict.detected") {
            const id = encodeBase64Url(event.payload.conflictId);
            if (conflictEvents.has(id)) throw new IntegrityError("duplicate conflict detection");
            conflictEvents.set(id, { detected: evidence, resolved: null });
          } else if (commit.eventClass !== "reconciliation" || !constantTimeEquals(event.payload.resultCommitId, commit.commitId) ||
              !constantTimeEquals(event.payload.result.recordId, target) || !constantTimeEquals(event.payload.result.tableId, data.tableId)) {
            throw new IntegrityError("merge result authority mismatch");
          }
        }
        if (event.kind !== "conflict.detected") {
          let previous = -1;
          for (const id of event.payload.effectEventIds) {
            const effect = commit.events.find((entry) => constantTimeEquals(entry.eventId, id));
            if (effect === undefined || effect.eventIndex <= previous || effect.eventIndex >= wire.eventIndex || isEvidenceEventKind(effect.kind) ||
                !equal(effect.subject.tableId, wire.subject.tableId!) ||
                (wire.subject.recordId !== undefined && !equal(effect.subject.recordId, wire.subject.recordId))) throw new IntegrityError("invalid same-commit evidence effect");
            previous = effect.eventIndex;
          }
        }
      }
    }
  }
  let previousConflict: Uint8Array | undefined;
  const indexedConflicts = new Set<string>();
  for (const page of head.conflictPages) {
    for (const entry of decodeConflictPage(await payload(page.storageId, signal)).entries) {
      if (previousConflict !== undefined && compareDomainIds(previousConflict, entry.conflictId) >= 0) throw new IntegrityError("conflict page logical ranges overlap or reverse");
      previousConflict = entry.conflictId;
      const id = encodeBase64Url(entry.conflictId);
      const original = conflictEvents.get(id);
      let resolution = original?.resolved ?? null;
      if (resolution !== null) {
        const { commit } = await resolveCommit(resolution.commit, signal);
        if (commit.deviceCommitSequence > (covered.get(encodeBase64Url(commit.deviceId)) ?? 0n)) resolution = null;
      }
      const same = (a: typeof entry.detected, b: typeof entry.detected) => constantTimeEquals(a.eventId, b.eventId) &&
        constantTimeEquals(a.commit.commitId, b.commit.commitId) && constantTimeEquals(a.commit.commitSha256, b.commit.commitSha256);
      if (original === undefined || !same(entry.detected, original.detected) || (entry.resolved === null ? resolution !== null : resolution === null || !same(entry.resolved, resolution))) throw new IntegrityError("conflict page substitutes original evidence");
      for (const ref of [entry.detected, entry.resolved]) if (ref !== null) {
        const { commit } = await resolveCommit(ref.commit, signal);
        if (commit.deviceCommitSequence > (covered.get(encodeBase64Url(commit.deviceId)) ?? 0n)) throw new IntegrityError("conflict page exceeds checkpoint frontier");
      }
      indexedConflicts.add(id);
    }
  }
  for (const [id, original] of conflictEvents) {
    const { commit } = await resolveCommit(original.detected.commit, signal);
    if (head.headVersion === 2 && commit.deviceCommitSequence <= (covered.get(encodeBase64Url(commit.deviceId)) ?? 0n) && !indexedConflicts.has(id)) throw new IntegrityError("checkpoint omits conflict evidence");
  }

  for await (const segment of segments(signal)) {
    let after = 0;
    for (const commit of segment.commits) {
      const limit = covered.get(encodeBase64Url(commit.deviceId)) ?? 0n;
      if (commit.deviceCommitSequence === limit) checkpointChains.push({ deviceId: commit.deviceId, commitSequence: limit, commitSha256: commit.commitSha256 });
      if (commit.deviceCommitSequence <= limit) {
        if (genesis === undefined || compareCommits(genesis, commit) < 0) genesis = commit;
      } else { after++; }
    }
    if (after !== 0 && after !== segment.commits.length) throw new IntegrityError("event segment straddles checkpoint frontier");
  }
  for (const ref of head.eventSegments) {
    const segment = decodeEventSegment(await payload(ref.storageId, signal));
    const after = segment.commits.filter((commit) => commit.deviceCommitSequence > (covered.get(encodeBase64Url(commit.deviceId)) ?? 0n)).length;
    if (head.headVersion === 2 && after !== segment.commits.length) throw new IntegrityError("V2 tail overlaps checkpoint frontier");
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
  async function openGraphProjection(requestSignal: AbortSignal): Promise<GraphProjection> {
      const readSignal = AbortSignal.any([signal, requestSignal]);
      readSignal.throwIfAborted();
      const handle = await openProjection({ sha256, clock: () => ({ epochMs: 0, epochDay: 0 }) });
      const close = () => { readSignal.removeEventListener("abort", close); disposeProjection(handle); };
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
        if (head.headVersion === 2) {
          const oracle = await openProjection({ sha256, clock: () => ({ epochMs: 0, epochDay: 0 }) });
          const closeOracle = () => { disposeProjection(oracle); };
          readSignal.addEventListener("abort", closeOracle, { once: true });
          try {
            let origin: { readonly storageId: string; readonly commit: EventCommitV1 } | undefined;
            for await (const segment of segments(readSignal)) {
              for (const commit of segment.commits) {
                for (const event of commit.events) {
                  if (event.kind !== "import.accepted") continue;
                  const id = event.payload instanceof Map ? event.payload.get("checkpointManifestStorageId") as unknown : undefined;
                  if (!(id instanceof Uint8Array) || id.length !== 16 || origin !== undefined) throw new IntegrityError("ambiguous original import checkpoint");
                  origin = { storageId: encodeBase64Url(id), commit };
                }
              }
            }
            if (origin === undefined || descriptors.get(origin.storageId)?.payloadKind !== "app.checkpoint-manifest") throw new IntegrityError("missing authenticated import checkpoint");
            const originalCheckpoint = decodeCheckpointManifest(await payload(origin.storageId, readSignal));
            const originalFrontier = new Map(originalCheckpoint.frontier.map((entry) => [encodeBase64Url(entry.deviceId), entry.commitSequence]));
            if (originalFrontier.size !== 1 || originalFrontier.get(encodeBase64Url(origin.commit.deviceId)) !== origin.commit.deviceCommitSequence) throw new IntegrityError("import checkpoint frontier mismatch");
            const originalKeys = new Set<string>();
            for (const ref of originalCheckpoint.recordPages) {
              const page = decodeRecordPage(await payload(ref.storageId, readSignal));
              if (page.pageVersion !== 1) throw new IntegrityError("original import requires V1 rows");
              for (const record of page.records) originalKeys.add(`${encodeDomainId(record.tableId)}:${encodeDomainId(record.recordId)}`);
            }
            const originalContexts = tableContexts(originalCheckpoint, (table, record) => originalKeys.has(`${encodeDomainId(table)}:${encodeDomainId(record)}`));
            const original: LoadedAppV1 = { ...initial, checkpoint: originalCheckpoint, commits: [origin.commit],
              head: { ...head, checkpoint: expectations.get(origin.storageId)!.local } };
            const originCommitId = asDomainId("commit", origin.commit.commitId);
            async function* originalPages() {
              for (const ref of originalCheckpoint.recordPages) yield { records: decodeRecordPage(await payload(ref.storageId, readSignal)).records.map((record) =>
                toProjectionRecord(record, originalContexts, originCommitId)) };
            }
            await hydrateApp(oracle, toProjectionCheckpoint(original, originalCheckpoint, originalContexts, 0), [], originalPages());
            await hydrateBaselines(oracle, baselines(readSignal), readSignal);
            oracle.appliedChains.set(encodeBase64Url(origin.commit.deviceId), { sequence: origin.commit.deviceCommitSequence, hash: origin.commit.commitSha256 });
            const adapter = engineAdapter(oracle);
            for await (const segment of segments(readSignal)) {
              for (const commit of segment.commits) {
                const id = encodeBase64Url(commit.deviceId);
                if (commit.deviceCommitSequence > (originalFrontier.get(id) ?? 0n) && commit.deviceCommitSequence <= (covered.get(id) ?? 0n)) {
                  await applyEvents(oracle, [toProjectionCommit(adapter, commit, () => checkpointMetadata(oracle, toProjectionCheckpoint(original, originalCheckpoint, originalContexts, 0)))]);
                }
              }
            }
            await copyCheckpointHistory(oracle, handle, readSignal);
            if (!constantTimeEquals(await sha256Chunks(authoredState(oracle, readSignal), readSignal), await sha256Chunks(authoredState(handle, readSignal), readSignal))) {
              throw new IntegrityError("compacted checkpoint disagrees with original authored evidence");
            }
          } finally { readSignal.removeEventListener("abort", closeOracle); closeOracle(); }
        } else { await hydrateBaselines(handle, baselines(readSignal), readSignal); }
        for (const chain of checkpointChains) handle.appliedChains.set(encodeBase64Url(chain.deviceId), { sequence: chain.commitSequence, hash: chain.commitSha256 });
        const projection = engineAdapter(handle);
        for (const id of tail) {
          for (const commit of decodeEventSegment(await payload(id, readSignal)).commits) {
            readSignal.throwIfAborted();
            await applyEvents(handle, [toProjectionCommit(projection, commit, () => checkpointMetadata(handle, toProjectionCheckpoint(initial, checkpoint, contexts, 0)))]);
          }
        }
        readSignal.throwIfAborted();
        return { handle, dispose: close };
      } catch (cause) { close(); throw cause; }
    }
  async function* canonicalAuthoredState(requestSignal: AbortSignal): AsyncIterable<Uint8Array> {
    const readSignal = AbortSignal.any([signal, requestSignal]);
    const opened = await openGraphProjection(readSignal);
    const { handle } = opened;
    try {
      const extras = new Map<string, CanonicalStreamValue>([["baselines", new CanonicalArray(baselineCount, async function* () {
        for (const ref of head.baselinePages) {
          const page = decodeCanonical(await payload(ref.storageId, readSignal)) as ReadonlyMap<string, CborValue>;
          for (const entry of page.get("entries") as readonly CborValue[]) yield [page.get("pageVersion") === 2n ? page.get("scope")! : page.get("scopeId")!, entry];
        }
      })]]);
      yield* authoredState(handle, readSignal, extras);
    } finally { opened.dispose(); }
  }
  const graph: BackupAppGraphV1 = {
    signal,
    manifest: { vaultFormatVersion: 1, appId: head.appId, checkpoint: descriptors.get(head.checkpoint.storageId)!.reference,
      eventSegments: tail.map((id) => descriptors.get(id)!.reference), baselinePages: head.baselinePages.map((ref) => descriptors.get(ref.storageId)!.reference),
      conflictPages: head.conflictPages.map((ref) => descriptors.get(ref.storageId)!.reference),
      auditPages: head.auditPages.map((ref) => descriptors.get(ref.storageId)!.reference), sourceManifests: refs(head.sourceManifests),
      snapshotManifests: refs(head.snapshotManifests), retainedRoots: [descriptors.get(pin.headStorageId)!.reference], confirmedFrontier: head.frontier },
    objects: [...descriptors.values()], readObject, authoredAppId: head.appId,
    canonicalAuthoredState, checkpointChains, deviceChains,
  };
  projectionReaders.set(graph, openGraphProjection);
  originalReaders.set(graph, async function* (readSignal) {
    for await (const segment of segments(readSignal)) for (const commit of segment.commits) yield commit;
  });
  return graph;
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
