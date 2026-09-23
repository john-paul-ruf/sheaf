/**
 * The first narrow journey of F03 (S06 CP3; CAP-22/CAP-23 at the worker tier;
 * CA-19, CA-20, CA-22).
 *
 * The pinned demo workbook goes through every real boundary: the real import
 * worker (OOXML adapter via the registry), the page's channel, the real data
 * worker's stage, S02's `inferWorkbook`, a review edit that rejects the
 * Visits→Jobs relationship, promotion into real IndexedDB under real
 * libsodium, `openApp`, S03's read RPCs — then a fresh worker (a restart) whose
 * reads must be identical, and finally every durable root decoded from raw
 * IndexedDB with its digest recomputed. No provider is a fixture here; the
 * only test-shaped thing is where the file comes from.
 */

import { expect, test, type Page } from "@playwright/test";
import { overSegmentCsv } from "../../fixtures/workbooks/append/over-segment.js";
import type {
  DataWorkerRequestV1,
  DataWorkerResponseV1,
  RecordReferenceViewV1,
} from "../../../src/workers/protocol/messages.js";
import { PASSPHRASE, command, installFixture, readStore, start, teardown } from "./runtime.js";
import { readWorkbookRoots } from "./workbook-roots.js";
import { installBytes, runWorkbookImport } from "./workbook-runtime.js";

const JOURNEY_TIMEOUT_MS = 240_000;
const WORKBOOK_FLOWS = ["delimited", "workbook"] as const;
const ALL_SHEETS = [0, 1, 2, 3, 4, 5, 6];
/** database.md § Checkpoint and page boundaries: baseline pages share the record pages' decoded cap. */
const PAGE_MAX_DECODED_BYTES = 524_288;

test.beforeEach(async ({ page }) => {
  await page.goto("/harness.html");
});

test.afterEach(async ({ page }) => {
  await teardown(page);
});

/** One request that must succeed, narrowed to the response it names. */
async function ask<K extends DataWorkerRequestV1["kind"]>(
  page: Page,
  request: Extract<DataWorkerRequestV1, { kind: K }>,
): Promise<Extract<DataWorkerResponseV1, { kind: K }>> {
  const answered = await command(page, request);
  if (!answered.ok || answered.response.kind !== request.kind) {
    throw new Error(`${request.kind} failed: ${JSON.stringify(answered)}`);
  }
  return answered.response as Extract<DataWorkerResponseV1, { kind: K }>;
}

/** Promotes a reviewed stage, recording how long the data worker took. */
async function timedPromote(page: Page, stageId: string) {
  const startedAt = Date.now();
  const promoted = await ask(page, { kind: "promoteImport", stageId, acceptedName: "Fieldwork Q3" });
  test.info().annotations.push({ type: "promote-ms", description: String(Date.now() - startedAt) });
  if (promoted.outcome !== "promoted") {
    throw new Error(`promotion refused: ${promoted.reason} ${JSON.stringify(promoted.issues)}`);
  }
  return promoted;
}

/** Imports, reviews and promotes the demo workbook, Archive 2018 deselected. */
async function promotedDemo(page: Page): Promise<string> {
  await start(page);
  expect((await command(page, { kind: "setup", passphrase: PASSPHRASE })).ok).toBe(true);
  await installFixture(page, "ooxml/fieldwork-q3.xlsx", "fieldwork-q3.xlsx");
  const run = await runWorkbookImport(page, { flows: WORKBOOK_FLOWS, selection: [0, 1, 2, 3, 4, 5] });
  expect(run.events.some((event) => event.kind === "completed")).toBe(true);
  const stageId = run.stageId as string;

  const inferred = await ask(page, { kind: "runInference", stageId });
  const proposal = inferred.proposal;
  expect(proposal.isDelimited).toBe(false);
  expect(proposal.sheets.map((sheet) => `${sheet.name}:${sheet.classification.join("+")}`)).toContain(
    "Archive 2018:excluded",
  );
  expect(proposal.tables.filter((table) => table.joinedToTableKey === null).map((table) => table.tableName)).toEqual([
    "Jobs",
    "Customers",
    "Crew",
    "Visits",
    "Materials",
  ]);
  const visitsToJobs = proposal.relationships.find((relationship) => relationship.relationshipKey === "rel:s3.t0.c1");
  expect(visitsToJobs).toMatchObject({ isApplied: true, detectionSource: "key-match" });

  const rejected = await ask(page, {
    kind: "applyReviewEdit",
    stageId,
    edit: { kind: "reject-relationship", relationshipKey: "rel:s3.t0.c1" },
  });
  if (rejected.outcome !== "applied") throw new Error(`the rejection did not apply: ${rejected.reason}`);
  expect(rejected.proposal.relationships.find((relationship) => relationship.relationshipKey === "rel:s3.t0.c1")?.isApplied).toBe(
    false,
  );

  const promoted = await timedPromote(page, stageId);
  expect(promoted.tableCount).toBe(5);
  // The broken customer key is kept and flagged, not refused (FR-4, D36).
  expect(promoted.flaggedRecordCount).toBeGreaterThan(0);
  return promoted.appId;
}

/** Every read the journey makes; they must be identical after a restart. */
async function reads(page: Page, appId: string) {
  const opened = await ask(page, { kind: "openApp", appId });
  const session = opened.session;
  if (session === null) throw new Error("the app did not open");
  const tableId = (name: string): string => {
    const found = session.tables.find((table) => table.displayName === name);
    if (found === undefined) throw new Error(`no ${name} table`);
    return found.tableId;
  };
  const allRecords = async (name: string) => {
    const records = [];
    let cursor: number | null = null;
    for (;;) {
      const page_: DataWorkerResponseV1 = await ask(page, {
        kind: "queryRecords",
        appId,
        tableId: tableId(name),
        cursor,
        limit: 100,
      });
      if (page_.kind !== "queryRecords" || page_.page === null) throw new Error("no page");
      records.push(...page_.page.records);
      if (!page_.page.hasMore) break;
      cursor = page_.page.nextCursor;
    }
    return records;
  };

  const jobs = await allRecords("Jobs");
  const customers = await allRecords("Customers");
  // A Job's parent Customer, by its label; and a Job whose key matched nothing.
  const jobReferences: RecordReferenceViewV1[] = [];
  for (const job of jobs) {
    const detail = await ask(page, { kind: "getRecord", appId, recordId: job.recordId });
    jobReferences.push(...(detail.record?.references ?? []));
  }
  const resolved = jobReferences.filter((reference) => reference.status === "resolved");
  const broken = jobReferences.filter((reference) => reference.status === "broken");
  const firstJob = jobs[0];
  if (firstJob === undefined || customers[0] === undefined) throw new Error("expected jobs and customers");
  const jobRelated = await ask(page, { kind: "getRelatedRecords", appId, recordId: firstJob.recordId });
  const customerRelated = await ask(page, { kind: "getRelatedRecords", appId, recordId: customers[0].recordId });

  const sheets = await ask(page, { kind: "listSheetSnapshots", appId });
  const overview = sheets.sheets?.find((sheet) => sheet.displayName === "Overview");
  if (overview === undefined) throw new Error("no Overview snapshot");
  const overviewPage = await ask(page, { kind: "getSnapshotPage", appId, sheetId: overview.sheetId, firstRow: 0, rowCount: 100 });
  const inert = await ask(page, { kind: "listInertItems", appId, sheetId: null });

  return {
    tables: session.tables.map((table) => ({
      name: table.displayName,
      count: table.recordCount,
      fields: table.fields.map((field) => `${field.displayName}:${field.type.kind}`),
    })),
    resolvedLabels: resolved.map((reference) => (reference.status === "resolved" ? reference.label : "")).sort(),
    brokenKeys: broken.map((reference) => (reference.status === "broken" ? reference.originalKey : "")),
    jobParents: jobRelated.related?.parents,
    customerChildren: customerRelated.related?.children.map((child) => ({
      table: child.tableName,
      count: child.count,
      first: child.first.map((record) => record.label),
    })),
    sheets: sheets.sheets?.map((sheet) => ({
      name: sheet.displayName,
      classification: sheet.classification,
      inert: sheet.inertCounts,
    })),
    overview: overviewPage.page,
    inert: inert.items?.map((item) => ({ kind: item.kind, sheet: item.sheetName, location: item.location, reason: item.reasonKey })),
  };
}

test("the first narrow journey: demo workbook → review → multi-table app → restart → raw roots (CAP-23)", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const appId = await promotedDemo(page);

  const before = await reads(page, appId);

  // --- tables, as reviewed ----------------------------------------------------
  expect(before.tables.map((table) => table.name)).toEqual(["Jobs", "Customers", "Crew", "Visits", "Materials"]);
  // The rejected relationship leaves Visits.Job ID its value type: text.
  expect(before.tables.find((table) => table.name === "Visits")?.fields).toContain("Job ID:text");
  expect(before.tables.find((table) => table.name === "Jobs")?.fields).toContain("Customer ID:reference");

  // --- navigation, both directions (CAP-24 over a promoted app) ---------------
  expect(before.resolvedLabels.length).toBeGreaterThan(0);
  // One distinct unmatched key (S02's `brokenReferenceCount` counts keys, not
  // rows); every row holding it shows it as the original key (D36, STA-011).
  expect(new Set(before.brokenKeys)).toEqual(new Set(["C-013"]));
  expect(before.brokenKeys).toHaveLength(2);
  expect(before.jobParents?.[0]).toMatchObject({ status: expect.stringMatching(/resolved|broken/) });
  expect(before.customerChildren?.[0]).toMatchObject({ table: "Jobs" });
  expect(before.customerChildren?.[0]?.count).toBeGreaterThan(0);

  // --- snapshots and the inert inventory --------------------------------------
  expect(before.sheets?.map((sheet) => sheet.name)).toEqual(["Jobs", "Customers", "Crew", "Visits", "Materials", "Overview"]);
  expect(before.sheets?.find((sheet) => sheet.name === "Overview")?.classification).toEqual(
    expect.arrayContaining(["summary"]),
  );
  expect(before.overview?.format).toBe("sheet-v2");
  expect(before.overview?.rows.length).toBeGreaterThan(0);
  expect(before.overview?.rows.flatMap((row) => row.cells).some((cell) => cell.text !== "")).toBe(true);
  const kinds = (before.inert ?? []).map((item) => item.kind);
  // F04: formulas/chart now live — the Overview chart is rebuilt and no formula stays inert.
  expect(kinds.filter((kind) => kind === "chart")).toHaveLength(0);
  expect(kinds.filter((kind) => kind === "formula")).toHaveLength(0);
  expect(kinds.filter((kind) => kind === "drawing")).toHaveLength(2);

  // --- restart: a new page, a new worker, an unlock; the same reads -----------
  await page.evaluate(() => {
    window.__sheafApp?.dispose();
  });
  await page.goto("/harness.html");
  await start(page);
  expect((await command(page, { kind: "unlock", passphrase: PASSPHRASE })).ok).toBe(true);
  const after = await reads(page, appId);
  expect(after).toEqual(before);

  // --- every durable root, from raw IndexedDB (CA-20, CA-22, CL-04) -----------
  const roots = await readWorkbookRoots(page, PASSPHRASE);
  expect(roots.appCount).toBe(1);
  expect(roots.head).toEqual({
    semanticMatches: true,
    sourceManifestCount: 1,
    snapshotManifestCount: 6,
    conflictPageCount: 0,
    auditPageCount: 0,
    baselinePageCount: 1,
  });
  expect(roots.checkpoint.semanticMatches).toBe(true);
  // The F03 key set (D37), written in full.
  expect(roots.checkpoint.keys).toEqual(
    expect.arrayContaining(["relationships", "validationRules", "inertItems", "inferenceDecisions", "importLineages"]),
  );
  expect(roots.checkpoint.tables.find((table) => table.name === "Customers")?.key).toEqual(expect.any(String));
  expect(roots.checkpoint.relationships).toEqual([
    { from: "Jobs", field: "Customer ID", to: "Customers", key: roots.checkpoint.tables.find((t) => t.name === "Customers")?.key, source: "lookup-formula" },
  ]);
  // The rejection is durable: a relationship decision, disposition rejected.
  expect(roots.checkpoint.decisions).toContainEqual({ kind: "relationship", subject: "relationship", disposition: "rejected" });
  expect(roots.checkpoint.lineages).toEqual([
    { importKind: "initial", ordinal: 0, sourceName: "fieldwork-q3.xlsx", matchesSourceManifest: true },
  ]);
  expect(roots.checkpoint.sheets.every((sheet) => sheet.listedInHead)).toBe(true);
  expect(roots.checkpoint.inert.every((item) => item.reason !== "visual-only")).toBe(true);
  expect(roots.pages.digestsMatch).toBe(true);
  expect(roots.pages.records).toBe(before.tables.reduce((sum, table) => sum + table.count, 0));
  expect(roots.baselines).toMatchObject({ count: 1, entries: roots.pages.records, digestsMatch: true });
  expect(roots.events).toMatchObject({ commits: 1, chainOk: true, digestMatches: true });
  expect(roots.events.kinds[0]?.[0]).toBe("app.created");
  expect(roots.events.kinds[0]?.at(-1)).toBe("import.accepted");
  expect(roots.events.kinds[0]).not.toContain("record.created");
  // The retained original (D21), decoded: manifest and its first chunk.
  expect(roots.source).toMatchObject({
    fileName: "fieldwork-q3.xlsx",
    firstChunkDigestMatches: true,
    manifestDigestMatches: true,
  });
  expect(roots.source.chunkCount).toBeGreaterThan(0);
  expect(roots.source.firstChunkBytes).toBeGreaterThan(0);
  expect(roots.snapshots).toHaveLength(6);
  for (const snapshot of roots.snapshots) {
    expect(snapshot, snapshot.name).toMatchObject({ manifestDigestMatches: true, firstChunkDigestMatches: true });
  }
  expect(roots.snapshots.find((snapshot) => snapshot.name === "Jobs")?.firstChunkRows).toBeGreaterThan(0);
});

test("the full selection: all seven sheets, Archive 2018's 2,001 rows included, promote → restart → raw roots (CAP-21/CAP-23)", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await unlockedPage(page);
  await installFixture(page, "ooxml/fieldwork-q3.xlsx", "fieldwork-q3.xlsx");
  const run = await runWorkbookImport(page, { flows: WORKBOOK_FLOWS, selection: ALL_SHEETS });
  const preflight = run.events.find((event) => event.kind === "workbook-preflight");
  if (preflight?.kind !== "workbook-preflight") throw new Error("no workbook pre-flight");
  expect(preflight.report.sheets.map((sheet) => sheet.sheetIndex)).toEqual(ALL_SHEETS);
  expect(run.events.some((event) => event.kind === "completed")).toBe(true);
  const stageId = run.stageId as string;

  const inferred = await ask(page, { kind: "runInference", stageId });
  expect(inferred.proposal.sheets.every((sheet) => !sheet.classification.includes("excluded"))).toBe(true);
  const promoted = await timedPromote(page, stageId);

  const tables = async () =>
    ((await ask(page, { kind: "openApp", appId: promoted.appId })).session?.tables ?? []).map((table) => ({
      name: table.displayName,
      count: table.recordCount,
    }));
  const before = await tables();
  const recordCount = before.reduce((sum, table) => sum + table.count, 0);
  expect(recordCount).toBe(promoted.rowCount);
  // Archive 2018's rows are in the app, not only in its snapshot.
  expect(recordCount).toBeGreaterThan(2_000);

  await page.evaluate(() => {
    window.__sheafApp?.dispose();
  });
  await page.goto("/harness.html");
  await start(page);
  expect((await command(page, { kind: "unlock", passphrase: PASSPHRASE })).ok).toBe(true);
  expect(await tables()).toEqual(before);

  const roots = await readWorkbookRoots(page, PASSPHRASE);
  expect(roots.head.semanticMatches).toBe(true);
  expect(roots.head.snapshotManifestCount).toBe(ALL_SHEETS.length);
  expect(roots.checkpoint.semanticMatches).toBe(true);
  expect(roots.pages).toMatchObject({ records: recordCount, digestsMatch: true });
  expect(roots.pages.count).toBeGreaterThan(1);
  // The original-import baseline holds every row, split under the page cap.
  expect(roots.baselines).toMatchObject({ entries: recordCount, digestsMatch: true });
  expect(roots.baselines.count).toBeGreaterThan(1);
  expect(roots.baselines.largestDecodedBytes).toBeLessThanOrEqual(PAGE_MAX_DECODED_BYTES);
  expect(roots.events).toMatchObject({ commits: 1, chainOk: true, digestMatches: true });
  expect(roots.source).toMatchObject({ firstChunkDigestMatches: true, manifestDigestMatches: true });
  expect(roots.snapshots.map((snapshot) => snapshot.name)).toContain("Archive 2018");
  for (const snapshot of roots.snapshots) {
    expect(snapshot, snapshot.name).toMatchObject({ manifestDigestMatches: true, firstChunkDigestMatches: true });
  }
});

// ------------------------------- F04 S07 CP4: imported structure made live --

/** Every record of a table, with each field's value and computed state, by field name. */
async function cellsOf(page: Page, appId: string, tableName: string) {
  const opened = await ask(page, { kind: "openApp", appId });
  const table = opened.session?.tables.find((candidate) => candidate.displayName === tableName);
  if (table === undefined) throw new Error(`no ${tableName} table`);
  const names = new Map(table.fields.map((field) => [field.fieldId, field.displayName]));
  const rows: Record<string, { value: unknown; state: string | null }>[] = [];
  let cursor: number | null = null;
  for (;;) {
    const answered: DataWorkerResponseV1 = await ask(page, { kind: "queryRecords", appId, tableId: table.tableId, cursor, limit: 100 });
    if (answered.kind !== "queryRecords" || answered.page === null) throw new Error("no page");
    for (const record of answered.page.records) {
      rows.push(
        Object.fromEntries(
          record.values.map((entry) => [names.get(entry.fieldId) ?? entry.fieldId, { value: entry.value, state: entry.computed?.state ?? null }]),
        ),
      );
    }
    if (!answered.page.hasMore) break;
    cursor = answered.page.nextCursor;
  }
  return { table, rows };
}

const decimalOf = (value: unknown): number | null =>
  typeof value === "object" && value !== null && (value as { kind: string }).kind === "number" ? Number((value as { decimal: string }).decimal) : null;

async function liveReads(page: Page, appId: string) {
  const { rows } = await cellsOf(page, appId, "Jobs");
  const metrics = (await ask(page, { kind: "getAppMetrics", appId })).metrics;
  const charts = (await ask(page, { kind: "listCharts", appId })).charts;
  return {
    balances: rows.map((row) => [row["Quoted amount"]?.value, row["Paid"]?.value, row["Balance"]?.value, row["Balance"]?.state]),
    customers: rows.map((row) => [row["Customer"]?.value, row["Customer"]?.state]),
    // The projection lists metrics in its own stable order; read them by name.
    dashboard: metrics?.dashboard
      .map((metric) => ({ name: metric.displayName, status: metric.status, value: metric.value }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    charts: charts?.map((chart) => ({ name: chart.definition.name, type: chart.definition.type, pinned: chart.definition.pinned, provenance: chart.provenance })),
  };
}

test("CAP-38/CAP-34/CAP-29: the demo's formulas and chart are live after import, and after a restart in a new worker", async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const appId = await promotedDemo(page);
  const before = await liveReads(page, appId);

  // Jobs Balance is computed: Quoted amount − Paid, exactly, wherever Quoted is a number.
  const numeric = before.balances.filter(([quoted]) => decimalOf(quoted) !== null);
  expect(numeric).toHaveLength(58);
  for (const [quoted, paid, balance, state] of numeric) {
    expect(state).toBe("ok");
    expect(decimalOf(balance)).toBeCloseTo((decimalOf(quoted) ?? 0) - (decimalOf(paid) ?? 0), 6);
  }
  // A kept "TBD" quote cannot be subtracted: an error, never a zero.
  expect(before.balances.filter(([quoted]) => decimalOf(quoted) === null).map(([, , , state]) => state)).toEqual(["error", "error"]);
  // The lookup reads the customer through the relationship (D49); the broken key finds none.
  expect(before.customers.filter(([, state]) => state === "ok")).toHaveLength(58);
  expect(before.customers.every(([, state]) => state !== null)).toBe(true);

  // The Overview's four formulas are the app's dashboard values.
  expect(before.dashboard?.map((metric) => [metric.name, metric.status])).toEqual([
    ["Balance", "ok"],
    ["Open jobs", "ok"],
    ["Paid total", "ok"],
    ["Quoted total", "ok"],
  ]);
  const [balance, open, paid, quoted] = (before.dashboard ?? []).map((metric) => decimalOf(metric.value));
  expect(open).toBe(15);
  expect(balance).toBeCloseTo((quoted ?? 0) - (paid ?? 0), 6);
  // The Overview chart, rebuilt and pinned (D55, D65).
  expect(before.charts).toEqual([{ name: "Quoted by status", type: "bar", pinned: true, provenance: "imported" }]);

  // Restart: a new worker, an unlock; the same live reads, recomputed from the roots.
  await page.evaluate(() => {
    window.__sheafApp?.dispose();
  });
  await page.goto("/harness.html");
  await start(page);
  expect((await command(page, { kind: "unlock", passphrase: PASSPHRASE })).ok).toBe(true);
  expect(await liveReads(page, appId)).toEqual(before);

  // The durable roots: formulas and the chart are stored; no live value is (invariant 7).
  const roots = await readWorkbookRoots(page, PASSPHRASE);
  expect(roots.checkpoint.keys).toEqual(expect.arrayContaining(["formulas", "charts"]));
  expect(roots.checkpoint.formulas.map((formula) => [formula.name, formula.target, formula.disposition])).toEqual([
    ["Customer", "computed-column", "live"],
    ["Balance", "computed-column", "live"],
    ["Open jobs", "dashboard-value", "live"],
    ["Quoted total", "dashboard-value", "live"],
    ["Paid total", "dashboard-value", "live"],
    ["Balance", "dashboard-value", "live"],
  ]);
  expect(roots.checkpoint.computedFields).toEqual(["Jobs.Customer", "Jobs.Balance"]);
  expect(roots.checkpoint.charts).toEqual([{ name: "Quoted by status", type: "bar", provenance: "imported", pinned: true }]);
  expect(roots.pages.valued["Jobs.Balance"]).toBeUndefined();
  expect(roots.pages.valued["Jobs.Customer"]).toBeUndefined();
  expect(roots.pages.valued["Jobs.Quoted amount"]).toBe(60);
});

test("CAP-30: formulas-live.xlsx — TODAY live and never stored, RAND frozen, unsupported kept and a new row flagged, a cycle flagged", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await unlockedPage(page);
  const { promoted } = await importAndPromote(page, "ooxml/formulas-live.xlsx", "formulas-live.xlsx");
  const appId = promoted.appId;

  const { table, rows } = await cellsOf(page, appId, "Jobs");
  expect(rows).toHaveLength(5);
  for (const row of rows) {
    expect(row["Balance"]?.state).toBe("ok");
    // TODAY() is evaluated from the session clock at hydrate: live, a date, never stored.
    expect(row["Checked"]).toMatchObject({ state: "ok", value: { kind: "date" } });
    expect(row["Lucky"]?.state).toBe("frozen");
    expect(row["Rate"]?.state).toBe("unsupported");
    expect(row["Mixed"]?.state).toBe("unsupported");
  }
  const sorted = (values: readonly (number | null)[]) => [...values].sort((left, right) => (left ?? 0) - (right ?? 0));
  expect(sorted(rows.map((row) => decimalOf(row["Lucky"]?.value)))).toEqual([0.08, 0.17, 0.42, 0.61, 0.93]);
  expect(sorted(rows.map((row) => decimalOf(row["Rate"]?.value)))).toEqual([120, 250, 400, 610, 900]);

  // A new row: the unsupported column is empty and flagged, never zero; RAND draws once.
  const idOf = (name: string): string => table.fields.find((field) => field.displayName === name)?.fieldId as string;
  const created = await ask(page, {
    kind: "createRecord",
    appId,
    tableId: table.tableId,
    values: [
      { fieldId: idOf("Job"), value: { kind: "text", text: "J-6" } },
      { fieldId: idOf("Quoted"), value: { kind: "number", decimal: "50" } },
      { fieldId: idOf("Paid"), value: { kind: "number", decimal: "20" } },
    ],
  });
  if (created.outcome !== "accepted") throw new Error(`the new job was refused: ${JSON.stringify(created)}`);
  const after = (await cellsOf(page, appId, "Jobs")).rows;
  const added = after.find((row) => JSON.stringify(row["Job"]?.value) === JSON.stringify({ kind: "text", text: "J-6" }));
  expect(added?.["Rate"]).toEqual({ value: { kind: "missing" }, state: "unsupported-new-row" });
  expect(added?.["Lucky"]?.state).toBe("frozen");
  expect(decimalOf(added?.["Balance"]?.value)).toBe(30);

  // The two loop values read each other: flagged as a cycle, never evaluated.
  const metrics = (await ask(page, { kind: "getAppMetrics", appId })).metrics;
  const byName = (left: readonly unknown[], right: readonly unknown[]) => String(left[0]).localeCompare(String(right[0]));
  expect(metrics?.dashboard.map((metric) => [metric.displayName, metric.status]).sort(byName)).toEqual([
    ["Loop A", "cycle"],
    ["Loop B", "cycle"],
    ["Quoted total", "ok"],
  ]);
  expect(
    metrics?.tables.flatMap((entry) => entry.metrics.map((metric) => [metric.displayName, metric.status, decimalOf(metric.value)])).sort(byName),
  ).toEqual([
    ["Total Qty", "ok", 25],
    ["Total Quoted", "ok", 2330],
  ]);

  // CAP-36 import leg: the imported `Quoted >= 0` validation fires through the real
  // write path. It flags, never refuses (FR-4), so a violating save is kept and warned.
  const ruleWarningsOf = async (recordId: string) =>
    ((await ask(page, { kind: "getRecord", appId, recordId })).record?.issues ?? []).filter(
      (issue) => issue.kind === "record-rule",
    );
  expect(await ruleWarningsOf(created.receipt.recordId)).toEqual([]);
  const violating = await ask(page, {
    kind: "createRecord",
    appId,
    tableId: table.tableId,
    values: [
      { fieldId: idOf("Job"), value: { kind: "text", text: "J-7" } },
      { fieldId: idOf("Quoted"), value: { kind: "number", decimal: "-5" } },
    ],
  });
  if (violating.outcome !== "accepted") throw new Error(`a flagged job was refused: ${JSON.stringify(violating)}`);
  expect(await ruleWarningsOf(violating.receipt.recordId)).toEqual([
    {
      fieldId: null,
      kind: "record-rule",
      severity: "warning",
      messageKey: "rule-compare",
      messageParameters: { leftLabel: "Quoted", operator: "ge", ruleLabel: "Quoted", valueType: "decimal" },
    },
  ]);

  // Stored: frozen and unsupported literals; not one live value.
  const roots = await readWorkbookRoots(page, PASSPHRASE);
  expect(roots.pages.valued["Jobs.Balance"]).toBeUndefined();
  expect(roots.pages.valued["Jobs.Checked"]).toBeUndefined();
  expect([roots.pages.valued["Jobs.Lucky"], roots.pages.valued["Jobs.Rate"], roots.pages.valued["Jobs.Mixed"]]).toEqual([5, 5, 5]);
  expect(roots.checkpoint.inert.filter((item) => item.kind === "formula").map((item) => item.reason)).toEqual([
    "formula-not-supported",
    "formula-not-supported",
  ]);
});

// ------------------------------------------------ CP4: every format (CAP-27) --

/** Imports one fixture through the real workers with the workbook flow, and promotes it. */
async function importAndPromote(page: Page, path: string, fileName: string) {
  await installFixture(page, path, fileName);
  const run = await runWorkbookImport(page, { flows: WORKBOOK_FLOWS });
  const terminal = run.events.find((event) => ["refused", "completed", "failed", "cancelled"].includes(event.kind));
  if (terminal?.kind !== "completed") throw new Error(`${path} did not stage: ${JSON.stringify(terminal)}`);
  const stageId = run.stageId as string;
  const inferred = await ask(page, { kind: "runInference", stageId });
  const promoted = await ask(page, { kind: "promoteImport", stageId, acceptedName: fileName });
  if (promoted.outcome !== "promoted") throw new Error(`${path} did not promote: ${promoted.reason}`);
  const opened = await ask(page, { kind: "openApp", appId: promoted.appId });
  const sheets = await ask(page, { kind: "listSheetSnapshots", appId: promoted.appId });
  return {
    events: run.events,
    proposal: inferred.proposal,
    promoted,
    tables: (opened.session?.tables ?? []).map((table) => ({
      name: table.displayName,
      count: table.recordCount,
      fields: table.fields.map((field) => `${field.displayName}:${field.type.kind}`),
    })),
    sheets: (sheets.sheets ?? []).map((sheet) => sheet.displayName),
  };
}

async function unlockedPage(page: Page): Promise<void> {
  await start(page);
  expect((await command(page, { kind: "setup", passphrase: PASSPHRASE })).ok).toBe(true);
}

for (const [path, fileName, recordCounts] of [
  ["xlsb/fieldwork-jobs.xlsb", "fieldwork-jobs.xlsb", null],
  // Each sheet's database range is declared before its rows: one table per sheet, every row in it.
  ["ods/fieldwork-jobs-customers.ods", "fieldwork-jobs-customers.ods", [60, 12]],
] as const) {
  test(`CAP-27: the ${fileName} demo pair keeps its lookup-formula relationship through the real workers`, async ({ page }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    await unlockedPage(page);
    const result = await importAndPromote(page, path, fileName);

    if (recordCounts !== null) expect(result.tables.map((table) => table.count)).toEqual(recordCounts);
    expect(result.proposal.relationships.some((relationship) => relationship.detectionSource === "lookup-formula")).toBe(true);
    expect(result.tables.some((table) => table.fields.includes("Customer ID:reference"))).toBe(true);
    const roots = await readWorkbookRoots(page, PASSPHRASE);
    expect(roots.checkpoint.relationships.length).toBeGreaterThan(0);
    expect(roots.checkpoint.relationships.every((relationship) => relationship.source === "lookup-formula")).toBe(true);
    expect(roots.snapshots.every((snapshot) => snapshot.manifestDigestMatches)).toBe(true);
    expect(roots.checkpoint.semanticMatches).toBe(true);
  });
}

test("CAP-27: a BIFF .xls becomes an app with its tables and a snapshot per sheet", async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await unlockedPage(page);
  const result = await importAndPromote(page, "biff/formulas.xls", "formulas.xls");

  expect(result.tables.map((table) => table.name)).toEqual(["Jobs", "Customers"]);
  expect(result.sheets).toEqual(["Jobs", "Customers", "Calc"]);
  const roots = await readWorkbookRoots(page, PASSPHRASE);
  expect(roots.head.snapshotManifestCount).toBe(3);
  expect(roots.checkpoint.relationships.map((relationship) => relationship.source)).toEqual(["lookup-formula"]);
});

test("CAP-27: the legacy HTML pair becomes tables; no key-match reaches S02's threshold", async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await unlockedPage(page);
  const result = await importAndPromote(page, "html-table/fieldwork-jobs-customers.html", "fieldwork-jobs-customers.html");

  expect(result.tables.map((table) => `${table.name}:${String(table.count)}`)).toEqual(["Jobs:60", "Customers:12"]);
  // The pair carries the demo's broken key on 2 of 60 jobs: containment
  // 58/60 is below KEY_MATCH_CONTAINMENT (0.98), so no relationship is
  // proposed and the column stays text — asserted as it is, not as planned.
  expect(result.proposal.relationships).toEqual([]);
  expect(result.tables[0]?.fields).toContain("Customer ID:text");
  const roots = await readWorkbookRoots(page, PASSPHRASE);
  expect(roots.checkpoint.relationships).toEqual([]);
  expect(roots.head.snapshotManifestCount).toBe(result.sheets.length);
});

for (const [path, fileName] of [
  ["xlsb/macro-vba.xlsb", "macro-vba.xlsb"],
  ["biff/macro-vba.xls", "macro-vba.xls"],
  ["ods/basic-macro.ods", "basic-macro.ods"],
  ["unsafe/payroll.xlsm", "payroll.xlsm"],
] as const) {
  test(`CAP-19: ${fileName} is refused as macro content before any stage exists`, async ({ page }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    await unlockedPage(page);
    const before = await readStore(page);
    await installFixture(page, path, fileName);
    const run = await runWorkbookImport(page, { flows: WORKBOOK_FLOWS });

    expect(run.events.find((event) => event.kind === "refused")).toEqual({
      kind: "refused",
      refusal: { kind: "macro-content", fileName, remedy: "reupload-macro-free-copy" },
    });
    expect(run.stageId).toBeNull();
    expect(await readStore(page)).toEqual(before);
  });
}

test("F02's refusal fixtures, with the workbook flow accepted, are exactly what S04/S05 made them", async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await unlockedPage(page);

  // ledger.xls is a header-only CFB stub: unreadable, and nothing staged.
  const before = await readStore(page);
  await installFixture(page, "refusals/ledger.xls", "ledger.xls");
  const ledger = await runWorkbookImport(page, { flows: WORKBOOK_FLOWS });
  expect(ledger.events.find((event) => event.kind === "refused")).toEqual({
    kind: "refused",
    refusal: { kind: "binary-unreadable", fileName: "ledger.xls", remedy: "choose-another-file", detail: "malformed-structure" },
  });
  expect(await readStore(page)).toEqual(before);

  // legacy-export.xls is HTML named .xls: the contradiction is stated, the table read.
  const legacy = await importAndPromote(page, "refusals/legacy-export.xls", "legacy-export.xls");
  const report = legacy.events.find((event) => event.kind === "workbook-preflight");
  expect(report?.kind === "workbook-preflight" && report.report.formatContradiction).toEqual({
    declaredExtension: "xls",
    detectedFormat: "html-table",
  });
  expect(legacy.tables.map((table) => table.name)).toEqual(["Table 1"]);
  expect(legacy.sheets).toEqual(["Table 1"]);

  // site-plan.ods is an ODS whose one sheet holds no table: it fits, stages
  // and is reviewed, and creating an app from it is refused as `empty-table`
  // — a typed result, with nothing written.
  await installFixture(page, "refusals/site-plan.ods", "site-plan.ods");
  const sitePlan = await runWorkbookImport(page, { flows: WORKBOOK_FLOWS });
  expect(sitePlan.events.find((event) => event.kind === "workbook-preflight")).toMatchObject({
    report: { format: "ods", route: "fits", sheets: [{ name: "Table 1" }] },
  });
  expect(sitePlan.events.some((event) => event.kind === "completed")).toBe(true);
  const sitePlanStage = sitePlan.stageId as string;
  await ask(page, { kind: "runInference", stageId: sitePlanStage });
  expect(await ask(page, { kind: "promoteImport", stageId: sitePlanStage, acceptedName: "Site Plan" })).toMatchObject({
    outcome: "rejected",
    reason: "empty-table",
  });
  expect((await ask(page, { kind: "cancelImportStage", stageId: sitePlanStage })).receipt.completed).toBe(true);
});

// --------------------------------------- CP4: append into an app (D38, CA-23) --

/** Imports a delimited file into an existing app as a new table. */
async function appendInto(page: Page, appId: string) {
  const run = await runWorkbookImport(page, { destinationAppId: appId });
  expect(run.events.some((event) => event.kind === "completed")).toBe(true);
  const stageId = run.stageId as string;
  const inferred = await ask(page, { kind: "runInference", stageId });
  const promoted = await ask(page, { kind: "promoteImport", stageId, acceptedName: "ignored for an append" });
  return { stageId, proposal: inferred.proposal, promoted };
}

test("CAP-26: a CSV appended into the demo app is one import commit, a new table, and survives a restart", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const appId = await promotedDemo(page);
  const before = await readWorkbookRoots(page, PASSPHRASE);

  await installFixture(page, "delimited/crew-roster.tsv", "crew-roster.tsv");
  const appended = await appendInto(page, appId);
  expect(appended.proposal.tables.map((table) => table.tableName)).toEqual(["Crew Roster"]);
  expect(appended.promoted).toMatchObject({ outcome: "promoted", appId, rowCount: 4, tableCount: 1 });

  const tablesOf = async () =>
    (await ask(page, { kind: "openApp", appId })).session?.tables.map((table) => `${table.displayName}:${String(table.recordCount)}`);
  const opened = await tablesOf();
  expect(opened).toHaveLength(6);
  expect(opened?.at(-1)).toBe("Crew Roster:4");
  const crew = (await ask(page, { kind: "openApp", appId })).session?.tables.find((table) => table.displayName === "Crew Roster");
  const page1 = await ask(page, { kind: "queryRecords", appId, tableId: crew?.tableId as string });
  expect(page1.page?.totalCount).toBe(4);
  const sheets = await ask(page, { kind: "listSheetSnapshots", appId });
  expect(sheets.sheets?.map((sheet) => sheet.displayName).at(-1)).toBe("crew-roster.tsv");

  // The durable shape (CA-23): the checkpoint is untouched, the head grew by
  // one segment, one source manifest, one snapshot manifest.
  const after = await readWorkbookRoots(page, PASSPHRASE);
  expect(after.checkpoint).toEqual(before.checkpoint);
  expect(after.head.sourceManifestCount).toBe(before.head.sourceManifestCount + 1);
  expect(after.head.snapshotManifestCount).toBe(before.head.snapshotManifestCount + 1);
  expect(after.head.semanticMatches).toBe(true);
  expect(after.events.commits).toBe(2);
  expect(after.events.chainOk).toBe(true);
  const appendKinds = after.events.kinds[1] ?? [];
  expect(appendKinds[0]).toBe("table.created");
  expect(appendKinds.filter((kind) => kind === "record.created")).toHaveLength(4);
  expect(appendKinds).not.toContain("import.accepted");

  // Restart: the tail builds the table again from the commit alone.
  await page.evaluate(() => {
    window.__sheafApp?.dispose();
  });
  await page.goto("/harness.html");
  await start(page);
  expect((await command(page, { kind: "unlock", passphrase: PASSPHRASE })).ok).toBe(true);
  expect(await tablesOf()).toEqual(opened);
  const library = await ask(page, { kind: "listLibrary" });
  expect(library.apps[0]?.tableCount).toBe(6);
});

test("CAP-26: an append whose name is taken is named apart; one too large for a segment is refused, the app untouched", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const appId = await promotedDemo(page);

  // A file whose stem is an existing table's name (D38).
  await installFixture(page, "delimited/crew-roster.tsv", "Jobs.tsv");
  const collided = await appendInto(page, appId);
  expect(collided.proposal.tables.map((table) => table.tableName)).toEqual(["Jobs 2"]);
  expect(collided.promoted.outcome).toBe("promoted");

  // More rows than one segment's 10,000 events can carry.
  const before = await readWorkbookRoots(page, PASSPHRASE);
  await installBytes(page, new TextEncoder().encode(overSegmentCsv()), "over-segment.csv");
  const run = await runWorkbookImport(page, { destinationAppId: appId });
  expect(run.events.some((event) => event.kind === "completed")).toBe(true);
  const stageId = run.stageId as string;
  await ask(page, { kind: "runInference", stageId });
  const refused = await ask(page, { kind: "promoteImport", stageId, acceptedName: "x" });
  expect(refused).toMatchObject({ outcome: "rejected", reason: "append-too-large" });
  // Nothing of the app moved: same head, same checkpoint, same commits.
  expect(await readWorkbookRoots(page, PASSPHRASE)).toEqual(before);
  // The stage is still there to cancel, and cancelling cleans it.
  const receipt = await ask(page, { kind: "cancelImportStage", stageId });
  expect(receipt.receipt.completed).toBe(true);
});
