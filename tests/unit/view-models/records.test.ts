/**
 * CAP-15–CAP-17 (SCR-024–029, 032; MOD-009/010; FR-11/12/13).
 *
 * The assertions that matter are the ones a plausible-looking surface would
 * get wrong: a search page's count is the table's, a `commitId: null` receipt
 * is a no-op rather than a failure, a fresh app's change log is empty *and
 * says why*, and the three absent cell states never collapse into two.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_SUPPORTING_FACTS,
  announceRecordCommand,
  handoffFor,
  inputForField,
  selectAppHomeVm,
  selectChangeHistoryVm,
  selectDeleteRecordDialogVm,
  selectRecordDetailVm,
  selectRecordFormVm,
  selectRecordsListVm,
  selectHasManyVm,
  selectReferencePickerVm,
  selectRestoreRecordDialogVm,
  selectTableSwitcherVm,
  toCommandOutcomeVm,
  toIssueVm,
  toRecordLabel,
  UNLABELLED_RECORD,
  type AppHomeVm,
  type RecordDetailVm,
  type RecordsListVm,
  type ReferenceCellVm,
} from "../../../src/application/view-models/records.js";
import type {
  AppFieldViewV1,
  AppSessionViewV1,
  AppTableViewV1,
  CellWireEntryV1,
  ChangeHistoryPageViewV1,
  FieldTypeWireV1,
  RecordDetailViewV1,
  RecordPageViewV1,
  RecordSummaryViewV1,
} from "../../../src/workers/protocol/messages.js";

function fieldView(
  overrides: Partial<AppFieldViewV1> = {},
): AppFieldViewV1 {
  return {
    fieldId: "f-title",
    displayName: "Job title",
    fieldOrdinal: 0,
    type: { kind: "text" },
    isRequired: false,
    isActive: true,
    enumOptions: [],
    ...overrides,
  };
}

function tableView(fields: readonly AppFieldViewV1[]): AppTableViewV1 {
  return {
    tableId: "t-jobs",
    displayName: "Jobs",
    tableOrdinal: 0,
    recordCount: fields.length,
    isRecordCountExact: true,
    fields,
  };
}

function summary(
  values: readonly CellWireEntryV1[],
  overrides: Partial<RecordSummaryViewV1> = {},
): RecordSummaryViewV1 {
  return {
    recordId: "r-1",
    tableId: "t-jobs",
    recordRevision: 1,
    cursor: 10,
    values,
    blockingIssueCount: 0,
    warningIssueCount: 0,
    ...overrides,
  };
}

function page(overrides: Partial<RecordPageViewV1> = {}): RecordPageViewV1 {
  return {
    tableId: "t-jobs",
    scope: { kind: "table" },
    records: [],
    hasMore: false,
    nextCursor: null,
    totalCount: 0,
    isTotalExact: true,
    ...overrides,
  };
}

describe("the app home (SCR-024)", () => {
  const session: AppSessionViewV1 = {
    appId: "app-1",
    displayName: "Field Log",
    theme: {
      themeKey: "default",
      tokens: {
        "app-ink": "#000",
        "app-canvas": "#fff",
        "app-surface": "#eee",
        "app-primary": "#123",
        "app-accent": "#456",
        "app-muted": "#789",
      },
    },
    schemaRevision: 1,
    createdAtEpochMs: 1_700_000_000_000,
    lastOpenedAtEpochMs: null,
    isScratch: true,
    deviceOnlyChangeCount: 4,
    tables: [tableView([fieldView()])],
  };

  it("projects identity, tables and the scratch fact", () => {
    const vm = selectAppHomeVm(session);
    expect(vm.displayName).toBe("Field Log");
    expect(vm.isScratch).toBe(true);
    expect(vm.deviceOnlyChangeCount).toBe(4);
    expect(vm.tables).toEqual([
      {
        tableId: "t-jobs",
        displayName: "Jobs",
        recordCount: 1,
        isRecordCountExact: true,
        fieldCount: 1,
      },
    ]);
    expect(vm.announcement).toBe(
      "Field Log is on this device only. 4 changes have no durable copy.",
    );
  });

  it("has no field a metric or a chart could be invented into (STA-025)", () => {
    type ForbiddenKey = Extract<
      keyof AppHomeVm,
      "metrics" | "charts" | "pinnedChart" | "glance" | "route"
    >;
    const noForbiddenKeys: ForbiddenKey extends never ? true : false = true;
    expect(noForbiddenKeys).toBe(true);
  });
});

describe("the record list (SCR-025 / SCR-026)", () => {
  const fields = [
    fieldView({ fieldId: "f-title", displayName: "Job title", fieldOrdinal: 0 }),
    fieldView({ fieldId: "f-crew", displayName: "Crew", fieldOrdinal: 1 }),
    fieldView({ fieldId: "f-note", displayName: "Note", fieldOrdinal: 2 }),
    fieldView({ fieldId: "f-ref", displayName: "Reference", fieldOrdinal: 3 }),
    fieldView({ fieldId: "f-extra", displayName: "Extra", fieldOrdinal: 4 }),
  ];

  it("leads with a label and carries at most three supporting facts", () => {
    const vm = selectRecordsListVm(
      tableView(fields),
      page({
        records: [
          summary([
            { fieldId: "f-title", value: { kind: "text", text: "Patio" } },
            { fieldId: "f-crew", value: { kind: "text", text: "Mina" } },
            { fieldId: "f-note", value: { kind: "text", text: "Valve" } },
            { fieldId: "f-ref", value: { kind: "text", text: "C-882" } },
            { fieldId: "f-extra", value: { kind: "text", text: "Never" } },
          ]),
        ],
        totalCount: 1,
      }),
    );

    const card = vm.cards[0];
    expect(card?.label?.displayName).toBe("Job title");
    expect(card?.facts).toHaveLength(MAX_SUPPORTING_FACTS);
    expect(card?.facts.map((fact) => fact.displayName)).toEqual([
      "Crew",
      "Note",
      "Reference",
    ]);
  });

  it("skips blank and missing values when choosing what to show", () => {
    const vm = selectRecordsListVm(
      tableView(fields),
      page({
        records: [
          summary([
            { fieldId: "f-title", value: { kind: "missing" } },
            { fieldId: "f-crew", value: { kind: "blank" } },
            { fieldId: "f-note", value: { kind: "text", text: "Valve" } },
          ]),
        ],
        totalCount: 1,
      }),
    );
    expect(vm.cards[0]?.label?.displayName).toBe("Note");
  });

  it("reports the TABLE's count on a search page, not a match count", () => {
    const vm = selectRecordsListVm(
      tableView(fields),
      page({
        scope: { kind: "search", text: "patio" },
        records: [
          summary([
            { fieldId: "f-title", value: { kind: "text", text: "Patio" } },
          ]),
        ],
        hasMore: true,
        nextCursor: 11,
        totalCount: 248,
      }),
    );

    expect(vm.tableRecordCount).toBe(248);
    expect(vm.isTableRecordCountExact).toBe(true);
    expect(vm.scope).toEqual({ kind: "search", text: "patio" });
    expect(vm.announcement).toContain("The table contains 248 records.");

    // A match count is not answerable, so no field may hold one.
    type ForbiddenKey = Extract<
      keyof RecordsListVm,
      "matchCount" | "resultCount" | "totalMatches"
    >;
    const noForbiddenKeys: ForbiddenKey extends never ? true : false = true;
    expect(noForbiddenKeys).toBe(true);
  });

  it("keeps an empty table and a no-result search distinct (STA-025)", () => {
    const emptyTable = selectRecordsListVm(tableView(fields), page());
    expect(emptyTable.emptiness).toBe("empty-table");
    expect(emptyTable.screen).toBe("SCR-026");
    expect(emptyTable.announcement).toBe("Jobs contains no records yet.");

    const noResults = selectRecordsListVm(
      tableView(fields),
      page({ scope: { kind: "search", text: "payroll" }, totalCount: 248 }),
    );
    expect(noResults.emptiness).toBe("no-results");
    expect(noResults.announcement).toBe(
      "No record in Jobs matches “payroll”. The table contains 248 records.",
    );
  });
});

describe("the record detail (SCR-027)", () => {
  const fields = [
    fieldView({ fieldId: "f-title", displayName: "Job", fieldOrdinal: 0 }),
    fieldView({
      fieldId: "f-phone",
      displayName: "Contact",
      fieldOrdinal: 1,
      type: { kind: "phone" },
    }),
    fieldView({
      fieldId: "f-addr",
      displayName: "Site address",
      fieldOrdinal: 2,
      type: { kind: "address" },
    }),
    fieldView({
      fieldId: "f-amount",
      displayName: "Estimate",
      fieldOrdinal: 3,
      type: { kind: "currency", currencyCode: "USD" },
    }),
  ];

  function detail(
    values: readonly CellWireEntryV1[],
    overrides: Partial<RecordDetailViewV1> = {},
  ): RecordDetailViewV1 {
    return {
      ...summary(values),
      createdCommitId: "c-1",
      updatedCommitId: "c-2",
      issues: [],
      indexedFieldIds: ["f-title"],
      ...overrides,
    };
  }

  it("offers a dial href and a maps query, but never a maps URL", () => {
    const vm = selectRecordDetailVm(
      tableView(fields),
      detail([
        { fieldId: "f-title", value: { kind: "text", text: "Patio" } },
        {
          fieldId: "f-phone",
          value: { kind: "text", text: "+1 (312) 555-0148" },
        },
        {
          fieldId: "f-addr",
          value: { kind: "text", text: "730 N Franklin St" },
        },
      ]),
    );

    const byId = new Map(vm.fields.map((field) => [field.fieldId, field]));
    expect(byId.get("f-phone")?.handoff).toEqual({
      kind: "dial",
      href: "tel:+13125550148",
    });
    // The scheme for a textual address is M51's decision, not this module's.
    expect(byId.get("f-addr")?.handoff).toEqual({
      kind: "maps",
      query: "730 N Franklin St",
    });
  });

  it("keeps a preserved invalid value visible, verbatim (FR-4/FR-6)", () => {
    const vm = selectRecordDetailVm(
      tableView(fields),
      detail(
        [{ fieldId: "f-amount", value: { kind: "invalid", sourceText: "TBD" } }],
        {
          warningIssueCount: 1,
          issues: [
            {
              fieldId: "f-amount",
              kind: "type",
              severity: "warning",
              messageKey: "validation.preserved-invalid",
              messageParameters: {},
            },
          ],
        },
      ),
    );

    const amount = vm.fields.find((field) => field.fieldId === "f-amount");
    expect(amount?.value).toEqual({
      kind: "invalid-preserved",
      sourceText: "TBD",
    });
    expect(amount?.issues[0]?.token).toBe("preserved-invalid");
  });

  it("draws no relationship section for a value-only table (STA-025)", () => {
    const vm = selectRecordDetailVm(
      tableView(fields),
      detail([{ fieldId: "f-title", value: { kind: "text", text: "Patio" } }]),
    );
    expect(vm.belongsTo).toEqual([]);
    expect(vm.hasMany).toEqual([]);
    expect(vm.missing).toEqual([]);
  });

  it.each([
    [0, 0, "One record in Jobs."],
    [0, 1, "One record in Jobs. 1 value needs attention."],
    [1, 1, "One record in Jobs. 2 values need attention."],
  ])(
    "announces %i blocking + %i warning in agreeing words (M37 plural fix)",
    (blocking, warning, expected) => {
      const vm = selectRecordDetailVm(
        tableView(fields),
        detail([], { blockingIssueCount: blocking, warningIssueCount: warning }),
      );
      expect(vm.announcement).toBe(expected);
    },
  );

  it("marks which fields the projection could index", () => {
    const vm = selectRecordDetailVm(
      tableView(fields),
      detail([
        { fieldId: "f-title", value: { kind: "text", text: "Patio" } },
        { fieldId: "f-phone", value: { kind: "text", text: "555" } },
      ]),
    );
    const byId = new Map(vm.fields.map((field) => [field.fieldId, field]));
    expect(byId.get("f-title")?.isIndexed).toBe(true);
    expect(byId.get("f-phone")?.isIndexed).toBe(false);
  });
});

describe("handoffs", () => {
  it("refuses a non-http scheme rather than making it an href", () => {
    expect(
      handoffFor({ kind: "url" }, {
        kind: "text",
        text: "javascript:alert(1)",
      }),
    ).toBeNull();
    expect(
      handoffFor({ kind: "url" }, { kind: "text", text: "https://example.com/x" }),
    ).toEqual({ kind: "open-url", href: "https://example.com/x" });
  });

  it("refuses a phone value that is not dialable", () => {
    expect(
      handoffFor({ kind: "phone" }, { kind: "text", text: "call the office" }),
    ).toBeNull();
  });

  it("offers nothing for an absent value", () => {
    expect(handoffFor({ kind: "phone" }, { kind: "missing" })).toBeNull();
    expect(handoffFor({ kind: "address" }, { kind: "blank" })).toBeNull();
  });
});

describe("the per-type input mapping (FR-12)", () => {
  const cases: readonly [FieldTypeWireV1, Record<string, unknown>][] = [
    [{ kind: "text" }, { kind: "text", control: "text", keyboard: "text" }],
    [
      { kind: "number" },
      { kind: "number", control: "number", keyboard: "decimal" },
    ],
    [
      { kind: "currency", currencyCode: "USD" },
      {
        kind: "currency",
        control: "currency",
        keyboard: "decimal",
        currencyCode: "USD",
      },
    ],
    [{ kind: "date" }, { kind: "date", control: "native-date-picker" }],
    [{ kind: "boolean" }, { kind: "boolean", control: "switch" }],
    [
      { kind: "email" },
      { kind: "email", control: "text", keyboard: "email" },
    ],
    [{ kind: "url" }, { kind: "url", control: "text", keyboard: "url" }],
    [{ kind: "phone" }, { kind: "phone", control: "text", keyboard: "tel" }],
    [
      { kind: "address" },
      { kind: "address", control: "text", keyboard: "text", handoff: "maps" },
    ],
  ];

  it.each(cases)("maps %j to its control and keyboard", (type, expected) => {
    expect(inputForField(fieldView({ type }))).toEqual(expected);
  });

  it("offers an enum as a sheet of its active options only", () => {
    const input = inputForField(
      fieldView({
        type: { kind: "enum" },
        enumOptions: [
          { optionId: "o-1", label: "Scheduled", optionOrdinal: 0, isActive: true },
          { optionId: "o-2", label: "Retired", optionOrdinal: 1, isActive: false },
        ],
      }),
    );
    expect(input).toEqual({
      kind: "enum",
      control: "option-sheet",
      options: [{ optionId: "o-1", label: "Scheduled" }],
    });
  });

  it("offers a reference as SHT-002's picker (CA-21 made it authorable)", () => {
    expect(inputForField(fieldView({ type: { kind: "reference" } }))).toEqual({
      kind: "reference",
      control: "reference-picker",
    });
  });
});

describe("the record form (SCR-028 / SCR-029)", () => {
  const table = tableView([
    fieldView({ fieldId: "f-title", isRequired: true }),
    fieldView({ fieldId: "f-due", displayName: "Due", fieldOrdinal: 1, type: { kind: "date" } }),
  ]);

  it("creates with no values and saves nothing yet", () => {
    const vm = selectRecordFormVm({ table });
    expect(vm.mode).toBe("create");
    expect(vm.screen).toBe("SCR-028");
    expect(vm.fields.every((field) => field.value === null)).toBe(true);
    expect(vm.canSave).toBe(true);
  });

  it("blocks the save and names the field at fault (D23)", () => {
    const vm = selectRecordFormVm({
      table,
      issues: [
        {
          fieldId: "f-title",
          kind: "required",
          severity: "blocking",
          messageKey: "validation.required",
          messageParameters: { field: "Job title" },
        },
      ],
    });

    expect(vm.canSave).toBe(false);
    const title = vm.fields.find((field) => field.fieldId === "f-title");
    expect(title?.issues[0]?.sentence).toBe(
      "This field needs a value before the record can be saved.",
    );
    expect(vm.announcement).toBe(
      "1 field must be corrected before this can be saved.",
    );
  });

  it("keeps a whole-record rule out of any single field", () => {
    const vm = selectRecordFormVm({
      table,
      issues: [
        {
          fieldId: null,
          kind: "record-rule",
          severity: "blocking",
          messageKey: "rule.finish-after-start",
          messageParameters: {},
        },
      ],
    });
    expect(vm.recordIssues).toHaveLength(1);
    expect(vm.recordIssues[0]?.token).toBe("unrecognised");
    expect(vm.fields.every((field) => field.issues.length === 0)).toBe(true);
  });
});

describe("command outcomes", () => {
  it("reads a commitId of null as a truthful no-op, never a failure", () => {
    const vm = toCommandOutcomeVm({
      outcome: "accepted",
      receipt: {
        recordId: "r-1",
        tableId: "t-jobs",
        recordRevision: 3,
        commitId: null,
        headRevision: null,
      },
    });

    expect(vm).toEqual({ kind: "no-op", recordId: "r-1", recordRevision: 3 });
    expect(announceRecordCommand(vm)).toBe(
      "No change was needed; this record already held those values.",
    );
  });

  it("confirms a write as local, never as synced", () => {
    const vm = toCommandOutcomeVm({
      outcome: "accepted",
      receipt: {
        recordId: "r-1",
        tableId: "t-jobs",
        recordRevision: 4,
        commitId: "c-9",
        headRevision: 7,
      },
    });

    expect(vm).toEqual({
      kind: "saved",
      recordId: "r-1",
      recordRevision: 4,
      commitId: "c-9",
    });
    const sentence = announceRecordCommand(vm);
    expect(sentence).toBe("Saved on this device.");
    expect(sentence).not.toMatch(/sync|backed up|uploaded/i);
  });

  it("relays a rejection as issues, not as an error kind (D23)", () => {
    const vm = toCommandOutcomeVm({
      outcome: "rejected",
      report: {
        isValid: false,
        issues: [
          {
            fieldId: "f-title",
            kind: "required",
            severity: "blocking",
            messageKey: "validation.required",
            messageParameters: {},
          },
        ],
      },
    });
    expect(vm.kind).toBe("rejected");
    expect(announceRecordCommand(vm)).toContain(
      "This field needs a value before the record can be saved.",
    );
  });

  it("names an unknown subject without guessing which one", () => {
    expect(
      toCommandOutcomeVm({ outcome: "unknown-subject", subject: "deleted-record" }),
    ).toEqual({ kind: "unknown-subject", subject: "deleted-record" });
  });

  it("never invents a sentence for a rule's own message key", () => {
    expect(
      toIssueVm({
        fieldId: null,
        kind: "record-rule",
        severity: "blocking",
        messageKey: "rule.something-a-workbook-declared",
        messageParameters: {},
      }).sentence,
    ).toBe("This value did not pass one of the table's own rules.");
  });
});

describe("the change history (SCR-032)", () => {
  function historyPage(
    overrides: Partial<ChangeHistoryPageViewV1> = {},
  ): ChangeHistoryPageViewV1 {
    return { entries: [], hasMore: false, nextCursor: null, ...overrides };
  }

  it.each([
    [1, "1 change since this app was last checkpointed."],
    [2, "2 changes since this app was last checkpointed."],
  ])("announces %i entries in agreeing words (M37 plural fix)", (count, expected) => {
    const entries = Array.from({ length: count }, (_, index) => ({
      eventId: `e-${String(index)}`,
      commitId: "c-1",
      eventKind: "record.patched",
      subjectKind: "record",
      subjectId: "r-1",
      wallTimeMs: 1,
      logicalCounter: index,
      recordRevision: 2,
      changedFieldIds: [],
      isRestorable: false,
    }));
    expect(selectChangeHistoryVm(historyPage({ entries })).announcement).toBe(expected);
  });

  it("names each entry's table, and says nothing for an app-level event", () => {
    const vm = selectChangeHistoryVm(
      historyPage({
        entries: [
          {
            eventId: "e-1",
            commitId: "c-1",
            eventKind: "record.created",
            subjectKind: "record",
            subjectId: "r-1",
            wallTimeMs: 1,
            logicalCounter: 1,
            recordRevision: 1,
            changedFieldIds: [],
            isRestorable: false,
            tableId: "t-jobs",
          },
          {
            eventId: "e-2",
            commitId: "c-2",
            eventKind: "theme.changed",
            subjectKind: "app",
            subjectId: "a-1",
            wallTimeMs: 2,
            logicalCounter: 2,
            recordRevision: null,
            changedFieldIds: [],
            isRestorable: false,
            tableId: null,
          },
        ],
      }),
      [tableView([])],
    );
    expect(vm.entries.map((entry) => [entry.tableId, entry.tableName])).toEqual([
      ["t-jobs", "Jobs"],
      [null, null],
    ]);
  });

  it("states its scope so a fresh app's empty log reads truthfully", () => {
    const vm = selectChangeHistoryVm(historyPage());
    expect(vm.scope).toBe("since-last-checkpoint");
    expect(vm.emptiness).toBe("no-changes-since-checkpoint");
    expect(vm.announcement).toBe(
      "No changes have been made since this app was last checkpointed.",
    );
    expect(vm.announcement).not.toMatch(/the app's history|since this app was created/i);
  });

  it("carries the restorable flag the entry itself supplies (FR-12)", () => {
    const vm = selectChangeHistoryVm(
      historyPage({
        entries: [
          {
            eventId: "e-1",
            commitId: "c-1",
            eventKind: "record.deleted",
            subjectKind: "record",
            subjectId: "r-9",
            wallTimeMs: 1_700_000_000_000,
            logicalCounter: 1,
            recordRevision: 2,
            changedFieldIds: [],
            isRestorable: true,
          },
        ],
      }),
    );

    expect(vm.entries[0]?.isRestorable).toBe(true);
    expect(selectRestoreRecordDialogVm(vm.entries[0]!)).toEqual({
      dialog: "MOD-010",
      recordId: "r-9",
      deletedAtEpochMs: 1_700_000_000_000,
      tableName: null,
      original: { kind: "reading" },
      validation: { kind: "checked-on-restore" },
      assurance:
        "Restore validates against the current schema before writing a new append-only event.",
      busy: false,
    });
  });
});

describe("the delete dialog (MOD-009)", () => {
  it("promises recovery, because D22 ships the surface that provides it", () => {
    const detail: RecordDetailVm = selectRecordDetailVm(
      tableView([fieldView()]),
      {
        ...summary([
          { fieldId: "f-title", value: { kind: "text", text: "Patio" } },
        ]),
        createdCommitId: "c-1",
        updatedCommitId: "c-2",
        issues: [],
        indexedFieldIds: [],
      },
    );

    expect(selectDeleteRecordDialogVm(detail)).toEqual({
      dialog: "MOD-009",
      recordId: "r-1",
      label: {
        fieldId: "f-title",
        displayName: "Job title",
        value: { kind: "text", text: "Patio" },
      },
      recoverable: true,
      assurance: "Deletes remain recoverable in change history.",
      busy: false,
    });
  });
});

// --- F03: relationships, references, switcher, MOD-010 (CAP-24, CA-21) -----

describe("reference cells (CA-21, D36, STA-011)", () => {
  const jobs: AppTableViewV1 = {
    ...tableView([
      fieldView({ fieldId: "f-job", displayName: "Job ID", fieldOrdinal: 0 }),
      fieldView({
        fieldId: "f-customer",
        displayName: "Customer ID",
        fieldOrdinal: 1,
        type: { kind: "reference" },
      }),
    ]),
  };
  const customers: AppTableViewV1 = {
    ...tableView([]),
    tableId: "t-customers",
    displayName: "Customers",
  };

  function jobDetail(
    customer: CellWireEntryV1["value"],
    references?: RecordDetailViewV1["references"],
  ): RecordDetailViewV1 {
    return {
      ...summary([
        { fieldId: "f-job", value: { kind: "text", text: "J-1016" } },
        { fieldId: "f-customer", value: customer },
      ]),
      createdCommitId: "c-1",
      updatedCommitId: "c-1",
      issues: [],
      indexedFieldIds: [],
      ...(references === undefined ? {} : { references }),
    };
  }

  it("reads a resolved reference as its parent's label, and names the parent's table", () => {
    const vm = selectRecordDetailVm(
      jobs,
      jobDetail({ kind: "reference", recordId: "r-c8" }),
      {
        tables: [jobs, customers],
        related: {
          parents: [
            {
              fieldId: "f-customer",
              relationshipId: "rel-1",
              status: "resolved",
              recordId: "r-c8",
              tableId: "t-customers",
              label: "Harbor View Inn",
            },
          ],
          children: [],
        },
      },
    );
    const customer = vm.fields.find((field) => field.fieldId === "f-customer");
    expect(customer?.value).toEqual({
      kind: "reference",
      reference: {
        kind: "resolved",
        recordId: "r-c8",
        tableId: "t-customers",
        label: "Harbor View Inn",
      },
    });
    expect(vm.belongsTo).toEqual([
      {
        fieldId: "f-customer",
        fieldName: "Customer ID",
        relationshipId: "rel-1",
        recordId: "r-c8",
        tableId: "t-customers",
        tableName: "Customers",
        label: "Harbor View Inn",
      },
    ]);
    expect(vm.missing).toEqual([]);
  });

  it("keeps an imported key that matched nothing as a broken reference with that key", () => {
    const vm = selectRecordDetailVm(
      jobs,
      jobDetail({ kind: "invalid", sourceText: "C-013" }, [
        {
          fieldId: "f-customer",
          relationshipId: "rel-1",
          status: "broken",
          originalKey: "C-013",
        },
      ]),
    );
    expect(vm.missing).toEqual([
      {
        kind: "broken",
        originalKey: "C-013",
        relationName: "Customer ID",
        fieldId: "f-customer",
        relationshipId: "rel-1",
      },
    ]);
    expect(vm.fields[1]?.value).toEqual({
      kind: "reference",
      reference: { kind: "broken", originalKey: "C-013", relationName: "Customer ID" },
    });
  });

  it("reads a deleted parent's key from the worker, and the authored text when the worker has none", () => {
    const deletedParent = selectRecordDetailVm(
      jobs,
      jobDetail({ kind: "reference", recordId: "r-gone" }, [
        { fieldId: "f-customer", relationshipId: "rel-1", status: "broken", originalKey: "C-008" },
      ]),
    );
    expect(deletedParent.missing[0]).toMatchObject({ kind: "broken", originalKey: "C-008" });

    const authoredOnly = selectRecordDetailVm(
      jobs,
      jobDetail({ kind: "invalid", sourceText: "C-099" }, [
        { fieldId: "f-customer", relationshipId: "rel-1", status: "broken", originalKey: null },
      ]),
    );
    expect(authoredOnly.missing[0]).toMatchObject({ kind: "broken", originalKey: "C-099" });

    const unkeyed = selectRecordDetailVm(
      jobs,
      jobDetail({ kind: "reference", recordId: "r-gone" }, [
        { fieldId: "f-customer", relationshipId: "rel-1", status: "broken", originalKey: null },
      ]),
    );
    expect(unkeyed.missing[0]).toMatchObject({ kind: "broken-unkeyed", relationName: "Customer ID" });
  });

  it("never takes the key from an issue parameter", () => {
    const vm = selectRecordDetailVm(
      jobs,
      {
        ...jobDetail({ kind: "invalid", sourceText: "C-013" }),
        issues: [
          {
            fieldId: "f-customer",
            kind: "reference",
            severity: "warning",
            messageKey: "validation.broken-reference",
            messageParameters: { key: "FROM-ISSUE" },
          },
        ],
      },
    );
    expect(JSON.stringify(vm.fields[1]?.value)).not.toContain("FROM-ISSUE");
    expect(vm.fields[1]?.value).toMatchObject({ reference: { originalKey: "C-013" } });
  });

  it("shows an unread reference as pending, never as a blank", () => {
    const list = selectRecordsListVm(
      jobs,
      {
        tableId: "t-jobs",
        scope: { kind: "table" },
        records: [
          summary([
            { fieldId: "f-job", value: { kind: "text", text: "J-1001" } },
            { fieldId: "f-customer", value: { kind: "reference", recordId: "r-c8" } },
          ]),
        ],
        hasMore: false,
        nextCursor: null,
        totalCount: 1,
        isTotalExact: true,
      },
    );
    expect(list.cards[0]?.facts[0]?.value).toEqual({
      kind: "reference",
      reference: { kind: "pending", recordId: "r-c8" },
    });
  });

  it("labels list references from the page's related reads", () => {
    const list = selectRecordsListVm(
      jobs,
      {
        tableId: "t-jobs",
        scope: { kind: "table" },
        records: [
          summary([
            { fieldId: "f-job", value: { kind: "text", text: "J-1001" } },
            { fieldId: "f-customer", value: { kind: "reference", recordId: "r-c8" } },
          ]),
        ],
        hasMore: false,
        nextCursor: null,
        totalCount: 1,
        isTotalExact: true,
      },
      new Map([
        [
          "r-1",
          [
            {
              fieldId: "f-customer",
              relationshipId: "rel-1",
              status: "resolved" as const,
              recordId: "r-c8",
              tableId: "t-customers",
              label: "Harbor View Inn",
            },
          ],
        ],
      ]),
    );
    expect(list.cards[0]?.facts[0]?.value).toMatchObject({
      reference: { kind: "resolved", label: "Harbor View Inn" },
    });
  });

  it("states an empty label in words (CTL-070)", () => {
    expect(toRecordLabel("  ")).toBe(UNLABELLED_RECORD);
    expect(toRecordLabel("Harbor View Inn")).toBe("Harbor View Inn");
  });

  it("holds both must-nots in the type", () => {
    // A broken reference cannot be built without its original key.
    // @ts-expect-error — `originalKey` is required on `broken`.
    const noKey: ReferenceCellVm = { kind: "broken", relationName: "Customer ID" };
    // @ts-expect-error — nor may it be null; the unkeyed case is its own member.
    const nullKey: ReferenceCellVm = { kind: "broken", originalKey: null, relationName: "x" };
    // An unresolved label cannot be a bare (possibly blank) string.
    const blank: ReferenceCellVm = {
      kind: "resolved",
      recordId: "r",
      tableId: "t",
      // @ts-expect-error — only `toRecordLabel` makes a `RecordLabelV1`.
      label: "",
    };
    expect([noKey, nullKey, blank]).toHaveLength(3);

    type BrokenKey = Extract<ReferenceCellVm, { kind: "broken" }>["originalKey"];
    const keyIsString: BrokenKey extends string ? (null extends BrokenKey ? false : true) : false =
      true;
    expect(keyIsString).toBe(true);
  });
});

describe("has many (record-detail.html)", () => {
  const group = {
    relationshipId: "rel-1",
    tableId: "t-jobs",
    tableName: "Jobs",
    count: 7,
    first: [
      { recordId: "r-1", label: "J-1001" },
      { recordId: "r-2", label: "" },
    ],
  };

  it("previews the first children with the exact count", () => {
    const vm = selectHasManyVm(group);
    expect(vm).toMatchObject({ count: 7, isExpanded: false, hasMore: true, nextCursor: null });
    expect(vm.shown.map((child) => child.label)).toEqual(["J-1001", UNLABELLED_RECORD]);
  });

  it("pages through every child once expanded", () => {
    const vm = selectHasManyVm(group, [
      {
        children: [
          { recordId: "r-1", label: "J-1001", cursor: 1 },
          { recordId: "r-2", label: "J-1002", cursor: 2 },
        ],
        hasMore: true,
        nextCursor: 2,
      },
      { children: [{ recordId: "r-3", label: "J-1003", cursor: 3 }], hasMore: false, nextCursor: null },
    ]);
    expect(vm.shown.map((child) => child.recordId)).toEqual(["r-1", "r-2", "r-3"]);
    expect(vm).toMatchObject({ isExpanded: true, hasMore: false, nextCursor: null });
  });
});

describe("the reference picker (SHT-002)", () => {
  const current: ReferenceCellVm = {
    kind: "resolved",
    recordId: "r-c8",
    tableId: "t-customers",
    label: toRecordLabel("Harbor View Inn"),
  };

  it("marks the current choice among the candidates", () => {
    const vm = selectReferencePickerVm({
      fieldName: "Customer ID",
      query: "",
      current,
      candidates: [
        { recordId: "r-c1", label: "Alder Court HOA" },
        { recordId: "r-c8", label: "Harbor View Inn" },
      ],
    });
    expect(vm.candidates.map((candidate) => candidate.isCurrent)).toEqual([false, true]);
    expect(vm.emptiness).toBeNull();
  });

  it("keeps its three empties distinct", () => {
    const base = { fieldName: "Customer ID", current: null };
    expect(selectReferencePickerVm({ ...base, query: "", candidates: [] }).emptiness).toBe(
      "no-candidates",
    );
    expect(selectReferencePickerVm({ ...base, query: "zzz", candidates: [] }).emptiness).toBe(
      "no-results",
    );
    expect(selectReferencePickerVm({ ...base, query: "", candidates: null }).emptiness).toBe(
      "not-a-relationship",
    );
  });
});

describe("the table switcher (SHT-003)", () => {
  it("lists tables in order with exact counts and marks the current one", () => {
    const jobs = { ...tableView([]), recordCount: 60 };
    const customers = {
      ...tableView([]),
      tableId: "t-customers",
      displayName: "Customers",
      tableOrdinal: 1,
      recordCount: 12,
    };
    const vm = selectTableSwitcherVm([customers, jobs], "t-customers");
    expect(vm.tables.map((table) => [table.displayName, table.recordCount, table.isCurrent])).toEqual([
      ["Jobs", 60, false],
      ["Customers", 12, true],
    ]);
    expect(vm.current?.tableId).toBe("t-customers");
    expect(selectTableSwitcherVm([jobs], null).current).toBeNull();
  });
});

describe("MOD-010 with the deleted record's own values", () => {
  const table = tableView([
    fieldView({ fieldId: "f-title", displayName: "Job", fieldOrdinal: 0 }),
    fieldView({ fieldId: "f-status", displayName: "Status", fieldOrdinal: 1 }),
  ]);
  const entry = {
    eventId: "e-1",
    commitId: "c-1",
    eventKind: "record.deleted",
    subjectKind: "record",
    subjectId: "r-9",
    wallTimeMs: 1_700_000_000_000,
    logicalCounter: 1,
    recordRevision: 2,
    changedFieldIds: [],
    isRestorable: true,
    tableId: "t-jobs",
    tableName: "Jobs",
  };

  it("shows the original values in field order, and the delete's own time", () => {
    const vm = selectRestoreRecordDialogVm(entry, {
      table,
      deleted: {
        recordId: "r-9",
        tableId: "t-jobs",
        values: [
          { fieldId: "f-status", value: { kind: "text", text: "Complete" } },
          { fieldId: "f-title", value: { kind: "text", text: "Patio" } },
        ],
        deletedEventId: "e-1",
        deletedAtEpochMs: 1_700_000_000_500,
        keyValue: null,
      },
    });
    expect(vm.deletedAtEpochMs).toBe(1_700_000_000_500);
    expect(vm.tableName).toBe("Jobs");
    expect(vm.original).toEqual({
      kind: "values",
      facts: [
        { fieldId: "f-title", displayName: "Job", value: { kind: "text", text: "Patio" } },
        { fieldId: "f-status", displayName: "Status", value: { kind: "text", text: "Complete" } },
      ],
    });
    expect(vm.validation).toEqual({ kind: "checked-on-restore" });
  });

  it("says when there is nothing to show, and carries a refusal as its issues", () => {
    const vm = selectRestoreRecordDialogVm(entry, {
      table,
      deleted: null,
      rejection: [
        {
          fieldId: "f-status",
          kind: "value",
          severity: "blocking",
          messageKey: "validation.required",
          messageParameters: {},
        },
      ],
    });
    expect(vm.original).toEqual({ kind: "unavailable" });
    expect(vm.validation).toMatchObject({ kind: "rejected", issues: [{ token: "required" }] });
  });
});

describe("the app home announcement (M37 plural fix)", () => {
  it.each([
    [1, "Field Log is on this device only. 1 change has no durable copy."],
    [3, "Field Log is on this device only. 3 changes have no durable copy."],
  ])("with %i device-only changes", (count, expected) => {
    const session: AppSessionViewV1 = {
      appId: "a-1",
      displayName: "Field Log",
      theme: {
        themeKey: "k",
        tokens: {
          "app-ink": "#000",
          "app-canvas": "#fff",
          "app-surface": "#fff",
          "app-primary": "#000",
          "app-accent": "#000",
          "app-muted": "#eee",
        },
      },
      schemaRevision: 1,
      createdAtEpochMs: 1,
      lastOpenedAtEpochMs: null,
      isScratch: true,
      deviceOnlyChangeCount: count,
      tables: [],
    };
    expect(selectAppHomeVm(session).announcement).toBe(expected);
  });
});
