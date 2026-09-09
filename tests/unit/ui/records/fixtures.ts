import type {
  AppFieldViewV1,
  AppSessionViewV1,
  AppTableViewV1,
  CellWireEntryV1,
  ChangeHistoryEntryViewV1,
  ChangeHistoryPageViewV1,
  RecordDetailViewV1,
  RecordPageViewV1,
  RecordSummaryViewV1,
} from "../../../../src/workers/protocol/messages.js";

/**
 * The shapes S05 pinned, built the way the demo import actually produces them:
 * one table, nine fields, an enum, a currency, and one preserved invalid value
 * (`tests/fixtures/workbooks/delimited/field-log-messy.csv`).
 *
 * They are literals rather than a call into the worker: these tests are about
 * what a *surface* does with a view shape, and building the shape by hand is
 * what keeps a screen's failure from being read as the projection's.
 */

export const APP_ID = "app-1";
export const TABLE_ID = "table-1";

export const FIELD_IDS = Object.freeze({
  visitId: "field-visit-id",
  visitDate: "field-visit-date",
  site: "field-site",
  status: "field-status",
  amount: "field-amount",
  followUp: "field-follow-up",
  phone: "field-phone",
  email: "field-email",
  url: "field-url",
});

export const OPTION_IDS = Object.freeze({
  ridgeway: "option-ridgeway",
  alder: "option-alder",
  retired: "option-retired",
});

function field(
  fieldId: string,
  displayName: string,
  fieldOrdinal: number,
  type: AppFieldViewV1["type"],
  overrides: Partial<AppFieldViewV1> = {},
): AppFieldViewV1 {
  return {
    fieldId,
    displayName,
    fieldOrdinal,
    type,
    isRequired: false,
    isActive: true,
    enumOptions: [],
    ...overrides,
  };
}

export function table(overrides: Partial<AppTableViewV1> = {}): AppTableViewV1 {
  return {
    tableId: TABLE_ID,
    displayName: "Visits",
    tableOrdinal: 0,
    recordCount: 40,
    isRecordCountExact: true,
    fields: [
      field(FIELD_IDS.visitId, "Visit ID", 0, { kind: "text" }),
      field(FIELD_IDS.visitDate, "Visit date", 1, { kind: "date" }),
      field(FIELD_IDS.site, "Site", 2, { kind: "enum" }, {
        enumOptions: [
          {
            optionId: OPTION_IDS.ridgeway,
            label: "Ridgeway Depot",
            optionOrdinal: 0,
            isActive: true,
          },
          {
            optionId: OPTION_IDS.alder,
            label: "Alder Court",
            optionOrdinal: 1,
            isActive: true,
          },
          {
            optionId: OPTION_IDS.retired,
            label: "Retired yard",
            optionOrdinal: 2,
            isActive: false,
          },
        ],
      }),
      field(FIELD_IDS.status, "Status", 3, { kind: "text" }, {
        isRequired: true,
      }),
      field(FIELD_IDS.amount, "Quoted amount", 4, {
        kind: "currency",
        currencyCode: "USD",
      }),
      field(FIELD_IDS.followUp, "Follow up", 5, { kind: "boolean" }),
      field(FIELD_IDS.phone, "Contact phone", 6, { kind: "phone" }),
      field(FIELD_IDS.email, "Contact email", 7, { kind: "email" }),
      field(FIELD_IDS.url, "Site page", 8, { kind: "url" }),
    ],
    ...overrides,
  };
}

export function session(
  overrides: Partial<AppSessionViewV1> = {},
): AppSessionViewV1 {
  return {
    appId: APP_ID,
    displayName: "Field Log",
    theme: {
      themeKey: "sheaf.built-in.v1",
      tokens: {
        "app-ink": "#17211c",
        "app-canvas": "#f7f5ee",
        "app-surface": "#fffdf8",
        "app-primary": "#2d5a4b",
        "app-accent": "#4f7d6c",
        "app-muted": "#e2ded2",
      },
    },
    schemaRevision: 1,
    createdAtEpochMs: 1_757_000_000_000,
    lastOpenedAtEpochMs: null,
    isScratch: true,
    deviceOnlyChangeCount: 1,
    tables: [table()],
    ...overrides,
  };
}

export const DEMO_VALUES: readonly CellWireEntryV1[] = Object.freeze([
  { fieldId: FIELD_IDS.visitId, value: { kind: "text", text: "1018" } },
  { fieldId: FIELD_IDS.visitDate, value: { kind: "date", epochDay: 20_531 } },
  {
    fieldId: FIELD_IDS.site,
    value: { kind: "option", optionId: OPTION_IDS.alder },
  },
  { fieldId: FIELD_IDS.status, value: { kind: "text", text: "In progress" } },
  // Row 21 of the demo file: the currency column's one preserved original.
  { fieldId: FIELD_IDS.amount, value: { kind: "invalid", sourceText: "TBD" } },
  { fieldId: FIELD_IDS.followUp, value: { kind: "boolean", boolean: false } },
  {
    fieldId: FIELD_IDS.phone,
    value: { kind: "text", text: "(555) 010-1017" },
  },
  {
    fieldId: FIELD_IDS.email,
    value: { kind: "text", text: "alder-court17@example.org" },
  },
  {
    fieldId: FIELD_IDS.url,
    value: { kind: "text", text: "https://example.org/sites/alder-court" },
  },
]);

export function summary(
  overrides: Partial<RecordSummaryViewV1> = {},
): RecordSummaryViewV1 {
  return {
    recordId: "record-1",
    tableId: TABLE_ID,
    recordRevision: 1,
    cursor: 1,
    values: DEMO_VALUES,
    blockingIssueCount: 0,
    warningIssueCount: 1,
    ...overrides,
  };
}

export function detail(
  overrides: Partial<RecordDetailViewV1> = {},
): RecordDetailViewV1 {
  return {
    ...summary(),
    createdCommitId: "commit-1",
    updatedCommitId: "commit-1",
    issues: [
      {
        fieldId: FIELD_IDS.amount,
        kind: "value",
        severity: "warning",
        messageKey: "validation.preserved-invalid",
        messageParameters: { field: "Quoted amount" },
      },
    ],
    indexedFieldIds: [
      FIELD_IDS.visitId,
      FIELD_IDS.visitDate,
      FIELD_IDS.site,
      FIELD_IDS.status,
    ],
    ...overrides,
  };
}

export function page(
  overrides: Partial<RecordPageViewV1> = {},
): RecordPageViewV1 {
  return {
    tableId: TABLE_ID,
    scope: { kind: "table" },
    records: [summary()],
    hasMore: false,
    nextCursor: null,
    totalCount: 40,
    isTotalExact: true,
    ...overrides,
  };
}

export function historyEntry(
  overrides: Partial<ChangeHistoryEntryViewV1> = {},
): ChangeHistoryEntryViewV1 {
  return {
    eventId: "event-1",
    commitId: "commit-2",
    eventKind: "record.patched",
    subjectKind: "record",
    subjectId: "record-1",
    wallTimeMs: 1_757_000_100_000,
    logicalCounter: 2,
    recordRevision: 2,
    changedFieldIds: [FIELD_IDS.status],
    isRestorable: false,
    ...overrides,
  };
}

export function historyPage(
  overrides: Partial<ChangeHistoryPageViewV1> = {},
): ChangeHistoryPageViewV1 {
  return {
    entries: [historyEntry()],
    hasMore: false,
    nextCursor: null,
    ...overrides,
  };
}
