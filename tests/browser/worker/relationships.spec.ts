/**
 * CAP-24 at the worker tier, and CA-21's read contract (S03 CP3): a durable
 * multi-table app, opened by the real data worker from the real store,
 * navigated both ways, edited with references, a parent deleted, and all of
 * it read again after a restart (a new page, a new worker, a new unlock).
 *
 * The app is sealed by `workbook-app-fixture.ts` through the production crypto
 * and store — S06's promotion will write the same roots; until then this is
 * the one way to give the worker a relationship to read. Everything the worker
 * does here is production code: hydration, the resolver, the validator, the
 * commits, the projection queries.
 */

import { expect, test, type Page } from "@playwright/test";

import { PASSPHRASE, command, start, teardown } from "./runtime.js";
import { seedWorkbookApp, type SeededWorkbookAppV1 } from "./workbook-app-fixture.js";
import type {
  DataWorkerRequestV1,
  DataWorkerResponseV1,
} from "../../../src/workers/protocol/messages.js";

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

/** Stops the page runtime, so its worker holds no session or catalog. */
async function stop(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__sheafApp?.dispose();
  });
}

async function seeded(page: Page): Promise<SeededWorkbookAppV1> {
  await start(page);
  expect((await command(page, { kind: "setup", passphrase: PASSPHRASE })).ok).toBe(true);
  await stop(page);
  const app = await seedWorkbookApp(page, PASSPHRASE);
  await start(page);
  expect((await command(page, { kind: "unlock", passphrase: PASSPHRASE })).ok).toBe(true);
  return app;
}

/** The reads that must be identical before and after a restart. */
async function reads(page: Page, app: SeededWorkbookAppV1) {
  const { appId, records } = app;
  return {
    tables: (await ask(page, { kind: "listTables", appId })).tables?.map(
      (table) => `${table.displayName}:${table.recordCount}`,
    ),
    bolts: (await ask(page, { kind: "getRecord", appId, recordId: records.bolts })).record
      ?.references,
    washers: (await ask(page, { kind: "getRecord", appId, recordId: records.washers }))
      .record?.references,
    globex: (await ask(page, { kind: "getRelatedRecords", appId, recordId: records.globex }))
      .related,
    acmeDeleted: (await ask(page, { kind: "getDeletedRecord", appId, recordId: records.acme }))
      .deleted,
  };
}

test("navigate, author references, delete a parent, restart — every read holds", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const app = await seeded(page);
  const { appId, records } = app;

  // --- open ------------------------------------------------------------------
  const opened = await ask(page, { kind: "openApp", appId });
  expect(opened.session?.tables.map((table) => `${table.displayName}:${table.recordCount}`)).toEqual(
    ["Suppliers:2", "Orders:4"],
  );

  // --- the parent's label, and a broken import with its original key ---------
  const bolts = await ask(page, { kind: "getRecord", appId, recordId: records.bolts });
  expect(bolts.record?.references).toEqual([
    {
      fieldId: app.supplierFieldId,
      relationshipId: app.relationshipId,
      status: "resolved",
      recordId: records.acme,
      tableId: app.suppliersTableId,
      label: "Acme",
    },
  ]);
  const washers = await ask(page, { kind: "getRecord", appId, recordId: records.washers });
  expect(washers.record?.references).toEqual([
    {
      fieldId: app.supplierFieldId,
      relationshipId: app.relationshipId,
      status: "broken",
      originalKey: "SUP-404",
    },
  ]);
  expect(washers.record?.issues.map((issue) => `${issue.kind}/${issue.severity}`)).toEqual([
    "broken-reference/warning",
  ]);
  // CA-12: the key never rides an issue parameter.
  expect(JSON.stringify(washers.record?.issues)).not.toContain("SUP-404");

  // --- children, both directions, paged --------------------------------------
  const acme = await ask(page, { kind: "getRelatedRecords", appId, recordId: records.acme });
  expect(acme.related?.parents).toEqual([]);
  expect(acme.related?.children).toEqual([
    {
      relationshipId: app.relationshipId,
      tableId: app.ordersTableId,
      tableName: "Orders",
      count: 2,
      first: expect.arrayContaining([
        { recordId: records.bolts, label: "Bolts" },
        { recordId: records.nuts, label: "Nuts" },
      ]) as unknown,
    },
  ]);
  expect(acme.related?.children[0]?.first).toHaveLength(2);
  const firstPage = await ask(page, {
    kind: "getRelatedChildren",
    appId,
    relationshipId: app.relationshipId,
    parentRecordId: records.acme,
    limit: 1,
  });
  expect(firstPage.page?.children).toHaveLength(1);
  expect(firstPage.page?.hasMore).toBe(true);
  const secondPage = await ask(page, {
    kind: "getRelatedChildren",
    appId,
    relationshipId: app.relationshipId,
    parentRecordId: records.acme,
    after: firstPage.page?.nextCursor ?? null,
    limit: 1,
  });
  expect(secondPage.page?.hasMore).toBe(false);
  expect(
    [...(firstPage.page?.children ?? []), ...(secondPage.page?.children ?? [])]
      .map((child) => child.label)
      .sort(),
  ).toEqual(["Bolts", "Nuts"]);

  // --- the reference picker ----------------------------------------------------
  const globexOnly = await ask(page, {
    kind: "searchReferenceCandidates",
    appId,
    fieldId: app.supplierFieldId,
    text: "glob",
  });
  expect(globexOnly.candidates).toEqual([{ recordId: records.globex, label: "Globex" }]);
  const everyone = await ask(page, {
    kind: "searchReferenceCandidates",
    appId,
    fieldId: app.supplierFieldId,
    text: "",
  });
  expect(everyone.candidates?.map((candidate) => candidate.label).sort()).toEqual([
    "Acme",
    "Globex",
  ]);
  // A field that points nowhere offers no candidates rather than every record.
  expect(
    (
      await ask(page, {
        kind: "searchReferenceCandidates",
        appId,
        fieldId: app.orderNameFieldId,
        text: "",
      })
    ).candidates,
  ).toBeNull();

  // --- author a reference; refuse one to a record that is not there ------------
  const created = await ask(page, {
    kind: "createRecord",
    appId,
    tableId: app.ordersTableId,
    values: [
      { fieldId: app.orderNameFieldId, value: { kind: "text", text: "Rivets" } },
      { fieldId: app.supplierFieldId, value: { kind: "reference", recordId: records.globex } },
    ],
  });
  expect(created.outcome).toBe("accepted");

  const refused = await ask(page, {
    kind: "createRecord",
    appId,
    tableId: app.ordersTableId,
    values: [
      { fieldId: app.orderNameFieldId, value: { kind: "text", text: "Ghost" } },
      // A well-formed id no supplier carries.
      { fieldId: app.supplierFieldId, value: { kind: "reference", recordId: records.bolts } },
    ],
  });
  expect(refused.outcome).toBe("rejected");
  if (refused.outcome === "rejected") {
    expect(refused.report.issues.map((issue) => `${issue.kind}/${issue.severity}`)).toEqual([
      "broken-reference/blocking",
    ]);
  }
  // The refusal wrote nothing.
  expect(
    (await ask(page, { kind: "listTables", appId })).tables?.map((table) => table.recordCount),
  ).toEqual([2, 5]);

  const globex = await ask(page, { kind: "getRelatedRecords", appId, recordId: records.globex });
  expect(globex.related?.children[0]?.count).toBe(2);
  expect(globex.related?.children[0]?.first.map((child) => child.label).sort()).toEqual([
    "Gears",
    "Rivets",
  ]);

  // --- delete the parent: the children keep their reference, shown broken -----
  const deleted = await ask(page, { kind: "deleteRecord", appId, recordId: records.acme });
  expect(deleted.outcome).toBe("accepted");

  const orphaned = await ask(page, { kind: "getRecord", appId, recordId: records.bolts });
  expect(orphaned.record?.values).toContainEqual({
    fieldId: app.supplierFieldId,
    value: { kind: "reference", recordId: records.acme },
  });
  expect(orphaned.record?.references).toEqual([
    {
      fieldId: app.supplierFieldId,
      relationshipId: app.relationshipId,
      status: "broken",
      originalKey: "SUP-1",
    },
  ]);

  // --- MOD-010: the deleted record's original values ---------------------------
  const original = await ask(page, { kind: "getDeletedRecord", appId, recordId: records.acme });
  expect(original.deleted?.tableId).toBe(app.suppliersTableId);
  expect(original.deleted?.keyValue).toEqual({ kind: "text", text: "SUP-1" });
  expect(original.deleted?.values).toEqual(
    expect.arrayContaining([
      { fieldId: app.codeFieldId, value: { kind: "text", text: "SUP-1" } },
      { fieldId: app.supplierNameFieldId, value: { kind: "text", text: "Acme" } },
    ]),
  );
  expect(
    (await ask(page, { kind: "getDeletedRecord", appId, recordId: records.bolts })).deleted,
  ).toBeNull();

  // --- change history says which table each change happened in ------------------
  const history = await ask(page, { kind: "getChangeHistory", appId });
  expect(
    history.page?.entries.map((entry) => `${entry.eventKind}:${entry.tableId ?? "none"}`),
  ).toEqual([
    `record.deleted:${app.suppliersTableId}`,
    `record.created:${app.ordersTableId}`,
  ]);

  // --- restart: a new page, a new worker, a new unlock ---------------------------
  const before = await reads(page, app);
  await stop(page);
  await page.goto("/harness.html");
  await start(page);
  expect((await command(page, { kind: "unlock", passphrase: PASSPHRASE })).ok).toBe(true);
  const after = await reads(page, app);

  expect(after).toEqual(before);
  expect(after.bolts).toEqual(orphaned.record?.references);
  expect(after.tables).toEqual(["Suppliers:1", "Orders:5"]);
});

test("CA-22: snapshots page across chunks, find crosses chunks, inert items list by sheet", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const app = await seeded(page);
  const { appId, sheets, inert } = app;

  const listed = await ask(page, { kind: "listSheetSnapshots", appId });
  expect(
    listed.sheets?.map((sheet) => ({
      name: sheet.displayName,
      classification: sheet.classification,
      inert: sheet.inertCounts,
    })),
  ).toEqual([
    { name: "Suppliers", classification: ["table", "lookup"], inert: [{ kind: "comment", count: 1 }] },
    { name: "Orders", classification: ["table"], inert: [{ kind: "formula", count: 1 }] },
    { name: "Overview", classification: ["summary", "chart"], inert: [{ kind: "chart", count: 1 }] },
  ]);

  // Rows 2–4 straddle the boundary between the Suppliers sheet's two chunks.
  const across = await ask(page, {
    kind: "getSnapshotPage",
    appId,
    sheetId: sheets.suppliers,
    firstRow: 2,
    rowCount: 4,
  });
  expect(across.page?.format).toBe("sheet-v2");
  expect(across.page?.rows).toEqual([
    {
      rowIndex: 2,
      cells: [
        { columnIndex: 0, text: "SUP-1", kind: "text" },
        { columnIndex: 1, text: "Acme", kind: "text" },
      ],
    },
    {
      rowIndex: 3,
      cells: [
        { columnIndex: 0, text: "SUP-2", kind: "text" },
        { columnIndex: 1, text: "Globex", kind: "text" },
      ],
    },
    { rowIndex: 5, cells: [{ columnIndex: 1, text: "Two suppliers", kind: "text" }] },
  ]);
  expect(across.page?.inertAnchors).toEqual([
    {
      inertItemId: inert.comment,
      range: { firstRow: 2, firstColumn: 1, lastRow: 2, lastColumn: 1 },
    },
  ]);

  // The top of the sheet: the discarded title row, marked, and its merge.
  const top = await ask(page, {
    kind: "getSnapshotPage",
    appId,
    sheetId: sheets.suppliers,
    firstRow: 0,
    rowCount: 2,
  });
  expect(top.page?.discardedRows).toEqual([{ rowIndex: 0, reason: "above-header" }]);
  expect(top.page?.merges).toEqual([{ firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 1 }]);

  const find = (text: string, afterRow: number | null) =>
    ask(page, { kind: "findInSnapshot", appId, sheetId: sheets.suppliers, text, afterRow });
  expect((await find("sup-", null)).result).toEqual({ outcome: "found", rowIndex: 2, columnIndex: 0 });
  // The next match is in the second chunk.
  expect((await find("sup-", 2)).result).toEqual({ outcome: "found", rowIndex: 3, columnIndex: 0 });
  expect((await find("sup-", 3)).result).toEqual({ outcome: "not-found" });

  const allItems = await ask(page, { kind: "listInertItems", appId, sheetId: null });
  expect(allItems.items?.map((item) => item.inertItemId).sort()).toEqual(
    [inert.comment, inert.formula, inert.chart].sort(),
  );
  const overviewItems = await ask(page, { kind: "listInertItems", appId, sheetId: sheets.overview });
  expect(overviewItems.items).toEqual([
    {
      inertItemId: inert.chart,
      sheetId: sheets.overview,
      sheetName: "Overview",
      kind: "chart",
      location: "Overview!A2:C9",
      reasonKey: "chart-not-live-yet",
      anchor: { firstRow: 1, firstColumn: 0, lastRow: 8, lastColumn: 2 },
    },
  ]);
  // A sheet the app does not hold is "not there", not "nothing inert".
  expect(
    (await ask(page, { kind: "listInertItems", appId, sheetId: app.records.acme })).items,
  ).toBeNull();
});
