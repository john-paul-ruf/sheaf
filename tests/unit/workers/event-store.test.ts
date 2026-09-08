/**
 * The app event store: one transaction per command, and no acknowledgement
 * before it lands (M33; CA-08/CA-11, invariant 1).
 *
 * The claim these make is an *ordering* claim, so the fake store is
 * instrumented rather than simplified: its `commit` is held open until the test
 * releases it, and the test asserts that `append` has not resolved in the
 * meantime. A worker that acknowledged first would pass every other assertion
 * here and fail this one.
 *
 * The second claim is that a head is replaced rather than edited: envelopes are
 * immutable, so the transaction must add a new head, repoint the catalog at it,
 * and delete the one it supersedes — together.
 */

import { describe, expect, it } from "vitest";

import {
  asStorageId16,
  decodeStorageId16,
  encodeStorageId16,
} from "../../../src/domain/model/bytes.js";
import {
  createDomainId,
  encodeDomainId,
  type AppId,
  type DeviceId,
  type FieldId,
} from "../../../src/domain/model/ids.js";
import type { AuthoredRecordV1 } from "../../../src/domain/model/events.js";
import type { CellValueV1 } from "../../../src/domain/model/values.js";
import type {
  BootstrapSnapshotV1,
  EnvelopeStorePort,
  RevisionPageV1,
  StoreCommitRequestV1,
} from "../../../src/application/ports/envelope-store.js";
import type {
  EnvelopeCryptoPort,
  EnvelopeKeyRefV1,
  OpenedEnvelopeV1,
  SealEnvelopeRequestV1,
} from "../../../src/application/ports/envelope-crypto.js";
import type { EnvelopeFrameV1 } from "../../../src/migrations/003_envelope_format_v1.js";
import { buildAuthoredCommit } from "../../../src/application/commands/build-commit.js";
import { sealEventCommit } from "../../../src/persistence/codecs/event-commit.js";
import {
  createEventStore,
  deviceOnlyChangeCount,
  type LoadedAppV1,
  type WorkerSessionContextV1,
} from "../../../src/workers/data/event-store.js";
import type {
  AppHeadV1,
  CheckpointManifestV1,
} from "../../../src/import/staging/roots.js";
import { DEFAULT_APP_THEME } from "../../../src/import/staging/theme.js";
import { buildLocalCatalog, type LocalCatalogV1 } from "../../../src/workers/data/catalog.js";
import { FakeClock } from "../commands/fakes.js";

const entropy = {
  randomBytes: (byteLength: number): Uint8Array =>
    crypto.getRandomValues(new Uint8Array(byteLength)),
};

/** A deterministic 32-byte digest; the store never checks it cryptographically. */
const fakeSha256 = (bytes: Uint8Array): Promise<Uint8Array> => {
  const digest = new Uint8Array(32);
  for (const [index, byte] of bytes.entries()) {
    const slot = index % 32;
    digest[slot] = ((digest[slot] as number) * 31 + byte) % 251;
  }
  return Promise.resolve(digest);
};

const key: EnvelopeKeyRefV1 = { purpose: "envelope" };

/** Frames carry their payload in the clear; nothing here tests encryption. */
const payloads = new Map<string, Uint8Array>();

const fakeCrypto: EnvelopeCryptoPort = {
  seal(request: SealEnvelopeRequestV1): Promise<EnvelopeFrameV1> {
    payloads.set(encodeStorageId16(request.storageId), request.payload);
    return Promise.resolve({
      envelopeFormatVersion: 1,
      codecVersion: 1,
      cipherSuiteVersion: 1,
      storageId: request.storageId,
      logicalRevision: request.logicalRevision,
      paddedBytes: request.payload.byteLength,
      nonce: new Uint8Array(24),
      ciphertext: request.payload,
    });
  },
  open(frame: EnvelopeFrameV1): Promise<OpenedEnvelopeV1> {
    return Promise.resolve({
      payloadKind: "app.head",
      payload: frame.ciphertext,
    });
  },
  importKey: (): EnvelopeKeyRefV1 => key,
  destroyKey: (): void => undefined,
  sha256: fakeSha256,
};

interface CommitTrace {
  readonly request: StoreCommitRequestV1;
}

/** A store whose `commit` can be held open, so ordering becomes observable. */
class GatedStore implements EnvelopeStorePort {
  readonly commits: CommitTrace[] = [];
  #revision = 4;
  #open: Promise<void>;
  #release: () => void = () => undefined;

  constructor() {
    // The gate exists before anything can reach it, so a test may release it
    // before or after `commit` is called without the order mattering.
    this.#open = new Promise<void>((resolve) => {
      this.#release = resolve;
    });
  }

  readBootstrap(): Promise<BootstrapSnapshotV1 | undefined> {
    return Promise.resolve(undefined);
  }

  getEnvelope(): Promise<EnvelopeFrameV1 | undefined> {
    return Promise.resolve(undefined);
  }

  listByRevision(): Promise<RevisionPageV1> {
    return Promise.resolve({ frames: [], nextAfterStorageId: undefined });
  }

  /** Holds the caller until {@link release}; then reports the new revision. */
  async commit(request: StoreCommitRequestV1): Promise<number> {
    this.commits.push({ request });
    await this.#open;
    this.#revision += 1;
    return this.#revision;
  }

  release(): void {
    this.#release();
    this.#open = Promise.resolve();
  }

  get revision(): number {
    return this.#revision;
  }
}

const APP_ID: AppId = createDomainId("app", entropy);
const DEVICE_ID: DeviceId = createDomainId("device", entropy);
const TABLE_ID = createDomainId("table", entropy);
const FIELD_ID: FieldId = createDomainId("field", entropy);
const CHECKPOINT_STORAGE = encodeStorageId16(
  asStorageId16(entropy.randomBytes(16)),
);
const HEAD_STORAGE = encodeStorageId16(asStorageId16(entropy.randomBytes(16)));

const CHECKPOINT: CheckpointManifestV1 = {
  manifestVersion: 1,
  appId: APP_ID,
  schemaRevision: 1n,
  frontier: [{ deviceId: DEVICE_ID, commitSequence: 1n }],
  appState: {
    appId: APP_ID,
    displayName: "Field Log",
    createdAtMs: 1_760_000_000_000,
    lastOpenedAtMs: null,
    schemaRevision: 1n,
    locality: "present",
    durableHomeId: null,
    lastSuccessfulBackupMs: null,
    deviceOnlyChangeCount: 1,
    theme: DEFAULT_APP_THEME,
    stateRevision: 1n,
  },
  tables: [],
  enumOptions: [],
  sheetSnapshots: [],
  recordPages: [],
  semanticSha256: new Uint8Array(32),
};

const HEAD: AppHeadV1 = {
  headVersion: 1,
  appId: APP_ID,
  headRevision: 1n,
  schemaRevision: 1n,
  checkpoint: { storageId: CHECKPOINT_STORAGE, semanticSha256: new Uint8Array(32) },
  eventSegments: [
    {
      storageId: encodeStorageId16(asStorageId16(entropy.randomBytes(16))),
      semanticSha256: new Uint8Array(32),
    },
  ],
  frontier: [{ deviceId: DEVICE_ID, commitSequence: 1n }],
  baselinePages: [],
  conflictPages: [],
  auditPages: [],
  sourceManifests: [],
  snapshotManifests: [],
  retainedRoots: [],
  semanticSha256: new Uint8Array(32),
};

/**
 * The promotion commit this app's head names. It has to be here: the store
 * checks that the frontier and the decoded segments agree, so a fixture with a
 * frontier at sequence one and no commit behind it is a corruption, not a
 * shortcut.
 */
const PROMOTION_COMMIT = await sealEventCommit(
  {
    eventFormatVersion: 1,
    commitId: createDomainId("commit", entropy),
    appId: APP_ID,
    deviceId: DEVICE_ID,
    deviceCommitSequence: 1n,
    previousDeviceCommitSha256: null,
    basisFrontier: [],
    hybridTime: { wallTimeMs: 1_760_000_000_000n, logicalCounter: 0 },
    eventClass: "import",
    schemaRevisionBefore: 0n,
    schemaRevisionAfter: 1n,
    events: [
      {
        eventId: createDomainId("event", entropy),
        eventIndex: 0,
        kind: "app.created",
        subject: { appId: APP_ID },
        payload: null,
        provenance: { source: "initial-import" },
      },
    ],
  },
  fakeSha256,
);

const LOADED: LoadedAppV1 = {
  appId: APP_ID,
  head: HEAD,
  headStorageId: HEAD_STORAGE,
  checkpoint: CHECKPOINT,
  recordPages: [],
  commits: [PROMOTION_COMMIT],
};

function catalogWithApp(): LocalCatalogV1 {
  const base = buildLocalCatalog({
    deviceId: encodeDomainId(DEVICE_ID),
    recoveryCodeView: new Uint8Array([1, 2, 3]),
  });
  return {
    ...base,
    apps: [
      {
        appId: encodeDomainId(APP_ID),
        locality: "present",
        wrappedAppKey: new Uint8Array([9]),
        appHeadStorageId: HEAD_STORAGE,
        homeId: null,
        scratchReminder: null,
        displayName: "Field Log",
        identity: { accentId: "leaf", glyph: "FL" },
        createdAtEpochMs: 1_760_000_000_000,
        lastOpenedAtEpochMs: null,
        rowCountCache: 40,
        tableCount: 1,
      },
    ],
  };
}

function harness() {
  const store = new GatedStore();
  let catalog = catalogWithApp();
  let catalogStorageId = encodeStorageId16(asStorageId16(entropy.randomBytes(16)));
  let transactionRevision = 4;

  const session = (): WorkerSessionContextV1 => context;
  const context: WorkerSessionContextV1 = {
    localRoot: key,
    get catalog() {
      return catalog;
    },
    get catalogStorageId() {
      return catalogStorageId;
    },
    get transactionRevision() {
      return transactionRevision;
    },
    writerEpoch: 0,
    adopt(next) {
      catalog = next.catalog;
      catalogStorageId = next.catalogStorageId;
      transactionRevision = next.transactionRevision;
    },
    sealCatalog(next, logicalRevision) {
      const storageId = asStorageId16(entropy.randomBytes(16));
      return fakeCrypto
        .seal({
          scope: "local.catalog",
          storageId,
          logicalRevision: BigInt(logicalRevision),
          payloadKind: "local.catalog",
          payload: new Uint8Array([next.catalogRevision]),
          compression: "none",
          key,
        })
        .then((frame) => ({ frame, storageId: encodeStorageId16(storageId) }));
    },
  };

  const repository = createEventStore(
    {
      ports: { store, crypto: fakeCrypto, entropy },
      session,
      deviceId: DEVICE_ID,
    },
    key,
    LOADED,
  );

  return { store, repository, current: () => ({ catalog, transactionRevision }) };
}

const record: AuthoredRecordV1 = {
  recordId: createDomainId("record", entropy),
  tableId: TABLE_ID,
  values: new Map<FieldId, CellValueV1>([
    [FIELD_ID, { kind: "text", text: "North yard" }],
  ]),
  provenance: new Map([[FIELD_ID, { source: "user" as const }]]),
};

const planOf = (repository: ReturnType<typeof harness>["repository"]) =>
  buildAuthoredCommit(
    { clock: new FakeClock(), entropy },
    repository.chainState(),
    [
      {
        subject: { tableId: TABLE_ID, recordId: record.recordId },
        event: {
          kind: "record.created",
          payload: { record, importedInvalid: false },
        },
      },
    ],
  );

describe("appending a commit", () => {
  it("does not resolve until the store's transaction has completed", async () => {
    const { store, repository } = harness();

    let settled = false;
    const appended = repository
      .append({ plan: planOf(repository), rowCountAfter: 41 })
      .then((receipt) => {
        settled = true;
        return receipt;
      });

    // Wait until the transaction has actually opened — sealing the commit, the
    // segment, the head, and the catalog all happen before it — then check that
    // nothing has been acknowledged while it is still open (invariant 1).
    while (store.commits.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.commits).toHaveLength(1);
    expect(settled).toBe(false);

    store.release();
    const receipt = await appended;
    expect(settled).toBe(true);
    expect(receipt.transactionRevision).toBe(store.revision);
  });

  it("writes the segment, the new head, and the catalog in one transaction", async () => {
    const { store, repository } = harness();
    const appended = repository.append({
      plan: planOf(repository),
      rowCountAfter: 41,
    });
    store.release();
    await appended;

    expect(store.commits).toHaveLength(1);
    const request = store.commits[0]?.request as StoreCommitRequestV1;
    // D27: one segment envelope per commit, plus the head and the catalog.
    expect(request.addFrames).toHaveLength(3);
    expect(request.expectedRevision).toBe(4);
    expect(request.bootstrapPatch?.catalogStorageId).toBeDefined();

    // The superseded head is deleted in the same transaction: an envelope is
    // never edited, and nothing can reach the old one once the catalog moves.
    expect(request.deleteStorageIds?.map((id) => encodeStorageId16(id))).toEqual([
      HEAD_STORAGE,
    ]);
    // Every frame is sealed at the revision this transaction will land on.
    for (const frame of request.addFrames) {
      expect(frame.logicalRevision).toBe(5n);
    }
  });

  it("advances the head and repoints the catalog at it", async () => {
    const { store, repository, current } = harness();
    const appended = repository.append({
      plan: planOf(repository),
      rowCountAfter: 41,
    });
    store.release();
    const receipt = await appended;

    const head = repository.loaded().head;
    expect(head.headRevision).toBe(2n);
    expect(receipt.headRevision).toBe(2n);
    expect(head.eventSegments).toHaveLength(2);
    expect(head.frontier).toEqual([
      { deviceId: DEVICE_ID, commitSequence: 2n },
    ]);
    // The checkpoint did not move: F02 writes one at promotion and no more.
    expect(head.checkpoint.storageId).toBe(CHECKPOINT_STORAGE);

    const entry = current().catalog.apps[0];
    expect(entry?.appHeadStorageId).not.toBe(HEAD_STORAGE);
    expect(entry?.appHeadStorageId).toBe(repository.loaded().headStorageId);
    // The render cache follows the write; it is still only a cache.
    expect(entry?.rowCountCache).toBe(41);
    expect(current().transactionRevision).toBe(5);
  });

  it("continues the chain: the next commit names this one as its predecessor", async () => {
    const { store, repository } = harness();

    const first = repository.append({ plan: planOf(repository), rowCountAfter: 41 });
    store.release();
    const firstReceipt = await first;

    const chain = repository.chainState();
    expect(chain.deviceCommitSequence).toBe(2n);
    expect(chain.lastCommitSha256).toEqual(firstReceipt.commit.commitSha256);
    expect(chain.lastHybridTime).toEqual(firstReceipt.commit.hybridTime);

    const next = planOf(repository);
    expect(next.deviceCommitSequence).toBe(3n);
    expect(next.previousDeviceCommitSha256).toEqual(
      firstReceipt.commit.commitSha256,
    );
    // Basis frontier is what this device has applied, never a claim past it.
    expect(next.basisFrontier).toEqual([
      { deviceId: DEVICE_ID, commitSequence: 2n },
    ]);
  });

  it("refuses a head whose frontier runs ahead of the segments it names", () => {
    const store = new GatedStore();
    const orphaned = createEventStore(
      {
        ports: { store, crypto: fakeCrypto, entropy },
        session: () => ({}) as WorkerSessionContextV1,
        deviceId: DEVICE_ID,
      },
      key,
      // The frontier says one commit; no segment was decoded behind it.
      { ...LOADED, commits: [] },
    );
    // Continuing from the segments would re-mint sequence one, which this
    // device has already used. It fails closed instead.
    expect(() => orphaned.chainState()).toThrow(/frontier/);
  });

  it("counts device-only changes from the head frontier", async () => {
    const { store, repository } = harness();
    expect(deviceOnlyChangeCount(repository.loaded().head.frontier, DEVICE_ID)).toBe(1);

    const appended = repository.append({
      plan: planOf(repository),
      rowCountAfter: 41,
    });
    store.release();
    await appended;

    expect(deviceOnlyChangeCount(repository.loaded().head.frontier, DEVICE_ID)).toBe(2);
    // A device this app has never seen holds none of its changes.
    expect(
      deviceOnlyChangeCount(
        repository.loaded().head.frontier,
        createDomainId("device", entropy),
      ),
    ).toBe(0);
  });

  it("seals the new head at the storage id the catalog now names", async () => {
    const { store, repository } = harness();
    const appended = repository.append({ plan: planOf(repository), rowCountAfter: 41 });
    store.release();
    await appended;

    // The head is only reachable through the catalog entry, and this is the
    // decode path the next open would take to reach it.
    expect(payloads.has(decodeThenEncode(repository.loaded().headStorageId))).toBe(
      true,
    );
  });
});

const decodeThenEncode = (text: string): string =>
  encodeStorageId16(decodeStorageId16(text));
