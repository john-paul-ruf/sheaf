/**
 * A chart's dataset (CA-30; database.md § query pattern "Build a chart
 * dataset"): drive from `records` for the chart's table, join one typed
 * `cells` alias per dimension and measure, apply the records query's own
 * filter terms (CA-29), and aggregate in bounded pages.
 *
 * Three rules make it truthful rather than merely fast:
 *
 * - **The source is bounded and named (D53).** At most `sourceRowBudget`
 *   rows are read — the newest, by `record_pk` descending — and the result
 *   says how many matched, how many were read, and how many the table holds.
 *   It never reads past the budget and never claims to have read what it
 *   did not.
 * - **Decimals stay exact.** A measured value is the lane's canonical decimal
 *   text, summed and compared with the domain's decimal arithmetic (S01),
 *   never SQLite's REAL `sum()`.
 * - **A group is what its mark's filter would find.** Text groups the way the
 *   text filter matches — case-insensitively over NFC — so the records a
 *   tapped mark names are the records it counted. A relationship grouping
 *   keeps the parents that carry each value for the same reason (D54).
 *
 * Every value is a bound parameter; the statement text is composed only from
 * the literal fragments below (the filter terms' own rule, `filter-sql.ts`).
 */

import { CodecError } from "../../domain/model/errors.js";
import { asDomainId, compareDomainIds, type RecordId, type TableId } from "../../domain/model/ids.js";
import type { GroupingV1 } from "../../domain/model/charts.js";
import {
  booleanValue,
  dateValue,
  enumValue,
  referenceValue,
  textValue,
  type CellValueV1,
} from "../../domain/model/values.js";
import { addDecimals, compareDecimals, formatDecimal, parseDecimal, type DecimalV1 } from "../../domain/formulas/decimal.js";
import { foldText } from "../../domain/formulas/scalars.js";
import { AUTHORED_KIND_FUNCTION } from "./authored-functions.js";
import { selectRow, selectRowsOnce, type ProjectionHandleV1, type SqlParam } from "./engine.js";
import { matchCountStatement, queryWhere, type QueryScopeV1 } from "./filter-sql.js";
import { idKey } from "./record-rows.js";
import { COUNT_RECORDS_FOR_TABLE } from "./statements.js";
import type {
  ProjectionChartDatasetV1,
  ProjectionChartGroupV1,
  ProjectionChartKeyV1,
  ProjectionChartShapeV1,
  ProjectionFilterTermV1,
} from "./types.js";

/** Rows read per statement: the page loop's step, well under the budget. */
export const CHART_PAGE_ROWS = 1_000;

type Row = readonly unknown[];

/** A referenced record's label; the query module owns how a record is labelled. */
export type RecordLabelReader = (recordId: RecordId) => string | null;

interface DimensionSql {
  readonly joins: string;
  readonly joinParameters: readonly SqlParam[];
  readonly columnParameters: readonly SqlParam[];
  /** Eight columns: reference id, parent id, authored kind, value kind, id, integer, text, text sort key. */
  readonly columns: string;
}

const LANE_COLUMNS = (alias: string): string =>
  `${alias}.value_kind, ${alias}.id_value, ${alias}.integer_value, ${alias}.text_value, ${alias}.text_sort_key`;

/** One grouping's joins. Aliases are literals from a closed set, never request text. */
function dimensionSql(handle: ProjectionHandleV1, group: GroupingV1, alias: "g" | "s"): DimensionSql {
  if (group.kind !== "related-field") {
    // The authored kind tells a value with no lane (an imported value kept
    // as written) from an absent one, as the `is-empty` filter does.
    return {
      joins: `LEFT JOIN cells AS ${alias} ON ${alias}.record_pk = r.record_pk AND ${alias}.field_id = ?`,
      joinParameters: [group.fieldId],
      columnParameters: [group.fieldId],
      columns: `NULL, NULL, ${AUTHORED_KIND_FUNCTION}(r.authored_cbor, ?), ${LANE_COLUMNS(alias)}`,
    };
  }
  const relationship = handle.schema.relationships.get(idKey(group.referenceFieldId));
  if (relationship === undefined) {
    throw new CodecError("a chart groups through a relationship this app does not hold");
  }
  const reference = `${alias}k`;
  const parent = `${alias}p`;
  return {
    joins: [
      `LEFT JOIN cells AS ${reference} ON ${reference}.record_pk = r.record_pk AND ${reference}.field_id = ? AND ${reference}.value_kind = 'id'`,
      `LEFT JOIN records AS ${parent} ON ${parent}.record_id = ${reference}.id_value AND ${parent}.table_id = ?`,
      `LEFT JOIN cells AS ${alias} ON ${alias}.record_pk = ${parent}.record_pk AND ${alias}.field_id = ?`,
    ].join("\n"),
    joinParameters: [group.referenceFieldId, relationship.toTableId, group.fieldId],
    // The reference's own authored kind: a key imported as written has no lane.
    columnParameters: [group.referenceFieldId],
    columns: `${reference}.id_value, ${parent}.record_id, ${AUTHORED_KIND_FUNCTION}(r.authored_cbor, ?), ${LANE_COLUMNS(alias)}`,
  };
}

const MEASURE_JOIN = (alias: "m" | "x" | "y"): string =>
  `LEFT JOIN cells AS ${alias} ON ${alias}.record_pk = r.record_pk AND ${alias}.field_id = ? AND ${alias}.value_kind = 'decimal'`;

/** The page statement: the newest matching rows below `beforePk`, one page at a time. */
function pageStatement(
  handle: ProjectionHandleV1,
  where: { readonly sql: string; readonly parameters: readonly SqlParam[] },
  shape: ProjectionChartShapeV1,
): (beforePk: number | null, limit: number) => { readonly sql: string; readonly parameters: readonly SqlParam[] } {
  let columns: string;
  let joins: string;
  // In statement order: the select list's parameters come before the joins'.
  let columnParameters: readonly SqlParam[] = [];
  let joinParameters: readonly SqlParam[];
  if (shape.kind === "scatter") {
    columns = "x.decimal_value, y.decimal_value";
    joins = `${MEASURE_JOIN("x")}\n${MEASURE_JOIN("y")}`;
    joinParameters = [shape.x, shape.y];
  } else {
    const group = dimensionSql(handle, shape.groupBy, "g");
    const series = shape.seriesBy === null ? null : dimensionSql(handle, shape.seriesBy, "s");
    columns = [
      group.columns,
      series?.columns ?? "NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL",
      shape.measureFieldId === null ? "NULL" : "m.decimal_value",
    ].join(", ");
    joins = [group.joins, series?.joins ?? "", shape.measureFieldId === null ? "" : MEASURE_JOIN("m")]
      .filter((part) => part !== "")
      .join("\n");
    columnParameters = [...group.columnParameters, ...(series?.columnParameters ?? [])];
    joinParameters = [
      ...group.joinParameters,
      ...(series?.joinParameters ?? []),
      ...(shape.measureFieldId === null ? [] : [shape.measureFieldId]),
    ];
  }
  return (beforePk, limit) => ({
    sql: `SELECT r.record_pk, r.record_id, ${columns}
  FROM records AS r
${joins}
 WHERE ${where.sql} AND (? IS NULL OR r.record_pk < ?)
 ORDER BY r.record_pk DESC
 LIMIT ?;`,
    parameters: [...columnParameters, ...joinParameters, ...where.parameters, beforePk, beforePk, limit],
  });
}

// ---------------------------------------------------------------- grouping --

const MS_PER_DAY = 86_400_000;

/** The first day of the day/month/year bucket holding `epochDay` (UTC). */
function bucketStart(epochDay: number, unit: "day" | "month" | "year"): number {
  if (unit === "day") return epochDay;
  const day = new Date(epochDay * MS_PER_DAY);
  const start = new Date(0);
  start.setUTCFullYear(day.getUTCFullYear(), unit === "month" ? day.getUTCMonth() : 0, 1);
  return start.getTime() / MS_PER_DAY;
}

/**
 * Where a key sorts: values first by their own order (an option's ordinal, a
 * day, a boolean, a text order key, a label), then parents with no value,
 * then no value at all.
 */
interface RankV1 {
  readonly tier: 0 | 1 | 2;
  readonly order: number | string;
}

/** A key being accumulated: what it stands for, and the order it sorts in. */
interface KeyV1 {
  readonly id: string;
  readonly key: ProjectionChartKeyV1;
  readonly rank: RankV1;
  readonly parents: Map<string, RecordId> | null;
}

const EMPTY: RankV1 = { tier: 2, order: 0 };

const bytesAt = (row: Row, index: number): Uint8Array | null => {
  const value = row[index];
  return value instanceof Uint8Array ? value : null;
};

const hexOf = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * The key one row's grouping lanes name, starting at `at` (the seven columns
 * `dimensionSql` selected). The field type decides how the lane reads.
 */
function keyOf(handle: ProjectionHandleV1, group: GroupingV1, row: Row, at: number, labelOf: RecordLabelReader): KeyV1 {
  const referenceId = bytesAt(row, at);
  const parentId = bytesAt(row, at + 1);
  const authoredKind = row[at + 2];
  const kind = row[at + 3];
  const isRelated = group.kind === "related-field";
  if (authoredKind === "invalid-preserved") {
    return { id: "unreadable", key: { kind: "unreadable" }, rank: { tier: 2, order: 1 }, parents: null };
  }
  if (isRelated && referenceId === null) {
    return { id: "empty", key: { kind: "empty" }, rank: EMPTY, parents: null };
  }
  const parents = isRelated && parentId !== null ? new Map([[idKey(parentId), asDomainId("record", parentId)]]) : null;
  if (kind === null || kind === undefined) {
    return isRelated
      ? { id: "empty-parent", key: { kind: "empty-parent", parents: [] }, rank: { tier: 1, order: 0 }, parents: parents ?? new Map() }
      : { id: "empty", key: { kind: "empty" }, rank: EMPTY, parents: null };
  }

  const field = handle.schema.fields.get(idKey(group.fieldId));
  const type = field?.type.kind;
  const value = (cell: CellValueV1, id: string, order: number | string, label: string | null): KeyV1 => ({
    id,
    key: { kind: "value", value: cell, label, parents: null },
    rank: { tier: 0, order },
    parents,
  });

  if (group.kind === "date") {
    const day = bucketStart(Number(row[at + 5]), group.unit);
    return value(dateValue(day), `d${String(day)}`, day, null);
  }
  switch (type) {
    case "enum": {
      const optionId = asDomainId("option", bytesAt(row, at + 4) ?? new Uint8Array(16));
      const option = (handle.schema.enumOptions.get(idKey(group.fieldId)) ?? []).find(
        (candidate) => compareDomainIds(candidate.optionId, optionId) === 0,
      );
      return value(enumValue(optionId), `o${idKey(optionId)}`, option?.optionOrdinal ?? Number.MAX_SAFE_INTEGER, handle.schema.optionLabels.get(idKey(optionId)) ?? null);
    }
    case "reference": {
      const recordId = asDomainId("record", bytesAt(row, at + 4) ?? new Uint8Array(16));
      const label = labelOf(recordId);
      // A reference to no live record has no label; it sorts after those that do.
      return value(referenceValue(recordId), `r${idKey(recordId)}`, label === null ? "\u{10FFFF}" : foldText(label), label);
    }
    case "boolean": {
      const truth = Number(row[at + 5]) === 1;
      return value(booleanValue(truth), truth ? "b1" : "b0", truth ? 1 : 0, null);
    }
    case "date": {
      const day = Number(row[at + 5]);
      return value(dateValue(day), `d${String(day)}`, day, null);
    }
    default: {
      // Case-insensitive over NFC, as the text filter matches; the first row
      // read — the newest — names the category.
      const text = String(row[at + 6]);
      const sortKey = bytesAt(row, at + 7);
      return value(textValue(text), `t${foldText(text)}`, sortKey === null ? foldText(text) : hexOf(sortKey), null);
    }
  }
}

/** One grouping's keys share one order type; the tier puts the absent ones last. */
const compareRanks = (left: RankV1, right: RankV1): number => {
  if (left.tier !== right.tier) return left.tier - right.tier;
  if (typeof left.order === "number" && typeof right.order === "number") return left.order - right.order;
  return String(left.order) < String(right.order) ? -1 : String(left.order) > String(right.order) ? 1 : 0;
};

interface Accumulator {
  readonly category: KeyV1;
  readonly series: KeyV1 | null;
  records: number;
  measured: number;
  sum: DecimalV1 | null;
  isSumRepresentable: boolean;
  min: DecimalV1 | null;
  max: DecimalV1 | null;
}

function merge(target: KeyV1, source: KeyV1): void {
  if (target.parents !== null && source.parents !== null) {
    for (const [key, id] of source.parents) target.parents.set(key, id);
  }
}

const withParents = (entry: KeyV1): ProjectionChartKeyV1 => {
  if (entry.parents === null) return entry.key;
  const parents = [...entry.parents.values()];
  switch (entry.key.kind) {
    case "value":
      return { ...entry.key, parents };
    case "empty-parent":
      return { kind: "empty-parent", parents };
    case "empty":
    case "unreadable":
      return entry.key;
    default: {
      const unreachable: never = entry.key;
      return unreachable;
    }
  }
};

// ------------------------------------------------------------------- query --

/**
 * The dataset, or null when the table is not this app's. `labelOf` reads a
 * referenced record's label the way every relationship surface does.
 */
export function chartDataset(
  handle: ProjectionHandleV1,
  query: {
    readonly tableId: TableId;
    readonly filters: readonly ProjectionFilterTermV1[];
    readonly shape: ProjectionChartShapeV1;
    readonly sourceRowBudget: number;
  },
  labelOf: RecordLabelReader,
): ProjectionChartDatasetV1 | null {
  if (!handle.schema.tables.has(idKey(query.tableId))) return null;
  const budget = query.sourceRowBudget;
  if (!Number.isSafeInteger(budget) || budget < 1) {
    throw new CodecError("a chart source budget must be a positive integer");
  }
  const scope: QueryScopeV1 = { tableId: query.tableId, match: null, boundaryPk: null };
  const where = queryWhere(handle, scope, query.filters);
  const count = matchCountStatement(handle, scope, query.filters);
  const matchingRows = Number(selectRowsOnce(handle, count.sql, count.parameters)[0]?.[0] ?? 0);
  const tableTotal = Number(selectRow(handle, COUNT_RECORDS_FOR_TABLE, [query.tableId])?.[0] ?? 0);
  const page = pageStatement(handle, where, query.shape);

  const groups = new Map<string, Accumulator>();
  const categories = new Map<string, KeyV1>();
  const series = new Map<string, KeyV1>();
  const points: { recordId: RecordId; x: string; y: string }[] = [];
  let sourceRows = 0;
  let beforePk: number | null = null;

  while (sourceRows < budget) {
    const statement = page(beforePk, Math.min(CHART_PAGE_ROWS, budget - sourceRows));
    const rows = selectRowsOnce(handle, statement.sql, statement.parameters);
    for (const row of rows) {
      sourceRows += 1;
      if (query.shape.kind === "scatter") {
        const [x, y] = [row[2], row[3]];
        if (typeof x === "string" && typeof y === "string") {
          points.push({ recordId: asDomainId("record", row[1] as Uint8Array), x, y });
        }
        continue;
      }
      const category = keyOf(handle, query.shape.groupBy, row, 2, labelOf);
      const seriesKey = query.shape.seriesBy === null ? null : keyOf(handle, query.shape.seriesBy, row, 10, labelOf);
      const known = categories.get(category.id);
      if (known === undefined) categories.set(category.id, category);
      else merge(known, category);
      if (seriesKey !== null) {
        const knownSeries = series.get(seriesKey.id);
        if (knownSeries === undefined) series.set(seriesKey.id, seriesKey);
        else merge(knownSeries, seriesKey);
      }
      const id = `${category.id}|${seriesKey?.id ?? ""}`;
      const accumulator: Accumulator = groups.get(id) ?? {
        category: categories.get(category.id) ?? category,
        series: seriesKey === null ? null : (series.get(seriesKey.id) ?? seriesKey),
        records: 0,
        measured: 0,
        sum: null,
        isSumRepresentable: true,
        min: null,
        max: null,
      };
      groups.set(id, accumulator);
      accumulator.records += 1;
      if (query.shape.measureFieldId === null) {
        accumulator.measured += 1;
        continue;
      }
      const measured = row[18];
      if (typeof measured !== "string") continue;
      const decimal = parseDecimal(measured);
      accumulator.measured += 1;
      if (accumulator.isSumRepresentable) {
        const sum = accumulator.sum === null ? decimal : addDecimals(accumulator.sum, decimal);
        accumulator.sum = sum;
        accumulator.isSumRepresentable = sum !== null;
      }
      if (accumulator.min === null || compareDecimals(decimal, accumulator.min) < 0) accumulator.min = decimal;
      if (accumulator.max === null || compareDecimals(decimal, accumulator.max) > 0) accumulator.max = decimal;
    }
    const last = rows.at(-1);
    if (rows.length < CHART_PAGE_ROWS || last === undefined) break;
    beforePk = Number(last[0]);
  }

  const ordered = [...groups.values()].sort(
    (left, right) =>
      compareRanks(left.category.rank, right.category.rank) ||
      (left.series === null || right.series === null ? 0 : compareRanks(left.series.rank, right.series.rank)),
  );
  const groupsOut: ProjectionChartGroupV1[] = ordered.map((group) => ({
    category: withParents(group.category),
    series: group.series === null ? null : withParents(group.series),
    records: group.records,
    measured: group.measured,
    sum: group.sum === null || !group.isSumRepresentable ? null : formatDecimal(group.sum),
    min: group.min === null ? null : formatDecimal(group.min),
    max: group.max === null ? null : formatDecimal(group.max),
  }));
  return { tableTotal, matchingRows, sourceRows, groups: groupsOut, points };
}
