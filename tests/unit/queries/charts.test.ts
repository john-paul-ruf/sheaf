/**
 * CA-30 dataset assembly over the real projection (S05 CP2): real SQLite WASM
 * on node, real migration 005, S04's records-query fixture (see
 * `tests/unit/projection/query-fixture.ts` for its eight jobs).
 *
 * Every grouped mark's filter intent is applied through the records query
 * itself (`query-records`, CA-29) and must find exactly the rows the mark
 * counted — the contract that lets a tapped mark filter the list.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readChartDataset, type ChartDatasetV1, type ChartGroupMarkV1 } from "../../../src/application/queries/charts.js";
import { compileRecordQuery, readTableDefinition } from "../../../src/application/queries/filters.js";
import type { ProjectionEnginePort } from "../../../src/application/ports/projection.js";
import type { ChartDefinitionV1 } from "../../../src/domain/model/charts.js";
import type { FilterV1 } from "../../../src/domain/model/filters.js";
import { asDomainId } from "../../../src/domain/model/ids.js";
import { disposeProjection, executeQuery, type ProjectionHandleV1 } from "../../../src/persistence/projection/index.js";
import { CUSTOMER, F, JOBS, OPTION, openQueryProjection } from "../projection/query-fixture.js";

let handle: ProjectionHandleV1;
let port: ProjectionEnginePort;

beforeAll(async () => {
  handle = await openQueryProjection();
  port = {
    execute: (query) => executeQuery(handle, query),
    applyEvents: () => Promise.reject(new Error("read-only")),
    refreshVolatile: () => Promise.resolve([]),
  };
});

afterAll(() => {
  disposeProjection(handle);
});

const base = {
  chartVersion: 1 as const,
  chartId: asDomainId("chart", new Uint8Array(16).fill(0x70)),
  name: "Chart",
  tableId: JOBS,
  filters: [] as readonly FilterV1[],
  pinned: false,
};

const grouped = (overrides: Partial<Extract<ChartDefinitionV1, { groupBy: unknown }>>): ChartDefinitionV1 => ({
  ...base,
  type: "bar",
  groupBy: { kind: "field", fieldId: F.status.fieldId },
  seriesBy: null,
  measure: { kind: "count" },
  sort: "category",
  ...overrides,
});

function dataset(definition: ChartDefinitionV1, budgets?: { sourceRows: number; marks: number }): ChartDatasetV1 {
  const result = readChartDataset(port, definition, budgets === undefined ? {} : { budgets });
  if (result.outcome !== "dataset") throw new Error(`no dataset: ${JSON.stringify(result)}`);
  return result.dataset;
}

const groups = (read: ChartDatasetV1): readonly ChartGroupMarkV1[] =>
  read.tablePage.rows.filter((mark): mark is ChartGroupMarkV1 => mark.kind === "group");

/** A key's readable name for assertions: a label, a value, or the kind. */
const nameOf = (key: ChartGroupMarkV1["category"]): string => {
  if (key.kind !== "value") return key.kind;
  if (key.label !== null) return key.label;
  const value = key.value;
  switch (value.kind) {
    case "text":
      return value.text;
    case "boolean":
      return String(value.boolean);
    case "date":
      return `day ${String(value.epochDay)}`;
    case "reference":
      return "reference";
    default:
      return value.kind;
  }
};

const rows = (read: ChartDatasetV1) =>
  groups(read).map((mark) => `${nameOf(mark.category)}${mark.series === null ? "" : `/${nameOf(mark.series)}`}=${mark.value ?? "null"}:${String(mark.records)}`);

/** How many rows the records query finds for a filter list: exact, `count(*)`. */
function countOf(filters: readonly FilterV1[]): number {
  const table = readTableDefinition(port, JOBS);
  if (table === null) throw new Error("no table");
  const compiled = compileRecordQuery(table.table, table.enumOptions, filters, null);
  if (compiled.outcome !== "compiled") throw new Error(`refused: ${JSON.stringify(compiled.refusal)}`);
  const page = port.execute({
    kind: "query-records",
    tableId: JOBS,
    search: null,
    filters: compiled.filters,
    sort: null,
    after: null,
    limit: 50,
    candidateBudget: 50_000,
  });
  if (page.total === null) throw new Error("partial");
  return page.total;
}

/** Every mark that has an intent finds exactly its own count through the records query. */
function expectIntentsCount(read: ChartDatasetV1): void {
  for (const mark of groups(read)) {
    if (mark.filterIntent === null) continue;
    expect(countOf(mark.filterIntent), nameOf(mark.category)).toBe(mark.records);
  }
}

describe("grouped datasets, one per grouping kind", () => {
  it("groups an enum in option order, summing an exact decimal", () => {
    const read = dataset(grouped({ measure: { kind: "sum", fieldId: F.quoted.fieldId } }));
    expect(rows(read)).toEqual(["Scheduled=7650.00:4", "Waiting=7840:2", "Done=3270:2"]);
    expect(read.summary).toMatchObject({ total: "18760.00", count: 3 });
    expect(read.summary.highest).toMatchObject({ value: "7840" });
    expect(read.summary.lowest).toMatchObject({ value: "3270" });
    expect(read).toMatchObject({ sourceRowsConsidered: 8, matchingRows: 8, tableTotal: 8, sample: null, omittedCategories: 0 });
    expectIntentsCount(read);
  });

  it("averages, and bounds with min and max, exactly", () => {
    expect(rows(dataset(grouped({ measure: { kind: "average", fieldId: F.paid.fieldId } })))).toEqual([
      "Scheduled=593.75:4",
      "Waiting=0:2",
      "Done=710:2",
    ]);
    expect(rows(dataset(grouped({ measure: { kind: "min", fieldId: F.paid.fieldId } })))).toEqual(["Scheduled=0:4", "Waiting=0:2", "Done=0:2"]);
    expect(rows(dataset(grouped({ measure: { kind: "max", fieldId: F.quoted.fieldId } })))).toEqual([
      "Scheduled=2900:4",
      "Waiting=4600:2",
      "Done=1850:2",
    ]);
  });

  it("groups a boolean false, true, then the empty bucket; is-empty finds exactly the empty rows", () => {
    const read = dataset(grouped({ type: "pie", groupBy: { kind: "field", fieldId: F.urgent.fieldId } }));
    expect(rows(read)).toEqual(["false=3:3", "true=4:4", "empty=1:1"]);
    expectIntentsCount(read);
    expect(groups(read).every((mark) => mark.filterIntent !== null)).toBe(true);
  });

  it("buckets dates by day, month and year; an imported unreadable value is counted and filters nothing", () => {
    const month = dataset(grouped({ type: "line", groupBy: { kind: "date", fieldId: F.due.fieldId, unit: "month" } }));
    // 19990 is 2024-09-24; 20000–20003 fall in October 2024 (first day 20002 - 3 = 19997).
    expect(rows(month)).toEqual(["day 19967=1:1", "day 19997=4:4", "empty=2:2", "unreadable=1:1"]);
    expectIntentsCount(month);
    expect(groups(month).find((mark) => mark.category.kind === "unreadable")?.filterIntent).toBeNull();
    expect(rows(dataset(grouped({ type: "line", groupBy: { kind: "date", fieldId: F.due.fieldId, unit: "day" } })))).toEqual([
      "day 19990=1:1",
      "day 20000=2:2",
      "day 20001=1:1",
      "day 20003=1:1",
      "empty=2:2",
      "unreadable=1:1",
    ]);
    expect(rows(dataset(grouped({ type: "line", groupBy: { kind: "date", fieldId: F.due.fieldId, unit: "year" } })))).toEqual([
      "day 19723=5:5",
      "empty=2:2",
      "unreadable=1:1",
    ]);
    expectIntentsCount(dataset(grouped({ groupBy: { kind: "date", fieldId: F.due.fieldId, unit: "day" } })));
  });

  it("groups a reference by its record's label; a reference to no record sorts last and still filters", () => {
    const read = dataset(grouped({ groupBy: { kind: "field", fieldId: F.customer.fieldId } }));
    expect(rows(read)).toEqual(["Avery Kim=2:2", "Devon Moss=2:2", "Priya Ellis=2:2", "reference=1:1", "unreadable=1:1"]);
    expectIntentsCount(read);
  });

  it("groups text the way the text filter matches", () => {
    const read = dataset(grouped({ groupBy: { kind: "field", fieldId: F.name.fieldId } }));
    expect(groups(read)).toHaveLength(8);
    expectIntentsCount(read);
  });

  it("groups across one relationship by the parent's field, filtering through the parents (D54)", () => {
    const read = dataset(
      grouped({
        groupBy: {
          kind: "related-field",
          relationshipId: asDomainId("relationship", new Uint8Array(16).fill(0x60)),
          referenceFieldId: F.customer.fieldId,
          fieldId: F.customerName.fieldId,
        },
        measure: { kind: "sum", fieldId: F.paid.fieldId },
      }),
    );
    // j5 points at no record (no parent, no intent); j4's key was imported as written.
    expect(rows(read)).toEqual(["Avery Kim=0:2", "Devon Moss=1060:2", "Priya Ellis=1315:2", "empty-parent=0:1", "unreadable=1420:1"]);
    const avery = groups(read)[0];
    expect(avery?.filterIntent).toEqual([{ fieldId: F.customer.fieldId, operand: { kind: "reference-in", recordIds: [CUSTOMER.c3] } }]);
    expectIntentsCount(read);
  });

  it("stacks a series inside each category; each mark's two intents find exactly its rows", () => {
    const read = dataset(grouped({ type: "stacked", seriesBy: { kind: "field", fieldId: F.urgent.fieldId } }));
    expect(rows(read)).toEqual([
      "Scheduled/false=1:1",
      "Scheduled/true=2:2",
      "Scheduled/empty=1:1",
      "Waiting/false=1:1",
      "Waiting/true=1:1",
      "Done/false=1:1",
      "Done/true=1:1",
    ]);
    expect(groups(read)[0]?.filterIntent).toHaveLength(2);
    expectIntentsCount(read);
  });

  it("keeps the chart's own filters in every intent", () => {
    const urgent: FilterV1 = { fieldId: F.urgent.fieldId, operand: { kind: "boolean-is", value: true } };
    const read = dataset(grouped({ filters: [urgent] }));
    expect(rows(read)).toEqual(["Scheduled=2:2", "Waiting=1:1", "Done=1:1"]);
    expect(read).toMatchObject({ matchingRows: 4, tableTotal: 8 });
    expect(groups(read)[0]?.filterIntent).toEqual([urgent, { fieldId: F.status.fieldId, operand: { kind: "enum-in", optionIds: [OPTION.scheduled] } }]);
    expectIntentsCount(read);
  });

  it("sorts by the measure, largest first", () => {
    expect(rows(dataset(grouped({ measure: { kind: "sum", fieldId: F.quoted.fieldId }, sort: "measure-desc" })))).toEqual([
      "Waiting=7840:2",
      "Scheduled=7650.00:4",
      "Done=3270:2",
    ]);
  });
});

describe("scatter", () => {
  it("plots one point per record, newest first, and filters nothing", () => {
    const read = dataset({ ...base, type: "scatter", x: F.quoted.fieldId, y: F.paid.fieldId });
    expect(read.marks).toHaveLength(8);
    expect(read.marks.every((mark) => mark.kind === "point")).toBe(true);
    expect(read.marks[0]).toMatchObject({ kind: "point", x: "1850", y: "0" });
    expect(read).toMatchObject({ unplottedRows: 0, omittedCategories: 0, summary: { count: 8, total: null } });
  });
});

describe("D53 budgets, injected small", () => {
  it("reads the newest rows past the source budget, and names the sample", () => {
    const read = dataset(grouped({}), { sourceRows: 5, marks: 1_000 });
    // j4–j8 are the five newest rows.
    expect(rows(read)).toEqual(["Scheduled=2:2", "Waiting=1:1", "Done=2:2"]);
    expect(read).toMatchObject({ sourceRowsConsidered: 5, matchingRows: 8, tableTotal: 8, sample: { kind: "newest", rows: 5 } });
  });

  it("draws the first categories past the mark budget, names the rest, and keeps every one in the table", () => {
    const read = dataset(grouped({ groupBy: { kind: "field", fieldId: F.name.fieldId } }), { sourceRows: 20_000, marks: 3 });
    expect(read.marks).toHaveLength(3);
    expect(read.omittedCategories).toBe(5);
    expect(read.tablePage.total).toBe(8);
    expect(read.summary.count).toBe(8);
  });

  it("counts a stacked category's marks against the budget whole", () => {
    const read = dataset(grouped({ type: "stacked", seriesBy: { kind: "field", fieldId: F.urgent.fieldId } }), { sourceRows: 20_000, marks: 4 });
    // Scheduled has three marks; Waiting's two more would pass four.
    expect(read.marks).toHaveLength(3);
    expect(read.omittedCategories).toBe(2);
  });
});

describe("refusals", () => {
  it("refuses a definition the schema does not support, drawing nothing", () => {
    const result = readChartDataset(port, grouped({ measure: { kind: "sum", fieldId: F.status.fieldId } }));
    expect(result).toEqual({ outcome: "refused", refusals: [{ reason: "measure-field-type", fieldId: F.status.fieldId, filterReason: null }] });
  });
});
