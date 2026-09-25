/**
 * CAP-35 / CAP-36 and CA-28 at the handler (S03 CP3): every D59 change kind,
 * through the real dispatch, real crypto, real codecs, the real store (over
 * the IndexedDB shim, D8) and the real SQLite projection — on the F03 demo
 * app, imported the way the import worker imports it.
 *
 * Each change is previewed, then applied against the previewed revision, and
 * the two impact reports must be equal. Beside them: a stale preview and a
 * change past the segment cap commit nothing; a conversion counts what it
 * converts and keeps; a currency type change keeps its code across a fresh
 * worker (the F02 carry, CA-28); and the record commands beside a computed
 * column refuse a write to it, freeze a new row's literal, and name the
 * columns they recalculated.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AppStructureViewV1,
  DataWorkerResponseV1,
  ImpactReportWireV1,
  SchemaChangeWireV1,
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

async function open(target: DataWorkerCommandHandler): Promise<void> {
  const unlocked = await target.handle({ kind: "unlock", passphrase: PASSPHRASE });
  expect(unlocked.kind).toBe("unlock");
}

beforeAll(async () => {
  await resetLocalDatabase();
  handler = createTestHandler().handler;
  await handler.handle({ kind: "setup", passphrase: PASSPHRASE });
  await open(handler);
  appId = await importDemoApp(handler);
}, SLOW);

afterAll(() => {
  handler.dispose();
});

async function structure(target = handler): Promise<AppStructureViewV1> {
  const answered = await ask(target, { kind: "getAppStructure", appId });
  if (answered.structure === null) throw new Error("no structure");
  return answered.structure;
}

const tableNamed = (view: AppStructureViewV1, name: string): StructureTableViewV1 => {
  const table = view.tables.find((candidate) => candidate.displayName === name);
  if (table === undefined) throw new Error(`no table ${name}`);
  return table;
};

const fieldNamed = (table: StructureTableViewV1, name: string): StructureFieldViewV1 => {
  const field = table.fields.find((candidate) => candidate.displayName === name);
  if (field === undefined) throw new Error(`no field ${name}`);
  return field;
};

/** Preview, then apply at the previewed revision: the two impacts must be one. */
async function change(
  wire: SchemaChangeWireV1,
): Promise<{ readonly impact: ImpactReportWireV1; readonly eventCount: number; readonly recalculated: readonly string[] }> {
  const countBefore = (await ask(handler, { kind: "openApp", appId })).session!.deviceOnlyChangeCount;
  const preview = (await ask(handler, { kind: "previewSchemaChange", appId, change: wire })).preview;
  if (preview === null) throw new Error("no preview");
  expect(preview.refusal).toBeNull();
  expect(preview.isTooLarge).toBe(false);
  const outcome = (await ask(handler, { kind: "applySchemaChange", appId, change: wire, previewedSchemaRevision: preview.schemaRevision }))
    .outcome;
  if (outcome.result !== "applied") throw new Error(`not applied: ${JSON.stringify(outcome)}`);
  expect(outcome.impact).toEqual(preview.impact);
  expect(outcome.impact.change).toBe(wire.kind);
  expect(outcome.schemaRevision).toBe(preview.schemaRevision + 1);
  expect((await ask(handler, { kind: "openApp", appId })).session!.deviceOnlyChangeCount).toBe(countBefore + 1);
  expect((await readStoredCatalog(PASSPHRASE)).apps.find((entry) => entry.appId === appId)?.scratchReminder?.triggeringCommitId).toBe(outcome.commitId);
  return { impact: preview.impact, eventCount: preview.eventCount, recalculated: outcome.recalculated.fieldIds };
}

const records = async (tableId: string) => {
  const page = (await ask(handler, { kind: "queryRecords", appId, tableId, limit: 100 })).page;
  if (page === null) throw new Error("no page");
  return page.records;
};

type RecordRow = Awaited<ReturnType<typeof records>>[number];

/** A number or currency cell's amount; null for anything else (a kept `TBD`, an empty cell). */
const amountOf = (record: RecordRow, fieldId: string): number | null => {
  const value = record.values.find((entry) => entry.fieldId === fieldId)?.value;
  return value?.kind === "number" ? Number(value.decimal) : null;
};

const warnings = (rows: readonly RecordRow[]): number => rows.reduce((sum, record) => sum + record.warningIssueCount, 0);

describe("every D59 change, previewed and applied at one revision (CA-28)", () => {
  it("does not author unchanged names, required flags or field order, including after reopen (CA-37)", async () => {
    const view = await structure();
    const jobs = tableNamed(view, "Jobs");
    const field = fieldNamed(jobs, "Paid");
    const changes: readonly SchemaChangeWireV1[] = [
      { kind: "rename-app", name: view.displayName },
      { kind: "rename-table", tableId: jobs.tableId, name: jobs.displayName },
      { kind: "rename-field", fieldId: field.fieldId, name: field.displayName },
      { kind: "set-required", fieldId: field.fieldId, isRequired: field.isRequired },
      { kind: "reorder-fields", tableId: jobs.tableId, fieldIds: jobs.fields.map((entry) => entry.fieldId) },
    ];
    const before = await ask(handler, { kind: "openApp", appId });
    const reminder = (await readStoredCatalog(PASSPHRASE)).apps[0]?.scratchReminder;
    expect(reminder).toBeNull();
    const history = await ask(handler, { kind: "getChangeHistory", appId, limit: 100 });
    const rows = await countEnvelopeRows();
    for (const wire of changes) {
      const preview = (await ask(handler, { kind: "previewSchemaChange", appId, change: wire })).preview!;
      expect(preview.refusal).toBeNull();
      expect(preview.eventCount).toBe(0);
      const { outcome } = await ask(handler, {
        kind: "applySchemaChange", appId, change: wire, previewedSchemaRevision: preview.schemaRevision,
      });
      expect(outcome).toEqual({ result: "unchanged", schemaRevision: view.schemaRevision });
      expect(await countEnvelopeRows()).toBe(rows);
    }
    expect(await ask(handler, { kind: "getChangeHistory", appId, limit: 100 })).toEqual(history);
    handler.dispose();
    handler = createTestHandler().handler;
    await open(handler);
    expect(await structure()).toEqual(view);
    expect((await readStoredCatalog(PASSPHRASE)).apps[0]?.scratchReminder).toEqual(reminder);
    expect((await ask(handler, { kind: "openApp", appId })).session?.deviceOnlyChangeCount)
      .toBe(before.session?.deviceOnlyChangeCount);
    expect(await ask(handler, { kind: "getChangeHistory", appId, limit: 100 })).toEqual(history);
  }, SLOW);

  it(
    "renames the app, a table, and sets a table's label and key",
    async () => {
      await change({ kind: "rename-app", name: "Fieldwork 2026" });
      const before = await structure();
      await change({ kind: "rename-table", tableId: tableNamed(before, "Materials").tableId, name: "Supplies" });
      const jobs = tableNamed(before, "Jobs");
      await change({ kind: "set-table-label", tableId: jobs.tableId, labelFieldId: fieldNamed(jobs, "Customer").fieldId });
      const supplies = tableNamed(await structure(), "Supplies");
      const keyed = await change({ kind: "set-table-key", tableId: supplies.tableId, keyFieldId: fieldNamed(supplies, "Material").fieldId });
      expect(keyed.impact).toMatchObject({ total: 8, missingNow: 0, keptAndFlagged: 0 });

      const after = await structure();
      expect(after.displayName).toBe("Fieldwork 2026");
      expect(tableNamed(after, "Supplies").keyFieldId).toBe(fieldNamed(supplies, "Material").fieldId);
      expect(tableNamed(after, "Jobs").labelFieldId).toBe(fieldNamed(jobs, "Customer").fieldId);
      expect((await ask(handler, { kind: "openApp", appId })).session?.displayName).toBe("Fieldwork 2026");
    },
    SLOW,
  );

  it(
    "creates, renames, re-options, requires and reorders a field — dropping no option",
    async () => {
      const jobs = tableNamed(await structure(), "Jobs");
      await change({
        kind: "create-field",
        tableId: jobs.tableId,
        displayName: "Priority",
        type: { kind: "enum" },
        isRequired: false,
        optionLabels: ["High", "Low"],
      });
      const created = fieldNamed(tableNamed(await structure(), "Jobs"), "Priority");
      expect(created.enumOptions.map((option) => option.label)).toEqual(["High", "Low"]);

      await change({ kind: "rename-field", fieldId: created.fieldId, name: "Urgency" });
      const high = created.enumOptions[0]!;
      const reoptioned = await change({
        kind: "set-enum-options",
        fieldId: created.fieldId,
        options: [
          { optionId: high.optionId, label: "Urgent", isActive: true },
          { optionId: null, label: "Medium", isActive: true },
        ],
      });
      expect(reoptioned.impact).toMatchObject({ onRemovedOptions: 0, total: 60 });
      const urgency = fieldNamed(tableNamed(await structure(), "Jobs"), "Urgency");
      // "Low" was dropped from the list: it stays, inactive, never deleted.
      expect(urgency.enumOptions.map((option) => `${option.label}:${option.isActive}`)).toEqual(["Urgent:true", "Medium:true", "Low:false"]);
      expect(urgency.enumOptions[0]?.optionId).toBe(high.optionId);

      const required = await change({ kind: "set-required", fieldId: urgency.fieldId, isRequired: true });
      // Nobody has an urgency yet: every job is now missing a required value.
      expect(required.impact).toMatchObject({ missingNow: 60, affected: 60 });
      const flagged = await records(jobs.tableId);
      expect(flagged.every((record) => record.blockingIssueCount > 0)).toBe(true);
      await change({ kind: "set-required", fieldId: urgency.fieldId, isRequired: false });

      const order = tableNamed(await structure(), "Jobs").fields.map((field) => field.fieldId);
      const moved = [urgency.fieldId, ...order.filter((fieldId) => fieldId !== urgency.fieldId)];
      await change({ kind: "reorder-fields", tableId: jobs.tableId, fieldIds: moved });
      expect(tableNamed(await structure(), "Jobs").fields.map((field) => field.fieldId)).toEqual(moved);
    },
    SLOW,
  );

  it(
    "converts a type, counting what converts and what is kept, and keeps a currency's code across a fresh worker",
    async () => {
      const jobs = tableNamed(await structure(), "Jobs");
      const quoted = fieldNamed(jobs, "Quoted amount");
      const toText = await change({ kind: "change-field-type", fieldId: quoted.fieldId, type: { kind: "text" } });
      expect(toText.impact.converted).toBe(60);
      expect(toText.eventCount).toBe(61);

      const toEuro = await change({ kind: "change-field-type", fieldId: quoted.fieldId, type: { kind: "currency", currencyCode: "EUR" } });
      // The two `TBD` quotes do not parse: kept as they were written, and flagged (D57).
      expect(toEuro.impact).toMatchObject({ converted: 58, keptAndFlagged: 2, affected: 60 });
      expect(toEuro.eventCount).toBe(61);

      // A fresh worker, hydrating from the durable bytes, still names the code.
      await handler.handle({ kind: "lock" });
      handler.dispose();
      handler = createTestHandler().handler;
      await open(handler);
      const reopened = fieldNamed(tableNamed(await structure(), "Jobs"), "Quoted amount");
      expect(reopened.type).toEqual({ kind: "currency", currencyCode: "EUR" });
      const fields = (await ask(handler, { kind: "openApp", appId })).session?.tables.find((table) => table.displayName === "Jobs")?.fields;
      expect(fields?.find((field) => field.displayName === "Quoted amount")?.type).toEqual({ kind: "currency", currencyCode: "EUR" });
    },
    SLOW,
  );

  it(
    "deactivates and reactivates a field, keeping its values",
    async () => {
      const jobs = tableNamed(await structure(), "Jobs");
      const material = fieldNamed(jobs, "Material");
      const off = await change({ kind: "deactivate-field", fieldId: material.fieldId });
      expect(off.impact).toMatchObject({ affected: 0, total: 60 });
      expect(fieldNamed(tableNamed(await structure(), "Jobs"), "Material").isActive).toBe(false);
      await change({ kind: "reactivate-field", fieldId: material.fieldId });
      const values = (await records(jobs.tableId)).map(
        (record) => record.values.find((entry) => entry.fieldId === material.fieldId)?.value.kind,
      );
      expect(values.filter((kind) => kind === "option").length).toBeGreaterThan(0);
    },
    SLOW,
  );

  it(
    "creates a relationship by converting a key column, disables it, and removes it with a fingerprint (D64)",
    async () => {
      const view = await structure();
      const visits = tableNamed(view, "Visits");
      const jobs = tableNamed(view, "Jobs");
      const created = await change({
        kind: "set-relationship",
        relationshipId: null,
        fromFieldId: fieldNamed(visits, "Job ID").fieldId,
        toTableId: jobs.tableId,
        isActive: true,
      });
      // Every visit's job ID names a job (the F03 key-match evidence).
      expect(created.impact).toMatchObject({ matchedKeys: 40, unmatchedKeys: 0, affected: 40 });
      expect(created.eventCount).toBe(42);
      const linked = await structure();
      expect(fieldNamed(tableNamed(linked, "Visits"), "Job ID").type).toEqual({ kind: "reference" });
      const relationship = linked.relationships.find((entry) => entry.fromTableName === "Visits");
      if (relationship === undefined) throw new Error("no relationship");

      await change({
        kind: "set-relationship",
        relationshipId: relationship.relationshipId,
        fromFieldId: relationship.fromFieldId,
        toTableId: jobs.tableId,
        isActive: false,
      });
      expect((await structure()).relationships.find((entry) => entry.relationshipId === relationship.relationshipId)?.isActive).toBe(false);

      const removed = await change({ kind: "remove-relationship", relationshipId: relationship.relationshipId });
      expect(removed.impact.unlinkedReferences).toBe(40);
      expect((await structure()).relationships.some((entry) => entry.relationshipId === relationship.relationshipId)).toBe(false);
      // The values stay references, now unlinked and flagged — never dropped.
      const visitRecords = await records(visits.tableId);
      expect(visitRecords.every((record) => record.values.some((entry) => entry.value.kind === "reference"))).toBe(true);
    },
    SLOW,
  );

  it(
    "saves a cross-field rule that flags exactly the failing records, then removes it (CA-27)",
    async () => {
      const jobs = tableNamed(await structure(), "Jobs");
      const paid = fieldNamed(jobs, "Paid").fieldId;
      const quoted = fieldNamed(jobs, "Quoted amount").fieldId;
      const before = await records(jobs.tableId);
      // Counted here from the rows themselves, independently of M02: a job fails
      // when both amounts are numbers and less was paid than quoted.
      const underpaid = before.filter((record) => {
        const paidAmount = amountOf(record, paid);
        const quotedAmount = amountOf(record, quoted);
        return paidAmount !== null && quotedAmount !== null && paidAmount < quotedAmount;
      }).length;
      expect(underpaid).toBeGreaterThan(0);
      const saved = await change({
        kind: "save-rule",
        ruleId: null,
        tableId: jobs.tableId,
        displayName: "Paid in full",
        condition: { kind: "compare", left: paid, op: "ge", right: { field: quoted } },
        severity: "warning",
      });
      expect(saved.impact.failingRule).toBe(underpaid);
      const listed = tableNamed(await structure(), "Jobs").rules[0];
      expect(listed).toMatchObject({ displayName: "Paid in full", irVersion: 2, condition: { kind: "compare", op: "ge" } });
      expect(warnings(await records(jobs.tableId)) - warnings(before)).toBe(underpaid);
      const removed = await change({ kind: "remove-rule", ruleId: listed!.ruleId });
      expect(removed.impact.failingRule).toBe(underpaid);
      expect(tableNamed(await structure(), "Jobs").rules).toEqual([]);
      expect(warnings(await records(jobs.tableId))).toBe(warnings(before));
    },
    SLOW,
  );

  it(
    "counts a has-a-value rule over exactly the jobs with no quote (CA-27)",
    async () => {
      const jobs = tableNamed(await structure(), "Jobs");
      const quoted = fieldNamed(jobs, "Quoted amount").fieldId;
      const unquoted = (await records(jobs.tableId)).filter((record) => {
        const kind = record.values.find((entry) => entry.fieldId === quoted)?.value.kind;
        return kind === undefined || kind === "missing" || kind === "blank";
      }).length;
      const preview = (
        await ask(handler, {
          kind: "previewSchemaChange",
          appId,
          change: { kind: "save-rule", ruleId: null, tableId: jobs.tableId, displayName: "Quoted", condition: { kind: "field-present", fieldId: quoted }, severity: "warning" },
        })
      ).preview;
      expect(preview?.impact).toMatchObject({ total: 60, failingRule: unquoted });
      expect(unquoted).toBeLessThan(60);
    },
    SLOW,
  );

  it(
    "refuses an authored save that breaks a saved blocking rule, committing nothing (CA-27, invariant 5)",
    async () => {
      const jobs = tableNamed(await structure(), "Jobs");
      const paid = fieldNamed(jobs, "Paid").fieldId;
      const quoted = fieldNamed(jobs, "Quoted amount").fieldId;
      await change({
        kind: "save-rule",
        ruleId: null,
        tableId: jobs.tableId,
        displayName: "Paid within quote",
        condition: { kind: "compare", left: paid, op: "le", right: { field: quoted } },
        severity: "blocking",
      });
      const job = (await records(jobs.tableId)).find((record) => amountOf(record, quoted) !== null && amountOf(record, paid) !== null)!;
      const paidBefore = job.values.find((entry) => entry.fieldId === paid)?.value;
      const rows = await countEnvelopeRows();
      const refused = await handler.handle({
        kind: "patchRecord",
        appId,
        recordId: job.recordId,
        changes: [{ fieldId: paid, value: { kind: "number", decimal: String(amountOf(job, quoted)! + 1) } }],
      });
      if (refused.kind !== "patchRecord") throw new Error(refused.kind);
      expect(refused.outcome).toBe("rejected");
      expect(refused.outcome === "rejected" && refused.report.issues.map((issue) => `${issue.kind}:${issue.severity}`)).toEqual([
        "record-rule:blocking",
      ]);
      expect(await countEnvelopeRows()).toBe(rows);
      const detail = (await ask(handler, { kind: "getRecord", appId, recordId: job.recordId })).record;
      expect(detail?.values.find((entry) => entry.fieldId === paid)?.value).toEqual(paidBefore);

      const rule = tableNamed(await structure(), "Jobs").rules[0];
      await change({ kind: "remove-rule", ruleId: rule!.ruleId });
    },
    SLOW,
  );

  it(
    "saves a live computed column, a metric and a dashboard value, and removes the metric (CA-25, CA-26)",
    async () => {
      const jobs = tableNamed(await structure(), "Jobs");
      const column = await change({
        kind: "save-formula",
        formulaId: null,
        target: {
          kind: "computed-column",
          tableId: jobs.tableId,
          fieldId: null,
          newField: { displayName: "Balance (live)", type: { kind: "currency", currencyCode: "EUR" } },
        },
        displayName: null,
        text: "=[Quoted amount]-[Paid]",
      });
      // The two kept `TBD` quotes cannot be subtracted from.
      expect(column.impact.formulaErrors).toBe(2);
      expect(column.eventCount).toBe(2);
      const balance = fieldNamed(tableNamed(await structure(), "Jobs"), "Balance (live)");
      expect(column.recalculated).toContain(balance.fieldId);
      const formula = (await structure()).formulas.find(
        (entry) => entry.target.kind === "computed-column" && entry.target.fieldId === balance.fieldId,
      );
      expect(formula).toMatchObject({ text: "[Quoted amount]-[Paid]", disposition: "live", determinism: "deterministic" });
      const states = (await records(jobs.tableId)).map(
        (record) => record.values.find((entry) => entry.fieldId === balance.fieldId)?.computed?.state,
      );
      expect(states.filter((state) => state === "ok")).toHaveLength(58);
      expect(states.filter((state) => state === "error")).toHaveLength(2);

      await change({
        kind: "save-formula",
        formulaId: null,
        target: { kind: "table-metric", tableId: jobs.tableId },
        displayName: "Paid total",
        text: "SUM(Jobs[Paid])",
      });
      await change({
        kind: "save-formula",
        formulaId: null,
        target: { kind: "dashboard-value", tableId: null },
        displayName: "Twice paid",
        text: "[Paid total]*2",
      });
      const metrics = (await ask(handler, { kind: "getAppMetrics", appId })).metrics;
      const paidTotal = metrics?.tables.find((table) => table.tableId === jobs.tableId)?.metrics[0];
      expect(paidTotal).toMatchObject({ displayName: "Paid total", status: "ok" });
      const twice = metrics?.dashboard[0];
      expect(twice).toMatchObject({ displayName: "Twice paid", status: "ok" });
      const decimal = (value: unknown): number => Number((value as { decimal: string }).decimal);
      expect(decimal(twice?.value)).toBeCloseTo(decimal(paidTotal?.value) * 2, 6);

      await change({ kind: "remove-formula", formulaId: paidTotal!.formulaId });
      const remaining = (await ask(handler, { kind: "getAppMetrics", appId })).metrics;
      expect(remaining?.tables.find((table) => table.tableId === jobs.tableId)?.metrics).toEqual([]);
      // The dashboard value that read it now truthfully cannot.
      expect(remaining?.dashboard[0]?.status).toBe("error");
    },
    SLOW,
  );

  it(
    "freezes a RAND() column once per record, as authored literals in the same commit (D51)",
    async () => {
      const jobs = tableNamed(await structure(), "Jobs");
      const frozen = await change({
        kind: "save-formula",
        formulaId: null,
        target: { kind: "computed-column", tableId: jobs.tableId, fieldId: null, newField: { displayName: "Lottery", type: { kind: "number" } } },
        displayName: null,
        text: "RAND()",
      });
      // field.created + formula.changed + one literal per job.
      expect(frozen.eventCount).toBe(62);
      const lottery = fieldNamed(tableNamed(await structure(), "Jobs"), "Lottery");
      const states = (await records(jobs.tableId)).map(
        (record) => record.values.find((entry) => entry.fieldId === lottery.fieldId)?.computed?.state,
      );
      expect(new Set(states)).toEqual(new Set(["frozen"]));
    },
    SLOW,
  );

  it(
    "refuses unknown formula names with where they are, and an empty name, committing nothing",
    async () => {
      const jobs = tableNamed(await structure(), "Jobs");
      const rows = await countEnvelopeRows();
      const unknown = (
        await ask(handler, {
          kind: "previewSchemaChange",
          appId,
          change: {
            kind: "save-formula",
            formulaId: null,
            target: { kind: "table-metric", tableId: jobs.tableId },
            displayName: "X",
            text: "SUM(Jobs[Nope])+1",
          },
        })
      ).preview;
      expect(unknown?.refusal).toEqual({ kind: "formula", reason: "unknown-name", detail: "Jobs[Nope]", position: 4 });
      const applied = (
        await ask(handler, {
          kind: "applySchemaChange",
          appId,
          change: { kind: "rename-field", fieldId: fieldNamed(jobs, "Paid").fieldId, name: "   " },
          previewedSchemaRevision: unknown!.schemaRevision,
        })
      ).outcome;
      expect(applied).toEqual({ result: "refused", refusal: { kind: "invalid-change", reason: "empty-name" } });
      expect(await countEnvelopeRows()).toBe(rows);
    },
    SLOW,
  );
});

describe("the apply names the revision its preview saw", () => {
  it(
    "refuses a stale preview with no commit",
    async () => {
      const jobs = tableNamed(await structure(), "Jobs");
      const stale: SchemaChangeWireV1 = { kind: "rename-table", tableId: jobs.tableId, name: "Work orders" };
      const preview = (await ask(handler, { kind: "previewSchemaChange", appId, change: stale })).preview!;
      await change({ kind: "rename-app", name: "Fieldwork (moved on)" });
      const rows = await countEnvelopeRows();
      const outcome = (await ask(handler, { kind: "applySchemaChange", appId, change: stale, previewedSchemaRevision: preview.schemaRevision }))
        .outcome;
      expect(outcome).toEqual({ result: "stale-preview", schemaRevision: preview.schemaRevision + 1 });
      expect(await countEnvelopeRows()).toBe(rows);
      expect(tableNamed(await structure(), "Jobs").displayName).toBe("Jobs");
    },
    SLOW,
  );

  it(
    "refuses a change past the segment cap, saying so at preview, with no commit (D38)",
    async () => {
      await handler.handle({ kind: "lock" });
      handler.dispose();
      handler = createTestHandler(undefined, { maxEvents: 5, maxBytes: 16 * 1024 * 1024 }).handler;
      await open(handler);
      const customers = tableNamed(await structure(), "Customers");
      const wide: SchemaChangeWireV1 = { kind: "change-field-type", fieldId: fieldNamed(customers, "Name").fieldId, type: { kind: "number" } };
      const preview = (await ask(handler, { kind: "previewSchemaChange", appId, change: wide })).preview!;
      expect(preview.isTooLarge).toBe(true);
      expect(preview.eventCount).toBe(13);
      const rows = await countEnvelopeRows();
      const outcome = (await ask(handler, { kind: "applySchemaChange", appId, change: wide, previewedSchemaRevision: preview.schemaRevision }))
        .outcome;
      expect(outcome).toMatchObject({ result: "too-large", eventCount: 13, maxEvents: 5 });
      expect(await countEnvelopeRows()).toBe(rows);
      expect(fieldNamed(tableNamed(await structure(), "Customers"), "Name").type).toEqual({ kind: "text" });
    },
    SLOW,
  );
});

describe("records beside computed columns (D51, CA-26, invariant 5)", () => {
  it("counts create, edit, delete and restore once each and persists each trigger before shutdown (CA-37)", async () => {
    const jobs = tableNamed(await structure(), "Jobs");
    const fieldId = fieldNamed(jobs, "Job ID").fieldId;
    let count = (await ask(handler, { kind: "openApp", appId })).session!.deviceOnlyChangeCount;
    const created = await ask(handler, { kind: "createRecord", appId, tableId: jobs.tableId,
      values: [{ fieldId, value: { kind: "text", text: "J-998" } }] });
    if (created.outcome !== "accepted") throw new Error("create refused");
    const recordId = created.receipt.recordId;
    const accepted = async () => {
      count += 1;
      const history = (await ask(handler, { kind: "getChangeHistory", appId, limit: 1 })).page!.entries;
      handler.dispose();
      expect((await readStoredCatalog(PASSPHRASE)).apps[0]?.scratchReminder?.triggeringCommitId).toBe(history[0]?.commitId);
      handler = createTestHandler().handler;
      await open(handler);
      expect((await ask(handler, { kind: "openApp", appId })).session!.deviceOnlyChangeCount).toBe(count);
    };
    await accepted();
    expect((await ask(handler, { kind: "patchRecord", appId, recordId,
      changes: [{ fieldId, value: { kind: "text", text: "J-997" } }] })).outcome).toBe("accepted");
    await accepted();
    const reminder = (await readStoredCatalog(PASSPHRASE)).apps[0]?.scratchReminder;
    await ask(handler, { kind: "patchRecord", appId, recordId, changes: [{ fieldId, value: { kind: "text", text: "J-997" } }] });
    expect((await readStoredCatalog(PASSPHRASE)).apps[0]?.scratchReminder).toEqual(reminder);
    expect((await ask(handler, { kind: "openApp", appId })).session!.deviceOnlyChangeCount).toBe(count);
    expect((await ask(handler, { kind: "deleteRecord", appId, recordId })).outcome).toBe("accepted");
    await accepted();
    expect((await ask(handler, { kind: "restoreRecord", appId, recordId })).outcome).toBe("accepted");
    await accepted();
    await ask(handler, { kind: "deleteRecord", appId, recordId });
  }, SLOW);

  const commandOf = (response: DataWorkerResponseV1) => {
    if (response.kind !== "patchRecord" && response.kind !== "createRecord") throw new Error(response.kind);
    return response;
  };

  it(
    "refuses a write naming a computed field, and commits nothing",
    async () => {
      const jobs = tableNamed(await structure(), "Jobs");
      const balance = fieldNamed(jobs, "Balance (live)");
      const job = (await records(jobs.tableId))[0]!;
      const rows = await countEnvelopeRows();
      const refused = commandOf(
        await handler.handle({
          kind: "patchRecord",
          appId,
          recordId: job.recordId,
          changes: [{ fieldId: balance.fieldId, value: { kind: "number", decimal: "1" } }],
        }),
      );
      expect(refused).toMatchObject({ outcome: "rejected" });
      expect(refused.outcome === "rejected" && refused.report.issues.map((issue) => issue.messageKey)).toContain("computed-not-authored");
      expect(await countEnvelopeRows()).toBe(rows);
    },
    SLOW,
  );

  it(
    "recalculates what a patch reaches and names only those columns",
    async () => {
      const jobs = tableNamed(await structure(), "Jobs");
      const balance = fieldNamed(jobs, "Balance (live)");
      const paid = fieldNamed(jobs, "Paid");
      // Something is paid on it, so setting Paid to zero is a real change
      // (record order follows random record IDs, so the choice is by value).
      const job = (await records(jobs.tableId)).find(
        (record) =>
          record.values.some((entry) => entry.fieldId === balance.fieldId && entry.computed?.state === "ok") &&
          record.values.some((entry) => entry.fieldId === paid.fieldId && entry.value.kind === "number" && Number(entry.value.decimal) > 0),
      )!;
      const accepted = commandOf(
        await handler.handle({
          kind: "patchRecord",
          appId,
          recordId: job.recordId,
          changes: [{ fieldId: paid.fieldId, value: { kind: "number", decimal: "0" } }],
        }),
      );
      if (accepted.outcome !== "accepted") throw new Error("the patch was not accepted");
      expect(accepted.recalculated?.fieldIds).toEqual([balance.fieldId]);
      const detail = (await ask(handler, { kind: "getRecord", appId, recordId: job.recordId })).record;
      const quoted = detail?.values.find((entry) => entry.fieldId === fieldNamed(jobs, "Quoted amount").fieldId)?.value;
      expect(detail?.values.find((entry) => entry.fieldId === balance.fieldId)).toEqual({
        fieldId: balance.fieldId,
        value: quoted,
        computed: { state: "ok" },
      });
    },
    SLOW,
  );

  it(
    "evaluates a frozen column once for a new record and stores it as its literal",
    async () => {
      const jobs = tableNamed(await structure(), "Jobs");
      const lottery = fieldNamed(jobs, "Lottery");
      const created = commandOf(
        await handler.handle({
          kind: "createRecord",
          appId,
          tableId: jobs.tableId,
          values: [{ fieldId: fieldNamed(jobs, "Job ID").fieldId, value: { kind: "text", text: "J-999" } }],
        }),
      );
      if (created.outcome !== "accepted") throw new Error(`the create was refused: ${JSON.stringify(created)}`);
      const detail = (await ask(handler, { kind: "getRecord", appId, recordId: created.receipt.recordId })).record;
      const cell = detail?.values.find((entry) => entry.fieldId === lottery.fieldId);
      expect(cell?.computed).toEqual({ state: "frozen" });
      expect(cell?.value.kind).toBe("number");
      // The live column covers the new row too: two empty operands are zero
      // to M03's arithmetic, as they are to a spreadsheet's.
      expect(detail?.values.find((entry) => entry.fieldId === fieldNamed(jobs, "Balance (live)").fieldId)).toMatchObject({
        value: { kind: "number", decimal: "0" },
        computed: { state: "ok" },
      });
    },
    SLOW,
  );
});

describe("text becomes a choice list with the choices a person names (FR-15, D57, CA-28)", () => {
  it(
    "refuses it with no choices, then converts by exact label and keeps the rest flagged, in one commit that a fresh worker reads back",
    async () => {
      await handler.handle({ kind: "lock" });
      handler.dispose();
      handler = createTestHandler().handler;
      await open(handler);
      const customers = tableNamed(await structure(), "Customers");
      const name = fieldNamed(customers, "Name");
      const unnamed = (
        await ask(handler, { kind: "previewSchemaChange", appId, change: { kind: "change-field-type", fieldId: name.fieldId, type: { kind: "enum" } } })
      ).preview;
      expect(unnamed?.refusal).toMatchObject({ kind: "transition", refusals: [{ messageKey: "schema.enum-field-without-options" }] });

      const texts = (await records(customers.tableId)).map((record) => {
        const value = record.values.find((entry) => entry.fieldId === name.fieldId)?.value;
        return value?.kind === "text" ? value.text : null;
      });
      const chosen = texts.find((text) => text !== null)!;
      const converted = texts.filter((text) => text !== null && text.trim() === chosen.trim()).length;
      const kept = texts.filter((text) => text !== null && text.length > 0).length - converted;
      expect(kept).toBeGreaterThan(0);

      const applied = await change({
        kind: "change-field-type",
        fieldId: name.fieldId,
        type: { kind: "enum" },
        optionLabels: [chosen, "Nobody by this name"],
      });
      expect(applied.impact).toMatchObject({ converted, keptAndFlagged: kept, affected: converted + kept, unchanged: texts.length - converted - kept });
      // field.changed + enum.changed + one record.patched per rewritten value.
      expect(applied.eventCount).toBe(2 + converted + kept);
      const history = (await ask(handler, { kind: "getChangeHistory", appId, limit: 200 })).page!.entries;
      const commit = history.filter((entry) => entry.commitId === history[0]!.commitId).map((entry) => entry.eventKind);
      expect(commit.filter((kind) => kind === "field.changed")).toHaveLength(1);
      expect(commit.filter((kind) => kind === "enum.changed")).toHaveLength(1);
      expect(commit.filter((kind) => kind === "record.patched")).toHaveLength(converted + kept);

      await handler.handle({ kind: "lock" });
      handler.dispose();
      handler = createTestHandler().handler;
      await open(handler);
      const reopened = fieldNamed(tableNamed(await structure(), "Customers"), "Name");
      expect(reopened.type).toEqual({ kind: "enum" });
      expect(reopened.enumOptions.map((option) => `${option.label}:${option.isActive}`)).toEqual([`${chosen}:true`, "Nobody by this name:true"]);
      const values = (await records(customers.tableId)).map((record) => record.values.find((entry) => entry.fieldId === name.fieldId)?.value);
      expect(values.filter((value) => value?.kind === "option" && value.optionId === reopened.enumOptions[0]!.optionId)).toHaveLength(converted);
      expect(values.filter((value) => value?.kind === "invalid")).toHaveLength(kept);
    },
    SLOW,
  );
});
