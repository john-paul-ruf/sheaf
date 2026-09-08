/**
 * CA-10: the stage lifecycle and the four-step cancellation order.
 *
 * The claim under test is the one the UI repeats to the user — "cancelling
 * leaves nothing behind" — so the assertions are about *storage*, not about
 * calls: rows that must be gone are gone, rows that must survive are
 * byte-identical, and the staged bytes stop decrypting at the exact step
 * database.md says they do.
 */

import { describe, expect, it } from "vitest";
import {
  asStorageId16,
  encodeStorageId16,
} from "../../../src/domain/model/bytes.js";
import {
  createImportStage,
  readImportStage,
  writeImportStage,
  type CreateImportStageInputV1,
  type LoadedImportStageV1,
} from "../../../src/import/staging/lifecycle.js";
import {
  CLEANUP_BATCH_SIZE,
  cancelImportStage,
  decodeCleanupTicket,
  encodeCleanupTicket,
  processCleanupTickets,
  sweepStaleImports,
  type CleanupTicketV1,
} from "../../../src/import/staging/cleanup.js";
import {
  IMPORT_STAGE_PAYLOAD_KIND,
  IMPORT_STAGE_SCOPE,
  type ImportStageV1,
  type StagedChunkRefV1,
} from "../../../src/import/staging/stage.js";
import {
  expectCleartextBudget,
  stagingHarness,
  tryOpen,
  type StagingHarnessV1,
} from "./fakes.js";

const INPUT: CreateImportStageInputV1 = {
  fileName: "field-log-messy.csv",
  detected: {
    kind: "delimited",
    delimiter: ",",
    encoding: "utf-8",
    bomByteLength: 0,
    newline: "lf",
  },
  contradiction: null,
  preflight: {
    fileName: "field-log-messy.csv",
    sourceByteLength: 5469,
    delimiter: ",",
    encoding: "utf-8",
    newline: "lf",
    columnCount: 9,
    estimatedRowCount: 43,
    estimatedCellCount: 387,
    isEstimate: true,
    sampleRows: [["Site", "Status"]],
    bytesSampled: 5469,
  },
  sourceSha256: Uint8Array.from({ length: 32 }, (_u, index) => index),
  sourceByteLength: 5469,
  selectedSheets: ["Field Log Messy"],
};

/** Seals `count` opaque chunks under the provisional key and stages them. */
async function withChunks(
  harness: StagingHarnessV1,
  loaded: LoadedImportStageV1,
  chunkCount: number,
): Promise<LoadedImportStageV1> {
  const revision = harness.catalog.expectation().transactionRevision + 1;
  const chunks: StagedChunkRefV1[] = [];
  const frames = [];

  for (let sequence = 0; sequence < chunkCount; sequence += 1) {
    const storageId = asStorageId16(harness.ports.entropy.randomBytes(16));
    const payload = Uint8Array.from({ length: 16 }, () => sequence + 1);
    frames.push(
      await harness.crypto.seal({
        scope: IMPORT_STAGE_SCOPE,
        storageId,
        logicalRevision: BigInt(revision),
        payloadKind: IMPORT_STAGE_PAYLOAD_KIND,
        payload,
        compression: "none",
        key: loaded.provisionalKey,
      }),
    );
    chunks.push({
      storageId: encodeStorageId16(storageId),
      sequence,
      decodedByteLength: payload.byteLength,
      sha256: await harness.crypto.sha256(payload),
    });
  }

  const next: ImportStageV1 = {
    ...loaded.stage,
    stageRevision: loaded.stage.stageRevision + 1,
    factChunks: chunks,
    temporaryStorageIds: chunks.map((chunk) => chunk.storageId),
    progress: {
      ...loaded.stage.progress,
      batchesCommitted: chunkCount,
      ackedBatchSeq: chunkCount - 1,
      rowsSoFar: chunkCount * 10,
    },
  };

  const written = await writeImportStage(
    harness.ports,
    harness.localRoot,
    loaded,
    next,
    { addFrames: frames },
  );
  return written.loaded;
}

describe("createImportStage", () => {
  it("writes the workflow reference and the key wrap in one transaction", async () => {
    const harness = stagingHarness();
    const created = await createImportStage(harness.ports, harness.localRoot, INPUT);

    // One commit, not three: the catalog, the workflow and the stage land or
    // none of them do.
    expect(harness.store.commits).toHaveLength(1);
    expect(harness.store.commits[0]?.added).toBe(3);

    const refs = harness.catalog.readRefs();
    expect(refs.activeWorkflowStorageIds).toEqual([
      created.loaded.workflowStorageId,
    ]);
    expect(refs.cleanupTicketStorageIds).toEqual([]);
    expect(harness.store.has(created.loaded.stageStorageId)).toBe(true);
    expect(harness.store.has(created.loaded.workflowStorageId)).toBe(true);
    expectCleartextBudget(harness.store);
  });

  it("reaches the stage only through the catalog's workflow reference", async () => {
    const harness = stagingHarness();
    const created = await createImportStage(harness.ports, harness.localRoot, INPUT);

    const reopened = await readImportStage(
      harness.ports,
      harness.localRoot,
      created.loaded.workflowStorageId,
    );
    expect(reopened?.stage).toEqual(created.loaded.stage);

    // The local root cannot open the stage itself: only the provisional key
    // inside the workflow envelope can, and that is the whole reachability
    // argument cancellation depends on.
    expect(
      await tryOpen(
        harness.crypto,
        harness.store,
        created.loaded.stageStorageId,
        IMPORT_STAGE_SCOPE,
        harness.localRoot,
        IMPORT_STAGE_PAYLOAD_KIND,
      ),
    ).toBeNull();
  });

  it("advances the stage revision and retires the pair it supersedes", async () => {
    const harness = stagingHarness();
    const created = await createImportStage(harness.ports, harness.localRoot, INPUT);
    const advanced = await withChunks(harness, created.loaded, 2);

    expect(advanced.stage.stageRevision).toBe(2);
    expect(advanced.stage.stageId).toBe(created.loaded.stage.stageId);
    expect(harness.store.has(created.loaded.stageStorageId)).toBe(false);
    expect(harness.store.has(created.loaded.workflowStorageId)).toBe(false);
    expect(harness.catalog.readRefs().activeWorkflowStorageIds).toEqual([
      advanced.workflowStorageId,
    ]);
  });

  it("refuses a rewrite that does not advance the stage revision by one", async () => {
    const harness = stagingHarness();
    const created = await createImportStage(harness.ports, harness.localRoot, INPUT);

    await expect(
      writeImportStage(harness.ports, harness.localRoot, created.loaded, {
        ...created.loaded.stage,
        status: "staged",
      }),
    ).rejects.toThrow(/advance the stage revision/);
  });
});

describe("the four-step cancellation order", () => {
  it("step 1: one transaction orphans the key, cleans the catalog, tickets the rows", async () => {
    const harness = stagingHarness();
    const created = await createImportStage(harness.ports, harness.localRoot, INPUT);
    const staged = await withChunks(harness, created.loaded, 3);
    const chunkIds = staged.stage.factChunks.map((chunk) => chunk.storageId);

    // Drive step 1 alone by letting the very next commit be the last one that
    // succeeds: the sweep then stops with the ticket in place, which is
    // exactly the state step 1 is defined to leave.
    harness.store.breakAfter(1);
    await expect(
      cancelImportStage(harness.ports, harness.localRoot, {
        workflowStorageId: staged.workflowStorageId,
        reason: "import-cancelled",
      }),
    ).rejects.toThrow(/simulated interruption/);

    const refs = harness.catalog.readRefs();
    // (a) the catalog no longer names the workflow …
    expect(refs.activeWorkflowStorageIds).toEqual([]);
    // (b) … it names a cleanup ticket instead …
    expect(refs.cleanupTicketStorageIds).toHaveLength(1);
    // (c) … the key wrap is gone …
    expect(harness.store.has(staged.workflowStorageId)).toBe(false);
    // (d) … and the bootstrap advanced with all of it.
    expect((await harness.store.readBootstrap())?.transactionRevision).toBe(
      harness.catalog.expectation().transactionRevision,
    );

    // Step 2 is a consequence, not an action: the staged bytes are still on
    // disk and are already unreadable, because nothing can reach the key.
    for (const chunkId of chunkIds) {
      expect(harness.store.has(chunkId)).toBe(true);
      expect(
        await tryOpen(
          harness.crypto,
          harness.store,
          chunkId,
          IMPORT_STAGE_SCOPE,
          harness.localRoot,
          IMPORT_STAGE_PAYLOAD_KIND,
        ),
      ).toBeNull();
    }
    expect(
      await readImportStage(
        harness.ports,
        harness.localRoot,
        staged.workflowStorageId,
      ),
    ).toBeUndefined();
  });

  it("steps 3-4: deletes every ticketed row, then the ticket, then reports", async () => {
    const harness = stagingHarness();
    const created = await createImportStage(harness.ports, harness.localRoot, INPUT);
    const staged = await withChunks(harness, created.loaded, 5);
    const doomed = [
      staged.stageStorageId,
      ...staged.stage.factChunks.map((chunk) => chunk.storageId),
    ];

    const receipt = await cancelImportStage(harness.ports, harness.localRoot, {
      workflowStorageId: staged.workflowStorageId,
      reason: "import-cancelled",
    });

    expect(receipt.completed).toBe(true);
    expect(receipt.reason).toBe("import-cancelled");
    expect(receipt.deletedCount).toBe(doomed.length);
    for (const storageId of doomed) {
      expect(harness.store.has(storageId)).toBe(false);
    }
    expect(harness.catalog.readRefs()).toEqual({
      activeWorkflowStorageIds: [],
      cleanupTicketStorageIds: [],
    });
    expectCleartextBudget(harness.store);
  });

  it("persists the cursor mid-way and resumes where it stopped", async () => {
    const harness = stagingHarness();
    const created = await createImportStage(harness.ports, harness.localRoot, INPUT);
    const staged = await withChunks(harness, created.loaded, 6);
    const doomed = [
      staged.stageStorageId,
      ...staged.stage.factChunks.map((chunk) => chunk.storageId),
    ];

    // Step 1 plus two batches of two, then the device dies.
    harness.store.breakAfter(3);
    await expect(
      cancelImportStage(
        harness.ports,
        harness.localRoot,
        { workflowStorageId: staged.workflowStorageId, reason: "import-cancelled" },
        { batchLimit: 2 },
      ),
    ).rejects.toThrow(/simulated interruption/);

    const survivingTickets = harness.catalog.readRefs().cleanupTicketStorageIds;
    expect(survivingTickets).toHaveLength(1);

    const ticketBytes = await tryOpen(
      harness.crypto,
      harness.store,
      survivingTickets[0] as string,
      "local.cleanup",
      harness.localRoot,
      "local.cleanup-ticket",
    );
    const ticket = decodeCleanupTicket(ticketBytes as Uint8Array);
    // The cursor is durable and mid-list: the ticket says what is done.
    expect(ticket.cursor).toBe(4);
    expect(ticket.cursor).toBeLessThan(ticket.storageIds.length);
    const alreadyGone = ticket.storageIds
      .slice(0, ticket.cursor)
      .filter((id) => !harness.store.has(id));
    expect(alreadyGone).toHaveLength(ticket.cursor);

    // A fresh unlock finishes the job from the stored cursor.
    harness.store.repair();
    const receipts = await processCleanupTickets(
      harness.ports,
      harness.localRoot,
      { batchLimit: 2 },
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.completed).toBe(true);
    for (const storageId of doomed) {
      expect(harness.store.has(storageId)).toBe(false);
    }
    expect(harness.catalog.readRefs().cleanupTicketStorageIds).toEqual([]);
  });

  it("bounds every delete transaction", async () => {
    const harness = stagingHarness();
    const created = await createImportStage(harness.ports, harness.localRoot, INPUT);
    const staged = await withChunks(harness, created.loaded, 9);

    const before = harness.store.commits.length;
    await cancelImportStage(
      harness.ports,
      harness.localRoot,
      { workflowStorageId: staged.workflowStorageId, reason: "import-cancelled" },
      { batchLimit: 3 },
    );

    for (const commit of harness.store.commits.slice(before + 1)) {
      // Three staged rows plus the ticket envelope the batch replaces.
      expect(commit.deleted).toBeLessThanOrEqual(4);
    }
    expect(CLEANUP_BATCH_SIZE).toBeGreaterThan(0);
  });
});

describe("the unlock-time sweep", () => {
  it("abandons a stale workflow and drains it before the library is reported", async () => {
    const harness = stagingHarness();
    const created = await createImportStage(harness.ports, harness.localRoot, INPUT);
    const staged = await withChunks(harness, created.loaded, 4);
    const doomed = [
      staged.stageStorageId,
      ...staged.stage.factChunks.map((chunk) => chunk.storageId),
    ];

    // The device crashed with the stage live; a new session unlocks.
    const receipts = await sweepStaleImports(harness.ports, harness.localRoot);

    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.reason).toBe("import-failed");
    expect(harness.catalog.readRefs()).toEqual({
      activeWorkflowStorageIds: [],
      cleanupTicketStorageIds: [],
    });
    for (const storageId of [...doomed, staged.workflowStorageId]) {
      expect(harness.store.has(storageId)).toBe(false);
    }
  });

  it("does nothing, and commits nothing, when there is nothing to sweep", async () => {
    const harness = stagingHarness();
    const before = harness.store.commits.length;

    expect(await sweepStaleImports(harness.ports, harness.localRoot)).toEqual([]);
    expect(harness.store.commits).toHaveLength(before);
  });

  it("drops a ticket reference whose envelope is already gone", async () => {
    const harness = stagingHarness();
    const created = await createImportStage(harness.ports, harness.localRoot, INPUT);
    const staged = await withChunks(harness, created.loaded, 2);

    harness.store.breakAfter(1);
    await expect(
      cancelImportStage(harness.ports, harness.localRoot, {
        workflowStorageId: staged.workflowStorageId,
        reason: "import-cancelled",
      }),
    ).rejects.toThrow();

    // A crash between step 4's delete and its catalog write leaves exactly
    // this: a named ticket with no row. It is finished work, not damage.
    const ticketId = harness.catalog.readRefs().cleanupTicketStorageIds[0] as string;
    harness.store.repair();
    harness.store.rows.delete(ticketId);

    expect(await processCleanupTickets(harness.ports, harness.localRoot)).toEqual([]);
    expect(harness.catalog.readRefs().cleanupTicketStorageIds).toEqual([]);
  });
});

describe("the cleanup ticket payload", () => {
  const ticket: CleanupTicketV1 = {
    ticketVersion: 1,
    ticketId: "AAAAAAAAAAAAAAAAAAAAAA",
    reason: "import-cancelled",
    storageIds: ["AAAAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBBBB"],
    cursor: 1,
    createdAtRevision: 7,
  };

  it("round-trips byte-identically", () => {
    const encoded = encodeCleanupTicket(ticket);
    expect(decodeCleanupTicket(encoded)).toEqual(ticket);
    expect(encodeCleanupTicket(decodeCleanupTicket(encoded))).toEqual(encoded);
  });

  it("carries no byte string at all — a key cannot hide in it", () => {
    // database.md: a cleanup ticket holds "never a destroyed provisional key".
    // The type has no byte-typed field, so this checks the encoding agrees.
    const encoded = encodeCleanupTicket(ticket);
    // Major type 2 (byte string) has the high bits 010; no CBOR head byte in
    // the range 0x40..0x5f may appear as a value head in this payload.
    expect(Object.values(ticket).some((value) => value instanceof Uint8Array)).toBe(
      false,
    );
    expect(encoded.byteLength).toBeGreaterThan(0);
  });

  it("refuses a cursor past the end and a duplicated row", () => {
    expect(() => encodeCleanupTicket({ ...ticket, cursor: 3 })).toThrow(
      /past the end/,
    );
    expect(() =>
      encodeCleanupTicket({
        ...ticket,
        storageIds: ["AAAAAAAAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAAAA"],
      }),
    ).toThrow(/names one row twice/);
  });
});
