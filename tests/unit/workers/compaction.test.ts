import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { asStorageId16 } from "../../../src/domain/model/bytes.js";
import { asDomainId } from "../../../src/domain/model/ids.js";
import { tableContexts, toProjectionRecord } from "../../../src/workers/data/app-session.js";
import { decodeRecordPage, encodeRecordPage, type StoredRecordV2 } from "../../../src/import/staging/roots.js";
import type { TableDefV1 } from "../../../src/domain/model/schema.js";
import { AppSessionRegistry } from "../../../src/workers/data/app-session.js";
import { prepareCompaction } from "../../../src/workers/data/compaction.js";
import { envelopeCryptoAdapter, envelopeStoreAdapter } from "../../../src/workers/data/import-handlers.js";
import { ask, createTestHandler, importDemoApp, readClearBootstrapRow, realEntropy, resetLocalDatabase } from "./data-worker.js";

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
