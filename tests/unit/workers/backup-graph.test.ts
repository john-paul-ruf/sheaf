import "fake-indexeddb/auto";
import { decodeCanonical, type CborValue } from "../../../src/persistence/codecs/canonical-cbor.js";
import { decodeAuthoredRecord } from "../../../src/persistence/projection/cbor-values.js";
import { decodeEventSegment, encodeEventSegment, sealEventCommit } from "../../../src/persistence/codecs/event-commit.js";
import { openLocalDatabase } from "../../../src/persistence/envelope-store/db.js";
import { frameToRow } from "../../../src/persistence/envelope-store/frame-row.js";
import { loadApp } from "../../../src/workers/data/event-store.js";
import * as projection from "../../../src/persistence/projection/index.js";
import { DurableHomeDouble } from "../../provider-contract/shared/double.js";
import { asStorageId16, decodeStorageId16, encodeBase64Url } from "../../../src/domain/model/bytes.js";
import { decodeAppHead, encodeAppHead, encodeAppHeadBody, decodeBaselinePage, encodeBaselinePage, encodeAuditPage } from "../../../src/import/staging/roots.js";
import { exportBackupGraph } from "../../../src/workers/data/backup-graph.js";
import { expect, it, vi } from "vitest";
import { ask, createTestHandler, importDemoApp, resetLocalDatabase, realEntropy, readClearBootstrapRow, countEnvelopeRows } from "./data-worker.js";
import { sha256, sha256Chunks } from "../../../src/crypto/hash.js";
import { createVaultCrypto } from "../../../src/crypto/vault-port.js";
import { decodeDomainId } from "../../../src/domain/model/ids.js";
import { buildPublicationCandidate, readPublicationCandidate, readPublicationObject, publishCandidate } from "../../../src/sync/protocol/publication.js";
import { envelopeCryptoAdapter, envelopeStoreAdapter } from "../../../src/workers/data/import-handlers.js";

it("exports and hashes the pinned workbook while edits advance the current head", async () => {
  await resetLocalDatabase();
  const worker = createTestHandler().handler;
  const signal = new AbortController().signal;
  const vaultCrypto = createVaultCrypto(realEntropy);
  try {
    await ask(worker, { kind: "setup", passphrase: "local graph test passphrase" });
    const appId = await importDemoApp(worker);
    const assigned = await worker.backup.createBundleHome(appId, "Graph test", "vault graph test passphrase");
    const pin = await worker.backup.pin(appId);
    const exported = await worker.backup.exportGraph(assigned.homeId, pin.operationId, signal);
    try {
      const before = await sha256Chunks(exported.graph.canonicalAuthoredState(signal));
      const frame = (await envelopeStoreAdapter.getEnvelope(decodeStorageId16(pin.headStorageId)))!;
      const originalHead = decodeAppHead((await envelopeCryptoAdapter.open(frame, "app.head", exported.appKey, "app.head")).payload);
      const withRetained = { ...originalHead, headVersion: 1 as const, retainedRoots: [originalHead.checkpoint] };
      const scopedHead = await envelopeCryptoAdapter.seal({ scope: "app.head", payloadKind: "app.head", key: exported.appKey,
        storageId: decodeStorageId16(pin.headStorageId), logicalRevision: frame.logicalRevision, compression: "none",
        payload: encodeAppHead({ ...withRetained, semanticSha256: await sha256(encodeAppHeadBody(withRetained)) }) });
      const aliased = await exportBackupGraph({ crypto: envelopeCryptoAdapter, store: { ...envelopeStoreAdapter,
        getEnvelope: (id) => encodeBase64Url(id) === pin.headStorageId ? Promise.resolve(scopedHead) : envelopeStoreAdapter.getEnvelope(id),
      } }, exported.appKey, pin, signal);
      expect(await sha256Chunks(aliased.canonicalAuthoredState(signal))).toEqual(before);
      expect(exported.graph.objects.length).toBeGreaterThan(10);
      expect(exported.graph.objects.some((entry) => entry.payloadKind === "app.source-chunk")).toBe(true);
      expect(exported.graph.objects.some((entry) => entry.payloadKind === "app.snapshot-chunk")).toBe(true);
      expect(exported.graph.manifest.baselinePages.length).toBeGreaterThan(0);
      await ask(worker, { kind: "changeTheme", appId, themeKey: "indigo", mode: "light", density: "compact", customAccent: null, logo: { kind: "keep" } });
      expect(await sha256Chunks(exported.graph.canonicalAuthoredState(signal))).toEqual(before);
      const next = await worker.backup.pin(appId);
      const changed = await worker.backup.exportGraph(assigned.homeId, next.operationId, signal);
      try {
        expect(await sha256Chunks(changed.graph.canonicalAuthoredState(signal))).not.toEqual(before);
        expect(changed.graph.deviceChains[0]!.commitSequence).toBe(exported.graph.deviceChains[0]!.commitSequence + 1n);
      } finally { changed.dispose(); await worker.backup.release(assigned.homeId, next.operationId); }
      const state = await worker.backup.read(assigned.homeId);
      const vaultKey = await vaultCrypto.openWithPassphrase("vault graph test passphrase", decodeDomainId("vault", assigned.vaultId), state.secrets.passphraseKdf, state.secrets.passphraseWrappedVaultKey);
      try {
        const ports = { crypto: envelopeCryptoAdapter, vaultCrypto, entropy: realEntropy, hashChunks: sha256Chunks };
        const input = { base: { kind: "create" as const, secrets: state.secrets }, vaultId: decodeDomainId("vault", assigned.vaultId),
          homeId: decodeDomainId("home", assigned.homeId), appKey: exported.appKey, vaultKey, graph: exported.graph,
          app: { displayName: "Graph test", appSchemaRevision: 1n }, committedAtMs: 1000n };
        const candidate = readPublicationCandidate(await buildPublicationCandidate(input, ports, signal));
        expect(candidate.manifest.semanticSha256).toEqual(before);
        expect(candidate.snapshot.confirmedFrontier).toEqual(exported.graph.manifest.confirmedFrontier);
        for (const missing of exported.graph.objects) {
          await expect(buildPublicationCandidate({ ...input, graph: { ...exported.graph,
            objects: exported.graph.objects.filter((object) => object !== missing),
          } }, ports, signal), missing.payloadKind).rejects.toThrow(/missing/);
        }
        const first = exported.graph.objects[0]!;
        await expect(buildPublicationCandidate({ ...input, graph: { ...exported.graph, objects: [...exported.graph.objects, first] } }, ports, signal)).rejects.toThrow(/duplicate/);
        for (const reference of [{ ...first.reference, scope: "app.events" as const }, { ...first.reference, ciphertextSha256: new Uint8Array(32) }]) {
          await expect(buildPublicationCandidate({ ...input, graph: { ...exported.graph,
            objects: [{ ...first, reference }, ...exported.graph.objects.slice(1)],
          } }, ports, signal)).rejects.toThrow(/substitution/);
        }
        const readObject = exported.graph.readObject;
        await expect(buildPublicationCandidate({ ...input, graph: { ...exported.graph, readObject: async (id, signal) => {
          const bytes = await readObject(id, signal); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; return bytes;
        } } }, ports, signal)).rejects.toThrow();
      } finally { vaultCrypto.destroy(vaultKey); }
    } finally { exported.dispose(); await worker.backup.release(assigned.homeId, pin.operationId); }
  } finally { worker.dispose(); }
}, 120_000);


it("owns exporter keys, suspended cursors and candidates across every worker teardown", async () => {
  await resetLocalDatabase();
  let worker = createTestHandler().handler;
  const localSecret = "local lifecycle passphrase";
  const vaultSecret = "vault lifecycle passphrase";
  const signal = new AbortController().signal;
  const vaultCrypto = createVaultCrypto(realEntropy);
  const open = projection.openProjection;
  const handles: projection.ProjectionHandleV1[] = [];
  const opened = vi.spyOn(projection, "openProjection").mockImplementation(async (input) => {
    const handle = await open(input); handles.push(handle); return handle;
  });
  try {
    await ask(worker, { kind: "setup", passphrase: localSecret });
    const appId = await importDemoApp(worker);
    const assigned = await worker.backup.createBundleHome(appId, "Lifecycle", vaultSecret);
    const state = await worker.backup.read(assigned.homeId);
    const vaultKey = await vaultCrypto.openWithPassphrase(vaultSecret, decodeDomainId("vault", assigned.vaultId), state.secrets.passphraseKdf, state.secrets.passphraseWrappedVaultKey);
    try {
      for (const action of ["abort", "release", "lock", "replace", "dispose", "reset-readable"] as const) {
        const pin = await worker.backup.pin(appId);
        const abort = new AbortController();
        const exported = await worker.backup.exportGraph(assigned.homeId, pin.operationId, abort.signal);
        const candidate = await buildPublicationCandidate({ base: { kind: "create", secrets: state.secrets },
          vaultId: decodeDomainId("vault", assigned.vaultId), homeId: decodeDomainId("home", assigned.homeId),
          appKey: exported.appKey, vaultKey, graph: exported.graph, app: { displayName: "Lifecycle", appSchemaRevision: 1n }, committedAtMs: 1000n,
        }, { crypto: envelopeCryptoAdapter, vaultCrypto, entropy: realEntropy, hashChunks: sha256Chunks });
        const metadata = readPublicationCandidate(candidate);
        const frame = (await envelopeStoreAdapter.getEnvelope(decodeStorageId16(pin.headStorageId)))!;
        const cursor = exported.graph.canonicalAuthoredState(signal)[Symbol.asyncIterator]();
        for (let i = 0; i < 30; i++) expect((await cursor.next()).done).toBe(false);
        expect(handles.at(-1)!.disposed).toBe(false);
        const before = await readClearBootstrapRow();
        if (action === "abort") abort.abort();
        if (action === "release") await worker.backup.release(assigned.homeId, pin.operationId);
        if (action === "lock") await ask(worker, { kind: "lock" });
        if (action === "replace") await ask(worker, { kind: "unlock", passphrase: localSecret });
        if (action === "dispose") worker.dispose();
        if (action === "reset-readable") {
          const inventory = await ask(worker, { kind: "resetReadable" });
          if (inventory.phase !== "inventory") throw new Error("expected reset inventory");
          await ask(worker, { kind: "resetReadable", confirmToken: inventory.confirmToken });
        }
        expect(handles.every((handle) => handle.disposed), action).toBe(true);
        expect(exported.graph.signal.aborted, action).toBe(true);
        await expect(envelopeCryptoAdapter.open(frame, "app.head", exported.appKey, "app.head")).rejects.toThrow(/authentication/);
        await expect(cursor.next()).rejects.toThrow();
        await expect(exported.graph.readObject(frame.storageId, signal)).rejects.toThrow();
        await expect(readPublicationObject(candidate, metadata.objects.at(-1)!.id, signal)).rejects.toThrow();
        const home = new DurableHomeDouble();
        const upload = vi.spyOn(home, "createObject");
        await expect(publishCandidate(candidate, home, signal, envelopeCryptoAdapter)).rejects.toThrow();
        expect(upload).not.toHaveBeenCalled();
        expect(await home.readHead(signal)).toBeNull();
        exported.dispose(); exported.dispose();
        if (action === "reset-readable") {
          expect(await readClearBootstrapRow()).toBeUndefined();
        } else {
          if (action !== "release") expect(await readClearBootstrapRow()).toEqual(before);
          if (action === "dispose") worker = createTestHandler().handler;
          if (action === "lock" || action === "dispose") await ask(worker, { kind: "unlock", passphrase: localSecret });
          if (action !== "release") await worker.backup.release(assigned.homeId, pin.operationId);
        }
      }
    } finally { vaultCrypto.destroy(vaultKey); }
    await ask(worker, { kind: "setup", passphrase: localSecret });
    const secondApp = await importDemoApp(worker);
    const secondHome = await worker.backup.createBundleHome(secondApp, "Locked reset", vaultSecret);
    const pin = await worker.backup.pin(secondApp);
    const exported = await worker.backup.exportGraph(secondHome.homeId, pin.operationId, signal);
    await ask(worker, { kind: "resetLocked" });
    expect(exported.graph.signal.aborted).toBe(true);
    expect(await readClearBootstrapRow()).toBeUndefined();
  } finally { opened.mockRestore(); worker.dispose(); await resetLocalDatabase(); }
}, 120_000);


it("covers every current graph branch, bounds pinning, and preserves rejected roots across restart", async () => {
  await resetLocalDatabase();
  let worker = createTestHandler().handler;
  const signal = new AbortController().signal;
  const passphrase = "local closure passphrase";
  const getEnvelope = envelopeStoreAdapter.getEnvelope.bind(envelopeStoreAdapter);
  try {
    await ask(worker, { kind: "setup", passphrase });
    const appId = await importDemoApp(worker);
    const assigned = await worker.backup.createBundleHome(appId, "Closure", "closure vault passphrase");
    const pin = await worker.backup.pin(appId);
    let previous: Awaited<ReturnType<typeof getEnvelope>>;
    let reads = 0;
    const batches = vi.spyOn(envelopeStoreAdapter, "getEnvelope").mockImplementation(async (id) => {
      previous?.ciphertext.fill(0);
      previous = await getEnvelope(id);
      reads++;
      return previous;
    });
    const exported = await worker.backup.exportGraph(assigned.homeId, pin.operationId, signal);
    const graph = exported.graph;
    expect(reads).toBeGreaterThan(10);
    expect(await sha256Chunks(graph.canonicalAuthoredState(signal))).toHaveLength(32);
    // A collector using these same real-store batches retains invalidated bytes.
    const firstBatch = await envelopeStoreAdapter.getEnvelope(decodeStorageId16(pin.headStorageId));
    await envelopeStoreAdapter.getEnvelope(decodeStorageId16(pin.headStorageId));
    expect(firstBatch!.ciphertext.every((byte) => byte === 0)).toBe(true);
    batches.mockRestore();
    const ids = new Set(graph.objects.map((object) => encodeBase64Url(object.reference.storageId)));
    expect(ids.size).toBe(graph.objects.length);
    const kinds = new Set(graph.objects.map((object) => object.payloadKind));
    expect([...kinds].sort()).toEqual(["app.head", "app.checkpoint-manifest", "app.record-page", "app.event-segment",
      "app.baseline-page", "app.source-manifest", "app.source-chunk", "app.snapshot-manifest", "app.snapshot-chunk"].sort());
    expect(graph.manifest.retainedRoots.map((ref) => encodeBase64Url(ref.storageId))).toEqual([pin.headStorageId]);
    expect(graph.checkpointChains[0]!.commitSequence).toBe(1n);
    expect(graph.deviceChains[0]!.commitSequence).toBe(2n);
    const headFrame = (await getEnvelope(decodeStorageId16(pin.headStorageId)))!;
    const head = decodeAppHead((await envelopeCryptoAdapter.open(headFrame, "app.head", exported.appKey, "app.head")).payload);
    expect(head.eventSegments).toHaveLength(2);
    expect(graph.manifest.eventSegments).toHaveLength(1);
    expect(ids.has(head.eventSegments[0]!.storageId)).toBe(true);

    const recordsAndEvents = new Set(graph.objects.filter((object) => object.payloadKind === "app.record-page" || object.payloadKind === "app.event-segment")
      .map((object) => encodeBase64Url(object.reference.storageId)));
    const bounded = vi.spyOn(envelopeStoreAdapter, "getEnvelope").mockImplementation((id) => {
      if (recordsAndEvents.has(encodeBase64Url(id))) throw new Error("eager pin graph load");
      return getEnvelope(id);
    });
    try {
      const second = await worker.backup.pin(appId);
      // Negative control proves the old eager pin implementation trips the guard.
      await expect(loadApp({ store: envelopeStoreAdapter, crypto: envelopeCryptoAdapter, entropy: realEntropy }, exported.appKey, second.headStorageId)).rejects.toThrow("eager pin graph load");
      await worker.backup.release(assigned.homeId, second.operationId);
    } finally { bounded.mockRestore(); }

    const before = await readClearBootstrapRow();
    const rows = await countEnvelopeRows();
    const cancelled = new AbortController();
    cancelled.abort(new Error("before export"));
    await expect(worker.backup.exportGraph(assigned.homeId, pin.operationId, cancelled.signal)).rejects.toThrow("before export");
    const reading = await worker.backup.exportGraph(assigned.homeId, pin.operationId, signal);
    const controller = new AbortController();
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const paused = new Promise<void>((resolve) => { resume = resolve; });
    const blocked = vi.spyOn(envelopeStoreAdapter, "getEnvelope").mockImplementation(async (id) => {
      entered(); await paused; return getEnvelope(id);
    });
    try {
      const digest = sha256Chunks(reading.graph.canonicalAuthoredState(controller.signal));
      // Attach the rejection handler before aborting the parked read.
      const rejected = expect(digest).rejects.toThrow(/during cursor|disposed/);
      await started;
      controller.abort(new Error("during cursor"));
      expect(reading.graph.signal.aborted).toBe(true);
      resume();
      await rejected;
      expect(reading.graph.signal.aborted).toBe(true);
    } finally { resume(); blocked.mockRestore(); reading.dispose(); }
    expect(await readClearBootstrapRow()).toEqual(before);
    expect(await countEnvelopeRows()).toBe(rows);
    for (const object of graph.objects) {
      const id = encodeBase64Url(object.reference.storageId);
      for (const mode of ["missing", "corrupt"] as const) {
        const reader = vi.spyOn(envelopeStoreAdapter, "getEnvelope").mockImplementation(async (requested) => {
          const frame = await getEnvelope(requested);
          if (encodeBase64Url(requested) !== id || frame === undefined) return frame;
          if (mode === "missing") return undefined;
          frame.ciphertext[0] = frame.ciphertext[0]! ^ 1;
          return frame;
        });
        try { await expect(worker.backup.exportGraph(assigned.homeId, pin.operationId, signal), `${mode} ${object.payloadKind}`).rejects.toThrow(); }
        finally { reader.mockRestore(); }
        expect(await readClearBootstrapRow()).toEqual(before);
        expect(await countEnvelopeRows()).toBe(rows);
      }
    }
    const variants = [];
    for (const branch of ["retainedRoots", "conflictPages", "auditPages"] as const) {
      const body = { ...head, headVersion: 1 as const,
        [branch]: [{ ...head.checkpoint, storageId: encodeBase64Url(new Uint8Array(16).fill(99)) }] };
      variants.push(await envelopeCryptoAdapter.seal({ scope: "app.head", payloadKind: "app.head", key: exported.appKey,
        storageId: asStorageId16(headFrame.storageId), logicalRevision: headFrame.logicalRevision, compression: "none",
        payload: encodeAppHead({ ...body, semanticSha256: await sha256(encodeAppHeadBody(body)) }) }));
    }
    exported.dispose();
    for (const variant of variants) {
      const database = await openLocalDatabase();
      await database.table("envelopes").put(frameToRow(variant, Number(variant.logicalRevision)));
      await expect(worker.backup.exportGraph(assigned.homeId, pin.operationId, signal)).rejects.toThrow(/scope metadata|unavailable conflict/);
      expect(await getEnvelope(asStorageId16(headFrame.storageId))).toEqual(variant);
      expect(await readClearBootstrapRow()).toEqual(before);
      worker.dispose(); worker = createTestHandler().handler;
      await ask(worker, { kind: "unlock", passphrase });
      await expect(worker.backup.exportGraph(assigned.homeId, pin.operationId, signal)).rejects.toThrow(/scope metadata|unavailable conflict/);
      expect(await getEnvelope(asStorageId16(headFrame.storageId))).toEqual(variant);
      expect((await worker.backup.read(assigned.homeId)).pins).toEqual([pin]);
      expect((await worker.backup.read(assigned.homeId)).lastSuccessfulBackupMs).toBeNull();
      expect(await countEnvelopeRows()).toBe(rows);
    }
    await (await openLocalDatabase()).table("envelopes").put(frameToRow(headFrame, Number(headFrame.logicalRevision)));
    await worker.backup.release(assigned.homeId, pin.operationId);
  } finally { vi.restoreAllMocks(); worker.dispose(); await resetLocalDatabase(); }
}, 120_000);

it("reconstructs authored schema, provenance and restoration while authenticating covered chain evidence", async () => {
  await resetLocalDatabase();
  const { handler: worker, clock } = createTestHandler();
  const signal = new AbortController().signal;
  try {
    await ask(worker, { kind: "setup", passphrase: "authored graph passphrase" });
    const appId = await importDemoApp(worker);
    const assigned = await worker.backup.createBundleHome(appId, "Authored", "authored vault passphrase");
    const structure = (await ask(worker, { kind: "getAppStructure", appId })).structure!;
    const jobs = structure.tables.find((table) => table.displayName === "Jobs")!;
    const quoted = jobs.fields.find((field) => field.displayName === "Quoted amount")!.fieldId;
    const status = jobs.fields.find((field) => field.displayName === "Status")!.fieldId;
    for (const change of [
      { kind: "save-rule", ruleId: null, tableId: jobs.tableId, displayName: "Quoted", condition: { kind: "field-present", fieldId: quoted }, severity: "warning" },
      { kind: "save-formula", formulaId: null, target: { kind: "dashboard-value", tableId: null }, displayName: "Today", text: "TODAY()" },
    ] as const) {
      const preview = (await ask(worker, { kind: "previewSchemaChange", appId, change })).preview!;
      expect((await ask(worker, { kind: "applySchemaChange", appId, change, previewedSchemaRevision: preview.schemaRevision })).outcome.result).toBe("applied");
    }
    expect((await ask(worker, { kind: "saveChart", appId, chartId: null, expectedRevision: null, definition: {
      name: "Jobs by status", tableId: jobs.tableId, filters: [], pinned: true, type: "bar",
      groupBy: { kind: "field", fieldId: status }, seriesBy: null, measure: { kind: "count" }, sort: "category",
    } })).outcome.result).toBe("saved");
    const row = (await ask(worker, { kind: "queryRecords", appId, tableId: jobs.tableId, limit: 1 })).page!.records[0]!;
    expect((await ask(worker, { kind: "patchRecord", appId, recordId: row.recordId,
      changes: [{ fieldId: quoted, value: { kind: "number", decimal: "42" } }] })).outcome).toBe("accepted");
    expect((await ask(worker, { kind: "deleteRecord", appId, recordId: row.recordId })).outcome).toBe("accepted");
    const pin = await worker.backup.pin(appId);
    const exported = await worker.backup.exportGraph(assigned.homeId, pin.operationId, signal);
    try {
      async function state() {
        const chunks = [];
        for await (const chunk of exported.graph.canonicalAuthoredState(signal)) chunks.push(...chunk);
        return decodeCanonical(Uint8Array.from(chunks)) as ReadonlyMap<string, CborValue>;
      }
      const authored = await state();
      for (const key of ["rules", "formulas", "charts", "restoration", "lineages", "sheets", "baselines"]) {
        expect((authored.get(key) as readonly CborValue[]).length, key).toBeGreaterThan(0);
      }
      const restoration = authored.get("restoration") as readonly (readonly CborValue[])[];
      const restored = decodeAuthoredRecord(restoration[0]![3] as Uint8Array);
      expect([...restored.provenance.values()].some((entry) => entry.source === "user")).toBe(true);
      const digest = await sha256Chunks(exported.graph.canonicalAuthoredState(signal));
      clock.advance(86_400_000);
      await ask(worker, { kind: "getAppMetrics", appId });
      expect(await sha256Chunks(exported.graph.canonicalAuthoredState(signal))).toEqual(digest);

      const frame = (await envelopeStoreAdapter.getEnvelope(decodeStorageId16(pin.headStorageId)))!;
      const head = decodeAppHead((await envelopeCryptoAdapter.open(frame, "app.head", exported.appKey, "app.head")).payload);
      const baselineRef = head.baselinePages[0]!;
      const baselineFrame = (await envelopeStoreAdapter.getEnvelope(decodeStorageId16(baselineRef.storageId)))!;
      const baseline = decodeBaselinePage((await envelopeCryptoAdapter.open(baselineFrame, "app.baselines", exported.appKey, "app.baseline-page")).payload);
      if (baseline.pageVersion !== 1) throw new Error("original import must retain V1 baseline bytes");
      const baselineDigests = new Set<string>();
      for (const state of ["present", "deleted", "absent"] as const) {
        const payload = encodeBaselinePage({ ...baseline, entries: baseline.entries.map((entry, i) => i === 0 ? { ...entry, state } : entry) });
        const altered = await envelopeCryptoAdapter.seal({ scope: "app.baselines", payloadKind: "app.baseline-page", key: exported.appKey,
          storageId: asStorageId16(baselineFrame.storageId), logicalRevision: baselineFrame.logicalRevision, compression: "none", payload });
        const body = { ...head, baselinePages: [{ ...baselineRef, semanticSha256: await sha256(payload) }, ...head.baselinePages.slice(1)] };
        const alteredHead = await envelopeCryptoAdapter.seal({ scope: "app.head", payloadKind: "app.head", key: exported.appKey,
          storageId: asStorageId16(frame.storageId), logicalRevision: frame.logicalRevision, compression: "none",
          payload: encodeAppHead({ ...body, semanticSha256: await sha256(encodeAppHeadBody(body)) }) });
        const getEnvelope = envelopeStoreAdapter.getEnvelope.bind(envelopeStoreAdapter);
        const reader = vi.spyOn(envelopeStoreAdapter, "getEnvelope").mockImplementation((id) => {
          const text = encodeBase64Url(id);
          return text === pin.headStorageId ? Promise.resolve(alteredHead) : text === baselineRef.storageId ? Promise.resolve(altered) : getEnvelope(id);
        });
        try {
          const variant = await worker.backup.exportGraph(assigned.homeId, pin.operationId, signal);
          try { baselineDigests.add(encodeBase64Url(await sha256Chunks(variant.graph.canonicalAuthoredState(signal)))); }
          finally { variant.dispose(); }
        } finally { reader.mockRestore(); }
      }
      expect(baselineDigests.size).toBe(3);
      const covered = head.eventSegments[0]!;
      const segmentFrame = (await envelopeStoreAdapter.getEnvelope(decodeStorageId16(covered.storageId)))!;
      const segment = decodeEventSegment((await envelopeCryptoAdapter.open(segmentFrame, "app.events", exported.appKey, "app.event-segment")).payload);
      expect(exported.graph.checkpointChains[0]!.commitSha256).toEqual(segment.commits[0]!.commitSha256);
      for (const corruption of ["body-hash", "device", "gap"] as const) {
        const commit = segment.commits[0]!;
        const changed = corruption === "body-hash" ? { ...commit, commitSha256: new Uint8Array(32) } : await sealEventCommit({ ...commit,
          ...(corruption === "device" ? { deviceId: new Uint8Array(16).fill(77) } : { deviceCommitSequence: 2n, previousDeviceCommitSha256: new Uint8Array(32).fill(1) }),
        }, sha256);
        const bytes = encodeEventSegment({ ...segment, commits: [changed] });
        const badSegment = await envelopeCryptoAdapter.seal({ scope: "app.events", payloadKind: "app.event-segment", key: exported.appKey,
          storageId: asStorageId16(segmentFrame.storageId), logicalRevision: segmentFrame.logicalRevision, compression: "none", payload: bytes });
        const body = { ...head, eventSegments: [{ ...covered, semanticSha256: await sha256(bytes) }, ...head.eventSegments.slice(1)] };
        const badHead = await envelopeCryptoAdapter.seal({ scope: "app.head", payloadKind: "app.head", key: exported.appKey,
          storageId: asStorageId16(frame.storageId), logicalRevision: frame.logicalRevision, compression: "none",
          payload: encodeAppHead({ ...body, semanticSha256: await sha256(encodeAppHeadBody(body)) }) });
        const getEnvelope = envelopeStoreAdapter.getEnvelope.bind(envelopeStoreAdapter);
        const reader = vi.spyOn(envelopeStoreAdapter, "getEnvelope").mockImplementation((id) => {
          const text = encodeBase64Url(id);
          return text === pin.headStorageId ? Promise.resolve(badHead) : text === covered.storageId ? Promise.resolve(badSegment) : getEnvelope(id);
        });
        try { await expect(worker.backup.exportGraph(assigned.homeId, pin.operationId, signal), corruption).rejects.toThrow(); }
        finally { reader.mockRestore(); }
      }
      expect((await worker.backup.read(assigned.homeId)).lastSuccessfulBackupMs).toBeNull();
    } finally { exported.dispose(); await worker.backup.release(assigned.homeId, pin.operationId); }
  } finally { worker.dispose(); await resetLocalDatabase(); }
}, 120_000);

it("reconciles historical owners before leaf validation and counts only selected baselines", async () => {
  await resetLocalDatabase();
  const worker = createTestHandler().handler;
  const signal = new AbortController().signal;
  try {
    await ask(worker, { kind: "setup", passphrase: "historical owner passphrase" });
    const appId = await importDemoApp(worker);
    const assigned = await worker.backup.createBundleHome(appId, "Owners", "historical vault passphrase");
    const pin = await worker.backup.pin(appId);
    const exported = await worker.backup.exportGraph(assigned.homeId, pin.operationId, signal);
    try {
      const original = (await envelopeStoreAdapter.getEnvelope(decodeStorageId16(pin.headStorageId)))!;
      const head = decodeAppHead((await envelopeCryptoAdapter.open(original, "app.head", exported.appKey, "app.head")).payload);
      const frames = new Map<string, typeof original>();
      const store = { getEnvelope: (id: Parameters<typeof envelopeStoreAdapter.getEnvelope>[0]) =>
        frames.has(encodeBase64Url(id)) ? Promise.resolve(frames.get(encodeBase64Url(id))) : envelopeStoreAdapter.getEnvelope(id) };
      const seal = async (id: string, body: Parameters<typeof encodeAppHeadBody>[0]) => {
        const bytes = encodeAppHead({ ...body, semanticSha256: await sha256(encodeAppHeadBody(body)) });
        frames.set(id, await envelopeCryptoAdapter.seal({ storageId: decodeStorageId16(id), logicalRevision: original.logicalRevision,
          scope: "app.head", payloadKind: "app.head", compression: "none", key: exported.appKey, payload: bytes }));
        return { storageId: id, semanticSha256: await sha256(bytes), scope: "app.head" as const, payloadKind: "app.head" as const };
      };
      const firstId = encodeBase64Url(new Uint8Array(16).fill(1));
      const secondId = encodeBase64Url(new Uint8Array(16).fill(2));
      const extraBaselineId = encodeBase64Url(new Uint8Array(16).fill(3));
      const baselineRef = head.baselinePages[0]!;
      const baselineFrame = (await envelopeStoreAdapter.getEnvelope(decodeStorageId16(baselineRef.storageId)))!;
      const baselineBytes = (await envelopeCryptoAdapter.open(baselineFrame, "app.baselines", exported.appKey, "app.baseline-page")).payload;
      frames.set(extraBaselineId, await envelopeCryptoAdapter.seal({ storageId: decodeStorageId16(extraBaselineId), logicalRevision: original.logicalRevision,
        scope: "app.baselines", payloadKind: "app.baseline-page", compression: "none", key: exported.appKey, payload: baselineBytes }));
      const first = await seal(firstId, { ...head, baselinePages: [...head.baselinePages, { ...baselineRef, storageId: extraBaselineId }] });
      const second = await seal(secondId, head);
      const auditId = encodeBase64Url(new Uint8Array(16).fill(4));
      const originalSegment = head.eventSegments[0]!;
      const segmentFrame = (await envelopeStoreAdapter.getEnvelope(decodeStorageId16(originalSegment.storageId)))!;
      const originalCommit = decodeEventSegment((await envelopeCryptoAdapter.open(segmentFrame, "app.events", exported.appKey, "app.event-segment")).payload).commits[0]!;
      const auditBytes = encodeAuditPage({ pageVersion: 1, appId: head.appId, entries: [{ segment: { ...originalSegment,
        scope: "app.events", payloadKind: "app.event-segment" }, commitId: originalCommit.commitId, commitSha256: originalCommit.commitSha256 }] });
      frames.set(auditId, await envelopeCryptoAdapter.seal({ storageId: decodeStorageId16(auditId), logicalRevision: original.logicalRevision,
        scope: "app.audit", payloadKind: "app.audit-page", compression: "none", key: exported.appKey, payload: auditBytes }));
      const v2 = { ...head, headVersion: 2 as const, retainedRoots: [first, second], eventSegments: head.eventSegments.slice(1),
        auditPages: [{ storageId: auditId, semanticSha256: await sha256(auditBytes) }] };
      await seal(pin.headStorageId, v2);
      const graph = await exportBackupGraph({ crypto: envelopeCryptoAdapter, store }, exported.appKey, pin, signal);
      expect(new Set(graph.objects.map((object) => encodeBase64Url(object.reference.storageId))).size).toBe(graph.objects.length);
      expect(graph.objects.length).toBe(exported.graph.objects.length + 4);
      expect(await sha256Chunks(graph.canonicalAuthoredState(signal))).toEqual(await sha256Chunks(exported.graph.canonicalAuthoredState(signal)));

      // A historical head's payload digest cannot substitute for its body hash.
      const malformed = encodeAppHead({ ...head, semanticSha256: new Uint8Array(32) });
      frames.set(firstId, await envelopeCryptoAdapter.seal({ storageId: decodeStorageId16(firstId), logicalRevision: original.logicalRevision,
        scope: "app.head", payloadKind: "app.head", compression: "none", key: exported.appKey, payload: malformed }));
      await seal(pin.headStorageId, { ...head, headVersion: 2, retainedRoots: [{ ...first, semanticSha256: await sha256(malformed) }, second] });
      await expect(exportBackupGraph({ crypto: envelopeCryptoAdapter, store }, exported.appKey, pin, signal)).rejects.toThrow("head identity or digest mismatch");
      expect((await worker.backup.read(assigned.homeId)).lastSuccessfulBackupMs).toBeNull();
      expect(await envelopeStoreAdapter.getEnvelope(decodeStorageId16(pin.headStorageId))).toEqual(original);
    } finally { exported.dispose(); await worker.backup.release(assigned.homeId, pin.operationId); }
  } finally { worker.dispose(); await resetLocalDatabase(); }
}, 120_000);

it("authenticates nonempty conflict descendants in logical order and rejects substituted originals without writes", async () => {
  await resetLocalDatabase();
  const worker = createTestHandler().handler;
  const signal = new AbortController().signal;
  try {
    await ask(worker, { kind: "setup", passphrase: "original conflict graph evidence" });
    const appId = await importDemoApp(worker);
    const home = await worker.backup.createBundleHome(appId, "Evidence", "original evidence vault secret");
    const pin = await worker.backup.pin(appId);
    const exported = await worker.backup.exportGraph(home.homeId, pin.operationId, signal);
    try {
      const { decodeCheckpointManifest, encodeCheckpointBody, encodeCheckpointManifest, encodeConflictPage, encodeCellValue } = await import("../../../src/import/staging/roots.js");
      const headFrame = (await envelopeStoreAdapter.getEnvelope(decodeStorageId16(pin.headStorageId)))!;
      const head = decodeAppHead((await envelopeCryptoAdapter.open(headFrame, "app.head", exported.appKey, "app.head")).payload);
      const original = await loadApp({ crypto: envelopeCryptoAdapter, store: envelopeStoreAdapter, entropy: realEntropy }, exported.appKey, pin.headStorageId);
      const genesis = original.commits[0]!;
      const last = original.commits.at(-1)!;
      const checkpointFrame = (await envelopeStoreAdapter.getEnvelope(decodeStorageId16(head.checkpoint.storageId)))!;
      const checkpointBytes = (await envelopeCryptoAdapter.open(checkpointFrame, "app.checkpoint", exported.appKey, "app.checkpoint-manifest")).payload;
      const checkpoint = decodeCheckpointManifest(checkpointBytes);
      const baselineFrame = (await envelopeStoreAdapter.getEnvelope(decodeStorageId16(head.baselinePages[0]!.storageId)))!;
      const baseline = decodeBaselinePage((await envelopeCryptoAdapter.open(baselineFrame, "app.baselines", exported.appKey, "app.baseline-page")).payload);
      if (baseline.pageVersion !== 1) throw new Error("original import must retain V1 baseline bytes");
      const row = baseline.entries[0]!;
      const id = (value: number) => new Uint8Array(16).fill(value);
      const map = (entries: readonly (readonly [string, CborValue])[]) => new Map<string, CborValue>(entries);
      const values = [...row.values].sort((a, b) => Buffer.compare(a.fieldId, b.fieldId)).map(({ fieldId, value }) => map([["fieldId", fieldId], ["value", encodeCellValue(value)]]));
      const record = map([["recordId", row.recordId], ["tableId", row.tableId], ["values", values], ["provenance", []]]);
      const sourceFrontier = [map([["deviceId", genesis.deviceId], ["commitSequence", genesis.deviceCommitSequence]])];
      const source = map([["source", "this-device"], ["timestampMs", genesis.hybridTime.wallTimeMs], ["commitId", genesis.commitId],
        ["frontier", sourceFrontier], ["state", map([["state", "present"], ["value", record]])]]);
      const baselineValue = map([["scopeId", baseline.scopeId], ["state", "present"], ["values", values], ["absentReason", null], ["frontier", sourceFrontier]]);
      const detection = (conflictId: Uint8Array) => map([["payloadVersion", 1n], ["conflictId", conflictId], ["tableId", row.tableId], ["targetKind", "record"],
        ["targetId", row.recordId], ["conflictKind", "field"], ["schemaRevision", head.schemaRevision], ["baseline", baselineValue],
        ["local", source], ["incoming", source], ["conflictingFields", []], ["validationReport", null]]);
      const frontier = head.frontier.map((entry) => ({ ...entry, commitSequence: entry.commitSequence + 1n }));
      const frames = new Map<string, typeof headFrame>();
      const store = { getEnvelope: async (storageId: Parameters<typeof envelopeStoreAdapter.getEnvelope>[0]) =>
        frames.get(encodeBase64Url(storageId)) ?? envelopeStoreAdapter.getEnvelope(storageId) };
      const seal = async (byte: number, scope: Parameters<typeof envelopeCryptoAdapter.seal>[0]["scope"],
        payloadKind: Parameters<typeof envelopeCryptoAdapter.seal>[0]["payloadKind"], payload: Uint8Array, revision = 10n) => {
        const storageId = asStorageId16(id(byte));
        const text = encodeBase64Url(storageId);
        frames.set(text, await envelopeCryptoAdapter.seal({ storageId, logicalRevision: revision, scope, payloadKind,
          compression: "none", key: exported.appKey, payload }));
        return { storageId: text, semanticSha256: await sha256(payload) };
      };
      const before = await readClearBootstrapRow();
      const count = await countEnvelopeRows();
      const build = async (mode: "valid" | "reverse" | "duplicate" | "wrong-subject" | "missing-source" | "substitute-event" | "empty-payload") => {
        frames.clear();
        const wirePayload = detection(id(20));
        if (mode === "missing-source") wirePayload.set("incoming", new Map(source).set("commitId", id(99)));
        const commit = await sealEventCommit({ ...last, commitId: id(30), deviceCommitSequence: last.deviceCommitSequence + 1n,
          previousDeviceCommitSha256: last.commitSha256, basisFrontier: head.frontier,
          hybridTime: { wallTimeMs: last.hybridTime.wallTimeMs + 1n, logicalCounter: 0 }, eventClass: "reconciliation",
          events: [20, 21].map((byte, index) => ({ eventId: id(byte + 20), eventIndex: index, kind: "conflict.detected" as const,
            subject: { appId: head.appId, tableId: row.tableId, recordId: mode === "wrong-subject" && index === 0 ? id(99) : row.recordId, objectId: id(byte) },
            provenance: { source: "remote-device" as const }, payload: index === 0 ? mode === "empty-payload" ? map([]) : wirePayload : detection(id(byte)) })) }, sha256);
        const segment = await seal(60, "app.events", "app.event-segment", encodeEventSegment({ eventFormatVersion: 1, segmentId: id(61), appId: head.appId,
          commits: [commit], resultingFrontier: frontier, semanticSha256: commit.commitSha256 }));
        const originalRefs = original.commits.map((entry, index) => ({ segment: { ...head.eventSegments[index]!, scope: "app.events" as const, payloadKind: "app.event-segment" as const },
          commitId: entry.commitId, commitSha256: entry.commitSha256 }));
        const evidence = { segment: { ...segment, scope: "app.events" as const, payloadKind: "app.event-segment" as const }, commitId: commit.commitId, commitSha256: commit.commitSha256 };
        const audit = await seal(62, "app.audit", "app.audit-page", encodeAuditPage({ pageVersion: 1, appId: head.appId, entries: [...originalRefs, evidence] }));
        const conflictPages = [];
        for (const [index, byte] of [20, 21].entries()) {
          conflictPages.push(await seal(70 - index, "app.conflicts", "app.conflict-page", encodeConflictPage({ pageVersion: 1, appId: head.appId,
            entries: [{ conflictId: id(byte), detected: { commit: evidence, eventId: id(mode === "substitute-event" && index === 0 ? 41 : byte + 20) }, resolved: null }] }), BigInt(20 - index)));
        }
        if (mode === "reverse") conflictPages.reverse();
        if (mode === "duplicate") conflictPages[1] = conflictPages[0]!;
        const checkpointBody = { ...checkpoint, frontier };
        const compactedCheckpoint = await seal(72, "app.checkpoint", "app.checkpoint-manifest", encodeCheckpointManifest({ ...checkpointBody,
          semanticSha256: await sha256(encodeCheckpointBody(checkpointBody)) }));
        const body = { ...head, headVersion: 2 as const, frontier, checkpoint: compactedCheckpoint, eventSegments: [], auditPages: [audit], conflictPages,
          retainedRoots: [{ ...head.checkpoint, scope: "app.checkpoint" as const, payloadKind: "app.checkpoint-manifest" as const }] };
        const ref = await seal(73, "app.head", "app.head", encodeAppHead({ ...body, semanticSha256: await sha256(encodeAppHeadBody(body)) }));
        return exportBackupGraph({ crypto: envelopeCryptoAdapter, store }, exported.appKey, { appId, headStorageId: ref.storageId }, signal);
      };
      const graph = await build("valid");
      expect(graph.manifest.conflictPages.map((ref) => ref.logicalRevision)).toEqual([20n, 19n]);
      expect(graph.objects.filter((object) => object.payloadKind === "app.conflict-page").map((object) => object.children.length)).toEqual([1, 1]);
      expect(graph.deviceChains[0]!.commitSequence).toBe(last.deviceCommitSequence + 1n);
      // This checks the reference layer; full projection/effects acceptance is a separate gate.
      for (const mode of ["reverse", "duplicate", "wrong-subject", "missing-source", "substitute-event", "empty-payload"] as const) {
        await expect(build(mode), mode).rejects.toThrow();
        expect(await readClearBootstrapRow()).toEqual(before);
        expect(await countEnvelopeRows()).toBe(count);
        expect((await worker.backup.read(home.homeId)).lastSuccessfulBackupMs).toBeNull();
      }
    } finally { exported.dispose(); await worker.backup.release(home.homeId, pin.operationId); }
  } finally { worker.dispose(); await resetLocalDatabase(); }
}, 120_000);
