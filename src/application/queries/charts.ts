/**
 * A chart's dataset, assembled (M35; CA-30, D53, D54).
 *
 * The projection reads the bounded source and aggregates it exactly; what
 * this module adds is everything a surface must be told rather than infer:
 *
 * - **Which marks are drawn, and what was left out.** At most `markBudget`
 *   marks, the first categories in the chart's order; every category past it
 *   is counted in `omittedCategories`. The accessible table and the summary
 *   are over *every* category the source produced, so nothing that was
 *   aggregated is hidden from the alternative view (SHT-017).
 * - **What the source was.** `sample` is set exactly when the matching rows
 *   exceeded the source budget and the newest were read instead (STA-015).
 * - **What a tapped mark means.** Each grouped mark carries the records filter
 *   that finds exactly the rows it counted: the chart's own filters, the
 *   category's intent (S01's `markFilterIntent`, the one mapping) and, for a
 *   stacked chart, the series' intent — ANDed, as the records query applies a
 *   filter list (CA-29). A mark whose rows no filter can name (a scatter
 *   point, a relationship value carried by more parents than a filter holds)
 *   carries none, rather than a filter that would find something else.
 *
 * No prose is composed here: the page writes the summary from these facts.
 */

import {
  markFilterIntent,
  validateChartDefinition,
  type ChartCategoryV1,
  type ChartDefinitionV1,
  type ChartRefusalV1,
  type ChartSchemaV1,
  type GroupingV1,
} from "../../domain/model/charts.js";
import type { FilterRefusalV1, FilterV1 } from "../../domain/model/filters.js";
import type { RecordId } from "../../domain/model/ids.js";
import type { TableDefV1 } from "../../domain/model/schema.js";
import {
  addDecimals,
  compareDecimals,
  DECIMAL_ZERO,
  divideDecimals,
  formatDecimal,
  parseDecimal,
  type DecimalV1,
} from "../../domain/formulas/decimal.js";
import type { ProjectionChartGroupV1, ProjectionChartKeyV1, ProjectionEnginePort } from "../ports/projection.js";
import { CHART_MARK_BUDGET, CHART_SOURCE_ROW_BUDGET } from "./budgets.js";
import { compileRecordQuery, MAX_FILTER_SET_SIZE, readTableDefinition } from "./filters.js";

/** Rows per page of the accessible data table (SHT-017). */
export const CHART_TABLE_PAGE_SIZE = 50;

export interface ChartBudgetsV1 {
  readonly sourceRows: number;
  readonly marks: number;
}

export const DEFAULT_CHART_BUDGETS: ChartBudgetsV1 = Object.freeze({
  sourceRows: CHART_SOURCE_ROW_BUDGET,
  marks: CHART_MARK_BUDGET,
});

/** One grouped mark: a category (and series), its value, and what it counted. */
export interface ChartGroupMarkV1 {
  readonly kind: "group";
  readonly category: ProjectionChartKeyV1;
  readonly series: ProjectionChartKeyV1 | null;
  /** The measure, exact; null when no counted row carried the measured field. */
  readonly value: string | null;
  readonly records: number;
  /** ANDed, this finds exactly the rows the mark counted; null when no filter can. */
  readonly filterIntent: readonly FilterV1[] | null;
}

/** One scatter point: one record (D54). It filters nothing. */
export interface ChartPointMarkV1 {
  readonly kind: "point";
  readonly recordId: RecordId;
  readonly x: string;
  readonly y: string;
}

export type ChartMarkV1 = ChartGroupMarkV1 | ChartPointMarkV1;

/** The facts the natural-language summary is composed from (SHT-017). */
export interface ChartSummaryV1 {
  readonly highest: ChartMarkV1 | null;
  readonly lowest: ChartMarkV1 | null;
  /** Count and sum charts: the whole of what was aggregated. Otherwise null. */
  readonly total: string | null;
  /** Grouped: categories aggregated. Scatter: points plotted. */
  readonly count: number;
}

export interface ChartDatasetV1 {
  readonly definition: ChartDefinitionV1;
  /** In the chart's order; at most the mark budget. */
  readonly marks: readonly ChartMarkV1[];
  /** Rows the chart aggregated. */
  readonly sourceRowsConsidered: number;
  /** Rows the chart's filters matched. */
  readonly matchingRows: number;
  readonly tableTotal: number;
  readonly sample: { readonly kind: "newest"; readonly rows: number } | null;
  readonly omittedCategories: number;
  /** Scatter only: rows read that lack one of the two axes, so plot nowhere. */
  readonly unplottedRows: number;
  readonly summary: ChartSummaryV1;
  readonly tablePage: {
    readonly rows: readonly ChartMarkV1[];
    readonly offset: number;
    readonly total: number;
  };
}

export type ChartDatasetResultV1 =
  | { readonly outcome: "dataset"; readonly dataset: ChartDatasetV1 }
  | { readonly outcome: "refused"; readonly refusals: readonly ChartRefusalV1[] }
  | { readonly outcome: "unknown-table" };

/** The schema a definition is drawn against, as the projection holds it now. */
function readSchema(projection: ProjectionEnginePort): ChartSchemaV1 {
  const tables: TableDefV1[] = projection
    .execute({ kind: "list-tables" })
    .map((table) => ({ ...table, fields: projection.execute({ kind: "list-fields", tableId: table.tableId }) }));
  return {
    tables,
    enumOptions: tables.flatMap((table) =>
      table.fields
        .filter((field) => field.type.kind === "enum")
        .flatMap((field) => projection.execute({ kind: "list-enum-options", fieldId: field.fieldId })),
    ),
    relationships: projection.execute({ kind: "list-relationships", tableId: null }).map(({ relationship }) => relationship),
  };
}

/** A mark's category as S01's intent mapping names it. */
function categoryOf(group: GroupingV1, key: ProjectionChartKeyV1): ChartCategoryV1 | null {
  switch (key.kind) {
    case "empty":
      return { kind: "empty" };
    case "empty-parent":
      return key.parents.length === 0 ? null : { kind: "parents", recordIds: key.parents };
    case "unreadable":
      return null;
    case "value":
      return group.kind === "related-field"
        ? { kind: "parents", recordIds: key.parents ?? [] }
        : { kind: "value", value: key.value };
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

/** The records filter a key stands for, or null when none can name its rows. */
function intentOf(definition: ChartDefinitionV1, group: GroupingV1, key: ProjectionChartKeyV1): FilterV1 | null {
  const category = categoryOf(group, key);
  if (category === null) return null;
  if (category.kind === "parents" && category.recordIds.length > MAX_FILTER_SET_SIZE) return null;
  return definition.type === "scatter" ? null : markFilterIntent({ ...definition, groupBy: group }, category);
}

const measured = (definition: ChartDefinitionV1, group: ProjectionChartGroupV1): string | null => {
  if (definition.type === "scatter") return null;
  switch (definition.measure.kind) {
    case "count":
      return String(group.records);
    case "sum":
      return group.sum;
    case "min":
      return group.min;
    case "max":
      return group.max;
    case "average": {
      if (group.sum === null || group.measured === 0) return null;
      const average = divideDecimals(parseDecimal(group.sum), parseDecimal(String(group.measured)));
      return average === null ? null : formatDecimal(average);
    }
    default: {
      const unreachable: never = definition.measure;
      return unreachable;
    }
  }
};

const compareValues = (left: string | null, right: string | null): number =>
  left === null ? (right === null ? 0 : 1) : right === null ? -1 : compareDecimals(parseDecimal(right), parseDecimal(left));

const categoryId = (key: ProjectionChartKeyV1): string =>
  key.kind === "value" ? JSON.stringify(key.value, (_name, value: unknown) => (value instanceof Uint8Array ? [...value] : value)) : key.kind;

const extreme = (marks: readonly ChartMarkV1[], direction: 1 | -1): ChartMarkV1 | null => {
  let best: ChartMarkV1 | null = null;
  for (const mark of marks) {
    const value = mark.kind === "group" ? mark.value : mark.y;
    const bestValue = best === null ? null : best.kind === "group" ? best.value : best.y;
    if (value === null) continue;
    if (bestValue === null || direction * compareDecimals(parseDecimal(value), parseDecimal(bestValue)) > 0) best = mark;
  }
  return best;
};

/**
 * The dataset of a saved chart or a builder's draft (they are the same
 * definition). `tableOffset` pages the accessible table; the budgets are D53's
 * unless a test injects smaller ones.
 */
export function readChartDataset(
  projection: ProjectionEnginePort,
  definition: ChartDefinitionV1,
  options: { readonly tableOffset?: number; readonly budgets?: ChartBudgetsV1 } = {},
): ChartDatasetResultV1 {
  const budgets = options.budgets ?? DEFAULT_CHART_BUDGETS;
  const refusals = validateChartDefinition(definition, readSchema(projection));
  if (refusals.length > 0) return { outcome: "refused", refusals };
  const table = readTableDefinition(projection, definition.tableId);
  if (table === null) return { outcome: "unknown-table" };
  const compiled = compileRecordQuery(table.table, table.enumOptions, definition.filters, null);
  if (compiled.outcome === "refused") return { outcome: "refused", refusals: [filterRefusal(compiled.refusal)] };

  const read = projection.execute({
    kind: "chart-dataset",
    tableId: definition.tableId,
    filters: compiled.filters,
    shape:
      definition.type === "scatter"
        ? { kind: "scatter", x: definition.x, y: definition.y }
        : {
            kind: "grouped",
            groupBy: definition.groupBy,
            seriesBy: definition.type === "stacked" ? definition.seriesBy : null,
            measureFieldId: definition.measure.kind === "count" ? null : definition.measure.fieldId,
          },
    sourceRowBudget: budgets.sourceRows,
  });
  if (read === null) return { outcome: "unknown-table" };

  let all: readonly ChartMarkV1[];
  let marks: readonly ChartMarkV1[];
  let omittedCategories: number;
  if (definition.type === "scatter") {
    all = read.points.map((point) => ({ kind: "point", ...point }));
    marks = all.slice(0, budgets.marks);
    omittedCategories = all.length - marks.length;
  } else {
    const seriesBy = definition.type === "stacked" ? definition.seriesBy : null;
    const grouped: ChartGroupMarkV1[] = read.groups.map((group) => {
      const category = intentOf(definition, definition.groupBy, group.category);
      const series = seriesBy === null || group.series === null ? null : intentOf(definition, seriesBy, group.series);
      const isNameable = category !== null && (seriesBy === null || series !== null);
      return {
        kind: "group",
        category: group.category,
        series: group.series,
        value: measured(definition, group),
        records: group.records,
        filterIntent: isNameable ? [...definition.filters, category, ...(series === null ? [] : [series])] : null,
      };
    });
    const order = [...new Set(grouped.map((mark) => categoryId(mark.category)))];
    if (definition.sort === "measure-desc") {
      // A category's weight: its largest mark, so a stacked chart sorts by its tallest part.
      const weight = new Map(order.map((id) => [id, extreme(grouped.filter((mark) => categoryId(mark.category) === id), 1)]));
      order.sort((left, right) => {
        const a = weight.get(left);
        const b = weight.get(right);
        return compareValues(a?.kind === "group" ? a.value : null, b?.kind === "group" ? b.value : null);
      });
    }
    const rank = new Map(order.map((id, index) => [id, index]));
    all = [...grouped].sort((left, right) => (rank.get(categoryId(left.category)) ?? 0) - (rank.get(categoryId(right.category)) ?? 0));
    const kept = new Set<string>();
    let drawn = 0;
    for (const id of order) {
      const size = grouped.filter((mark) => categoryId(mark.category) === id).length;
      if (drawn + size > budgets.marks) break;
      kept.add(id);
      drawn += size;
    }
    marks = all.filter((mark) => mark.kind === "group" && kept.has(categoryId(mark.category)));
    omittedCategories = order.length - kept.size;
  }

  const isAdditive = definition.type !== "scatter" && (definition.measure.kind === "count" || definition.measure.kind === "sum");
  let total: string | null = null;
  if (isAdditive) {
    let sum: DecimalV1 | null = DECIMAL_ZERO;
    for (const mark of all) {
      if (mark.kind === "group" && mark.value !== null && sum !== null) sum = addDecimals(sum, parseDecimal(mark.value));
    }
    total = sum === null ? null : formatDecimal(sum);
  }

  const offset = Math.max(0, Math.trunc(options.tableOffset ?? 0));
  return {
    outcome: "dataset",
    dataset: {
      definition,
      marks,
      sourceRowsConsidered: read.sourceRows,
      matchingRows: read.matchingRows,
      tableTotal: read.tableTotal,
      sample: read.matchingRows > read.sourceRows ? { kind: "newest", rows: read.sourceRows } : null,
      omittedCategories,
      unplottedRows: definition.type === "scatter" ? read.sourceRows - read.points.length : 0,
      summary: {
        highest: extreme(all, 1),
        lowest: extreme(all, -1),
        total,
        count: definition.type === "scatter" ? all.length : new Set(all.map((mark) => (mark.kind === "group" ? categoryId(mark.category) : ""))).size,
      },
      tablePage: { rows: all.slice(offset, offset + CHART_TABLE_PAGE_SIZE), offset, total: all.length },
    },
  };
}

const filterRefusal = (refusal: FilterRefusalV1): ChartRefusalV1 => ({
  reason: "invalid-filter",
  fieldId: refusal.fieldId,
  filterReason: refusal.reason,
});
