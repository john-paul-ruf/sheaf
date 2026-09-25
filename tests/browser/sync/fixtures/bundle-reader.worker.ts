import { openBundle } from "../../../../src/sync/providers/bundle/reader.js";
import { createVaultCrypto } from "../../../../src/crypto/vault-port.js";
import { envelopeCryptoAdapter } from "../../../../src/workers/data/import-handlers.js";
import { decodeAppHead, decodeCheckpointManifest, decodeRecordPage, resolveCheckpointManifest, type AppHead } from "../../../../src/import/staging/roots.js";
import { compareCommits, decodeEventSegment } from "../../../../src/persistence/codecs/event-commit.js";
import { executeQuery, authoredRecords, authoredState, applyEvents, disposeProjection, hydrateApp, openProjection } from "../../../../src/persistence/projection/index.js";
import { engineAdapter, tableContexts, toProjectionCheckpoint, toProjectionCommit } from "../../../../src/workers/data/app-session.js";
import type { LoadedAppV1 } from "../../../../src/workers/data/event-store.js";
import type { EventCommitV1 } from "../../../../src/migrations/004_event_format_v1.js";
import { sha256 } from "../../../../src/crypto/hash.js";
import type { ChangeHistoryCursorV1, ProjectionChangeHistoryPageV1 } from "../../../../src/persistence/projection/types.js";
import type { ProjectionHandleV1 } from "../../../../src/persistence/projection/engine.js";
import { selectRows } from "../../../../src/persistence/projection/engine.js";
import { recoverBackupGraph, openBackupGraphProjection } from "../../../../src/workers/data/backup-graph.js";
import { encodeBase64Url } from "../../../../src/domain/model/bytes.js";
import { sha256Chunks } from "../../../../src/crypto/hash.js";
import { decodeCanonical, type CborValue } from "../../../../src/persistence/codecs/canonical-cbor.js";

function historyOf(handle: ProjectionHandleV1) {
  const history = [];
  let after: ChangeHistoryCursorV1 | null = null;
  for (;;) {
    const page: ProjectionChangeHistoryPageV1 = executeQuery(handle, { kind: "page-change-history", after, limit: 128 });
    history.push(...page.events);
    if (!page.hasMore) break;
    if (page.nextCursor === null) throw new Error("history pagination lost its cursor");
    after = page.nextCursor;
  }
  return history;
}

/**
 * The J3 oracle: the retained original import checkpoint hydrated through the
 * V1 session mapping, then every original authenticated commit it does not
 * cover replayed one at a time. It never touches the V2 candidate checkpoint.
 */
async function replayOracle(read: (storageId: string, kind: "app.checkpoint-manifest" | "app.record-page") => Promise<Uint8Array>, head: AppHead,
  originals: readonly EventCommitV1[], signal: AbortSignal) {
  const root = head.headVersion === 2 ? head.retainedRoots.find((ref) => ref.payloadKind === "app.checkpoint-manifest") : head.checkpoint;
  if (root === undefined) throw new Error("no retained original import checkpoint");
  const manifest = decodeCheckpointManifest(await read(root.storageId, "app.checkpoint-manifest"));
  const recordPages = [];
  for (const ref of manifest.recordPages) recordPages.push(decodeRecordPage(await read(ref.storageId, "app.record-page")));
  const loaded = { appId: head.appId, head: { ...head, checkpoint: { ...head.checkpoint, storageId: root.storageId, semanticSha256: root.semanticSha256 } },
    headStorageId: "", checkpoint: manifest, recordPages, commits: originals } as LoadedAppV1;
  const key = (table: Uint8Array, record: Uint8Array) => `${encodeBase64Url(table)}:${encodeBase64Url(record)}`;
  const live = new Set(recordPages.flatMap((page) => page.records.map((record) => key(record.tableId, record.recordId))));
  const checkpoint = resolveCheckpointManifest(manifest);
  const handle = await openProjection({ sha256, clock: () => ({ epochMs: 0, epochDay: 0 }) });
  try {
    await hydrateApp(handle, toProjectionCheckpoint(loaded, checkpoint, tableContexts(checkpoint, (table, record) => live.has(key(table, record))), 0));
    const covered = new Map(manifest.frontier.map((entry) => [encodeBase64Url(entry.deviceId), entry.commitSequence]));
    let replayed = 0;
    for (const commit of originals) {
      if (commit.deviceCommitSequence <= (covered.get(encodeBase64Url(commit.deviceId)) ?? 0n)) continue;
      await applyEvents(handle, [toProjectionCommit(engineAdapter(handle), commit)]);
      replayed++;
    }
    return { checkpointStorageId: root.storageId, replayed, authoredSha256: encodeBase64Url(await sha256Chunks(authoredState(handle, signal), signal)),
      history: historyOf(handle), records: [...authoredRecords(handle, signal)] };
  } finally { disposeProjection(handle); }
}

const ports = { crypto: envelopeCryptoAdapter, vaultCrypto: createVaultCrypto({ randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)) }) };
self.onmessage = async ({ data }: MessageEvent<{ bytes: number[]; secret: { kind: "passphrase" | "recovery"; value: string } }>) => {
  try {
    const bundle = await openBundle(new Blob([new Uint8Array(data.bytes)]), data.secret, ports, new AbortController().signal);
    try {
      const app = await bundle.openApp(bundle.index.apps[0]!.appId);
      const signal = new AbortController().signal;
      const graph = await recoverBackupGraph(ports.crypto, app, signal);
      const chunks = [];
      for await (const chunk of graph.canonicalAuthoredState(signal)) chunks.push(...chunk);
      const authored = decodeCanonical(Uint8Array.from(chunks)) as ReadonlyMap<string, CborValue>;
      const theme = decodeCanonical((authored.get("app") as readonly (readonly CborValue[])[])[0]![4] as Uint8Array);
      const semanticSha256 = encodeBase64Url(await sha256Chunks(graph.canonicalAuthoredState(signal), signal));
      const checkpoint = decodeCanonical(await app.read(app.manifest.checkpoint, "app.checkpoint-manifest"));
      const events = [];
      for (const ref of app.manifest.eventSegments) events.push(decodeCanonical(await app.read(ref, "app.event-segment")));
      const head = decodeAppHead(await app.read(app.manifest.retainedRoots[0]!, "app.head"));
      const recordVersions = [];
      for (const object of graph.objects) if (object.payloadKind === "app.record-page") {
        recordVersions.push({ storageId: encodeBase64Url(object.reference.storageId), pageVersion: decodeRecordPage(await app.read(object.reference, "app.record-page")).pageVersion });
      }
      const originals = new Map<string, ReturnType<typeof decodeEventSegment>["commits"][number]>();
      for (const object of graph.objects) if (object.payloadKind === "app.event-segment") {
        for (const commit of decodeEventSegment(await app.read(object.reference, "app.event-segment")).commits) originals.set(encodeBase64Url(commit.commitId), commit);
      }
      const projection = await openBackupGraphProjection(graph, signal);
      let evidence;
      try {
        evidence = { history: historyOf(projection.handle), records: [...authoredRecords(projection.handle, signal)],
          authoredSha256: encodeBase64Url(await sha256Chunks(authoredState(projection.handle, signal), signal)),
          baselineScopes: selectRows(projection.handle, "SELECT * FROM baseline_scopes ORDER BY baseline_scope_id"),
          baselineRecords: selectRows(projection.handle, "SELECT * FROM baseline_records ORDER BY baseline_scope_id, table_id, record_id"),
          conflicts: selectRows(projection.handle, "SELECT * FROM pending_conflicts ORDER BY conflict_id"),
          merges: selectRows(projection.handle, "SELECT * FROM applied_merges ORDER BY merge_id") };
      } finally { projection.dispose(); }
      const byId = new Map(graph.objects.map((object) => [encodeBase64Url(object.reference.storageId), object.reference]));
      const oracle = await replayOracle((id, kind) => app.read(byId.get(id)!, kind), head, [...originals.values()].sort(compareCommits), signal);
      const json = JSON.stringify({ authored, theme, semanticSha256, head, recordVersions, evidence, oracle,
        originalCommits: [...originals.values()].sort(compareCommits), deviceChains: graph.deviceChains, checkpointChains: graph.checkpointChains, kinds: graph.objects.map((object) => object.payloadKind), checkpoint, events, frontier: app.manifest.confirmedFrontier }, (_, value: unknown): unknown =>
        typeof value === "bigint" ? value.toString() : value instanceof Map ? Object.fromEntries(value) : value instanceof Uint8Array ? Array.from(value) : value);
      self.postMessage({ ok: true, result: json });
    } finally { bundle.close(); }
  } catch { self.postMessage({ ok: false }); }
};
