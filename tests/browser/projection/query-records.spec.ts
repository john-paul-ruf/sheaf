import { expect, test, type Page } from "@playwright/test";

/**
 * CA-29 at the browser tier: the records query through `executeQuery`, on the
 * shipped SQLite WASM build in a real browser. Every filter type, each sort
 * key with ties and the missing tail, a computed-field filter and sort, and a
 * partial page with an injected budget (production reads D53's constant; the
 * engine takes the budget as an argument, which is what makes this provable
 * without fabricating 50,000 rows).
 *
 * The table (the node suite's `tests/unit/projection/query-fixture.ts`, restated
 * here because a page function cannot import a test module):
 *
 * | job | Name                 | Status    | Due        | Quoted  | Paid | Urgent  | Customer     | Balance |
 * | j1  | Patio lighting       | Scheduled | 20000      | 1850.00 | 925  | true    | c1 Priya     | 925.00  |
 * | j2  | Courtyard irrigation | Waiting   | 20000      | 3240    | 0    | false   | c2 Devon     | 3240    |
 * | j3  | Maple pruning        | Scheduled | 20001      | 780     | 390  | true    | c1           | 390     |
 * | j4  | Bed refresh          | Done      | 20003      | 1420    | 1420 | false   | "C-882" kept | 0       |
 * | j5  | Fence planting       | Scheduled | missing    | 2900    | 0    | missing | nowhere      | 2900    |
 * | j6  | Front walk           | Scheduled | blank      | 2120    | 1060 | false   | c2           | 1060    |
 * | j7  | Rain garden Été      | Waiting   | "next week"| 4600    | 0    | true    | c3 Avery     | 4600    |
 * | j8  | patio lights         | Done      | 19990      | 1850    | 0    | true    | c3           | 1850    |
 */

interface Answer {
  readonly jobs: readonly string[];
  readonly total: number | null;
  readonly partial: { readonly scanned: number; readonly tableTotal: number } | null;
}

type Report = Readonly<Record<string, Answer | readonly string[]>>;

async function runQueryRecords(): Promise<Report> {
  const harness = window.__sheafHarness;
  const [projection, ids, bytesModule, values, hash] = await Promise.all([
    harness.module<typeof import("../../../src/persistence/projection/index.js")>("/src/persistence/projection/index.ts"),
    harness.module<typeof import("../../../src/domain/model/ids.js")>("/src/domain/model/ids.ts"),
    harness.module<typeof import("../../../src/domain/model/bytes.js")>("/src/domain/model/bytes.ts"),
    harness.module<typeof import("../../../src/domain/model/values.js")>("/src/domain/model/values.ts"),
    harness.module<typeof import("../../../src/crypto/hash.js")>("/src/crypto/hash.ts"),
  ]);
  type FieldDefV1 = import("../../../src/domain/model/schema.js").FieldDefV1;
  type CellValueV1 = import("../../../src/domain/model/values.js").CellValueV1;
  type Term = import("../../../src/persistence/projection/types.js").ProjectionFilterTermV1;
  type Sort = import("../../../src/persistence/projection/types.js").ProjectionRecordSortV1;
  type Cursor = import("../../../src/persistence/projection/types.js").ProjectionQueryCursorV1;
  type OptionId = import("../../../src/domain/model/ids.js").OptionId;
  type RecordId = import("../../../src/domain/model/ids.js").RecordId;

  const bytes = (fill: number): Uint8Array => new Uint8Array(16).fill(fill);
  const jobs = ids.asDomainId("table", bytes(2));
  const customers = ids.asDomainId("table", bytes(3));
  const genesis = ids.asDomainId("commit", bytes(4));
  const field = (fill: number, tableId: typeof jobs, displayName: string, fieldOrdinal: number, type: FieldDefV1["type"], formulaFill?: number): FieldDefV1 => ({
    fieldId: ids.asDomainId("field", bytes(fill)),
    tableId,
    displayName,
    fieldOrdinal,
    type,
    isRequired: false,
    isActive: true,
    schemaRevision: 1n,
    ...(formulaFill === undefined ? {} : { formulaId: ids.asDomainId("formula", bytes(formulaFill)) }),
  });
  const name = field(0x10, jobs, "Name", 0, { kind: "text" });
  const status = field(0x11, jobs, "Status", 1, { kind: "enum" });
  const due = field(0x12, jobs, "Due", 2, { kind: "date" });
  const quoted = field(0x13, jobs, "Quoted", 3, { kind: "currency", currencyCode: "USD" });
  const paid = field(0x14, jobs, "Paid", 4, { kind: "number" });
  const urgent = field(0x15, jobs, "Urgent", 5, { kind: "boolean" });
  const customer = field(0x16, jobs, "Customer", 6, { kind: "reference" });
  const balance = field(0x17, jobs, "Balance", 7, { kind: "number" }, 0x40);
  const customerName = field(0x18, customers, "Name", 0, { kind: "text" });
  const customerCode = field(0x19, customers, "Code", 1, { kind: "text" });
  const [scheduled, waiting, done] = [0x20, 0x21, 0x22].map((fill) => ids.asDomainId("option", bytes(fill))) as [OptionId, OptionId, OptionId];
  const c = [0x31, 0x32, 0x33].map((fill) => ids.asDomainId("record", bytes(fill)));
  const jobIds = [0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58].map((fill) => ids.asDomainId("record", bytes(fill)));
  const jobName = (recordId: Uint8Array): string => `j${String((recordId[0] ?? 0) - 0x50)}`;

  const record = (recordId: Uint8Array, tableId: typeof jobs, entries: readonly (readonly [FieldDefV1, CellValueV1])[]) => ({
    record: {
      recordId: ids.asDomainId("record", recordId),
      tableId,
      values: new Map(entries.map(([definition, value]) => [definition.fieldId, value])),
      provenance: new Map(),
    },
    recordRevision: 0n,
    createdCommitId: genesis,
    updatedCommitId: genesis,
    issues: [],
  });
  const job = (index: number, text: string, option: Uint8Array, dueValue: CellValueV1 | null, quotedText: string, paidText: string, isUrgent: boolean | null, reference: CellValueV1) =>
    record(jobIds[index] as Uint8Array, jobs, [
      [name, values.textValue(text)],
      [status, values.enumValue(ids.asDomainId("option", option))],
      ...(dueValue === null ? [] : [[due, dueValue] as const]),
      [quoted, values.decimalValue(quotedText)],
      [paid, values.decimalValue(paidText)],
      ...(isUrgent === null ? [] : [[urgent, values.booleanValue(isUrgent)] as const]),
      [customer, reference],
    ]);
  const ref = (index: number) => values.referenceValue(c[index] as RecordId);

  const handle = await projection.openProjection({ sha256: hash.sha256, clock: () => ({ epochDay: 20_000, epochMs: 1_728_000_000_000 }) });
  await projection.hydrateApp(handle, {
    appId: ids.asDomainId("app", bytes(1)),
    checkpointStorageId: bytesModule.asStorageId16(bytes(5)),
    checkpointSemanticSha256: new Uint8Array(32).fill(6),
    frontier: [{ deviceId: bytes(7), commitSequence: 1n }],
    hydratedAtMs: 1_728_000_000_000,
    appState: {
      appId: ids.asDomainId("app", bytes(1)),
      displayName: "Fieldbook",
      createdAtMs: 0,
      lastOpenedAtMs: null,
      schemaRevision: 1n,
      locality: "present",
      durableHomeId: null,
      lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 0,
      theme: {
        themeKey: "sheaf.built-in.v1",
        tokens: { "app-ink": "#000", "app-canvas": "#fff", "app-surface": "#fff", "app-primary": "#000", "app-accent": "#000", "app-muted": "#888" },
      },
      stateRevision: 1n,
    },
    sheetSnapshots: [],
    tables: [
      { tableId: customers, displayName: "Customers", tableOrdinal: 0, fields: [customerName, customerCode], keyFieldId: customerCode.fieldId, labelFieldId: customerName.fieldId, sourceSheetId: null, isActive: true, schemaRevision: 1n },
      { tableId: jobs, displayName: "Jobs", tableOrdinal: 1, fields: [name, status, due, quoted, paid, urgent, customer, balance], keyFieldId: null, labelFieldId: name.fieldId, sourceSheetId: null, isActive: true, schemaRevision: 1n },
    ],
    enumOptions: [
      [scheduled, "Scheduled"],
      [waiting, "Waiting"],
      [done, "Done"],
    ].map(([optionId, displayLabel], optionOrdinal) => ({
      optionId: optionId as typeof scheduled,
      fieldId: status.fieldId,
      displayLabel: displayLabel as string,
      optionOrdinal,
      isActive: true,
      schemaRevision: 1n,
    })),
    relationships: [
      {
        relationshipId: ids.asDomainId("relationship", bytes(0x60)),
        fromTableId: jobs,
        fromFieldId: customer.fieldId,
        toTableId: customers,
        toKeyFieldId: customerCode.fieldId,
        detectionSource: "declared",
        isActive: true,
        schemaRevision: 1n,
      },
    ],
    validationRules: [],
    formulas: [
      {
        formula: {
          formulaId: balance.formulaId as NonNullable<FieldDefV1["formulaId"]>,
          target: { kind: "computed-column", tableId: jobs, fieldId: balance.fieldId },
          displayName: null,
          originalText: "[Quoted]-[Paid]",
          document: { irVersion: 1, root: { kind: "binary", operator: "-", left: { kind: "field", fieldId: quoted.fieldId }, right: { kind: "field", fieldId: paid.fieldId } } },
          disposition: "live",
          determinism: "deterministic",
          dependencies: [
            { kind: "field", fieldId: quoted.fieldId },
            { kind: "field", fieldId: paid.fieldId },
          ],
        },
        metadata: { catalogVersion: 1, functionVersions: [], source: "authored", importedValuePolicy: "none" },
        isActive: true,
        schemaRevision: 1n,
      },
    ],
    inertItems: [],
    importLineages: [],
    inferenceDecisions: [],
    recordPages: [
      {
        records: [
          record(c[0] as Uint8Array, customers, [[customerName, values.textValue("Priya Ellis")], [customerCode, values.textValue("C-104")]]),
          record(c[1] as Uint8Array, customers, [[customerName, values.textValue("Devon Moss")], [customerCode, values.textValue("C-211")]]),
          record(c[2] as Uint8Array, customers, [[customerName, values.textValue("Avery Kim")], [customerCode, values.textValue("C-305")]]),
        ],
      },
      {
        records: [
          job(0, "Patio lighting", scheduled, values.dateValue(20_000), "1850.00", "925", true, ref(0)),
          job(1, "Courtyard irrigation", waiting, values.dateValue(20_000), "3240", "0", false, ref(1)),
          job(2, "Maple pruning", scheduled, values.dateValue(20_001), "780", "390", true, ref(0)),
          job(3, "Bed refresh", done, values.dateValue(20_003), "1420", "1420", false, values.invalidPreservedValue("C-882")),
          job(4, "Fence planting", scheduled, null, "2900", "0", null, values.referenceValue(ids.asDomainId("record", bytes(0x3f)))),
          job(5, "Front walk", scheduled, values.BLANK_VALUE, "2120", "1060", false, ref(1)),
          job(6, "Rain garden Été", waiting, values.invalidPreservedValue("next week"), "4600", "0", true, ref(2)),
          job(7, "patio lights", done, values.dateValue(19_990), "1850", "0", true, ref(2)),
        ],
      },
    ],
  });

  const ask = (filters: readonly Term[], sort: Sort | null = null, budget = 50_000, after: Cursor | null = null, limit = 50) =>
    projection.executeQuery(handle, {
      kind: "query-records",
      tableId: jobs,
      search: null,
      filters,
      sort,
      after,
      limit,
      candidateBudget: budget,
    });
  const answer = (filters: readonly Term[], sort: Sort | null = null, budget = 50_000): Answer => {
    const result = ask(filters, sort, budget);
    return { jobs: result.records.map((row) => jobName(row.recordId)), total: result.total, partial: result.partial };
  };
  const walk = (sort: Sort, limit: number, budget = 50_000): string[] => {
    const seen: string[] = [];
    let after: Cursor | null = null;
    for (let pages = 0; pages < 20; pages += 1) {
      const page = ask([], sort, budget, after, limit);
      seen.push(...page.records.map((row) => jobName(row.recordId)));
      if (!page.hasMore) return seen;
      after = page.next;
    }
    return ["did not end"];
  };
  const sort = (definition: FieldDefV1, key: Sort["key"], direction: Sort["direction"] = "asc"): Sort => ({ fieldId: definition.fieldId, key, direction });

  const report: Record<string, Answer | readonly string[]> = {
    enumScheduled: answer([{ kind: "id-in", fieldId: status.fieldId, ids: [scheduled] }]),
    dateRange: answer([{ kind: "integer-range", fieldId: due.fieldId, min: 20_000, max: 20_001 }]),
    dateOpenEnded: answer([{ kind: "integer-range", fieldId: due.fieldId, min: 20_001, max: null }]),
    currencyEqualSpellings: answer([{ kind: "decimal-range", fieldId: quoted.fieldId, min: "1850", max: "1850" }]),
    numberAtLeast: answer([{ kind: "decimal-range", fieldId: quoted.fieldId, min: "2000", max: null }]),
    booleanYes: answer([{ kind: "integer-range", fieldId: urgent.fieldId, min: 1, max: 1 }]),
    booleanNo: answer([{ kind: "integer-range", fieldId: urgent.fieldId, min: 0, max: 0 }]),
    referenceIn: answer([{ kind: "id-in", fieldId: customer.fieldId, ids: [c[0] as Uint8Array] }]),
    referenceBroken: answer([{ kind: "reference-broken", fieldId: customer.fieldId }]),
    textEquals: answer([{ kind: "text-equals", fieldId: name.fieldId, text: "Patio lighting" }]),
    textContains: answer([{ kind: "text-contains", fieldId: name.fieldId, text: "atio l" }]),
    textEqualsFolded: answer([{ kind: "text-equals", fieldId: name.fieldId, text: "PATIO LIGHTING" }]),
    textContainsFolded: answer([{ kind: "text-contains", fieldId: name.fieldId, text: "PATIO" }]),
    textContainsAccent: answer([{ kind: "text-contains", fieldId: name.fieldId, text: "été" }]),
    textContainsDecomposed: answer([{ kind: "text-contains", fieldId: name.fieldId, text: "ÉTE\u0301" }]),
    textContainsUnaccented: answer([{ kind: "text-contains", fieldId: name.fieldId, text: "ete" }]),
    empty: answer([{ kind: "is-empty", fieldId: due.fieldId, isComputed: false }]),
    notEmpty: answer([{ kind: "not-empty", fieldId: due.fieldId, isComputed: false }]),
    computedFilter: answer([{ kind: "decimal-range", fieldId: balance.fieldId, min: "1000", max: null }]),
    combined: answer([
      { kind: "id-in", fieldId: status.fieldId, ids: [scheduled] },
      { kind: "integer-range", fieldId: urgent.fieldId, min: 1, max: 1 },
    ]),
    sortDueAsc: answer([], sort(due, "integer")),
    sortDueDesc: answer([], sort(due, "integer", "desc")),
    sortQuoted: answer([], sort(quoted, "decimal")),
    sortStatus: answer([], sort(status, "option-ordinal")),
    sortName: answer([], sort(name, "text")),
    sortCustomer: answer([], sort(customer, "reference-label")),
    sortBalance: answer([], sort(balance, "decimal", "desc")),
    walkDueAsc: walk(sort(due, "integer"), 2),
    walkDueDesc: walk(sort(due, "integer", "desc"), 3),
    walkCustomer: walk(sort(customer, "reference-label"), 1),
    partial: answer([{ kind: "id-in", fieldId: status.fieldId, ids: [scheduled] }], null, 5),
    partialSorted: walk(sort(quoted, "decimal"), 2, 5),
    exactAtBudget: answer([{ kind: "id-in", fieldId: status.fieldId, ids: [scheduled] }], null, 8),
  };

  projection.disposeProjection(handle);
  return report;
}

let page: Page;
let report: Report;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto("/harness.html");
  report = await page.evaluate(runQueryRecords);
});

test.afterAll(async () => {
  await page.close();
});

const exact = (jobs: readonly string[]): Answer => ({ jobs, total: jobs.length, partial: null });

test("every filter type answers exactly, with an exact count of matches", () => {
  expect(report["enumScheduled"]).toEqual(exact(["j1", "j3", "j5", "j6"]));
  expect(report["dateRange"]).toEqual(exact(["j1", "j2", "j3"]));
  expect(report["dateOpenEnded"]).toEqual(exact(["j3", "j4"]));
  expect(report["currencyEqualSpellings"]).toEqual(exact(["j1", "j8"]));
  expect(report["numberAtLeast"]).toEqual(exact(["j2", "j5", "j6", "j7"]));
  expect(report["booleanYes"]).toEqual(exact(["j1", "j3", "j7", "j8"]));
  expect(report["booleanNo"]).toEqual(exact(["j2", "j4", "j6"]));
  expect(report["referenceIn"]).toEqual(exact(["j1", "j3"]));
  expect(report["referenceBroken"]).toEqual(exact(["j4", "j5"]));
  expect(report["textEquals"]).toEqual(exact(["j1"]));
  expect(report["textContains"]).toEqual(exact(["j1", "j8"]));
  // Case-insensitive over NFC: capitals, accented capitals and a decomposed é all fold.
  expect(report["textEqualsFolded"]).toEqual(exact(["j1"]));
  expect(report["textContainsFolded"]).toEqual(exact(["j1", "j8"]));
  expect(report["textContainsAccent"]).toEqual(exact(["j7"]));
  expect(report["textContainsDecomposed"]).toEqual(exact(["j7"]));
  expect(report["textContainsUnaccented"]).toEqual(exact([]));
  expect(report["empty"]).toEqual(exact(["j5", "j6"]));
  expect(report["notEmpty"]).toEqual(exact(["j1", "j2", "j3", "j4", "j7", "j8"]));
  expect(report["combined"]).toEqual(exact(["j1", "j3"]));
});

test("a computed column filters and sorts by its recalculated value", () => {
  expect(report["computedFilter"]).toEqual(exact(["j2", "j5", "j6", "j7", "j8"]));
  expect(report["sortBalance"]).toEqual(exact(["j7", "j2", "j5", "j8", "j6", "j1", "j3", "j4"]));
});

test("sorts on any column; ties break on the row key; missing sorts last both ways", () => {
  expect(report["sortDueAsc"]).toEqual(exact(["j8", "j1", "j2", "j3", "j4", "j5", "j6", "j7"]));
  expect(report["sortDueDesc"]).toEqual(exact(["j4", "j3", "j1", "j2", "j8", "j5", "j6", "j7"]));
  expect(report["sortQuoted"]).toEqual(exact(["j3", "j4", "j1", "j8", "j6", "j5", "j2", "j7"]));
  expect(report["sortStatus"]).toEqual(exact(["j1", "j3", "j5", "j6", "j2", "j7", "j4", "j8"]));
  expect(report["sortName"]).toEqual(exact(["j4", "j2", "j5", "j6", "j3", "j1", "j7", "j8"]));
  expect(report["sortCustomer"]).toEqual(exact(["j7", "j8", "j2", "j6", "j1", "j3", "j4", "j5"]));
});

test("keyset pages neither skip nor repeat, across ties and into the missing tail", () => {
  expect(report["walkDueAsc"]).toEqual(["j8", "j1", "j2", "j3", "j4", "j5", "j6", "j7"]);
  expect(report["walkDueDesc"]).toEqual(["j4", "j3", "j1", "j2", "j8", "j5", "j6", "j7"]);
  expect(report["walkCustomer"]).toEqual(["j7", "j8", "j2", "j6", "j1", "j3", "j4", "j5"]);
});

test("D53: a partial page states what it examined and never reports a total", () => {
  expect(report["partial"]).toEqual({ jobs: ["j1", "j3", "j5"], total: null, partial: { scanned: 5, tableTotal: 8 } });
  expect(report["partialSorted"]).toEqual(["j3", "j4", "j1", "j5", "j2"]);
  expect(report["exactAtBudget"]).toEqual(exact(["j1", "j3", "j5", "j6"]));
});
