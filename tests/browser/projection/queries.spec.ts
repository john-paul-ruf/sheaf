import { expect, test, type Page } from "@playwright/test";

/**
 * The read surface, through `executeQuery` only — the same closed union S05
 * will call. No raw SQL here: this file is about what a consumer can ask and
 * what it truthfully gets back.
 *
 * The paging proof is the one worth reading twice. A page is taken, then a
 * record is created *and another deleted* underneath, then the next page is
 * taken from the previous page's cursor. With `OFFSET` paging the delete would
 * silently skip a record; with a `record_pk` boundary nothing is skipped and
 * nothing repeats, which is what CA-14 means by a stable page boundary.
 */

type CheckpointV1 =
  import("../../../src/persistence/projection/types.js").ProjectionCheckpointV1;
type ProjectionCommitV1 =
  import("../../../src/persistence/projection/types.js").ProjectionCommitV1;
type FieldDefV1 = import("../../../src/domain/model/schema.js").FieldDefV1;
type FieldTypeV1 = import("../../../src/domain/model/schema.js").FieldTypeV1;
type CellValueV1 = import("../../../src/domain/model/values.js").CellValueV1;
type FieldId = import("../../../src/domain/model/ids.js").FieldId;
type AppThemeTokenV1 =
  import("../../../src/domain/model/events.js").AppThemeTokenV1;
type DomainEventV1 =
  import("../../../src/migrations/004_event_format_v1.js").DomainEventV1;
type EventCommitBodyV1 =
  import("../../../src/persistence/codecs/event-commit.js").EventCommitBodyV1;

interface PageResult {
  readonly records: readonly string[];
  readonly hasMore: boolean;
  readonly nextRecordPk: number | null;
}

interface QueryReport {
  readonly appState: { name: string; themeKey: string; schemaRevision: number };
  readonly tables: readonly string[];
  readonly fields: readonly string[];
  readonly options: readonly string[];
  readonly rules: readonly string[];
  readonly countBefore: number;
  readonly countAfter: number;
  readonly firstPage: PageResult;
  readonly secondPage: PageResult;
  readonly wholeTable: readonly string[];
  readonly searchInvoices: readonly string[];
  readonly searchClients: readonly string[];
  readonly searchDeleted: readonly string[];
  readonly searchNoWords: PageResult;
  readonly detail: {
    readonly recordId: string;
    readonly revision: string;
    readonly authored: readonly string[];
    readonly cells: readonly string[];
    readonly issues: readonly string[];
  } | null;
  readonly missingRecord: string;
  readonly historyFirst: readonly string[];
  readonly historyNext: readonly string[];
  readonly historyHasMore: boolean;
  readonly recordHistory: readonly string[];
  readonly refusedLimits: readonly string[];
}

async function runQueries(): Promise<QueryReport> {
  const harness = window.__sheafHarness;
  const [projection, ids, bytesModule, values, events, codec, hash] =
    await Promise.all([
      harness.module<typeof import("../../../src/persistence/projection/index.js")>(
        "/src/persistence/projection/index.ts",
      ),
      harness.module<typeof import("../../../src/domain/model/ids.js")>(
        "/src/domain/model/ids.ts",
      ),
      harness.module<typeof import("../../../src/domain/model/bytes.js")>(
        "/src/domain/model/bytes.ts",
      ),
      harness.module<typeof import("../../../src/domain/model/values.js")>(
        "/src/domain/model/values.ts",
      ),
      harness.module<typeof import("../../../src/domain/model/events.js")>(
        "/src/domain/model/events.ts",
      ),
      harness.module<typeof import("../../../src/persistence/codecs/event-commit.js")>(
        "/src/persistence/codecs/event-commit.ts",
      ),
      harness.module<typeof import("../../../src/crypto/hash.js")>(
        "/src/crypto/hash.ts",
      ),
    ]);

  const bytes = (fill: number): Uint8Array => new Uint8Array(16).fill(fill);
  const hex = (value: Uint8Array): string =>
    [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  const appId = ids.asDomainId("app", bytes(1));
  const invoices = ids.asDomainId("table", bytes(2));
  const clients = ids.asDomainId("table", bytes(3));
  const deviceId = bytes(4);
  const genesisCommit = ids.asDomainId("commit", bytes(5));
  const ruleId = ids.asDomainId("rule", bytes(6));

  const field = (
    fill: number,
    tableId: typeof invoices,
    displayName: string,
    fieldOrdinal: number,
    type: FieldTypeV1,
  ): FieldDefV1 => ({
    fieldId: ids.asDomainId("field", bytes(fill)),
    tableId,
    displayName,
    fieldOrdinal,
    type,
    isRequired: false,
    isActive: true,
    schemaRevision: 1n,
  });

  const nameField = field(0x10, invoices, "Name", 0, { kind: "text" });
  const amountField = field(0x11, invoices, "Amount", 1, {
    kind: "currency",
    currencyCode: "EUR",
  });
  const statusField = field(0x12, invoices, "Status", 2, { kind: "enum" });
  const clientField = field(0x13, clients, "Client", 0, { kind: "text" });
  const optionOpen = ids.asDomainId("option", bytes(0x14));

  const record = (
    fill: number,
    tableId: typeof invoices,
    entries: readonly (readonly [FieldId, CellValueV1])[],
    issues: readonly {
      fieldId: FieldId;
      ruleId: null;
      kind: "type";
      severity: "warning";
      messageKey: string;
      messageParameters: Record<string, string>;
    }[] = [],
  ) => ({
    record: {
      recordId: ids.asDomainId("record", bytes(fill)),
      tableId,
      values: new Map(entries),
      provenance: new Map(),
    },
    recordRevision: 0n,
    createdCommitId: genesisCommit,
    updatedCommitId: genesisCommit,
    issues,
  });

  const checkpoint: CheckpointV1 = {
    appId,
    checkpointStorageId: bytesModule.asStorageId16(bytes(7)),
    checkpointSemanticSha256: new Uint8Array(32).fill(8),
    frontier: [{ deviceId, commitSequence: 1n }],
    hydratedAtMs: 1_700_000_000_000,
    appState: {
      appId,
      displayName: "Invoices",
      createdAtMs: 1_699_000_000_000,
      lastOpenedAtMs: null,
      schemaRevision: 1n,
      locality: "present",
      durableHomeId: null,
      lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 0,
      theme: {
        themeKey: "sheaf.built-in.slate",
        tokens: Object.fromEntries(
          events.APP_THEME_TOKENS.map((token) => [token, "#101010"]),
        ) as Record<AppThemeTokenV1, string>,
      },
      stateRevision: 0n,
    },
    sheetSnapshots: [],
    tables: [
      {
        tableId: invoices,
        displayName: "Invoices",
        tableOrdinal: 0,
        fields: [nameField, amountField, statusField],
        keyFieldId: null,
        labelFieldId: nameField.fieldId,
        sourceSheetId: null,
        isActive: true,
        schemaRevision: 1n,
      },
      {
        tableId: clients,
        displayName: "Clients",
        tableOrdinal: 1,
        fields: [clientField],
        keyFieldId: null,
        labelFieldId: clientField.fieldId,
        sourceSheetId: null,
        isActive: true,
        schemaRevision: 1n,
      },
    ],
    enumOptions: [
      {
        optionId: optionOpen,
        fieldId: statusField.fieldId,
        displayLabel: "Open",
        optionOrdinal: 0,
        isActive: true,
        schemaRevision: 1n,
      },
    ],
    validationRules: [
      {
        tableId: invoices,
        displayName: "An invoice needs an amount",
        rule: {
          irVersion: 1,
          ruleId,
          condition: { kind: "field-present", fieldId: amountField.fieldId },
          severity: "blocking",
          messageKey: "rule.amount-required",
          messageParameters: { fieldLabel: "Amount" },
        },
        isActive: true,
        schemaRevision: 1n,
      },
    ],
    recordPages: [
      {
        records: [
          record(0x41, invoices, [
            [nameField.fieldId, values.textValue("Ada Lovelace")],
            [amountField.fieldId, values.decimalValue("10.50")],
            [statusField.fieldId, values.enumValue(optionOpen)],
          ]),
          record(
            0x42,
            invoices,
            [
              [nameField.fieldId, values.textValue("Grace Hopper")],
              [amountField.fieldId, values.invalidPreservedValue("twelve euros")],
              [statusField.fieldId, values.MISSING_VALUE],
            ],
            [
              {
                fieldId: amountField.fieldId,
                ruleId: null,
                kind: "type",
                severity: "warning",
                messageKey: "validation.preserved-invalid",
                messageParameters: { fieldLabel: "Amount" },
              },
            ],
          ),
          record(0x43, invoices, [
            [nameField.fieldId, values.textValue("Katherine Johnson")],
          ]),
          record(0x44, invoices, [
            [nameField.fieldId, values.textValue("Dorothy Vaughan")],
          ]),
          record(0x45, clients, [
            [clientField.fieldId, values.textValue("Ada Lovelace")],
          ]),
        ],
      },
    ],
  };

  const handle = await projection.openProjection({ sha256: hash.sha256 });
  await projection.hydrateApp(handle, checkpoint);

  const countInvoices = () =>
    projection.executeQuery(handle, {
      kind: "count-records",
      tableId: invoices,
    });

  const pageOf = (afterRecordPk: number | null, limit: number): PageResult => {
    const page = projection.executeQuery(handle, {
      kind: "page-records",
      tableId: invoices,
      afterRecordPk,
      limit,
    });
    return {
      records: page.records.map(
        (row) => `${row.recordPk}:${hex(row.recordId)}`,
      ),
      hasMore: page.hasMore,
      nextRecordPk: page.nextRecordPk,
    };
  };

  const searchIn = (tableId: typeof invoices, text: string): string[] =>
    projection
      .executeQuery(handle, {
        kind: "search-records",
        tableId,
        text,
        afterRecordPk: null,
        limit: 10,
      })
      .records.map((row) => `${row.recordPk}:${hex(row.recordId)}`);

  const appState = projection.executeQuery(handle, { kind: "app-state" });
  const tables = projection.executeQuery(handle, { kind: "list-tables" });
  const fields = projection.executeQuery(handle, {
    kind: "list-fields",
    tableId: invoices,
  });
  const options = projection.executeQuery(handle, {
    kind: "list-enum-options",
    fieldId: statusField.fieldId,
  });
  const rules = projection.executeQuery(handle, {
    kind: "list-validation-rules",
    tableId: invoices,
  });

  const countBefore = countInvoices();
  const firstPage = pageOf(null, 2);

  // Two commits land between the two pages: one creates a record, one deletes
  // a record that would have been on the next page.
  const tail: ProjectionCommitV1[] = [];
  let previousSha: Uint8Array = new Uint8Array(32).fill(9);
  const tailEvents = [
    {
      kind: "record.created" as const,
      payload: {
        record: {
          recordId: ids.asDomainId("record", bytes(0x46)),
          tableId: invoices,
          values: new Map([
            [nameField.fieldId, values.textValue("Mary Jackson")],
          ]),
          provenance: new Map(),
        },
        importedInvalid: false,
      },
      subject: {
        appId,
        tableId: invoices,
        recordId: ids.asDomainId("record", bytes(0x46)),
      },
    },
    {
      kind: "record.deleted" as const,
      payload: {
        recordId: ids.asDomainId("record", bytes(0x44)),
        tableId: invoices,
        priorRecordRevision: 0n,
        restoration: {
          recordId: ids.asDomainId("record", bytes(0x44)),
          tableId: invoices,
          values: new Map([
            [nameField.fieldId, values.textValue("Dorothy Vaughan")],
          ]),
          provenance: new Map(),
        },
        source: "user" as const,
      },
      subject: {
        appId,
        tableId: invoices,
        recordId: ids.asDomainId("record", bytes(0x44)),
      },
    },
  ];

  for (const [index, event] of tailEvents.entries()) {
    const wire: DomainEventV1 = {
      eventId: bytes(0x50 + index),
      eventIndex: 0,
      kind: event.kind,
      subject: event.subject,
      payload: new Map<string, string>([["kind", event.kind]]),
      provenance: { source: "user" },
    };
    const body: EventCommitBodyV1 = {
      eventFormatVersion: 1,
      commitId: bytes(0x60 + index),
      appId,
      deviceId,
      deviceCommitSequence: BigInt(index + 2),
      previousDeviceCommitSha256: previousSha,
      basisFrontier: [{ deviceId, commitSequence: BigInt(index + 1) }],
      hybridTime: {
        wallTimeMs: 1_700_000_100_000n + BigInt(index) * 1_000n,
        logicalCounter: 0,
      },
      eventClass: "authored",
      schemaRevisionBefore: 1n,
      schemaRevisionAfter: 1n,
      events: [wire],
    };
    const sealed = await codec.sealEventCommit(body, hash.sha256);
    previousSha = sealed.commitSha256;
    tail.push({ commit: sealed, events: [event] });
  }

  await projection.applyEvents(handle, tail);

  const secondPage = pageOf(firstPage.nextRecordPk, 2);
  const countAfter = countInvoices();
  const wholeTable = pageOf(null, 100).records;

  const detailRow = projection.executeQuery(handle, {
    kind: "record-by-id",
    recordId: ids.asDomainId("record", bytes(0x42)),
  });

  const historyPage = projection.executeQuery(handle, {
    kind: "page-change-history",
    after: null,
    limit: 1,
  });
  const historyNextPage = projection.executeQuery(handle, {
    kind: "page-change-history",
    after: historyPage.nextCursor,
    limit: 5,
  });
  const recordHistory = projection.executeQuery(handle, {
    kind: "record-change-history",
    recordId: ids.asDomainId("record", bytes(0x44)),
    limit: 10,
  });

  const refusedLimits = [0, -1, 5000].map((limit) => {
    try {
      pageOf(null, limit);
      return "accepted";
    } catch (cause) {
      return String(cause);
    }
  });

  // An unknown record is answered with null, not with an empty-looking record.
  const missingRecord =
    projection.executeQuery(handle, {
      kind: "record-by-id",
      recordId: ids.asDomainId("record", bytes(0xfe)),
    }) === null
      ? "null"
      : "a record";

  const report: QueryReport = {
    appState: {
      name: appState.displayName,
      themeKey: appState.theme.themeKey,
      schemaRevision: Number(appState.schemaRevision),
    },
    tables: tables.map((table) => `${table.tableOrdinal}:${table.displayName}`),
    fields: fields.map(
      (definition) =>
        `${definition.fieldOrdinal}:${definition.displayName}:${definition.type.kind}:${
          definition.type.kind === "currency" ? definition.type.currencyCode : "-"
        }`,
    ),
    options: options.map((option) => `${option.optionOrdinal}:${option.displayLabel}`),
    rules: rules.map(
      (rule) => `${rule.displayName}:${rule.rule.condition.kind}:${rule.rule.severity}`,
    ),
    countBefore,
    countAfter,
    firstPage,
    secondPage,
    wholeTable,
    searchInvoices: searchIn(invoices, "Lovelace"),
    searchClients: searchIn(clients, "Lovelace"),
    searchDeleted: searchIn(invoices, "Dorothy"),
    searchNoWords: (() => {
      const page = projection.executeQuery(handle, {
        kind: "search-records",
        tableId: invoices,
        text: "  *  ",
        afterRecordPk: null,
        limit: 10,
      });
      return {
        records: page.records.map((row) => String(row.recordPk)),
        hasMore: page.hasMore,
        nextRecordPk: page.nextRecordPk,
      };
    })(),
    detail:
      detailRow === null
        ? null
        : {
            recordId: hex(detailRow.recordId),
            revision: String(detailRow.recordRevision),
            authored: [...detailRow.authoredValues].map(
              ([fieldId, value]) => `${hex(fieldId)}:${value.kind}`,
            ),
            cells: detailRow.cells.map(
              (cell) =>
                `${hex(cell.fieldId)}:${cell.valueKind}:${
                  cell.textValue ?? cell.decimalValue ?? "-"
                }`,
            ),
            issues: detailRow.issues.map(
              (issue) => `${issue.severity}:${issue.messageKey}`,
            ),
          },
    missingRecord,
    historyFirst: historyPage.events.map(
      (item) => `${item.eventKind}:${item.subjectKind}:${hex(item.subjectId)}`,
    ),
    historyNext: historyNextPage.events.map((item) => item.eventKind),
    historyHasMore: historyPage.hasMore,
    recordHistory: recordHistory.map(
      (item) =>
        `${item.eventKind}:${item.restoration === null ? "no-restoration" : "restorable"}`,
    ),
    refusedLimits,
  };

  projection.disposeProjection(handle);
  return report;
}

let page: Page;
let report: QueryReport;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto("/harness.html");
  report = await page.evaluate(runQueries);
});

test.afterAll(async () => {
  await page.close();
});

test("answers the app's identity, schema, and rules from its own rows", () => {
  expect(report.appState).toEqual({
    name: "Invoices",
    themeKey: "sheaf.built-in.slate",
    schemaRevision: 1,
  });
  expect(report.tables).toEqual(["0:Invoices", "1:Clients"]);
  expect(report.fields).toEqual([
    "0:Name:text:-",
    // The currency code survives the round trip through the projection.
    "1:Amount:currency:EUR",
    "2:Status:enum:-",
  ]);
  expect(report.options).toEqual(["0:Open"]);
  expect(report.rules).toEqual([
    "An invoice needs an amount:field-present:blocking",
  ]);
});

test("CA-14: an exact count comes from count(*), and only from there", () => {
  // Four invoices, then one created and one deleted.
  expect(report.countBefore).toBe(4);
  expect(report.countAfter).toBe(4);
  // A page never claims a total; it says whether more exist.
  expect(report.firstPage.hasMore).toBe(true);
});

test("CA-14: a page boundary survives writes between the pages", () => {
  expect(report.firstPage.records).toEqual([
    `1:${"41".repeat(16)}`,
    `2:${"42".repeat(16)}`,
  ]);
  expect(report.firstPage.nextRecordPk).toBe(2);

  // Between the pages, record 0x46 was created and 0x44 deleted. The second
  // page continues from row key 2: no record is skipped, none repeats, and the
  // record created after the first page appears in its own position.
  expect(report.secondPage.records).toEqual([
    `3:${"43".repeat(16)}`,
    `6:${"46".repeat(16)}`,
  ]);
  expect(report.secondPage.hasMore).toBe(false);
  expect(report.wholeTable).toEqual([
    `1:${"41".repeat(16)}`,
    `2:${"42".repeat(16)}`,
    `3:${"43".repeat(16)}`,
    `6:${"46".repeat(16)}`,
  ]);
});

test("search returns candidates joined back to their own table", () => {
  // The same name exists in both tables; each search sees only its own.
  expect(report.searchInvoices).toEqual([`1:${"41".repeat(16)}`]);
  expect(report.searchClients).toEqual([`5:${"45".repeat(16)}`]);
  // A deleted record leaves the index with its row.
  expect(report.searchDeleted).toEqual([]);
  // Text with no words matches nothing rather than everything.
  expect(report.searchNoWords).toEqual({
    records: [],
    hasMore: false,
    nextRecordPk: null,
  });
});

test("CA-13(c): a record's detail carries authored values, cells, and issues", () => {
  const amount = "11".repeat(16);
  const name = "10".repeat(16);
  const status = "12".repeat(16);

  expect(report.detail?.recordId).toBe("42".repeat(16));
  // The preserved invalid value and the missing one are both readable, and
  // still distinct from each other.
  expect(report.detail?.authored).toEqual([
    `${name}:text`,
    `${amount}:invalid-preserved`,
    `${status}:missing`,
  ]);
  // Only the value that fits a lane has a cell.
  expect(report.detail?.cells).toEqual([`${name}:text:Grace Hopper`]);
  expect(report.detail?.issues).toEqual([
    "warning:validation.preserved-invalid",
  ]);
  expect(report.missingRecord).toBe("null");
});

test("pages change history newest first, and keeps a delete recoverable", () => {
  expect(report.historyFirst).toEqual([
    `record.deleted:record:${"44".repeat(16)}`,
  ]);
  expect(report.historyHasMore).toBe(true);
  expect(report.historyNext).toEqual(["record.created"]);
  // MOD-010's restore has something to restore from (FR-12 / CAP-17).
  expect(report.recordHistory).toEqual(["record.deleted:restorable"]);
});

test("refuses an unbounded or nonsensical page size", () => {
  for (const refusal of report.refusedLimits) {
    expect(refusal).toContain("page size is outside the bounded range");
  }
});
