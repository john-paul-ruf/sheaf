import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { asStorageId16 } from "../../../src/domain/model/bytes.js";
import { asDomainId } from "../../../src/domain/model/ids.js";
import { tableContexts, toProjectionRecord } from "../../../src/workers/data/app-session.js";
import { decodeRecordPage, encodeRecordPage, type StoredRecordV2 } from "../../../src/import/staging/roots.js";
import type { TableDefV1 } from "../../../src/domain/model/schema.js";
import { AppSessionRegistry } from "../../../src/workers/data/app-session.js";
import { prepareCompaction } from "../../../src/workers/data/compaction.js";
import { compactApp } from "../../../src/workers/data/compaction.js";
import * as backupHandlers from "../../../src/workers/data/backup-handlers.js";
import type { DataWorkerCommandHandler } from "../../../src/workers/data/handlers.js";
import { isStageChannelOutboundV1, stageBatch, stageSource, stageNack, type StageChannelInboundV1 } from "../../../src/workers/protocol/stage-channel.js";
import { envelopeCryptoAdapter, envelopeStoreAdapter } from "../../../src/workers/data/import-handlers.js";
import { ask, createTestHandler, importDemoApp, readClearBootstrapRow, realEntropy, resetLocalDatabase } from "./data-worker.js";

function sendStage(port: MessagePort, message: StageChannelInboundV1, seq: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      port.removeEventListener("message", receive);
      if (error) reject(error); else resolve();
    };
    const receive = (event: MessageEvent<unknown>) => {
      if (!isStageChannelOutboundV1(event.data)) return;
      finish(event.data.kind === "ack" && event.data.ackSeq === seq ? undefined : new Error("staging refused"));
    };
    const timer = setTimeout(() => finish(new Error("staging timed out")), 5000);
    port.addEventListener("message", receive);
    port.postMessage(message);
  });
}

async function importCsv(worker: DataWorkerCommandHandler, appId?: string) {
  const { textSource } = await import("../import/fixtures.js");
  const { sniffContent } = await import("../../../src/import/source/sniff.js");
  const { isDelimitedSniff, preflightDelimited } = await import("../../../src/import/preflight/preflight.js");
  const { parseDelimited } = await import("../../../src/import/formats/delimited/parse.js");
  const source = textSource("Item,Amount\nHammer,2\nNail,3\n");
  const sniff = await sniffContent(source, "tools.csv");
  if (!isDelimitedSniff(sniff)) throw new Error("not CSV");
  const preflight = await preflightDelimited(source, sniff);
  if (preflight.kind !== "proceed") throw new Error("preflight refused");
  const channel = new MessageChannel();
  channel.port1.start();
  try {
    const stage = await ask(worker, { kind: "beginImportStage", fileName: "tools.csv", detected: sniff.format,
      preflight: preflight.report, destination: appId ? { kind: "existing-app", appId } : { kind: "new-app" } }, [channel.port2]);
    let seq = 0;
    await sendStage(channel.port1, stageSource(seq, 0, await source.slice(0, source.byteLength)), seq++);
    for await (const item of parseDelimited(source, sniff.format, { sheetName: "Tools" })) {
      await sendStage(channel.port1, stageBatch(seq, item), seq++);
    }
    await ask(worker, { kind: "runInference", stageId: stage.stageId });
    const result = await ask(worker, { kind: "promoteImport", stageId: stage.stageId, acceptedName: "Tools" });
    if (result.outcome !== "promoted") throw new Error(`promotion refused: ${result.reason}`);
    return result.appId;
  } finally { channel.port1.close(); channel.port2.close(); }
}

it("propagates a staging NACK rather than silently passing an unfinished transport", async () => {
  const channel = new MessageChannel();
  channel.port1.start();
  channel.port2.onmessage = () => channel.port2.postMessage(stageNack(0));
  try { await expect(sendStage(channel.port1, stageSource(0, 0, new Uint8Array([1])), 0)).rejects.toThrow("refused"); }
  finally { channel.port1.close(); channel.port2.close(); }
});

it("installs twice, reconstructs original history after restart, restores once, patches and appends without downgrading V2", async () => {
  await resetLocalDatabase();
  const create = backupHandlers.createBackupHandlers;
  let dependencies: backupHandlers.BackupHandlerDependenciesV1 | undefined;
  const capture = vi.spyOn(backupHandlers, "createBackupHandlers").mockImplementation((input) => {
    dependencies = input;
    return create(input);
  });
  const sessions = vi.spyOn(AppSessionRegistry.prototype, "set");
  let worker = createTestHandler().handler;
  const passphrase = "installed copper heron meadow";
  const signal = new AbortController().signal;
  const open = async (appId: string) => {
    await ask(worker, { kind: "openApp", appId });
    return sessions.mock.calls.at(-1)![1];
  };
  const restart = async () => {
    worker.dispose();
    const { closeLocalDatabase } = await import("../../../src/persistence/envelope-store/db.js");
    closeLocalDatabase();
    worker = createTestHandler().handler;
    await ask(worker, { kind: "unlock", passphrase });
  };
  try {
    await ask(worker, { kind: "setup", passphrase });
    const appId = await importCsv(worker);
    const structure = (await ask(worker, { kind: "getAppStructure", appId })).structure!;
    const table = structure.tables[0]!;
    const fieldId = table.fields.find((field) => field.displayName === "Item")!.fieldId;
    const rows = (await ask(worker, { kind: "queryRecords", appId, tableId: table.tableId, limit: 100 })).page!.records;
    const recordId = rows[0]!.recordId;
    const survivor = rows[1]!.recordId;
    const original = (await ask(worker, { kind: "getRecord", appId, recordId })).record!;
    expect((await ask(worker, { kind: "deleteRecord", appId, recordId })).outcome).toBe("accepted");
    const deletion = (await ask(worker, { kind: "getDeletedRecord", appId, recordId })).deleted;
    expect(deletion).not.toBeNull();
    const history = (await ask(worker, { kind: "getChangeHistory", appId, limit: 100 })).page;
    const before = await open(appId);
    const originalChain = before.repository.chainState();
    const count = (await ask(worker, { kind: "openApp", appId })).session!.deviceOnlyChangeCount;
    for (let round = 0; round < 2; round++) {
      const session = await open(appId);
      const catalog = dependencies!.getContext().catalog;
      const result = await compactApp({ ...dependencies!, session }, signal);
      expect(result.head.headVersion).toBe(2);
      expect(result.head.eventSegments).toEqual([]);
      expect(dependencies!.getContext().catalog.apps[0]).toEqual({ ...catalog.apps[0], appHeadStorageId: result.headStorageId });
      expect(dependencies!.getContext().catalog.homes).toEqual(catalog.homes);
      expect(dependencies!.getContext().catalog.cleanupTicketStorageIds).toEqual([]);
      await restart();
      const reopened = await open(appId);
      expect(reopened.repository.chainState()).toEqual(originalChain);
      expect((await ask(worker, { kind: "getChangeHistory", appId, limit: 100 })).page).toEqual(history);
      expect((await ask(worker, { kind: "getDeletedRecord", appId, recordId })).deleted).toEqual(deletion);
      expect((await ask(worker, { kind: "openApp", appId })).session!.deviceOnlyChangeCount).toBe(count);
    }
    const noChange = await readClearBootstrapRow();
    expect(await ask(worker, { kind: "restoreRecord", appId, recordId: survivor })).toMatchObject({ outcome: "accepted", receipt: { commitId: null } });
    const { encodeDomainId } = await import("../../../src/domain/model/ids.js");
    expect((await ask(worker, { kind: "restoreRecord", appId, recordId: encodeDomainId(asDomainId("record", new Uint8Array(16).fill(249))) })).outcome).toBe("unknown-subject");
    expect(await readClearBootstrapRow()).toEqual(noChange);
    expect((await ask(worker, { kind: "restoreRecord", appId, recordId })).outcome).toBe("accepted");
    const restoredCommit = (await open(appId)).repository.loaded().commits.at(-1)!;
    expect(restoredCommit.previousDeviceCommitSha256).toEqual(originalChain.lastCommitSha256);
    expect(restoredCommit.deviceCommitSequence).toBe(originalChain.deviceCommitSequence + 1n);
    expect(restoredCommit.hybridTime.wallTimeMs).toBeGreaterThanOrEqual(originalChain.lastHybridTime!.wallTimeMs);
    const restored = (await ask(worker, { kind: "getRecord", appId, recordId })).record!;
    expect(restored.createdCommitId).toBe(original.createdCommitId);
    expect(restored.values).toEqual(original.values);
    const once = await readClearBootstrapRow();
    expect(await ask(worker, { kind: "restoreRecord", appId, recordId })).toMatchObject({ outcome: "accepted", receipt: { commitId: null } });
    expect(await readClearBootstrapRow()).toEqual(once);
    const loaded = (await open(appId)).repository.loaded();
    expect((await ask(worker, { kind: "patchRecord", appId, recordId, changes: [{ fieldId, value: { kind: "text", text: "restored tool" } }] })).outcome).toBe("accepted");
    const afterPatch = (await open(appId)).repository.loaded();
    expect(afterPatch.head.auditPages).toEqual(loaded.head.auditPages);
    expect(afterPatch.head.conflictPages).toEqual(loaded.head.conflictPages);
    expect(afterPatch.head.retainedRoots).toEqual(loaded.head.retainedRoots);
    const chain = (await open(appId)).repository.chainState();
    expect(chain.deviceCommitSequence).toBe(originalChain.deviceCommitSequence + 2n);
    expect(afterPatch.commits.at(-1)!.previousDeviceCommitSha256).toEqual(restoredCommit.commitSha256);
    expect(await importCsv(worker, appId)).toBe(appId);
    await restart();
    const appended = await open(appId);
    expect(appended.repository.loaded().head.headVersion).toBe(2);
    expect(appended.repository.loaded().head.auditPages).toEqual(loaded.head.auditPages);
    expect(appended.repository.loaded().head.retainedRoots).toEqual(loaded.head.retainedRoots);
    expect(appended.repository.chainState().deviceCommitSequence).toBe(chain.deviceCommitSequence + 1n);
    expect(appended.repository.loaded().commits.at(-1)!.previousDeviceCommitSha256).toEqual(chain.lastCommitSha256);
    expect((await ask(worker, { kind: "getAppStructure", appId })).structure!.tables).toHaveLength(2);
    expect((await ask(worker, { kind: "getRecord", appId, recordId })).record!.values.find((entry) => entry.fieldId === fieldId)?.value)
      .toEqual({ kind: "text", text: "restored tool" });
    const finalHistory = (await ask(worker, { kind: "getChangeHistory", appId, limit: 100 })).page!;
    expect(finalHistory.entries.filter((entry) => history!.entries.some((old) => old.eventId === entry.eventId))).toEqual(history!.entries);
  } finally { worker.dispose(); sessions.mockRestore(); capture.mockRestore(); await resetLocalDatabase(); }
}, 120_000);

it("preserves head and receipt on refusals, retains complete pinned graphs, and resumes cleanup after an installed crash", async () => {
  await resetLocalDatabase();
  const create = backupHandlers.createBackupHandlers;
  let deps: backupHandlers.BackupHandlerDependenciesV1 | undefined;
  const capture = vi.spyOn(backupHandlers, "createBackupHandlers").mockImplementation((input) => { deps = input; return create(input); });
  const sessions = vi.spyOn(AppSessionRegistry.prototype, "set");
  let worker = createTestHandler().handler;
  const passphrase = "pinned compaction authority test";
  const signal = new AbortController().signal;
  try {
    await ask(worker, { kind: "setup", passphrase });
    const appId = await importCsv(worker);
    const home = await worker.backup.createBundleHome(appId, "Compaction", "independent backup copper meadow");
    await ask(worker, { kind: "changeTheme", appId, themeKey: "indigo", mode: "light", density: "compact", customAccent: null, logo: { kind: "keep" } });
    await ask(worker, { kind: "openApp", appId });
    const session = sessions.mock.calls.at(-1)![1];
    const ports = deps!.ports;
    const initial = await readClearBootstrapRow();
    const homeBefore = await worker.backup.read(home.homeId);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(compactApp({ ...deps!, session }, cancelled.signal)).rejects.toThrow();
    for (const field of ["transactionRevision", "writerEpoch"] as const) {
      let reads = 0;
      await expect(compactApp({ ...deps!, session, getContext: () => {
        const context = deps!.getContext();
        return reads++ === 0 ? context : { ...context, [field]: context[field] + 1 };
      } }, signal)).rejects.toThrow("authority changed");
    }
    for (const error of [new DOMException("quota refusal", "QuotaExceededError"), new Error("crash before swap")]) {
      await expect(compactApp({ ...deps!, session, ports: { ...ports, store: { ...ports.store, commit: () => Promise.reject(error) } } }, signal))
        .rejects.toThrow(error.message);
      expect(await readClearBootstrapRow()).toEqual(initial);
      expect(await worker.backup.read(home.homeId)).toEqual(homeBefore);
    }
    const missing = session.repository.loaded().head.eventSegments[0]!.storageId;
    const { encodeStorageId16, decodeStorageId16 } = await import("../../../src/domain/model/bytes.js");
    await expect(compactApp({ ...deps!, session, ports: { ...ports, store: { ...ports.store,
      getEnvelope: (id) => encodeStorageId16(id) === missing ? Promise.resolve(undefined) : ports.store.getEnvelope(id) } } }, signal)).rejects.toThrow();
    expect(await readClearBootstrapRow()).toEqual(initial);
    const first = await worker.backup.pin(appId);
    const second = await worker.backup.pin(appId);
    const oldHead = first.headStorageId;
    const { exportBackupGraph } = await import("../../../src/workers/data/backup-graph.js");
    const oldGraph = await exportBackupGraph(ports, session.appKey, first, signal);
    const frames = await Promise.all(oldGraph.objects.map(async (object) => [encodeStorageId16(asStorageId16(object.reference.storageId)),
      await ports.store.getEnvelope(asStorageId16(object.reference.storageId))] as const));
    await compactApp({ ...deps!, session }, signal);
    for (const [id, frame] of frames) expect(await ports.store.getEnvelope(decodeStorageId16(id))).toEqual(frame);
    await worker.backup.release(home.homeId, first.operationId);
    expect(await ports.store.getEnvelope(decodeStorageId16(oldHead))).toBeDefined();
    await worker.backup.release(home.homeId, second.operationId);
    expect(await ports.store.getEnvelope(decodeStorageId16(oldHead))).toBeUndefined();
    await ask(worker, { kind: "openApp", appId });
    const reopened = sessions.mock.calls.at(-1)![1];
    const receipt = await worker.backup.read(home.homeId);
    let commits = 0;
    await expect(compactApp({ ...deps!, session: reopened, ports: { ...ports, store: { ...ports.store, commit: async (transaction) => {
      if (commits++ > 0) throw new Error("crash after swap");
      return ports.store.commit(transaction);
    } } } }, signal)).rejects.toThrow("crash after swap");
    const installed = deps!.getContext().catalog.apps[0]!.appHeadStorageId;
    expect(installed).not.toBe(reopened.repository.loaded().headStorageId);
    expect(deps!.getContext().catalog.cleanupTicketStorageIds).toHaveLength(1);
    worker.dispose();
    const { closeLocalDatabase } = await import("../../../src/persistence/envelope-store/db.js");
    closeLocalDatabase();
    worker = createTestHandler().handler;
    await ask(worker, { kind: "unlock", passphrase });
    expect(deps!.getContext().catalog.cleanupTicketStorageIds).toEqual([]);
    expect(deps!.getContext().catalog.apps[0]!.appHeadStorageId).toBe(installed);
    expect(await worker.backup.read(home.homeId)).toEqual(receipt);
    expect((await ask(worker, { kind: "openApp", appId })).session).not.toBeNull();
  } finally { worker.dispose(); sessions.mockRestore(); capture.mockRestore(); await resetLocalDatabase(); }
}, 120_000);

it("hydrates V2 row identity and canonical provenance directly while retaining V1 import defaults", () => {
  const id = (value: number) => new Uint8Array(16).fill(value);
  const tableId = asDomainId("table", id(1));
  const fieldId = asDomainId("field", id(2));
  const created = asDomainId("commit", id(3));
  const updated = asDomainId("commit", id(4));
  const checkpointCommit = asDomainId("commit", id(5));
  const table: TableDefV1 = { tableId, displayName: "Table", tableOrdinal: 0, fields: [{ fieldId, tableId,
    displayName: "Text", fieldOrdinal: 0, type: { kind: "text" }, isRequired: false, isActive: true, schemaRevision: 1n }],
    keyFieldId: null, labelFieldId: null, sourceSheetId: null, isActive: true, schemaRevision: 1n };
  const contexts = tableContexts({ tables: [table], enumOptions: [], validationRules: [], relationships: [] }, () => false);
  const record: StoredRecordV2 = { recordId: asDomainId("record", id(6)), tableId,
    values: [{ fieldId, value: { kind: "text", text: "original value" } }], issues: [], recordRevision: 7n,
    createdCommitId: created, updatedCommitId: updated,
    provenance: [{ fieldId, value: { source: "remote-device", sourceId: id(7), sourceTimestampMs: 123n, evidence: new Uint8Array([1, 2]) } }] };
  const page = decodeRecordPage(encodeRecordPage({ pageVersion: 2, records: [record] }));
  const mapped = toProjectionRecord(page.records[0]!, contexts, checkpointCommit);
  expect(mapped.recordRevision).toBe(7n);
  expect(mapped.createdCommitId).toEqual(created);
  expect(mapped.updatedCommitId).toEqual(updated);
  expect(mapped.record.provenance.get(fieldId)).toEqual(record.provenance[0]!.value);
  const { recordRevision, createdCommitId, updatedCommitId, provenance, ...legacy } = record;
  void recordRevision; void createdCommitId; void updatedCommitId; void provenance;
  const imported = toProjectionRecord(legacy, contexts, checkpointCommit);
  expect(imported.recordRevision).toBe(0n);
  expect(imported.createdCommitId).toEqual(checkpointCommit);
  expect(imported.updatedCommitId).toEqual(checkpointCommit);
  expect(imported.record.provenance.size).toBe(0);
});

it("prepares a V2 candidate from real imported rows and edits without changing installed storage", async () => {
  await resetLocalDatabase();
  const worker = createTestHandler().handler;
  const registered = vi.spyOn(AppSessionRegistry.prototype, "set");
  try {
    await ask(worker, { kind: "setup", passphrase: "candidate copper heron meadow" });
    const appId = await importDemoApp(worker);
    await ask(worker, { kind: "openApp", appId });
    await ask(worker, { kind: "changeTheme", appId, themeKey: "indigo", mode: "light", density: "compact", customAccent: null, logo: { kind: "keep" } });
    const session = registered.mock.calls.at(-1)![1];
    const before = await readClearBootstrapRow();
    const candidate = await prepareCompaction({ crypto: envelopeCryptoAdapter, store: envelopeStoreAdapter, entropy: realEntropy }, session,
      BigInt(Number(before?.["transactionRevision"]) + 1), new AbortController().signal);
    const { encodeStorageId16 } = await import("../../../src/domain/model/bytes.js");
    const { loadApp, createEventStore } = await import("../../../src/workers/data/event-store.js");
    const pending = new Map(candidate.frames.map((frame) => [encodeStorageId16(asStorageId16(frame.storageId)), frame]));
    const candidatePorts = { crypto: envelopeCryptoAdapter, entropy: realEntropy, store: { ...envelopeStoreAdapter,
      getEnvelope: async (id: Parameters<typeof envelopeStoreAdapter.getEnvelope>[0]) => pending.get(encodeStorageId16(id)) ?? envelopeStoreAdapter.getEnvelope(id) } };
    const reloaded = await loadApp(candidatePorts, session.appKey, candidate.headStorageId);
    expect(reloaded.commits).toEqual(session.repository.loaded().commits);
    const chain = createEventStore({ ports: candidatePorts, session: () => { throw new Error("read only"); },
      deviceId: session.repository.chainState().deviceId }, session.appKey, reloaded).chainState();
    expect(chain).toEqual(session.repository.chainState());
    expect(candidate.head.headVersion).toBe(2);
    expect(candidate.head.eventSegments).toHaveLength(0);
    expect(candidate.head.auditPages.length).toBeGreaterThan(0);
    expect(candidate.head.retainedRoots.some((ref) => ref.payloadKind === "app.checkpoint-manifest")).toBe(true);
    expect(candidate.graph.deviceChains[0]!.commitSequence).toBe(session.repository.chainState().deviceCommitSequence);
    expect(await readClearBootstrapRow()).toEqual(before);
    expect(session.repository.loaded().headStorageId).toBe(candidate.sourceHeadStorageId);
    for (const frame of candidate.frames) expect(await envelopeStoreAdapter.getEnvelope(asStorageId16(frame.storageId))).toBeUndefined();
  } finally { registered.mockRestore(); worker.dispose(); await resetLocalDatabase(); }
}, 60_000);

it("derives each import baseline from its own accepted lineage and refuses another import's scope", async () => {
  const { encodeBase64Url, decodeStorageId16 } = await import("../../../src/domain/model/bytes.js");
  const { encodeBaselinePage, decodeBaselinePage, encodeAppHead, encodeAppHeadBody } = await import("../../../src/import/staging/roots.js");
  const { exportBackupGraph, openBackupGraphProjection } = await import("../../../src/workers/data/backup-graph.js");
  const { selectRows } = await import("../../../src/persistence/projection/engine.js");
  const { sha256 } = await import("../../../src/crypto/hash.js");
  await resetLocalDatabase();
  const worker = createTestHandler().handler;
  const sessions = vi.spyOn(AppSessionRegistry.prototype, "set");
  const signal = new AbortController().signal;
  try {
    await ask(worker, { kind: "setup", passphrase: "separate original import origins" });
    const seen: Uint8Array[] = [];
    for (let index = 0; index < 2; index++) {
      const appId = await importDemoApp(worker);
      await ask(worker, { kind: "openApp", appId });
      const session = sessions.mock.calls.at(-1)![1];
      const loaded = session.repository.loaded();
      const graph = await exportBackupGraph({ crypto: envelopeCryptoAdapter, store: envelopeStoreAdapter }, session.appKey,
        { appId, headStorageId: loaded.headStorageId }, signal);
      const opened = await openBackupGraphProjection(graph, signal);
      try {
        const lineage = loaded.checkpoint.importLineages![0]!;
        const rows = selectRows(opened.handle, "SELECT baseline_scope_id, import_lineage_id, established_at_ms FROM baseline_scopes");
        expect(rows).toEqual([[lineage.lineageId, lineage.lineageId, lineage.acceptedAtMs]]);
        if (seen.length) expect(lineage.lineageId).not.toEqual(seen[0]);
        seen.push(lineage.lineageId);
      } finally { opened.dispose(); }
      if (index === 0) continue;
      const ref = loaded.head.baselinePages[0]!;
      const frame = (await envelopeStoreAdapter.getEnvelope(decodeStorageId16(ref.storageId)))!;
      const page = decodeBaselinePage((await envelopeCryptoAdapter.open(frame, "app.baselines", session.appKey, "app.baseline-page")).payload);
      if (page.pageVersion !== 1) throw new Error("expected legacy baseline");
      const payload = encodeBaselinePage({ ...page, scopeId: seen[0]! });
      const badBaseline = await envelopeCryptoAdapter.seal({ key: session.appKey, storageId: asStorageId16(frame.storageId), logicalRevision: frame.logicalRevision,
        scope: "app.baselines", payloadKind: "app.baseline-page", compression: "none", payload });
      const body = { ...loaded.head, baselinePages: [{ ...ref, semanticSha256: await sha256(payload) }, ...loaded.head.baselinePages.slice(1)] };
      const badHead = await envelopeCryptoAdapter.seal({ key: session.appKey, storageId: decodeStorageId16(loaded.headStorageId), logicalRevision: frame.logicalRevision,
        scope: "app.head", payloadKind: "app.head", compression: "none", payload: encodeAppHead({ ...body, semanticSha256: await sha256(encodeAppHeadBody(body)) }) });
      const before = await readClearBootstrapRow();
      await expect(exportBackupGraph({ crypto: envelopeCryptoAdapter, store: { getEnvelope: async (id) => encodeBase64Url(id) === ref.storageId ? badBaseline :
        encodeBase64Url(id) === loaded.headStorageId ? badHead : envelopeStoreAdapter.getEnvelope(id) } }, session.appKey, { appId, headStorageId: loaded.headStorageId }, signal))
        .rejects.toThrow("authenticated import origin");
      expect(await readClearBootstrapRow()).toEqual(before);
    }
  } finally { sessions.mockRestore(); worker.dispose(); await resetLocalDatabase(); }
}, 60_000);

describe("the periodic compactor", () => {
  /** Manual timers: each check runs only when fired, and the next is armed only after it settles. */
  function manualTimers() {
    const pending: (() => void)[] = [];
    return { pending, timers: { setTimeout: (run: () => void) => { pending.push(run); return run; },
      clearTimeout: (handle: unknown) => { const index = pending.indexOf(handle as () => void); if (index >= 0) pending.splice(index, 1); } },
    async fire() {
      expect(pending).toHaveLength(1);
      pending.shift()!();
      await vi.waitFor(() => { expect(pending).toHaveLength(1); }, { timeout: 30_000, interval: 5 });
    } };
  }

  it("compacts only at the threshold, never repeats on an empty tail, lets edits through, and refuses a failed head until it moves", async () => {
    await resetLocalDatabase();
    const clock = manualTimers();
    const sessions = vi.spyOn(AppSessionRegistry.prototype, "set");
    const worker = createTestHandler(undefined, undefined, { thresholdCommits: 3, intervalMs: 1, timers: clock.timers }).handler;
    const head = async (appId: string) => {
      await ask(worker, { kind: "closeApp", appId });
      await ask(worker, { kind: "openApp", appId });
      return sessions.mock.calls.at(-1)![1].repository.loaded();
    };
    try {
      expect(clock.pending).toHaveLength(0);
      await ask(worker, { kind: "setup", passphrase: "periodic copper heron meadow" });
      expect(clock.pending).toHaveLength(1);
      const appId = await importCsv(worker);
      const table = (await ask(worker, { kind: "getAppStructure", appId })).structure!.tables[0]!;
      const fieldId = table.fields.find((field) => field.displayName === "Item")!.fieldId;
      const recordId = (await ask(worker, { kind: "queryRecords", appId, tableId: table.tableId, limit: 10 })).page!.records[0]!.recordId;
      const patch = async (text: string) => {
        expect((await ask(worker, { kind: "patchRecord", appId, recordId, changes: [{ fieldId, value: { kind: "text", text } }] })).outcome).toBe("accepted");
      };
      await patch("one"); await patch("two");
      const initial = await head(appId);
      await clock.fire();
      expect((await head(appId)).headStorageId).toBe(initial.headStorageId);
      await patch("three");
      // A command issued while the check runs is acknowledged on its own; the compactor defers rather than failing it.
      clock.pending.shift()!();
      await patch("four");
      await vi.waitFor(() => { expect(clock.pending).toHaveLength(1); }, { timeout: 30_000, interval: 5 });
      for (let attempt = 0; attempt < 3 && (await head(appId)).head.headVersion !== 2; attempt++) await clock.fire();
      const compacted = await head(appId);
      expect(compacted.head.headVersion).toBe(2);
      expect(compacted.head.eventSegments).toEqual([]);
      expect((await ask(worker, { kind: "getRecord", appId, recordId })).record!.values.find((entry) => entry.fieldId === fieldId)?.value).toEqual({ kind: "text", text: "four" });
      await clock.fire(); await clock.fire();
      expect((await head(appId)).headStorageId).toBe(compacted.headStorageId);
      await patch("five"); await patch("six"); await patch("seven");
      const refusal = vi.spyOn(envelopeStoreAdapter, "commit").mockRejectedValueOnce(new DOMException("quota refusal", "QuotaExceededError"));
      const before = await readClearBootstrapRow();
      const full = (await head(appId)).headStorageId;
      await clock.fire();
      expect(refusal).toHaveBeenCalledTimes(1);
      expect(await readClearBootstrapRow()).toEqual(before);
      await clock.fire();
      expect(refusal).toHaveBeenCalledTimes(1);
      expect((await head(appId)).headStorageId).toBe(full);
      refusal.mockRestore();
      await patch("eight");
      await clock.fire();
      const second = await head(appId);
      expect(second.head.headVersion).toBe(2);
      expect(second.head.eventSegments).toEqual([]);
      expect(second.head.auditPages.length).toBeGreaterThanOrEqual(compacted.head.auditPages.length);
    } finally { worker.dispose(); sessions.mockRestore(); await resetLocalDatabase(); }
  }, 120_000);

  it("issues no storage read after disposal interrupts a running check", async () => {
    await resetLocalDatabase();
    const clock = manualTimers();
    const worker = createTestHandler(undefined, undefined, { thresholdCommits: 1000, intervalMs: 1, timers: clock.timers }).handler;
    const read = envelopeStoreAdapter.getEnvelope.bind(envelopeStoreAdapter);
    let release: () => void = () => undefined;
    const parked = new Promise<void>((resolve) => { release = resolve; });
    try {
      await ask(worker, { kind: "setup", passphrase: "disposal copper heron meadow" });
      await importCsv(worker);
      const reads = vi.spyOn(envelopeStoreAdapter, "getEnvelope").mockImplementation(async (id) => { await parked; return read(id); });
      try {
        clock.pending.shift()!();
        await vi.waitFor(() => { expect(reads).toHaveBeenCalledTimes(1); });
        worker.dispose();
        release();
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(reads).toHaveBeenCalledTimes(1);
        expect(clock.pending).toHaveLength(0);
      } finally { reads.mockRestore(); }
    } finally { release(); worker.dispose(); await resetLocalDatabase(); }
  }, 60_000);

  it("arms no check while locked, rearms on unlock and disarms on reset and disposal", async () => {
    await resetLocalDatabase();
    const clock = manualTimers();
    const passphrase = "lifecycle copper heron meadow";
    const worker = createTestHandler(undefined, undefined, { thresholdCommits: 1, intervalMs: 1, timers: clock.timers }).handler;
    try {
      await ask(worker, { kind: "setup", passphrase });
      expect(clock.pending).toHaveLength(1);
      await ask(worker, { kind: "lock" });
      expect(clock.pending).toHaveLength(0);
      await ask(worker, { kind: "unlock", passphrase });
      expect(clock.pending).toHaveLength(1);
      await ask(worker, { kind: "resetLocked" });
      expect(clock.pending).toHaveLength(0);
      await ask(worker, { kind: "setup", passphrase });
      expect(clock.pending).toHaveLength(1);
      worker.dispose();
      expect(clock.pending).toHaveLength(0);
    } finally { worker.dispose(); await resetLocalDatabase(); }
  }, 60_000);
});
