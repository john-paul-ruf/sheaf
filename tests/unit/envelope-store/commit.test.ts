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

/**
 * The keyed-delete path (F02 S04, database.md § Import staging cancellation
 * step 1 and § Encrypted mark-and-sweep step 5). Cancelling an import removes
 * the wrap that reaches the staged bytes in the same transaction that
 * replaces the catalog, so these assertions are about *exactness*: the named
 * row and only the named row, and nothing at all when the caller is stale.
 */
describe("commitEnvelopes with deleteStorageIds", () => {
  const digestOf = async (seed: number): Promise<string | null> => {
    const frame = await getEnvelope(storageId(seed));
    return frame === null || frame === undefined
      ? null
      : [...frame.ciphertext, ...frame.nonce].join(",");
  };

  beforeEach(async () => {
    await commitEnvelopes({
      expectedRevision: 1,
      expectedWriterEpoch: 0,
      addFrames: [opaqueFrame(50, 2n), opaqueFrame(51, 2n), opaqueFrame(52, 2n)],
    });
  });

  it("removes exactly the named rows and leaves the others byte-identical", async () => {
    const untouched = [await digestOf(11), await digestOf(52)];

    const revision = await commitEnvelopes({
      expectedRevision: 2,
      expectedWriterEpoch: 0,
      addFrames: [opaqueFrame(60, 3n)],
      deleteStorageIds: [storageId(50), storageId(51)],
      bootstrapPatch: { catalogStorageId: storageIdText(60) },
    });

    expect(revision).toBe(3);
    expect(await getEnvelope(storageId(50))).toBeUndefined();
    expect(await getEnvelope(storageId(51))).toBeUndefined();
    // The survivors are untouched, not merely present: a delete that rewrote
    // a neighbour would break every AAD built from its stored row.
    expect([await digestOf(11), await digestOf(52)]).toEqual(untouched);
    expect(await getEnvelope(storageId(60))).toBeDefined();
    expect((await readBootstrap())?.catalogStorageId).toBe(storageIdText(60));
  });

  it("deletes nothing when the revision or writer epoch is stale", async () => {
    const before = [await digestOf(50), await digestOf(51), await digestOf(52)];

    for (const stale of [
      { expectedRevision: 1, expectedWriterEpoch: 0 },
      { expectedRevision: 2, expectedWriterEpoch: 9 },
    ]) {
      await expect(
        commitEnvelopes({
          ...stale,
          addFrames: [],
          deleteStorageIds: [storageId(50), storageId(51), storageId(52)],
        }),
      ).rejects.toThrow(RevisionConflictError);
    }

    // A losing collector destroys nothing the winning commit still reaches.
    // Two mechanisms give this: the gate precedes the deletes, and the whole
    // transaction aborts anyway. Verified to fail against a delete that runs
    // outside the transaction — the case rollback cannot cover; an in-
    // transaction reordering stays green, because there the abort is enough.
    expect([await digestOf(50), await digestOf(51), await digestOf(52)]).toEqual(
      before,
    );
    expect((await readBootstrap())?.transactionRevision).toBe(2);
  });

  it("treats an absent id as a no-op, so a bounded sweep can resume", async () => {
    await commitEnvelopes({
      expectedRevision: 2,
      expectedWriterEpoch: 0,
      addFrames: [],
      deleteStorageIds: [storageId(50)],
    });

    // Replaying the same cursor after an interruption must succeed rather
    // than fail on a row the previous batch already removed.
    const revision = await commitEnvelopes({
      expectedRevision: 3,
      expectedWriterEpoch: 0,
      addFrames: [],
      deleteStorageIds: [storageId(50), storageId(99), storageId(51)],
    });

    expect(revision).toBe(4);
    expect(await getEnvelope(storageId(51))).toBeUndefined();
    expect(await getEnvelope(storageId(52))).toBeDefined();
  });
});
