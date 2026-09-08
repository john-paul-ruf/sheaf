/**
 * The change log, paged (M35; CAP-17, CA-14).
 *
 * History is keyed by `(wall time, logical counter, event id)` rather than by
 * an offset, so a page cannot repeat or skip an entry because a commit landed
 * between two requests. Newest first, which is the order the surface reads in.
 *
 * **Recoverability is a fact of the entry, not a guess about it.** An entry is
 * restorable when the delete it records carried a complete restoration payload
 * (FR-12) — {@link HistoryEntryV1.restoration} is that payload, and its
 * presence is the whole test. Nothing here decides whether a restore would
 * *succeed*: that is the validator's answer at command time, against the
 * schema as it stands then.
 */

import type {
  ProjectionChangeEventV1,
  ProjectionEnginePort,
  ProjectionHistoryCursorV1,
} from "../ports/projection.js";

export const MAX_HISTORY_PAGE_SIZE = 1024;
export const DEFAULT_HISTORY_PAGE_SIZE = 50;

export type HistoryEntryV1 = ProjectionChangeEventV1;

export interface HistoryPageV1 {
  readonly entries: readonly HistoryEntryV1[];
  readonly hasMore: boolean;
  readonly nextCursor: ProjectionHistoryCursorV1 | null;
}

export function planHistoryPage(
  projection: ProjectionEnginePort,
  request: {
    readonly cursor?: ProjectionHistoryCursorV1 | null;
    readonly limit?: number;
  } = {},
): HistoryPageV1 {
  const limit = request.limit ?? DEFAULT_HISTORY_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_PAGE_SIZE) {
    throw new RangeError("history page size is outside the bounded range");
  }

  const page = projection.execute({
    kind: "page-change-history",
    after: request.cursor ?? null,
    limit,
  });

  return {
    entries: page.events,
    hasMore: page.hasMore,
    nextCursor: page.hasMore ? page.nextCursor : null,
  };
}

/** True when this entry records a delete that still carries its restoration. */
export const isRestorable = (entry: HistoryEntryV1): boolean =>
  entry.eventKind === "record.deleted" && entry.restoration !== null;
