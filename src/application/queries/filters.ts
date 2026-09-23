/**
 * The records query's compiler (M35; CA-29): the domain's `FilterV1` and a
 * sort, checked against the table as it stands, become the projection's
 * closed query terms.
 *
 * Every filter passes `validateFilter` first — the one place that decides
 * whether a filter fits its field — and a refusal comes back as that typed
 * refusal, never as a query that quietly matches nothing. What this module
 * adds is the choice of lane, which is a fact about the field's type:
 *
 * - enum and reference sets match ids; dates and booleans match the integer
 *   lane (epoch day, 0/1); numbers and currencies match decimal bounds, which
 *   the projection compares through its 20-byte order key, never a float;
 * - text matches case-insensitively over NFC — equality, or containment —
 *   against the field's own text. The full-text index answers the
 *   record-wide search, not a field, so it is not used to pretend a
 *   field-level answer;
 * - empty means missing or blank. For a computed field that is “no result to
 *   show”, read from its lane, because its value is never authored (D51).
 */

import { encodeDomainId, type FieldId, type TableId } from "../../domain/model/ids.js";
import {
  validateFilter,
  type FilterRefusalV1,
  type FilterV1,
} from "../../domain/model/filters.js";
import {
  isComputedField,
  type EnumOptionDefV1,
  type FieldDefV1,
  type FieldTypeKindV1,
  type TableDefV1,
} from "../../domain/model/schema.js";
import type {
  ProjectionEnginePort,
  ProjectionFilterTermV1,
  ProjectionRecordSortV1,
  ProjectionSortKeyKindV1,
} from "../ports/projection.js";

/** One sort: a field and a direction (SHT-009). */
export interface RecordSortV1 {
  readonly fieldId: FieldId;
  readonly direction: "asc" | "desc";
}

/** More filters, or more values in one, than a query carries (the projection's bounds). */
export const MAX_RECORD_FILTERS = 32;
export const MAX_FILTER_SET_SIZE = 1_000;

export type CompiledRecordQueryV1 =
  | {
      readonly outcome: "compiled";
      readonly filters: readonly ProjectionFilterTermV1[];
      readonly sort: ProjectionRecordSortV1 | null;
    }
  | { readonly outcome: "refused"; readonly refusal: FilterRefusalV1 };

const SORT_KEY: Readonly<Record<FieldTypeKindV1, ProjectionSortKeyKindV1>> = {
  text: "text",
  phone: "text",
  email: "text",
  url: "text",
  address: "text",
  number: "decimal",
  currency: "decimal",
  date: "integer",
  boolean: "integer",
  enum: "option-ordinal",
  reference: "reference-label",
};

/** The table and its enum options, as the projection holds them now. */
export function readTableDefinition(
  projection: ProjectionEnginePort,
  tableId: TableId,
): { readonly table: TableDefV1; readonly enumOptions: readonly EnumOptionDefV1[] } | null {
  const key = encodeDomainId(tableId);
  const summary = projection
    .execute({ kind: "list-tables" })
    .find((candidate) => encodeDomainId(candidate.tableId) === key);
  if (summary === undefined) {
    return null;
  }
  const fields = projection.execute({ kind: "list-fields", tableId: summary.tableId });
  return {
    table: { ...summary, fields },
    enumOptions: fields
      .filter((field) => field.type.kind === "enum")
      .flatMap((field) => projection.execute({ kind: "list-enum-options", fieldId: field.fieldId })),
  };
}

const activeField = (table: TableDefV1, fieldId: FieldId): FieldDefV1 | undefined => {
  const key = encodeDomainId(fieldId);
  return table.fields.find((field) => field.isActive && encodeDomainId(field.fieldId) === key);
};

/** One validated filter as the lane predicate its operand means for this field. */
function toTerm(filter: FilterV1, field: FieldDefV1): ProjectionFilterTermV1 {
  const fieldId = field.fieldId;
  const operand = filter.operand;
  switch (operand.kind) {
    case "enum-in":
      return { kind: "id-in", fieldId, ids: operand.optionIds };
    case "reference-in":
      return { kind: "id-in", fieldId, ids: operand.recordIds };
    case "date-range":
      return { kind: "integer-range", fieldId, min: operand.from, max: operand.to };
    case "boolean-is": {
      const lane = operand.value ? 1 : 0;
      return { kind: "integer-range", fieldId, min: lane, max: lane };
    }
    case "number-range":
      return { kind: "decimal-range", fieldId, min: operand.min, max: operand.max };
    case "text-equals":
    case "text-contains":
      return { kind: operand.kind, fieldId, text: operand.text };
    case "reference-broken":
      return { kind: "reference-broken", fieldId };
    case "is-empty":
    case "not-empty":
      return { kind: operand.kind, fieldId, isComputed: isComputedField(field) };
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

const setSize = (filter: FilterV1): number =>
  filter.operand.kind === "enum-in"
    ? filter.operand.optionIds.length
    : filter.operand.kind === "reference-in"
      ? filter.operand.recordIds.length
      : 0;

/**
 * Validates every filter and the sort against the table, then compiles them.
 * The first refusal wins, so a surface can name the one filter at fault.
 */
export function compileRecordQuery(
  table: TableDefV1,
  enumOptions: readonly EnumOptionDefV1[],
  filters: readonly FilterV1[],
  sort: RecordSortV1 | null,
): CompiledRecordQueryV1 {
  const terms: ProjectionFilterTermV1[] = [];
  for (const filter of filters) {
    const refusal = validateFilter(filter, table, enumOptions);
    if (refusal !== null) {
      return { outcome: "refused", refusal };
    }
    if (terms.length === MAX_RECORD_FILTERS || setSize(filter) > MAX_FILTER_SET_SIZE) {
      return { outcome: "refused", refusal: { reason: "invalid-value", fieldId: filter.fieldId } };
    }
    // `validateFilter` found it active, so it is there.
    terms.push(toTerm(filter, activeField(table, filter.fieldId) as FieldDefV1));
  }

  if (sort === null) {
    return { outcome: "compiled", filters: terms, sort: null };
  }
  const field = activeField(table, sort.fieldId);
  if (field === undefined) {
    return { outcome: "refused", refusal: { reason: "unknown-field", fieldId: sort.fieldId } };
  }
  return {
    outcome: "compiled",
    filters: terms,
    sort: { fieldId: field.fieldId, direction: sort.direction, key: SORT_KEY[field.type.kind] },
  };
}
