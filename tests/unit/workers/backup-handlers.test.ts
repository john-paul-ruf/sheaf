import "fake-indexeddb/auto";
import { sha256Chunks } from "../../../src/crypto/hash.js";
import { afterEach, expect, it } from "vitest";
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
