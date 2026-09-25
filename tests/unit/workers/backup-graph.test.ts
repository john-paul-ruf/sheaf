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
import { decodeAppHead, encodeAppHead, encodeAppHeadBody, decodeBaselinePage, encodeBaselinePage } from "../../../src/import/staging/roots.js";
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
      const withRetained = { ...originalHead, retainedRoots: [originalHead.checkpoint] };
      const scopedHead = await envelopeCryptoAdapter.seal({ scope: "app.head", payloadKind: "app.head", key: exported.appKey,
        storageId: decodeStorageId16(pin.headStorageId), logicalRevision: frame.logicalRevision, compression: "none",
        payload: encodeAppHead({ ...withRetained, semanticSha256: await sha256(encodeAppHeadBody(withRetained)) }) });
      await expect(exportBackupGraph({ crypto: envelopeCryptoAdapter, store: { ...envelopeStoreAdapter,
        getEnvelope: (id) => encodeBase64Url(id) === pin.headStorageId ? Promise.resolve(scopedHead) : envelopeStoreAdapter.getEnvelope(id),
      } }, exported.appKey, pin, signal)).rejects.toThrow("retained roots require authenticated scope metadata");
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
      const body = { ...head, [branch]: [head.checkpoint] };
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
