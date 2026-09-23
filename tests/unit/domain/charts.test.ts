import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  CHART_TYPES,
  markFilterIntent,
  validateChartDefinition,
  type ChartDefinitionV1,
  type ChartSchemaV1,
} from "../../../src/domain/model/charts.js";
import { asDomainId, type FieldId, type TableId } from "../../../src/domain/model/ids.js";
import type { FieldTypeV1, RelationshipDefV1, TableDefV1 } from "../../../src/domain/model/schema.js";
import { booleanValue, dateValue, enumValue, referenceValue, textValue } from "../../../src/domain/model/values.js";

const JOBS = asDomainId("table", new Uint8Array(16).fill(1));
const CUSTOMERS = asDomainId("table", new Uint8Array(16).fill(2));
const field = (n: number): FieldId => asDomainId("field", new Uint8Array(16).fill(n));
const STATUS = field(10);
const DUE = field(11);
const QUOTED = field(12);
const PAID = field(13);
const CUSTOMER = field(14);
const NOTES = field(15);
const CUSTOMER_ID = field(20);
const REGION = field(21);
const LINK = asDomainId("relationship", new Uint8Array(16).fill(30));
const OPEN = asDomainId("option", new Uint8Array(16).fill(40));
const CHART = asDomainId("chart", new Uint8Array(16).fill(50));

const tableOf = (tableId: TableId, ordinal: number, fields: readonly (readonly [FieldId, FieldTypeV1])[], keyFieldId: FieldId | null): TableDefV1 => ({
  tableId,
  displayName: `t${ordinal}`,
  tableOrdinal: ordinal,
  fields: fields.map(([fieldId, type], index) => ({
    fieldId,
    tableId,
    displayName: `f${index}`,
    fieldOrdinal: index,
    type,
    isRequired: false,
    isActive: true,
    schemaRevision: 1n,
  })),
  keyFieldId,
  labelFieldId: null,
  sourceSheetId: null,
  isActive: true,
  schemaRevision: 1n,
});

const relationship: RelationshipDefV1 = {
  relationshipId: LINK,
  fromTableId: JOBS,
  fromFieldId: CUSTOMER,
  toTableId: CUSTOMERS,
  toKeyFieldId: CUSTOMER_ID,
  detectionSource: "lookup-formula",
  isActive: true,
  schemaRevision: 1n,
};

const schema: ChartSchemaV1 = {
  tables: [
    tableOf(
      JOBS,
      0,
      [
        [STATUS, { kind: "enum" }],
        [DUE, { kind: "date" }],
        [QUOTED, { kind: "currency", currencyCode: "USD" }],
        [PAID, { kind: "number" }],
        [CUSTOMER, { kind: "reference" }],
        [NOTES, { kind: "text" }],
      ],
      null,
    ),
    tableOf(CUSTOMERS, 1, [[CUSTOMER_ID, { kind: "text" }], [REGION, { kind: "text" }]], CUSTOMER_ID),
  ],
  enumOptions: [{ optionId: OPEN, fieldId: STATUS, displayLabel: "Open", optionOrdinal: 0, isActive: true, schemaRevision: 1n }],
  relationships: [relationship],
};

const bar = (overrides: Partial<Exclude<ChartDefinitionV1, { type: "scatter" }>> = {}): ChartDefinitionV1 => ({
  chartVersion: 1,
  chartId: CHART,
  name: "Quoted by status",
  tableId: JOBS,
  filters: [],
  pinned: false,
  type: "bar",
  groupBy: { kind: "field", fieldId: STATUS },
  seriesBy: null,
  measure: { kind: "sum", fieldId: QUOTED },
  sort: "category",
  ...overrides,
});

describe("chart definition v1 (D54, CA-30)", () => {
  it("pins CHART_TYPES to migration 005's chart_type CHECK", async () => {
    const sql = await readFile("src/migrations/005_projection_v1.sql", "utf8");
    expect(sql).toContain(`chart_type IN (${CHART_TYPES.map((type) => `'${type}'`).join(", ")})`);
    expect(Object.isFrozen(CHART_TYPES)).toBe(true);
  });

  it("accepts each approved shape: field, relationship and date groups; count and decimal measures; scatter", () => {
    expect(validateChartDefinition(bar(), schema)).toEqual([]);
    expect(validateChartDefinition(bar({ groupBy: { kind: "related-field", relationshipId: LINK, referenceFieldId: CUSTOMER, fieldId: REGION }, measure: { kind: "count" } }), schema)).toEqual([]);
    expect(validateChartDefinition(bar({ type: "line", groupBy: { kind: "date", fieldId: DUE, unit: "month" }, measure: { kind: "average", fieldId: PAID } }), schema)).toEqual([]);
    expect(validateChartDefinition(bar({ type: "stacked", seriesBy: { kind: "field", fieldId: NOTES } }), schema)).toEqual([]);
    const scatter: ChartDefinitionV1 = { chartVersion: 1, chartId: CHART, name: "Quoted vs paid", tableId: JOBS, filters: [], pinned: true, type: "scatter", x: QUOTED, y: PAID };
    expect(validateChartDefinition(scatter, schema)).toEqual([]);
  });

  it("refuses wrong field types, a series off a stacked chart, an inactive relationship and a bad filter", () => {
    const reasons = (definition: ChartDefinitionV1, against: ChartSchemaV1 = schema) =>
      validateChartDefinition(definition, against).map((refusal) => refusal.reason);
    expect(reasons(bar({ measure: { kind: "sum", fieldId: NOTES } }))).toEqual(["measure-field-type"]);
    expect(reasons(bar({ groupBy: { kind: "field", fieldId: QUOTED } }))).toEqual(["group-field-type"]);
    expect(reasons(bar({ groupBy: { kind: "field", fieldId: DUE } }))).toEqual(["group-field-type"]);
    expect(reasons(bar({ groupBy: { kind: "date", fieldId: NOTES, unit: "year" } }))).toEqual(["group-field-type"]);
    expect(reasons(bar({ seriesBy: { kind: "field", fieldId: NOTES } }))).toEqual(["series-on-non-stacked"]);
    const related = bar({ groupBy: { kind: "related-field", relationshipId: LINK, referenceFieldId: CUSTOMER, fieldId: REGION } });
    expect(reasons(related, { ...schema, relationships: [{ ...relationship, isActive: false }] })).toEqual(["inactive-relationship"]);
    expect(reasons(related, { ...schema, relationships: [] })).toEqual(["unknown-relationship"]);
    const scatter: ChartDefinitionV1 = { chartVersion: 1, chartId: CHART, name: "x", tableId: JOBS, filters: [], pinned: false, type: "scatter", x: QUOTED, y: NOTES };
    expect(reasons(scatter)).toEqual(["measure-field-type"]);
    expect(validateChartDefinition(bar({ filters: [{ fieldId: DUE, operand: { kind: "date-range", from: 2, to: 1 } }] }), schema)).toEqual([
      { reason: "invalid-filter", fieldId: DUE, filterReason: "inverted-range" },
    ]);
    expect(reasons(bar({ name: "  " }))).toEqual(["missing-name"]);
    expect(reasons(bar({ tableId: asDomainId("table", new Uint8Array(16).fill(9)) }))).toEqual(["unknown-table"]);
  });
});

describe("markFilterIntent (D54)", () => {
  it("turns an enum mark into its option", () => {
    expect(markFilterIntent(bar(), { kind: "value", value: enumValue(OPEN) })).toEqual({
      fieldId: STATUS,
      operand: { kind: "enum-in", optionIds: [OPEN] },
    });
  });

  it("turns a reference mark into its record", () => {
    const parent = asDomainId("record", new Uint8Array(16).fill(60));
    expect(markFilterIntent(bar({ groupBy: { kind: "field", fieldId: CUSTOMER } }), { kind: "value", value: referenceValue(parent) })).toEqual({
      fieldId: CUSTOMER,
      operand: { kind: "reference-in", recordIds: [parent] },
    });
  });

  it("turns a date-month mark into that month's inclusive range", () => {
    const march9 = 20_521;
    const byMonth = bar({ groupBy: { kind: "date", fieldId: DUE, unit: "month" } });
    expect(markFilterIntent(byMonth, { kind: "value", value: dateValue(march9) })).toEqual({
      fieldId: DUE,
      operand: { kind: "date-range", from: 20_513, to: 20_543 },
    });
    const byYear = bar({ groupBy: { kind: "date", fieldId: DUE, unit: "year" } });
    expect(markFilterIntent(byYear, { kind: "value", value: dateValue(march9) })).toMatchObject({ operand: { from: 20_454, to: 20_818 } });
    const byDay = bar({ groupBy: { kind: "date", fieldId: DUE, unit: "day" } });
    expect(markFilterIntent(byDay, { kind: "value", value: dateValue(march9) })).toMatchObject({ operand: { from: march9, to: march9 } });
  });

  it("turns a relationship-label mark into the reference field over the parents carrying that label", () => {
    const parents = [1, 2].map((n) => asDomainId("record", new Uint8Array(16).fill(70 + n)));
    const related = bar({ groupBy: { kind: "related-field", relationshipId: LINK, referenceFieldId: CUSTOMER, fieldId: REGION } });
    expect(markFilterIntent(related, { kind: "parents", recordIds: parents })).toEqual({
      fieldId: CUSTOMER,
      operand: { kind: "reference-in", recordIds: parents },
    });
  });

  it("covers text, boolean and the empty bucket, and gives a scatter mark no intent", () => {
    const byNotes = bar({ groupBy: { kind: "field", fieldId: NOTES } });
    expect(markFilterIntent(byNotes, { kind: "value", value: textValue("Rush") })).toEqual({ fieldId: NOTES, operand: { kind: "text-equals", text: "Rush" } });
    expect(markFilterIntent(byNotes, { kind: "value", value: booleanValue(true) })).toEqual({ fieldId: NOTES, operand: { kind: "boolean-is", value: true } });
    expect(markFilterIntent(byNotes, { kind: "empty" })).toEqual({ fieldId: NOTES, operand: { kind: "is-empty" } });
    const scatter: ChartDefinitionV1 = { chartVersion: 1, chartId: CHART, name: "x", tableId: JOBS, filters: [], pinned: false, type: "scatter", x: QUOTED, y: PAID };
    expect(markFilterIntent(scatter, { kind: "empty" })).toBeNull();
  });

  it("produces intents the records filter validator accepts verbatim (CA-29)", () => {
    const jobs = schema.tables[0] as TableDefV1;
    const intents = [
      markFilterIntent(bar(), { kind: "value", value: enumValue(OPEN) }),
      markFilterIntent(bar({ groupBy: { kind: "date", fieldId: DUE, unit: "month" } }), { kind: "value", value: dateValue(20_521) }),
      markFilterIntent(bar({ groupBy: { kind: "related-field", relationshipId: LINK, referenceFieldId: CUSTOMER, fieldId: REGION } }), {
        kind: "parents",
        recordIds: [asDomainId("record", new Uint8Array(16).fill(71))],
      }),
    ];
    for (const intent of intents) {
      expect(intent).not.toBeNull();
      if (intent !== null) expect(validateChartDefinition(bar({ filters: [intent] }), schema)).toEqual([]);
    }
    expect(jobs.tableId).toBe(JOBS);
  });
});
