import type { AppNavigation } from "../../../../src/ui/records/app-frame.js";
import type {
  AppStructureViewV1,
  ImpactReportWireV1,
  SchemaChangeWireV1,
  SchemaPreviewViewV1,
  StructureFieldViewV1,
} from "../../../../src/workers/protocol/messages.js";

/**
 * One app's structure as S03's `getAppStructure` answers it: two tables, a
 * connection, a computed column, a table metric and one rule across fields.
 * The structure column's view-model and surface tests share it.
 */

export const APP_ID = "app-field-log";

export const IDS = Object.freeze({
  jobs: "table-jobs",
  customers: "table-customers",
  name: "field-name",
  start: "field-start",
  finish: "field-finish",
  quoted: "field-quoted",
  paid: "field-paid",
  status: "field-status",
  customer: "field-customer",
  balance: "field-balance",
  customerName: "field-customer-name",
  relationship: "rel-customer",
  balanceFormula: "formula-balance",
  metricFormula: "formula-total",
  rule: "rule-finish",
});

const field = (
  fieldId: string,
  displayName: string,
  fieldOrdinal: number,
  type: StructureFieldViewV1["type"],
  extra: Partial<StructureFieldViewV1> = {},
): StructureFieldViewV1 => ({
  fieldId,
  displayName,
  fieldOrdinal,
  type,
  isRequired: false,
  isActive: true,
  formulaId: null,
  enumOptions: [],
  ...extra,
});

export function structure(overrides: Partial<AppStructureViewV1> = {}): AppStructureViewV1 {
  return {
    appId: APP_ID,
    displayName: "Field Log",
    schemaRevision: 4,
    tables: [
      {
        tableId: IDS.customers,
        displayName: "Customers",
        tableOrdinal: 1,
        keyFieldId: IDS.customerName,
        labelFieldId: IDS.customerName,
        recordCount: 3,
        fields: [field(IDS.customerName, "Name", 0, { kind: "text" })],
        rules: [],
      },
      {
        tableId: IDS.jobs,
        displayName: "Jobs",
        tableOrdinal: 0,
        keyFieldId: null,
        labelFieldId: IDS.name,
        recordCount: 5,
        fields: [
          field(IDS.name, "Name", 0, { kind: "text" }),
          field(IDS.status, "Status", 5, { kind: "enum" }, {
            enumOptions: [
              { optionId: "opt-complete", label: "Complete", optionOrdinal: 1, isActive: true },
              { optionId: "opt-scheduled", label: "Scheduled", optionOrdinal: 0, isActive: true },
              { optionId: "opt-old", label: "Cancelled", optionOrdinal: 2, isActive: false },
            ],
          }),
          field(IDS.start, "Start", 1, { kind: "date" }),
          field(IDS.finish, "Finish by", 2, { kind: "date" }, { isRequired: true }),
          field(IDS.quoted, "Quoted", 3, { kind: "currency", currencyCode: "USD" }),
          field(IDS.paid, "Paid", 4, { kind: "number" }),
          field(IDS.customer, "Customer", 6, { kind: "reference" }),
          field(IDS.balance, "Balance", 7, { kind: "number" }, { formulaId: IDS.balanceFormula }),
          field("field-notes", "Notes", 8, { kind: "text" }, { isActive: false }),
        ],
        rules: [
          {
            ruleId: IDS.rule,
            displayName: "Finish by is on or after Start",
            irVersion: 2,
            severity: "blocking",
            condition: { kind: "compare", left: IDS.finish, op: "ge", right: { field: IDS.start } },
          },
        ],
      },
    ],
    relationships: [
      {
        relationshipId: IDS.relationship,
        fromTableId: IDS.jobs,
        fromFieldId: IDS.customer,
        toTableId: IDS.customers,
        toKeyFieldId: IDS.customerName,
        fromTableName: "Jobs",
        toTableName: "Customers",
        detectionSource: "key-match",
        isActive: true,
      },
    ],
    formulas: [
      {
        formulaId: IDS.balanceFormula,
        target: { kind: "computed-column", tableId: IDS.jobs, fieldId: IDS.balance },
        displayName: null,
        text: "[Quoted]-[Paid]",
        disposition: "live",
        determinism: "deterministic",
        isActive: true,
      },
      {
        formulaId: IDS.metricFormula,
        target: { kind: "table-metric", tableId: IDS.jobs },
        displayName: "Total quoted",
        text: "SUM(Jobs[Quoted])",
        disposition: "live",
        determinism: "deterministic",
        isActive: true,
      },
    ],
    ...overrides,
  };
}

export function impact(change: SchemaChangeWireV1["kind"], counts: Partial<ImpactReportWireV1> = {}): ImpactReportWireV1 {
  return {
    change,
    total: 5,
    affected: 0,
    unchanged: 5,
    converted: 0,
    keptAndFlagged: 0,
    missingNow: 0,
    onRemovedOptions: 0,
    matchedKeys: 0,
    unmatchedKeys: 0,
    unlinkedReferences: 0,
    failingRule: 0,
    formulaErrors: 0,
    ...counts,
  };
}

export function preview(
  change: SchemaChangeWireV1["kind"],
  counts: Partial<ImpactReportWireV1> = {},
  extra: Partial<SchemaPreviewViewV1> = {},
): SchemaPreviewViewV1 {
  return { schemaRevision: 4, impact: impact(change, counts), eventCount: 2, refusal: null, isTooLarge: false, ...extra };
}

const theme = {
  themeKey: "sheaf.built-in.v1",
  tokens: {
    "app-ink": "#17231e",
    "app-canvas": "#f5f1e7",
    "app-surface": "#fffdf6",
    "app-primary": "#315c49",
    "app-accent": "#c66948",
    "app-muted": "#56645c",
  },
};

export const nav: AppNavigation = {
  library: "#/library",
  appHome: `#/app/${APP_ID}`,
  appHistory: `#/app/${APP_ID}/history`,
  appSnapshots: `#/app/${APP_ID}/snapshots`,
  charts: `#/app/${APP_ID}/charts`,
  structure: `#/app/${APP_ID}/structure`,
  settings: `#/app/${APP_ID}/settings`,
  tables: [{ tableId: IDS.jobs, displayName: "Jobs", href: `#/app/${APP_ID}/t/${IDS.jobs}` }],
};

export const identity = { appId: APP_ID, displayName: "Field Log", theme };
