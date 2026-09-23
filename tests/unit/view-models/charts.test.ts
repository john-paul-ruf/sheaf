/**
 * SCR-033's view model (S05 CP3): a CA-30 dataset in words and facts, with
 * nothing computed that the worker did not send.
 */

import { describe, expect, it } from "vitest";
import {
  appendTablePage,
  defaultChartDefinition,
  selectChartBuilderVm,
  selectChartDetailVm,
  selectChartsIndexVm,
} from "../../../src/application/view-models/records.js";
import type { ChartDefinitionWireV1 } from "../../../src/workers/protocol/messages.js";
import { CHART_ID, MARKS, dataset } from "../ui/charts/fixtures.js";
import { FIELD_IDS, table } from "../ui/records/fixtures.js";

const tables = [table()];

describe("selectChartDetailVm", () => {
  it("names the chart, its table, its grouping and its measure", () => {
    const vm = selectChartDetailVm(dataset(), tables);
    expect(vm).toMatchObject({
      screen: "SCR-033",
      chartId: CHART_ID,
      chartRevision: 2,
      name: "Quoted by site",
      type: "bar",
      pinned: true,
      provenance: "user",
      tableName: "Visits",
      groupName: "Site",
      seriesName: null,
      measure: { kind: "sum", fieldName: "Quoted amount", fieldType: { kind: "currency", currencyCode: "USD" } },
      axes: null,
    });
  });

  it("names each category in words: an option by its label, the two absent buckets apart", () => {
    const vm = selectChartDetailVm(dataset(), tables);
    expect(vm.marks.map((mark) => (mark.kind === "group" ? mark.category : null))).toEqual([
      { kind: "text", text: "Ridgeway Depot" },
      { kind: "text", text: "Alder Court" },
      { kind: "absent" },
      { kind: "unreadable" },
    ]);
    expect(vm.marks.map((mark) => mark.index)).toEqual([0, 1, 2, 3]);
  });

  it("hands every mark's intent on verbatim, and says when a mark has none", () => {
    const vm = selectChartDetailVm(dataset(), tables);
    const [ridgeway, , , unreadable] = vm.marks;
    expect(ridgeway?.kind === "group" ? ridgeway.filterIntent : undefined).toEqual(MARKS[0]?.kind === "group" ? MARKS[0].filterIntent : null);
    expect(unreadable?.kind === "group" ? unreadable.filterIntent : undefined).toBeNull();
  });

  it("gives a reference mark's record its label, so the list's chip reads as a name", () => {
    const vm = selectChartDetailVm(
      dataset({
        marks: [
          {
            kind: "group",
            category: { kind: "value", value: { kind: "reference", recordId: "record-7" }, label: "Priya Ellis" },
            series: null,
            value: "2",
            records: 2,
            filterIntent: [{ fieldId: FIELD_IDS.site, operand: { kind: "reference-in", recordIds: ["record-7"] } }],
          },
        ],
      }),
      tables,
    );
    const [mark] = vm.marks;
    expect(mark?.kind === "group" ? [...mark.recordLabels] : []).toEqual([["record-7", "Priya Ellis"]]);
  });

  it("states a complete scope as complete", () => {
    expect(selectChartDetailVm(dataset(), tables).scope).toEqual({
      kind: "all",
      rows: 8,
      total: 8,
      categories: 4,
      drawn: 4,
      unplotted: 0,
      isPartial: false,
    });
  });

  it("states a sample and an omission exactly (STA-015, D53)", () => {
    const vm = selectChartDetailVm(
      dataset({
        sourceRowsConsidered: 20_000,
        matchingRows: 25_000,
        sample: { kind: "newest", rows: 20_000 },
        omittedCategories: 200,
        tablePage: { rows: MARKS, offset: 0, total: 204 },
      }),
      tables,
    );
    expect(vm.scope).toMatchObject({ kind: "sample", rows: 20_000, total: 25_000, categories: 204, drawn: 4, isPartial: true });
    expect(vm.table).toMatchObject({ total: 204, hasMore: true });
  });

  it("appends the data table's next page to the one already shown", () => {
    const first = selectChartDetailVm(dataset({ tablePage: { rows: MARKS.slice(0, 2), offset: 0, total: 4 } }), tables);
    const next = selectChartDetailVm(dataset({ tablePage: { rows: MARKS.slice(2), offset: 2, total: 4 } }), tables);
    const both = appendTablePage(first, next);
    expect(both.table.rows.map((row) => row.index)).toEqual([0, 1, 2, 3]);
    expect(both.table.hasMore).toBe(false);
  });

  it("names a date bucket by its unit and a scatter by its axes", () => {
    const byMonth = selectChartDetailVm(
      dataset({
        definition: {
          name: "Visits by month",
          tableId: tables[0]!.tableId,
          filters: [],
          pinned: false,
          type: "line",
          groupBy: { kind: "date", fieldId: FIELD_IDS.visitDate, unit: "month" },
          seriesBy: null,
          measure: { kind: "count" },
          sort: "category",
        },
        marks: [{ kind: "group", category: { kind: "value", value: { kind: "date", epochDay: 19_997 }, label: null }, series: null, value: "3", records: 3, filterIntent: [] }],
      }),
      tables,
    );
    expect(byMonth.marks[0]).toMatchObject({ category: { kind: "date", epochDay: 19_997, unit: "month" } });
    expect(byMonth.groupName).toBe("Visit date");

    const scatter = selectChartDetailVm(
      dataset({
        definition: { name: "Amount by amount", tableId: tables[0]!.tableId, filters: [], pinned: false, type: "scatter", x: FIELD_IDS.amount, y: FIELD_IDS.amount },
        marks: [{ kind: "point", recordId: "record-1", x: "10", y: "20" }],
        summary: { highest: null, lowest: null, total: null, count: 1 },
        tablePage: { rows: [{ kind: "point", recordId: "record-1", x: "10", y: "20" }], offset: 0, total: 1 },
      }),
      tables,
    );
    expect(scatter).toMatchObject({ groupName: null, measure: { kind: "count" }, axes: { x: "Quoted amount", y: "Quoted amount" } });
  });
});

describe("selectChartBuilderVm (SCR-034)", () => {
  const visits = table();
  const customers = {
    ...table({ tableId: "table-customers", displayName: "Customers", tableOrdinal: 1 }),
    fields: [{ fieldId: "field-region", displayName: "Region", fieldOrdinal: 0, type: { kind: "text" as const }, isRequired: false, isActive: true, enumOptions: [] }],
  };
  const relationship = {
    relationshipId: "rel-1",
    fromTableId: visits.tableId,
    fromFieldId: FIELD_IDS.site,
    toTableId: "table-customers",
    toKeyFieldId: "field-region",
    fromTableName: "Visits",
    toTableName: "Customers",
    detectionSource: "declared" as const,
    isActive: true,
  };
  const initial = defaultChartDefinition(visits);

  it("starts a new chart as chart-builder.html does: a bar of the first groupable field, counting, pinned", () => {
    expect(initial).toMatchObject({ type: "bar", groupBy: { kind: "field", fieldId: FIELD_IDS.visitId }, measure: { kind: "count" }, pinned: true, name: "" });
  });

  it("offers the table's fields, its dates by day, month and year, and its numbers as measures", () => {
    const vm = selectChartBuilderVm({ tables: [visits, customers], relationships: [relationship], definition: initial!, included: new Set() });
    expect(vm.groupings.map((choice) => choice.label)).toEqual([
      "Visit ID",
      "Visit date (day)",
      "Visit date (month)",
      "Visit date (year)",
      "Site",
      "Status",
      "Follow up",
      "Contact phone",
      "Contact email",
      "Site page",
    ]);
    expect(vm.measures.map((choice) => choice.label)).toEqual([
      "Count of visits",
      "Sum of quoted amount",
      "Average quoted amount",
      "Lowest quoted amount",
      "Highest quoted amount",
    ]);
    expect(vm.numbers.map((choice) => choice.label)).toEqual(["Quoted amount"]);
    expect(vm.scatterBlocker).toBeNull();
    expect(vm.saveBlocker).toBe("Name the chart to save it.");
  });

  it("offers a related table's fields only when asked, naming the connection it uses (D54)", () => {
    const off = selectChartBuilderVm({ tables: [visits, customers], relationships: [relationship], definition: initial!, included: new Set() });
    expect(off.relationships).toEqual([
      { relationshipId: "rel-1", parentName: "Customers", sentence: "Uses the connection Sheaf found from Visits to Customers.", isIncluded: false },
    ]);
    expect(off.groupings.some((choice) => choice.value.kind === "related-field")).toBe(false);
    const on = selectChartBuilderVm({ tables: [visits, customers], relationships: [relationship], definition: initial!, included: new Set(["rel-1"]) });
    expect(on.groupings.at(-1)).toMatchObject({
      label: "Customers → Region",
      value: { kind: "related-field", relationshipId: "rel-1", referenceFieldId: FIELD_IDS.site, fieldId: "field-region" },
    });
  });

  it("says why a scatter cannot be drawn from a table with no number, and lets a named chart save", () => {
    const plain = { ...visits, fields: visits.fields.filter((field) => field.type.kind !== "currency") };
    const vm = selectChartBuilderVm({ tables: [plain], relationships: [], definition: { ...initial!, name: "By site" }, included: new Set() });
    expect(vm.scatterBlocker).toBe("Visits has no number column to plot.");
    expect(vm.saveBlocker).toBeNull();
  });
});

describe("selectChartsIndexVm (SCR-053)", () => {
  const chart = (chartId: string, name: string, pinned: boolean, provenance: "imported" | "user", definition: Partial<ChartDefinitionWireV1> = {}) => ({
    chartId,
    definition: { ...dataset().definition, name, pinned, ...definition } as ChartDefinitionWireV1,
    ordinal: 0,
    provenance,
    chartRevision: 3,
  });

  it("lists every chart by name with its origin, grouping and pin, and counts the pinned", () => {
    const vm = selectChartsIndexVm(
      [
        chart("c-2", "Quoted by month", false, "imported", { type: "line", groupBy: { kind: "date", fieldId: FIELD_IDS.visitDate, unit: "month" } }),
        chart("c-1", "By site", true, "user"),
      ],
      [table()],
    );
    expect(vm.rows.map((row) => [row.name, row.provenance, row.pinned, row.tableName, row.grouping])).toEqual([
      ["By site", "user", true, "Visits", { kind: "field" }],
      ["Quoted by month", "imported", false, "Visits", { kind: "date", fieldName: "Visit date", unit: "month" }],
    ]);
    expect(vm.pinnedCount).toBe(1);
    expect(vm.announcement).toBe("2 charts · 1 pinned to app home.");
  });

  it("says when there are none", () => {
    expect(selectChartsIndexVm([], [table()])).toMatchObject({ rows: [], pinnedCount: 0, announcement: "No charts yet." });
  });
});
