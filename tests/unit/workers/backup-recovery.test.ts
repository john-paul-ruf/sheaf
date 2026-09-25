import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { ask, createTestHandler, importDemoApp, resetLocalDatabase, realEntropy } from "./data-worker.js";
import { envelopeCryptoAdapter, envelopeStoreAdapter } from "../../../src/workers/data/import-handlers.js";
import { createVaultCrypto } from "../../../src/crypto/vault-port.js";
import { decodeDomainId } from "../../../src/domain/model/ids.js";
import { encodeBase64Url } from "../../../src/domain/model/bytes.js";
import { sha256Chunks } from "../../../src/crypto/hash.js";
import { buildPublicationCandidate, readPublicationCandidate, readPublicationObject } from "../../../src/sync/protocol/publication.js";
import { bundleChunks } from "../../../src/sync/providers/bundle/format.js";
import { openBundle } from "../../../src/sync/providers/bundle/reader.js";
import { recoverBackupGraph, openBackupGraphProjection } from "../../../src/workers/data/backup-graph.js";
import { AppSessionRegistry } from "../../../src/workers/data/app-session.js";
import { prepareCompaction } from "../../../src/workers/data/compaction.js";
import { executeQuery } from "../../../src/persistence/projection/index.js";
import { decodeCanonical, type CborValue } from "../../../src/persistence/codecs/canonical-cbor.js";

it.each([false, true])("recovers every authored branch from vault-only bytes (compacted=%s), rejects incomplete artifacts and destroys decoder keys", async (compacted) => {
  await resetLocalDatabase();
  const worker = createTestHandler().handler;
  const vaultCrypto = createVaultCrypto(realEntropy);
  const ports = { crypto: envelopeCryptoAdapter, vaultCrypto, entropy: realEntropy, hashChunks: sha256Chunks };
  const signal = new AbortController().signal;
  const passphrase = "artifact cedar lantern river";
  const registered = vi.spyOn(AppSessionRegistry.prototype, "set");
  try {
    const local = await ask(worker, { kind: "setup", passphrase: "device copper heron meadow" });
    const appId = await importDemoApp(worker);
    const assigned = await worker.backup.createBundleHome(appId, "Artifact", passphrase);
    const structure = (await ask(worker, { kind: "getAppStructure", appId })).structure!;
    const jobs = structure.tables.find((table) => table.displayName === "Jobs")!;
    const status = jobs.fields.find((field) => field.displayName === "Status")!.fieldId;
    const change = { kind: "rename-table" as const, tableId: jobs.tableId, name: "Recovered jobs" };
    const preview = (await ask(worker, { kind: "previewSchemaChange", appId, change })).preview!;
    expect((await ask(worker, { kind: "applySchemaChange", appId, change, previewedSchemaRevision: preview.schemaRevision })).outcome.result).toBe("applied");
    expect((await ask(worker, { kind: "changeTheme", appId, themeKey: "indigo", mode: "dark", density: "compact", customAccent: null, logo: { kind: "keep" } })).outcome.result).toBe("changed");
    expect((await ask(worker, { kind: "saveChart", appId, chartId: null, expectedRevision: null, definition: {
      name: "Recovered chart", tableId: jobs.tableId, filters: [], pinned: true, type: "bar",
      groupBy: { kind: "field", fieldId: status }, seriesBy: null, measure: { kind: "count" }, sort: "category",
    } })).outcome.result).toBe("saved");
    const pin = await worker.backup.pin(appId);
    const exported = await worker.backup.exportGraph(assigned.homeId, pin.operationId, signal);
    const session = registered.mock.calls.at(-1)![1];
    const history = session.projection.execute({ kind: "page-change-history", after: null, limit: 128 });
    const prepared = compacted ? await prepareCompaction({ crypto: envelopeCryptoAdapter, store: envelopeStoreAdapter, entropy: realEntropy }, session, 1000n, signal) : undefined;
    let graph = prepared?.graph ?? exported.graph;
    let baselineRows: unknown;
    if (prepared !== undefined) {
      const { asStorageId16, decodeStorageId16 } = await import("../../../src/domain/model/bytes.js");
      const { sha256 } = await import("../../../src/crypto/hash.js");
      const { encodeCanonical } = await import("../../../src/persistence/codecs/canonical-cbor.js");
      const { encodeBaselinePage, decodeBaselinePage, encodeAppHead, encodeAppHeadBody } = await import("../../../src/import/staging/roots.js");
      const { exportBackupGraph } = await import("../../../src/workers/data/backup-graph.js");
      const { selectRows } = await import("../../../src/persistence/projection/engine.js");
      const { readClearBootstrapRow, countEnvelopeRows } = await import("./data-worker.js");
      const installed = await readClearBootstrapRow(); const count = await countEnvelopeRows();
      const refs = prepared.head.baselinePages;
      const frames = new Map(prepared.frames.map((frame) => [encodeBase64Url(frame.storageId), frame]));
      const store = { getEnvelope: async (id: Parameters<typeof envelopeStoreAdapter.getEnvelope>[0]) => frames.get(encodeBase64Url(id)) ?? envelopeStoreAdapter.getEnvelope(id) };
      const first = refs[0]!;
      const legacyFrame = (await store.getEnvelope(decodeStorageId16(first.storageId)))!;
      const legacy = decodeBaselinePage((await envelopeCryptoAdapter.open(legacyFrame, "app.baselines", session.appKey, "app.baseline-page")).payload);
      if (legacy.pageVersion !== 1) throw new Error("expected original baseline");
      const scope = { scopeId: legacy.scopeId, scopeKind: "durable-home" as const, importLineageId: null,
        durableHomeId: decodeDomainId("home", assigned.homeId), counterpartId: new Uint8Array(16).fill(201),
        establishedGeneration: BigInt(Number.MAX_SAFE_INTEGER), establishedFrontier: prepared.head.frontier, establishedAtMs: Number.MAX_SAFE_INTEGER };
      const page = { pageVersion: 2 as const, appId: prepared.head.appId, scope,
        entries: legacy.entries.map((entry, index) => ({ ...entry,
          values: index < 2 ? null : [...entry.values].sort((a, b) => Buffer.compare(a.fieldId, b.fieldId)),
          state: index === 0 ? "absent" as const : index === 1 ? "deleted" as const : "present" as const,
          absentReason: index === 0 ? "never-shared" : null, sourceFrontier: prepared.head.frontier })) };
      const clear = encodeBaselinePage(page);
      const sealVariant = async (payload: Uint8Array) => {
        frames.set(first.storageId, await envelopeCryptoAdapter.seal({ ...legacyFrame, storageId: asStorageId16(legacyFrame.storageId),
          scope: "app.baselines", payloadKind: "app.baseline-page", key: session.appKey, compression: "none", payload }));
        const body = { ...prepared.head, baselinePages: [{ ...first, semanticSha256: await sha256(payload) }, ...refs.slice(1)] };
        const head = { ...body, semanticSha256: await sha256(encodeAppHeadBody(body)) };
        frames.set(prepared.headStorageId, await envelopeCryptoAdapter.seal({ storageId: decodeStorageId16(prepared.headStorageId),
          logicalRevision: 1000n, scope: "app.head", payloadKind: "app.head", key: session.appKey, compression: "none", payload: encodeAppHead(head) }));
        return exportBackupGraph({ crypto: envelopeCryptoAdapter, store }, session.appKey, { appId, headStorageId: prepared.headStorageId }, signal);
      };
      for (const unsupported of [BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1n << 63n]) {
        const raw = decodeCanonical(clear) as Map<string, CborValue>;
        (raw.get("scope") as Map<string, CborValue>).set("establishedGeneration", unsupported);
        const bytes = encodeCanonical(raw);
        await expect(sealVariant(bytes)).rejects.toThrow();
        expect(encodeCanonical(raw)).toEqual(bytes);
        expect(await readClearBootstrapRow()).toEqual(installed);
        expect(await countEnvelopeRows()).toBe(count);
        expect((await worker.backup.read(assigned.homeId)).lastSuccessfulBackupMs).toBeNull();
      }
      graph = await sealVariant(clear);
      const opened = await openBackupGraphProjection(graph, signal);
      try {
        baselineRows = [selectRows(opened.handle, "SELECT * FROM baseline_scopes ORDER BY 1"), selectRows(opened.handle, "SELECT * FROM baseline_records ORDER BY 1,2,3")];
        expect(selectRows(opened.handle, "SELECT established_generation, established_at_ms FROM baseline_scopes WHERE baseline_scope_id = ?", [legacy.scopeId]))
          .toEqual([[Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]]);
        expect(selectRows(opened.handle, "SELECT baseline_state, absent_reason FROM baseline_records WHERE baseline_scope_id = ? ORDER BY table_id, record_id LIMIT 2", [legacy.scopeId]))
          .toEqual([["absent", "never-shared"], ["deleted", null]]);
      } finally { opened.dispose(); }
    }
    const state = await worker.backup.read(assigned.homeId);
    const vaultKey = await vaultCrypto.openWithPassphrase(passphrase, decodeDomainId("vault", assigned.vaultId), state.secrets.passphraseKdf, state.secrets.passphraseWrappedVaultKey);
    let artifact: Blob;
    const incomplete: Blob[] = [];
    let expectedHash: Uint8Array;
    try {
      const candidate = await buildPublicationCandidate({ base: { kind: "create", secrets: state.secrets },
        vaultId: decodeDomainId("vault", assigned.vaultId), homeId: decodeDomainId("home", assigned.homeId),
        appKey: exported.appKey, vaultKey, graph, app: { displayName: "Artifact", appSchemaRevision: 2n }, committedAtMs: 1000n,
      }, ports, signal);
      const contents = readPublicationCandidate(candidate);
      expectedHash = contents.manifest.semanticSha256;
      const assemble = async (omit?: string) => {
        const parts: BlobPart[] = [];
        for await (const bytes of bundleChunks({ ...contents, objects: contents.objects.filter(({ id }) => id !== omit),
          read: (id, readSignal) => readPublicationObject(candidate, id, readSignal) }, signal)) parts.push(bytes as Uint8Array<ArrayBuffer>);
        return new Blob(parts);
      };
      artifact = await assemble();
      for (const kind of ["app.record-page", "app.baseline-page", "app.source-chunk", "app.snapshot-chunk", "app.event-segment"] as const) {
        const object = graph.objects.find((entry) => entry.payloadKind === kind)!;
        expect(object, kind).toBeDefined();
        incomplete.push(await assemble(encodeBase64Url(object.reference.storageId)));
      }
    } finally { vaultCrypto.destroy(vaultKey); exported.dispose(); }
    worker.dispose(); await resetLocalDatabase();
    const noLocalReads = vi.spyOn(envelopeStoreAdapter, "getEnvelope").mockRejectedValue(new Error("decoder touched local storage"));
    try {
      for (const secret of [{ kind: "passphrase" as const, value: passphrase }, { kind: "recovery" as const, value: assigned.recoveryCode }]) {
        const controller = new AbortController();
        const bundle = await openBundle(artifact, secret, ports, controller.signal);
        const app = await bundle.openApp(decodeDomainId("app", appId));
        try {
          const graph = await recoverBackupGraph(ports.crypto, app, controller.signal);
          const projection = await openBackupGraphProjection(graph, controller.signal);
          try {
            expect(executeQuery(projection.handle, { kind: "page-change-history", after: null, limit: 128 })).toEqual(history);
            if (baselineRows !== undefined) {
              const { selectRows } = await import("../../../src/persistence/projection/engine.js");
              expect([selectRows(projection.handle, "SELECT * FROM baseline_scopes ORDER BY 1"), selectRows(projection.handle, "SELECT * FROM baseline_records ORDER BY 1,2,3")]).toEqual(baselineRows);
            }
          }
          finally { projection.dispose(); }
          expect(await sha256Chunks(graph.canonicalAuthoredState(signal))).toEqual(expectedHash);
          expect(graph.manifest.confirmedFrontier).toEqual(app.manifest.confirmedFrontier);
          const parts: number[] = [];
          for await (const bytes of graph.canonicalAuthoredState(signal)) parts.push(...bytes);
          const authored = decodeCanonical(Uint8Array.from(parts)) as ReadonlyMap<string, CborValue>;
          for (const name of ["fields", "tables", "charts", "sheets", "baselines", "lineages", "records"]) expect((authored.get(name) as readonly CborValue[]).length, name).toBeGreaterThan(0);
          expect(JSON.stringify(authored.get("tables"), (_, value: unknown) => typeof value === "bigint" ? String(value) : value)).toContain("Recovered jobs");
          const appRow = (authored.get("app") as readonly (readonly CborValue[])[])[0]!;
          const theme = decodeCanonical(appRow[4] as Uint8Array) as ReadonlyMap<string, CborValue>;
          expect(theme.get("themeKey")).toBe("indigo"); expect(theme.get("mode")).toBe("dark");
          expect(JSON.stringify(authored.get("charts"), (_, value: unknown) => typeof value === "bigint" ? String(value) : value)).toContain("Recovered chart");
          await expect(recoverBackupGraph(ports.crypto, { ...app, manifest: { ...app.manifest, semanticSha256: new Uint8Array(32) } }, signal)).rejects.toThrow("mismatch");
          await expect(recoverBackupGraph(ports.crypto, { ...app, manifest: { ...app.manifest, baselinePages: [] } }, signal)).rejects.toThrow("mismatch");
          const checkpointFrame = await app.readFrame(app.manifest.checkpoint.storageId);
          controller.abort();
          await expect(app.read(app.manifest.checkpoint, "app.checkpoint-manifest")).rejects.toThrow();
          await expect(ports.crypto.open(checkpointFrame, "app.checkpoint", app.appKey, "app.checkpoint-manifest")).rejects.toThrow();
        } finally { bundle.close(); bundle.close(); }
      }
      for (const broken of [...incomplete, artifact.slice(0, artifact.size - 1)]) {
        await expect((async () => {
          const bundle = await openBundle(broken, { kind: "passphrase", value: passphrase }, ports, signal);
          try { await recoverBackupGraph(ports.crypto, await bundle.openApp(decodeDomainId("app", appId)), signal); }
          finally { bundle.close(); }
        })()).rejects.toThrow();
      }
      await expect(openBundle(artifact, { kind: "recovery", value: local.recoveryCode }, ports, signal)).rejects.toThrow();
      expect(noLocalReads).not.toHaveBeenCalled();
    } finally { noLocalReads.mockRestore(); }
  } finally { registered.mockRestore(); worker.dispose(); await resetLocalDatabase(); }
}, 120_000);

it("publishes a nonempty original conflict/merge candidate and recovers its SQL evidence from vault-only bytes", async () => {
  const { asStorageId16, decodeStorageId16, constantTimeEquals } = await import("../../../src/domain/model/bytes.js");
  const { asDomainId, compareDomainIds } = await import("../../../src/domain/model/ids.js");
  const { sha256 } = await import("../../../src/crypto/hash.js");
  const { encodeCanonical } = await import("../../../src/persistence/codecs/canonical-cbor.js");
  const { encodeEventSegment, sealEventCommit } = await import("../../../src/persistence/codecs/event-commit.js");
  const { encodeAuthoredRecordBytes, encodeRecordEventPayload } = await import("../../../src/workers/data/record-event-payloads.js");
  const { evidenceRecordBytes } = await import("../../../src/persistence/projection/evidence-events.js");
  const { authoredRecords, checkpointMetadata } = await import("../../../src/persistence/projection/index.js");
  const { selectRows } = await import("../../../src/persistence/projection/engine.js");
  const { decodeBaselinePage, encodeAppHead, encodeAppHeadBody } = await import("../../../src/import/staging/roots.js");
  const { exportBackupGraph } = await import("../../../src/workers/data/backup-graph.js");
  const { engineAdapter } = await import("../../../src/workers/data/app-session.js");
  const { loadApp } = await import("../../../src/workers/data/event-store.js");
  await resetLocalDatabase();
  const worker = createTestHandler().handler;
  const registered = vi.spyOn(AppSessionRegistry.prototype, "set");
  const vaultCrypto = createVaultCrypto(realEntropy);
  const ports = { crypto: envelopeCryptoAdapter, vaultCrypto, entropy: realEntropy, hashChunks: sha256Chunks };
  const signal = new AbortController().signal;
  const passphrase = "original evidence vault secret";
  const id = (n: number) => new Uint8Array(16).fill(n);
  const map = (entries: readonly (readonly [string, CborValue])[]) => new Map<string, CborValue>(entries);
  let candidateProjection: Awaited<ReturnType<typeof openBackupGraphProjection>> | undefined;
  try {
    await ask(worker, { kind: "setup", passphrase: "original evidence local secret" });
    const appId = await importDemoApp(worker);
    const assigned = await worker.backup.createBundleHome(appId, "Original evidence", passphrase);
    await ask(worker, { kind: "openApp", appId });
    const session = registered.mock.calls.at(-1)![1];
    const loaded = session.repository.loaded();
    const rows = [...session.checkpointExport.records(signal)];
    const metadata = session.checkpointExport.checkpoint();
    const table = metadata.tables.find((t) => t.displayName === "Jobs")!;
    const field = table.fields.find((f) => f.type.kind === "text" && !constantTimeEquals(f.fieldId, table.keyFieldId ?? new Uint8Array()))!;
    const row = rows.find((r) => constantTimeEquals(r.record.tableId, table.tableId))!;
    const fieldId = [...row.record.values.keys()].find((f) => constantTimeEquals(f, field.fieldId))!;
    const local = row.record;
    const incoming = { ...local, values: new Map(local.values).set(fieldId, { kind: "text" as const, text: "Original resolution" }),
      provenance: new Map(local.provenance).set(fieldId, { source: "conflict-resolution" as const }) };
    const state = (record: typeof local) => map([["state", "present"], ["value", decodeCanonical(evidenceRecordBytes(record))]]);
    const terminal = loaded.commits.at(-1)!;
    const frontier = (entries: typeof loaded.head.frontier) => entries.map((e) => map([["deviceId", e.deviceId], ["commitSequence", e.commitSequence]]));
    const source = (record: typeof local) => map([["source", "this-device"], ["timestampMs", terminal.hybridTime.wallTimeMs],
      ["commitId", terminal.commitId], ["frontier", frontier(loaded.head.frontier)], ["state", state(record)]]);
    let baseline: Map<string, CborValue> | undefined;
    for (const ref of loaded.head.baselinePages) {
      const frame = (await envelopeStoreAdapter.getEnvelope(decodeStorageId16(ref.storageId)))!;
      const page = decodeBaselinePage((await envelopeCryptoAdapter.open(frame, "app.baselines", session.appKey, "app.baseline-page")).payload);
      if (page.pageVersion !== 1) throw new Error("expected original V1 baseline");
      const entry = page.entries.find((r) => constantTimeEquals(r.recordId, local.recordId));
      if (entry === undefined) continue;
      const { encodeCellValue } = await import("../../../src/import/staging/roots.js");
      baseline = map([["scopeId", page.scopeId], ["state", entry.state], ["values", [...entry.values].sort((a, b) => compareDomainIds(a.fieldId, b.fieldId)).map(({ fieldId, value }) => map([["fieldId", fieldId], ["value", encodeCellValue(value)]]))],
        ["absentReason", null], ["frontier", frontier(loaded.checkpoint.frontier)]]);
    }
    expect(baseline).toBeDefined();
    const report = map([["isValid", true], ["issues", []]]);
    const detection = map([["payloadVersion", 1n], ["conflictId", id(80)], ["tableId", table.tableId], ["targetKind", "record"], ["targetId", local.recordId],
      ["conflictKind", "field"], ["schemaRevision", loaded.head.schemaRevision], ["baseline", baseline!], ["local", source(local)], ["incoming", source(incoming)],
      ["conflictingFields", [fieldId]], ["validationReport", null]]);
    type Wire = (typeof terminal.events)[number];
    const wire = (kind: Wire["kind"], payload: CborValue, eventId: number, objectId?: Uint8Array): Wire => ({ kind, payload: decodeCanonical(encodeCanonical(payload)), eventId: id(eventId), eventIndex: 0,
      subject: { appId: loaded.appId, tableId: table.tableId, recordId: local.recordId, ...(objectId === undefined ? {} : { objectId }) }, provenance: { source: "conflict-resolution" } });
    const patch = wire("record.patched", encodeRecordEventPayload({ kind: "record.patched", payload: { recordId: local.recordId, tableId: table.tableId,
      recordRevision: row.recordRevision + 1n, changes: [{ fieldId, before: local.values.get(fieldId)!, after: incoming.values.get(fieldId)!, provenance: { source: "conflict-resolution" } }],
      resultingRecordSha256: await sha256(encodeAuthoredRecordBytes(incoming)) } }), 82);
    const resolution = map([["payloadVersion", 1n], ["conflictId", id(80)], ["detectedEventId", id(81)], ["decision", "use-incoming"],
      ["result", state(incoming)], ["schemaRevision", loaded.head.schemaRevision], ["validationReport", report], ["effectEventIds", [id(82)]]]);
    let last = terminal;
    let next = 100;
    const commits: typeof terminal[] = [];
    for (const events of [[wire("conflict.detected", detection, 81, id(80))], [patch, wire("conflict.resolved", resolution, 83, id(80))]]) {
      last = await sealEventCommit({ ...last, commitId: id(next++), deviceCommitSequence: last.deviceCommitSequence + 1n, previousDeviceCommitSha256: last.commitSha256,
        basisFrontier: [{ deviceId: last.deviceId, commitSequence: last.deviceCommitSequence }], hybridTime: { wallTimeMs: last.hybridTime.wallTimeMs + 1n, logicalCounter: 0 },
        eventClass: "reconciliation", events: events.map((e, eventIndex) => ({ ...e, eventIndex })) }, sha256);
      commits.push(last);
    }
    const merge = map([["payloadVersion", 1n], ["mergeId", id(90)], ["tableId", table.tableId], ["recordId", local.recordId], ["schemaRevision", loaded.head.schemaRevision],
      ["baseline", baseline!], ["local", source(incoming)], ["incoming", source(incoming)], ["localChangedFields", [fieldId]], ["incomingChangedFields", [fieldId]],
      ["result", decodeCanonical(evidenceRecordBytes(incoming))], ["resultCommitId", id(next)], ["validationReport", report],
      ["explanation", map([["messageKey", "merge.equal"], ["messageParameters", map([])]])], ["effectEventIds", []]]);
    last = await sealEventCommit({ ...last, commitId: id(next), deviceCommitSequence: last.deviceCommitSequence + 1n, previousDeviceCommitSha256: last.commitSha256,
      basisFrontier: [{ deviceId: last.deviceId, commitSequence: last.deviceCommitSequence }], hybridTime: { wallTimeMs: last.hybridTime.wallTimeMs + 1n, logicalCounter: 0 },
      events: [wire("merge.applied", merge, 91, id(90))] }, sha256);
    commits.push(last);
    const resultingFrontier = loaded.head.frontier.map((entry) => constantTimeEquals(entry.deviceId, last.deviceId) ? { ...entry, commitSequence: last.deviceCommitSequence } : entry);
    const segmentBytes = encodeEventSegment({ eventFormatVersion: 1, segmentId: id(120), appId: loaded.appId, commits, resultingFrontier,
      semanticSha256: await sha256(Uint8Array.from(commits.flatMap((commit) => [...commit.commitSha256]))) });
    const unique = (number: number) => { const value = new Uint8Array(16).fill(240); new DataView(value.buffer).setUint32(12, number); return value; };
    const extraFrames = new Map<string, Awaited<ReturnType<typeof envelopeCryptoAdapter.seal>>>();
    const extraRefs = [];
    let other: typeof terminal | undefined;
    for (let index = 0; index < 1024; index++) {
      const conflictId = unique(10_000 + index);
      const payload = new Map(detection).set("conflictId", conflictId).set("local", source(incoming));
      const event = { ...wire("conflict.detected", payload, 0, conflictId), eventId: unique(20_000 + index) };
      const commit = await sealEventCommit({ ...last, commitId: unique(30_000 + index), deviceId: id(150), deviceCommitSequence: BigInt(index + 1),
        previousDeviceCommitSha256: other?.commitSha256 ?? null,
        basisFrontier: [...resultingFrontier, ...(index === 0 ? [] : [{ deviceId: id(150), commitSequence: BigInt(index) }])].sort((a, b) => compareDomainIds(a.deviceId, b.deviceId)),
        hybridTime: { wallTimeMs: last.hybridTime.wallTimeMs + BigInt(index + 1), logicalCounter: 0 }, events: [event] }, sha256);
      other = commit;
      const bytes = encodeEventSegment({ eventFormatVersion: 1, segmentId: unique(40_000 + index), appId: loaded.appId, commits: [commit],
        resultingFrontier: [...resultingFrontier, { deviceId: id(150), commitSequence: commit.deviceCommitSequence }].sort((a, b) => compareDomainIds(a.deviceId, b.deviceId)), semanticSha256: await sha256(commit.commitSha256) });
      const extra = await envelopeCryptoAdapter.seal({ key: session.appKey, storageId: asStorageId16(unique(40_000 + index)), scope: "app.events", payloadKind: "app.event-segment", logicalRevision: 1000n, compression: "none", payload: bytes });
      extraFrames.set(encodeBase64Url(extra.storageId), extra);
      extraRefs.push({ storageId: encodeBase64Url(extra.storageId), semanticSha256: await sha256(bytes) });
    }
    const frame = await envelopeCryptoAdapter.seal({ key: session.appKey, storageId: asStorageId16(id(120)), scope: "app.events", payloadKind: "app.event-segment", logicalRevision: 1000n,
      compression: "none", payload: segmentBytes });
    const headBody = { ...loaded.head, headRevision: loaded.head.headRevision + 1n,
      eventSegments: [...loaded.head.eventSegments, { storageId: encodeBase64Url(frame.storageId), semanticSha256: await sha256(segmentBytes) }, ...extraRefs],
      frontier: [...resultingFrontier, { deviceId: id(150), commitSequence: 1024n }].sort((a, b) => compareDomainIds(a.deviceId, b.deviceId)) };
    const head = { ...headBody, semanticSha256: await sha256(encodeAppHeadBody(headBody)) };
    const headFrame = await envelopeCryptoAdapter.seal({ key: session.appKey, storageId: asStorageId16(id(121)), scope: "app.head", payloadKind: "app.head", logicalRevision: 1000n,
      compression: "none", payload: encodeAppHead(head) });
    const store = { ...envelopeStoreAdapter, getEnvelope: (requested: Parameters<typeof envelopeStoreAdapter.getEnvelope>[0]) =>
      constantTimeEquals(requested, frame.storageId) ? Promise.resolve(frame) : constantTimeEquals(requested, headFrame.storageId) ? Promise.resolve(headFrame) : extraFrames.has(encodeBase64Url(requested)) ? Promise.resolve(extraFrames.get(encodeBase64Url(requested))) : envelopeStoreAdapter.getEnvelope(requested) };
    const fixturePorts = { crypto: envelopeCryptoAdapter, store, entropy: realEntropy };
    const originalGraph = await exportBackupGraph(fixturePorts, session.appKey, { appId, headStorageId: encodeBase64Url(headFrame.storageId) }, signal);
    candidateProjection = await openBackupGraphProjection(originalGraph, signal);
    const originalHandle = candidateProjection.handle;
    const fixtureLoaded = await loadApp(fixturePorts, session.appKey, encodeBase64Url(headFrame.storageId));
    const fixtureSession = { ...session, projection: engineAdapter(originalHandle), repository: { ...session.repository, loaded: () => fixtureLoaded },
      checkpointExport: { checkpoint: () => checkpointMetadata(originalHandle, metadata), records: (readSignal: AbortSignal) => authoredRecords(originalHandle, readSignal) } };
    let physicalId = 60_000;
    const candidate = await prepareCompaction({ ...fixturePorts, entropy: { randomBytes: (length) => length === 16 ? unique(physicalId--) : realEntropy.randomBytes(length) } }, fixtureSession, 1001n, signal);
    expect(candidate.head.conflictPages).toHaveLength(2);
    expect(candidate.head.auditPages).toHaveLength(2);
    for (const branch of ["auditPages", "conflictPages"] as const) {
      expect(compareDomainIds(decodeStorageId16(candidate.head[branch][0]!.storageId), decodeStorageId16(candidate.head[branch][1]!.storageId))).toBeGreaterThan(0);
      const reversedBody = { ...candidate.head, [branch]: [...candidate.head[branch]].reverse() };
      const reversed = await envelopeCryptoAdapter.seal({ key: session.appKey, storageId: asStorageId16(unique(70_000)), scope: "app.head", payloadKind: "app.head", logicalRevision: 1002n,
        compression: "none", payload: encodeAppHead({ ...reversedBody, semanticSha256: await sha256(encodeAppHeadBody(reversedBody)) }) });
      const frames = new Map(candidate.frames.map((f) => [encodeBase64Url(f.storageId), f]));
      frames.set(encodeBase64Url(reversed.storageId), reversed);
      await expect(exportBackupGraph({ ...fixturePorts, store: { ...store, getEnvelope: (id) => frames.has(encodeBase64Url(id)) ? Promise.resolve(frames.get(encodeBase64Url(id))) : store.getEnvelope(id) } },
        session.appKey, { appId, headStorageId: encodeBase64Url(reversed.storageId) }, signal)).rejects.toThrow(/order|overlap|reverse/);
    }
    const sql = ["baseline_scopes", "baseline_records", "pending_conflicts", "applied_merges", "change_history"];
    const expected = sql.map((table) => selectRows(originalHandle, `SELECT * FROM ${table} ORDER BY 1, 2`));
    expect(selectRows(originalHandle, "SELECT status, count(*) FROM pending_conflicts GROUP BY status ORDER BY status")).toEqual([["pending", 1024], ["resolved", 1]]);
    expect(selectRows(originalHandle, "SELECT merge_id FROM applied_merges")).toEqual([[id(90)]]);
    const stateHome = await worker.backup.read(assigned.homeId);
    const vaultKey = await vaultCrypto.openWithPassphrase(passphrase, decodeDomainId("vault", assigned.vaultId), stateHome.secrets.passphraseKdf, stateHome.secrets.passphraseWrappedVaultKey);
    let artifact: Blob;
    try {
      const published = await buildPublicationCandidate({ base: { kind: "create", secrets: stateHome.secrets }, vaultId: decodeDomainId("vault", assigned.vaultId),
        homeId: decodeDomainId("home", assigned.homeId), appKey: session.appKey, vaultKey, graph: candidate.graph,
        app: { displayName: "Original evidence", appSchemaRevision: loaded.head.schemaRevision }, committedAtMs: 2000n }, ports, signal);
      const contents = readPublicationCandidate(published); const parts: BlobPart[] = [];
      for await (const bytes of bundleChunks({ ...contents, read: (id, readSignal) => readPublicationObject(published, id, readSignal) }, signal)) parts.push(bytes as Uint8Array<ArrayBuffer>);
      artifact = new Blob(parts);
    } finally { vaultCrypto.destroy(vaultKey); }
    candidateProjection.dispose(); candidateProjection = undefined;
    worker.dispose(); await resetLocalDatabase();
    const noLocal = vi.spyOn(envelopeStoreAdapter, "getEnvelope").mockRejectedValue(new Error("vault decoder touched local storage"));
    try {
      const bundle = await openBundle(artifact, { kind: "passphrase", value: passphrase }, ports, signal);
      try {
        const graph = await recoverBackupGraph(ports.crypto, await bundle.openApp(loaded.appId), signal);
        const recovered = await openBackupGraphProjection(graph, signal);
        try {
          expect(sql.map((table) => selectRows(recovered.handle, `SELECT * FROM ${table} ORDER BY 1, 2`))).toEqual(expected);
          const recoveredRow = [...authoredRecords(recovered.handle, signal)].find((r) => constantTimeEquals(r.record.recordId, local.recordId))!;
          expect(recoveredRow.recordRevision).toBe(row.recordRevision + 1n);
          expect(evidenceRecordBytes(recoveredRow.record)).toEqual(evidenceRecordBytes(incoming));
          expect(recoveredRow.updatedCommitId).toEqual(asDomainId("commit", commits[1]!.commitId));
        } finally { recovered.dispose(); }
      } finally { bundle.close(); }
      expect(noLocal).not.toHaveBeenCalled();
    } finally { noLocal.mockRestore(); }
  } finally { candidateProjection?.dispose(); registered.mockRestore(); worker.dispose(); await resetLocalDatabase(); }
}, 120_000);
