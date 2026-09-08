import { expect, test, type Page } from "@playwright/test";

/**
 * CA-13's authority: the projection engine on real SQLite, in a real browser,
 * from built output (D8/D11 — node results are extra coverage, never the proof).
 *
 * The engine is loaded through S01's harness, so this exercises the production
 * module graph: the real `005_projection_v1.sql` asset, the real WASM build, the
 * real triggers. Assertions read the database with their own SQL through
 * `engine.selectRows` rather than through the engine's query surface, so a bug
 * in the read path cannot confirm a bug in the write path.
 *
 * The fixture is fully typed against `ProjectionCheckpointV1`, so this file is
 * also a compile-time proof of the input contract S05 binds to.
 *
 * What it proves, in the order CA-13 states it:
 *   (b) every value occupies exactly one typed lane, or none at all;
 *   (c) an out-of-domain decimal is flagged and its value stays readable;
 *   (d) `record_search` tracks live records;
 *   (e) a poisoned load batch disposes the whole projection.
 */

type CheckpointV1 =
  import("../../../src/persistence/projection/types.js").ProjectionCheckpointV1;
type ProjectionRecordV1 =
  import("../../../src/persistence/projection/types.js").ProjectionRecordV1;
type IssueInput =
  import("../../../src/persistence/projection/types.js").ValidationIssueV1Input;
type FieldDefV1 = import("../../../src/domain/model/schema.js").FieldDefV1;
type FieldTypeV1 = import("../../../src/domain/model/schema.js").FieldTypeV1;
type EnumOptionDefV1 =
  import("../../../src/domain/model/schema.js").EnumOptionDefV1;
type CellValueV1 = import("../../../src/domain/model/values.js").CellValueV1;
type FieldId = import("../../../src/domain/model/ids.js").FieldId;
type TableId = import("../../../src/domain/model/ids.js").TableId;
type AppThemeTokenV1 =
  import("../../../src/domain/model/events.js").AppThemeTokenV1;

const PROJECTION_MODULES = [
  "/src/persistence/projection/cbor-values.ts",
  "/src/persistence/projection/engine.ts",
  "/src/persistence/projection/hydrate.ts",
  "/src/persistence/projection/index.ts",
  "/src/persistence/projection/record-rows.ts",
  "/src/persistence/projection/sort-keys.ts",
  "/src/persistence/projection/statements.ts",
];

/** Fill bytes for the fixture's IDs, so every ID is legible in a failure. */
const ID = {
  app: 1,
  device: 2,
  invoices: 3,
  clients: 4,
  name: 5,
  amount: 6,
  due: 7,
  status: 8,
  paid: 9,
  client: 10,
  optionOpen: 11,
  optionOverdue: 12,
  optionVoid: 13,
  ada: 14,
  grace: 15,
  katherine: 16,
  adaClient: 17,
  commit: 18,
  rule: 19,
  sheet: 20,
};

const idHex = (fill: number): string =>
  fill.toString(16).padStart(2, "0").repeat(16);

/** Canonical, and outside the v1 order-key exponent domain by exactly one. */
const OUT_OF_DOMAIN_DECIMAL = `0.${"0".repeat(6143)}1`;

interface FixtureInput {
  readonly ids: Readonly<Record<string, number>>;
  readonly outOfDomainDecimal: string;
  readonly poison: boolean;
}

interface CellSnapshot {
  readonly recordPk: number;
  readonly fieldId: string;
  readonly origin: string;
  readonly valueKind: string;
  readonly populated: readonly string[];
  readonly textValue: string | null;
  readonly textSortKey: string | null;
  readonly decimalValue: string | null;
  readonly decimalOrderKey: string | null;
  readonly integerValue: number | null;
  readonly idValue: string | null;
}

interface HydrationSnapshot {
  readonly userVersion: number;
  readonly meta: {
    readonly appId: string;
    readonly projectionVersion: number;
    readonly eventVersion: number;
    readonly textSortKeyVersion: number;
    readonly decimalOrderKeyVersion: number;
    readonly checkpointStorageId: string | null;
    readonly checkpointHash: string | null;
    readonly frontier: readonly { device: string; sequence: string }[];
    readonly hydratedAtMs: number;
  };
  readonly appState: {
    readonly appId: string;
    readonly displayName: string;
    readonly themeKey: string;
    readonly accent: string;
    readonly schemaRevision: number;
    readonly locality: string;
    readonly durableHomeId: string | null;
    readonly deviceOnlyChangeCount: number;
  };
  readonly tables: readonly {
    tableId: string;
    displayName: string;
    ordinal: number;
    sourceSheetId: string | null;
    keyFieldId: string | null;
    isActive: number;
  }[];
  readonly fields: readonly {
    fieldId: string;
    tableId: string;
    ordinal: number;
    logicalType: string;
    storageKind: string;
    isRequired: number;
    isComputed: number;
    isActive: number;
  }[];
  readonly options: readonly {
    optionId: string;
    label: string;
    ordinal: number;
    isActive: number;
  }[];
  readonly rules: readonly {
    ruleId: string;
    tableId: string;
    messageKey: string;
  }[];
  readonly sheets: readonly { sheetId: string; ordinal: number }[];
  readonly records: readonly {
    recordPk: number;
    recordId: string;
    tableId: string;
    revision: number;
    authored: Record<string, string>;
  }[];
  readonly cells: readonly CellSnapshot[];
  readonly issues: readonly {
    recordPk: number;
    issueId: string;
    fieldId: string | null;
    kind: string;
    severity: string;
    messageKey: string;
    parameters: Record<string, string>;
  }[];
  readonly searchHits: Record<string, readonly number[]>;
  readonly counts: Record<string, number>;
  readonly expectedKeys: {
    readonly amountOrderKey: string;
    readonly nameSortKey: string;
  };
}

/**
 * Builds a small app by hand and hydrates it, then reads the result back with
 * its own SQL. Everything in this function runs in the page.
 */
async function hydrateFixture(input: FixtureInput): Promise<HydrationSnapshot> {
  const harness = window.__sheafHarness;
  const [projection, engine, sortKeys, cbor, ids, bytesModule, values, events, hash] =
    await Promise.all([
      harness.module<typeof import("../../../src/persistence/projection/index.js")>(
        "/src/persistence/projection/index.ts",
      ),
      harness.module<typeof import("../../../src/persistence/projection/engine.js")>(
        "/src/persistence/projection/engine.ts",
      ),
      harness.module<typeof import("../../../src/persistence/projection/sort-keys.js")>(
        "/src/persistence/projection/sort-keys.ts",
      ),
      harness.module<typeof import("../../../src/persistence/projection/cbor-values.js")>(
        "/src/persistence/projection/cbor-values.ts",
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
      harness.module<typeof import("../../../src/crypto/hash.js")>(
        "/src/crypto/hash.ts",
      ),
    ]);

  const fill = input.ids;
  const at = (name: string): number => fill[name] as number;
  const bytes = (value: number): Uint8Array => new Uint8Array(16).fill(value);
  const hex = (value: unknown): string | null =>
    value instanceof Uint8Array
      ? [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("")
      : null;

  const tableId = ids.asDomainId("table", bytes(at("invoices")));
  const clientsId = ids.asDomainId("table", bytes(at("clients")));
  const commitId = ids.asDomainId("commit", bytes(at("commit")));
  const sheetId = ids.asDomainId("sheet", bytes(at("sheet")));
  const provenance = { source: "initial-import" } as const;

  const field = (
    fillByte: number,
    owner: TableId,
    displayName: string,
    fieldOrdinal: number,
    type: FieldTypeV1,
    isRequired = false,
  ): FieldDefV1 => ({
    fieldId: ids.asDomainId("field", bytes(fillByte)),
    tableId: owner,
    displayName,
    fieldOrdinal,
    type,
    isRequired,
    isActive: true,
    schemaRevision: 1n,
  });

  const nameField = field(at("name"), tableId, "Name", 0, { kind: "text" }, true);
  const amountField = field(at("amount"), tableId, "Amount", 1, {
    kind: "currency",
    currencyCode: "USD",
  });
  const dueField = field(at("due"), tableId, "Due", 2, { kind: "date" });
  const statusField = field(at("status"), tableId, "Status", 3, { kind: "enum" });
  const paidField = field(at("paid"), tableId, "Paid", 4, { kind: "boolean" });
  const clientField = field(at("client"), clientsId, "Client", 0, { kind: "text" });

  const option = (
    fillByte: number,
    displayLabel: string,
    optionOrdinal: number,
    isActive: boolean,
  ): EnumOptionDefV1 => ({
    optionId: ids.asDomainId("option", bytes(fillByte)),
    fieldId: statusField.fieldId,
    displayLabel,
    optionOrdinal,
    isActive,
    schemaRevision: 1n,
  });

  const enumOptions = [
    option(at("optionOpen"), "Open", 0, true),
    option(at("optionOverdue"), "Overdue", 1, true),
    option(at("optionVoid"), "Void", 2, false),
  ];

  const record = (
    fillByte: number,
    owner: TableId,
    entries: readonly (readonly [FieldId, CellValueV1])[],
    issues: readonly IssueInput[] = [],
  ): ProjectionRecordV1 => ({
    record: {
      recordId: ids.asDomainId("record", bytes(fillByte)),
      tableId: owner,
      values: new Map(entries),
      provenance: new Map(entries.map(([fieldId]) => [fieldId, provenance])),
    },
    recordRevision: 0n,
    createdCommitId: commitId,
    updatedCommitId: commitId,
    issues,
  });

  const checkpoint: CheckpointV1 = {
    appId: ids.asDomainId("app", bytes(at("app"))),
    checkpointStorageId: bytesModule.asStorageId16(bytes(0x2a)),
    checkpointSemanticSha256: new Uint8Array(32).fill(0x3b),
    frontier: [{ deviceId: bytes(at("device")), commitSequence: 1n }],
    hydratedAtMs: 1_700_000_000_000,
    appState: {
      appId: ids.asDomainId("app", bytes(at("app"))),
      displayName: "Invoices",
      createdAtMs: 1_699_000_000_000,
      lastOpenedAtMs: null,
      schemaRevision: 1n,
      locality: "present",
      durableHomeId: null,
      lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 1,
      theme: {
        themeKey: "sheaf.built-in.slate",
        tokens: Object.fromEntries(
          events.APP_THEME_TOKENS.map((token, index) => [token, `#10203${index}`]),
        ) as Record<AppThemeTokenV1, string>,
      },
      stateRevision: 0n,
    },
    sheetSnapshots: [
      {
        sheetId,
        displayName: "invoices.csv",
        sheetOrdinal: 0,
        classification: ["table"],
        snapshotManifestStorageId: bytesModule.asStorageId16(bytes(0x4c)),
        declaredRowCount: null,
        declaredColumnCount: null,
        snapshotRevision: 0n,
      },
    ],
    tables: [
      {
        tableId,
        displayName: "Invoices",
        tableOrdinal: 0,
        fields: [nameField, amountField, dueField, statusField, paidField],
        keyFieldId: null,
        labelFieldId: nameField.fieldId,
        sourceSheetId: sheetId,
        isActive: true,
        schemaRevision: 1n,
      },
      {
        tableId: clientsId,
        displayName: "Clients",
        tableOrdinal: 1,
        fields: [clientField],
        keyFieldId: clientField.fieldId,
        labelFieldId: clientField.fieldId,
        sourceSheetId: null,
        isActive: true,
        schemaRevision: 1n,
      },
    ],
    enumOptions,
    validationRules: [
      {
        tableId,
        displayName: "Paid invoices need an amount",
        rule: {
          irVersion: 1,
          ruleId: ids.asDomainId("rule", bytes(at("rule"))),
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
          record(at("ada"), tableId, [
            [nameField.fieldId, values.textValue("Ada Lovelace")],
            [amountField.fieldId, values.decimalValue("10.50")],
            [dueField.fieldId, values.dateValue(19_000)],
            [statusField.fieldId, values.enumValue(enumOptions[1]!.optionId)],
            [paidField.fieldId, values.booleanValue(true)],
          ]),
          record(
            at("grace"),
            tableId,
            [
              [nameField.fieldId, values.textValue("Grace Hopper")],
              [amountField.fieldId, values.invalidPreservedValue("twelve dollars")],
              [dueField.fieldId, values.MISSING_VALUE],
              [statusField.fieldId, values.BLANK_VALUE],
              [paidField.fieldId, values.booleanValue(false)],
            ],
            [
              {
                fieldId: amountField.fieldId,
                ruleId: null,
                kind: "type",
                severity: "warning",
                messageKey: "validation.preserved-invalid",
                messageParameters: {
                  fieldLabel: "Amount",
                  expectedType: "currency",
                },
              },
            ],
          ),
          record(at("katherine"), tableId, [
            [nameField.fieldId, values.textValue("Katherine Johnson")],
            [amountField.fieldId, values.decimalValue(input.outOfDomainDecimal)],
          ]),
        ],
      },
      {
        records: [
          record(at("adaClient"), clientsId, [
            [clientField.fieldId, values.textValue("Ada Lovelace")],
          ]),
          // The poisoned batch re-uses a record ID the first page already
          // used; `records.record_id` is UNIQUE, so SQLite refuses it.
          ...(input.poison
            ? [
                record(at("ada"), clientsId, [
                  [clientField.fieldId, values.textValue("Duplicate")],
                ]),
              ]
            : []),
        ],
      },
    ],
  };

  const handle = await projection.openProjection({ sha256: hash.sha256 });
  window.__sheafProjection = handle;
  await projection.hydrateApp(handle, checkpoint);

  const rows = (sql: string, parameters: readonly (string | number | Uint8Array | null)[] = []) =>
    engine.selectRows(handle, sql, parameters);
  const count = (value: unknown): number => Number(value);
  // Narrowing rather than coercing: a TEXT column that came back as anything
  // else is a schema failure the assertion should surface, not stringify.
  const text = (value: unknown): string => {
    if (typeof value !== "string") {
      throw new Error("expected a text column");
    }
    return value;
  };

  const metaRow = rows(
    `SELECT app_id, projection_format_version, event_format_version,
            text_sort_key_version, decimal_order_key_version,
            checkpoint_storage_id, checkpoint_semantic_sha256, frontier_cbor,
            hydrated_at_ms
       FROM projection_meta`,
  )[0]!;
  const stateRow = rows(
    `SELECT app_id, display_name, schema_revision, locality, durable_home_id,
            device_only_change_count, theme_cbor
       FROM app_state`,
  )[0]!;
  const decodedTheme = cbor.decodeAppTheme(stateRow[6] as Uint8Array);

  const search = (term: string): number[] =>
    rows("SELECT rowid FROM record_search WHERE record_search MATCH ?", [
      `"${term}"*`,
    ]).map((row) => count(row[0]));

  const countFor = (target: Uint8Array): number =>
    count(rows("SELECT count(*) FROM records WHERE table_id = ?", [target])[0]![0]);

  const LANES = [
    "text_value",
    "text_sort_key",
    "decimal_value",
    "decimal_order_key",
    "integer_value",
    "id_value",
  ];

  return {
    userVersion: count(rows("PRAGMA user_version")[0]![0]),
    meta: {
      appId: hex(metaRow[0])!,
      projectionVersion: count(metaRow[1]),
      eventVersion: count(metaRow[2]),
      textSortKeyVersion: count(metaRow[3]),
      decimalOrderKeyVersion: count(metaRow[4]),
      checkpointStorageId: hex(metaRow[5]),
      checkpointHash: hex(metaRow[6]),
      frontier: cbor.decodeFrontier(metaRow[7] as Uint8Array).map((entry) => ({
        device: hex(entry.deviceId)!,
        sequence: String(entry.commitSequence),
      })),
      hydratedAtMs: count(metaRow[8]),
    },
    appState: {
      appId: hex(stateRow[0])!,
      displayName: text(stateRow[1]),
      themeKey: decodedTheme.themeKey,
      accent: decodedTheme.tokens["app-accent"],
      schemaRevision: count(stateRow[2]),
      locality: text(stateRow[3]),
      durableHomeId: hex(stateRow[4]),
      deviceOnlyChangeCount: count(stateRow[5]),
    },
    tables: rows(
      `SELECT table_id, display_name, table_ordinal, source_sheet_id,
              key_field_id, is_active
         FROM schema_tables ORDER BY table_ordinal`,
    ).map((row) => ({
      tableId: hex(row[0])!,
      displayName: text(row[1]),
      ordinal: count(row[2]),
      sourceSheetId: hex(row[3]),
      keyFieldId: hex(row[4]),
      isActive: count(row[5]),
    })),
    fields: rows(
      `SELECT field_id, table_id, field_ordinal, logical_type, storage_kind,
              is_required, is_computed, is_active
         FROM schema_fields ORDER BY table_id, field_ordinal`,
    ).map((row) => ({
      fieldId: hex(row[0])!,
      tableId: hex(row[1])!,
      ordinal: count(row[2]),
      logicalType: text(row[3]),
      storageKind: text(row[4]),
      isRequired: count(row[5]),
      isComputed: count(row[6]),
      isActive: count(row[7]),
    })),
    options: rows(
      `SELECT option_id, display_label, option_ordinal, is_active
         FROM enum_options ORDER BY option_ordinal`,
    ).map((row) => ({
      optionId: hex(row[0])!,
      label: text(row[1]),
      ordinal: count(row[2]),
      isActive: count(row[3]),
    })),
    rules: rows("SELECT rule_id, table_id, message_key FROM validation_rules").map(
      (row) => ({
        ruleId: hex(row[0])!,
        tableId: hex(row[1])!,
        messageKey: text(row[2]),
      }),
    ),
    sheets: rows("SELECT sheet_id, sheet_ordinal FROM sheet_snapshots").map(
      (row) => ({ sheetId: hex(row[0])!, ordinal: count(row[1]) }),
    ),
    records: rows(
      `SELECT record_pk, record_id, table_id, record_revision, authored_cbor
         FROM records ORDER BY record_pk`,
    ).map((row) => {
      const authored = cbor.decodeAuthoredRecord(row[4] as Uint8Array);
      const kinds: Record<string, string> = {};
      for (const [fieldId, value] of authored.values) {
        kinds[hex(fieldId)!] = value.kind;
      }
      return {
        recordPk: count(row[0]),
        recordId: hex(row[1])!,
        tableId: hex(row[2])!,
        revision: count(row[3]),
        authored: kinds,
      };
    }),
    cells: rows(
      `SELECT record_pk, field_id, origin, value_kind, text_value, text_sort_key,
              decimal_value, decimal_order_key, integer_value, id_value
         FROM cells ORDER BY record_pk, field_id`,
    ).map((row) => ({
      recordPk: count(row[0]),
      fieldId: hex(row[1])!,
      origin: text(row[2]),
      valueKind: text(row[3]),
      populated: LANES.filter((_, index) => row[4 + index] !== null),
      textValue: row[4] === null ? null : text(row[4]),
      textSortKey: hex(row[5]),
      decimalValue: row[6] === null ? null : text(row[6]),
      decimalOrderKey: hex(row[7]),
      integerValue: row[8] === null ? null : count(row[8]),
      idValue: hex(row[9]),
    })),
    issues: rows(
      `SELECT record_pk, issue_id, field_id, issue_kind, severity, message_key,
              message_parameters_cbor
         FROM record_issues ORDER BY record_pk, issue_id`,
    ).map((row) => ({
      recordPk: count(row[0]),
      issueId: hex(row[1])!,
      fieldId: hex(row[2]),
      kind: text(row[3]),
      severity: text(row[4]),
      messageKey: text(row[5]),
      parameters: Object.fromEntries(
        Object.entries(cbor.decodeMessageParameters(row[6] as Uint8Array)).map(
          ([key, value]) => [key, String(value)],
        ),
      ),
    })),
    searchHits: {
      Lovelace: search("Lovelace"),
      Overdue: search("Overdue"),
      twelve: search("twelve"),
      Hopper: search("Hopper"),
      Void: search("Void"),
    },
    counts: {
      invoices: countFor(bytes(at("invoices"))),
      clients: countFor(bytes(at("clients"))),
    },
    expectedKeys: {
      amountOrderKey: hex(sortKeys.decimalOrderKeyV1("10.50"))!,
      nameSortKey: hex(sortKeys.textSortKeyV1("Ada Lovelace"))!,
    },
  };
}

declare global {
  interface Window {
    __sheafProjection?: unknown;
  }
}

let page: Page;
let snapshot: HydrationSnapshot;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto("/harness.html");
  snapshot = await page.evaluate(hydrateFixture, {
    ids: ID,
    outOfDomainDecimal: OUT_OF_DOMAIN_DECIMAL,
    poison: false,
  });
});

test.afterAll(async () => {
  await page.close();
});

test("brings an empty database to the projection schema through migration 005", () => {
  expect(snapshot.userVersion).toBe(1);
  expect(snapshot.meta.projectionVersion).toBe(1);
  expect(snapshot.meta.eventVersion).toBe(1);
  expect(snapshot.meta.textSortKeyVersion).toBe(1);
  expect(snapshot.meta.decimalOrderKeyVersion).toBe(1);
});

test("records the checkpoint it was hydrated from", () => {
  expect(snapshot.meta.appId).toBe(idHex(ID.app));
  expect(snapshot.meta.checkpointStorageId).toBe("2a".repeat(16));
  expect(snapshot.meta.checkpointHash).toBe("3b".repeat(32));
  expect(snapshot.meta.frontier).toEqual([
    { device: idHex(ID.device), sequence: "1" },
  ]);
  expect(snapshot.meta.hydratedAtMs).toBe(1_700_000_000_000);
});

test("reads the app state and theme the checkpoint carried (D29)", () => {
  expect(snapshot.appState).toEqual({
    appId: idHex(ID.app),
    displayName: "Invoices",
    // Written by promotion; the projection composes no default.
    themeKey: "sheaf.built-in.slate",
    accent: "#102034",
    schemaRevision: 1,
    locality: "present",
    durableHomeId: null,
    deviceOnlyChangeCount: 1,
  });
});

test("loads the schema in an order the triggers accept", () => {
  expect(snapshot.tables).toEqual([
    {
      tableId: idHex(ID.invoices),
      displayName: "Invoices",
      ordinal: 0,
      sourceSheetId: idHex(ID.sheet),
      keyFieldId: null,
      isActive: 1,
    },
    {
      tableId: idHex(ID.clients),
      displayName: "Clients",
      ordinal: 1,
      sourceSheetId: null,
      // The deferred reference resolved once its field existed.
      keyFieldId: idHex(ID.client),
      isActive: 1,
    },
  ]);

  expect(snapshot.sheets).toEqual([{ sheetId: idHex(ID.sheet), ordinal: 0 }]);
  expect(snapshot.rules).toEqual([
    {
      ruleId: idHex(ID.rule),
      tableId: idHex(ID.invoices),
      messageKey: "rule.amount-required",
    },
  ]);
  expect(snapshot.options.map((option) => [option.label, option.isActive])).toEqual([
    ["Open", 1],
    ["Overdue", 1],
    // A retired option stays interpretable rather than disappearing.
    ["Void", 0],
  ]);
});

test("maps every field type onto its storage lane, computed by nothing", () => {
  const byField = new Map(snapshot.fields.map((field) => [field.fieldId, field]));

  expect(byField.get(idHex(ID.name))).toMatchObject({
    logicalType: "text",
    storageKind: "text",
    isRequired: 1,
  });
  expect(byField.get(idHex(ID.amount))).toMatchObject({
    logicalType: "currency",
    storageKind: "decimal",
  });
  expect(byField.get(idHex(ID.due))).toMatchObject({
    logicalType: "date",
    storageKind: "integer",
  });
  expect(byField.get(idHex(ID.status))).toMatchObject({
    logicalType: "enum",
    storageKind: "id",
  });
  expect(byField.get(idHex(ID.paid))).toMatchObject({
    logicalType: "boolean",
    storageKind: "integer",
  });
  // F02 has no formula engine: every field is authored (invariant 7).
  expect(snapshot.fields.every((field) => field.isComputed === 0)).toBe(true);
});

test("assigns record keys in (TableId, RecordId) order", () => {
  expect(snapshot.records.map((record) => [record.recordPk, record.recordId])).toEqual([
    [1, idHex(ID.ada)],
    [2, idHex(ID.grace)],
    [3, idHex(ID.katherine)],
    [4, idHex(ID.adaClient)],
  ]);
  expect(snapshot.counts).toEqual({ invoices: 3, clients: 1 });
});

test("CA-13(b): every value occupies exactly one typed lane", () => {
  const expected: Record<string, readonly string[]> = {
    text: ["text_value", "text_sort_key"],
    decimal: ["decimal_value", "decimal_order_key"],
    integer: ["integer_value"],
    id: ["id_value"],
  };

  for (const cell of snapshot.cells) {
    expect(cell.populated, `${cell.recordPk}/${cell.fieldId}`).toEqual(
      expected[cell.valueKind],
    );
    expect(cell.origin).toBe("authored");
  }

  const ada = snapshot.cells.filter((cell) => cell.recordPk === 1);
  expect(ada.map((cell) => cell.valueKind).sort()).toEqual([
    "decimal",
    "id",
    "integer",
    "integer",
    "text",
  ]);

  const amount = ada.find((cell) => cell.fieldId === idHex(ID.amount))!;
  // The authored text is the value of record; the 20-byte key only indexes it.
  expect(amount.decimalValue).toBe("10.50");
  expect(amount.decimalOrderKey).toBe(snapshot.expectedKeys.amountOrderKey);
  expect(amount.decimalOrderKey).toHaveLength(40);

  const name = ada.find((cell) => cell.fieldId === idHex(ID.name))!;
  expect(name.textValue).toBe("Ada Lovelace");
  expect(name.textSortKey).toBe(snapshot.expectedKeys.nameSortKey);

  expect(ada.find((cell) => cell.fieldId === idHex(ID.due))!.integerValue).toBe(19_000);
  expect(ada.find((cell) => cell.fieldId === idHex(ID.paid))!.integerValue).toBe(1);
  expect(ada.find((cell) => cell.fieldId === idHex(ID.status))!.idValue).toBe(
    idHex(ID.optionOverdue),
  );
});

test("keeps missing, blank, and invalid-preserved out of the lanes and in the record", () => {
  const grace = snapshot.records.find((record) => record.recordPk === 2)!;
  const graceCells = snapshot.cells.filter((cell) => cell.recordPk === 2);

  // Three absences, three distinct authored states, no cell for any of them.
  expect(grace.authored[idHex(ID.due)]).toBe("missing");
  expect(grace.authored[idHex(ID.status)]).toBe("blank");
  expect(grace.authored[idHex(ID.amount)]).toBe("invalid-preserved");
  expect(graceCells.map((cell) => cell.fieldId).sort()).toEqual(
    [idHex(ID.name), idHex(ID.paid)].sort(),
  );
  // False is a value: it has a lane and it is 0, not an absence.
  expect(graceCells.find((cell) => cell.fieldId === idHex(ID.paid))!.integerValue).toBe(0);

  expect(snapshot.issues.filter((issue) => issue.recordPk === 2)).toEqual([
    {
      recordPk: 2,
      issueId: expect.stringMatching(/^[0-9a-f]{32}$/) as unknown as string,
      fieldId: idHex(ID.amount),
      kind: "type",
      severity: "warning",
      messageKey: "validation.preserved-invalid",
      parameters: { expectedType: "currency", fieldLabel: "Amount" },
    },
  ]);
});

test("CA-13(c): an out-of-domain decimal is flagged, unindexed, and still readable", () => {
  const katherine = snapshot.records.find((record) => record.recordPk === 3)!;

  expect(katherine.authored[idHex(ID.amount)]).toBe("decimal");
  expect(
    snapshot.cells.filter(
      (cell) => cell.recordPk === 3 && cell.fieldId === idHex(ID.amount),
    ),
  ).toEqual([]);
  expect(snapshot.issues.filter((issue) => issue.recordPk === 3)).toEqual([
    {
      recordPk: 3,
      issueId: expect.stringMatching(/^[0-9a-f]{32}$/) as unknown as string,
      fieldId: idHex(ID.amount),
      kind: "type",
      severity: "warning",
      messageKey: "validation.decimal-out-of-domain",
      // The reason names the field, never the value.
      parameters: { fieldLabel: "Amount" },
    },
  ]);
});

test("CA-13(d): search indexes what a person reads, across tables", () => {
  expect(snapshot.searchHits["Lovelace"]).toEqual([1, 4]);
  // The enum's label, not its ID.
  expect(snapshot.searchHits["Overdue"]).toEqual([1]);
  // A preserved invalid value is still text a person can find.
  expect(snapshot.searchHits["twelve"]).toEqual([2]);
  expect(snapshot.searchHits["Hopper"]).toEqual([2]);
  // Nothing uses the retired option, so its label indexes nothing.
  expect(snapshot.searchHits["Void"]).toEqual([]);
});

test("CA-13(e): a poisoned load batch disposes the whole projection", async ({
  browser,
}) => {
  const poisoned = await browser.newPage();
  try {
    await poisoned.goto("/harness.html");

    const failure = await poisoned
      .evaluate(hydrateFixture, {
        ids: ID,
        outOfDomainDecimal: OUT_OF_DOMAIN_DECIMAL,
        poison: true,
      })
      .then(
        () => "hydration succeeded",
        (cause: unknown) => String(cause),
      );

    // The first page committed; the failure is in the second batch.
    expect(failure).toContain("UNIQUE");

    const afterFailure = await poisoned.evaluate(async () => {
      const engine = await window.__sheafHarness.module<
        typeof import("../../../src/persistence/projection/engine.js")
      >("/src/persistence/projection/engine.ts");
      const handle = window.__sheafProjection as Parameters<
        typeof engine.selectRows
      >[0];
      try {
        return {
          answered: engine.selectRows(handle, "SELECT count(*) FROM records")
            .length,
          refusedWith: "",
        };
      } catch (cause) {
        return { answered: -1, refusedWith: String(cause) };
      }
    });

    // Nothing survives: not the failed batch, and not the batch before it.
    expect(afterFailure.answered).toBe(-1);
    expect(afterFailure.refusedWith).toContain("disposed");
  } finally {
    await poisoned.close();
  }
});

test("loads the engine from built output, not from a test copy", async () => {
  const available = await page.evaluate(() => window.__sheafHarness.listModules());

  for (const specifier of PROJECTION_MODULES) {
    expect(available).toContain(specifier);
  }
});
