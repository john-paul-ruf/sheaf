/**
 * The catalog, as the two lists staging is allowed to move (M07).
 *
 * Every staging transaction replaces the catalog: creating a stage adds a
 * workflow reference, cancelling one removes it and adds a cleanup ticket, and
 * finishing the cleanup removes that. But staging must not know what a catalog
 * *is* — the shape, its seven constraints, and its encoding belong to M33, and
 * a staging module that imported them could no longer be unit-tested without a
 * worker (M23's must-not: no `src/workers/` import).
 *
 * So the port exposes exactly the reference lists, the optimistic expectation,
 * and a seal. The four-step cancellation order stays inside M23 where
 * database.md § Import staging puts it; what a catalog looks like stays inside
 * M33 where CA-03 puts it.
 */

import type { EnvelopeFrameV1 } from "../../migrations/003_envelope_format_v1.js";
import type { BootstrapSnapshotV1 } from "./envelope-store.js";

/** The only catalog fields a staging transaction may move. */
export interface StagingCatalogRefsV1 {
  readonly activeWorkflowStorageIds: readonly string[];
  readonly cleanupTicketStorageIds: readonly string[];
}

export interface SealedCatalogV1 {
  readonly frame: EnvelopeFrameV1;
  readonly storageId: string;
}

export interface StagingCatalogPort {
  readRefs(): StagingCatalogRefsV1;
  /** What the next commit must still find true (M11's optimistic gate). */
  expectation(): Omit<BootstrapSnapshotV1, "catalogStorageId">;
  /**
   * Seals a catalog carrying `refs` at the revision the commit will land on.
   * The implementation re-validates: staging cannot write a catalog that
   * fails CA-03's checks.
   */
  sealWithRefs(
    refs: StagingCatalogRefsV1,
    logicalRevision: bigint,
  ): Promise<SealedCatalogV1>;
  /**
   * Adopts the catalog a commit just landed, so the next step in a multi-step
   * order — the bounded cleanup loop — expects the revision it created rather
   * than the one it started from.
   */
  adopt(catalogStorageId: string, transactionRevision: number): void;
}
