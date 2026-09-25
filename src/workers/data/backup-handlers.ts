import { sha256Chunks } from "../../crypto/hash.js";
import { bundleChunks } from "../../sync/providers/bundle/format.js";
import { buildPublicationCandidate, readPublicationCandidate, readPublicationObject } from "../../sync/protocol/publication.js";
import { createIoChannel } from "../protocol/io-channel.js";
import { ioRecord, isBundleIdentity, sameBundleIdentity, type BundleIdentityV1 } from "../protocol/io-messages.js";
import { encodeBase64Url, constantTimeEquals } from "../../domain/model/bytes.js";
import { exportBackupGraph } from "./backup-graph.js";
import { buildHomeAssignment } from "../../application/commands/home-commands.js";
import type { ClockPort } from "../../application/ports/clock.js";
import type { VaultCryptoPort, VaultKeyRefV1 } from "../../application/ports/vault-crypto.js";
import { asStorageId16, decodeStorageId16, encodeStorageId16 } from "../../domain/model/bytes.js";
import { createDomainId, decodeDomainId, encodeDomainId } from "../../domain/model/ids.js";
import { IntegrityError } from "../../domain/model/errors.js";
import { CURRENT_FORMAT_VERSIONS } from "../../migrations/index.js";
import { parseEnvelopeTransport } from "../../persistence/codecs/envelope-frame.js";
import { validateLocalCatalog, type LocalCatalogHomeEntryV1, type LocalCatalogV1 } from "./catalog.js";
import { createEventStore, loadApp, readAppHead, openAppKey, type AppStoragePortsV1, type WorkerSessionContextV1 } from "./event-store.js";
import { encodeHomeState, readHomeState, type BackupPinV1, type HomeStateV1 } from "./home-state.js";

export interface BackupHandlerDependenciesV1 {
  readonly ports: AppStoragePortsV1;
  readonly clock: ClockPort;
  readonly vaultCrypto: VaultCryptoPort;
  readonly getContext: () => WorkerSessionContextV1;
  readonly closeApp: (appId: string) => void;
}

/** Worker-owned assignment and retention; no caller-supplied frontier or receipt. */
export function createBackupHandlers(deps: BackupHandlerDependenciesV1) {
  const { ports } = deps;
  let epoch = 0;
  const exports = new Set<{ operationId: string; dispose: () => void }>();
  const transfers = new Set<AbortController>();
  const savingApps = new Set<string>();
  const releasing = new Set<string>();
  const disposeAll = () => {
    epoch++;
    for (const controller of transfers) controller.abort();
    for (const operation of exports) operation.dispose();
  };
  const fresh = () => asStorageId16(ports.entropy.randomBytes(16));
  const assertLive = (context: WorkerSessionContextV1) => {
    const live = deps.getContext();
    if (live.localRoot !== context.localRoot || live.transactionRevision !== context.transactionRevision) {
      throw new IntegrityError("backup operation belongs to a stale session");
    }
  };
  const appEntry = (context: WorkerSessionContextV1, appId: string) => {
    decodeDomainId("app", appId);
    const app = context.catalog.apps.find((entry) => entry.appId === appId);
    if (app === undefined || app.appHeadStorageId === null || app.wrappedAppKey === null) {
      throw new IntegrityError("backup requires a locally held app");
    }
    return app;
  };
  const homeEntry = (context: WorkerSessionContextV1, homeId: string) => {
    const home = context.catalog.homes.find((entry) => entry.homeId === homeId);
    if (home === undefined) throw new IntegrityError("unknown durable home");
    return home;
  };
  const sealState = async (context: WorkerSessionContextV1, state: HomeStateV1) => {
    const storageId = fresh();
    const frame = await ports.crypto.seal({ scope: "local.home", payloadKind: "local.home-state",
      storageId, logicalRevision: BigInt(context.transactionRevision + 1), payload: encodeHomeState(state),
      compression: "deflate-raw-v1", key: context.localRoot });
    return { frame, storageId: encodeStorageId16(storageId) };
  };

  async function assign(context: WorkerSessionContextV1, appId: string, state: HomeStateV1,
    vaultKey: VaultKeyRefV1, existing?: LocalCatalogHomeEntryV1): Promise<void> {
    const app = appEntry(context, appId);
    if (app.homeId !== null) throw new IntegrityError("only a scratch app may receive a home");
    const appKey = await openAppKey(ports, context.localRoot, app, parseEnvelopeTransport);
    try {
      const loaded = await loadApp(ports, appKey, app.appHeadStorageId!);
      if (encodeDomainId(loaded.appId) !== appId) throw new IntegrityError("catalog points at another app");
      const wrappedAppKey = await deps.vaultCrypto.wrapApp(appKey, vaultKey,
        decodeDomainId("vault", state.vaultId), loaded.appId);
      if (state.appKeys.some((entry) => entry.appId === appId)) throw new IntegrityError("duplicate app wrap");
      const nextState = { ...state, appKeys: [...state.appKeys, { appId, wrappedAppKey }] };
      const sealed = await sealState(context, nextState);
      const home: LocalCatalogHomeEntryV1 = { homeId: state.homeId, vaultId: state.vaultId, kind: state.kind,
        homeStateStorageId: sealed.storageId, providerAccountId: null, vaultLocation: null };
      const repository = createEventStore({ ports, session: () => { assertLive(context); return context; },
        deviceId: decodeDomainId("device", context.catalog.deviceId) }, appKey, loaded);
      const plan = buildHomeAssignment({ clock: deps.clock, entropy: ports.entropy }, repository.chainState(), app.homeId,
        { homeId: decodeDomainId("home", state.homeId), vaultId: decodeDomainId("vault", state.vaultId),
          homeKind: state.kind, wrappedAppKeyVersion: 1 });
      const update = (catalog: LocalCatalogV1) => validateLocalCatalog({ ...catalog,
        apps: catalog.apps.map((entry) => entry.appId === appId ? { ...entry, homeId: home.homeId, scratchReminder: null } : entry),
        homes: [...catalog.homes.filter((entry) => existing === undefined || entry.homeId !== existing.homeId), home] });
      update(context.catalog);
      assertLive(context);
      await repository.appendHome({ plan, rowCountAfter: app.rowCountCache ?? loaded.recordPages.reduce((sum, page) => sum + page.records.length, 0) },
        [sealed.frame], update, existing === undefined ? [] : [existing.homeStateStorageId]);
      deps.closeApp(appId);
    } finally { ports.crypto.destroyKey(appKey); }
  }

  async function replaceState(context: WorkerSessionContextV1, entry: LocalCatalogHomeEntryV1,
    state: HomeStateV1, deletes: readonly string[] = [], guard: () => void = () => undefined): Promise<void> {
    const sealed = await sealState(context, state);
    const catalog = validateLocalCatalog({ ...context.catalog, catalogRevision: context.catalog.catalogRevision + 1,
      homes: context.catalog.homes.map((home) => home.homeId === entry.homeId ? { ...home, homeStateStorageId: sealed.storageId } : home) });
    const sealedCatalog = await context.sealCatalog(catalog, context.transactionRevision + 1);
    assertLive(context);
    guard();
    const transactionRevision = await ports.store.commit({ expectedRevision: context.transactionRevision,
      expectedWriterEpoch: context.writerEpoch, addFrames: [sealed.frame, sealedCatalog.frame],
      deleteStorageIds: [entry.homeStateStorageId, ...deletes].map(decodeStorageId16),
      bootstrapPatch: { catalogStorageId: sealedCatalog.storageId } });
    context.adopt({ catalog, catalogStorageId: sealedCatalog.storageId, transactionRevision });
  }

  async function releasedPin(context: WorkerSessionContextV1, state: HomeStateV1, operationId: string) {
    const pin = state.pins.find((candidate) => candidate.operationId === operationId);
    if (pin === undefined) throw new IntegrityError("unknown backup operation");
    const pins = state.pins.filter((candidate) => candidate.operationId !== operationId);
    const current = context.catalog.apps.some((app) => app.appHeadStorageId === pin.headStorageId);
    let retained = pins.some((candidate) => candidate.headStorageId === pin.headStorageId);
    if (!current && !retained) {
      const app = appEntry(context, pin.appId);
      const key = await openAppKey(ports, context.localRoot, app, parseEnvelopeTransport);
      try {
        const head = await readAppHead(ports, key, app.appHeadStorageId!);
        retained = head.retainedRoots.some((root) => root.storageId === pin.headStorageId);
      } finally { ports.crypto.destroyKey(key); }
    }

    return { state: { ...state, pins }, deletes: current || retained ? [] : [pin.headStorageId] };
  }

  const api = {
    disposeAll,
    async connectBundle(appId: string, io: MessagePort, control: MessagePort): Promise<void> {
      const controller = new AbortController();
      const signal = controller.signal;
      transfers.add(controller);
      let exported: Awaited<ReturnType<typeof api.exportGraph>> | undefined;
      let vaultKey: VaultKeyRefV1 | undefined;
      let identity: BundleIdentityV1 | undefined;
      let complete: ((value: Record<string, unknown>) => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const openedEpoch = epoch;
      let ownsApp = false;
      let context: WorkerSessionContextV1 | undefined;
      const assertSession = () => {
        signal.throwIfAborted();
        if (epoch !== openedEpoch || deps.getContext().localRoot !== context?.localRoot) throw new IntegrityError("bundle session ended");
      };
      control.onmessage = (event: MessageEvent<unknown>) => {
        try {
          const message = ioRecord(event.data);
          if (message["kind"] === "cancel") { controller.abort(); return; }
          if (complete === undefined || identity === undefined || message["kind"] !== "complete" ||
              Object.keys(message).sort().join() !== "identity,kind,outcome" ||
              !isBundleIdentity(message["identity"]) || !sameBundleIdentity(identity, message["identity"]) ||
              !["saved", "cancelled", "failed", "unconfirmed"].includes(String(message["outcome"]))) throw new IntegrityError("invalid bundle completion");
          const accept = complete;
          complete = undefined;
          accept(message);
        } catch { controller.abort(); }
      };
      control.start();
      try {
        context = deps.getContext();
        if (savingApps.has(appId)) throw new IntegrityError("bundle already in progress");
        savingApps.add(appId);
        ownsApp = true;
        const app = appEntry(context, appId);
        if (app.homeId === null) throw new IntegrityError("scratch app has no home");
        const homeId = app.homeId;
        const pin = await api.pin(appId);
        assertSession();
        const state = await api.read(homeId);
        exported = await api.exportGraph(homeId, pin.operationId, signal);
        vaultKey = await deps.vaultCrypto.openLocally(state.locallyWrappedVaultKey, context.localRoot, decodeDomainId("vault", state.vaultId));
        assertSession();
        const pinnedHead = await readAppHead(ports, exported.appKey, pin.headStorageId);
        // Each manual file is a self-contained current-app vault, not a cloud replacement.
        const candidate = await buildPublicationCandidate({ base: { kind: "create", secrets: state.secrets },
          appKey: exported.appKey, vaultKey, graph: exported.graph,
          vaultId: decodeDomainId("vault", state.vaultId), homeId: decodeDomainId("home", homeId),
          app: { displayName: app.displayName, appSchemaRevision: pinnedHead.schemaRevision }, committedAtMs: BigInt(deps.clock.nowEpochMs()) },
          { ...ports, vaultCrypto: deps.vaultCrypto, hashChunks: sha256Chunks }, signal);
        const contents = readPublicationCandidate(candidate);
        const send = createIoChannel(io, signal);
        async function* transmit() {
          for await (const bytes of bundleChunks({ ...contents, read: (id, readSignal) => readPublicationObject(candidate, id, readSignal) }, signal)) {
            await send({ kind: "chunk", bytes });
            yield bytes;
          }
        }
        const artifactSha256 = encodeBase64Url(await sha256Chunks(transmit(), signal));
        identity = { operationId: pin.operationId, appId, homeId, artifactSha256 };
        await send({ kind: "finish", identity });
        assertSession();
        const outcome = await new Promise<Record<string, unknown>>((resolve, reject) => {
          complete = resolve;
          timer = setTimeout(() => { controller.abort(); }, 300_000);
          signal.addEventListener("abort", () => { reject(new IntegrityError("bundle cancelled")); }, { once: true });
          control.postMessage({ kind: "ready", identity });
        });
        assertSession();
        exported.dispose();
        if (outcome["outcome"] === "saved") {
          const current = deps.getContext();
          const entry = homeEntry(current, homeId);
          const home = await readHomeState(ports, current, entry);
          if (appEntry(current, appId).homeId !== homeId || home.vaultId !== state.vaultId ||
              !home.pins.some((item) => item.operationId === pin.operationId && item.headStorageId === pin.headStorageId)) throw new IntegrityError("stale bundle completion");
          const currentApp = appEntry(current, appId);
          const currentKey = await openAppKey(ports, current.localRoot, currentApp, parseEnvelopeTransport);
          try {
            const head = await readAppHead(ports, currentKey, currentApp.appHeadStorageId!);
            for (const covered of contents.snapshot.confirmedFrontier) {
              const local = head.frontier.find((item) => constantTimeEquals(item.deviceId, covered.deviceId));
              if (local === undefined || local.commitSequence < covered.commitSequence) throw new IntegrityError("bundle receipt is ahead of local state");
            }
          } finally { ports.crypto.destroyKey(currentKey); }
          const previous = home.receipts?.find((receipt) => receipt.appId === appId);
          for (const covered of previous?.confirmedFrontier ?? []) {
            const next = contents.snapshot.confirmedFrontier.find((item) => constantTimeEquals(item.deviceId, covered.deviceId));
            if (next === undefined || next.commitSequence < covered.commitSequence) throw new IntegrityError("bundle receipt regresses");
          }
          const released = await releasedPin(current, home, pin.operationId);
          const confirmedAtMs = deps.clock.nowEpochMs();
          assertSession();
          await replaceState(current, entry, { ...released.state, lastSuccessfulBackupMs: confirmedAtMs,
            receipts: [...(home.receipts ?? []).filter((receipt) => receipt.appId !== appId),
              { appId, operationId: pin.operationId, artifactSha256, candidateSha256: contents.snapshot.candidateSha256, generation: contents.snapshot.generation,
                confirmedFrontier: contents.snapshot.confirmedFrontier, confirmedAtMs }] }, released.deletes, assertSession);
        } else {
          await api.release(homeId, pin.operationId);
        }
        control.postMessage({ kind: "completed", identity, outcome: outcome["outcome"] });
      } catch {
        control.postMessage({ kind: "failed" });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        controller.abort();
        exported?.dispose();
        if (vaultKey !== undefined) deps.vaultCrypto.destroy(vaultKey);
        transfers.delete(controller);
        if (ownsApp) savingApps.delete(appId);
        control.close();
        io.close();
      }
    },
    async createBundleHome(appId: string, displayName: string, passphrase: string) {
      const context = deps.getContext();
      if (appEntry(context, appId).homeId !== null) throw new IntegrityError("app already has a home");
      const homeId = encodeDomainId(createDomainId("home", ports.entropy));
      const vault = createDomainId("vault", ports.entropy);
      const created = await deps.vaultCrypto.create(passphrase, vault);
      try {
        const { key, ...secrets } = created;
        const state: HomeStateV1 = { homeStateVersion: CURRENT_FORMAT_VERSIONS.vault,
          homeId, vaultId: encodeDomainId(vault), kind: "bundle", displayName: displayName.trim().normalize("NFC"), secrets,
          locallyWrappedVaultKey: await deps.vaultCrypto.protectLocally(key, context.localRoot, vault),
          appKeys: [], pins: [], lastSuccessfulBackupMs: null };
        await assign(context, appId, state, key);
        return { homeId, vaultId: state.vaultId, recoveryCode: created.recoveryCode };
      } finally { deps.vaultCrypto.destroy(created.key); }
    },
    async assignBundleHome(appId: string, homeId: string, passphrase: string): Promise<void> {
      const context = deps.getContext();
      const entry = homeEntry(context, homeId);
      const state = await readHomeState(ports, context, entry);
      const key = await deps.vaultCrypto.openWithPassphrase(passphrase, decodeDomainId("vault", state.vaultId),
        state.secrets.passphraseKdf, state.secrets.passphraseWrappedVaultKey);
      try { await assign(context, appId, state, key, entry); }
      finally { deps.vaultCrypto.destroy(key); }
    },
    async read(homeId: string): Promise<HomeStateV1> {
      const context = deps.getContext();
      return readHomeState(ports, context, homeEntry(context, homeId));
    },
    async pin(appId: string): Promise<BackupPinV1> {
      const context = deps.getContext();
      const app = appEntry(context, appId);
      if (app.homeId === null) throw new IntegrityError("scratch app has no backup destination");
      const entry = homeEntry(context, app.homeId);
      const state = await readHomeState(ports, context, entry);
      const key = await openAppKey(ports, context.localRoot, app, parseEnvelopeTransport);
      try {
        const head = await readAppHead(ports, key, app.appHeadStorageId!);
        if (encodeDomainId(head.appId) !== appId) throw new IntegrityError("backup head belongs to another app");
        const pin: BackupPinV1 = { operationId: encodeStorageId16(fresh()), appId, headStorageId: app.appHeadStorageId! };
        await replaceState(context, entry, { ...state, pins: [...state.pins, pin] });
        return pin;
      } finally { ports.crypto.destroyKey(key); }
    },
    async exportGraph(homeId: string, operationId: string, signal: AbortSignal): Promise<{ graph: import("../../application/ports/backup.js").BackupAppGraphV1; appKey: import("../../application/ports/envelope-crypto.js").EnvelopeKeyRefV1; dispose: () => void }> {
      signal.throwIfAborted();
      if (releasing.has(operationId)) throw new IntegrityError("backup operation is being released");
      const context = deps.getContext();
      const openedEpoch = epoch;
      const controller = new AbortController();
      const lifetime = AbortSignal.any([signal, controller.signal]);
      let appKey: Awaited<ReturnType<typeof openAppKey>> | undefined;
      const operation = { operationId, dispose: () => {
        controller.abort(new IntegrityError("backup export has been disposed"));
        if (appKey !== undefined) { ports.crypto.destroyKey(appKey); appKey = undefined; }
        exports.delete(operation);
        lifetime.removeEventListener("abort", operation.dispose);
      } };
      exports.add(operation);
      lifetime.addEventListener("abort", operation.dispose, { once: true });
      try {
        const state = await readHomeState(ports, context, homeEntry(context, homeId));
        const pin = state.pins.find((pin) => pin.operationId === operationId);
        if (pin === undefined) throw new IntegrityError("unknown backup operation");
        const app = appEntry(context, pin.appId);
        if (app.homeId !== homeId) throw new IntegrityError("backup operation belongs to another home");
        appKey = await openAppKey(ports, context.localRoot, app, parseEnvelopeTransport);
        lifetime.throwIfAborted();
        const graph = await exportBackupGraph(ports, appKey, pin, lifetime);
        lifetime.throwIfAborted();
        if (epoch !== openedEpoch || deps.getContext().localRoot !== context.localRoot) throw new IntegrityError("backup session ended");
        return { graph: { ...graph,
          async readObject(this: void, id: Uint8Array, readSignal: AbortSignal) {
            readSignal.addEventListener("abort", operation.dispose, { once: true });
            try { return await graph.readObject(id, readSignal); }
            catch (cause) { operation.dispose(); throw cause; }
            finally { readSignal.removeEventListener("abort", operation.dispose); }
          },
          async *canonicalAuthoredState(this: void, readSignal: AbortSignal) {
            readSignal.addEventListener("abort", operation.dispose, { once: true });
            try { yield* graph.canonicalAuthoredState(readSignal); }
            catch (cause) { operation.dispose(); throw cause; }
            finally { readSignal.removeEventListener("abort", operation.dispose); }
          },
        }, appKey, dispose: operation.dispose };
      } catch (cause) { operation.dispose(); throw cause; }
    },
    async release(homeId: string, operationId: string): Promise<void> {
      if (releasing.has(operationId)) throw new IntegrityError("backup operation is being released");
      releasing.add(operationId);
      for (const operation of exports) if (operation.operationId === operationId) operation.dispose();
      try {
        const context = deps.getContext();
        const entry = homeEntry(context, homeId);
        const state = await readHomeState(ports, context, entry);
        const released = await releasedPin(context, state, operationId);
        await replaceState(context, entry, released.state, released.deletes);
      } finally { releasing.delete(operationId); }
    },
  };
  return api;
}

export type BackupHandlersV1 = ReturnType<typeof createBackupHandlers>;
