import { expect, test, type Page } from "@playwright/test";

/**
 * CA-25 / CA-27 / CA-28 replay in a real browser (S03 CP1): every F04 schema,
 * rule and formula event lands on a hydrated projection through real SQLite
 * WASM, and the rows read back are the definitions the events carried.
 *
 * Migration 005's triggers are the judges here, not this spec: a computed
 * field and its formula name each other through a deferred reference that
 * must close by commit, a formula's computed-column target must name it back,
 * a relationship's endpoints must match their tables and keys, and a reorder
 * must never pass through a duplicate ordinal. The negative case plants a
 * formula whose field does not name it and requires the whole projection to
 * be disposed rather than the event skipped.
 */

type CheckpointV1 = import("../../../src/persistence/projection/types.js").ProjectionCheckpointV1;
type ProjectionCommitV1 = import("../../../src/persistence/projection/types.js").ProjectionCommitV1;
type DomainEventV1 = import("../../../src/application/ports/event-repository.js").DomainEventV1;
type FieldDefV1 = import("../../../src/domain/model/schema.js").FieldDefV1;
type WireEventV1 = import("../../../src/migrations/004_event_format_v1.js").DomainEventV1;
type EventCommitBodyV1 = import("../../../src/persistence/codecs/event-commit.js").EventCommitBodyV1;

interface ReplayReport {
  readonly appName: string;
  readonly tables: readonly string[];
  readonly jobsFields: readonly string[];
  readonly fieldRows: readonly string[];
  readonly formulas: readonly string[];
  readonly listedFormulas: readonly string[];
  readonly dependencies: readonly string[];
  readonly rules: readonly string[];
  readonly listedRuleVersions: readonly number[];
  readonly relationships: readonly string[];
  readonly history: readonly string[];
  readonly issues: readonly string[];
  readonly lanes: readonly string[];
  readonly schemaRevision: number;
  readonly revalidated: number;
  readonly refusal: string;
  readonly refusedAfterFailure: string;
}

async function replaySchemaEvents(): Promise<ReplayReport> {
  const harness = window.__sheafHarness;
  const [projection, engine, ids, bytesModule, values, codec, hash] = await Promise.all([
    harness.module<typeof import("../../../src/persistence/projection/index.js")>("/src/persistence/projection/index.ts"),
    harness.module<typeof import("../../../src/persistence/projection/engine.js")>("/src/persistence/projection/engine.ts"),
    harness.module<typeof import("../../../src/domain/model/ids.js")>("/src/domain/model/ids.ts"),
    harness.module<typeof import("../../../src/domain/model/bytes.js")>("/src/domain/model/bytes.ts"),
    harness.module<typeof import("../../../src/domain/model/values.js")>("/src/domain/model/values.ts"),
    harness.module<typeof import("../../../src/persistence/codecs/event-commit.js")>("/src/persistence/codecs/event-commit.ts"),
    harness.module<typeof import("../../../src/crypto/hash.js")>("/src/crypto/hash.ts"),
  ]);

  const bytes = (fill: number): Uint8Array => new Uint8Array(16).fill(fill);
  const hex = (value: unknown): string =>
    value instanceof Uint8Array
      ? [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("")
      : String(value === null ? "null" : (value as number | string));
  const digest = new Uint8Array(32).fill(0x0d);

  const appId = ids.asDomainId("app", bytes(1));
  const jobsId = ids.asDomainId("table", bytes(2));
  const customersId = ids.asDomainId("table", bytes(3));
  const deviceId = bytes(4);
  const genesis = ids.asDomainId("commit", bytes(5));
  const balanceFormula = ids.asDomainId("formula", bytes(6));
  const metricFormula = ids.asDomainId("formula", bytes(7));
  const dashboardFormula = ids.asDomainId("formula", bytes(8));
  const relationshipId = ids.asDomainId("relationship", bytes(9));
  const ruleId = ids.asDomainId("rule", bytes(0x0a));

  const field = (fill: number, tableId: typeof jobsId, displayName: string, fieldOrdinal: number, type: FieldDefV1["type"]): FieldDefV1 => ({
    fieldId: ids.asDomainId("field", bytes(fill)),
    tableId,
    displayName,
    fieldOrdinal,
    type,
    isRequired: false,
    isActive: true,
    schemaRevision: 1n,
  });
  const code = field(0x10, jobsId, "Job ID", 0, { kind: "text" });
  const quoted = field(0x11, jobsId, "Quoted", 1, { kind: "number" });
  const paid = field(0x12, jobsId, "Paid", 2, { kind: "number" });
  const customer = field(0x13, jobsId, "Customer", 3, { kind: "text" });
  const customerKey = field(0x14, customersId, "Customer ID", 0, { kind: "text" });
  const balance: FieldDefV1 = {
    ...field(0x15, jobsId, "Balance", 4, { kind: "number" }),
    formulaId: balanceFormula,
    schemaRevision: 6n,
  };

  const record = (fill: number, tableId: typeof jobsId, entries: readonly (readonly [FieldDefV1, ReturnType<typeof values.textValue>])[]) => ({
    record: {
      recordId: ids.asDomainId("record", bytes(fill)),
      tableId,
      values: new Map(entries.map(([definition, value]) => [definition.fieldId, value])),
      provenance: new Map(),
    },
    recordRevision: 0n,
    createdCommitId: genesis,
    updatedCommitId: genesis,
    issues: [],
  });

  const checkpoint = (): CheckpointV1 => ({
    appId,
    checkpointStorageId: bytesModule.asStorageId16(bytes(0x0b)),
    checkpointSemanticSha256: digest,
    frontier: [{ deviceId, commitSequence: 1n }],
    hydratedAtMs: 1_700_000_000_000,
    appState: {
      appId,
      displayName: "Fieldwork",
      createdAtMs: 1_700_000_000_000,
      lastOpenedAtMs: null,
      schemaRevision: 1n,
      locality: "present",
      durableHomeId: null,
      lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 1,
      theme: {
        themeKey: "sheaf.built-in.v1",
        tokens: {
          "app-ink": "#17231e",
          "app-canvas": "#f5f1e7",
          "app-surface": "#fffdf8",
          "app-primary": "#315c49",
          "app-accent": "#c66948",
          "app-muted": "#e2ded2",
        },
      },
      stateRevision: 1n,
    },
    sheetSnapshots: [],
    tables: [
      {
        tableId: jobsId,
        displayName: "Jobs",
        tableOrdinal: 0,
        fields: [code, quoted, paid, customer],
        keyFieldId: code.fieldId,
        labelFieldId: null,
        sourceSheetId: null,
        isActive: true,
        schemaRevision: 1n,
      },
      {
        tableId: customersId,
        displayName: "Customers",
        tableOrdinal: 1,
        fields: [customerKey],
        keyFieldId: customerKey.fieldId,
        labelFieldId: null,
        sourceSheetId: null,
        isActive: true,
        schemaRevision: 1n,
      },
    ],
    enumOptions: [],
    relationships: [],
    validationRules: [],
    formulas: [],
    inertItems: [],
    importLineages: [],
    inferenceDecisions: [],
    recordPages: [
      {
        records: [
          record(0x20, jobsId, [
            [code, values.textValue("J-001")],
            [quoted, values.decimalValue("120")],
            [paid, values.decimalValue("20")],
            [customer, values.textValue("C-001")],
          ]),
          record(0x21, jobsId, [
            [code, values.textValue("J-002")],
            [quoted, values.decimalValue("80")],
            [customer, values.textValue("C-001")],
          ]),
          record(0x22, customersId, [[customerKey, values.textValue("C-001")]]),
        ],
      },
    ],
  });

  const impact = (change: string) => ({
    change,
    total: 2,
    affected: 0,
    unchanged: 2,
    converted: 0,
    keptAndFlagged: 0,
    missingNow: 0,
    onRemovedOptions: 0,
    matchedKeys: 0,
    unmatchedKeys: 0,
    unlinkedReferences: 0,
    failingRule: 0,
    formulaErrors: 0,
  }) as never;
  const metadata = { catalogVersion: 1, functionVersions: [], source: "authored", importedValuePolicy: "none" } as const;
  const jobsDefinition = {
    tableId: jobsId,
    displayName: "Jobs",
    tableOrdinal: 0,
    keyFieldId: code.fieldId,
    labelFieldId: null,
    sourceSheetId: null,
    isActive: true,
    schemaRevision: 1n,
  };
  const relationship = {
    relationshipId,
    fromTableId: jobsId,
    fromFieldId: customer.fieldId,
    toTableId: customersId,
    toKeyFieldId: customerKey.fieldId,
    detectionSource: "user" as const,
    isActive: true,
    schemaRevision: 8n,
  };
  const metric = {
    formulaId: metricFormula,
    target: { kind: "table-metric" as const, tableId: jobsId },
    displayName: "Paid total",
    originalText: "SUM(Jobs[Paid])",
    document: {
      irVersion: 1 as const,
      root: { kind: "call" as const, name: "SUM" as const, version: 1, args: [{ kind: "column" as const, tableId: jobsId, fieldId: paid.fieldId }] },
    },
    disposition: "live" as const,
    determinism: "deterministic" as const,
    dependencies: [{ kind: "field" as const, fieldId: paid.fieldId }],
  };

  /** Each entry is one commit: its events and the subject each event names. */
  const commits: readonly (readonly (readonly [DomainEventV1, WireEventV1["subject"]])[])[] = [
    [[{ kind: "app.renamed", payload: { priorNameSha256: digest, displayName: "Fieldwork 2026" } }, { appId }]],
    [
      [
        {
          kind: "table.changed",
          payload: { priorSha256: digest, before: jobsDefinition, after: { ...jobsDefinition, displayName: "Jobs 2026", labelFieldId: customer.fieldId }, impact: impact("set-table-label") },
        },
        { appId, tableId: jobsId },
      ],
    ],
    [
      [
        {
          kind: "field.changed",
          payload: { before: quoted, after: { ...quoted, type: { kind: "currency", currencyCode: "EUR" }, schemaRevision: 4n }, impact: impact("change-field-type") },
        },
        { appId, tableId: jobsId, fieldId: quoted.fieldId },
      ],
    ],
    // A swap: without parking, the first update would duplicate an ordinal.
    [
      [
        {
          kind: "field.changed",
          payload: {
            before: { ...quoted, type: { kind: "currency", currencyCode: "EUR" }, schemaRevision: 4n },
            after: { ...quoted, type: { kind: "currency", currencyCode: "EUR" }, fieldOrdinal: 2, schemaRevision: 5n },
            impact: impact("reorder-fields"),
          },
        },
        { appId, tableId: jobsId, fieldId: quoted.fieldId },
      ],
      [
        { kind: "field.changed", payload: { before: paid, after: { ...paid, fieldOrdinal: 1, schemaRevision: 5n }, impact: impact("reorder-fields") } },
        { appId, tableId: jobsId, fieldId: paid.fieldId },
      ],
    ],
    // The computed field first, naming a formula that lands one event later:
    // the deferred reference closes by commit, and the target trigger passes.
    [
      [{ kind: "field.created", payload: { field: balance, evidence: null } }, { appId, tableId: jobsId, fieldId: balance.fieldId }],
      [
        {
          kind: "formula.changed",
          payload: {
            formula: {
              formulaId: balanceFormula,
              target: { kind: "computed-column", tableId: jobsId, fieldId: balance.fieldId },
              displayName: null,
              originalText: "[Quoted]-[Paid]",
              document: {
                irVersion: 1,
                root: { kind: "binary", operator: "-", left: { kind: "field", fieldId: quoted.fieldId }, right: { kind: "field", fieldId: paid.fieldId } },
              },
              disposition: "live",
              determinism: "deterministic",
              dependencies: [
                { kind: "field", fieldId: quoted.fieldId },
                { kind: "field", fieldId: paid.fieldId },
              ],
            },
            metadata,
            priorSha256: null,
          },
        },
        { appId, tableId: jobsId, fieldId: balance.fieldId, objectId: balanceFormula },
      ],
    ],
    [
      [{ kind: "formula.changed", payload: { formula: metric, metadata, priorSha256: null } }, { appId, tableId: jobsId, objectId: metricFormula }],
      [
        {
          kind: "formula.changed",
          payload: {
            formula: {
              formulaId: dashboardFormula,
              target: { kind: "dashboard-value", tableId: null },
              displayName: "Doubled",
              originalText: "[Paid total]*2",
              document: {
                irVersion: 1,
                root: {
                  kind: "binary",
                  operator: "*",
                  left: { kind: "formula", formulaId: metricFormula },
                  right: { kind: "literal", value: { kind: "decimal", decimal: "2" } },
                },
              },
              disposition: "live",
              determinism: "deterministic",
              dependencies: [{ kind: "formula", formulaId: metricFormula }],
            },
            metadata,
            priorSha256: null,
          },
        },
        { appId, objectId: dashboardFormula },
      ],
    ],
    // Text → reference with its relationship, in one commit (D64).
    [
      [
        { kind: "field.changed", payload: { before: customer, after: { ...customer, type: { kind: "reference" }, schemaRevision: 8n }, impact: impact("set-relationship") } },
        { appId, tableId: jobsId, fieldId: customer.fieldId },
      ],
      [{ kind: "relationship.changed", payload: { relationship, priorSha256: null } }, { appId, tableId: jobsId, fieldId: customer.fieldId, objectId: relationshipId }],
    ],
    [[{ kind: "relationship.changed", payload: { relationship: { ...relationship, isActive: false }, priorSha256: digest } }, { appId, tableId: jobsId, fieldId: customer.fieldId, objectId: relationshipId }]],
    [[{ kind: "relationship.removed", payload: { relationship, rejectionFingerprint: digest } }, { appId, tableId: jobsId, fieldId: customer.fieldId, objectId: relationshipId }]],
    [
      [
        {
          kind: "rule.changed",
          payload: {
            tableId: jobsId,
            displayName: "Paid within quote",
            rule: {
              irVersion: 2,
              ruleId,
              condition: { kind: "compare", left: paid.fieldId, op: "le", right: { field: quoted.fieldId } },
              severity: "warning",
              messageKey: "rule-compare",
              messageParameters: { leftLabel: "Paid", rightLabel: "Quoted" },
            },
            priorSha256: null,
          },
        },
        { appId, tableId: jobsId, objectId: ruleId },
      ],
    ],
    [
      [
        {
          kind: "rule.removed",
          payload: {
            tableId: jobsId,
            displayName: "Paid within quote",
            rule: {
              irVersion: 2,
              ruleId,
              condition: { kind: "compare", left: paid.fieldId, op: "le", right: { field: quoted.fieldId } },
              severity: "warning",
              messageKey: "rule-compare",
              messageParameters: { leftLabel: "Paid", rightLabel: "Quoted" },
            },
            impact: impact("remove-rule"),
          },
        },
        { appId, tableId: jobsId, objectId: ruleId },
      ],
    ],
    [[{ kind: "formula.removed", payload: { formula: metric, metadata, impact: impact("remove-formula") } }, { appId, tableId: jobsId, objectId: metricFormula }]],
  ];

  let revalidated = 0;
  const revalidate: ProjectionCommitV1["revalidate"] = (authored) => {
    revalidated += 1;
    // A stand-in verdict: the projection only asks, so any issue proves the
    // re-judged records received the caller's answer.
    return authored.tableId[0] === jobsId[0]
      ? [{ fieldId: null, ruleId: null, kind: "schema", severity: "warning", messageKey: "probe.rejudged", messageParameters: {} }]
      : [];
  };

  const seal = async (
    events: readonly (readonly [DomainEventV1, WireEventV1["subject"]])[],
    index: number,
    previous: Uint8Array,
    tamper: boolean,
  ): Promise<ProjectionCommitV1> => {
    const body: EventCommitBodyV1 = {
      eventFormatVersion: 1,
      commitId: bytes(0x40 + index),
      appId,
      deviceId,
      deviceCommitSequence: BigInt(index + 2),
      previousDeviceCommitSha256: previous,
      basisFrontier: [{ deviceId, commitSequence: BigInt(index + 1) }],
      hybridTime: { wallTimeMs: 1_700_000_100_000n + BigInt(index) * 1_000n, logicalCounter: 0 },
      eventClass: "authored",
      schemaRevisionBefore: BigInt(index + 1),
      schemaRevisionAfter: BigInt(index + 2),
      events: events.map(([event, subject], eventIndex) => ({
        eventId: Uint8Array.from({ length: 16 }, (_unused, position) => (position === 0 ? 0x60 + index : eventIndex)),
        eventIndex,
        kind: event.kind,
        subject,
        payload: new Map([["kind", event.kind]]),
        provenance: { source: "user" },
      })),
    };
    const sealed = await codec.sealEventCommit(body, hash.sha256);
    const typed = tamper
      ? events.map(([event]) =>
          event.kind === "formula.changed"
            ? { ...event, payload: { ...event.payload, formula: { ...event.payload.formula, target: { kind: "computed-column" as const, tableId: jobsId, fieldId: code.fieldId } } } }
            : event,
        )
      : events.map(([event]) => event);
    return { commit: sealed, events: typed, revalidate };
  };

  const handle = await projection.openProjection({ sha256: hash.sha256, clock: () => ({ epochDay: 20_000, epochMs: 1_728_000_000_000 }) });
  await projection.hydrateApp(handle, checkpoint());
  let previous: Uint8Array = new Uint8Array(32).fill(0x0c);
  for (const [index, events] of commits.entries()) {
    const commit = await seal(events, index, previous, false);
    previous = commit.commit.commitSha256;
    await projection.applyEvents(handle, [commit]);
  }

  const rows = (sql: string) => engine.selectRows(handle, sql);
  const report = {
    appName: projection.executeQuery(handle, { kind: "app-state" }).displayName,
    tables: projection.executeQuery(handle, { kind: "list-tables" }).map((table) => `${table.displayName}:${hex(table.labelFieldId)}`),
    jobsFields: projection
      .executeQuery(handle, { kind: "list-fields", tableId: jobsId })
      .map((definition) =>
        [definition.displayName, definition.fieldOrdinal, JSON.stringify(definition.type), definition.formulaId === undefined ? "authored" : hex(definition.formulaId)].join("|"),
      ),
    fieldRows: rows("SELECT display_name, field_ordinal, storage_kind, is_computed, hex(formula_id) FROM schema_fields ORDER BY field_id").map((row) => row.map(hex).join("|")),
    formulas: rows("SELECT hex(formula_id), target_kind, disposition, determinism, is_active, schema_revision FROM formulas ORDER BY formula_id").map((row) => row.map(hex).join("|")),
    listedFormulas: projection.executeQuery(handle, { kind: "list-formulas", tableId: null }).map((entry) => `${entry.formula.originalText}|${entry.isActive}`),
    dependencies: rows("SELECT hex(formula_id), dependency_kind, hex(dependency_id) FROM formula_dependencies ORDER BY formula_id, dependency_kind, dependency_id").map((row) => row.map(hex).join("|")),
    rules: rows("SELECT hex(rule_id), display_name, message_key, is_active FROM validation_rules").map((row) => row.map(hex).join("|")),
    listedRuleVersions: projection.executeQuery(handle, { kind: "list-validation-rules", tableId: jobsId }).map((entry) => entry.rule.irVersion),
    relationships: rows("SELECT is_active FROM relationships").map((row) => row.map(hex).join("|")),
    history: rows("SELECT event_kind, subject_kind, hex(subject_id) FROM change_history ORDER BY wall_time_ms, event_id").map((row) => row.map(hex).join("|")),
    issues: rows("SELECT message_key FROM record_issues ORDER BY record_pk, issue_id").map((row) => row.map(hex).join("|")),
    lanes: rows("SELECT field_id, value_kind, origin FROM cells ORDER BY record_pk, field_id").map((row) => row.map(hex).join("|")),
    schemaRevision: Number(rows("SELECT schema_revision FROM app_state")[0]![0]),
  };
  projection.disposeProjection(handle);

  // Negative: a formula whose computed-column field does not name it.
  const refused = await projection.openProjection({ sha256: hash.sha256, clock: () => ({ epochDay: 20_000, epochMs: 1_728_000_000_000 }) });
  await projection.hydrateApp(refused, checkpoint());
  let chain: Uint8Array = new Uint8Array(32).fill(0x0c);
  let refusal = "replayed";
  for (const [index, events] of commits.slice(0, 5).entries()) {
    const commit = await seal(events, index, chain, index === 4);
    chain = commit.commit.commitSha256;
    refusal = await projection.applyEvents(refused, [commit]).then(
      () => "replayed",
      (cause: unknown) => String(cause),
    );
    if (refusal !== "replayed") break;
  }
  const refusedAfterFailure = (() => {
    try {
      engine.selectRows(refused, "SELECT count(*) FROM formulas");
      return "still answering";
    } catch (cause) {
      return String(cause);
    }
  })();

  return { ...report, revalidated, refusal, refusedAfterFailure };
}

let page: Page;
let report: ReplayReport;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto("/harness.html");
  report = await page.evaluate(replaySchemaEvents);
});

test.afterAll(async () => {
  await page.close();
});

const hexOf = (fill: number): string => fill.toString(16).padStart(2, "0").repeat(16);

test("replays app, table and field edits onto the schema rows and caches (CA-28)", () => {
  expect(report.appName).toBe("Fieldwork 2026");
  expect(report.tables).toEqual([`Jobs 2026:${hexOf(0x13)}`, "Customers:null"]);
  // The reorder swapped Quoted and Paid without a duplicate ordinal, and the
  // currency code survived the type change through the definition cache.
  expect(report.jobsFields).toEqual([
    "Job ID|0|{\"kind\":\"text\"}|authored",
    "Paid|1|{\"kind\":\"number\"}|authored",
    "Quoted|2|{\"kind\":\"currency\",\"currencyCode\":\"EUR\"}|authored",
    "Customer|3|{\"kind\":\"reference\"}|authored",
    `Balance|4|{"kind":"number"}|${hexOf(0x06)}`,
  ]);
  expect(report.schemaRevision).toBe(13);
});

test("closes the computed field ↔ formula cycle and stores every formula with its edges (CA-25)", () => {
  expect(report.fieldRows).toContain(`Balance|4|decimal|1|${hexOf(0x06).toUpperCase()}`);
  expect(report.formulas).toEqual([
    `${hexOf(0x06).toUpperCase()}|computed-column|live|deterministic|1|6`,
    `${hexOf(0x07).toUpperCase()}|table-metric|live|deterministic|0|13`,
    `${hexOf(0x08).toUpperCase()}|dashboard-value|live|deterministic|1|7`,
  ]);
  expect(report.listedFormulas).toEqual(["[Quoted]-[Paid]|true", "SUM(Jobs[Paid])|false", "[Paid total]*2|true"]);
  expect(report.dependencies).toEqual([
    `${hexOf(0x06).toUpperCase()}|field|${hexOf(0x11).toUpperCase()}`,
    `${hexOf(0x06).toUpperCase()}|field|${hexOf(0x12).toUpperCase()}`,
    `${hexOf(0x07).toUpperCase()}|field|${hexOf(0x12).toUpperCase()}`,
    `${hexOf(0x08).toUpperCase()}|formula|${hexOf(0x07).toUpperCase()}`,
  ]);
  // Only the computed column's lanes are recalculation's; every other lane
  // is authored, and no authored lane was written for the computed field.
  const balanceLanes = report.lanes.filter((lane) => lane.startsWith(hexOf(0x15)));
  expect(balanceLanes.length).toBeGreaterThan(0);
  expect(balanceLanes.every((lane) => lane.endsWith("|computed"))).toBe(true);
  expect(report.lanes.filter((lane) => !lane.startsWith(hexOf(0x15))).every((lane) => lane.endsWith("|authored"))).toBe(true);
});

test("upserts a v2 rule and retires it, and removes a relationship after disabling it (CA-27)", () => {
  expect(report.rules).toEqual([`${hexOf(0x0a).toUpperCase()}|Paid within quote|rule-compare|0`]);
  expect(report.listedRuleVersions).toEqual([]);
  expect(report.relationships).toEqual([]);
});

test("files each event under migration 005's subject kinds", () => {
  const kinds = report.history.map((row) => row.split("|").slice(0, 2).join("|"));
  expect(kinds).toEqual([
    "app.renamed|app",
    "table.changed|table",
    "field.changed|field",
    "field.changed|field",
    "field.changed|field",
    "field.created|field",
    "formula.changed|formula",
    "formula.changed|formula",
    "formula.changed|formula",
    "field.changed|field",
    "relationship.changed|field",
    "relationship.changed|field",
    "relationship.removed|field",
    "rule.changed|rule",
    "rule.removed|rule",
    "formula.removed|formula",
  ]);
  expect(report.history.find((row) => row.startsWith("rule.changed"))).toContain(hexOf(0x0a).toUpperCase());
});

test("re-judges a re-shaped table's records through the caller's validator", () => {
  expect(report.revalidated).toBeGreaterThan(0);
  expect(report.issues).toEqual(["probe.rejudged", "probe.rejudged"]);
});

test("disposes the projection when a formula's target field does not name it", () => {
  expect(report.refusal).toContain("computed formula target does not match its field");
  expect(report.refusedAfterFailure).toContain("disposed");
});
