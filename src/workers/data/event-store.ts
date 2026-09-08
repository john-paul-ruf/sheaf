/**
 * The durable event log of one app, as the data worker owns it (M33; CA-08 /
 * CA-11 producer, CAP-16/CAP-17).
 *
 * Two jobs live here. Reading: open the app key from the catalog, resolve the
 * head, and verify every root it names against its own recorded digest before
 * a single byte of it is believed. Writing: turn a command's plan into a
 * sealed commit, a new segment, a new head, and an updated catalog — in **one**
 * `commitEnvelopes` transaction, because a head that names a segment the store
 * does not hold, or a catalog that points at a head that was never written,
 * are both states from which nothing can recover.
 *
 * **D27, as implemented.** One `EventSegmentV1` envelope per commit, and the
 * head's `eventSegments` grows by one each time. That is the shape promotion
 * established and the shape F05's compaction will start from.
 *
 * **Envelopes are immutable.** "Updating" the head means sealing a new one at a
 * fresh storage id, repointing the catalog entry at it, and deleting the one it
 * supersedes — a pointer swap inside the same transaction, exactly as M23's
 * stage rewrites work. Nothing can reach the old head the moment the new
 * catalog lands, so it is deleted outright rather than ticketed.
 *
 * **The digest is recomputed, never trusted.** `semanticSha256` on the head, the
 * checkpoint, every record page, and every segment is checked against the bytes
 * it claims to describe. A mismatch fails closed as an integrity condition
 * rather than hydrating an app out of something that has been altered.
 */

import {
  asStorageId16,
  decodeStorageId16,
  encodeStorageId16,
} from "../../domain/model/bytes.js";
import { CodecError, IntegrityError } from "../../domain/model/errors.js";
import {
  asDomainId,
  compareDomainIds,
  encodeDomainId,
  type AppId,
  type DeviceId,
} from "../../domain/model/ids.js";
import type { EntropyPort } from "../../application/ports/entropy.js";
import type {
  EnvelopeCryptoPort,
  EnvelopeKeyRefV1,
} from "../../application/ports/envelope-crypto.js";
import type { EnvelopeStorePort } from "../../application/ports/envelope-store.js";
import type { SealedCatalogV1 } from "../../application/ports/staging-catalog.js";
import type {
  AppChainStateV1,
  CommitAppendRequestV1,
  CommitReceiptV1,
  CommitPlanV1,
  LocalEventRepository,
} from "../../application/ports/event-repository.js";
import type {
  EventCommitV1,
  DomainEventV1,
  FrontierEntryV1,
} from "../../migrations/004_event_format_v1.js";
import {
  compareCommits,
  encodeEventSegment,
  decodeEventSegment,
  sealEventCommit,
  sortCommitsCanonically,
  sortFrontier,
  type EventCommitBodyV1,
} from "../../persistence/codecs/event-commit.js";
import {
  decodeAppHead,
  decodeCheckpointManifest,
  decodeRecordPage,
  encodeAppHead,
  encodeAppHeadBody,
  type AppHeadV1,
  type CheckpointManifestV1,
  type RecordPageV1,
  type StorageRefV1,
} from "../../import/staging/roots.js";
import { encodeRecordEventPayload } from "./record-event-payloads.js";
import type { LocalCatalogAppEntryV1, LocalCatalogV1 } from "./catalog.js";

const STORAGE_ID_BYTES = 16;

export interface AppStoragePortsV1 {
  readonly store: EnvelopeStorePort;
  readonly crypto: EnvelopeCryptoPort;
  readonly entropy: EntropyPort;
}

/**
 * The live unlocked session, read fresh on every write. It is the same shape
 * the import handlers are given — `ImportSessionContextV1` satisfies it
 * structurally — because both are the same fact: one decrypted catalog, one
 * local root, and the revision the next transaction must expect.
 */
export interface WorkerSessionContextV1 {
  readonly localRoot: EnvelopeKeyRefV1;
  readonly catalog: LocalCatalogV1;
  readonly catalogStorageId: string;
  readonly transactionRevision: number;
  readonly writerEpoch: number;
  adopt(next: {
    readonly catalog: LocalCatalogV1;
    readonly catalogStorageId: string;
    readonly transactionRevision: number;
  }): void;
  sealCatalog(
    catalog: LocalCatalogV1,
    logicalRevision: number,
  ): Promise<SealedCatalogV1>;
}

/** The app's durable roots, decoded and verified. */
export interface LoadedAppV1 {
  readonly appId: AppId;
  readonly head: AppHeadV1;
  readonly headStorageId: string;
  readonly checkpoint: CheckpointManifestV1;
  readonly recordPages: readonly RecordPageV1[];
  /** Every commit the head names, in canonical order. */
  readonly commits: readonly EventCommitV1[];
}

/**
 * Unwraps an app's key from its catalog entry. The key was sealed under the
 * local root at promotion and carried as transport bytes — the same shape D10
 * established for the recovery-code view, because M08 exposes no way to read a
 * key handle's bytes back.
 */
export async function openAppKey(
  ports: AppStoragePortsV1,
  localRoot: EnvelopeKeyRefV1,
  entry: LocalCatalogAppEntryV1,
  parseTransport: (bytes: Uint8Array) => Parameters<EnvelopeCryptoPort["open"]>[0],
): Promise<EnvelopeKeyRefV1> {
  if (entry.wrappedAppKey === null) {
    throw new IntegrityError("app entry carries no key");
  }
  const opened = await ports.crypto.open(
    parseTransport(entry.wrappedAppKey),
    "local.catalog",
    localRoot,
    "local.catalog",
  );
  // `importKey` consumes the bytes; nothing here retains them.
  return ports.crypto.importKey(opened.payload);
}

/** Reads one envelope under the app key, or fails closed. */
async function openRoot(
  ports: AppStoragePortsV1,
  appKey: EnvelopeKeyRefV1,
  storageId: string,
  scope: Parameters<EnvelopeCryptoPort["open"]>[1],
  payloadKind: Parameters<EnvelopeCryptoPort["open"]>[3],
): Promise<Uint8Array> {
  const frame = await ports.store.getEnvelope(decodeStorageId16(storageId));
  if (frame === undefined) {
    throw new IntegrityError("an app root this head names is not in the store");
  }
  const opened = await ports.crypto.open(frame, scope, appKey, payloadKind);
  return opened.payload;
}

const sameDigest = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && compareDomainIds(left, right) === 0;

async function assertDigest(
  ports: AppStoragePortsV1,
  payload: Uint8Array,
  expected: Uint8Array,
  what: string,
): Promise<void> {
  if (!sameDigest(await ports.crypto.sha256(payload), expected)) {
    throw new IntegrityError(`${what} does not match its recorded digest`);
  }
}

/**
 * Loads and verifies everything the head names. This is the read half of
 * CA-11: a root whose digest does not describe it, a page whose declared count
 * is not its real one, or a segment naming another app all stop the open.
 */
export async function loadApp(
  ports: AppStoragePortsV1,
  appKey: EnvelopeKeyRefV1,
  appHeadStorageId: string,
): Promise<LoadedAppV1> {
  const headPayload = await openRoot(
    ports,
    appKey,
    appHeadStorageId,
    "app.head",
    "app.head",
  );
  const head = decodeAppHead(headPayload);
  await assertDigest(
    ports,
    encodeAppHeadBody(bodyOf(head)),
    head.semanticSha256,
    "the app head",
  );

  const checkpointPayload = await openRoot(
    ports,
    appKey,
    head.checkpoint.storageId,
    "app.checkpoint",
    "app.checkpoint-manifest",
  );
  await assertDigest(
    ports,
    checkpointPayload,
    head.checkpoint.semanticSha256,
    "the checkpoint manifest",
  );
  const checkpoint = decodeCheckpointManifest(checkpointPayload);
  if (compareDomainIds(checkpoint.appId, head.appId) !== 0) {
    throw new IntegrityError("the checkpoint belongs to another app");
  }

  const recordPages: RecordPageV1[] = [];
  for (const ref of checkpoint.recordPages) {
    const payload = await openRoot(
      ports,
      appKey,
      ref.storageId,
      "app.records",
      "app.record-page",
    );
    await assertDigest(ports, payload, ref.semanticSha256, "a record page");
    const page = decodeRecordPage(payload);
    if (page.records.length !== ref.decodedCount) {
      // A short page and a truncated page are different things, and the
      // manifest is what tells them apart.
      throw new IntegrityError("a record page is not the length it declares");
    }
    recordPages.push(page);
  }

  const commits: EventCommitV1[] = [];
  for (const ref of head.eventSegments) {
    const payload = await openRoot(
      ports,
      appKey,
      ref.storageId,
      "app.events",
      "app.event-segment",
    );
    await assertDigest(ports, payload, ref.semanticSha256, "an event segment");
    const segment = decodeEventSegment(payload);
    if (compareDomainIds(segment.appId, head.appId) !== 0) {
      throw new IntegrityError("an event segment belongs to another app");
    }
    commits.push(...segment.commits);
  }

  return {
    appId: head.appId,
    head,
    headStorageId: appHeadStorageId,
    checkpoint,
    recordPages,
    commits: sortCommitsCanonically(commits),
  };
}

const bodyOf = (head: AppHeadV1): Omit<AppHeadV1, "semanticSha256"> => ({
  headVersion: head.headVersion,
  appId: head.appId,
  headRevision: head.headRevision,
  schemaRevision: head.schemaRevision,
  checkpoint: head.checkpoint,
  eventSegments: head.eventSegments,
  frontier: head.frontier,
  baselinePages: head.baselinePages,
  conflictPages: head.conflictPages,
  auditPages: head.auditPages,
  sourceManifests: head.sourceManifests,
  snapshotManifests: head.snapshotManifests,
  retainedRoots: head.retainedRoots,
});

// ------------------------------------------------------------- the writer --

export interface EventStoreDependenciesV1 {
  readonly ports: AppStoragePortsV1;
  /** Read fresh on every write: the catalog moves between commits. */
  readonly session: () => WorkerSessionContextV1;
  readonly deviceId: DeviceId;
}

export interface AppEventStoreV1 extends LocalEventRepository {
  /** The head as it now stands, after every append this store has made. */
  readonly loaded: () => LoadedAppV1;
}

export function createEventStore(
  deps: EventStoreDependenciesV1,
  appKey: EnvelopeKeyRefV1,
  initial: LoadedAppV1,
): AppEventStoreV1 {
  let head = initial.head;
  let headStorageId = initial.headStorageId;
  let commits = [...initial.commits];

  const lastLocalCommit = (): EventCommitV1 | undefined =>
    commits
      .filter((commit) => compareDomainIds(commit.deviceId, deps.deviceId) === 0)
      .at(-1);

  /**
   * The frontier is the authority for *how far this device has got*; the
   * decoded commits are the authority for *what its last commit was*. The two
   * must say the same thing — a frontier ahead of the segments means a segment
   * the head names was not loaded, and continuing from the segments would mint
   * a sequence number this device has already used. That is a corruption to
   * report, not a number to pick between.
   */
  function chainState(): AppChainStateV1 {
    const last = lastLocalCommit();
    const applied = deviceOnlyChangeCount(head.frontier, deps.deviceId);
    const decoded = Number(last?.deviceCommitSequence ?? 0n);
    if (applied !== decoded) {
      throw new IntegrityError(
        "the head's frontier and its event segments disagree about this device",
      );
    }
    return {
      appId: initial.appId,
      deviceId: deps.deviceId,
      deviceCommitSequence: BigInt(applied),
      lastCommitSha256: last?.commitSha256 ?? null,
      lastHybridTime: last?.hybridTime ?? null,
      frontier: head.frontier,
      schemaRevision: head.schemaRevision,
    };
  }

  async function append(
    request: CommitAppendRequestV1,
  ): Promise<CommitReceiptV1> {
    const { ports } = deps;
    const context = deps.session();
    const expectedRevision = context.transactionRevision;
    const revision = expectedRevision + 1;
    const logicalRevision = BigInt(revision);

    const commit = await sealEventCommit(bodyFor(request.plan), (bytes) =>
      ports.crypto.sha256(bytes),
    );

    // D27: one segment per commit. `semanticSha256` over the commit's own hash
    // is the same convention promotion used, so both writers produce segments a
    // single reader can verify.
    const segmentPayload = encodeEventSegment({
      eventFormatVersion: 1,
      segmentId: asDomainId("segment", ports.entropy.randomBytes(STORAGE_ID_BYTES)),
      appId: initial.appId,
      commits: [commit],
      resultingFrontier: advanceFrontier(head.frontier, commit),
      semanticSha256: await ports.crypto.sha256(commit.commitSha256),
    });
    const segmentRef = await sealRoot(
      ports,
      appKey,
      logicalRevision,
      "app.events",
      "app.event-segment",
      segmentPayload,
    );

    const nextHeadBody: Omit<AppHeadV1, "semanticSha256"> = {
      ...bodyOf(head),
      headRevision: head.headRevision + 1n,
      eventSegments: [...head.eventSegments, segmentRef.ref],
      frontier: advanceFrontier(head.frontier, commit),
    };
    const nextHead: AppHeadV1 = {
      ...nextHeadBody,
      semanticSha256: await ports.crypto.sha256(encodeAppHeadBody(nextHeadBody)),
    };
    const nextHeadStorageId = asStorageId16(
      ports.entropy.randomBytes(STORAGE_ID_BYTES),
    );
    const headFrame = await ports.crypto.seal({
      scope: "app.head",
      storageId: nextHeadStorageId,
      logicalRevision,
      payloadKind: "app.head",
      payload: encodeAppHead(nextHead),
      compression: "deflate-raw-v1",
      key: appKey,
    });

    const nextCatalog = withAppEntry(
      context.catalog,
      initial.appId,
      encodeStorageId16(nextHeadStorageId),
      request.rowCountAfter,
    );
    const sealedCatalog = await context.sealCatalog(nextCatalog, revision);

    const committed = await ports.store.commit({
      expectedRevision,
      expectedWriterEpoch: context.writerEpoch,
      addFrames: [segmentRef.frame, headFrame, sealedCatalog.frame],
      // The head this one supersedes: unreachable the instant the new catalog
      // lands, so it goes now rather than becoming garbage to sweep.
      deleteStorageIds: [decodeStorageId16(headStorageId)],
      bootstrapPatch: { catalogStorageId: sealedCatalog.storageId },
    });
    context.adopt({
      catalog: nextCatalog,
      catalogStorageId: sealedCatalog.storageId,
      transactionRevision: committed,
    });

    head = nextHead;
    headStorageId = encodeStorageId16(nextHeadStorageId);
    commits = sortCommitsCanonically([...commits, commit]) as EventCommitV1[];

    return {
      commit,
      headRevision: nextHead.headRevision,
      frontier: nextHead.frontier,
      transactionRevision: committed,
    };
  }

  return {
    chainState,
    append,
    loaded: (): LoadedAppV1 => ({
      appId: initial.appId,
      head,
      headStorageId,
      checkpoint: initial.checkpoint,
      recordPages: initial.recordPages,
      commits,
    }),
  };
}

/** The plan's typed events, encoded into the wire commit M09 will seal. */
function bodyFor(plan: CommitPlanV1): EventCommitBodyV1 {
  const events: DomainEventV1[] = plan.events.map((planned) => ({
    eventId: planned.eventId,
    eventIndex: planned.eventIndex,
    kind: planned.event.kind,
    subject: planned.subject,
    // One function derives the payload from the typed event, so the two can
    // never disagree — which is exactly what the replay guards check.
    payload: encodeRecordEventPayload(planned.event),
    provenance: planned.provenance,
  }));

  return {
    eventFormatVersion: 1,
    commitId: plan.commitId,
    appId: plan.appId,
    deviceId: plan.deviceId,
    deviceCommitSequence: plan.deviceCommitSequence,
    previousDeviceCommitSha256: plan.previousDeviceCommitSha256,
    basisFrontier: sortFrontier(plan.basisFrontier),
    hybridTime: plan.hybridTime,
    eventClass: plan.eventClass,
    schemaRevisionBefore: plan.schemaRevisionBefore,
    schemaRevisionAfter: plan.schemaRevisionAfter,
    events,
  };
}

function advanceFrontier(
  frontier: readonly FrontierEntryV1[],
  commit: EventCommitV1,
): readonly FrontierEntryV1[] {
  const others = frontier.filter(
    (entry) => compareDomainIds(entry.deviceId, commit.deviceId) !== 0,
  );
  return sortFrontier([
    ...others,
    { deviceId: commit.deviceId, commitSequence: commit.deviceCommitSequence },
  ]);
}

async function sealRoot(
  ports: AppStoragePortsV1,
  appKey: EnvelopeKeyRefV1,
  logicalRevision: bigint,
  scope: Parameters<EnvelopeCryptoPort["seal"]>[0]["scope"],
  payloadKind: Parameters<EnvelopeCryptoPort["seal"]>[0]["payloadKind"],
  payload: Uint8Array,
) {
  const storageId = asStorageId16(ports.entropy.randomBytes(STORAGE_ID_BYTES));
  const frame = await ports.crypto.seal({
    scope,
    storageId,
    logicalRevision,
    payloadKind,
    payload,
    compression: "deflate-raw-v1",
    key: appKey,
  });
  const ref: StorageRefV1 = {
    storageId: encodeStorageId16(storageId),
    semanticSha256: await ports.crypto.sha256(payload),
  };
  return { frame, ref };
}

/** Repoints one app entry at its new head and refreshes its render cache. */
function withAppEntry(
  catalog: LocalCatalogV1,
  appId: AppId,
  appHeadStorageId: string,
  rowCountCache: number,
): LocalCatalogV1 {
  const target = encodeDomainId(appId);
  let found = false;
  const apps = catalog.apps.map((entry) => {
    if (entry.appId !== target) {
      return entry;
    }
    found = true;
    return { ...entry, appHeadStorageId, rowCountCache };
  });
  if (!found) {
    throw new CodecError("the catalog holds no entry for this app");
  }
  return { ...catalog, catalogRevision: catalog.catalogRevision + 1, apps };
}

/** Records this device holds that no durable home has (CA-09/CAP-18). */
export function deviceOnlyChangeCount(
  frontier: readonly FrontierEntryV1[],
  deviceId: DeviceId,
): number {
  // F02 assigns no durable home (D26), so every commit this device authored is
  // still device-only. The count is the device's own sequence in the head's
  // frontier — recomputed from the decrypted head, never read from a cache.
  const entry = frontier.find(
    (candidate) => compareDomainIds(candidate.deviceId, deviceId) === 0,
  );
  return Number(entry?.commitSequence ?? 0n);
}

export { compareCommits };
