/**
 * Cancellation, refusal, and failure cleanup (M23; CA-10; database.md
 * § Import staging, cancellation order).
 *
 * The four steps are the contract, in this order and no other:
 *
 * 1. **One transaction** replaces the catalog without the workflow reference,
 *    deletes the workflow envelope that holds the key wrap, adds an encrypted
 *    cleanup ticket naming the rows to collect, and advances the bootstrap.
 * 2. The provisional key is now unreachable, so every staged byte is
 *    cryptographically inaccessible. **This is a consequence of step 1, not a
 *    further action** — there is no code here for it, and that is the point:
 *    it cannot be forgotten, delayed, or half-done.
 * 3. Ticketed rows are deleted in bounded transactions, each one persisting
 *    the advanced cursor in the same commit as its deletes, so an interrupted
 *    sweep resumes instead of restarting (§ Encrypted mark-and-sweep step 5).
 * 4. The ticket is removed, and only then is the receipt returned — because
 *    the receipt's claim is "every row is absent", not "deletion was started".
 *
 * The shell never had a partial app to display: no catalog app entry exists
 * before promotion, so there is nothing to withdraw and nothing to explain
 * away.
 *
 * **A ticket never carries a key.** Its type names only text, numbers, and a
 * reason — there is no byte field it could hold one in, which is why
 * database.md's "never a destroyed provisional key" is a shape here rather
 * than a rule someone has to remember.
 */

import { CodecError } from "../../domain/model/errors.js";
import {
  asStorageId16,
  decodeStorageId16,
  encodeStorageId16,
} from "../../domain/model/bytes.js";
import {
  decodeCanonical,
  encodeCanonical,
} from "../../persistence/codecs/canonical-cbor.js";
import type { EnvelopeFrameV1 } from "../../migrations/003_envelope_format_v1.js";
import type { EnvelopeKeyRefV1 } from "../../application/ports/envelope-crypto.js";
import {
  asMap,
  cborMap,
  count,
  exactKeys,
  field,
  list,
  oneOf,
  text,
} from "./proposal-codec.js";
import {
  readImportStage,
  stagedChunkStorageIds,
  type StagingPortsV1,
} from "./lifecycle.js";

const CLEANUP_SCOPE = "local.cleanup" as const;
const CLEANUP_PAYLOAD_KIND = "local.cleanup-ticket" as const;
const TICKET_VERSION = 1;
const STORAGE_ID_BYTES = 16;

/**
 * Rows deleted per transaction. Bounded so a large import's cleanup cannot
 * hold one IndexedDB transaction open long enough to be auto-committed under
 * it (database.md § Transaction rule).
 */
export const CLEANUP_BATCH_SIZE = 32;

export const CLEANUP_REASONS = Object.freeze([
  "import-cancelled",
  "import-failed",
  "import-promoted",
] as const);

export type CleanupReasonV1 = (typeof CLEANUP_REASONS)[number];

/**
 * `CleanupTicketV1` (database.md § Encrypted Logical Collections): storage IDs
 * to delete, a reason, a cursor, and the revision it was created at. Nothing
 * else — and nothing of any byte type.
 */
export interface CleanupTicketV1 {
  readonly ticketVersion: typeof TICKET_VERSION;
  readonly ticketId: string;
  readonly reason: CleanupReasonV1;
  /** Sorted and unique, so the cursor means the same thing on every resume. */
  readonly storageIds: readonly string[];
  /** How many leading IDs are already known absent. */
  readonly cursor: number;
  readonly createdAtRevision: number;
}

/** What the surface renders as "nothing was left behind" (CAP-11). */
export interface CleanupReceiptV1 {
  readonly ticketId: string;
  readonly reason: CleanupReasonV1;
  readonly deletedCount: number;
  readonly batches: number;
  readonly completed: true;
}

// ------------------------------------------------------------ ticket codec --

export function encodeCleanupTicket(ticket: CleanupTicketV1): Uint8Array {
  if (ticket.cursor > ticket.storageIds.length) {
    throw new CodecError("a cleanup cursor is past the end of its list");
  }
  if (new Set(ticket.storageIds).size !== ticket.storageIds.length) {
    throw new CodecError("a cleanup ticket names one row twice");
  }
  return encodeCanonical(
    cborMap([
      ["ticketVersion", ticket.ticketVersion],
      ["ticketId", ticket.ticketId],
      ["reason", ticket.reason],
      ["storageIds", [...ticket.storageIds]],
      ["cursor", ticket.cursor],
      ["createdAtRevision", ticket.createdAtRevision],
    ]),
  );
}

export function decodeCleanupTicket(payload: Uint8Array): CleanupTicketV1 {
  const map = exactKeys(
    asMap(decodeCanonical(payload), "a cleanup ticket"),
    [
      "ticketVersion",
      "ticketId",
      "reason",
      "storageIds",
      "cursor",
      "createdAtRevision",
    ],
    "a cleanup ticket",
  );
  if (count(field(map, "ticketVersion"), "a ticket version") !== TICKET_VERSION) {
    throw new CodecError("cleanup ticket declares an unsupported version");
  }

  const storageIds = list(field(map, "storageIds"), "ticket storage ids").map(
    (value) => text(value, "a ticket storage id"),
  );
  const cursor = count(field(map, "cursor"), "a cleanup cursor");
  if (cursor > storageIds.length) {
    throw new CodecError("a cleanup cursor is past the end of its list");
  }

  return {
    ticketVersion: TICKET_VERSION,
    ticketId: text(field(map, "ticketId"), "a ticket id"),
    reason: oneOf(field(map, "reason"), CLEANUP_REASONS, "a cleanup reason"),
    storageIds,
    cursor,
    createdAtRevision: count(
      field(map, "createdAtRevision"),
      "a ticket creation revision",
    ),
  };
}

// ------------------------------------------------------------------- step 1 --

export interface AbandonStageInputV1 {
  readonly workflowStorageId: string;
  readonly reason: CleanupReasonV1;
  /** Rows to collect beyond the stage's own chunks (promotion's temporaries). */
  readonly extraStorageIds?: readonly string[];
}

/**
 * Step 1, whole. After it commits there is no path to the provisional key, so
 * the staged bytes are unreadable even to this worker — which is why the
 * ticket that follows names only opaque row IDs and needs no key to finish.
 */
async function abandonStage(
  ports: StagingPortsV1,
  localRoot: EnvelopeKeyRefV1,
  input: AbandonStageInputV1,
): Promise<CleanupTicketV1> {
  const loaded = await readImportStage(ports, localRoot, input.workflowStorageId);

  const doomed = new Set<string>([
    ...(input.extraStorageIds ?? []),
    // The workflow envelope is deleted below, in this same transaction; the
    // stage payload is collected by the ticket like every other opaque row.
    ...(loaded === undefined ? [] : [loaded.stageStorageId]),
    ...(loaded === undefined ? [] : stagedChunkStorageIds(loaded.stage)),
  ]);
  if (loaded !== undefined) {
    // The key handle dies with the transaction that orphans its wrap.
    ports.crypto.destroyKey(loaded.provisionalKey);
  }

  const expectation = ports.catalog.expectation();
  const revision = expectation.transactionRevision + 1;
  const ticketStorageId = asStorageId16(
    ports.entropy.randomBytes(STORAGE_ID_BYTES),
  );
  const ticketId = encodeStorageId16(ticketStorageId);

  const ticket: CleanupTicketV1 = {
    ticketVersion: TICKET_VERSION,
    ticketId,
    reason: input.reason,
    storageIds: [...doomed].sort(),
    cursor: 0,
    createdAtRevision: revision,
  };

  const ticketFrame = await ports.crypto.seal({
    scope: CLEANUP_SCOPE,
    storageId: ticketStorageId,
    logicalRevision: BigInt(revision),
    payloadKind: CLEANUP_PAYLOAD_KIND,
    payload: encodeCleanupTicket(ticket),
    compression: "deflate-raw-v1",
    key: localRoot,
  });

  const refs = ports.catalog.readRefs();
  const sealedCatalog = await ports.catalog.sealWithRefs(
    {
      activeWorkflowStorageIds: refs.activeWorkflowStorageIds.filter(
        (id) => id !== input.workflowStorageId,
      ),
      cleanupTicketStorageIds: [...refs.cleanupTicketStorageIds, ticketId],
    },
    BigInt(revision),
  );

  const committed = await ports.store.commit({
    expectedRevision: expectation.transactionRevision,
    expectedWriterEpoch: expectation.writerEpoch,
    addFrames: [ticketFrame, sealedCatalog.frame],
    // The key wrap, gone in the same breath as the reference that named it.
    deleteStorageIds: [decodeStorageId16(input.workflowStorageId)],
    bootstrapPatch: { catalogStorageId: sealedCatalog.storageId },
  });
  ports.catalog.adopt(sealedCatalog.storageId, committed);

  return ticket;
}

// ---------------------------------------------------------------- steps 3–4 --

/**
 * Steps 3 and 4. Each batch deletes at most {@link CLEANUP_BATCH_SIZE} rows
 * and writes the advanced cursor **in the same transaction**, so a crash
 * mid-sweep loses at most the batch that was in flight; the ticket that
 * survives already says what is done. The ticket is removed only in the batch
 * that empties the list.
 */
async function drainTicket(
  ports: StagingPortsV1,
  localRoot: EnvelopeKeyRefV1,
  start: CleanupTicketV1,
  startStorageId: string,
  batchLimit: number,
): Promise<CleanupReceiptV1> {
  let ticket = start;
  let ticketStorageId = startStorageId;
  let batches = 0;

  while (ticket.cursor < ticket.storageIds.length) {
    const slice = ticket.storageIds.slice(
      ticket.cursor,
      ticket.cursor + batchLimit,
    );
    const nextCursor = ticket.cursor + slice.length;
    const isLast = nextCursor === ticket.storageIds.length;

    const expectation = ports.catalog.expectation();
    const revision = expectation.transactionRevision + 1;
    const refs = ports.catalog.readRefs();

    const deleteStorageIds = [
      ...slice.map(decodeStorageId16),
      // The ticket envelope itself is immutable, so advancing the cursor
      // means replacing it. On the last batch it is simply not replaced.
      decodeStorageId16(ticketStorageId),
    ];

    // The cursor always advances locally; only the *envelope* that carries it
    // is skipped on the last batch, because there the ticket is being removed
    // rather than replaced.
    const nextTicket: CleanupTicketV1 = { ...ticket, cursor: nextCursor };
    let nextTicketStorageId = ticketStorageId;
    const addFrames: EnvelopeFrameV1[] = [];

    if (!isLast) {
      const replacementStorageId = asStorageId16(
        ports.entropy.randomBytes(STORAGE_ID_BYTES),
      );
      nextTicketStorageId = encodeStorageId16(replacementStorageId);
      addFrames.push(
        await ports.crypto.seal({
          scope: CLEANUP_SCOPE,
          storageId: replacementStorageId,
          logicalRevision: BigInt(revision),
          payloadKind: CLEANUP_PAYLOAD_KIND,
          payload: encodeCleanupTicket(nextTicket),
          compression: "deflate-raw-v1",
          key: localRoot,
        }),
      );
    }

    const remainingTickets = refs.cleanupTicketStorageIds.filter(
      (id) => id !== ticketStorageId,
    );
    const sealedCatalog = await ports.catalog.sealWithRefs(
      {
        activeWorkflowStorageIds: refs.activeWorkflowStorageIds,
        cleanupTicketStorageIds: isLast
          ? remainingTickets
          : [...remainingTickets, nextTicketStorageId],
      },
      BigInt(revision),
    );
    addFrames.push(sealedCatalog.frame);

    const committed = await ports.store.commit({
      expectedRevision: expectation.transactionRevision,
      expectedWriterEpoch: expectation.writerEpoch,
      addFrames,
      deleteStorageIds,
      bootstrapPatch: { catalogStorageId: sealedCatalog.storageId },
    });
    ports.catalog.adopt(sealedCatalog.storageId, committed);

    ticket = nextTicket;
    ticketStorageId = nextTicketStorageId;
    batches += 1;
  }

  // Step 4: the receipt is issued only here, after the loop has driven the
  // cursor to the end and the ticket is gone.
  return {
    ticketId: ticket.ticketId,
    reason: ticket.reason,
    deletedCount: ticket.storageIds.length,
    batches,
    completed: true,
  };
}

/** Opens a ticket the catalog names, or `undefined` if its row is gone. */
async function loadTicket(
  ports: StagingPortsV1,
  localRoot: EnvelopeKeyRefV1,
  ticketStorageId: string,
): Promise<CleanupTicketV1 | undefined> {
  const frame = await ports.store.getEnvelope(decodeStorageId16(ticketStorageId));
  if (frame === undefined) {
    return undefined;
  }
  const opened = await ports.crypto.open(
    frame,
    CLEANUP_SCOPE,
    localRoot,
    CLEANUP_PAYLOAD_KIND,
  );
  return decodeCleanupTicket(opened.payload);
}

// --------------------------------------------------------------- the orders --

export interface CleanupOptionsV1 {
  readonly batchLimit?: number;
}

/**
 * The whole four-step order for one staged import. Returns the receipt the
 * surface renders; there is no partial success, because step 4 is the only
 * exit.
 */
export async function cancelImportStage(
  ports: StagingPortsV1,
  localRoot: EnvelopeKeyRefV1,
  input: AbandonStageInputV1,
  options: CleanupOptionsV1 = {},
): Promise<CleanupReceiptV1> {
  const ticket = await abandonStage(ports, localRoot, input);
  // `ticketId` is the ticket envelope's own storage-id text, so the drain
  // needs no second identifier to find what it must replace.
  return drainTicket(
    ports,
    localRoot,
    ticket,
    ticket.ticketId,
    options.batchLimit ?? CLEANUP_BATCH_SIZE,
  );
}

/**
 * Finishes every ticket the catalog still names. Safe to call repeatedly: a
 * ticket whose envelope is already gone is dropped from the catalog rather
 * than treated as damage, because that is exactly what a crash between step 4
 * and its catalog write leaves behind.
 */
export async function processCleanupTickets(
  ports: StagingPortsV1,
  localRoot: EnvelopeKeyRefV1,
  options: CleanupOptionsV1 = {},
): Promise<readonly CleanupReceiptV1[]> {
  const receipts: CleanupReceiptV1[] = [];

  for (const ticketStorageId of [...ports.catalog.readRefs().cleanupTicketStorageIds]) {
    const ticket = await loadTicket(ports, localRoot, ticketStorageId);
    if (ticket === undefined) {
      await forgetTicket(ports, ticketStorageId);
      continue;
    }
    receipts.push(
      await drainTicket(
        ports,
        localRoot,
        ticket,
        ticketStorageId,
        options.batchLimit ?? CLEANUP_BATCH_SIZE,
      ),
    );
  }

  return receipts;
}

/** Drops a dangling ticket reference; deletes nothing, because nothing is left. */
async function forgetTicket(
  ports: StagingPortsV1,
  ticketStorageId: string,
): Promise<void> {
  const expectation = ports.catalog.expectation();
  const refs = ports.catalog.readRefs();
  const sealedCatalog = await ports.catalog.sealWithRefs(
    {
      activeWorkflowStorageIds: refs.activeWorkflowStorageIds,
      cleanupTicketStorageIds: refs.cleanupTicketStorageIds.filter(
        (id) => id !== ticketStorageId,
      ),
    },
    BigInt(expectation.transactionRevision + 1),
  );
  const committed = await ports.store.commit({
    expectedRevision: expectation.transactionRevision,
    expectedWriterEpoch: expectation.writerEpoch,
    addFrames: [sealedCatalog.frame],
    bootstrapPatch: { catalogStorageId: sealedCatalog.storageId },
  });
  ports.catalog.adopt(sealedCatalog.storageId, committed);
}

/**
 * The unlock-time sweep (M23's contract): a catalog holding a stale workflow
 * reference or an unfinished ticket resumes cleanup **before the library is
 * reported**, so a device that crashed mid-import never shows the user a
 * half-import it is still carrying.
 *
 * A stale workflow is abandoned first — that is the same step 1 a live cancel
 * runs — and then every ticket, including the one that abandonment just wrote,
 * is drained.
 */
export async function sweepStaleImports(
  ports: StagingPortsV1,
  localRoot: EnvelopeKeyRefV1,
  options: CleanupOptionsV1 = {},
): Promise<readonly CleanupReceiptV1[]> {
  for (const workflowStorageId of [
    ...ports.catalog.readRefs().activeWorkflowStorageIds,
  ]) {
    await abandonStage(ports, localRoot, {
      workflowStorageId,
      reason: "import-failed",
    });
  }
  return processCleanupTickets(ports, localRoot, options);
}
