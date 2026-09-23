import type { ChartDatasetViewV1, ChartMarkWireV1 } from "../../../../src/workers/protocol/messages.js";
import { FIELD_IDS, OPTION_IDS, TABLE_ID } from "../records/fixtures.js";

/**
 * A chart dataset as the worker answers it (CA-30), by hand: "Quoted by
 * site" over the records fixtures' Visits table — a bar grouped by the Site
 * enum, summing the USD Quoted amount. Four categories: two options, the
 * empty bucket, and an imported value kept as written (which no filter names).
 */

export const CHART_ID = "chart-quoted-by-site";

export const MARKS: readonly ChartMarkWireV1[] = Object.freeze([
  {
    kind: "group",
    category: { kind: "value", value: { kind: "option", optionId: OPTION_IDS.ridgeway }, label: "Ridgeway Depot" },
    series: null,
    value: "1850.00",
    records: 4,
    filterIntent: [{ fieldId: FIELD_IDS.site, operand: { kind: "enum-in", optionIds: [OPTION_IDS.ridgeway] } }],
  },
  {
    kind: "group",
    category: { kind: "value", value: { kind: "option", optionId: OPTION_IDS.alder }, label: "Alder Court" },
    series: null,
    value: "920",
    records: 2,
    filterIntent: [{ fieldId: FIELD_IDS.site, operand: { kind: "enum-in", optionIds: [OPTION_IDS.alder] } }],
  },
  {
    kind: "group",
    category: { kind: "empty" },
    series: null,
    value: "30",
    records: 1,
    filterIntent: [{ fieldId: FIELD_IDS.site, operand: { kind: "is-empty" } }],
  },
  { kind: "group", category: { kind: "unreadable" }, series: null, value: null, records: 1, filterIntent: null },
]);

export function dataset(overrides: Partial<ChartDatasetViewV1> = {}): ChartDatasetViewV1 {
  const definition = {
    name: "Quoted by site",
    tableId: TABLE_ID,
    filters: [],
    pinned: true,
    type: "bar",
    groupBy: { kind: "field", fieldId: FIELD_IDS.site },
    seriesBy: null,
    measure: { kind: "sum", fieldId: FIELD_IDS.amount },
    sort: "category",
  } as const;
  return {
    chart: { chartId: CHART_ID, definition, ordinal: 0, provenance: "user", chartRevision: 2 },
    definition,
    marks: MARKS,
    sourceRowsConsidered: 8,
    matchingRows: 8,
    tableTotal: 8,
    sample: null,
    omittedCategories: 0,
    unplottedRows: 0,
    summary: { highest: MARKS[0] ?? null, lowest: MARKS[2] ?? null, total: "2800.00", count: 4 },
    tablePage: { rows: MARKS, offset: 0, total: 4 },
    ...overrides,
  };
}
