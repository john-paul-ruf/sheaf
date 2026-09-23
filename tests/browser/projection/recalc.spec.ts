import { expect, test, type Page } from "@playwright/test";

/**
 * D60 / CA-26, the SQL half, in a real browser over real SQLite WASM (S03
 * CP2). The pure planner is `tests/unit/workers/recalc.test.ts`; this proves
 * what recalculation writes and when:
 *
 * - every CA-26 state lands as its lane, its `formula` issue, or neither;
 * - a record write re-derives only what the moved field reaches — counted
 *   through the evaluator calls, and seen in a clock column left alone;
 * - a cycle is flagged and never evaluated;
 * - a `TODAY()` column moves with the clock and nothing else;
 * - no result appears in the bytes of an encoded commit or checkpoint.
 */

type CheckpointV1 = import("../../../src/persistence/projection/types.js").ProjectionCheckpointV1;
type FieldDefV1 = import("../../../src/domain/model/schema.js").FieldDefV1;
type FormulaDefinitionV1 = import("../../../src/domain/formulas/ir.js").FormulaDefinitionV1;
type CellValueV1 = import("../../../src/domain/model/values.js").CellValueV1;
type EventCommitBodyV1 = import("../../../src/persistence/codecs/event-commit.js").EventCommitBodyV1;

interface RecalcReport {
  readonly hydrated: Record<string, Record<string, string>>;
  readonly scalars: readonly string[];
  readonly hydrateEvaluations: number;
  readonly issueKeys: readonly string[];
  readonly lanes: readonly string[];
  readonly patchedFieldNames: readonly string[];
  readonly afterPatch: Record<string, string>;
  readonly downstreamEvaluations: number;
  readonly refreshed: readonly string[];
  readonly afterRefresh: Record<string, string>;
  readonly freshRefresh: readonly string[];
  readonly created: Record<string, string>;
  readonly searchHits: number;
  readonly commitHasResult: boolean;
  readonly commitHasAuthored: boolean;
  readonly checkpointHasResult: boolean;
}

async function runRecalc(): Promise<RecalcReport> {
  const harness = window.__sheafHarness;
  const [projection, engine, recalc, ids, bytesModule, values, codec, hash, payloads, roots] = await Promise.all([
    harness.module<typeof import("../../../src/persistence/projection/index.js")>("/src/persistence/projection/index.ts"),
    harness.module<typeof import("../../../src/persistence/projection/engine.js")>("/src/persistence/projection/engine.ts"),
    harness.module<typeof import("../../../src/persistence/projection/recalc.js")>("/src/persistence/projection/recalc.ts"),
    harness.module<typeof import("../../../src/domain/model/ids.js")>("/src/domain/model/ids.ts"),
    harness.module<typeof import("../../../src/domain/model/bytes.js")>("/src/domain/model/bytes.ts"),
    harness.module<typeof import("../../../src/domain/model/values.js")>("/src/domain/model/values.ts"),
    harness.module<typeof import("../../../src/persistence/codecs/event-commit.js")>("/src/persistence/codecs/event-commit.ts"),
    harness.module<typeof import("../../../src/crypto/hash.js")>("/src/crypto/hash.ts"),
    harness.module<typeof import("../../../src/workers/data/record-event-payloads.js")>("/src/workers/data/record-event-payloads.ts"),
    harness.module<typeof import("../../../src/import/staging/roots.js")>("/src/import/staging/roots.ts"),
  ]);

  const bytes = (fill: number): Uint8Array => new Uint8Array(16).fill(fill);
  const appId = ids.asDomainId("app", bytes(1));
  const tableId = ids.asDomainId("table", bytes(2));
  const deviceId = bytes(3);
  const genesis = ids.asDomainId("commit", bytes(4));
  const DAY = 86_400_000;
  let now = { epochDay: 20_000, epochMs: 20_000 * DAY + 3_600_000 };

  const names = new Map<string, string>();
  const field = (fill: number, displayName: string, fieldOrdinal: number, type: FieldDefV1["type"], formulaFill?: number): FieldDefV1 => {
    const definition: FieldDefV1 = {
      fieldId: ids.asDomainId("field", bytes(fill)),
      tableId,
      displayName,
      fieldOrdinal,
      type,
      isRequired: false,
      isActive: true,
      schemaRevision: 1n,
      ...(formulaFill === undefined ? {} : { formulaId: ids.asDomainId("formula", bytes(formulaFill)) }),
    };
    names.set(ids.encodeDomainId(definition.fieldId), displayName);
    return definition;
  };
  const code = field(0x10, "Code", 0, { kind: "text" });
  const quoted = field(0x11, "Quoted", 1, { kind: "number" });
  const paid = field(0x12, "Paid", 2, { kind: "number" });
  const due = field(0x13, "Due", 3, { kind: "date" });
  const label = field(0x14, "Label", 4, { kind: "text" });
  const note = field(0x15, "Note", 5, { kind: "text" });
  const balance = field(0x20, "Balance", 6, { kind: "number" }, 0x40);
  const half = field(0x21, "Half", 7, { kind: "number" }, 0x41);
  const named = field(0x22, "Named", 8, { kind: "number" }, 0x42);
  const echo = field(0x23, "Echo", 9, { kind: "text" }, 0x43);
  const age = field(0x24, "Age", 10, { kind: "number" }, 0x44);
  const loopA = field(0x25, "LoopA", 11, { kind: "number" }, 0x45);
  const loopB = field(0x26, "LoopB", 12, { kind: "number" }, 0x46);
  const kept = field(0x27, "Kept", 13, { kind: "number" }, 0x47);
  const frozen = field(0x28, "Frozen", 14, { kind: "number" }, 0x48);

  const read = (definition: FieldDefV1) => ({ kind: "field" as const, fieldId: definition.fieldId });
  const column = (target: FieldDefV1, root: FormulaDefinitionV1["document"], fields: readonly FieldDefV1[], extra: Partial<FormulaDefinitionV1> = {}): FormulaDefinitionV1 => ({
    formulaId: target.formulaId!,
    target: { kind: "computed-column", tableId, fieldId: target.fieldId },
    displayName: null,
    originalText: target.displayName,
    document: root,
    disposition: "live",
    determinism: "deterministic",
    dependencies: fields.map((definition) => ({ kind: "field" as const, fieldId: definition.fieldId })),
    ...extra,
  });
  const doc = (root: NonNullable<FormulaDefinitionV1["document"]>["root"]) => ({ irVersion: 1 as const, root });
  const metricId = ids.asDomainId("formula", bytes(0x49));
  const formulas: FormulaDefinitionV1[] = [
    column(balance, doc({ kind: "binary", operator: "-", left: read(quoted), right: read(paid) }), [quoted, paid]),
    column(half, doc({ kind: "binary", operator: "/", left: read(quoted), right: read(paid) }), [quoted, paid]),
    column(named, doc(read(label)), [label]),
    column(echo, doc(read(note)), [note]),
    column(age, doc({ kind: "binary", operator: "-", left: { kind: "call", name: "TODAY", version: 1, args: [] }, right: read(due) }), [due], {
      determinism: "clock-volatile",
    }),
    column(loopA, doc(read(loopB)), [loopB]),
    column(loopB, doc(read(loopA)), [loopA]),
    column(kept, null, [], { disposition: "unsupported", determinism: "unsupported" }),
    column(frozen, doc({ kind: "call", name: "RAND", version: 1, args: [] }), [], { disposition: "frozen", determinism: "frozen-nondeterministic" }),
    {
      formulaId: metricId,
      target: { kind: "table-metric", tableId },
      displayName: "Quoted total",
      originalText: "SUM(Jobs[Quoted])",
      document: doc({ kind: "call", name: "SUM", version: 1, args: [{ kind: "column", tableId, fieldId: quoted.fieldId }] }),
      disposition: "live",
      determinism: "deterministic",
      dependencies: [{ kind: "field", fieldId: quoted.fieldId }],
    },
    {
      formulaId: ids.asDomainId("formula", bytes(0x4a)),
      target: { kind: "dashboard-value", tableId: null },
      displayName: "Doubled total",
      originalText: "[Quoted total]*2",
      document: doc({
        kind: "binary",
        operator: "*",
        left: { kind: "formula", formulaId: metricId },
        right: { kind: "literal", value: { kind: "decimal", decimal: "2" } },
      }),
      disposition: "live",
      determinism: "deterministic",
      dependencies: [{ kind: "formula", formulaId: metricId }],
    },
  ];
  const metadata = { catalogVersion: 1, functionVersions: [], source: "imported", importedValuePolicy: "kept-as-literal" } as const;

  const r1 = ids.asDomainId("record", bytes(0x30));
  const r2 = ids.asDomainId("record", bytes(0x31));
  const r3 = ids.asDomainId("record", bytes(0x32));
  const row = (recordId: typeof r1, entries: readonly (readonly [FieldDefV1, CellValueV1])[]) => ({
    record: { recordId, tableId, values: new Map(entries.map(([definition, value]) => [definition.fieldId, value])), provenance: new Map() },
    recordRevision: 0n,
    createdCommitId: genesis,
    updatedCommitId: genesis,
    issues: [],
  });
  const fields = [code, quoted, paid, due, label, note, balance, half, named, echo, age, loopA, loopB, kept, frozen];
  const checkpoint: CheckpointV1 = {
    appId,
    checkpointStorageId: bytesModule.asStorageId16(bytes(5)),
    checkpointSemanticSha256: new Uint8Array(32).fill(6),
    frontier: [{ deviceId, commitSequence: 1n }],
    hydratedAtMs: now.epochMs,
    appState: {
      appId,
      displayName: "Jobs",
      createdAtMs: 0,
      lastOpenedAtMs: null,
      schemaRevision: 1n,
      locality: "present",
      durableHomeId: null,
      lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 1,
      theme: {
        themeKey: "sheaf.built-in.v1",
        tokens: { "app-ink": "#000", "app-canvas": "#fff", "app-surface": "#fff", "app-primary": "#000", "app-accent": "#000", "app-muted": "#888" },
      },
      stateRevision: 1n,
    },
    sheetSnapshots: [],
    tables: [
      { tableId, displayName: "Jobs", tableOrdinal: 0, fields, keyFieldId: code.fieldId, labelFieldId: null, sourceSheetId: null, isActive: true, schemaRevision: 1n },
    ],
    enumOptions: [],
    relationships: [],
    validationRules: [],
    formulas: formulas.map((formula) => ({ formula, metadata, isActive: true, schemaRevision: 1n })),
    inertItems: [],
    importLineages: [],
    inferenceDecisions: [],
    recordPages: [
      {
        records: [
          row(r1, [
            [code, values.textValue("J1")],
            [quoted, values.decimalValue("12345.67")],
            [paid, values.decimalValue("1000.01")],
            [due, values.dateValue(19_990)],
            [label, values.textValue("oak")],
            [note, values.textValue("hello")],
            [kept, values.decimalValue("41")],
            [frozen, values.decimalValue("0.37")],
          ]),
          row(r2, [
            [code, values.textValue("J2")],
            [quoted, values.decimalValue("50")],
            [paid, values.decimalValue("0")],
            [due, values.dateValue(19_999)],
            [label, values.textValue("elm")],
          ]),
        ],
      },
    ],
  };

  const show = (cell: { state: string; value?: CellValueV1; code?: string }): string => {
    if (cell.state === "error") return `error:${cell.code ?? ""}`;
    if (cell.value === undefined) return cell.state;
    const value = cell.value;
    const text =
      value.kind === "decimal" ? value.decimal : value.kind === "text" ? value.text : value.kind === "date" ? String(value.epochDay) : value.kind;
    return `${cell.state}:${text}`;
  };
  const computedOf = (handle: Parameters<typeof projection.executeQuery>[0], recordId: typeof r1): Record<string, string> => {
    const detail = projection.executeQuery(handle, { kind: "record-by-id", recordId });
    return Object.fromEntries(
      (detail === null ? [] : [...detail.computed]).map(([fieldId, cell]) => [names.get(ids.encodeDomainId(fieldId)) ?? "?", show(cell)]),
    );
  };

  const handle = await projection.openProjection({ sha256: hash.sha256, clock: () => now });
  await projection.hydrateApp(handle, checkpoint);
  const hydrated = { r1: computedOf(handle, r1), r2: computedOf(handle, r2) };
  const scalars = projection
    .executeQuery(handle, { kind: "scalar-results" })
    .map((result) => `${result.status}:${result.value?.kind === "decimal" ? result.value.decimal : (result.code ?? "")}`);
  const issueKeys = engine
    .selectRows(handle, "SELECT message_key FROM record_issues WHERE issue_kind = 'formula' ORDER BY message_key")
    .map((entry) => entry[0] as string);
  const lanes = engine
    .selectRows(handle, "SELECT hex(field_id), origin FROM cells WHERE origin = 'computed' ORDER BY field_id, record_pk")
    .map((entry) => `${(entry[0] as string).slice(0, 2)}|${entry[1] as string}`);
  // The full pass, counted: five live columns × two rows, plus the two
  // scalars. The cycle pair, the unsupported and the frozen column are
  // never handed to the evaluator.
  const hydrateEvaluations = (await engine.withTransaction(handle, () => recalc.recalculate(handle, { kind: "all" }))).evaluations;

  // A day passes, and no one refreshes: a full recalculation would now move
  // Age, so Age staying put proves the patch reached only its downstream.
  now = { epochDay: 20_001, epochMs: 20_001 * DAY + 3_600_000 };
  const patchEvent = {
    kind: "record.patched" as const,
    payload: {
      recordId: r1,
      tableId,
      recordRevision: 1n,
      changes: [{ fieldId: paid.fieldId, before: values.decimalValue("1000.01"), after: values.decimalValue("2000.01"), provenance: { source: "user" as const } }],
      resultingRecordSha256: new Uint8Array(32).fill(7),
    },
  };
  const seal = (sequence: number, previous: Uint8Array | null, event: typeof patchEvent | { kind: "record.created"; payload: unknown }, subjectRecord: typeof r1) => {
    const body: EventCommitBodyV1 = {
      eventFormatVersion: 1,
      commitId: bytes(0x50 + sequence),
      appId,
      deviceId,
      deviceCommitSequence: BigInt(sequence),
      previousDeviceCommitSha256: previous,
      basisFrontier: [{ deviceId, commitSequence: BigInt(sequence - 1) }],
      hybridTime: { wallTimeMs: BigInt(now.epochMs + sequence), logicalCounter: 0 },
      eventClass: "authored",
      schemaRevisionBefore: 1n,
      schemaRevisionAfter: 1n,
      events: [
        {
          eventId: bytes(0x60 + sequence),
          eventIndex: 0,
          kind: event.kind,
          subject: { appId, tableId, recordId: subjectRecord },
          payload: payloads.encodeRecordEventPayload(event as never),
          provenance: { source: "user" },
        },
      ],
    };
    return codec.sealEventCommit(body, hash.sha256);
  };
  const patchCommit = await seal(2, new Uint8Array(32).fill(8), patchEvent, r1);
  const receipt = await projection.applyEvents(handle, [{ commit: patchCommit, events: [patchEvent] }]);
  const afterPatch = computedOf(handle, r1);
  const downstreamEvaluations = (
    await engine.withTransaction(handle, () =>
      recalc.recalculate(handle, { kind: "records", changedFieldIds: [paid.fieldId], recordKeys: [ids.encodeDomainId(r1)], insertedTableIds: [] }),
    )
  ).evaluations;

  // Only the clock moves Age.
  const refreshed = await projection.refreshVolatile(handle, 60_000);
  const afterRefresh = computedOf(handle, r1);
  const freshRefresh = await projection.refreshVolatile(handle, 60_000);

  // A new row: every column covers it, and the unsupported one says so.
  const createdEvent = {
    kind: "record.created" as const,
    payload: {
      record: {
        recordId: r3,
        tableId,
        values: new Map<typeof code.fieldId, CellValueV1>([
          [code.fieldId, values.textValue("J3")],
          [quoted.fieldId, values.decimalValue("10")],
          [paid.fieldId, values.decimalValue("4")],
        ]),
        provenance: new Map(),
      },
      importedInvalid: false,
    },
  };
  await projection.applyEvents(handle, [{ commit: await seal(3, patchCommit.commitSha256, createdEvent, r3), events: [createdEvent] }]);
  const created = computedOf(handle, r3);

  // Computed values are not searchable text.
  const searchHits = engine.selectRows(handle, "SELECT rowid FROM record_search WHERE record_search MATCH ?", ['"10345"*']).length;

  // Invariant 7, read off the bytes: the encoded commit carries the value the
  // user wrote and no value recalculation produced; the checkpoint's formula
  // root carries definitions only.
  const latin = (encoded: Uint8Array): string => [...encoded].map((byte) => String.fromCharCode(byte)).join("");
  const commitBytes = latin(codec.encodeEventCommit(patchCommit));
  const checkpointBytes = latin(
    roots.encodeCheckpointManifest({
      manifestVersion: 1,
      appId,
      schemaRevision: 1n,
      frontier: checkpoint.frontier,
      appState: { ...checkpoint.appState },
      tables: checkpoint.tables,
      enumOptions: [],
      sheetSnapshots: [],
      formulas: checkpoint.formulas,
      recordPages: [],
      semanticSha256: new Uint8Array(32),
    }),
  );
  projection.disposeProjection(handle);

  return {
    hydrated,
    scalars,
    hydrateEvaluations,
    issueKeys,
    lanes,
    patchedFieldNames: receipt.recalculatedFieldIds.map((fieldId) => names.get(ids.encodeDomainId(fieldId)) ?? "?").sort(),
    afterPatch,
    downstreamEvaluations,
    refreshed: refreshed.map((fieldId) => names.get(ids.encodeDomainId(fieldId)) ?? "?"),
    afterRefresh,
    freshRefresh: freshRefresh.map((fieldId) => names.get(ids.encodeDomainId(fieldId)) ?? "?"),
    created,
    searchHits,
    commitHasResult: commitBytes.includes("10345.66") || commitBytes.includes("11345.66"),
    commitHasAuthored: commitBytes.includes("2000.01"),
    checkpointHasResult: checkpointBytes.includes("11345.66") || checkpointBytes.includes("12395.67"),
  };
}

let page: Page;
let report: RecalcReport;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto("/harness.html");
  report = await page.evaluate(runRecalc);
});

test.afterAll(async () => {
  await page.close();
});

test("hydration evaluates every column into its CA-26 state (load order step 6)", () => {
  expect(report.hydrated.r1).toEqual({
    Balance: "ok:11345.66",
    Half: expect.stringMatching(/^ok:12\.34/),
    Named: "type",
    Echo: "ok:hello",
    Age: "ok:10",
    LoopA: "cycle",
    LoopB: "cycle",
    Kept: "unsupported:41",
    Frozen: "frozen:0.37",
  });
  expect(report.hydrated.r2).toMatchObject({
    Half: "error:#DIV/0!",
    Echo: "empty",
    Kept: "unsupported-new-row",
    Frozen: "empty",
  });
  expect(report.scalars).toEqual(["ok:12395.67", "ok:24791.34"]);
});

test("writes each state as a computed lane or a formula issue, and nothing authored", () => {
  expect(report.issueKeys).toEqual([
    "formula-cycle",
    "formula-cycle",
    "formula-cycle",
    "formula-cycle",
    "formula-error",
    "formula-result-type",
    "formula-result-type",
    "missing-unsupported-formula",
    "unsupported-formula",
  ]);
  expect(report.lanes.every((lane) => lane.endsWith("|computed"))).toBe(true);
});

test("never evaluates a cycle, a frozen or an unsupported column", () => {
  expect(report.hydrateEvaluations).toBe(12);
});

test("recomputes only what the patched field reaches, in the same transaction", () => {
  expect(report.patchedFieldNames).toEqual(["Balance", "Half"]);
  expect(report.afterPatch).toMatchObject({ Balance: "ok:10345.66", Half: expect.stringMatching(/^ok:6\.17/) });
  // A day passed without a refresh: a full pass would have moved Age.
  expect(report.afterPatch["Age"]).toBe("ok:10");
  expect(report.downstreamEvaluations).toBe(2);
});

test("moves a TODAY() column with the clock alone, once", () => {
  expect(report.refreshed).toEqual(["Age"]);
  expect(report.afterRefresh["Age"]).toBe("ok:11");
  expect(report.freshRefresh).toEqual([]);
});

test("covers a new row in every column, flagging the unsupported one empty", () => {
  expect(report.created).toMatchObject({ Balance: "ok:6", Kept: "unsupported-new-row", LoopA: "cycle", Frozen: "empty", Echo: "empty" });
});

test("keeps computed values out of search, the commit bytes and the checkpoint (invariant 7)", () => {
  expect(report.searchHits).toBe(0);
  expect(report.commitHasAuthored).toBe(true);
  expect(report.commitHasResult).toBe(false);
  expect(report.checkpointHasResult).toBe(false);
});
