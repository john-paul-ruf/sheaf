/**
 * Where a fact came from (database.md § Atomic commit envelope, 004's
 * `EventProvenanceV1`).
 *
 * Provenance is evidence, not authority: it explains a value to a person and
 * lets a review show its source, but it never decides an ordering or resolves
 * a conflict — the frontier and per-device sequence do that.
 *
 * The source list is closed for event format 1 and mirrors
 * `src/migrations/004_event_format_v1.ts` field for field. M01 imports nothing
 * outward, so the shapes are restated here structurally;
 * `tests/unit/domain/provenance.test.ts` pins them assignable to 004's types
 * in both directions, so a drift is a compile error there rather than a wire
 * mismatch at promotion.
 */

import type { AnyDomainId } from "./ids.js";

export const PROVENANCE_SOURCES = Object.freeze([
  "user",
  "initial-import",
  "workbook-reupload",
  "remote-device",
  "conflict-resolution",
  "compaction",
] as const);

export type ProvenanceSourceV1 = (typeof PROVENANCE_SOURCES)[number];

/** F02 writes only two of them: `user` for CRUD, `initial-import` for the CSV. */
export interface ValueProvenanceV1 {
  readonly source: ProvenanceSourceV1;
  /** The lineage, device, or conflict this fact came through. */
  readonly sourceId?: AnyDomainId;
  /** Display evidence only — never an ordering input. */
  readonly sourceTimestampMs?: bigint;
  /** Review evidence, canonically encodable; shape is the producer's. */
  readonly evidence?: unknown;
}
