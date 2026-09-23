import { expect, test, type Page } from "@playwright/test";

/**
 * CA-20's hydration leg and CA-23's projection tail half, on real SQLite in a
 * real browser (built output, the harness): a workbook app's roots land in the
 * five tables migration 005 defines for them, survive a restart row for row,
 * and an appended table is built from a tail commit.
 *
 * The record issues are not hand-written: the page runs the one shared
 * validator over the checkpoint with a resolver over the checkpoint's own
 * records — the decision `app-session.ts` makes at open — so the broken
 * references below are the validator's, and the projection stores its verdict.
 *
 * Assertions read the database with their own SQL, never through the engine's
 * query surface, so a bug in the read path cannot confirm one in the write path.
 */

type CheckpointV1 =
  import("../../../src/persistence/projection/types.js").ProjectionCheckpointV1;
type ProjectionRecordV1 =
  import("../../../src/persistence/projection/types.js").ProjectionRecordV1;
type FieldDefV1 = import("../../../src/domain/model/schema.js").FieldDefV1;
type FieldTypeV1 = import("../../../src/domain/model/schema.js").FieldTypeV1;
type TableDefV1 = import("../../../src/domain/model/schema.js").TableDefV1;
type RelationshipDefV1 =
  import("../../../src/domain/model/schema.js").RelationshipDefV1;
type CellValueV1 = import("../../../src/domain/model/values.js").CellValueV1;
type FieldId = import("../../../src/domain/model/ids.js").FieldId;
type TableId = import("../../../src/domain/model/ids.js").TableId;
type AppThemeTokenV1 =
  import("../../../src/domain/model/events.js").AppThemeTokenV1;
type F02DomainEventV1 =
  import("../../../src/domain/model/events.js").F02DomainEventV1;
type DomainEventV1 =
  import("../../../src/migrations/004_event_format_v1.js").DomainEventV1;
type EventCommitBodyV1 =
  import("../../../src/persistence/codecs/event-commit.js").EventCommitBodyV1;

type Variant = "valid" | "non-key-relationship" | "field-without-table";

interface Outcome {
  readonly sheets: readonly { name: string; roles: readonly string[]; revision: number }[];
  readonly tables: readonly string[];
  readonly relationships: readonly string[];
  readonly rules: number;
  readonly inert: readonly string[];
  readonly lineages: readonly string[];
  readonly decisions: readonly string[];
  readonly issues: readonly string[];
  readonly issueParameters: readonly string[];
  readonly firstDump: readonly string[];
  readonly restartDump: readonly string[];
  readonly tail: {
    readonly tables: readonly string[];
    readonly sheets: readonly string[];
    readonly fields: readonly string[];
    readonly options: readonly string[];
    readonly records: number;
    readonly schemaRevision: number;
    readonly history: readonly string[];
  } | null;
  readonly failure: string;
  readonly refusedAfterFailure: string;
}

async function runWorkbook(input: { readonly variant: Variant }): Promise<Outcome> {
  const harness = window.__sheafHarness;
  const [projection, engine, ids, bytesModule, values, events, codec, hash, validator, cbor] =
    await Promise.all([
      harness.module<typeof import("../../../src/persistence/projection/index.js")>(
        "/src/persistence/projection/index.ts",
      ),
      harness.module<typeof import("../../../src/persistence/projection/engine.js")>(
        "/src/persistence/projection/engine.ts",
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
      harness.module<typeof import("../../../src/crypto/hash.js")>("/src/crypto/hash.ts"),
      harness.module<typeof import("../../../src/domain/validation/validate-record.js")>(
        "/src/domain/validation/validate-record.ts",
      ),
      harness.module<typeof import("../../../src/persistence/codecs/canonical-cbor.js")>(
        "/src/persistence/codecs/canonical-cbor.ts",
      ),
    ]);

  const bytes = (fill: number): Uint8Array => new Uint8Array(16).fill(fill);
  const hex = (value: unknown): string =>
    value instanceof Uint8Array
      ? [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("")
      : String(value === null ? "null" : (value as number | string));

  const appId = ids.asDomainId("app", bytes(1));
  const deviceId = bytes(2);
  const suppliersId = ids.asDomainId("table", bytes(3));
  const ordersId = ids.asDomainId("table", bytes(4));
  const commitId = ids.asDomainId("commit", bytes(15));
  const supplierSheet = ids.asDomainId("sheet", bytes(16));
  const orderSheet = ids.asDomainId("sheet", bytes(17));
  const overviewSheet = ids.asDomainId("sheet", bytes(18));

  const field = (
    fill: number,
    tableId: TableId,
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

  const code = field(5, suppliersId, "Code", 0, { kind: "text" });
  const supplierName = field(6, suppliersId, "Name", 1, { kind: "text" });
  const orderName = field(7, ordersId, "Order", 0, { kind: "text" });
  const orderSupplier = field(8, ordersId, "Supplier", 1, { kind: "reference" });

  const suppliers: TableDefV1 = {
    tableId: suppliersId,
    displayName: "Suppliers",
    tableOrdinal: 0,
    fields: [code, supplierName],
    keyFieldId: code.fieldId,
    labelFieldId: supplierName.fieldId,
    sourceSheetId: supplierSheet,
    isActive: true,
    schemaRevision: 1n,
  };
  const orders: TableDefV1 = {
    tableId: ordersId,
    displayName: "Orders",
    tableOrdinal: 1,
    fields: [orderName, orderSupplier],
    keyFieldId: null,
    labelFieldId: orderName.fieldId,
    sourceSheetId: orderSheet,
    isActive: true,
    schemaRevision: 1n,
  };

  const relationship: RelationshipDefV1 = {
    relationshipId: ids.asDomainId("relationship", bytes(19)),
    fromTableId: ordersId,
    fromFieldId: orderSupplier.fieldId,
    toTableId: suppliersId,
    // The poisoned variant points at the label, which is not the target's key.
    toKeyFieldId:
      input.variant === "non-key-relationship" ? supplierName.fieldId : code.fieldId,
    detectionSource: "lookup-formula",
    isActive: true,
    schemaRevision: 1n,
  };

  const acme = ids.asDomainId("record", bytes(9));
  const globex = ids.asDomainId("record", bytes(10));
  const rows: readonly (readonly [number, TableId, readonly (readonly [FieldId, CellValueV1])[]])[] = [
    [9, suppliersId, [[code.fieldId, values.textValue("SUP-1")], [supplierName.fieldId, values.textValue("Acme")]]],
    [10, suppliersId, [[code.fieldId, values.textValue("SUP-2")], [supplierName.fieldId, values.textValue("Globex")]]],
    [11, ordersId, [[orderName.fieldId, values.textValue("Bolts")], [orderSupplier.fieldId, values.referenceValue(acme)]]],
    // An imported key that matched no supplier: preserved, flagged (D36).
    [12, ordersId, [[orderName.fieldId, values.textValue("Nuts")], [orderSupplier.fieldId, values.invalidPreservedValue("SUP-404")]]],
    // A reference to a record the checkpoint does not hold.
    [13, ordersId, [[orderName.fieldId, values.textValue("Gears")], [orderSupplier.fieldId, values.referenceValue(ids.asDomainId("record", bytes(14)))]]],
  ];
  void globex;

  const live = new Set(rows.map(([fill, tableId]) => `${hex(tableId)}:${hex(bytes(fill))}`));
  const tables = [suppliers, orders];
  const record = ([fill, tableId, entries]: (typeof rows)[number]): ProjectionRecordV1 => {
    const table = tables.find((candidate) => hex(candidate.tableId) === hex(tableId)) as TableDefV1;
    const recordId = ids.asDomainId("record", bytes(fill));
    const cellValues = new Map(entries);
    const report = validator.validateRecord(
      {
        table,
        enumOptions: new Map(),
        rules: [],
        referenceExists: (target, id) => live.has(`${hex(target)}:${hex(id)}`),
        referenceTargets:
          table === orders
            ? [{ fieldId: orderSupplier.fieldId, tableId: suppliersId, tableLabel: "Suppliers" }]
            : [],
      },
      { recordId, tableId, values: cellValues },
    );
    return {
      record: { recordId, tableId, values: cellValues, provenance: new Map() },
      recordRevision: 0n,
      createdCommitId: commitId,
      updatedCommitId: commitId,
      issues: report.issues,
    };
  };

  const checkpoint = (): CheckpointV1 => ({
    appId,
    checkpointStorageId: bytesModule.asStorageId16(bytes(0x2a)),
    checkpointSemanticSha256: new Uint8Array(32).fill(0x3b),
    frontier: [{ deviceId, commitSequence: 1n }],
    hydratedAtMs: 1_700_000_000_000,
    appState: {
      appId,
      displayName: "Supply",
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
          events.APP_THEME_TOKENS.map((token) => [token, "#101010"]),
        ) as Record<AppThemeTokenV1, string>,
      },
      stateRevision: 0n,
    },
    sheetSnapshots: [
      { sheetId: supplierSheet, displayName: "Suppliers", sheetOrdinal: 0, classification: ["table", "lookup"], snapshotManifestStorageId: bytesModule.asStorageId16(bytes(0x40)), declaredRowCount: 3, declaredColumnCount: 2, snapshotRevision: 1n },
      { sheetId: orderSheet, displayName: "Orders", sheetOrdinal: 1, classification: ["table"], snapshotManifestStorageId: bytesModule.asStorageId16(bytes(0x41)), declaredRowCount: null, declaredColumnCount: null, snapshotRevision: 1n },
      { sheetId: overviewSheet, displayName: "Overview", sheetOrdinal: 2, classification: ["summary", "chart"], snapshotManifestStorageId: bytesModule.asStorageId16(bytes(0x42)), declaredRowCount: 12, declaredColumnCount: 6, snapshotRevision: 1n },
    ],
    tables,
    enumOptions: [],
    relationships: [relationship],
    validationRules: [
      {
        tableId: ordersId,
        displayName: "An order names a supplier",
        rule: {
          irVersion: 1,
          ruleId: ids.asDomainId("rule", bytes(20)),
          condition: { kind: "field-present", fieldId: orderSupplier.fieldId },
          severity: "warning",
          messageKey: "rule.order-needs-supplier",
          messageParameters: { fieldLabel: "Supplier" },
        },
        isActive: true,
        schemaRevision: 1n,
      },
    ],
    inertItems: [
      { inertItemId: ids.asDomainId("inert-item", bytes(21)), sheetId: overviewSheet, kind: "chart", location: "Overview!B2:F9", reasonKey: "chart-not-live-yet", anchor: { firstRow: 1, firstColumn: 1, lastRow: 8, lastColumn: 5 }, preservedManifestStorageId: null },
      { inertItemId: ids.asDomainId("inert-item", bytes(22)), sheetId: orderSheet, kind: "formula", location: "Orders!C2:C4", reasonKey: "formula-not-live-yet", anchor: null, preservedManifestStorageId: bytesModule.asStorageId16(bytes(0x43)) },
    ],
    importLineages: [
      { lineageId: ids.asDomainId("lineage", bytes(24)), importKind: "initial", importOrdinal: 0, sourceDisplayName: "supply.xlsx", sourceSha256: new Uint8Array(32).fill(0x44), acceptedAtMs: 1_699_000_000_000, identityDecisions: new Map([["kind", "initial"]]), acceptedCommitId: commitId },
    ],
    inferenceDecisions: [
      { decisionId: ids.asDomainId("decision", bytes(23)), decisionKind: "relationship", evidenceFingerprint: new Uint8Array(32).fill(0x45), disposition: "rejected", statement: new Map([["statementId", "rel:1"]]), evidence: ["key-match"], recordedEventId: ids.asDomainId("event", bytes(25)) },
    ],
    recordPages: [{ records: rows.map(record) }],
  });

  const dump = (handle: Parameters<typeof engine.selectRows>[0]): string[] => {
    const lines: string[] = [];
    for (const sql of [
      "SELECT * FROM sheet_snapshots ORDER BY sheet_ordinal",
      "SELECT * FROM schema_tables ORDER BY table_ordinal",
      "SELECT * FROM schema_fields ORDER BY table_id, field_ordinal",
      "SELECT * FROM relationships ORDER BY relationship_id",
      "SELECT * FROM validation_rules ORDER BY rule_id",
      "SELECT * FROM inert_content ORDER BY inert_item_id",
      "SELECT * FROM import_lineages ORDER BY lineage_id",
      "SELECT * FROM inference_decisions ORDER BY decision_id",
      "SELECT * FROM records ORDER BY record_pk",
      "SELECT * FROM cells ORDER BY record_pk, field_id",
      "SELECT * FROM record_issues ORDER BY record_pk, issue_id",
    ]) {
      for (const row of engine.selectRows(handle, sql)) {
        lines.push(`${sql.split(" ")[3] ?? ""}|${row.map(hex).join("|")}`);
      }
    }
    return lines;
  };

  const handle = await projection.openProjection({ sha256: hash.sha256 });

  if (input.variant === "non-key-relationship") {
    const failure = await projection.hydrateApp(handle, checkpoint()).then(
      () => "hydration succeeded",
      (cause: unknown) => String(cause),
    );
    return refusal(failure);
  }

  await projection.hydrateApp(handle, checkpoint());

  const select = (sql: string) => engine.selectRows(handle, sql);
  const anchorText = (bytesValue: Uint8Array): string => {
    const map = cbor.decodeCanonical(bytesValue) as ReadonlyMap<string, bigint>;
    return JSON.stringify(
      Object.fromEntries(
        ["firstRow", "firstColumn", "lastRow", "lastColumn"].map((name) => [
          name,
          Number(map.get(name)),
        ]),
      ),
    );
  };
  const decodeRoles = (value: unknown): readonly string[] =>
    cbor.decodeCanonical(value as Uint8Array) as readonly string[];

  const sheets = select(
    "SELECT display_name, classification_cbor, snapshot_revision FROM sheet_snapshots ORDER BY sheet_ordinal",
  ).map((row) => ({ name: hex(row[0]), roles: decodeRoles(row[1]), revision: Number(row[2]) }));
  const tableNames = select("SELECT display_name FROM schema_tables ORDER BY table_ordinal").map((row) => hex(row[0]));
  const relationships = select(
    "SELECT from_field_id, to_table_id, to_key_field_id, detection_source, is_active FROM relationships",
  ).map((row) => row.map(hex).join("|"));
  const rules = Number(select("SELECT count(*) FROM validation_rules")[0]?.[0]);
  const inert = select(
    "SELECT item_kind, source_location, reason_key, snapshot_anchor_cbor, preserved_manifest_storage_id FROM inert_content ORDER BY inert_item_id",
  ).map((row) =>
    [
      hex(row[0]),
      hex(row[1]),
      hex(row[2]),
      row[3] === null ? "no-anchor" : anchorText(row[3] as Uint8Array),
      hex(row[4]),
    ].join("|"),
  );
  const lineages = select(
    "SELECT import_kind, import_ordinal, source_display_name, length(source_sha256), accepted_commit_id FROM import_lineages",
  ).map((row) => row.map(hex).join("|"));
  const decisions = select(
    "SELECT decision_kind, disposition, length(evidence_fingerprint_sha256) FROM inference_decisions",
  ).map((row) => row.map(hex).join("|"));
  const issues = select(
    `SELECT r.record_id, i.issue_kind, i.severity, i.message_key
       FROM record_issues AS i JOIN records AS r ON r.record_pk = i.record_pk
      ORDER BY r.record_id, i.issue_id`,
  ).map((row) => row.map(hex).join("|"));
  const issueParameters = select(
    "SELECT message_parameters_cbor FROM record_issues WHERE issue_kind = 'broken-reference'",
  ).map((row) =>
    JSON.stringify([...(cbor.decodeCanonical(row[0] as Uint8Array) as ReadonlyMap<string, unknown>)]),
  );
  const firstDump = dump(handle);
  projection.disposeProjection(handle);

  // Restart: a fresh projection from the same checkpoint.
  const restarted = await projection.openProjection({ sha256: hash.sha256 });
  await projection.hydrateApp(restarted, checkpoint());
  const restartDump = dump(restarted);

  // The append: one import-class tail commit that creates a table.
  const deliveriesId = ids.asDomainId("table", bytes(30));
  const deliveriesSheet = ids.asDomainId("sheet", bytes(36));
  const deliveryCode = field(31, deliveriesId, "Code", 0, { kind: "text" });
  const deliveryStatus = field(32, deliveriesId, "Status", 1, { kind: "enum" });
  const open = {
    optionId: ids.asDomainId("option", bytes(33)),
    fieldId: deliveryStatus.fieldId,
    displayLabel: "Open",
    optionOrdinal: 0,
    isActive: true,
    schemaRevision: 2n,
  };
  const deliveries: TableDefV1 = {
    tableId: deliveriesId,
    displayName: "Deliveries",
    tableOrdinal: 2,
    fields: [deliveryCode],
    keyFieldId: deliveryCode.fieldId,
    labelFieldId: null,
    sourceSheetId: deliveriesSheet,
    isActive: true,
    schemaRevision: 2n,
  };
  const orphanTable = ids.asDomainId("table", bytes(38));
  const deliveryRecord = (fill: number) => ({
    recordId: ids.asDomainId("record", bytes(fill)),
    tableId: deliveriesId,
    values: new Map<FieldId, CellValueV1>([
      [deliveryCode.fieldId, values.textValue(`D-${fill}`)],
      [deliveryStatus.fieldId, values.enumValue(open.optionId)],
    ]),
    provenance: new Map(),
  });

  const typed: readonly F02DomainEventV1[] = [
    {
      kind: "table.created",
      payload: {
        table: deliveries,
        sourceSheetId: deliveriesSheet,
        sourceSheet: {
          sheetId: deliveriesSheet,
          displayName: "deliveries.csv",
          sheetOrdinal: 3,
          classification: ["table"],
          snapshotManifestStorageId: "RkZGRkZGRkZGRkZGRkZGRg",
          declaredRowCount: null,
          declaredColumnCount: null,
          snapshotRevision: 2n,
        },
      },
    },
    { kind: "field.created", payload: { field: deliveryCode, evidence: null } },
    {
      kind: "field.created",
      payload: {
        field:
          input.variant === "field-without-table"
            ? { ...deliveryStatus, tableId: orphanTable }
            : deliveryStatus,
        evidence: null,
      },
    },
    { kind: "enum.changed", payload: { fieldId: deliveryStatus.fieldId, priorOptionSetSha256: null, options: [open] } },
    { kind: "record.created", payload: { record: deliveryRecord(34), importedInvalid: false } },
    { kind: "record.created", payload: { record: deliveryRecord(35), importedInvalid: false } },
  ];

  const subjectOf = (event: F02DomainEventV1): DomainEventV1["subject"] => {
    switch (event.kind) {
      case "table.created":
        return { appId, tableId: deliveriesId };
      case "field.created":
        return { appId, tableId: event.payload.field.tableId, fieldId: event.payload.field.fieldId };
      case "enum.changed":
        return { appId, fieldId: event.payload.fieldId };
      case "record.created":
        return { appId, tableId: deliveriesId, recordId: event.payload.record.recordId };
      default:
        return { appId };
    }
  };

  const body: EventCommitBodyV1 = {
    eventFormatVersion: 1,
    commitId: bytes(37),
    appId,
    deviceId,
    deviceCommitSequence: 2n,
    previousDeviceCommitSha256: new Uint8Array(32).fill(0x0c),
    basisFrontier: [{ deviceId, commitSequence: 1n }],
    hybridTime: { wallTimeMs: 1_700_000_100_000n, logicalCounter: 0 },
    eventClass: "import",
    schemaRevisionBefore: 1n,
    schemaRevisionAfter: 2n,
    events: typed.map((event, eventIndex) => ({
      eventId: bytes(0x50 + eventIndex),
      eventIndex,
      kind: event.kind,
      subject: subjectOf(event),
      payload: new Map<string, string>([["kind", event.kind]]),
      provenance: { source: "initial-import" },
    })),
  };
  const commit = await codec.sealEventCommit(body, hash.sha256);

  const applied = await projection.applyEvents(restarted, [{ commit, events: typed }]).then(
    () => "applied",
    (cause: unknown) => String(cause),
  );
  if (input.variant === "field-without-table") {
    return refusal(applied, restarted);
  }

  const after = (sql: string) => engine.selectRows(restarted, sql);
  const tail = {
    tables: after("SELECT display_name, key_field_id FROM schema_tables ORDER BY table_ordinal").map((row) => row.map(hex).join("|")),
    sheets: after("SELECT display_name FROM sheet_snapshots ORDER BY sheet_ordinal").map((row) => hex(row[0])),
    fields: after(`SELECT display_name, logical_type FROM schema_fields WHERE table_id = x'${hex(deliveriesId)}' ORDER BY field_ordinal`).map((row) => row.map(hex).join("|")),
    options: after("SELECT display_label FROM enum_options").map((row) => hex(row[0])),
    records: Number(after(`SELECT count(*) FROM records WHERE table_id = x'${hex(deliveriesId)}'`)[0]?.[0]),
    schemaRevision: Number(after("SELECT schema_revision FROM app_state")[0]?.[0]),
    history: after("SELECT event_kind, subject_kind FROM change_history ORDER BY event_id").map((row) => row.map(hex).join("|")),
  };
  projection.disposeProjection(restarted);

  return {
    sheets,
    tables: tableNames,
    relationships,
    rules,
    inert,
    lineages,
    decisions,
    issues,
    issueParameters,
    firstDump,
    restartDump,
    tail,
    failure: applied,
    refusedAfterFailure: "",
  };

  function refusal(failure: string, disposed = handle): Outcome {
    let refusedAfterFailure = "still answering";
    try {
      engine.selectRows(disposed, "SELECT count(*) FROM records");
    } catch (cause) {
      refusedAfterFailure = String(cause);
    }
    return {
      sheets: [],
      tables: [],
      relationships: [],
      rules: 0,
      inert: [],
      lineages: [],
      decisions: [],
      issues: [],
      issueParameters: [],
      firstDump: [],
      restartDump: [],
      tail: null,
      failure,
      refusedAfterFailure,
    };
  }
}

const idHex = (fill: number): string => fill.toString(16).padStart(2, "0").repeat(16);

let page: Page;
let outcome: Outcome;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto("/harness.html");
  outcome = await page.evaluate(runWorkbook, { variant: "valid" as const });
});

test.afterAll(async () => {
  await page.close();
});

test("CA-20: every sheet keeps its real classification and revision", () => {
  expect(outcome.sheets).toEqual([
    { name: "Suppliers", roles: ["table", "lookup"], revision: 1 },
    { name: "Orders", roles: ["table"], revision: 1 },
    { name: "Overview", roles: ["summary", "chart"], revision: 1 },
  ]);
  expect(outcome.tables).toEqual(["Suppliers", "Orders"]);
});

test("CA-20: the relationship, rule, inert items, lineage, and decision are rows", () => {
  expect(outcome.relationships).toEqual([
    [idHex(8), idHex(3), idHex(5), "lookup-formula", "1"].join("|"),
  ]);
  expect(outcome.rules).toBe(1);
  expect(outcome.inert).toEqual([
    `chart|Overview!B2:F9|chart-not-live-yet|${JSON.stringify({ firstRow: 1, firstColumn: 1, lastRow: 8, lastColumn: 5 })}|null`,
    `formula|Orders!C2:C4|formula-not-live-yet|no-anchor|${idHex(0x43)}`,
  ]);
  expect(outcome.lineages).toEqual([["initial", "0", "supply.xlsx", "32", idHex(15)].join("|")]);
  expect(outcome.decisions).toEqual(["relationship|rejected|32"]);
});

test("D36: broken references are the validator's warnings, and name no key", () => {
  expect(outcome.issues).toEqual([
    [idHex(12), "broken-reference", "warning", "validation.broken-reference"].join("|"),
    [idHex(13), "broken-reference", "warning", "validation.broken-reference"].join("|"),
  ]);
  for (const parameters of outcome.issueParameters) {
    expect(parameters).toContain("Suppliers");
    expect(parameters).not.toContain("SUP-404");
  }
});

test("a restart re-hydrates row for row", () => {
  expect(outcome.firstDump.length).toBeGreaterThan(20);
  expect(outcome.restartDump).toEqual(outcome.firstDump);
});

test("CA-23: a tail commit that creates a table builds it", () => {
  expect(outcome.failure).toBe("applied");
  expect(outcome.tail).toEqual({
    tables: ["Suppliers|" + idHex(5), "Orders|null", "Deliveries|" + idHex(31)],
    sheets: ["Suppliers", "Orders", "Overview", "deliveries.csv"],
    fields: ["Code|text", "Status|enum"],
    options: ["Open"],
    records: 2,
    schemaRevision: 2,
    history: [
      "table.created|table",
      "field.created|field",
      "field.created|field",
      "enum.changed|field",
      "record.created|record",
      "record.created|record",
    ],
  });
});

test("a relationship to a non-key field disposes the whole projection", async ({ browser }) => {
  const poisoned = await browser.newPage();
  try {
    await poisoned.goto("/harness.html");
    const refused = await poisoned.evaluate(runWorkbook, {
      variant: "non-key-relationship" as const,
    });
    expect(refused.failure).toContain("relationship endpoints do not match");
    expect(refused.refusedAfterFailure).toContain("disposed");
  } finally {
    await poisoned.close();
  }
});

test("a field.created for a table the projection lacks disposes it", async ({ browser }) => {
  const poisoned = await browser.newPage();
  try {
    await poisoned.goto("/harness.html");
    const refused = await poisoned.evaluate(runWorkbook, {
      variant: "field-without-table" as const,
    });
    expect(refused.failure).toContain("table this projection lacks");
    expect(refused.refusedAfterFailure).toContain("disposed");
  } finally {
    await poisoned.close();
  }
});
