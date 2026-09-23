/**
 * CA-30 and CAP-33's relationship grouping through the real worker (S05 CP4).
 *
 * The harness page drives the real `DataWorkerClient` and so the real
 * `data.worker` over `postMessage`: real IndexedDB through real libsodium,
 * the aggregate in real SQLite WASM. The app is the F03 demo, imported through
 * the real import worker exactly as `live-formulas.spec.ts` seeds it.
 *
 * The journey: a bar chart of Jobs grouped by the Customer's Name — a field
 * of the parent table, reached through the relationship Sheaf detected (D54)
 * — is saved; its dataset's every mark carries a filter intent that the
 * records query answers with exactly the mark's count; the chart and a draft
 * survive lock, a new worker and unlock; a stale edit commits nothing.
 */

import { expect, test, type Page } from "@playwright/test";
import type {
  AppStructureViewV1,
  ChartDefinitionWireV1,
  DataWorkerRequestV1,
  DataWorkerResponseV1,
} from "../../../src/workers/protocol/messages.js";
import { DEMO_LIVE_STRUCTURE_STATEMENTS } from "../../fixtures/workbooks/ooxml/demo-counts.js";
import { PASSPHRASE, command, installFixture, start, teardown } from "./runtime.js";
import { runWorkbookImport } from "./workbook-runtime.js";

const JOURNEY_TIMEOUT_MS = 240_000;
const WORKBOOK_FLOWS = ["delimited", "workbook"] as const;

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

/** The F03 demo app, built through the real import worker (the proven seed). */
async function promotedDemo(page: Page): Promise<string> {
  await start(page);
  expect((await command(page, { kind: "setup", passphrase: PASSPHRASE })).ok).toBe(true);
  await installFixture(page, "ooxml/fieldwork-q3.xlsx", "fieldwork-q3.xlsx");
  const run = await runWorkbookImport(page, { flows: WORKBOOK_FLOWS, selection: [0, 1, 2, 3, 4, 5] });
  expect(run.events.some((event) => event.kind === "completed")).toBe(true);
  const stageId = run.stageId as string;
  await ask(page, { kind: "runInference", stageId });
  for (const statementId of DEMO_LIVE_STRUCTURE_STATEMENTS) {
    const rejected = await ask(page, { kind: "applyReviewEdit", stageId, edit: { kind: "reject-statement", statementId } });
    expect(rejected.outcome).toBe("applied");
  }
  const promoted = await ask(page, { kind: "promoteImport", stageId, acceptedName: "Fieldwork Q3" });
  if (promoted.outcome !== "promoted") throw new Error(`promotion refused: ${promoted.reason}`);
  return promoted.appId;
}

const tableNamed = (view: AppStructureViewV1, name: string) => {
  const found = view.tables.find((candidate) => candidate.displayName === name);
  if (found === undefined) throw new Error(`no table ${name}`);
  return found;
};

test("a chart grouped across a relationship: saved, every mark's intent counted exactly, reopened in a new worker (CA-30, CAP-33)", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const appId = await promotedDemo(page);
  const structure = (await ask(page, { kind: "getAppStructure", appId })).structure;
  if (structure === null) throw new Error("no structure");
  const jobs = tableNamed(structure, "Jobs");
  const customers = tableNamed(structure, "Customers");
  const relationship = structure.relationships.find(
    (candidate) => candidate.fromTableId === jobs.tableId && candidate.toTableId === customers.tableId && candidate.isActive,
  );
  if (relationship === undefined) throw new Error("no Jobs → Customers relationship");
  const name = customers.fields.find((field) => field.displayName === "Name");
  const quoted = jobs.fields.find((field) => field.displayName === "Quoted amount");
  if (name === undefined || quoted === undefined) throw new Error("no Name or Quoted amount");

  const definition: ChartDefinitionWireV1 = {
    name: "Quoted by customer",
    tableId: jobs.tableId,
    filters: [],
    pinned: true,
    type: "bar",
    groupBy: { kind: "related-field", relationshipId: relationship.relationshipId, referenceFieldId: relationship.fromFieldId, fieldId: name.fieldId },
    seriesBy: null,
    measure: { kind: "sum", fieldId: quoted.fieldId },
    sort: "measure-desc",
  };
  const saved = (await ask(page, { kind: "saveChart", appId, chartId: null, expectedRevision: null, definition })).outcome;
  if (saved.result !== "saved") throw new Error(`not saved: ${JSON.stringify(saved)}`);
  const chartId = saved.chart.chartId;

  // The dataset: every source row read, grouped by the parent's field.
  const { dataset } = await ask(page, { kind: "getChartDataset", appId, source: { kind: "chart", chartId } });
  if (dataset === null) throw new Error("no dataset");
  expect(dataset).toMatchObject({ matchingRows: jobs.recordCount, sourceRowsConsidered: jobs.recordCount, sample: null, omittedCategories: 0 });
  const named = dataset.marks.filter((mark) => mark.kind === "group" && mark.category.kind === "value");
  expect(named.length).toBeGreaterThan(1);
  // Largest first: the chart was saved sorted by its measure.
  const values = named.map((mark) => (mark.kind === "group" ? Number(mark.value) : 0));
  expect([...values].sort((left, right) => right - left)).toEqual(values);

  // Every mark with an intent: the records query finds exactly its count.
  let counted = 0;
  for (const mark of dataset.marks) {
    if (mark.kind !== "group") continue;
    counted += mark.records;
    if (mark.filterIntent === null) continue;
    expect(mark.filterIntent.at(-1)?.operand.kind).toBe(mark.category.kind === "empty" ? "is-empty" : "reference-in");
    const { page: records } = await ask(page, { kind: "queryRecords", appId, tableId: jobs.tableId, filters: mark.filterIntent, limit: 1 });
    expect(records?.total, JSON.stringify(mark.category)).toBe(mark.records);
  }
  expect(counted).toBe(jobs.recordCount);

  // A draft beside it (D61), then a new worker: both are still there.
  await ask(page, { kind: "saveChartDraft", appId, draft: { chartId, expectedRevision: 0, definition: { ...definition, name: "Unsaved rename" } } });
  expect((await command(page, { kind: "lock" })).ok).toBe(true);
  await page.evaluate(() => {
    window.__sheafApp?.dispose();
  });
  await page.goto("/harness.html");
  await start(page);
  expect((await command(page, { kind: "unlock", passphrase: PASSPHRASE })).ok).toBe(true);

  const listed = (await ask(page, { kind: "listCharts", appId })).charts;
  expect(listed?.map((chart) => [chart.chartId, chart.definition.name, chart.chartRevision, chart.provenance])).toEqual([
    [chartId, "Quoted by customer", 0, "user"],
  ]);
  const reopened = (await ask(page, { kind: "getChartDataset", appId, source: { kind: "chart", chartId } })).dataset;
  expect(reopened?.marks).toEqual(dataset.marks);
  expect((await ask(page, { kind: "getChartDraft", appId })).draft?.definition.name).toBe("Unsaved rename");

  // A pin toggled here, then an edit made against the old revision: refused, nothing written.
  const unpinned = (await ask(page, { kind: "setChartPin", appId, chartId, expectedRevision: 0, pinned: false })).outcome;
  expect(unpinned).toMatchObject({ result: "saved", chart: { chartRevision: 1, definition: { pinned: false } } });
  const stale = (await ask(page, { kind: "saveChart", appId, chartId, expectedRevision: 0, definition: { ...definition, name: "Stale" } })).outcome;
  expect(stale).toEqual({ result: "stale-chart", chartRevision: 1 });
  expect((await ask(page, { kind: "getChart", appId, chartId })).chart?.definition.name).toBe("Quoted by customer");
});
