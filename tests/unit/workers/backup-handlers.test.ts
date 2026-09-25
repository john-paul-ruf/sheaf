import "fake-indexeddb/auto";
import { sha256Chunks } from "../../../src/crypto/hash.js";
import { afterEach, expect, it, vi } from "vitest";
import { decodeStorageId16 } from "../../../src/domain/model/bytes.js";
import { getEnvelope } from "../../../src/persistence/envelope-store/read.js";
import { parseDelimited } from "../../../src/import/formats/delimited/parse.js";
import { sniffContent } from "../../../src/import/source/sniff.js";
import { isDelimitedSniff, preflightDelimited } from "../../../src/import/preflight/preflight.js";
import { stageBatch, stageSource, stageNack, isStageChannelOutboundV1, type StageChannelInboundV1 } from "../../../src/workers/protocol/stage-channel.js";
import type { DataWorkerCommandHandler } from "../../../src/workers/data/handlers.js";
import { decodeDomainId } from "../../../src/domain/model/ids.js";
import { createVaultCrypto } from "../../../src/crypto/vault-port.js";
import { loadApp } from "../../../src/workers/data/event-store.js";
import { envelopeCryptoAdapter, envelopeStoreAdapter } from "../../../src/workers/data/import-handlers.js";
import { textSource } from "../import/fixtures.js";
import { ask, countEnvelopeRows, createTestHandler, readClearBootstrapRow, realEntropy, resetLocalDatabase } from "./data-worker.js";

const LOCAL = "local test passphrase for home assignment";
const VAULT = "separate test vault passphrase";
let worker: DataWorkerCommandHandler | undefined;
afterEach(() => { worker?.dispose(); });

/** A missing/nacked response rejects; the test never hangs on a pending transport. */
function send(port: MessagePort, message: StageChannelInboundV1, seq: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      port.removeEventListener("message", receive);
      if (error === undefined) resolve(); else reject(error);
    };
    const receive = (event: MessageEvent<unknown>) => {
      if (!isStageChannelOutboundV1(event.data)) return;
      finish(event.data.kind === "ack" && event.data.ackSeq === seq ? undefined : new Error("staging refused the batch"));
    };
    const timer = setTimeout(() => { finish(new Error("staging response timed out")); }, 5000);
    port.addEventListener("message", receive);
    port.postMessage(message);
  });
}

async function importCsv(handler: DataWorkerCommandHandler, appId?: string) {
  const source = textSource("Item,Amount\nHammer,2\nNail,3\n");
  const sniff = await sniffContent(source, "tools.csv");
  if (!isDelimitedSniff(sniff)) throw new Error("not CSV");
  const sized = await preflightDelimited(source, sniff);
  if (sized.kind !== "proceed") throw new Error("preflight refused");
  const channel = new MessageChannel();
  channel.port1.start();
  try {
    const begun = await ask(handler, { kind: "beginImportStage", fileName: "tools.csv",
      detected: sniff.format, preflight: sized.report,
      destination: appId === undefined ? { kind: "new-app" } : { kind: "existing-app", appId } }, [channel.port2]);
    let seq = 0;
    await send(channel.port1, stageSource(seq, 0, await source.slice(0, source.byteLength)), seq++);
    for await (const item of parseDelimited(source, sniff.format, { sheetName: "Tools" })) {
      await send(channel.port1, stageBatch(seq, item), seq++);
    }
    await ask(handler, { kind: "runInference", stageId: begun.stageId });
    const result = await ask(handler, { kind: "promoteImport", stageId: begun.stageId, acceptedName: "Tools" });
    if (result.outcome !== "promoted") throw new Error(`promotion refused: ${result.reason}`);
    return result.appId;
  } finally { channel.port1.close(); channel.port2.close(); }
}

it("propagates a transport refusal (negative control for the acknowledgement harness)", async () => {
  const channel = new MessageChannel();
  channel.port1.start();
  channel.port2.onmessage = () => { channel.port2.postMessage(stageNack(0)); };
  try { await expect(send(channel.port1, stageSource(0, 0, new Uint8Array([1])), 0)).rejects.toThrow("refused"); }
  finally { channel.port1.close(); channel.port2.close(); }
});

it("exposes scoped home creation and authenticated recovery review through RPC across restart", async () => {
  await resetLocalDatabase();
  worker = createTestHandler().handler;
  const local = await ask(worker, { kind: "setup", passphrase: LOCAL });
  const appId = await importCsv(worker);
  const before = await readClearBootstrapRow();
  await expect(ask(worker, { kind: "createBundleHome", appId, displayName: "Tools vault",
    passphrase: VAULT, reuseLocalPassphrase: true })).rejects.toThrow();
  expect(await readClearBootstrapRow()).toEqual(before);
  expect((await ask(worker, { kind: "listLibrary" })).apps[0]?.isScratch).toBe(true);
  const home = await ask(worker, { kind: "createBundleHome", appId, displayName: "Tools vault",
    passphrase: VAULT, reuseLocalPassphrase: false });
  expect(home.localRecoveryCode).toBeNull();
  expect(home.recoveryCode).not.toBe(local.recoveryCode);
  const assigned = await readClearBootstrapRow();
  await expect(ask(worker, { kind: "revealVaultRecoveryCode", homeId: home.homeId, passphrase: LOCAL })).rejects.toThrow();
  expect(await readClearBootstrapRow()).toEqual(assigned);
  worker.dispose();
  worker = createTestHandler().handler;
  await expect(ask(worker, { kind: "revealVaultRecoveryCode", homeId: home.homeId, passphrase: VAULT })).rejects.toThrow();
  await ask(worker, { kind: "unlock", passphrase: LOCAL });
  expect((await ask(worker, { kind: "revealVaultRecoveryCode", homeId: home.homeId, passphrase: VAULT })).recoveryCode).toBe(home.recoveryCode);
  const second = await importCsv(worker);
  const reused = await ask(worker, { kind: "createBundleHome", appId: second, displayName: "Second vault",
    passphrase: LOCAL, reuseLocalPassphrase: true });
  expect(reused.localRecoveryCode).toBe(local.recoveryCode);
  expect(reused.recoveryCode).not.toBe(local.recoveryCode);
}, 120_000);

it("commits assignment atomically, retains pinned graphs across edits and CSV append, and releases safely after restart", async () => {
  await resetLocalDatabase();
  worker = createTestHandler().handler;
  await ask(worker, { kind: "setup", passphrase: LOCAL });
  const appId = await importCsv(worker);
  const before = await readClearBootstrapRow();
  const assigned = await worker.backup.createBundleHome(appId, "Tools vault", VAULT);
  const after = await readClearBootstrapRow();
  expect(Number(after?.["transactionRevision"])).toBe(Number(before?.["transactionRevision"]) + 1);
  expect((await ask(worker, { kind: "listLibrary" })).apps[0]?.isScratch).toBe(false);
  const state = await worker.backup.read(assigned.homeId);
  expect(state.lastSuccessfulBackupMs).toBeNull();
  expect(state.secrets.recoveryCode).toBe(assigned.recoveryCode);
  const pinned = await worker.backup.pin(appId);
  const secondPin = await worker.backup.pin(appId);
  const original = await getEnvelope(decodeStorageId16(pinned.headStorageId));
  expect(original).toBeDefined();
  const vaultCrypto = createVaultCrypto(realEntropy);
  const vaultKey = await vaultCrypto.openWithPassphrase(VAULT, decodeDomainId("vault", state.vaultId),
    state.secrets.passphraseKdf, state.secrets.passphraseWrappedVaultKey);
  const key = await vaultCrypto.openApp(state.appKeys[0]!.wrappedAppKey, vaultKey,
    decodeDomainId("vault", state.vaultId), decodeDomainId("app", appId));
  const ports = { store: envelopeStoreAdapter, crypto: envelopeCryptoAdapter, entropy: realEntropy };
  try {
    const snapshot = await loadApp(ports, key, pinned.headStorageId);
    expect(snapshot.commits.at(-1)?.events[0]?.kind).toBe("durable-home.assigned");
    const change = await ask(worker, { kind: "changeTheme", appId, themeKey: "indigo", mode: "light",
      density: "compact", customAccent: null, logo: { kind: "keep" } });
    expect(change.outcome.result).toBe("changed");
    expect(await getEnvelope(decodeStorageId16(pinned.headStorageId))).toEqual(original);
    await worker.backup.release(assigned.homeId, pinned.operationId);
    expect(await getEnvelope(decodeStorageId16(pinned.headStorageId))).toEqual(original);
    await worker.backup.release(assigned.homeId, secondPin.operationId);
    expect(await getEnvelope(decodeStorageId16(pinned.headStorageId))).toBeUndefined();

    const appendPin = await worker.backup.pin(appId);
    const appendSnapshot = await loadApp(ports, key, appendPin.headStorageId);
    const exported = await worker.backup.exportGraph(assigned.homeId, appendPin.operationId, new AbortController().signal);
    const pinnedHash = await sha256Chunks(exported.graph.canonicalAuthoredState(new AbortController().signal));
    await importCsv(worker, appId);
    expect(await loadApp(ports, key, appendPin.headStorageId)).toEqual(appendSnapshot);
    expect(await sha256Chunks(exported.graph.canonicalAuthoredState(new AbortController().signal))).toEqual(pinnedHash);
    const currentPin = await worker.backup.pin(appId);
    const appended = await worker.backup.exportGraph(assigned.homeId, currentPin.operationId, new AbortController().signal);
    expect(await sha256Chunks(appended.graph.canonicalAuthoredState(new AbortController().signal))).not.toEqual(pinnedHash);
    expect(appended.graph.manifest.sourceManifests).toHaveLength(2);
    appended.dispose();
    exported.dispose();
    expect(currentPin.headStorageId).not.toBe(appendPin.headStorageId);
    expect((await loadApp(ports, key, currentPin.headStorageId)).head.eventSegments.length)
      .toBe(appendSnapshot.head.eventSegments.length + 1);
    await worker.backup.release(assigned.homeId, currentPin.operationId);
    expect(await getEnvelope(decodeStorageId16(currentPin.headStorageId))).toBeDefined();
    worker.dispose();
    worker = createTestHandler().handler;
    await ask(worker, { kind: "unlock", passphrase: LOCAL });
    expect((await worker.backup.read(assigned.homeId)).pins).toEqual([appendPin]);
    await worker.backup.release(assigned.homeId, appendPin.operationId);
    expect(await getEnvelope(decodeStorageId16(appendPin.headStorageId))).toBeUndefined();
    expect((await worker.backup.read(assigned.homeId)).lastSuccessfulBackupMs).toBeNull();

    const secondApp = await importCsv(worker);
    const rejectedBefore = await readClearBootstrapRow();
    const rows = await countEnvelopeRows();
    await expect(worker.backup.assignBundleHome(secondApp, assigned.homeId, "wrong secret")).rejects.toThrow();
    await expect(worker.backup.createBundleHome(appId, "Duplicate", VAULT)).rejects.toThrow("already");
    await expect(worker.backup.pin(assigned.homeId)).rejects.toThrow();
    await expect(worker.backup.assignBundleHome(secondApp, appId, VAULT)).rejects.toThrow("unknown");
    expect(await readClearBootstrapRow()).toEqual(rejectedBefore);
    expect(await countEnvelopeRows()).toBe(rows);
    await worker.backup.assignBundleHome(secondApp, assigned.homeId, VAULT);
    expect((await worker.backup.read(assigned.homeId)).appKeys).toHaveLength(2);
    expect((await ask(worker, { kind: "listLibrary" })).apps.every((app) => !app.isScratch)).toBe(true);
  } finally { vaultCrypto.destroy(key); vaultCrypto.destroy(vaultKey); }
}, 120_000);

/** Real data↔IO/control channels; only the external file destination is omitted. */
async function preparedBundle(handler: DataWorkerCommandHandler, appId: string) {
  const { receiveBundle } = await import("../../../src/workers/io/bundle.js");
  const { ioRecord, isBundleIdentity } = await import("../../../src/workers/protocol/io-messages.js");
  const data = new MessageChannel();
  const control = new MessageChannel();
  const abort = new AbortController();
  let artifact: Blob | undefined;
  const close = receiveBundle(data.port2, (blob) => { artifact = blob; }, abort.signal);
  let receive: (message: Record<string, unknown>) => void = () => undefined;
  control.port1.onmessage = (event: MessageEvent<unknown>) => { receive(ioRecord(event.data)); };
  control.port1.start();
  const next = () => new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error("bundle harness timed out")); }, 10_000);
    receive = (message) => { clearTimeout(timer); resolve(message); };
  });
  const ready = next();
  const finished = handler.backup.connectBundle(appId, data.port1, control.port2);
  const message = await ready;
  if (message["kind"] !== "ready" || !isBundleIdentity(message["identity"]) || artifact === undefined) throw new Error("bundle preparation failed");
  const identity = message["identity"];
  return { identity, artifact,
    async complete(outcome: string, replacement: unknown = identity) {
      const response = next();
      control.port1.postMessage({ kind: "complete", identity: replacement, outcome });
      return response;
    },
    async dispose() {
      control.port1.postMessage({ kind: "cancel" });
      await finished;
      abort.abort(); close(); data.port1.close(); data.port2.close(); control.port1.close(); control.port2.close();
    },
  };
}

it("confirms exact native outcomes once, persists the captured frontier, and rejects failed/forged/stale saves", async () => {
  await resetLocalDatabase();
  worker = createTestHandler().handler;
  await ask(worker, { kind: "setup", passphrase: LOCAL });
  const appId = await importCsv(worker);
  const assigned = await worker.backup.createBundleHome(appId, "Native test vault", VAULT);
  const success = await preparedBundle(worker, appId);
  try {
    const { blobChunks, verifyBundle } = await import("../../../src/sync/providers/bundle/format.js");
    const { decodeBase64Url } = await import("../../../src/domain/model/bytes.js");
    await verifyBundle(success.artifact, decodeBase64Url(success.identity.artifactSha256), new AbortController().signal);
    expect(await sha256Chunks(blobChunks(success.artifact, new AbortController().signal))).toEqual(decodeBase64Url(success.identity.artifactSha256));
    await ask(worker, { kind: "changeTheme", appId, themeKey: "indigo", mode: "light", density: "compact", customAccent: null, logo: { kind: "keep" } });
    expect((await success.complete("saved"))["kind"]).toBe("completed");
  } finally { await success.dispose(); }
  const confirmed = await worker.backup.read(assigned.homeId);
  expect(confirmed.receipts).toHaveLength(1);
  expect(confirmed.receipts?.[0]?.operationId).toBe(success.identity.operationId);
  expect(confirmed.lastSuccessfulBackupMs).not.toBeNull();
  expect((await ask(worker, { kind: "openApp", appId })).session).toMatchObject({
    deviceOnlyChangeCount: 1, durability: { homeId: assigned.homeId, confirmedAtMs: confirmed.lastSuccessfulBackupMs, deviceOnlyChangeCount: 1 },
  });
  expect((await ask(worker, { kind: "listLibrary" })).apps[0]?.durability).toMatchObject({
    confirmedAtMs: confirmed.lastSuccessfulBackupMs, deviceOnlyChangeCount: 1,
  });
  const receipts = confirmed.receipts;
  for (const outcome of ["cancelled", "failed", "unconfirmed"]) {
    const transfer = await preparedBundle(worker, appId);
    try { expect((await transfer.complete(outcome))["kind"]).toBe("completed"); }
    finally { await transfer.dispose(); }
    expect((await worker.backup.read(assigned.homeId)).receipts).toEqual(receipts);
    expect((await worker.backup.read(assigned.homeId)).lastSuccessfulBackupMs).toBe(confirmed.lastSuccessfulBackupMs);
  }
  for (const field of ["appId", "homeId", "operationId", "artifactSha256"]) {
    const transfer = await preparedBundle(worker, appId);
    try { expect((await transfer.complete("saved", { ...transfer.identity, [field]: "forged" }))["kind"]).toBe("failed"); }
    finally { await transfer.dispose(); }
    expect((await worker.backup.read(assigned.homeId)).receipts).toEqual(receipts);
  }
  const failedCommit = await preparedBundle(worker, appId);
  const beforeFailure = await readClearBootstrapRow();
  const rejectCommit = vi.spyOn(envelopeStoreAdapter, "commit").mockRejectedValueOnce(new Error("quota"));
  try { expect((await failedCommit.complete("saved"))["kind"]).toBe("failed"); }
  finally { rejectCommit.mockRestore(); await failedCommit.dispose(); }
  expect(await readClearBootstrapRow()).toEqual(beforeFailure);
  expect((await worker.backup.read(assigned.homeId)).receipts).toEqual(receipts);
  const old = await preparedBundle(worker, appId);
  try { expect((await old.complete("saved", success.identity))["kind"]).toBe("failed"); }
  finally { await old.dispose(); }
  const locked = await preparedBundle(worker, appId);
  await ask(worker, { kind: "lock" });
  await locked.dispose();
  worker.dispose();
  worker = createTestHandler().handler;
  await ask(worker, { kind: "unlock", passphrase: LOCAL });
  expect((await worker.backup.read(assigned.homeId)).receipts).toEqual(receipts);
  expect((await worker.backup.read(assigned.homeId)).lastSuccessfulBackupMs).toBe(confirmed.lastSuccessfulBackupMs);
  expect((await ask(worker, { kind: "openApp", appId })).session?.deviceOnlyChangeCount).toBe(1);
  expect((await ask(worker, { kind: "listLibrary" })).apps[0]?.durability?.deviceOnlyChangeCount).toBe(1);
  const current = await worker.backup.pin(appId);
  const graph = await worker.backup.exportGraph(assigned.homeId, current.operationId, new AbortController().signal);
  try {
    const frontier = graph.graph.manifest.confirmedFrontier;
    const covered = receipts![0]!.confirmedFrontier;
    expect(frontier[0]!.commitSequence - covered[0]!.commitSequence).toBe(1n);
  } finally { graph.dispose(); }
}, 120_000);

it.each(["native", "fallback-confirm", "fallback-dismiss"] as const)("composes %s with production data and IO handlers over dedicated channels", async (mode) => {
  const { DataWorkerClient } = await import("../../../src/workers/protocol/client.js");
  const { prepareBundle } = await import("../../../src/workers/protocol/io-client.js");
  const { receiveBundle } = await import("../../../src/workers/io/bundle.js");
  const { isPrepareBundle } = await import("../../../src/workers/protocol/io-messages.js");
  const { createFileSavePort } = await import("../../../src/platform/file-save.js");
  await resetLocalDatabase();
  worker = createTestHandler().handler;
  await ask(worker, { kind: "setup", passphrase: LOCAL });
  const appId = await importCsv(worker);
  const home = await worker.backup.createBundleHome(appId, "Client vault", VAULT);
  const handler = worker;
  let dataTask: Promise<void> | undefined;
  const client = new DataWorkerClient({ spawn: () => ({
    postMessage(value: unknown, ports: Transferable[]) {
      if (!isPrepareBundle(value)) throw new Error("unexpected RPC");
      const moved = structuredClone(ports, { transfer: ports }) as MessagePort[];
      dataTask = handler.backup.connectBundle(value.appId, moved[0]!, moved[1]!);
    }, terminate() { handler.dispose(); },
  }) as unknown as Worker });
  let stop: (() => void) | undefined;
  let terminated = 0;
  const io = { onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    postMessage(value: unknown, ports: Transferable[]) {
      expect(value).toBe("bundle-v1");
      const moved = structuredClone(ports, { transfer: ports }) as MessagePort[];
      stop = receiveBundle(moved[0]!, (blob, identity) => {
        io.onmessage?.({ data: { kind: "artifact", blob, identity } } as MessageEvent<unknown>);
      }, new AbortController().signal);
    }, terminate() { terminated++; stop?.(); },
  };
  const abort = new AbortController();
  const transfer = prepareBundle(client, io as unknown as Worker, appId, abort.signal);
  let savedBytes: Blob | undefined;
  let offered: Blob | undefined;
  const native = () => Promise.resolve({ createWritable: () => Promise.resolve({
    write(blob: Blob) { savedBytes = blob; return Promise.resolve(); }, close: () => Promise.resolve(), abort: () => Promise.resolve(),
  }) });
  if (mode !== "native") {
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => { if (!(blob instanceof Blob)) throw new Error("not a bundle"); offered = blob; return "blob:test"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal("document", { body: { append() {} }, createElement: () => ({
      click() { savedBytes = offered; }, remove() {},
    }) });
  }
  const destination = mode === "native" ? createFileSavePort(native) : createFileSavePort();
  try {
    const outcome = await destination.save(transfer.ready.then((result) => result.blob), abort.signal);
    expect(outcome).toBe(mode === "native" ? "saved" : "unconfirmed");
    expect((await handler.backup.read(home.homeId)).receipts ?? []).toEqual([]);
    expect((await handler.backup.read(home.homeId)).lastSuccessfulBackupMs).toBeNull();
    const prepared = await transfer.ready;
    if (mode === "fallback-dismiss") transfer.dispose();
    else await prepared.complete("saved");
    await expect(prepared.complete("saved")).rejects.toThrow("stale");
    await dataTask;
    expect(savedBytes?.size).toBeGreaterThan(1000);
    expect(terminated).toBe(1);
    expect((await handler.backup.read(home.homeId)).receipts ?? []).toHaveLength(mode === "fallback-dismiss" ? 0 : 1);
    if (mode !== "fallback-dismiss") expect((await handler.backup.read(home.homeId)).pins).toHaveLength(0);
    handler.dispose();
    worker = createTestHandler().handler;
    await ask(worker, { kind: "unlock", passphrase: LOCAL });
    expect((await worker.backup.read(home.homeId)).receipts ?? []).toHaveLength(mode === "fallback-dismiss" ? 0 : 1);
  } finally { abort.abort(); transfer.dispose(); client.terminate(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
}, 120_000);

it("reset and library read the same receipt across edit, cancellation, fresh save and restart; old reset tokens refuse", async () => {
  await resetLocalDatabase();
  worker = createTestHandler().handler;
  await ask(worker, { kind: "setup", passphrase: LOCAL });
  const appId = await importCsv(worker);
  const home = await worker.backup.createBundleHome(appId, "Reset vault", VAULT);
  const check = async (pending: number, time: number | null) => {
    await ask(worker!, { kind: "closeApp", appId });
    const inventory = await ask(worker!, { kind: "resetReadable" });
    if (inventory.phase !== "inventory") throw new Error("expected reset inventory");
    expect(inventory.inventory.apps[0]).toMatchObject({ appId, deviceOnlyChangeCount: pending, confirmedAtMs: time });
    expect((await ask(worker!, { kind: "listLibrary" })).apps[0]?.durability).toMatchObject({ deviceOnlyChangeCount: pending, confirmedAtMs: time });
    worker!.dispose(); worker = createTestHandler().handler;
    await ask(worker, { kind: "unlock", passphrase: LOCAL });
    expect((await ask(worker, { kind: "openApp", appId })).session).toMatchObject({ deviceOnlyChangeCount: pending, durability: { confirmedAtMs: time } });
    return inventory.confirmToken;
  };
  const first = await preparedBundle(worker, appId);
  try { expect((await first.complete("saved"))["kind"]).toBe("completed"); } finally { await first.dispose(); }
  const time = (await worker.backup.read(home.homeId)).lastSuccessfulBackupMs;
  await check(0, time);
  await ask(worker, { kind: "changeTheme", appId, themeKey: "indigo", mode: "light", density: "compact", customAccent: null, logo: { kind: "keep" } });
  await check(1, time);
  const cancelled = await preparedBundle(worker, appId);
  try { expect((await cancelled.complete("cancelled"))["kind"]).toBe("completed"); } finally { await cancelled.dispose(); }
  const token = await check(1, time);
  const fresh = await preparedBundle(worker, appId);
  try { expect((await fresh.complete("saved"))["kind"]).toBe("completed"); } finally { await fresh.dispose(); }
  const before = await readClearBootstrapRow();
  await expect(ask(worker, { kind: "resetReadable", confirmToken: token })).rejects.toMatchObject({ kind: "stale-confirmation" });
  expect(await readClearBootstrapRow()).toEqual(before);
  await check(0, (await worker.backup.read(home.homeId)).lastSuccessfulBackupMs);
}, 120_000);


it("releases a cancelled live pin and recovers an interrupted pin after restart without confirming or pruning another export", async () => {
  await resetLocalDatabase();
  worker = createTestHandler().handler;
  await ask(worker, { kind: "setup", passphrase: LOCAL });
  const appId = await importCsv(worker);
  const home = await worker.backup.createBundleHome(appId, "Interrupted", VAULT);
  const cancelled = await preparedBundle(worker, appId);
  await cancelled.dispose();
  expect((await worker.backup.read(home.homeId)).pins).toEqual([]);
  const interrupted = await preparedBundle(worker, appId);
  const pin = (await worker.backup.read(home.homeId)).pins[0]!;
  worker.dispose(); await interrupted.dispose();
  worker = createTestHandler().handler;
  await ask(worker, { kind: "unlock", passphrase: LOCAL });
  expect((await worker.backup.read(home.homeId)).pins).toEqual([pin]);
  expect((await worker.backup.read(home.homeId)).lastSuccessfulBackupMs).toBeNull();
  await ask(worker, { kind: "changeTheme", appId, themeKey: "indigo", mode: "light", density: "compact", customAccent: null, logo: { kind: "keep" } });
  const peer = await worker.backup.pin(appId);
  const recovered = await worker.backup.exportGraph(home.homeId, pin.operationId, new AbortController().signal);
  try { expect(await sha256Chunks(recovered.graph.canonicalAuthoredState(new AbortController().signal))).toHaveLength(32); }
  finally { recovered.dispose(); }
  await worker.backup.release(home.homeId, pin.operationId);
  expect(await getEnvelope(decodeStorageId16(pin.headStorageId))).toBeUndefined();
  expect((await worker.backup.read(home.homeId)).pins).toEqual([peer]);
  const stillLive = await worker.backup.exportGraph(home.homeId, peer.operationId, new AbortController().signal);
  stillLive.dispose();
  await worker.backup.release(home.homeId, peer.operationId);
  const fresh = await preparedBundle(worker, appId);
  try { expect((await fresh.complete("saved"))["kind"]).toBe("completed"); }
  finally { await fresh.dispose(); }
  expect((await worker.backup.read(home.homeId)).pins).toEqual([]);
  expect((await ask(worker, { kind: "listLibrary" })).apps[0]?.durability?.deviceOnlyChangeCount).toBe(0);
}, 120_000);

it("keeps receipt authority and exact all-device pending counts across physical compaction", async () => {
  const backupHandlers = await import("../../../src/workers/data/backup-handlers.js");
  const { AppSessionRegistry } = await import("../../../src/workers/data/app-session.js");
  const { compactApp } = await import("../../../src/workers/data/compaction.js");
  const create = backupHandlers.createBackupHandlers;
  let deps: Parameters<typeof create>[0] | undefined;
  const capture = vi.spyOn(backupHandlers, "createBackupHandlers").mockImplementation((input) => { deps = input; return create(input); });
  const sessions = vi.spyOn(AppSessionRegistry.prototype, "set");
  try {
    await resetLocalDatabase();
    worker = createTestHandler().handler;
    await ask(worker, { kind: "setup", passphrase: LOCAL });
    const appId = await importCsv(worker);
    const assigned = await worker.backup.createBundleHome(appId, "Compaction receipt vault", VAULT);
    const saved = await preparedBundle(worker, appId);
    try { expect((await saved.complete("saved"))["kind"]).toBe("completed"); } finally { await saved.dispose(); }
    const confirmed = await worker.backup.read(assigned.homeId);
    const pending = async () => (await ask(worker!, { kind: "openApp", appId })).session!;
    expect((await pending()).deviceOnlyChangeCount).toBe(0);
    const compact = async () => {
      const session = sessions.mock.calls.at(-1)![1];
      const before = session.repository.loaded().head.frontier;
      const result = await compactApp({ ...deps!, session }, new AbortController().signal);
      expect(result.head.frontier).toEqual(before);
    };
    await compact();
    expect(await worker.backup.read(assigned.homeId)).toEqual(confirmed);
    expect(await pending()).toMatchObject({ deviceOnlyChangeCount: 0, durability: { confirmedAtMs: confirmed.lastSuccessfulBackupMs, deviceOnlyChangeCount: 0 } });
    await ask(worker, { kind: "changeTheme", appId, themeKey: "indigo", mode: "light", density: "compact", customAccent: null, logo: { kind: "keep" } });
    expect((await pending()).deviceOnlyChangeCount).toBe(1);
    await compact();
    expect(await worker.backup.read(assigned.homeId)).toEqual(confirmed);
    expect(await pending()).toMatchObject({ deviceOnlyChangeCount: 1, durability: { confirmedAtMs: confirmed.lastSuccessfulBackupMs, deviceOnlyChangeCount: 1 } });
    expect((await ask(worker, { kind: "listLibrary" })).apps[0]?.durability).toMatchObject({ confirmedAtMs: confirmed.lastSuccessfulBackupMs, deviceOnlyChangeCount: 1 });
  } finally { sessions.mockRestore(); capture.mockRestore(); await resetLocalDatabase(); }
}, 120_000);
