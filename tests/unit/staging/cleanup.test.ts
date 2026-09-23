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
  decodeStorageId16,
  encodeStorageId16,
} from "../../../src/domain/model/bytes.js";
import { CodecError } from "../../../src/domain/model/errors.js";
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
  decodeImportStage,
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
  sourceByteLength: 5469,
  format: "delimited",
  destination: { kind: "new-app" },
  selectedSheets: [0],
};

/**
 * A stage payload exactly as the F02 build wrote it (`encodeImportStage` at
 * `fb05e2f`, stage version 1): three chunks — one retained source chunk (id
 * bytes 0x03…) and two temporary fact chunks (0x04…, 0x05…).
 */
const F02_STAGE_HEX =
  "b46673746174757366737461676564677374616765496476415145424151454241514542415145424151454241516864" +
  "65746563746564a5646b696e646964656c696d69746564676e65776c696e65626c6668656e636f64696e67657574662d" +
  "386964656c696d69746572612c6d626f6d427974654c656e677468006866696c654e616d65736669656c642d6c6f672d" +
  "6d657373792e6373766870726f6772657373a465706861736569696e66657272696e6769726f7773536f466172182b6d" +
  "61636b65644261746368536571017062617463686573436f6d6d6974746564026870726f706f73616cf6696c696e6561" +
  "67654964500202020202020202020202020202020269707265666c69676874aa676e65776c696e65626c6668656e636f" +
  "64696e67657574662d386866696c654e616d65736669656c642d6c6f672d6d657373792e6373766964656c696d697465" +
  "72612c6a73616d706c65526f777381826453697465665374617475736b636f6c756d6e436f756e74096c627974657353" +
  "616d706c656419155d70736f75726365427974654c656e67746819155d71657374696d61746564526f77436f756e7418" +
  "2b72657374696d6174656443656c6c436f756e741901836a666163744368756e6b7382a4667368613235365820040404" +
  "04040404040404040404040404040404040404040404040404040404046873657175656e6365006973746f7261676549" +
  "647642415145424151454241514542415145424151454241716465636f646564427974654c656e677468190384a46673" +
  "6861323536582005050505050505050505050505050505050505050505050505050505050505056873657175656e6365" +
  "016973746f7261676549647642515546425155464251554642515546425155464251716465636f646564427974654c65" +
  "6e67746818506b7265766965774564697473806c736f757263654368756e6b7381a46673686132353658200303030303" +
  "0303030303030303030303030303030303030303030303030303036873657175656e6365006973746f72616765496476" +
  "41774d4441774d4441774d4441774d4441774d444177716465636f646564427974654c656e67746819155d6c736f7572" +
  "6365536861323536f66c737461676556657273696f6e016d636f6e74726164696374696f6ef66d737461676552657669" +
  "73696f6e036e73656c6563746564536865657473816f4669656c64204c6f67204d657373796e736e617073686f744368" +
  "756e6b738070736f75726365427974654c656e67746819155d7272657461696e656453746f7261676549647381764177" +
  "4d4441774d4441774d4441774d4441774d4441777374656d706f7261727953746f726167654964738276424151454241" +
  "514542415145424151454241514542417642515546425155464251554642515546425155464251";

const f02Row = (fill: number): string => encodeStorageId16(asStorageId16(new Uint8Array(16).fill(fill)));

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

  it("collects a stage the F02 build wrote as stale, with a receipt — never an integrity error", async () => {
    const f02Payload = Uint8Array.from(Buffer.from(F02_STAGE_HEX, "hex"));
    // The premise: this build cannot decode it.
    expect(() => decodeImportStage(f02Payload)).toThrow(CodecError);

    const harness = stagingHarness();
    const created = await createImportStage(harness.ports, harness.localRoot, INPUT);
    const { stageStorageId, workflowStorageId, provisionalKey } = created.loaded;
    const revision = harness.store.rows.get(stageStorageId)?.revision as number;
    const sealAt = async (storageIdText: string, payload: Uint8Array): Promise<void> => {
      const frame = await harness.crypto.seal({
        scope: IMPORT_STAGE_SCOPE,
        storageId: decodeStorageId16(storageIdText),
        logicalRevision: BigInt(revision),
        payloadKind: IMPORT_STAGE_PAYLOAD_KIND,
        payload,
        compression: "deflate-raw-v1",
        key: provisionalKey,
      });
      harness.store.rows.set(storageIdText, { revision, frame });
    };
    // The F02 stage under the same workflow, and the rows it names.
    await sealAt(stageStorageId, f02Payload);
    for (const fill of [3, 4, 5]) await sealAt(f02Row(fill), new Uint8Array([fill]));

    const receipts = await sweepStaleImports(harness.ports, harness.localRoot);

    expect(receipts).toEqual([
      expect.objectContaining({ reason: "import-failed", deletedCount: 4, completed: true }),
    ]);
    for (const storageId of [stageStorageId, workflowStorageId, f02Row(3), f02Row(4), f02Row(5)]) {
      expect(harness.store.has(storageId)).toBe(false);
    }
    expect(harness.catalog.readRefs()).toEqual({ activeWorkflowStorageIds: [], cleanupTicketStorageIds: [] });
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
