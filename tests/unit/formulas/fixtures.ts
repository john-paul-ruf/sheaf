/**
 * The demo workbook's shape as a formula sees it: a Jobs region (A Job ID, B
 * Customer, E Quoted, F Paid; data rows 2–61) and a Customers region (A ID
 * — the key — and B Name; data rows 2–40). Resolvers are built over it so
 * each test states only what differs.
 */

import { asDomainId, domainIdsEqual, type FieldId, type FormulaId, type RelationshipId, type TableId } from "../../../src/domain/model/ids.js";
import type {
  AuthoredResolverV1,
  ImportedColumnV1,
  ImportedRelationshipV1,
  ImportResolverV1,
  NameLookupV1,
} from "../../../src/domain/formulas/index.js";

export const id = <K extends "table" | "field" | "relationship" | "formula">(kind: K, n: number) =>
  asDomainId(kind, new Uint8Array(16).fill(n));

export const JOBS: TableId = id("table", 1);
export const CUSTOMERS: TableId = id("table", 2);
export const JOB_ID: FieldId = id("field", 10);
export const CUSTOMER: FieldId = id("field", 11);
export const QUOTED: FieldId = id("field", 14);
export const PAID: FieldId = id("field", 15);
export const BALANCE: FieldId = id("field", 16);
export const CUSTOMER_ID: FieldId = id("field", 20);
export const CUSTOMER_NAME: FieldId = id("field", 21);
export const JOBS_TO_CUSTOMERS: RelationshipId = id("relationship", 30);
export const TOTAL_QUOTED: FormulaId = id("formula", 40);
export const TOTAL_PAID: FormulaId = id("formula", 41);

const JOBS_COLUMNS: readonly (readonly [number, FieldId, string])[] = [
  [0, JOB_ID, "Job ID"],
  [1, CUSTOMER, "Customer"],
  [4, QUOTED, "Quoted"],
  [5, PAID, "Paid"],
];
const CUSTOMER_COLUMNS: readonly (readonly [number, FieldId, string])[] = [
  [0, CUSTOMER_ID, "ID"],
  [1, CUSTOMER_NAME, "Name"],
];

const column = (tableId: TableId, fieldId: FieldId, lastDataRow: number): ImportedColumnV1 => ({
  tableId,
  fieldId,
  firstDataRow: 1,
  lastDataRow,
});

export const ACCEPTED_RELATIONSHIP: ImportedRelationshipV1 = {
  relationshipId: JOBS_TO_CUSTOMERS,
  toTableId: CUSTOMERS,
  toKeyFieldId: CUSTOMER_ID,
};

/** A computed-column formula on Jobs row `row` (zero-based), unless overridden. */
export function importResolver(overrides: Partial<ImportResolverV1> = {}): ImportResolverV1 {
  return {
    sheet: "Jobs",
    row: 1,
    column: 6,
    tableId: JOBS,
    columnAt(sheet, columnIndex) {
      const [table, columns, lastDataRow] =
        sheet === "Jobs" ? [JOBS, JOBS_COLUMNS, 60] : sheet === "Customers" ? [CUSTOMERS, CUSTOMER_COLUMNS, 39] : [null, [], 0];
      const found = columns.find(([index]) => index === columnIndex);
      return table === null || found === undefined ? null : column(table, found[1], lastDataRow);
    },
    formulaAt(sheet, row, columnIndex) {
      if (sheet === "Summary" && columnIndex === 1 && row === 1) return TOTAL_QUOTED;
      if (sheet === "Summary" && columnIndex === 1 && row === 2) return TOTAL_PAID;
      return null;
    },
    tableColumn(table, name) {
      const [tableId, columns, lastDataRow] =
        table === null || table === "Jobs" ? [JOBS, JOBS_COLUMNS, 60] : table === "Customers" ? [CUSTOMERS, CUSTOMER_COLUMNS, 39] : [null, [], 0];
      const found = columns.find(([, , label]) => label === name);
      return tableId === null || found === undefined ? null : column(tableId, found[1], lastDataRow);
    },
    relationshipFrom(fieldId) {
      return domainIdsEqual(fieldId, CUSTOMER) ? ACCEPTED_RELATIONSHIP : null;
    },
    definedName() {
      return null;
    },
    ...overrides,
  };
}

const NAMES = new Map<string, string>([
  [JOB_ID.join(), "Job ID"],
  [CUSTOMER.join(), "Customer"],
  [QUOTED.join(), "Quoted"],
  [PAID.join(), "Paid"],
  [BALANCE.join(), "Balance"],
  [CUSTOMER_ID.join(), "ID"],
  [CUSTOMER_NAME.join(), "Name"],
  [JOBS.join(), "Jobs"],
  [CUSTOMERS.join(), "Customers"],
  [TOTAL_QUOTED.join(), "Total quoted"],
  [TOTAL_PAID.join(), "Total paid"],
]);

export const names: NameLookupV1 = {
  fieldName: (fieldId) => NAMES.get(fieldId.join()) ?? "?",
  tableName: (tableId) => NAMES.get(tableId.join()) ?? "?",
  formulaName: (formulaId) => NAMES.get(formulaId.join()) ?? "?",
};

const byName = <T extends Uint8Array>(ids: readonly T[], name: string): T | null =>
  ids.find((candidate) => NAMES.get(candidate.join()) === name) ?? null;

/** An authored resolver over the same names; `hasRow` is false for a metric or dashboard value. */
export function authoredResolver(hasRow = true): AuthoredResolverV1 {
  return {
    thisRowField: (name) => (hasRow ? byName([JOB_ID, CUSTOMER, QUOTED, PAID, BALANCE], name) : null),
    tableColumn(table, name) {
      if (table === "Jobs") {
        const fieldId = byName([JOB_ID, CUSTOMER, QUOTED, PAID, BALANCE], name);
        return fieldId === null ? null : { tableId: JOBS, fieldId };
      }
      if (table === "Customers") {
        const fieldId = byName([CUSTOMER_ID, CUSTOMER_NAME], name);
        return fieldId === null ? null : { tableId: CUSTOMERS, fieldId };
      }
      return null;
    },
    relatedField(referenceField, field) {
      const fieldId = byName([CUSTOMER_ID, CUSTOMER_NAME], field);
      return referenceField === "Customer" && fieldId !== null
        ? { relationshipId: JOBS_TO_CUSTOMERS, referenceFieldId: CUSTOMER, fieldId }
        : null;
    },
    formulaNamed: (name) => byName([TOTAL_QUOTED, TOTAL_PAID], name),
  };
}
