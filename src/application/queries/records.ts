/**
 * Record browse and search, as truthful bounded pages (M35; CA-14).
 *
 * The engine answers a page and an exact count; what this module adds is the
 * part a surface cannot infer and must not guess:
 *
 * - **The scope is stated, not implied.** A search page says what it searched
 *   — one hydrated table, by that table's own name — so "no results" can be
 *   rendered as "none in this table" rather than as "none anywhere".
 * - **A count is exact only when it came from `count(*)`.** {@link RecordPageV1}
 *   carries `isTotalExact: true` as a literal, so a future estimate cannot be
 *   put in the same field without changing the type.
 * - **Cursors are row keys, never offsets.** Continuing from `nextCursor`
 *   cannot skip or repeat a record because rows were written between two
 *   requests.
 *
 * The count reported beside a search is the table's total, and the type says
 * which: `scope` names the search, `totalCount` names the table. A count of
 * matches is a second `count(*)` the closed query surface does not offer, and
 * inventing one from `records.length` would be false the moment `hasMore` is
 * true.
 */

import type { TableId } from "../../domain/model/ids.js";
import type {
  ProjectionEnginePort,
  ProjectionRecordSummaryV1,
} from "../ports/projection.js";

/** The engine's own page ceiling; a request above it is refused, not clamped. */
export const MAX_RECORD_PAGE_SIZE = 1024;
export const DEFAULT_RECORD_PAGE_SIZE = 50;

export type RecordScopeV1 =
  | { readonly kind: "table" }
  | { readonly kind: "search"; readonly text: string };

export interface RecordQueryV1 {
  readonly tableId: TableId;
  /** The previous page's `nextCursor`; null starts at the beginning. */
  readonly cursor: number | null;
  readonly limit: number;
  /** Blank or absent text browses the table instead of searching it. */
  readonly search: string | null;
}

export interface RecordPageV1 {
  readonly tableId: TableId;
  /** What was actually looked at — the sentence a "no results" state needs. */
  readonly scope: RecordScopeV1;
  readonly records: readonly ProjectionRecordSummaryV1[];
  readonly hasMore: boolean;
  readonly nextCursor: number | null;
  /** Live records in the whole table. Exact, because it is `count(*)`. */
  readonly totalCount: number;
  readonly isTotalExact: true;
}

/** Normalizes a caller's paging request; a limit outside the range is refused. */
export function recordQuery(
  request: {
    readonly tableId: TableId;
    readonly cursor?: number | null;
    readonly limit?: number;
    readonly search?: string | null;
  },
): RecordQueryV1 {
  const limit = request.limit ?? DEFAULT_RECORD_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECORD_PAGE_SIZE) {
    throw new RangeError("record page size is outside the bounded range");
  }
  const cursor = request.cursor ?? null;
  if (cursor !== null && (!Number.isInteger(cursor) || cursor < 1)) {
    throw new RangeError("record cursor is not a page key this engine issued");
  }
  const search = request.search ?? null;
  return {
    tableId: request.tableId,
    cursor,
    limit,
    search: search !== null && search.trim().length > 0 ? search : null,
  };
}

export function planRecordPage(
  projection: ProjectionEnginePort,
  query: RecordQueryV1,
): RecordPageV1 {
  const page =
    query.search === null
      ? projection.execute({
          kind: "page-records",
          tableId: query.tableId,
          afterRecordPk: query.cursor,
          limit: query.limit,
        })
      : projection.execute({
          kind: "search-records",
          tableId: query.tableId,
          text: query.search,
          afterRecordPk: query.cursor,
          limit: query.limit,
        });

  return {
    tableId: query.tableId,
    scope:
      query.search === null
        ? { kind: "table" }
        : { kind: "search", text: query.search },
    records: page.records,
    hasMore: page.hasMore,
    nextCursor: page.hasMore ? page.nextRecordPk : null,
    totalCount: projection.execute({
      kind: "count-records",
      tableId: query.tableId,
    }),
    isTotalExact: true,
  };
}
