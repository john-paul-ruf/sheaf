/** CA-01 optimistic commit: conflict, atomicity, add-not-put, revision notice. */

// First import: the shim must be installed before `dexie` is evaluated (D8).
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBootstrap, readBootstrap } from "../../../src/persistence/envelope-store/bootstrap.js";
import { commitEnvelopes } from "../../../src/persistence/envelope-store/commit.js";
import {
  getEnvelope,
  getEnvelopesByRevision,
} from "../../../src/persistence/envelope-store/read.js";
import {
  EnvelopeExistsError,
  RevisionConflictError,
} from "../../../src/persistence/envelope-store/errors.js";
import { subscribeRevision } from "../../../src/persistence/envelope-store/revision-signal.js";
import {
  bootstrapRow,
  opaqueFrame,
  resetLocalDatabase,
  storageId,
  storageIdText,
} from "./local-store.js";

const unsubscribes: (() => void)[] = [];

beforeEach(async () => {
  await resetLocalDatabase();
  await createBootstrap(bootstrapRow(), [opaqueFrame(11, 1n)]);
});

afterEach(() => {
  for (const unsubscribe of unsubscribes.splice(0)) {
    unsubscribe();
  }
});

describe("commitEnvelopes", () => {
  it("adds the frames and moves the bootstrap row in one revision", async () => {
    const revision = await commitEnvelopes({
      expectedRevision: 1,
      expectedWriterEpoch: 0,
      addFrames: [opaqueFrame(20, 2n), opaqueFrame(21, 2n)],
      bootstrapPatch: { catalogStorageId: storageIdText(20) },
    });

    expect(revision).toBe(2);
    const after = await readBootstrap();
    expect(after?.transactionRevision).toBe(2);
    expect(after?.catalogStorageId).toBe(storageIdText(20));
    expect((await getEnvelopesByRevision(2)).frames).toHaveLength(2);
    expect((await getEnvelope(storageId(11)))?.logicalRevision).toBe(1n);
  });

  it("increases the revision by exactly one per commit", async () => {
    const revisions: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      revisions.push(
        await commitEnvelopes({
          expectedRevision: index + 1,
          expectedWriterEpoch: 0,
          addFrames: [opaqueFrame(30 + index, BigInt(index + 2))],
        }),
      );
    }
    expect(revisions).toEqual([2, 3, 4]);
  });

  it("rejects a stale revision or writer epoch before writing anything", async () => {
    await expect(
      commitEnvelopes({
        expectedRevision: 0,
        expectedWriterEpoch: 0,
        addFrames: [opaqueFrame(20, 1n)],
      }),
    ).rejects.toThrow(RevisionConflictError);
    await expect(
      commitEnvelopes({
        expectedRevision: 1,
        expectedWriterEpoch: 2,
        addFrames: [opaqueFrame(20, 2n)],
      }),
    ).rejects.toThrow(RevisionConflictError);

    expect((await readBootstrap())?.transactionRevision).toBe(1);
    expect(await getEnvelope(storageId(20))).toBeUndefined();
  });

  it("aborts the whole transaction when a storage id collides", async () => {
    await expect(
      commitEnvelopes({
        expectedRevision: 1,
        expectedWriterEpoch: 0,
        addFrames: [opaqueFrame(20, 2n), opaqueFrame(11, 2n)],
        bootstrapPatch: { catalogStorageId: storageIdText(20) },
      }),
    ).rejects.toThrow(EnvelopeExistsError);

    const after = await readBootstrap();
    expect(after?.transactionRevision).toBe(1);
    expect(after?.catalogStorageId).toBe(bootstrapRow().catalogStorageId);
    expect(await getEnvelope(storageId(20))).toBeUndefined();
  });

  it("never overwrites an existing envelope (add, not put)", async () => {
    const original = await getEnvelope(storageId(11));
    await expect(
      commitEnvelopes({
        expectedRevision: 1,
        expectedWriterEpoch: 0,
        addFrames: [{ ...opaqueFrame(11, 2n) }],
      }),
    ).rejects.toThrow(EnvelopeExistsError);

    const unchanged = await getEnvelope(storageId(11));
    expect(unchanged?.logicalRevision).toBe(1n);
    expect(unchanged?.ciphertext).toEqual(original?.ciphertext);
  });

  it("refuses frames sealed at any revision but the one it commits", async () => {
    await expect(
      commitEnvelopes({
        expectedRevision: 1,
        expectedWriterEpoch: 0,
        addFrames: [opaqueFrame(20, 3n)],
      }),
    ).rejects.toThrow(/must equal the committing transaction revision/);
    expect((await readBootstrap())?.transactionRevision).toBe(1);
  });

  it("commits a bootstrap-only change with no frames", async () => {
    const revision = await commitEnvelopes({
      expectedRevision: 1,
      expectedWriterEpoch: 0,
      addFrames: [],
      bootstrapPatch: { migrationStorageId: storageIdText(31) },
    });

    expect(revision).toBe(2);
    expect((await readBootstrap())?.migrationStorageId).toBe(storageIdText(31));
  });

  it("publishes the committed revision to other subscribers", async () => {
    const seen: number[] = [];
    unsubscribes.push(subscribeRevision((revision) => seen.push(revision)));

    await commitEnvelopes({
      expectedRevision: 1,
      expectedWriterEpoch: 0,
      addFrames: [opaqueFrame(40, 2n)],
    });

    await expect.poll(() => seen).toEqual([2]);
  });
});
