import { asStorageId16, decodeStorageId16, encodeStorageId16, encodeBase64Url, constantTimeEquals } from "../../domain/model/bytes.js";
import { compareDomainIds, encodeDomainId } from "../../domain/model/ids.js";
import { IntegrityError } from "../../domain/model/errors.js";
import { sha256Chunks } from "../../crypto/hash.js";
import { decodeAuditPage, encodeAuditPage, encodeConflictPage, encodeRecordPage, encodeCheckpointBody, encodeCheckpointManifest,
  encodeAppHeadBody, encodeAppHead, type AppHeadV2, type StoredRecordV2, type PageRefV1,
  type CommitEvidenceRefV1, type ConflictPageV1, type TypedStorageRefV1, type CheckpointManifestV1 } from "../../import/staging/roots.js";
import { compareCommits, decodeEventSegment } from "../../persistence/codecs/event-commit.js";
import { encodeCanonical, decodeCanonical, type CborValue } from "../../persistence/codecs/canonical-cbor.js";
import { encodeAuthoredRecord, encodeChangeSummary, encodeOpaque } from "../../persistence/projection/cbor-values.js";
import { checkpointEvidence } from "../../persistence/projection/checkpoint-history.js";
import { executeQuery } from "../../persistence/projection/index.js";
import type { ChangeHistoryCursorV1, ProjectionChangeEventV1 } from "../../persistence/projection/types.js";
import type { EnvelopeFrameV1, EnvelopeScopeV1, EnvelopePayloadKindV1 } from "../../migrations/003_envelope_format_v1.js";
import type { EventCommitV1 } from "../../migrations/004_event_format_v1.js";
import { prepareCleanupTicket, processCleanupTickets } from "../../import/staging/cleanup.js";
import { SessionCatalogPort } from "./import-handlers.js";
import { reachableAppObjects } from "./home-state.js";
import type { WorkerSessionContextV1, AppStoragePortsV1 } from "./event-store.js";
import type { AppSessionV1 } from "./app-session.js";
import { decodeEvidenceEventPayload, isEvidenceEventKind } from "./record-event-payloads.js";
import { exportBackupGraph, openBackupGraphProjection } from "./backup-graph.js";

const PAGE_BYTES = 512 * 1024;
const PAGE_RECORDS = 1024;

/** Produces immutable frames only. Installation owns the subsequent catalog CAS. */
export async function prepareCompaction(ports: AppStoragePortsV1, session: AppSessionV1, logicalRevision: bigint, signal: AbortSignal) {
  const loaded = session.repository.loaded();
  const sourceHeadStorageId = loaded.headStorageId;
  const pin = { appId: encodeDomainId(loaded.appId), headStorageId: sourceHeadStorageId };
  const before = await exportBackupGraph(ports, session.appKey, pin, signal);
  const beforeHash = await sha256Chunks(before.canonicalAuthoredState(signal), signal);
  const metadata = session.checkpointExport.checkpoint();
  const check = () => {
    signal.throwIfAborted();
    if (session.repository.loaded().headStorageId !== sourceHeadStorageId) throw new IntegrityError("compaction source changed");
  };
  const frames = new Map<string, EnvelopeFrameV1>();
  async function seal(scope: EnvelopeScopeV1, payloadKind: EnvelopePayloadKindV1, payload: Uint8Array): Promise<TypedStorageRefV1> {
    check();
    const storageId = asStorageId16(ports.entropy.randomBytes(16));
    const id = encodeStorageId16(storageId);
    if (frames.has(id) || await ports.store.getEnvelope(storageId) !== undefined) throw new IntegrityError("compaction storage identity collision");
    const frame = await ports.crypto.seal({ storageId, logicalRevision, scope, payloadKind, payload, compression: "deflate-raw-v1", key: session.appKey });
    check();
    frames.set(id, frame);
    return { storageId: id, semanticSha256: await ports.crypto.sha256(payload), scope, payloadKind } as TypedStorageRefV1;
  }
  const recordPages: PageRefV1[] = [];
  let records: StoredRecordV2[] = [];
  async function flushRecords() {
    if (records.length === 0) return;
    const payload = encodeRecordPage({ pageVersion: 2, records });
    const ref = await seal("app.records", "app.record-page", payload);
    const key = (record: StoredRecordV2) => Uint8Array.from([...record.tableId, ...record.recordId]);
    recordPages.push({ storageId: ref.storageId, semanticSha256: ref.semanticSha256, firstKey: key(records[0]!), lastKey: key(records.at(-1)!),
      decodedCount: records.length, decodedByteLength: payload.length });
    records = [];
  }
  for (const row of session.checkpointExport.records(signal)) {
    check();
    const record: StoredRecordV2 = { recordId: row.record.recordId, tableId: row.record.tableId,
      recordRevision: row.recordRevision, createdCommitId: row.createdCommitId, updatedCommitId: row.updatedCommitId,
      values: [...row.record.values].sort(([a], [b]) => compareDomainIds(a, b)).map(([fieldId, value]) => ({ fieldId, value })),
      provenance: [...row.record.provenance].sort(([a], [b]) => compareDomainIds(a, b)).map(([fieldId, value]) => ({ fieldId,
        value: value.evidence === undefined ? value : { ...value, evidence: decodeCanonical(encodeOpaque(value.evidence)) } })),
      issues: row.issues.map(({ fieldId, kind, severity, messageKey }) => ({ fieldId, kind, severity, messageKey })) };
    // Probe the complete payload; an oversized individual row is never split.
    encodeRecordPage({ pageVersion: 2, records: [record] });
    if (records.length === PAGE_RECORDS) await flushRecords();
    if (records.length > 0) {
      try { encodeRecordPage({ pageVersion: 2, records: [...records, record] }); }
      catch { await flushRecords(); }
    }
    records.push(record);
  }
  await flushRecords();
  const body: Omit<CheckpointManifestV1, "semanticSha256"> = { ...loaded.checkpoint, schemaRevision: loaded.head.schemaRevision,
    frontier: loaded.head.frontier, appState: metadata.appState, tables: metadata.tables, enumOptions: metadata.enumOptions,
    relationships: metadata.relationships, validationRules: metadata.validationRules, formulas: metadata.formulas,
    charts: (metadata.charts ?? []).map(({ definition, ordinal, provenance, chartRevision }) => ({ definition, ordinal, provenance, chartRevision })),
    sheetSnapshots: metadata.sheetSnapshots.map((sheet) => ({ ...sheet, snapshotManifestStorageId: encodeStorageId16(sheet.snapshotManifestStorageId) })),
    inertItems: metadata.inertItems.map((item) => ({ ...item, preservedManifestStorageId: item.preservedManifestStorageId === null ? null : encodeStorageId16(item.preservedManifestStorageId) })), recordPages };
  const checkpoint = await seal("app.checkpoint", "app.checkpoint-manifest", encodeCheckpointManifest({ ...body, semanticSha256: await ports.crypto.sha256(encodeCheckpointBody(body)) }));
  const refs: { ref: CommitEvidenceRefV1; order: Pick<EventCommitV1, "hybridTime" | "commitId" | "deviceId" | "deviceCommitSequence"> }[] = [];
  async function read(ref: TypedStorageRefV1) {
    check();
    const frame = await ports.store.getEnvelope(decodeStorageId16(ref.storageId));
    if (frame === undefined) throw new IntegrityError("missing compaction evidence");
    const payload = (await ports.crypto.open(frame, ref.scope, session.appKey, ref.payloadKind)).payload;
    if (!constantTimeEquals(await ports.crypto.sha256(payload), ref.semanticSha256)) throw new IntegrityError("compaction evidence digest mismatch");
    check();
    return payload;
  }
  const originalCheckpoints = new Set<string>();
  const conflicts = new Map<string, ConflictPageV1["entries"][number]>();
  const addCommit = (commit: EventCommitV1, ref: CommitEvidenceRefV1) => {
    refs.push({ ref, order: { hybridTime: commit.hybridTime, commitId: commit.commitId, deviceId: commit.deviceId, deviceCommitSequence: commit.deviceCommitSequence } });
    for (const event of commit.events) if (event.kind === "import.accepted") {
      const id: unknown = event.payload instanceof Map ? event.payload.get("checkpointManifestStorageId") : undefined;
      if (!(id instanceof Uint8Array) || id.length !== 16) throw new IntegrityError("missing original import checkpoint identity");
      originalCheckpoints.add(encodeStorageId16(asStorageId16(id)));
    }
  };
  for (const page of loaded.head.auditPages) {
    const decoded = decodeAuditPage(await read({ ...page, scope: "app.audit", payloadKind: "app.audit-page" }));
    for (const ref of decoded.entries) {
      const commit = decodeEventSegment(await read(ref.segment)).commits.find((item) => constantTimeEquals(item.commitId, ref.commitId));
      if (commit === undefined || !constantTimeEquals(commit.commitSha256, ref.commitSha256)) throw new IntegrityError("unresolved original audit commit");
      addCommit(commit, ref);
    }
  }
  for (const segment of loaded.head.eventSegments) {
    const typed = { ...segment, scope: "app.events", payloadKind: "app.event-segment" } as const;
    for (const commit of decodeEventSegment(await read(typed)).commits) addCommit(commit, { segment: typed, commitId: commit.commitId, commitSha256: commit.commitSha256 });
  }
  refs.sort((a, b) => compareCommits(a.order, b.order));
  for (const { ref } of refs) {
    const commit = decodeEventSegment(await read(ref.segment)).commits.find((entry) => constantTimeEquals(entry.commitId, ref.commitId));
    if (commit === undefined) throw new IntegrityError("missing original conflict commit");
    for (const wire of commit.events) {
      if (!isEvidenceEventKind(wire.kind)) continue;
      const event = decodeEvidenceEventPayload(wire.kind, wire.payload as never);
      if (event.kind === "merge.applied") continue;
      const key = encodeBase64Url(event.payload.conflictId);
      const evidence = { commit: ref, eventId: wire.eventId };
      if (event.kind === "conflict.detected") {
        if (conflicts.has(key)) throw new IntegrityError("duplicate original conflict");
        conflicts.set(key, { conflictId: event.payload.conflictId, detected: evidence, resolved: null });
      } else {
        const detected = conflicts.get(key);
        if (detected === undefined || detected.resolved !== null || !constantTimeEquals(detected.detected.eventId, event.payload.detectedEventId)) {
          throw new IntegrityError("resolution has no pending original detection");
        }
        conflicts.set(key, { ...detected, resolved: evidence });
      }
    }
  }
  const conflictPages: TypedStorageRefV1[] = [];
  let conflictEntries: ConflictPageV1["entries"][number][] = [];
  async function flushConflicts() {
    if (conflictEntries.length === 0) return;
    conflictPages.push(await seal("app.conflicts", "app.conflict-page", encodeConflictPage({ pageVersion: 1, appId: loaded.appId, entries: conflictEntries })));
    conflictEntries = [];
  }
  for (const entry of [...conflicts.values()].sort((a, b) => compareDomainIds(a.conflictId, b.conflictId))) {
    encodeConflictPage({ pageVersion: 1, appId: loaded.appId, entries: [entry] });
    if (conflictEntries.length === PAGE_RECORDS) await flushConflicts();
    if (conflictEntries.length > 0) {
      try { encodeConflictPage({ pageVersion: 1, appId: loaded.appId, entries: [...conflictEntries, entry] }); }
      catch { await flushConflicts(); }
    }
    conflictEntries.push(entry);
  }
  await flushConflicts();

  const auditPages: TypedStorageRefV1[] = [];
  let entries: CommitEvidenceRefV1[] = [];
  async function flushAudit() {
    if (entries.length === 0) return;
    auditPages.push(await seal("app.audit", "app.audit-page", encodeAuditPage({ pageVersion: 1, appId: loaded.appId, entries })));
    entries = [];
  }
  for (const { ref } of refs) {
    if (entries.length === PAGE_RECORDS) await flushAudit();
    if (entries.length > 0) {
      try { if (encodeAuditPage({ pageVersion: 1, appId: loaded.appId, entries: [...entries, ref] }).length > PAGE_BYTES) await flushAudit(); }
      catch { await flushAudit(); }
    }
    entries.push(ref);
  }
  await flushAudit();
  const retained = new Map<string, TypedStorageRefV1>();
  if (loaded.head.headVersion === 2) for (const ref of loaded.head.retainedRoots) retained.set(ref.storageId, ref);
  for (const storageId of originalCheckpoints) {
    const object = before.objects.find((item) => encodeStorageId16(asStorageId16(item.reference.storageId)) === storageId);
    if (object?.payloadKind !== "app.checkpoint-manifest") throw new IntegrityError("original checkpoint has no authenticated owner");
    const payload = await ports.crypto.open((await ports.store.getEnvelope(decodeStorageId16(storageId)))!, "app.checkpoint", session.appKey, "app.checkpoint-manifest");
    retained.set(storageId, { storageId, semanticSha256: await ports.crypto.sha256(payload.payload), scope: "app.checkpoint", payloadKind: "app.checkpoint-manifest" });
  }
  const headBody: Omit<AppHeadV2, "semanticSha256"> = { ...loaded.head, headVersion: 2, headRevision: loaded.head.headRevision + 1n,
    checkpoint, eventSegments: [], auditPages, conflictPages, retainedRoots: [...retained.values()].sort((a, b) => compareDomainIds(decodeStorageId16(a.storageId), decodeStorageId16(b.storageId))) };
  const head: AppHeadV2 = { ...headBody, semanticSha256: await ports.crypto.sha256(encodeAppHeadBody(headBody)) };
  const headRef = await seal("app.head", "app.head", encodeAppHead(head));
  const store = { getEnvelope: async (id: Parameters<AppStoragePortsV1["store"]["getEnvelope"]>[0]) => frames.get(encodeStorageId16(id)) ?? ports.store.getEnvelope(id) };
  const graph = await exportBackupGraph({ crypto: ports.crypto, store }, session.appKey, { ...pin, headStorageId: headRef.storageId }, signal);
  if (!constantTimeEquals(beforeHash, await sha256Chunks(graph.canonicalAuthoredState(signal), signal))) throw new IntegrityError("compaction changed authored state");
  const candidate = await openBackupGraphProjection(graph, signal);
  try {
    let after: ChangeHistoryCursorV1 | null = null;
    for (;;) {
      check();
      const query: { readonly kind: "page-change-history"; readonly after: ChangeHistoryCursorV1 | null; readonly limit: number } = { kind: "page-change-history", after, limit: 128 };
      const original = session.projection.execute(query);
      const reconstructed = executeQuery(candidate.handle, query);
      if (original.hasMore !== reconstructed.hasMore || !constantTimeEquals(historyBytes(original.events), historyBytes(reconstructed.events))) {
        throw new IntegrityError("compaction changed original history or restoration");
      }
      if (!original.hasMore) break;
      after = original.nextCursor;
    }
    const original = await openBackupGraphProjection(before, signal);
    try {
      const source = checkpointEvidence(original.handle, signal)[Symbol.iterator]();
      const target = checkpointEvidence(candidate.handle, signal)[Symbol.iterator]();
      try {
        for (;;) {
          check();
          const left = source.next(); const right = target.next();
          if (left.done !== right.done || (!left.done && !right.done && !constantTimeEquals(left.value, right.value))) {
            throw new IntegrityError("compaction changed original baseline, conflict, merge or history SQL");
          }
          if (left.done) break;
        }
      } finally { source.return?.(); target.return?.(); }
    } finally { original.dispose(); }
  } finally { candidate.dispose(); }
  check();
  return { sourceHeadStorageId, headStorageId: headRef.storageId, head, frames: [...frames.values()], graph };
}

function historyBytes(events: readonly ProjectionChangeEventV1[]): Uint8Array {
  return encodeCanonical(events.map((event) => new Map<string, CborValue>([
    ["eventId", event.eventId], ["commitId", event.commitId], ["eventIndex", event.eventIndex], ["eventKind", event.eventKind],
    ["eventClass", event.eventClass], ["subjectKind", event.subjectKind], ["subjectId", event.subjectId], ["wallTimeMs", event.wallTimeMs],
    ["logicalCounter", event.logicalCounter], ["deviceId", event.deviceId], ["summary", decodeCanonical(encodeChangeSummary(event.summary))],
    ["restoration", event.restoration === null ? null : decodeCanonical(encodeAuthoredRecord(event.restoration))],
  ])));
}


/** Every deletion batch re-reads current roots and pins before its revision/epoch CAS. */
export async function drainCompactionCleanup(ports: AppStoragePortsV1, getContext: () => WorkerSessionContextV1,
  signal: AbortSignal): Promise<void> {
  const initial = getContext();
  const catalog = new SessionCatalogPort(initial);
  const assertCurrent = () => {
    signal.throwIfAborted();
    const live = getContext();
    if (live.localRoot !== initial.localRoot || live.writerEpoch !== initial.writerEpoch || live.transactionRevision !== catalog.transactionRevision) {
      throw new IntegrityError("compaction cleanup session changed");
    }
    return live;
  };
  await processCleanupTickets({ ...ports, catalog }, initial.localRoot, { beforeCompactionBatch: async (ids) => {
    const context = assertCurrent();
    const reachable = await reachableAppObjects(ports, context, signal);
    assertCurrent();
    return ids.every((id) => !reachable.has(id));
  } });
}

/** Atomic installation; no authored commit, receipt or count is advanced. */
export async function compactApp(input: { readonly ports: AppStoragePortsV1; readonly session: AppSessionV1;
  readonly getContext: () => WorkerSessionContextV1; readonly closeApp: (appId: string) => void }, signal: AbortSignal) {
  const { ports, session } = input;
  const context = input.getContext();
  const appId = encodeDomainId(session.appId);
  const source = session.repository.loaded().headStorageId;
  const check = () => {
    signal.throwIfAborted();
    const live = input.getContext();
    if (live.localRoot !== context.localRoot || live.writerEpoch !== context.writerEpoch || live.transactionRevision !== context.transactionRevision ||
      live.catalog.apps.find((app) => app.appId === appId)?.appHeadStorageId !== source || session.repository.loaded().headStorageId !== source) {
      throw new IntegrityError("compaction authority changed");
    }
  };
  check();
  const candidate = await prepareCompaction(ports, session, BigInt(context.transactionRevision + 1), signal);
  check();
  const original = await exportBackupGraph(ports, session.appKey, { appId, headStorageId: source }, signal);
  const frames = new Map(candidate.frames.map((frame) => [encodeBase64Url(frame.storageId), frame]));
  const nextPorts = { ...ports, store: { ...ports.store, getEnvelope: async (id: Parameters<AppStoragePortsV1["store"]["getEnvelope"]>[0]) =>
    frames.get(encodeBase64Url(id)) ?? ports.store.getEnvelope(id) } };
  const nextContext = { ...context, catalog: { ...context.catalog,
    apps: context.catalog.apps.map((app) => app.appId === appId ? { ...app, appHeadStorageId: candidate.headStorageId } : app) } };
  const reachable = await reachableAppObjects(nextPorts, nextContext, signal);
  check();
  const obsolete = original.objects.map((object) => encodeBase64Url(object.reference.storageId)).filter((id) => !reachable.has(id));
  const prepared = await prepareCleanupTicket(ports, context.localRoot, obsolete, "compaction", context.transactionRevision + 1);
  check();
  const catalog = new SessionCatalogPort(context);
  const sealed = await catalog.sealWithCompactedApp(appId, source, candidate.headStorageId, prepared.ticket.ticketId);
  check();
  const transactionRevision = await ports.store.commit({ expectedRevision: context.transactionRevision, expectedWriterEpoch: context.writerEpoch,
    addFrames: [...candidate.frames, prepared.frame, sealed.frame], bootstrapPatch: { catalogStorageId: sealed.storageId } });
  catalog.adopt(sealed.storageId, transactionRevision);
  input.closeApp(appId);
  await drainCompactionCleanup(ports, input.getContext, signal);
  return { headStorageId: candidate.headStorageId, head: candidate.head };
}
