/**
 * Record browse, search and query, as truthful bounded pages (M35; CA-14,
 * CA-29).
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
 *   requests. A sorted page continues from the last row's sort value *and*
 *   row key, so ties cannot straddle a page boundary.
 *
 * `totalCount` is always the table's. A page with filters or a sort goes
 * through the records query (CA-29), which also answers how many rows matched
 * (`total`) — exactly, or not at all: when the candidate budget (D53) stops
 * it, `total` is null and `partial` names what was examined. A plain browse
 * matches the whole table, so its `total` is the table's count; a plain
 * search keeps F03's page and answers no match count.
 */

import type { TableId } from "../../domain/model/ids.js";
import type {
  ProjectionEnginePort,
  ProjectionFilterTermV1,
  ProjectionRecordSortV1,
  ProjectionRecordSummaryV1,
  ProjectionSortValueV1,
} from "../ports/projection.js";
import { QUERY_CANDIDATE_ROW_BUDGET } from "./budgets.js";

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
  /** With a sort: the previous page's `nextSortValue`, paired with `cursor`. */
  readonly cursorSortValue: ProjectionSortValueV1;
  readonly limit: number;
  /** Blank or absent text browses the table instead of searching it. */
  readonly search: string | null;
  /** Compiled by `compileRecordQuery`; empty applies none. */
  readonly filters: readonly ProjectionFilterTermV1[];
  readonly sort: ProjectionRecordSortV1 | null;
}

/**
 * D53's partial answer: exactly how many candidate rows were examined, out of
 * how many the table holds, why it stopped, and what would widen it.
 */
export interface RecordQueryPartialV1 {
  readonly scanned: number;
  readonly tableTotal: number;
  readonly cause: "query-budget";
  readonly remedy: "narrow-filters";
}

export interface RecordPageV1 {
  readonly tableId: TableId;
  /** What was actually looked at — the sentence a "no results" state needs. */
  readonly scope: RecordScopeV1;
  readonly records: readonly ProjectionRecordSummaryV1[];
  readonly hasMore: boolean;
  readonly nextCursor: number | null;
  /** With a sort: the last row's sort value; pass back as `cursorSortValue`. */
  readonly nextSortValue: ProjectionSortValueV1;
  /** Live records in the whole table. Exact, because it is `count(*)`. */
  readonly totalCount: number;
  readonly isTotalExact: true;
  /** Rows matching the query, exactly; null when not counted (search) or cut short (partial). */
  readonly total: number | null;
  readonly partial: RecordQueryPartialV1 | null;
}

/** Normalizes a caller's paging request; a limit outside the range is refused. */
export function recordQuery(
  request: {
    readonly tableId: TableId;
    readonly cursor?: number | null;
    readonly cursorSortValue?: ProjectionSortValueV1;
    readonly limit?: number;
    readonly search?: string | null;
    readonly filters?: readonly ProjectionFilterTermV1[];
    readonly sort?: ProjectionRecordSortV1 | null;
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
    cursorSortValue: request.cursorSortValue ?? null,
    limit,
    search: search !== null && search.trim().length > 0 ? search : null,
    filters: request.filters ?? [],
    sort: request.sort ?? null,
  };
}

/**
 * One page. `candidateBudget` is D53's query budget; production reads the
 * constant, and a test injects a small one to reach the partial path.
 */
export function planRecordPage(
  projection: ProjectionEnginePort,
  query: RecordQueryV1,
  candidateBudget: number = QUERY_CANDIDATE_ROW_BUDGET,
): RecordPageV1 {
  const scope: RecordScopeV1 =
    query.search === null ? { kind: "table" } : { kind: "search", text: query.search };
  const totalCount = projection.execute({ kind: "count-records", tableId: query.tableId });

  if (query.filters.length > 0 || query.sort !== null) {
    const answer = projection.execute({
      kind: "query-records",
      tableId: query.tableId,
      search: query.search,
      filters: query.filters,
      sort: query.sort,
      after:
        query.cursor === null
          ? null
          : { recordPk: query.cursor, sortValue: query.sort === null ? null : query.cursorSortValue },
      limit: query.limit,
      candidateBudget,
    });
    return {
      tableId: query.tableId,
      scope,
      records: answer.records,
      hasMore: answer.hasMore,
      nextCursor: answer.next?.recordPk ?? null,
      nextSortValue: answer.next?.sortValue ?? null,
      totalCount,
      isTotalExact: true,
      total: answer.total,
      partial:
        answer.partial === null
          ? null
          : { ...answer.partial, cause: "query-budget", remedy: "narrow-filters" },
    };
  }

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
    scope,
    records: page.records,
    hasMore: page.hasMore,
    nextCursor: page.hasMore ? page.nextRecordPk : null,
    nextSortValue: null,
    totalCount,
    isTotalExact: true,
    total: query.search === null ? totalCount : null,
    partial: null,
  };
}
