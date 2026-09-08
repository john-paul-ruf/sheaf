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
 */

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
  readonly bootstrapPatch?: BootstrapPatch;
}

/** Returns the transaction revision the store now stands at. */
export async function commitEnvelopes(request: CommitRequest): Promise<number> {
  const database = await openLocalDatabase();
  const revision = nextRevision(request.expectedRevision);
  const rows = request.addFrames.map((frame) => frameToRow(frame, revision));

  const committed = await database.transaction(
    "rw",
    database.bootstrap,
    database.envelopes,
    async () => {
      const current = assertExpectedBootstrap(
        await database.bootstrap.get(LOCAL_BOOTSTRAP_SLOT),
        request,
      );

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
