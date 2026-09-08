/**
 * The single clear row: creation, read, and the passphrase-change update
 * (CA-01, database.md § `bootstrap`).
 *
 * Creation uses `add`, so a second bootstrap fails instead of overwriting a
 * store that already holds a user's data. Passphrase change rewrites exactly
 * three properties — the KDF descriptor, the passphrase wrapper, and the
 * transaction revision — and never touches an envelope: re-wrapping the local
 * root cannot lose data, and that is the whole point of CAP-04.
 */

import {
  LOCAL_BOOTSTRAP_SLOT,
  type Argon2idDescriptorV1,
  type LocalBootstrapRowV1,
  type WrappedLocalRootV1,
} from "../../migrations/001_local_store_v1.js";
import type { EnvelopeFrameV1 } from "../../migrations/003_envelope_format_v1.js";
import { openLocalDatabase } from "./db.js";
import {
  BootstrapExistsError,
  EnvelopeExistsError,
  RevisionConflictError,
  isDuplicateKeyFailure,
} from "./errors.js";
import { frameToRow } from "./frame-row.js";

/** What the caller believes it read before deciding to write (CA-01). */
export interface BootstrapExpectation {
  readonly transactionRevision: number;
  readonly writerEpoch: number;
}

/**
 * The optimistic gate every write shares: a caller that read revision `r` and
 * epoch `e` may only write while the row still says exactly that.
 */
export function assertExpectedBootstrap(
  current: LocalBootstrapRowV1 | undefined,
  expected: BootstrapExpectation,
): LocalBootstrapRowV1 {
  if (
    current === undefined ||
    current.transactionRevision !== expected.transactionRevision ||
    current.writerEpoch !== expected.writerEpoch
  ) {
    throw new RevisionConflictError(
      expected.transactionRevision,
      expected.writerEpoch,
      current?.transactionRevision ?? null,
      current?.writerEpoch ?? null,
    );
  }
  return current;
}

/**
 * Monotonic transaction revision. Reaching the safe-integer guard band is a
 * migration condition, not wraparound (database.md § `bootstrap`).
 */
export function nextRevision(current: number): number {
  const revision = current + 1;
  if (!Number.isSafeInteger(revision)) {
    throw new RangeError("local transaction revision reached the safe-integer guard band");
  }
  return revision;
}

/**
 * Writes the bootstrap row and the envelopes it already points at in one
 * transaction, so setup can never leave a bootstrap whose catalog pointer
 * resolves to nothing (CAP-01). Frames must be sealed at the row's own
 * `transactionRevision`.
 */
export async function createBootstrap(
  row: LocalBootstrapRowV1,
  addFrames: readonly EnvelopeFrameV1[] = [],
): Promise<void> {
  const database = await openLocalDatabase();
  const rows = addFrames.map((frame) => frameToRow(frame, row.transactionRevision));

  await database.transaction(
    "rw",
    database.bootstrap,
    database.envelopes,
    async () => {
      try {
        await database.bootstrap.add(row);
      } catch (cause) {
        throw isDuplicateKeyFailure(cause) ? new BootstrapExistsError() : cause;
      }
      for (const envelopeRow of rows) {
        try {
          await database.envelopes.add(envelopeRow);
        } catch (cause) {
          throw isDuplicateKeyFailure(cause) ? new EnvelopeExistsError() : cause;
        }
      }
    },
  );
}

export async function readBootstrap(): Promise<LocalBootstrapRowV1 | undefined> {
  const database = await openLocalDatabase();
  return database.bootstrap.get(LOCAL_BOOTSTRAP_SLOT);
}

/**
 * Re-wraps the local root under a new passphrase and returns the new
 * transaction revision. The parameter list is the allowed field set: nothing
 * else about the store can change through this call.
 */
export async function updateForPassphraseChange(
  expected: BootstrapExpectation,
  newKdf: Argon2idDescriptorV1,
  newWrappedRoot: WrappedLocalRootV1,
): Promise<number> {
  const database = await openLocalDatabase();

  return database.transaction("rw", database.bootstrap, async () => {
    const current = assertExpectedBootstrap(
      await database.bootstrap.get(LOCAL_BOOTSTRAP_SLOT),
      expected,
    );
    const revision = nextRevision(current.transactionRevision);
    await database.bootstrap.put({
      ...current,
      passphraseKdf: newKdf,
      passphraseWrappedRoot: newWrappedRoot,
      transactionRevision: revision,
    });
    return revision;
  });
}
