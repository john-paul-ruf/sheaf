/**
 * The one write path for envelopes (CA-01, database.md § `bootstrap`).
 *
 * A commit reads the bootstrap row, compares the caller's expected revision
 * *and* writer epoch, `add`s every replacement envelope, and replaces the
 * bootstrap row — all inside one `bootstrap + envelopes` transaction. The
 * comparison happens before the first write, so a stale caller changes
 * nothing; envelopes use `add` rather than `put`, so a duplicate random
 * storage ID aborts the whole transaction instead of mutating a row someone
 * else's pointer still resolves to.
 *
 * Frames must already be sealed at the revision this commit lands on
 * (`expectedRevision + 1`) because that number is bound into their AAD
 * (D12/AD-6). `frameToRow` enforces it; there is no re-labelling.
 *
 * **Deletion is by exact key, in the same transaction (F02, S04).**
 * `deleteStorageIds` removes rows a cleanup ticket has already decided are
 * unreachable. It exists because cancelling an import must be one fact and
 * not three: replacing the catalog without its workflow reference, destroying
 * the key wrap that reaches the staged bytes, adding the cleanup ticket, and
 * advancing the bootstrap all land together, so no crash can leave a stage
 * that is half-abandoned (database.md § Import staging, cancellation step 1;
 * § Encrypted mark-and-sweep step 5).
 *
 * The immutability rule is intact: `delete` is not `put`, so an envelope is
 * either present or gone and is never rewritten under a pointer that still
 * resolves to it. Reachability is decided *before* the transaction opens —
 * only exact primary keys are accepted, never a range, a predicate, or an
 * inference from a row's age or padded size.
 */

import { encodeStorageId16, type StorageId16 } from "../../domain/model/bytes.js";
import type { EnvelopeFrameV1 } from "../../migrations/003_envelope_format_v1.js";
import { LOCAL_BOOTSTRAP_SLOT } from "../../migrations/001_local_store_v1.js";
import {
  assertExpectedBootstrap,
  nextRevision,
  type BootstrapExpectation,
} from "./bootstrap.js";
import { openLocalDatabase } from "./db.js";
import { EnvelopeExistsError, isDuplicateKeyFailure } from "./errors.js";
import { frameToRow } from "./frame-row.js";
import { publishRevision } from "./revision-signal.js";

/** The only bootstrap properties an ordinary commit may move. */
export interface BootstrapPatch {
  readonly catalogStorageId?: string;
  readonly migrationStorageId?: string | null;
}

export interface CommitRequest extends BootstrapExpectation {
  readonly addFrames: readonly EnvelopeFrameV1[];
  /** Exact rows an authenticated cleanup ticket already named. */
  readonly deleteStorageIds?: readonly StorageId16[];
  readonly bootstrapPatch?: BootstrapPatch;
}

/** Returns the transaction revision the store now stands at. */
export async function commitEnvelopes(request: CommitRequest): Promise<number> {
  const database = await openLocalDatabase();
  const revision = nextRevision(request.expectedRevision);
  const rows = request.addFrames.map((frame) => frameToRow(frame, revision));
  const deleteKeys = (request.deleteStorageIds ?? []).map(encodeStorageId16);

  const committed = await database.transaction(
    "rw",
    database.bootstrap,
    database.envelopes,
    async () => {
      const current = assertExpectedBootstrap(
        await database.bootstrap.get(LOCAL_BOOTSTRAP_SLOT),
        request,
      );

      // After the gate, so a stale caller deletes nothing. Deleting a key that
      // is already absent is a no-op, which is what lets an interrupted
      // bounded sweep resume by replaying its cursor.
      for (const key of deleteKeys) {
        await database.envelopes.delete(key);
      }

      for (const row of rows) {
        try {
          await database.envelopes.add(row);
        } catch (cause) {
          throw isDuplicateKeyFailure(cause) ? new EnvelopeExistsError() : cause;
        }
      }

      await database.bootstrap.put({
        ...current,
        ...request.bootstrapPatch,
        transactionRevision: revision,
      });
      return revision;
    },
  );

  publishRevision(committed);
  return committed;
}
