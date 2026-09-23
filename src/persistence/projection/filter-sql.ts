/**
 * The records query's statements (CA-29): search ∧ typed filters ∧ one sort,
 * composed from closed fragments.
 *
 * `statements.ts` holds every fixed statement; a records query cannot be one,
 * because how many filters it carries, over which lanes, and in which order
 * are the request's. So this module composes — and holds to the same rule by
 * construction: **every fragment below is a literal, and every value is a
 * bound parameter.** The only things a request chooses are *which* literal
 * fragments appear and how many `?` an `IN` list has. No text, number, id or
 * key from a request is ever written into SQL; `filter-sql.test.ts` proves it
 * by compiling hostile values and reading the statement text.
 *
 * Each filter is an `EXISTS` over one typed lane of `cells`, answered by the
 * migration-005 lane indexes (`idx_cells_field_{id,integer,decimal,text}`).
 * A computed column's cells are ordinary lane rows (`origin = 'computed'`), so
 * it filters and sorts exactly like an authored one. The states that have no
 * lane — missing, blank, invalid-preserved — are read from the authored blob
 * through `sheaf_authored_kind` (`authored-functions.ts`) rather than inferred
 * from a lane's absence. Text filters fold both sides through `sheaf_fold_text`
 * (case-insensitive NFC), and the operand is folded before it is bound.
 *
 * A sort reads one lane per row. Rows with no value there sort **last in both
 * directions**, and ties break on `record_pk`, so a keyset over
 * `(sort value, record_pk)` pages without skipping or repeating.
 */

import { CodecError } from "../../domain/model/errors.js";
import type { FieldDefV1, FieldTypeV1 } from "../../domain/model/schema.js";
import { foldText } from "../../domain/formulas/scalars.js";
import { AUTHORED_KIND_FUNCTION, FOLD_TEXT_FUNCTION } from "./authored-functions.js";
import type { ProjectionHandleV1, SqlParam } from "./engine.js";
import { idKey } from "./record-rows.js";
import { decimalOrderKeyV1 } from "./sort-keys.js";
import { RECORD_SUMMARY_COLUMNS } from "./statements.js";
import type {
  ProjectionFilterTermV1,
  ProjectionQueryCursorV1,
  ProjectionRecordSortV1,
} from "./types.js";

/** One composed statement and its values, in placeholder order. */
export interface ComposedStatementV1 {
  readonly sql: string;
  readonly parameters: readonly SqlParam[];
}

/** What a query examines: one table, optionally searched, optionally cut at a row key. */
export interface QueryScopeV1 {
  readonly tableId: Uint8Array;
  /** An FTS5 query from `toFtsMatchQuery`, or null for no search. */
  readonly match: string | null;
  /** The last candidate row the budget admits, or null when all are admitted. */
  readonly boundaryPk: number | null;
}

/** An `IN` list longer than this is refused; SQLite's variable limit is far above it. */
export const MAX_FILTER_VALUES = 1_000;
export const MAX_FILTERS = 32;

interface Fragment {
  readonly sql: string;
  readonly parameters: readonly SqlParam[];
}

const fragment = (sql: string, ...parameters: SqlParam[]): Fragment => ({ sql, parameters });

const joinFragments = (parts: readonly Fragment[], separator: string): Fragment => ({
  sql: parts.map((part) => part.sql).join(separator),
  parameters: parts.flatMap((part) => part.parameters),
});

/** `?, ?, ?` — the only variable-length SQL a request can cause. */
const placeholders = (count: number): string => Array.from({ length: count }, () => "?").join(", ");

// ------------------------------------------------------------------ scope --

const SCOPE_TABLE = "r.table_id = ?";
const SCOPE_SEARCH =
  "r.record_pk IN (SELECT rowid FROM record_search WHERE record_search MATCH ?)";
const SCOPE_BOUNDARY = "r.record_pk <= ?";

function scopeWhere(scope: QueryScopeV1): Fragment {
  return joinFragments(
    [
      fragment(SCOPE_TABLE, scope.tableId),
      ...(scope.match === null ? [] : [fragment(SCOPE_SEARCH, scope.match)]),
      ...(scope.boundaryPk === null ? [] : [fragment(SCOPE_BOUNDARY, scope.boundaryPk)]),
    ],
    " AND ",
  );
}

/** How many candidate rows the scope holds, counting no further than `ceiling`. */
export function candidateCountStatement(scope: QueryScopeV1, ceiling: number): ComposedStatementV1 {
  const where = scopeWhere({ ...scope, boundaryPk: null });
  return {
    sql: `SELECT count(*) FROM (SELECT 1 FROM records AS r WHERE ${where.sql} LIMIT ?);`,
    parameters: [...where.parameters, ceiling],
  };
}

/** The row key of the `admitted`-th candidate in row-key order: the budget's cut. */
export function candidateBoundaryStatement(scope: QueryScopeV1, admitted: number): ComposedStatementV1 {
  const where = scopeWhere({ ...scope, boundaryPk: null });
  return {
    sql: `SELECT r.record_pk FROM records AS r WHERE ${where.sql} ORDER BY r.record_pk LIMIT 1 OFFSET ?;`,
    parameters: [...where.parameters, admitted - 1],
  };
}

// ---------------------------------------------------------------- filters --

const IN_LANE = (predicate: string): string =>
  `EXISTS (SELECT 1 FROM cells AS c WHERE c.record_pk = r.record_pk AND c.field_id = ? AND ${predicate})`;

const ID_IN = (count: number): string => IN_LANE(`c.value_kind = 'id' AND c.id_value IN (${placeholders(count)})`);
const INTEGER_RANGE = IN_LANE(
  "c.value_kind = 'integer' AND (? IS NULL OR c.integer_value >= ?) AND (? IS NULL OR c.integer_value <= ?)",
);
const DECIMAL_RANGE = IN_LANE(
  "c.value_kind = 'decimal' AND (? IS NULL OR c.decimal_order_key >= ?) AND (? IS NULL OR c.decimal_order_key <= ?)",
);
/** Text compares case-insensitively over NFC: the lane's folded text against a folded operand. */
const TEXT_EQUALS = IN_LANE(`c.value_kind = 'text' AND ${FOLD_TEXT_FUNCTION}(c.text_value) = ?`);
const TEXT_CONTAINS = IN_LANE(`c.value_kind = 'text' AND instr(${FOLD_TEXT_FUNCTION}(c.text_value), ?) > 0`);
const HAS_LANE = "EXISTS (SELECT 1 FROM cells AS c WHERE c.record_pk = r.record_pk AND c.field_id = ?)";
const LACKS_LANE = `NOT ${HAS_LANE}`;
const AUTHORED_ABSENT = `${AUTHORED_KIND_FUNCTION}(r.authored_cbor, ?) IN ('missing', 'blank')`;
const AUTHORED_PRESENT = `${AUTHORED_KIND_FUNCTION}(r.authored_cbor, ?) NOT IN ('missing', 'blank')`;
/**
 * A broken reference, exactly as `related-parent` reads one: an imported key
 * that matched no parent (preserved in the authored blob, D36), or a record id
 * that no live record of the relationship's target table carries.
 */
const REFERENCE_BROKEN = `(${AUTHORED_KIND_FUNCTION}(r.authored_cbor, ?) = 'invalid-preserved' OR ${IN_LANE(
  "c.value_kind = 'id' AND NOT EXISTS (SELECT 1 FROM records AS p WHERE p.record_id = c.id_value AND p.table_id = ?)",
)})`;
/** A term that can match nothing (a reference field with no active relationship). */
const NOTHING = "0";

const decimalBound = (decimal: string | null): Uint8Array | null => {
  if (decimal === null) return null;
  const key = decimalOrderKeyV1(decimal);
  if (key === null) {
    throw new CodecError("a filter bound is outside the decimal order-key domain");
  }
  return key;
};

function termWhere(handle: ProjectionHandleV1, term: ProjectionFilterTermV1): Fragment {
  switch (term.kind) {
    case "id-in":
      if (term.ids.length === 0 || term.ids.length > MAX_FILTER_VALUES) {
        throw new CodecError("a filter's value set is empty or over its bound");
      }
      return fragment(ID_IN(term.ids.length), term.fieldId, ...term.ids);
    case "integer-range":
      return fragment(INTEGER_RANGE, term.fieldId, term.min, term.min, term.max, term.max);
    case "decimal-range": {
      const min = decimalBound(term.min);
      const max = decimalBound(term.max);
      return fragment(DECIMAL_RANGE, term.fieldId, min, min, max, max);
    }
    case "text-equals":
      return fragment(TEXT_EQUALS, term.fieldId, foldText(term.text));
    case "text-contains":
      return fragment(TEXT_CONTAINS, term.fieldId, foldText(term.text));
    case "reference-broken": {
      const relationship = handle.schema.relationships.get(idKey(term.fieldId));
      return relationship === undefined || !relationship.isActive
        ? fragment(NOTHING)
        : fragment(REFERENCE_BROKEN, term.fieldId, term.fieldId, relationship.toTableId);
    }
    case "is-empty":
      return term.isComputed
        ? fragment(LACKS_LANE, term.fieldId)
        : fragment(AUTHORED_ABSENT, term.fieldId);
    case "not-empty":
      return term.isComputed
        ? fragment(HAS_LANE, term.fieldId)
        : fragment(AUTHORED_PRESENT, term.fieldId);
    default: {
      const unreachable: never = term;
      return unreachable;
    }
  }
}

function queryWhere(
  handle: ProjectionHandleV1,
  scope: QueryScopeV1,
  filters: readonly ProjectionFilterTermV1[],
): Fragment {
  if (filters.length > MAX_FILTERS) {
    throw new CodecError("a records query carries more filters than its bound");
  }
  return joinFragments(
    [scopeWhere(scope), ...filters.map((term) => termWhere(handle, term))],
    " AND ",
  );
}

/** How many rows in scope match every filter: exact, because it is `count(*)`. */
export function matchCountStatement(
  handle: ProjectionHandleV1,
  scope: QueryScopeV1,
  filters: readonly ProjectionFilterTermV1[],
): ComposedStatementV1 {
  const where = queryWhere(handle, scope, filters);
  return { sql: `SELECT count(*) FROM records AS r WHERE ${where.sql};`, parameters: where.parameters };
}

// ------------------------------------------------------------------- sort --

type LaneColumn = "text_sort_key" | "decimal_order_key" | "integer_value";

const LANE_KIND: Readonly<Record<LaneColumn, string>> = {
  text_sort_key: "'text'",
  decimal_order_key: "'decimal'",
  integer_value: "'integer'",
};

/** The lane a field's value is ordered by, or null for a lane with no order. */
function laneColumnOf(type: FieldTypeV1): LaneColumn | null {
  switch (type.kind) {
    case "text":
    case "phone":
    case "email":
    case "url":
    case "address":
      return "text_sort_key";
    case "number":
    case "currency":
      return "decimal_order_key";
    case "date":
    case "boolean":
      return "integer_value";
    case "enum":
    case "reference":
      return null;
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

const OWN_LANE = (column: LaneColumn): string =>
  `(SELECT c.${column} FROM cells AS c WHERE c.record_pk = r.record_pk AND c.field_id = ? AND c.value_kind = ${LANE_KIND[column]})`;

const OPTION_ORDINAL =
  "(SELECT o.option_ordinal FROM cells AS c JOIN enum_options AS o ON o.option_id = c.id_value WHERE c.record_pk = r.record_pk AND c.field_id = ? AND c.value_kind = 'id')";

const PARENT_LANE = (column: LaneColumn): string =>
  `(SELECT pc.${column} FROM cells AS c JOIN records AS p ON p.record_id = c.id_value JOIN cells AS pc ON pc.record_pk = p.record_pk AND pc.field_id = ? AND pc.value_kind = ${LANE_KIND[column]} WHERE c.record_pk = r.record_pk AND c.field_id = ? AND c.value_kind = 'id' AND p.table_id = ?)`;

const NO_SORT_VALUE = "NULL";

/** The parent's label field (else key field) a reference sorts by, when it has an ordered lane. */
function parentSortField(
  handle: ProjectionHandleV1,
  fieldId: Uint8Array,
): { readonly field: FieldDefV1; readonly column: LaneColumn; readonly tableId: Uint8Array } | null {
  const relationship = handle.schema.relationships.get(idKey(fieldId));
  if (relationship === undefined || !relationship.isActive) return null;
  const table = handle.schema.tables.get(idKey(relationship.toTableId));
  const labelId = table?.labelFieldId ?? table?.keyFieldId ?? null;
  const field = labelId === null ? undefined : handle.schema.fields.get(idKey(labelId));
  const column = field === undefined ? null : laneColumnOf(field.type);
  return field === undefined || column === null
    ? null
    : { field, column, tableId: relationship.toTableId };
}

function sortValue(handle: ProjectionHandleV1, sort: ProjectionRecordSortV1 | null): Fragment {
  if (sort === null) return fragment(NO_SORT_VALUE);
  switch (sort.key) {
    case "text":
      return fragment(OWN_LANE("text_sort_key"), sort.fieldId);
    case "decimal":
      return fragment(OWN_LANE("decimal_order_key"), sort.fieldId);
    case "integer":
      return fragment(OWN_LANE("integer_value"), sort.fieldId);
    case "option-ordinal":
      return fragment(OPTION_ORDINAL, sort.fieldId);
    case "reference-label": {
      const parent = parentSortField(handle, sort.fieldId);
      return parent === null
        ? fragment(NO_SORT_VALUE)
        : fragment(PARENT_LANE(parent.column), parent.field.fieldId, sort.fieldId, parent.tableId);
    }
    default: {
      const unreachable: never = sort.key;
      return unreachable;
    }
  }
}

// ----------------------------------------------------------------- keyset --

const AFTER_ROW = "q.record_pk > ?";
const AFTER_ASCENDING =
  "(q.sort_value > ? OR (q.sort_value = ? AND q.record_pk > ?) OR q.sort_value IS NULL)";
const AFTER_DESCENDING =
  "(q.sort_value < ? OR (q.sort_value = ? AND q.record_pk > ?) OR q.sort_value IS NULL)";
const AFTER_IN_MISSING_TAIL = "(q.sort_value IS NULL AND q.record_pk > ?)";

function keyset(sort: ProjectionRecordSortV1 | null, after: ProjectionQueryCursorV1 | null): Fragment | null {
  if (after === null) return null;
  if (sort === null) return fragment(AFTER_ROW, after.recordPk);
  if (after.sortValue === null) return fragment(AFTER_IN_MISSING_TAIL, after.recordPk);
  return fragment(
    sort.direction === "asc" ? AFTER_ASCENDING : AFTER_DESCENDING,
    after.sortValue,
    after.sortValue,
    after.recordPk,
  );
}

const ORDER_ASCENDING = "ORDER BY q.sort_value IS NULL, q.sort_value ASC, q.record_pk";
const ORDER_DESCENDING = "ORDER BY q.sort_value IS NULL, q.sort_value DESC, q.record_pk";

/**
 * One page: the rows in scope that match every filter, in sort order, after
 * the cursor, one row past `limit` so `hasMore` is observed. Its columns are
 * `RECORD_SUMMARY_COLUMNS` followed by the row's sort value.
 */
export function pageStatement(
  handle: ProjectionHandleV1,
  scope: QueryScopeV1,
  filters: readonly ProjectionFilterTermV1[],
  sort: ProjectionRecordSortV1 | null,
  after: ProjectionQueryCursorV1 | null,
  limitPlusOne: number,
): ComposedStatementV1 {
  const value = sortValue(handle, sort);
  const where = queryWhere(handle, scope, filters);
  const boundary = keyset(sort, after);
  const order = sort?.direction === "desc" ? ORDER_DESCENDING : ORDER_ASCENDING;
  return {
    sql: `SELECT ${RECORD_SUMMARY_COLUMNS}, q.sort_value
  FROM (SELECT r.record_pk, ${value.sql} AS sort_value FROM records AS r WHERE ${where.sql}) AS q
  JOIN records AS r ON r.record_pk = q.record_pk${boundary === null ? "" : `
 WHERE ${boundary.sql}`}
 ${order}
 LIMIT ?;`,
    parameters: [
      ...value.parameters,
      ...where.parameters,
      ...(boundary === null ? [] : boundary.parameters),
      limitPlusOne,
    ],
  };
}
