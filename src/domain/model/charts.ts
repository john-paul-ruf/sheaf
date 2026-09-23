/**
 * Chart definition v1 (D54, CA-30; database.md § `charts`).
 *
 * A chart is a stable-ID definition over one table: a grouping (a field of
 * the table, a parent field reached through one active relationship, or a
 * date bucketed by day, month or year), an optional series (stacked only), a
 * measure (a count, or sum/average/min/max of a decimal field), the records
 * filters it applies, and its sort. A scatter plots two decimal fields, one
 * mark per record. There is no SQL and no user join anywhere (FR-13).
 *
 * {@link markFilterIntent} is how a tapped mark becomes a records filter —
 * one pure definition shared by S05's chart dataset and S04's records query.
 */

import type { FilterRefusalReasonV1, FilterV1 } from "./filters.js";
import { validateFilter } from "./filters.js";
import type { ChartId, FieldId, RecordId, RelationshipId, TableId } from "./ids.js";
import { compareDomainIds } from "./ids.js";
import type { EnumOptionDefV1, FieldDefV1, FieldTypeKindV1, RelationshipDefV1, TableDefV1 } from "./schema.js";
import type { CellValueV1 } from "./values.js";

/** migration 005's `charts.chart_type` CHECK, verbatim. */
export const CHART_TYPES = Object.freeze(["bar", "line", "pie", "scatter", "stacked"] as const);

export type ChartTypeV1 = (typeof CHART_TYPES)[number];

export const DATE_GROUPING_UNITS = Object.freeze(["day", "month", "year"] as const);

export type DateGroupingUnitV1 = (typeof DATE_GROUPING_UNITS)[number];

export type GroupingV1 =
  /** A field of the chart's table: enum, reference, boolean or text. */
  | { readonly kind: "field"; readonly fieldId: FieldId }
  /** A parent table's field, through this table's reference field and one active relationship. */
  | {
      readonly kind: "related-field";
      readonly relationshipId: RelationshipId;
      readonly referenceFieldId: FieldId;
      readonly fieldId: FieldId;
    }
  | { readonly kind: "date"; readonly fieldId: FieldId; readonly unit: DateGroupingUnitV1 };

export type MeasureV1 =
  | { readonly kind: "count" }
  | { readonly kind: "sum" | "average" | "min" | "max"; readonly fieldId: FieldId };

export type ChartSortV1 = "category" | "measure-desc";

interface ChartCommonV1 {
  readonly chartVersion: 1;
  readonly chartId: ChartId;
  /** A user-editable label, never an identifier. */
  readonly name: string;
  readonly tableId: TableId;
  /** ANDed, exactly as the records query applies them (CA-29). */
  readonly filters: readonly FilterV1[];
  readonly pinned: boolean;
}

export type ChartDefinitionV1 = ChartCommonV1 &
  (
    | {
        readonly type: Exclude<ChartTypeV1, "scatter">;
        readonly groupBy: GroupingV1;
        /** Stacked charts only. */
        readonly seriesBy: GroupingV1 | null;
        readonly measure: MeasureV1;
        readonly sort: ChartSortV1;
      }
    | { readonly type: "scatter"; readonly x: FieldId; readonly y: FieldId }
  );

/** The schema a chart definition is checked against. */
export interface ChartSchemaV1 {
  readonly tables: readonly TableDefV1[];
  readonly enumOptions: readonly EnumOptionDefV1[];
  readonly relationships: readonly RelationshipDefV1[];
}

export const CHART_REFUSAL_REASONS = Object.freeze([
  "missing-name",
  "unknown-table",
  "unknown-field",
  /** A group field that cannot be a category (a number), or a date not grouped by day/month/year. */
  "group-field-type",
  /** sum/average/min/max, and both scatter axes, need a decimal (number or currency) field. */
  "measure-field-type",
  "series-on-non-stacked",
  "unknown-relationship",
  "inactive-relationship",
  "invalid-filter",
] as const);

export type ChartRefusalReasonV1 = (typeof CHART_REFUSAL_REASONS)[number];

export interface ChartRefusalV1 {
  readonly reason: ChartRefusalReasonV1;
  readonly fieldId: FieldId | null;
  /** Set for `invalid-filter`. */
  readonly filterReason: FilterRefusalReasonV1 | null;
}

const CATEGORY_TYPES: readonly FieldTypeKindV1[] = ["enum", "reference", "boolean", "text", "phone", "email", "url", "address"];
const DECIMAL_TYPES: readonly FieldTypeKindV1[] = ["number", "currency"];

const sameId = (left: Uint8Array, right: Uint8Array): boolean => compareDomainIds(left, right) === 0;

const activeField = (table: TableDefV1, fieldId: FieldId): FieldDefV1 | undefined =>
  table.fields.find((field) => field.isActive && sameId(field.fieldId, fieldId));

/** Every reason the definition cannot be saved or drawn; empty when it can. */
export function validateChartDefinition(definition: ChartDefinitionV1, schema: ChartSchemaV1): readonly ChartRefusalV1[] {
  const refusals: ChartRefusalV1[] = [];
  const refuse = (reason: ChartRefusalReasonV1, fieldId: FieldId | null = null, filterReason: FilterRefusalReasonV1 | null = null): void => {
    refusals.push({ reason, fieldId, filterReason });
  };
  if (definition.name.trim().length === 0) refuse("missing-name");
  const table = schema.tables.find((candidate) => candidate.isActive && sameId(candidate.tableId, definition.tableId));
  if (table === undefined) {
    refuse("unknown-table");
    return refusals;
  }

  const decimalField = (fieldId: FieldId): void => {
    const field = activeField(table, fieldId);
    if (field === undefined) refuse("unknown-field", fieldId);
    else if (!DECIMAL_TYPES.includes(field.type.kind)) refuse("measure-field-type", fieldId);
  };

  const grouping = (group: GroupingV1): void => {
    switch (group.kind) {
      case "field": {
        const field = activeField(table, group.fieldId);
        if (field === undefined) refuse("unknown-field", group.fieldId);
        else if (!CATEGORY_TYPES.includes(field.type.kind)) refuse("group-field-type", group.fieldId);
        return;
      }
      case "date": {
        const field = activeField(table, group.fieldId);
        if (field === undefined) refuse("unknown-field", group.fieldId);
        else if (field.type.kind !== "date") refuse("group-field-type", group.fieldId);
        return;
      }
      case "related-field": {
        const relationship = schema.relationships.find((candidate) => sameId(candidate.relationshipId, group.relationshipId));
        if (
          relationship === undefined ||
          !sameId(relationship.fromTableId, table.tableId) ||
          !sameId(relationship.fromFieldId, group.referenceFieldId)
        ) {
          refuse("unknown-relationship", group.referenceFieldId);
          return;
        }
        if (!relationship.isActive) {
          refuse("inactive-relationship", group.referenceFieldId);
          return;
        }
        const parent = schema.tables.find((candidate) => sameId(candidate.tableId, relationship.toTableId));
        const field = parent === undefined ? undefined : activeField(parent, group.fieldId);
        if (field === undefined) refuse("unknown-field", group.fieldId);
        else if (!CATEGORY_TYPES.includes(field.type.kind)) refuse("group-field-type", group.fieldId);
        return;
      }
      default: {
        const unreachable: never = group;
        return unreachable;
      }
    }
  };

  if (definition.type === "scatter") {
    decimalField(definition.x);
    decimalField(definition.y);
  } else {
    grouping(definition.groupBy);
    if (definition.seriesBy !== null) {
      if (definition.type === "stacked") grouping(definition.seriesBy);
      else refuse("series-on-non-stacked");
    }
    if (definition.measure.kind !== "count") decimalField(definition.measure.fieldId);
  }

  for (const filter of definition.filters) {
    const refusal = validateFilter(filter, table, schema.enumOptions);
    if (refusal !== null) refuse("invalid-filter", refusal.fieldId, refusal.reason);
  }
  return refusals;
}

/** One tapped mark's category, as the chart dataset names it. */
export type ChartCategoryV1 =
  /** An enum option, reference record, text or boolean value; or a day inside a date bucket. */
  | { readonly kind: "value"; readonly value: CellValueV1 }
  /** The bucket of records with no value. */
  | { readonly kind: "empty" }
  /** A relationship grouping's label: the parent records that carry it. */
  | { readonly kind: "parents"; readonly recordIds: readonly RecordId[] };

const MS_PER_DAY = 86_400_000;

/** The first and last day of the day/month/year bucket holding `epochDay` (UTC, no time zone). */
function bucketOf(epochDay: number, unit: DateGroupingUnitV1): { readonly from: number; readonly to: number } {
  if (unit === "day") return { from: epochDay, to: epochDay };
  const day = new Date(epochDay * MS_PER_DAY);
  const start = new Date(0);
  const end = new Date(0);
  if (unit === "month") {
    start.setUTCFullYear(day.getUTCFullYear(), day.getUTCMonth(), 1);
    end.setUTCFullYear(day.getUTCFullYear(), day.getUTCMonth() + 1, 1);
  } else {
    start.setUTCFullYear(day.getUTCFullYear(), 0, 1);
    end.setUTCFullYear(day.getUTCFullYear() + 1, 0, 1);
  }
  return { from: start.getTime() / MS_PER_DAY, to: end.getTime() / MS_PER_DAY - 1 };
}

/**
 * The records filter a tapped mark stands for (D54): equality on the group's
 * value (enum option, reference record, text, boolean), the date bucket's
 * range for a date group, `is-empty` for the empty bucket, or the reference
 * field `∈` the parents carrying a relationship group's label. `null` when the
 * mark has no category intent — a scatter mark is one record — or the
 * category does not fit the grouping.
 */
export function markFilterIntent(definition: ChartDefinitionV1, category: ChartCategoryV1): FilterV1 | null {
  if (definition.type === "scatter") return null;
  const group = definition.groupBy;
  const fieldId = group.kind === "related-field" ? group.referenceFieldId : group.fieldId;
  if (category.kind === "empty") return { fieldId, operand: { kind: "is-empty" } };
  if (group.kind === "related-field") {
    return category.kind === "parents" && category.recordIds.length > 0
      ? { fieldId, operand: { kind: "reference-in", recordIds: category.recordIds } }
      : null;
  }
  if (category.kind !== "value") return null;
  const value = category.value;
  if (group.kind === "date") {
    if (value.kind !== "date") return null;
    const { from, to } = bucketOf(value.epochDay, group.unit);
    return { fieldId, operand: { kind: "date-range", from, to } };
  }
  switch (value.kind) {
    case "enum":
      return { fieldId, operand: { kind: "enum-in", optionIds: [value.optionId] } };
    case "reference":
      return { fieldId, operand: { kind: "reference-in", recordIds: [value.recordId] } };
    case "text":
      return { fieldId, operand: { kind: "text-equals", text: value.text } };
    case "boolean":
      return { fieldId, operand: { kind: "boolean-is", value: value.boolean } };
    case "decimal":
    case "date":
    case "missing":
    case "blank":
    case "invalid-preserved":
      return null;
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}
