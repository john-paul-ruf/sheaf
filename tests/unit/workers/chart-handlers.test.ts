/**
 * CAP-33 / CA-30 at the handler (S05 CP1): the chart commands and the D61
 * draft through the real dispatch, real crypto, real codecs, the real store
 * (over the IndexedDB shim) and the real SQLite projection — on the F03 demo
 * app, imported the way the import worker imports it.
 *
 * Every write is judged by its durable effect *and* its refusals by their
 * absence of one: a stale builder, an unknown chart and an invalid definition
 * each leave the envelope store exactly as it was. A fresh worker, hydrating
 * from the durable bytes, then reads back what was committed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AppStructureViewV1,
  ChartDefinitionWireV1,
  ChartViewV1,
  StructureFieldViewV1,
  StructureTableViewV1,
} from "../../../src/workers/protocol/messages.js";
import type { DataWorkerCommandHandler } from "../../../src/workers/data/handlers.js";
import {
  ask,
  countEnvelopeRows,
  CRYPTO_TIMEOUT_MS,
  createTestHandler,
  importDemoApp,
  resetLocalDatabase,
  readStoredCatalog,
} from "./data-worker.js";

const PASSPHRASE = "correct horse battery staple";
const SLOW = CRYPTO_TIMEOUT_MS * 4;

let handler: DataWorkerCommandHandler;
let appId: string;
let jobs: StructureTableViewV1;

const fieldNamed = (table: StructureTableViewV1, name: string): StructureFieldViewV1 => {
  const found = table.fields.find((candidate) => candidate.displayName === name);
  if (found === undefined) throw new Error(`no field ${name}`);
  return found;
};

async function structure(): Promise<AppStructureViewV1> {
  const answered = await ask(handler, { kind: "getAppStructure", appId });
  if (answered.structure === null) throw new Error("no structure");
  return answered.structure;
}

beforeAll(async () => {
  await resetLocalDatabase();
  handler = createTestHandler().handler;
  await handler.handle({ kind: "setup", passphrase: PASSPHRASE });
  await handler.handle({ kind: "unlock", passphrase: PASSPHRASE });
  appId = await importDemoApp(handler);
  const found = (await structure()).tables.find((table) => table.displayName === "Jobs");
  if (found === undefined) throw new Error("no Jobs table");
  jobs = found;
}, SLOW);

afterAll(() => {
  handler.dispose();
});

type CategoryChartWire = Extract<ChartDefinitionWireV1, { readonly groupBy: unknown }>;

const byStatus = (name: string, pinned: boolean): CategoryChartWire => ({
  name,
  tableId: jobs.tableId,
  filters: [],
  pinned,
  type: "bar",
  groupBy: { kind: "field", fieldId: fieldNamed(jobs, "Status").fieldId },
  seriesBy: null,
  measure: { kind: "sum", fieldId: fieldNamed(jobs, "Quoted amount").fieldId },
  sort: "category",
});

async function charts(target = handler): Promise<readonly ChartViewV1[]> {
  const answered = await ask(target, { kind: "listCharts", appId });
  if (answered.charts === null) throw new Error("no charts");
  return answered.charts;
}

async function save(definition: ChartDefinitionWireV1, existing: ChartViewV1 | null = null): Promise<ChartViewV1> {
  const countBefore = (await ask(handler, { kind: "openApp", appId })).session!.deviceOnlyChangeCount;
  const { outcome } = await ask(handler, {
    kind: "saveChart",
    appId,
    chartId: existing?.chartId ?? null,
    expectedRevision: existing?.chartRevision ?? null,
    definition,
  });
  if (outcome.result !== "saved") throw new Error(`not saved: ${JSON.stringify(outcome)}`);
  expect((await ask(handler, { kind: "openApp", appId })).session!.deviceOnlyChangeCount).toBe(countBefore + 1);
  expect((await readStoredCatalog(PASSPHRASE)).apps[0]?.scratchReminder?.triggeringCommitId).toBe(outcome.commitId);
  return outcome.chart;
}

describe("chart commands (CA-30)", () => {
  it(
    "saves new charts at the next free ordinal, as user charts at revision 0",
    async () => {
      expect(await charts()).toEqual([]);
      const first = await save(byStatus("Quoted by status", true));
      const second = await save(byStatus("Jobs by status", false));
      expect(first).toMatchObject({ ordinal: 0, chartRevision: 0, provenance: "user" });
      expect(second).toMatchObject({ ordinal: 1, chartRevision: 0, provenance: "user" });
      expect(first.definition).toEqual(byStatus("Quoted by status", true));
      expect((await charts()).map((chart) => chart.definition.name)).toEqual(["Quoted by status", "Jobs by status"]);
    },
    SLOW,
  );

  it(
    "keeps an identical chart save out of history and counts across reopen (CA-37)",
    async () => {
      const [chart] = await charts();
      if (chart === undefined) throw new Error("no chart");
      const before = await ask(handler, { kind: "openApp", appId });
      const reminder = (await readStoredCatalog(PASSPHRASE)).apps[0]?.scratchReminder;
      const history = await ask(handler, { kind: "getChangeHistory", appId, limit: 100 });
      const rows = await countEnvelopeRows();
      const { outcome } = await ask(handler, {
        kind: "saveChart", appId, chartId: chart.chartId,
        expectedRevision: chart.chartRevision, definition: chart.definition,
      });
      expect(outcome).toEqual({ result: "saved", chart, commitId: null });
      expect(await countEnvelopeRows()).toBe(rows);
      expect(await ask(handler, { kind: "getChangeHistory", appId, limit: 100 })).toEqual(history);
      handler.dispose();
      expect((await readStoredCatalog(PASSPHRASE)).apps[0]?.scratchReminder).toEqual(reminder);
      handler = createTestHandler().handler;
      await ask(handler, { kind: "unlock", passphrase: PASSPHRASE });
      expect((await ask(handler, { kind: "openApp", appId })).session?.deviceOnlyChangeCount)
        .toBe(before.session?.deviceOnlyChangeCount);
      expect((await charts())[0]).toEqual(chart);
      expect((await readStoredCatalog(PASSPHRASE)).apps[0]?.scratchReminder).toEqual(reminder);
      expect(await ask(handler, { kind: "getChangeHistory", appId, limit: 100 })).toEqual(history);
    },
    SLOW,
  );

  it(
    "edits against the opened revision, and refuses a stale builder with nothing written",
    async () => {
      const [first] = await charts();
      if (first === undefined) throw new Error("no chart");
      const edited = await save({ ...byStatus("Quoted by status", true), sort: "measure-desc" }, first);
      expect(edited).toMatchObject({ chartId: first.chartId, chartRevision: 1, ordinal: 0 });

      const rows = await countEnvelopeRows();
      const { outcome } = await ask(handler, {
        kind: "saveChart",
        appId,
        chartId: first.chartId,
        expectedRevision: first.chartRevision,
        definition: byStatus("Overwritten", true),
      });
      expect(outcome).toEqual({ result: "stale-chart", chartRevision: 1 });
      expect(await countEnvelopeRows()).toBe(rows);
      expect((await charts())[0]?.definition.name).toBe("Quoted by status");
    },
    SLOW,
  );

  it(
    "refuses a definition the schema does not support, with the reason and nothing written",
    async () => {
      const rows = await countEnvelopeRows();
      const { outcome } = await ask(handler, {
        kind: "saveChart",
        appId,
        chartId: null,
        expectedRevision: null,
        definition: { ...byStatus("", false), measure: { kind: "sum", fieldId: fieldNamed(jobs, "Status").fieldId } },
      });
      expect(outcome.result).toBe("refused");
      if (outcome.result !== "refused") return;
      expect(outcome.refusals.map((refusal) => refusal.reason).sort()).toEqual(["measure-field-type", "missing-name"]);
      expect(await countEnvelopeRows()).toBe(rows);
    },
    SLOW,
  );

  it(
    "pins and unpins as a user change; a pin that already stands writes nothing",
    async () => {
      const before = (await ask(handler, { kind: "openApp", appId })).session!.deviceOnlyChangeCount;
      const second = (await charts())[1];
      if (second === undefined) throw new Error("no chart");
      const pinned = await ask(handler, { kind: "setChartPin", appId, chartId: second.chartId, expectedRevision: 0, pinned: true });
      expect(pinned.outcome).toMatchObject({ result: "saved", chart: { chartRevision: 1, definition: { pinned: true } } });
      if (pinned.outcome.result === "saved") expect(pinned.outcome.commitId).not.toBeNull();
      expect((await ask(handler, { kind: "openApp", appId })).session!.deviceOnlyChangeCount).toBe(before + 1);

      const rows = await countEnvelopeRows();
      const again = await ask(handler, { kind: "setChartPin", appId, chartId: second.chartId, expectedRevision: 1, pinned: true });
      expect(again.outcome).toMatchObject({ result: "saved", commitId: null });
      expect(await countEnvelopeRows()).toBe(rows);
      expect((await ask(handler, { kind: "openApp", appId })).session!.deviceOnlyChangeCount).toBe(before + 1);
    },
    SLOW,
  );

  it(
    "deletes against the opened revision and files every chart event under the chart",
    async () => {
      const rows = await countEnvelopeRows();
      const unknown = await ask(handler, {
        kind: "deleteChart",
        appId,
        chartId: "AAAAAAAAAAAAAAAAAAAAAA",
        expectedRevision: 0,
      });
      expect(unknown.outcome).toEqual({ result: "unknown-chart" });
      expect(await countEnvelopeRows()).toBe(rows);

      const second = (await charts())[1];
      if (second === undefined) throw new Error("no chart");
      const deleted = await ask(handler, { kind: "deleteChart", appId, chartId: second.chartId, expectedRevision: 1 });
      expect(deleted.outcome).toMatchObject({ result: "deleted", chartId: second.chartId });
      expect((await charts()).map((chart) => chart.definition.name)).toEqual(["Quoted by status"]);

      const history = (await ask(handler, { kind: "getChangeHistory", appId, limit: 20 })).page;
      const chartEvents = history?.entries.filter((entry) => entry.subjectKind === "chart") ?? [];
      expect(chartEvents.map((entry) => entry.eventKind)).toEqual([
        "chart.deleted",
        "chart.saved",
        "chart.saved",
        "chart.saved",
        "chart.saved",
      ]);
      expect(chartEvents.every((entry) => entry.tableId === jobs.tableId)).toBe(true);
    },
    SLOW,
  );
});

describe("chart datasets over the wire (CA-30)", () => {
  it(
    "draws a saved chart from all 60 rows, and every mark's intent finds exactly its count",
    async () => {
      const [chart] = await charts();
      if (chart === undefined) throw new Error("no chart");
      const { dataset } = await ask(handler, { kind: "getChartDataset", appId, source: { kind: "chart", chartId: chart.chartId } });
      if (dataset === null) throw new Error("no dataset");
      expect(dataset.chart?.chartId).toBe(chart.chartId);
      expect(dataset).toMatchObject({ sourceRowsConsidered: 60, matchingRows: 60, tableTotal: 60, sample: null, omittedCategories: 0 });
      expect(dataset.marks.length).toBeGreaterThan(1);
      let counted = 0;
      for (const mark of dataset.marks) {
        if (mark.kind !== "group" || mark.filterIntent === null) continue;
        const { page } = await ask(handler, { kind: "queryRecords", appId, tableId: jobs.tableId, filters: mark.filterIntent, limit: 1 });
        expect(page?.total).toBe(mark.records);
        counted += mark.records;
      }
      expect(counted).toBe(60);
    },
    SLOW,
  );

  it(
    "previews a draft without saving it, and refuses one the schema does not support",
    async () => {
      const rows = await countEnvelopeRows();
      const preview = await ask(handler, { kind: "getChartDataset", appId, source: { kind: "draft", definition: byStatus("Preview", false) } });
      expect(preview.dataset?.chart).toBeNull();
      expect(preview.dataset?.definition.name).toBe("Preview");
      const refused = await ask(handler, {
        kind: "getChartDataset",
        appId,
        source: { kind: "draft", definition: { ...byStatus("Bad", false), measure: { kind: "sum", fieldId: fieldNamed(jobs, "Status").fieldId } } },
      });
      expect(refused.dataset).toBeNull();
      expect(refused.refusals?.map((refusal) => refusal.reason)).toEqual(["measure-field-type"]);
      expect(await countEnvelopeRows()).toBe(rows);
    },
    SLOW,
  );
});

describe("chart drafts (D61)", () => {
  it(
    "saves, restores and discards one draft per app, authoring no event",
    async () => {
      expect((await ask(handler, { kind: "getChartDraft", appId })).draft).toBeNull();
      const history = async () => (await ask(handler, { kind: "getChangeHistory", appId, limit: 50 })).page?.entries.length;
      const before = await history();

      const draft = { chartId: null, expectedRevision: null, definition: byStatus("Draft chart", false) };
      expect((await ask(handler, { kind: "saveChartDraft", appId, draft })).saved).toBe(true);
      expect((await ask(handler, { kind: "getChartDraft", appId })).draft).toEqual(draft);
      expect(await history()).toBe(before);

      const unknown = await ask(handler, { kind: "saveChartDraft", appId: "no-such-app", draft });
      expect(unknown.saved).toBe(false);

      await ask(handler, { kind: "discardChartDraft", appId });
      expect((await ask(handler, { kind: "getChartDraft", appId })).draft).toBeNull();
    },
    SLOW,
  );

  it(
    "keeps an edit draft's chart and revision",
    async () => {
      const [chart] = await charts();
      if (chart === undefined) throw new Error("no chart");
      const draft = { chartId: chart.chartId, expectedRevision: chart.chartRevision, definition: byStatus("Renamed", true) };
      await ask(handler, { kind: "saveChartDraft", appId, draft });
      expect((await ask(handler, { kind: "getChartDraft", appId })).draft).toEqual(draft);
    },
    SLOW,
  );
});

describe("a fresh worker reads what was committed", () => {
  it(
    "hydrates the charts and the draft from the durable bytes",
    async () => {
      const committed = await charts();
      const draft = (await ask(handler, { kind: "getChartDraft", appId })).draft;
      await handler.handle({ kind: "lock" });
      handler.dispose();
      handler = createTestHandler().handler;
      await handler.handle({ kind: "unlock", passphrase: PASSPHRASE });

      expect(await charts()).toEqual(committed);
      expect((await ask(handler, { kind: "getChartDraft", appId })).draft).toEqual(draft);
      // The replayed revision still guards: the next edit starts from it.
      const [chart] = committed;
      if (chart === undefined) throw new Error("no chart");
      expect((await save(byStatus("After reopen", true), chart)).chartRevision).toBe(chart.chartRevision + 1);
    },
    SLOW,
  );
});
