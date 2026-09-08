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
  selectRestoreRecordDialogVm,
  toCommandOutcomeVm,
  toIssueVm,
  type AppHomeVm,
  type RecordDetailVm,
  type RecordsListVm,
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

  it("has no relationships section to fill (D25)", () => {
    type ForbiddenKey = Extract<
      keyof RecordDetailVm,
      "relationships" | "relatedRecords" | "belongsTo" | "hasMany"
    >;
    const noForbiddenKeys: ForbiddenKey extends never ? true : false = true;
    expect(noForbiddenKeys).toBe(true);
  });

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

  it("shows a reference read-only rather than offering a picker (D25)", () => {
    expect(inputForField(fieldView({ type: { kind: "reference" } }))).toEqual({
      kind: "unsupported",
      control: "read-only",
      reason: "reference-fields-arrive-in-a-later-release",
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
      "1 fields must be corrected before this can be saved.",
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
