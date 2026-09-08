/**
 * The encrypted local store, as the narrow contract its callers actually use
 * (M07; architecture § Dependency flow).
 *
 * Staging and promotion must be testable without IndexedDB and must not be
 * able to reach past this surface into Dexie, a table, or a revision counter.
 * So the port names exactly four operations — read the bootstrap pointers,
 * resolve one authenticated reference, commit one transaction, and page the
 * rows a revision introduced — and nothing else. There is no "open a
 * transaction" method, because a caller that could hold one open could also
 * run crypto inside it (database.md § Transaction rule).
 *
 * **One commit is one transaction.** {@link EnvelopeStorePort.commit} adds
 * immutable envelopes, deletes exactly-named unreachable ones, and moves the
 * bootstrap's catalog pointer together or not at all. That atomicity is what
 * makes cancellation's step 1 a single fact — the workflow reference is gone,
 * the key wrap is gone, and the cleanup ticket exists — rather than three
 * writes a crash can land between (database.md § Import staging).
 *
 * The port is stated over M11's own wire types rather than a re-declaration:
 * `EnvelopeFrameV1` is a DB-phase-owned durable format (migration 003), so
 * restating it here would be a second copy free to drift from the schema.
 */

import type { StorageId16 } from "../../domain/model/bytes.js";
import type { EnvelopeFrameV1 } from "../../migrations/003_envelope_format_v1.js";

/** What a writer must observe before it may write (M11's optimistic gate). */
export interface BootstrapSnapshotV1 {
  readonly transactionRevision: number;
  readonly writerEpoch: number;
  readonly catalogStorageId: string;
}

/**
 * The only bootstrap property staging moves. `migrationStorageId` is absent on
 * purpose: no import may retarget a migration journal.
 */
export interface CatalogPointerPatchV1 {
  readonly catalogStorageId: string;
}

export interface StoreCommitRequestV1 {
  readonly expectedRevision: number;
  readonly expectedWriterEpoch: number;
  /** Sealed at `expectedRevision + 1`; M11 refuses any other revision. */
  readonly addFrames: readonly EnvelopeFrameV1[];
  /**
   * Exact IDs a cleanup ticket already named. Never a range, never a
   * predicate: reachability is decided before the transaction opens, never
   * inferred from age or size (database.md § Encrypted mark-and-sweep).
   */
  readonly deleteStorageIds?: readonly StorageId16[];
  readonly bootstrapPatch?: CatalogPointerPatchV1;
}

/** A resumable page of one revision's rows; the cleanup sweep's read half. */
export interface RevisionPageV1 {
  readonly frames: readonly EnvelopeFrameV1[];
  readonly nextAfterStorageId: StorageId16 | undefined;
}

export interface EnvelopeStorePort {
  readBootstrap(): Promise<BootstrapSnapshotV1 | undefined>;
  getEnvelope(storageId: StorageId16): Promise<EnvelopeFrameV1 | undefined>;
  /** Returns the transaction revision the store now stands at. */
  commit(request: StoreCommitRequestV1): Promise<number>;
  listByRevision(
    revision: number,
    afterStorageId?: StorageId16,
  ): Promise<RevisionPageV1>;
}
