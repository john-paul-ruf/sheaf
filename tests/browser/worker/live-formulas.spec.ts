/**
 * The first narrow journey of F04 (S03 CP4; CAP-28, CAP-29, CAP-30; CA-25,
 * CA-26, CA-27, CA-28; invariants 1, 3, 5, 7).
 *
 * Every boundary is real: the harness page drives the real `DataWorkerClient`
 * and so the real `data.worker` over `postMessage`, which writes real
 * IndexedDB through real libsodium and recalculates in real SQLite WASM. The
 * app is the F03 demo, imported through the real import worker (the seed
 * `workbook-journey.spec.ts` proved). The only test-shaped thing is where the
 * file comes from.
 *
 * The journey: a live computed column is saved through preview → apply; a
 * patch recalculates it (and says which column moved); a table metric and a
 * `TODAY()` column follow; lock, a new worker, unlock — every computed value
 * and metric is identical. Every event the app now holds is decrypted from
 * raw IndexedDB and read: none carries a computed value (invariant 7). And
 * two refusals commit nothing: a write naming the computed field, and an
 * apply against a stale preview.
 */

import { expect, test, type Page } from "@playwright/test";
import type {
  AppStructureViewV1,
  DataWorkerRequestV1,
  DataWorkerResponseV1,
  SchemaChangeWireV1,
} from "../../../src/workers/protocol/messages.js";
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
  const edited = await ask(page, { kind: "applyReviewEdit", stageId, edit: { kind: "reject-relationship", relationshipKey: "rel:s3.t0.c1" } });
  expect(edited.outcome).toBe("applied");
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

/** Preview, then apply at the previewed revision; the impacts must agree. */
async function applyChange(page: Page, appId: string, change: SchemaChangeWireV1) {
  const preview = (await ask(page, { kind: "previewSchemaChange", appId, change })).preview;
  if (preview === null || preview.refusal !== null) throw new Error(`preview refused: ${JSON.stringify(preview)}`);
  const outcome = (await ask(page, { kind: "applySchemaChange", appId, change, previewedSchemaRevision: preview.schemaRevision })).outcome;
  if (outcome.result !== "applied") throw new Error(`apply refused: ${JSON.stringify(outcome)}`);
  expect(outcome.impact).toEqual(preview.impact);
  return { preview, outcome };
}

/** Every job's computed cells and every metric, keyed readably. */
async function computedReads(page: Page, appId: string, jobsTableId: string, fieldIds: readonly string[]) {
  const records = [];
  let cursor: number | null = null;
  for (;;) {
    const answered: DataWorkerResponseV1 = await ask(page, { kind: "queryRecords", appId, tableId: jobsTableId, cursor, limit: 100 });
    if (answered.kind !== "queryRecords" || answered.page === null) throw new Error("no page");
    records.push(...answered.page.records);
    if (!answered.page.hasMore) break;
    cursor = answered.page.nextCursor;
  }
  const cells = records.map((record) =>
    fieldIds.map((fieldId) => {
      const entry = record.values.find((candidate) => candidate.fieldId === fieldId);
      return `${record.recordId}|${JSON.stringify(entry?.value)}|${JSON.stringify(entry?.computed)}`;
    }),
  );
  const metrics = (await ask(page, { kind: "getAppMetrics", appId })).metrics;
  return {
    cells,
    metrics: metrics?.tables.flatMap((table) => table.metrics.map((metric) => `${metric.displayName}|${metric.status}|${JSON.stringify(metric.value)}`)),
  };
}

interface DecodedEventsV1 {
  readonly count: number;
  readonly kinds: readonly string[];
  /** Every field id a record event carries a value for. */
  readonly valuedFieldIds: readonly string[];
  /** Every decoded payload, flattened to text (maps, ids and integers spelled out). */
  readonly texts: readonly string[];
  readonly formulaPayloadKeys: readonly (readonly string[])[];
}

/**
 * Decrypts every event segment the app's head names, straight from IndexedDB
 * with the passphrase — the bytes, not anything the worker reports.
 */
async function readAppEvents(page: Page, passphrase: string): Promise<DecodedEventsV1> {
  return page.evaluate(async (secret): Promise<DecodedEventsV1> => {
    const harness = window.__sheafHarness;
    const [bytes, envelope, keys, kdf, store, catalog, roots, bootstrap, frames, commits] = await Promise.all([
      harness.module<typeof import("../../../src/domain/model/bytes.js")>("/src/domain/model/bytes.ts"),
      harness.module<typeof import("../../../src/crypto/envelope.js")>("/src/crypto/envelope.ts"),
      harness.module<typeof import("../../../src/crypto/keys.js")>("/src/crypto/keys.ts"),
      harness.module<typeof import("../../../src/crypto/kdf.js")>("/src/crypto/kdf.ts"),
      harness.module<typeof import("../../../src/persistence/envelope-store/read.js")>("/src/persistence/envelope-store/read.ts"),
      harness.module<typeof import("../../../src/workers/data/catalog.js")>("/src/workers/data/catalog.ts"),
      harness.module<typeof import("../../../src/import/staging/roots.js")>("/src/import/staging/roots.ts"),
      harness.module<typeof import("../../../src/persistence/envelope-store/bootstrap.js")>("/src/persistence/envelope-store/bootstrap.ts"),
      harness.module<typeof import("../../../src/persistence/codecs/envelope-frame.js")>("/src/persistence/codecs/envelope-frame.ts"),
      harness.module<typeof import("../../../src/persistence/codecs/event-commit.js")>("/src/persistence/codecs/event-commit.ts"),
    ]);
    const row = await bootstrap.readBootstrap();
    if (row === undefined) throw new Error("no bootstrap row");
    const wrapping = await kdf.deriveWrappingKeyFromPassphrase(secret, row.passphraseKdf);
    const root = await keys.unwrapRoot(row.passphraseWrappedRoot, wrapping);
    const catalogFrame = await store.getEnvelope(bytes.decodeStorageId16(row.catalogStorageId));
    const decodedCatalog = catalog.decodeLocalCatalog(
      (await envelope.decryptEnvelope(catalogFrame as NonNullable<typeof catalogFrame>, "local.catalog", root, "local.catalog")).payload,
    );
    const entry = decodedCatalog.apps[0];
    if (entry === undefined || entry.wrappedAppKey === null) throw new Error("no app");
    const appKey = keys.createSecretKey(
      (await envelope.decryptEnvelope(frames.parseEnvelopeTransport(entry.wrappedAppKey), "local.catalog", root, "local.catalog")).payload,
      "envelope",
    );
    const open = async (storageId: string, scope: string, kind: string) => {
      const frame = await store.getEnvelope(bytes.decodeStorageId16(storageId));
      if (frame === undefined) throw new Error("missing root");
      return (
        await envelope.decryptEnvelope(
          frame,
          scope as Parameters<typeof envelope.decryptEnvelope>[1],
          appKey,
          kind as Parameters<typeof envelope.decryptEnvelope>[3],
        )
      ).payload;
    };
    const head = roots.decodeAppHead(await open(entry.appHeadStorageId as string, "app.head", "app.head"));

    const hex = (value: Uint8Array): string => [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const spell = (value: unknown): string => {
      if (value instanceof Map) return `{${[...value].map(([name, inner]) => `${String(name)}:${spell(inner)}`).join(",")}}`;
      if (Array.isArray(value)) return `[${value.map(spell).join(",")}]`;
      if (value instanceof Uint8Array) return `#${hex(value)}`;
      return String(value);
    };
    const kinds: string[] = [];
    const texts: string[] = [];
    const valued = new Set<string>();
    const formulaPayloadKeys: string[][] = [];
    const collect = (value: unknown): void => {
      // A record event names a field beside each value it carries.
      if (value instanceof Map) {
        const fieldId: unknown = value.get("fieldId");
        if (fieldId instanceof Uint8Array && (value.has("value") || value.has("after"))) valued.add(bytes.encodeBase64Url(fieldId));
        for (const inner of value.values()) collect(inner);
      } else if (Array.isArray(value)) {
        for (const inner of value) collect(inner);
      }
    };
    let count = 0;
    for (const ref of head.eventSegments) {
      const segment = commits.decodeEventSegment(await open(ref.storageId, "app.events", "app.event-segment"));
      for (const commit of segment.commits) {
        for (const event of commit.events) {
          count += 1;
          kinds.push(event.kind);
          texts.push(spell(event.payload));
          if (event.kind.startsWith("record.")) collect(event.payload);
          if (event.kind === "formula.changed") {
            const formula = (event.payload as ReadonlyMap<string, unknown>).get("formula") as ReadonlyMap<string, unknown>;
            formulaPayloadKeys.push([...formula.keys()].map(String).sort());
          }
        }
      }
    }
    keys.destroySecretKey(appKey);
    keys.destroySecretKey(root);
    keys.destroySecretKey(wrapping);
    return { count, kinds, valuedFieldIds: [...valued], texts, formulaPayloadKeys };
  }, passphrase);
}

test("the first narrow journey: live formula → patch recalculates → metric → TODAY() → new worker → identical; refusals commit nothing (CAP-28/29/30)", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const buildId = await page.evaluate(() => window.__sheafHarness.buildId);
  test.info().annotations.push({ type: "build-id", description: String(buildId) });

  // 1–2. Setup, unlock, and the F03 demo app through the real import worker.
  const appId = await promotedDemo(page);
  const before = await structure(page, appId);
  const jobs = idOf(before, "Jobs");
  const quoted = idOf(before, "Jobs", "Quoted amount");
  const paid = idOf(before, "Jobs", "Paid");

  // 3. A live computed column, previewed then applied (CA-28, D58).
  const saved = await applyChange(page, appId, {
    kind: "save-formula",
    formulaId: null,
    target: { kind: "computed-column", tableId: jobs, fieldId: null, newField: { displayName: "Balance (live)", type: { kind: "currency", currencyCode: "USD" } } },
    displayName: null,
    text: "[Quoted amount]-[Paid]",
  });
  // The demo's two `TBD` quotes cannot be subtracted from, and preview said so.
  expect(saved.preview.impact.formulaErrors).toBe(2);
  const withBalance = await structure(page, appId);
  const balance = idOf(withBalance, "Jobs", "Balance (live)");
  expect(saved.outcome.recalculated.fieldIds).toContain(balance);
  expect(withBalance.formulas.find((formula) => formula.target.kind === "computed-column")).toMatchObject({
    text: "[Quoted amount]-[Paid]",
    disposition: "live",
  });

  // 4. Patch Quoted on one job: the balance recalculates, and says so.
  const page0 = (await ask(page, { kind: "queryRecords", appId, tableId: jobs, limit: 100 })).page!;
  // A job with something paid, so its recalculated balance is a value no
  // author wrote (the check at the end relies on it).
  const job = page0.records.find(
    (record) =>
      record.values.some((entry) => entry.fieldId === balance && entry.computed?.state === "ok") &&
      record.values.some((entry) => entry.fieldId === paid && entry.value.kind === "number" && Number(entry.value.decimal) > 0),
  )!;
  const paidValue = job.values.find((entry) => entry.fieldId === paid)?.value;
  if (paidValue?.kind !== "number") throw new Error("expected a paid amount");
  const patched = await ask(page, { kind: "patchRecord", appId, recordId: job.recordId, changes: [{ fieldId: quoted, value: { kind: "number", decimal: "9000.25" } }] });
  if (patched.outcome !== "accepted") throw new Error("the patch was refused");
  expect(patched.recalculated?.fieldIds).toContain(balance);
  const expected = (9000.25 - Number(paidValue.decimal)).toFixed(2);
  const detail = (await ask(page, { kind: "getRecord", appId, recordId: job.recordId })).record!;
  const cell = detail.values.find((entry) => entry.fieldId === balance);
  expect(cell?.computed).toEqual({ state: "ok" });
  expect(cell?.value.kind === "number" && Number(cell.value.decimal).toFixed(2)).toBe(expected);
  const listed = (await ask(page, { kind: "queryRecords", appId, tableId: jobs, limit: 100 })).page!.records.find(
    (record) => record.recordId === job.recordId,
  );
  expect(listed?.values.find((entry) => entry.fieldId === balance)).toEqual(cell);

  // 5. A table metric, and it moves with the next patch (CAP-29).
  await applyChange(page, appId, {
    kind: "save-formula",
    formulaId: null,
    target: { kind: "table-metric", tableId: jobs },
    displayName: "Quoted total",
    text: "SUM(Jobs[Quoted amount])",
  });
  const metricOf = async () => {
    const metric = (await ask(page, { kind: "getAppMetrics", appId })).metrics?.tables.find((table) => table.tableId === jobs)?.metrics[0];
    if (metric?.status !== "ok" || metric.value?.kind !== "number") throw new Error(`metric not ok: ${JSON.stringify(metric)}`);
    return Number(metric.value.decimal);
  };
  const totalBefore = await metricOf();
  await ask(page, { kind: "patchRecord", appId, recordId: job.recordId, changes: [{ fieldId: quoted, value: { kind: "number", decimal: "9100.25" } }] });
  expect((await metricOf()) - totalBefore).toBeCloseTo(100, 6);

  // 6. A TODAY() column (CAP-30): live, clock-volatile, never stored.
  await applyChange(page, appId, {
    kind: "save-formula",
    formulaId: null,
    target: { kind: "computed-column", tableId: jobs, fieldId: null, newField: { displayName: "Days since due", type: { kind: "number" } } },
    displayName: null,
    text: "TODAY()-[Due date]",
  });
  const withToday = await structure(page, appId);
  const daysSinceDue = idOf(withToday, "Jobs", "Days since due");
  expect(withToday.formulas.find((formula) => formula.text === "TODAY()-[Due date]")).toMatchObject({ determinism: "clock-volatile" });
  const todayCells = (await ask(page, { kind: "getRecord", appId, recordId: job.recordId })).record!.values.find(
    (entry) => entry.fieldId === daysSinceDue,
  );
  expect(todayCells?.computed).toEqual({ state: "ok" });

  const computedFields = [balance, daysSinceDue];
  const beforeRestart = await computedReads(page, appId, jobs, computedFields);

  // 8a. A write naming the computed field is refused, and nothing commits.
  const eventsBeforeRefusals = await readAppEvents(page, PASSPHRASE);
  const refused = await ask(page, { kind: "patchRecord", appId, recordId: job.recordId, changes: [{ fieldId: balance, value: { kind: "number", decimal: "1" } }] });
  expect(refused.outcome).toBe("rejected");
  expect(refused.outcome === "rejected" && refused.report.issues.map((issue) => issue.messageKey)).toContain("computed-not-authored");
  // 8b. An apply against a stale preview is refused, and nothing commits.
  const stale: SchemaChangeWireV1 = { kind: "rename-table", tableId: jobs, name: "Work orders" };
  const stalePreview = (await ask(page, { kind: "previewSchemaChange", appId, change: stale })).preview!;
  const staleOutcome = (
    await ask(page, { kind: "applySchemaChange", appId, change: stale, previewedSchemaRevision: stalePreview.schemaRevision - 1 })
  ).outcome;
  expect(staleOutcome).toEqual({ result: "stale-preview", schemaRevision: stalePreview.schemaRevision });
  expect((await readAppEvents(page, PASSPHRASE)).count).toBe(eventsBeforeRefusals.count);

  // 7. Lock, a new worker, unlock, reopen: every computed value and metric identical.
  expect((await command(page, { kind: "lock" })).ok).toBe(true);
  await page.evaluate(() => {
    window.__sheafApp?.dispose();
  });
  await page.goto("/harness.html");
  await start(page);
  expect((await command(page, { kind: "unlock", passphrase: PASSPHRASE })).ok).toBe(true);
  const afterRestart = await computedReads(page, appId, jobs, computedFields);
  // TODAY() is equal within the same day; the run is far shorter than one.
  expect(afterRestart).toEqual(beforeRestart);
  expect((await structure(page, appId)).formulas.map((formula) => formula.text).sort()).toEqual(
    ["SUM(Jobs[Quoted amount])", "TODAY()-[Due date]", "[Quoted amount]-[Paid]"].sort(),
  );

  // Invariant 7, read off the decrypted bytes: no event carries a value for a
  // live computed column, a formula event holds a definition and nothing
  // else, and there is no recalculation event at all.
  const events = await readAppEvents(page, PASSPHRASE);
  expect(events.count).toBe(eventsBeforeRefusals.count);
  expect(events.kinds.filter((kind) => kind === "formula.changed")).toHaveLength(3);
  expect(events.kinds.some((kind) => kind.includes("recalc"))).toBe(false);
  expect(events.valuedFieldIds).not.toContain(balance);
  expect(events.valuedFieldIds).not.toContain(daysSinceDue);
  for (const keys of events.formulaPayloadKeys) {
    expect(keys).toEqual(["dependencies", "determinism", "displayName", "disposition", "document", "formulaId", "originalText", "target"]);
  }
  // The recalculated balance of the patched job is in no payload (its authored
  // inputs are: the quote the user wrote is).
  const recalculated = (Number(9100.25) - Number(paidValue.decimal)).toFixed(2);
  expect(events.texts.some((text) => text.includes("9100.25"))).toBe(true);
  expect(events.texts.some((text) => text.includes(recalculated))).toBe(false);
});
