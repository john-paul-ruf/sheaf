import { expect, test, type Page } from "@playwright/test";

/**
 * CA-30 datasets in a real browser (S05 CP2): the built projection (real
 * SQLite WASM) and M35's assembly, loaded from built output through the
 * harness, over a small hydrated app.
 *
 * Every chart type and grouping kind is drawn, one of them across a
 * relationship; decimals are summed exactly; D53's two budgets are injected
 * small so the sample and the omission are reached with six rows. Each
 * grouped mark's intent is applied through the records query and must find
 * exactly the rows the mark counted.
 */

type CheckpointV1 = import("../../../src/persistence/projection/types.js").ProjectionCheckpointV1;
type FieldDefV1 = import("../../../src/domain/model/schema.js").FieldDefV1;
type ChartDefinitionV1 = import("../../../src/domain/model/charts.js").ChartDefinitionV1;
type CellValueV1 = import("../../../src/domain/model/values.js").CellValueV1;

interface DatasetsReport {
  readonly shapes: Readonly<Record<string, readonly string[]>>;
  readonly scopes: Readonly<Record<string, string>>;
  readonly intentMismatches: readonly string[];
  readonly intentsChecked: number;
}

async function drawDatasets(): Promise<DatasetsReport> {
  const harness = window.__sheafHarness;
  const [projection, charts, filters, ids, bytesModule, values, hash] = await Promise.all([
    harness.module<typeof import("../../../src/persistence/projection/index.js")>("/src/persistence/projection/index.ts"),
    harness.module<typeof import("../../../src/application/queries/charts.js")>("/src/application/queries/charts.ts"),
    harness.module<typeof import("../../../src/application/queries/filters.js")>("/src/application/queries/filters.ts"),
    harness.module<typeof import("../../../src/domain/model/ids.js")>("/src/domain/model/ids.ts"),
    harness.module<typeof import("../../../src/domain/model/bytes.js")>("/src/domain/model/bytes.ts"),
    harness.module<typeof import("../../../src/domain/model/values.js")>("/src/domain/model/values.ts"),
    harness.module<typeof import("../../../src/crypto/hash.js")>("/src/crypto/hash.ts"),
  ]);

  const bytes = (fill: number): Uint8Array => new Uint8Array(16).fill(fill);
  const appId = ids.asDomainId("app", bytes(1));
  const jobsId = ids.asDomainId("table", bytes(2));
  const customersId = ids.asDomainId("table", bytes(3));
  const genesis = ids.asDomainId("commit", bytes(4));
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
  const status = field(0x10, jobsId, "Status", 0, { kind: "enum" });
  const due = field(0x11, jobsId, "Due", 1, { kind: "date" });
  const quoted = field(0x12, jobsId, "Quoted", 2, { kind: "currency", currencyCode: "USD" });
  const urgent = field(0x13, jobsId, "Urgent", 3, { kind: "boolean" });
  const customer = field(0x14, jobsId, "Customer", 4, { kind: "reference" });
  const title = field(0x15, jobsId, "Title", 5, { kind: "text" });
  const customerName = field(0x16, customersId, "Name", 0, { kind: "text" });
  const hours = field(0x17, jobsId, "Hours", 6, { kind: "number" });
  const open = ids.asDomainId("option", bytes(0x20));
  const closed = ids.asDomainId("option", bytes(0x21));
  const acme = ids.asDomainId("record", bytes(0x30));
  const birch = ids.asDomainId("record", bytes(0x31));
  const relationshipId = ids.asDomainId("relationship", bytes(0x40));

  const record = (fill: number, tableId: typeof jobsId, entries: readonly (readonly [FieldDefV1, CellValueV1])[]) => ({
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
  const job = (fill: number, option: typeof open, day: number, amount: string, isUrgent: boolean, parent: typeof acme, text: string) =>
    record(fill, jobsId, [
      [status, values.enumValue(option)],
      [due, values.dateValue(day)],
      [quoted, values.decimalValue(amount)],
      [urgent, values.booleanValue(isUrgent)],
      [customer, values.referenceValue(parent)],
      [title, values.textValue(text)],
      [hours, values.decimalValue(String(day - 19_990))],
    ]);

  const checkpoint: CheckpointV1 = {
    appId,
    checkpointStorageId: bytesModule.asStorageId16(bytes(5)),
    checkpointSemanticSha256: new Uint8Array(32).fill(6),
    frontier: [{ deviceId: bytes(7), commitSequence: 1n }],
    hydratedAtMs: 0,
    appState: {
      appId,
      displayName: "Fieldwork",
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
      { tableId: customersId, displayName: "Customers", tableOrdinal: 0, fields: [customerName], keyFieldId: customerName.fieldId, labelFieldId: customerName.fieldId, sourceSheetId: null, isActive: true, schemaRevision: 1n },
      { tableId: jobsId, displayName: "Jobs", tableOrdinal: 1, fields: [status, due, quoted, urgent, customer, title, hours], keyFieldId: null, labelFieldId: title.fieldId, sourceSheetId: null, isActive: true, schemaRevision: 1n },
    ],
    enumOptions: [
      { optionId: open, fieldId: status.fieldId, displayLabel: "Open", optionOrdinal: 0, isActive: true, schemaRevision: 1n },
      { optionId: closed, fieldId: status.fieldId, displayLabel: "Closed", optionOrdinal: 1, isActive: true, schemaRevision: 1n },
    ],
    relationships: [
      { relationshipId, fromTableId: jobsId, fromFieldId: customer.fieldId, toTableId: customersId, toKeyFieldId: customerName.fieldId, detectionSource: "declared", isActive: true, schemaRevision: 1n },
    ],
    validationRules: [],
    formulas: [],
    inertItems: [],
    importLineages: [],
    inferenceDecisions: [],
    recordPages: [
      { records: [record(0x30, customersId, [[customerName, values.textValue("Acme")]]), record(0x31, customersId, [[customerName, values.textValue("Birch")]])] },
      {
        records: [
          job(0x50, open, 20_000, "10.10", true, acme, "Gate"),
          job(0x51, open, 20_001, "0.20", false, birch, "gate"),
          job(0x52, closed, 20_040, "5.05", true, acme, "Fence"),
          job(0x53, open, 20_041, "1000.00", false, acme, "Deck"),
          job(0x54, closed, 20_400, "3", true, birch, "Shed"),
          job(0x55, open, 20_401, "7.5", true, birch, "Path"),
        ],
      },
    ],
  };

  const handle = await projection.openProjection({ sha256: hash.sha256, clock: () => ({ epochDay: 20_500, epochMs: 20_500 * 86_400_000 }) });
  await projection.hydrateApp(handle, checkpoint);
  const port = {
    execute: ((query: Parameters<typeof projection.executeQuery>[1]) => projection.executeQuery(handle, query)) as never,
    applyEvents: () => Promise.reject(new Error("read-only")),
    refreshVolatile: () => Promise.resolve([]),
  };

  const base = { chartVersion: 1 as const, chartId: ids.asDomainId("chart", bytes(0x70)), name: "Chart", tableId: jobsId, filters: [], pinned: false };
  const grouped = (type: "bar" | "line" | "pie" | "stacked", groupBy: Extract<ChartDefinitionV1, { groupBy: unknown }>["groupBy"], extra: object = {}): ChartDefinitionV1 =>
    ({ ...base, type, groupBy, seriesBy: null, measure: { kind: "count" }, sort: "category", ...extra });

  const definitions: Readonly<Record<string, readonly [ChartDefinitionV1, { sourceRows: number; marks: number }?]>> = {
    "bar/enum/sum": [grouped("bar", { kind: "field", fieldId: status.fieldId }, { measure: { kind: "sum", fieldId: quoted.fieldId } })],
    "line/date-month/average": [grouped("line", { kind: "date", fieldId: due.fieldId, unit: "month" }, { measure: { kind: "average", fieldId: quoted.fieldId } })],
    "line/date-year": [grouped("line", { kind: "date", fieldId: due.fieldId, unit: "year" })],
    "pie/boolean": [grouped("pie", { kind: "field", fieldId: urgent.fieldId })],
    "bar/reference/max": [grouped("bar", { kind: "field", fieldId: customer.fieldId }, { measure: { kind: "max", fieldId: quoted.fieldId } })],
    "bar/text": [grouped("bar", { kind: "field", fieldId: title.fieldId })],
    "bar/related/min": [
      grouped("bar", { kind: "related-field", relationshipId, referenceFieldId: customer.fieldId, fieldId: customerName.fieldId }, { measure: { kind: "min", fieldId: quoted.fieldId } }),
    ],
    "stacked/enum×boolean": [grouped("stacked", { kind: "field", fieldId: status.fieldId }, { seriesBy: { kind: "field", fieldId: urgent.fieldId } })],
    scatter: [{ ...base, type: "scatter", x: quoted.fieldId, y: hours.fieldId }],
    "sample/newest-3": [grouped("bar", { kind: "field", fieldId: status.fieldId }), { sourceRows: 3, marks: 1_000 }],
    "omission/first-2": [grouped("bar", { kind: "field", fieldId: title.fieldId }), { sourceRows: 20_000, marks: 2 }],
  };

  const label = (key: { readonly kind: string; readonly label?: string | null; readonly value?: CellValueV1 }): string => {
    if (key.kind !== "value" || key.value === undefined) return key.kind;
    if (key.label !== null && key.label !== undefined) return key.label;
    const value = key.value;
    return value.kind === "text" ? value.text : value.kind === "boolean" ? String(value.boolean) : value.kind === "date" ? `day ${String(value.epochDay)}` : value.kind;
  };

  const shapes: Record<string, readonly string[]> = {};
  const scopes: Record<string, string> = {};
  const intentMismatches: string[] = [];
  let intentsChecked = 0;
  const table = filters.readTableDefinition(port, jobsId);
  if (table === null) throw new Error("no table");

  for (const [name, [definition, budgets]] of Object.entries(definitions)) {
    const result = charts.readChartDataset(port, definition, budgets === undefined ? {} : { budgets });
    if (result.outcome !== "dataset") throw new Error(`${name}: ${result.outcome}`);
    const read = result.dataset;
    shapes[name] = read.marks.map((mark) =>
      mark.kind === "point"
        ? `${mark.x},${mark.y}`
        : `${label(mark.category)}${mark.series === null ? "" : `/${label(mark.series)}`}=${mark.value ?? "null"}`,
    );
    scopes[name] = `${String(read.sourceRowsConsidered)}/${String(read.matchingRows)}/${String(read.tableTotal)} sample=${read.sample === null ? "none" : String(read.sample.rows)} omitted=${String(read.omittedCategories)}`;
    for (const mark of read.tablePage.rows) {
      if (mark.kind !== "group" || mark.filterIntent === null) continue;
      const compiled = filters.compileRecordQuery(table.table, table.enumOptions, mark.filterIntent, null);
      if (compiled.outcome !== "compiled") {
        intentMismatches.push(`${name}: refused`);
        continue;
      }
      const page = projection.executeQuery(handle, {
        kind: "query-records",
        tableId: jobsId,
        search: null,
        filters: compiled.filters,
        sort: null,
        after: null,
        limit: 1,
        candidateBudget: 50_000,
      });
      intentsChecked += 1;
      // With a sample, the intent finds every matching row, not just the sampled ones.
      if (read.sample === null && page.total !== mark.records) {
        intentMismatches.push(`${name} ${label(mark.category)}: ${String(page.total)} ≠ ${String(mark.records)}`);
      }
    }
  }
  projection.disposeProjection(handle);
  return { shapes, scopes, intentMismatches, intentsChecked };
}

let page: Page;
let report: DatasetsReport;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto("/harness.html");
  report = await page.evaluate(drawDatasets);
});

test.afterAll(async () => {
  await page.close();
});

test("draws every chart type over the built projection, with exact decimals (CA-30)", () => {
  expect(report.shapes["bar/enum/sum"]).toEqual(["Open=1017.80", "Closed=8.05"]);
  // 20000–20041 fall in October–November 2024 (first days 19997, 20028), 20400–20401 in November 2025.
  expect(report.shapes["line/date-month/average"]).toEqual(["day 19997=5.15", "day 20028=502.525", "day 20393=5.25"]);
  expect(report.shapes["line/date-year"]).toEqual(["day 19723=4", "day 20089=2"]);
  expect(report.shapes["pie/boolean"]).toEqual(["false=2", "true=4"]);
  expect(report.shapes["bar/reference/max"]).toEqual(["Acme=1000.00", "Birch=7.5"]);
  expect(report.shapes["stacked/enum×boolean"]).toEqual(["Open/false=2", "Open/true=2", "Closed/true=2"]);
  expect(report.shapes["scatter"]).toHaveLength(6);
  expect(report.shapes["scatter"]?.[0]).toBe("7.5,411");
});

test("groups text the way the text filter matches: case-insensitively", () => {
  // "Gate" and "gate" are one category, named as the newest row spells it and
  // ordered by that spelling's text order key — the order the records list sorts by.
  expect(report.shapes["bar/text"]).toEqual(["Deck=1", "Fence=1", "Path=1", "Shed=1", "gate=2"]);
});

test("groups across a relationship by the parent's field (D54)", () => {
  expect(report.shapes["bar/related/min"]).toEqual(["Acme=5.05", "Birch=0.20"]);
});

test("names the newest-rows sample and the omitted categories, with injected budgets (D53)", () => {
  expect(report.scopes["sample/newest-3"]).toBe("3/6/6 sample=3 omitted=0");
  // The three newest rows: Deck (open), Shed (closed), Path (open).
  expect(report.shapes["sample/newest-3"]).toEqual(["Open=2", "Closed=1"]);
  expect(report.scopes["omission/first-2"]).toBe("6/6/6 sample=none omitted=3");
  expect(report.shapes["omission/first-2"]).toEqual(["Deck=1", "Fence=1"]);
  expect(report.scopes["bar/enum/sum"]).toBe("6/6/6 sample=none omitted=0");
});

test("applies every mark's intent to the records query and finds exactly its count", () => {
  expect(report.intentsChecked).toBeGreaterThan(15);
  expect(report.intentMismatches).toEqual([]);
});
