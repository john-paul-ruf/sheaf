/**
 * CA-29 over a computed column at the worker tier (S04 CP4; CAP-31, CAP-28
 * display input, CAP-29).
 *
 * Every boundary is real: the harness page drives the real `DataWorkerClient`
 * and so the real `data.worker` over `postMessage`, real IndexedDB, real
 * libsodium, real SQLite WASM. The app is the F03 demo imported through the
 * real import worker, then given a live computed column and a table metric
 * through S03's structure RPCs (preview → apply).
 *
 * The claims: a filter on the computed value answers exactly the rows whose
 * recalculated value qualifies, with their exact count; a sort on it walks
 * every row once, page by page through the sort cursor, values descending and
 * the rows without a result last; "no result" is its own filter; and the
 * authored metric reads back through `getAppMetrics` into app home's "At a
 * glance" view model.
 */

import { expect, test, type Page } from "@playwright/test";
import { selectMetricsVm } from "../../../src/application/view-models/records.js";
import type {
  AppStructureViewV1,
  DataWorkerRequestV1,
  DataWorkerResponseV1,
  FilterWireV1,
  RecordPageViewV1,
  RecordSummaryViewV1,
  SchemaChangeWireV1,
  SortCursorWireV1,
  SortWireV1,
} from "../../../src/workers/protocol/messages.js";
import { DEMO_LIVE_STRUCTURE_STATEMENTS } from "../../fixtures/workbooks/ooxml/demo-counts.js";
import { PASSPHRASE, command, installFixture, start, teardown } from "./runtime.js";
import { runWorkbookImport } from "./workbook-runtime.js";

const JOURNEY_TIMEOUT_MS = 240_000;

test.beforeEach(async ({ page }) => {
  await page.goto("/harness.html");
});

test.afterEach(async ({ page }) => {
  await teardown(page);
});

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

/** The F03 demo app, built through the real import worker (S03's proven seed). */
async function promotedDemo(page: Page): Promise<string> {
  await start(page);
  expect((await command(page, { kind: "setup", passphrase: PASSPHRASE })).ok).toBe(true);
  await installFixture(page, "ooxml/fieldwork-q3.xlsx", "fieldwork-q3.xlsx");
  const run = await runWorkbookImport(page, { flows: ["delimited", "workbook"], selection: [0, 1, 2, 3, 4, 5] });
  expect(run.events.some((event) => event.kind === "completed")).toBe(true);
  const stageId = run.stageId as string;
  await ask(page, { kind: "runInference", stageId });
  for (const statementId of DEMO_LIVE_STRUCTURE_STATEMENTS) {
    const rejected = await ask(page, { kind: "applyReviewEdit", stageId, edit: { kind: "reject-statement", statementId } });
    expect(rejected.outcome).toBe("applied");
  }
  await ask(page, { kind: "applyReviewEdit", stageId, edit: { kind: "reject-relationship", relationshipKey: "rel:s3.t0.c1" } });
  const promoted = await ask(page, { kind: "promoteImport", stageId, acceptedName: "Fieldwork Q3" });
  if (promoted.outcome !== "promoted") throw new Error(`promotion refused: ${promoted.reason}`);
  return promoted.appId;
}

async function structure(page: Page, appId: string): Promise<AppStructureViewV1> {
  const answered = await ask(page, { kind: "getAppStructure", appId });
  if (answered.structure === null) throw new Error("no structure");
  return answered.structure;
}

const idOf = (view: AppStructureViewV1, table: string, field?: string): string => {
  const found = view.tables.find((candidate) => candidate.displayName === table);
  if (found === undefined) throw new Error(`no table ${table}`);
  if (field === undefined) return found.tableId;
  const named = found.fields.find((candidate) => candidate.displayName === field);
  if (named === undefined) throw new Error(`no field ${field}`);
  return named.fieldId;
};

async function applyChange(page: Page, appId: string, change: SchemaChangeWireV1): Promise<void> {
  const preview = (await ask(page, { kind: "previewSchemaChange", appId, change })).preview;
  if (preview === null || preview.refusal !== null) throw new Error(`preview refused: ${JSON.stringify(preview)}`);
  const outcome = (await ask(page, { kind: "applySchemaChange", appId, change, previewedSchemaRevision: preview.schemaRevision })).outcome;
  if (outcome.result !== "applied") throw new Error(`apply refused: ${JSON.stringify(outcome)}`);
}

/** Every page of one query, walked through both cursors. */
async function walk(
  page: Page,
  appId: string,
  tableId: string,
  query: { readonly filters?: readonly FilterWireV1[]; readonly sort?: SortWireV1 },
  limit: number,
): Promise<{ readonly records: readonly RecordSummaryViewV1[]; readonly totals: readonly (number | null | undefined)[] }> {
  const records: RecordSummaryViewV1[] = [];
  const totals: (number | null | undefined)[] = [];
  let cursor: number | null = null;
  let sortCursor: SortCursorWireV1 | null = null;
  for (let pages = 0; pages < 200; pages += 1) {
    const answered: Extract<DataWorkerResponseV1, { kind: "queryRecords" }> = await ask(page, {
      kind: "queryRecords",
      appId,
      tableId,
      limit,
      cursor,
      sortCursor,
      ...query,
    });
    const next: RecordPageViewV1 | null = answered.page;
    if (next === null) throw new Error(`refused: ${JSON.stringify(answered.refusal)}`);
    records.push(...next.records);
    totals.push(next.total);
    if (!next.hasMore) return { records, totals };
    cursor = next.nextCursor;
    sortCursor = next.nextSortCursor ?? null;
  }
  throw new Error("the walk did not end");
}

test("a records query filters and sorts by a computed value, with exact totals; the authored metric reaches app home (CA-29, CAP-31, CAP-29)", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const buildId = await page.evaluate(() => window.__sheafHarness.buildId);
  test.info().annotations.push({ type: "build-id", description: String(buildId) });

  const appId = await promotedDemo(page);
  const jobs = idOf(await structure(page, appId), "Jobs");
  await applyChange(page, appId, {
    kind: "save-formula",
    formulaId: null,
    target: { kind: "computed-column", tableId: jobs, fieldId: null, newField: { displayName: "Balance (live)", type: { kind: "currency", currencyCode: "USD" } } },
    displayName: null,
    text: "[Quoted amount]-[Paid]",
  });
  const balance = idOf(await structure(page, appId), "Jobs", "Balance (live)");

  // Every job, unfiltered: the reference every answer below is checked against.
  const all = await walk(page, appId, jobs, {}, 100);
  const balanceOf = (record: RecordSummaryViewV1): number | null => {
    const entry = record.values.find((candidate) => candidate.fieldId === balance);
    return entry?.computed?.state === "ok" && entry.value.kind === "number" ? Number(entry.value.decimal) : null;
  };
  const withResult = all.records.filter((record) => balanceOf(record) !== null);
  const without = all.records.filter((record) => balanceOf(record) === null);
  // The demo's two `TBD` quotes have no balance (S03's journey counted them).
  expect(without).toHaveLength(2);
  expect(all.totals.at(-1)).toBe(all.records.length);

  // --- filter by the computed value: exact rows, exact total ---------------
  const atLeast = all.records.filter((record) => (balanceOf(record) ?? -Infinity) >= 1000);
  expect(atLeast.length).toBeGreaterThan(0);
  expect(atLeast.length).toBeLessThan(withResult.length);
  const filtered = await walk(page, appId, jobs, { filters: [{ fieldId: balance, operand: { kind: "number-range", min: "1000", max: null } }] }, 3);
  expect(filtered.records.map((record) => record.recordId)).toEqual(atLeast.map((record) => record.recordId));
  expect(new Set(filtered.totals)).toEqual(new Set([atLeast.length]));

  // "No result" is its own filter: the rows the calculation could not answer.
  const empty = await walk(page, appId, jobs, { filters: [{ fieldId: balance, operand: { kind: "is-empty" } }] }, 100);
  expect(empty.records.map((record) => record.recordId).sort()).toEqual(without.map((record) => record.recordId).sort());
  expect(empty.totals).toEqual([2]);

  // --- sort by the computed value: every row once, missing last ------------
  const sorted = await walk(page, appId, jobs, { sort: { fieldId: balance, direction: "desc" } }, 4);
  expect(sorted.records).toHaveLength(all.records.length);
  expect(new Set(sorted.records.map((record) => record.recordId)).size).toBe(all.records.length);
  const values = sorted.records.map(balanceOf);
  const present = values.filter((value): value is number => value !== null);
  expect(present).toEqual([...present].sort((left, right) => right - left));
  expect(values.slice(present.length)).toEqual([null, null]);
  expect(new Set(sorted.totals)).toEqual(new Set([all.records.length]));

  // --- authored metrics, through the RPC, into "At a glance" (CAP-29) -----
  // A sum over the computed column meets its two errors: the tile says so.
  await applyChange(page, appId, {
    kind: "save-formula",
    formulaId: null,
    target: { kind: "table-metric", tableId: jobs },
    displayName: "Balance due",
    text: "SUM(Jobs[Balance (live)])",
  });
  // A sum over an authored column has a value.
  await applyChange(page, appId, {
    kind: "save-formula",
    formulaId: null,
    target: { kind: "table-metric", tableId: jobs },
    displayName: "Paid total",
    text: "SUM(Jobs[Paid])",
  });
  const paid = idOf(await structure(page, appId), "Jobs", "Paid");
  const metrics = (await ask(page, { kind: "getAppMetrics", appId })).metrics;
  const session = (await ask(page, { kind: "openApp", appId })).session;
  if (session === null) throw new Error("no session");
  const glance = selectMetricsVm(metrics, session.tables, await structure(page, appId));

  expect(glance.find((metric) => metric.label === "Balance due")).toMatchObject({
    tableName: "Jobs",
    status: "error",
    value: null,
    note: "#VALUE!: a value is the wrong kind for the calculation",
    expression: "SUM(Jobs[Balance (live)])",
  });
  const paidTotal = glance.find((metric) => metric.label === "Paid total");
  expect(paidTotal).toMatchObject({ tableName: "Jobs", status: "ok", note: "Live", expression: "SUM(Jobs[Paid])" });
  const expectedPaid = all.records.reduce((total, record) => {
    const entry = record.values.find((candidate) => candidate.fieldId === paid);
    return total + (entry?.value.kind === "number" ? Number(entry.value.decimal) : 0);
  }, 0);
  expect(paidTotal?.value?.kind === "number" ? Number(paidTotal.value.decimal) : null).toBeCloseTo(expectedPaid, 2);
});
