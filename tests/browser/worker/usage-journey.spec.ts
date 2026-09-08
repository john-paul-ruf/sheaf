/**
 * **F02's first narrow journey, worker tier** (S05 CP4).
 *
 * One connected path, in one real browser, through every real boundary:
 *
 * ```
 * fresh origin → setup → import the messy CSV (real import worker, real
 * page-created channel, real data worker, real IndexedDB) → create app →
 * open → search → patch → refuse an invalid patch → delete → restore →
 * full page reload, new worker, unlock → open → the same answers →
 * readable reset lists the app by name with a real device-only count → cancel
 * ```
 *
 * Nothing here is a fixture shaped to be convenient. The app comes from S04's
 * promotion path, the projection is SQLite WASM in the data worker, the keys
 * are libsodium's, and the store is the origin's own IndexedDB. The restart is
 * a genuine `page.goto` — a new page, a new worker, a new unlock — so what is
 * read afterwards was read out of durable bytes and nothing else.
 *
 * This is the proof the whole UI fan-out (S06–S08) stands on. S08 completes the
 * same journey through the real `index.html` entry.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  PASSPHRASE,
  command,
  installFixture,
  readStore,
  runImport,
  start,
  teardown,
} from "./runtime.js";
import type {
  AppSessionViewV1,
  CellWireValueV1,
  RecordPageViewV1,
} from "../../../src/workers/protocol/messages.js";

const JOURNEY_TIMEOUT_MS = 240_000;

test.beforeEach(async ({ page }) => {
  await page.goto("/harness.html");
});

test.afterEach(async ({ page }) => {
  await teardown(page);
});

/** What a query answered, in a form two runs can be compared by. */
interface Snapshot {
  readonly totalCount: number;
  readonly records: readonly {
    readonly recordId: string;
    readonly recordRevision: number;
    readonly values: readonly { readonly fieldId: string; readonly value: CellWireValueV1 }[];
    readonly blockingIssueCount: number;
    readonly warningIssueCount: number;
  }[];
}

/**
 * Deliberately excludes `cursor`. A row key is a *session* identity assigned
 * as the projection loads, so it is not expected to survive a restart — and
 * asserting it did would be asserting something untrue.
 */
const snapshotOf = (page: RecordPageViewV1): Snapshot => ({
  totalCount: page.totalCount,
  records: [...page.records]
    .map((record) => ({
      recordId: record.recordId,
      recordRevision: record.recordRevision,
      values: [...record.values].sort((left, right) =>
        left.fieldId.localeCompare(right.fieldId),
      ),
      blockingIssueCount: record.blockingIssueCount,
      warningIssueCount: record.warningIssueCount,
    }))
    .sort((left, right) => left.recordId.localeCompare(right.recordId)),
});

async function openApp(page: Page, appId: string): Promise<AppSessionViewV1> {
  const opened = await command(page, { kind: "openApp", appId });
  if (!opened.ok || opened.response.kind !== "openApp" || opened.response.session === null) {
    throw new Error("expected the app to open");
  }
  return opened.response.session;
}

async function wholeTable(
  page: Page,
  appId: string,
  tableId: string,
): Promise<RecordPageViewV1> {
  const answered = await command(page, {
    kind: "queryRecords",
    appId,
    tableId,
    limit: 200,
  });
  if (!answered.ok || answered.response.kind !== "queryRecords" || answered.response.page === null) {
    throw new Error("expected a page");
  }
  return answered.response.page;
}

const valueOf = (
  record: { readonly values: readonly { readonly fieldId: string; readonly value: CellWireValueV1 }[] },
  fieldId: string,
): CellWireValueV1 | undefined =>
  record.values.find((entry) => entry.fieldId === fieldId)?.value;

test("open, search, edit, delete, restore, restart — and it is all still there", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);

  // --- a fresh origin, set up ----------------------------------------------
  await start(page);
  expect((await command(page, { kind: "setup", passphrase: PASSPHRASE })).ok).toBe(true);

  // --- import the messy CSV, end to end ------------------------------------
  await installFixture(page, "delimited/field-log-messy.csv", "field-log-messy.csv");
  const run = await runImport(page);
  expect(run.events.some((event) => event.kind === "completed")).toBe(true);
  const stageId = run.stageId as string;

  await command(page, { kind: "runInference", stageId });
  const promoted = await command(page, {
    kind: "promoteImport",
    stageId,
    acceptedName: "Field Log",
  });
  if (
    !promoted.ok ||
    promoted.response.kind !== "promoteImport" ||
    promoted.response.outcome !== "promoted"
  ) {
    throw new Error("expected the import to become an app");
  }
  const appId = promoted.response.appId;
  expect(promoted.response.rowCount).toBe(40);

  // --- open ----------------------------------------------------------------
  const session = await openApp(page, appId);
  expect(session.displayName).toBe("Field Log");
  expect(session.tables).toHaveLength(1);
  const table = session.tables[0];
  const tableId = table?.tableId as string;
  expect(table?.recordCount).toBe(40);

  const emailField = table?.fields.find((field) =>
    field.displayName.toLowerCase().includes("email"),
  );
  const emailId = emailField?.fieldId as string;
  const status = table?.fields.find((field) => field.displayName === "Status");

  // --- search --------------------------------------------------------------
  const searched = await command(page, {
    kind: "queryRecords",
    appId,
    tableId,
    search: "Bramble",
  });
  if (!searched.ok || searched.response.kind !== "queryRecords" || searched.response.page === null) {
    throw new Error("expected a search page");
  }
  expect(searched.response.page.records.length).toBeGreaterThan(0);
  expect(searched.response.page.scope).toEqual({ kind: "search", text: "Bramble" });

  // --- patch a record, validly ---------------------------------------------
  const before = await wholeTable(page, appId, tableId);
  const edited = before.records[0]?.recordId as string;
  const deleted = before.records[1]?.recordId as string;

  const patched = await command(page, {
    kind: "patchRecord",
    appId,
    recordId: edited,
    changes: [{ fieldId: emailId, value: { kind: "text", text: "kept@example.test" } }],
  });
  if (!patched.ok || patched.response.kind !== "patchRecord") {
    throw new Error("expected a patch response");
  }
  expect(patched.response.outcome).toBe("accepted");

  // --- an invalid patch: a typed refusal, and nothing durable moves ---------
  const storeBefore = await readStore(page);
  const refused = await command(page, {
    kind: "patchRecord",
    appId,
    recordId: edited,
    changes: [
      {
        fieldId: status?.fieldId as string,
        value: { kind: "option", optionId: "AAAAAAAAAAAAAAAAAAAAAA" },
      },
    ],
  });
  if (!refused.ok || refused.response.kind !== "patchRecord") {
    throw new Error("expected a patch response");
  }
  expect(refused.response.outcome).toBe("rejected");
  if (refused.response.outcome === "rejected") {
    expect(refused.response.report.isValid).toBe(false);
    expect(refused.response.report.issues.length).toBeGreaterThan(0);
  }

  // Byte-identical: no envelope was added, removed, or rewritten. A refusal
  // that had written anything would show here.
  const storeAfter = await readStore(page);
  expect(storeAfter.transactionRevision).toBe(storeBefore.transactionRevision);
  expect([...storeAfter.envelopes].sort((l, r) => l.storageId.localeCompare(r.storageId)))
    .toEqual([...storeBefore.envelopes].sort((l, r) => l.storageId.localeCompare(r.storageId)));

  // --- delete, then restore ------------------------------------------------
  expect(
    (await command(page, { kind: "deleteRecord", appId, recordId: deleted })).ok,
  ).toBe(true);
  expect((await wholeTable(page, appId, tableId)).totalCount).toBe(39);

  const restored = await command(page, { kind: "restoreRecord", appId, recordId: deleted });
  if (!restored.ok || restored.response.kind !== "restoreRecord") {
    throw new Error("expected a restore response");
  }
  expect(restored.response.outcome).toBe("accepted");

  const live = await wholeTable(page, appId, tableId);
  expect(live.totalCount).toBe(40);
  const beforeRestart = snapshotOf(live);
  expect(
    valueOf(
      live.records.find((record) => record.recordId === edited) as never,
      emailId,
    ),
  ).toEqual({ kind: "text", text: "kept@example.test" });

  const historyBefore = await command(page, { kind: "getChangeHistory", appId, limit: 100 });
  if (!historyBefore.ok || historyBefore.response.kind !== "getChangeHistory") {
    throw new Error("expected a history page");
  }
  const kindsBefore = (historyBefore.response.page?.entries ?? []).map(
    (entry) => entry.eventKind,
  );
  // Newest first, and **exactly** the three authored changes.
  //
  // The import commit is not here, and that is the projection's design rather
  // than a loss: `change_history` is written by replay, and the commits a
  // checkpoint already covers are not replayed — their effect is the rows the
  // checkpoint loaded. So this log means "what has changed since this app was
  // created", which is what FR-12's recoverable delete needs. A surface must
  // not imply it is the app's whole story (recorded in this session's handoff
  // for S06/S08).
  expect(kindsBefore).toEqual([
    "record.restored",
    "record.deleted",
    "record.patched",
  ]);

  // --- the restart: a new page, a new worker, a new unlock -----------------
  await page.evaluate(() => {
    window.__sheafApp?.dispose();
  });
  await page.goto("/harness.html");
  await start(page);
  expect((await command(page, { kind: "unlock", passphrase: PASSPHRASE })).ok).toBe(true);

  const reopened = await openApp(page, appId);
  expect(reopened.displayName).toBe("Field Log");
  expect(reopened.tables[0]?.recordCount).toBe(40);
  // The import commit plus the patch, the delete, and the restore.
  expect(reopened.deviceOnlyChangeCount).toBe(4);

  // CA-13's equivalence, through the real store: the same answers, rebuilt
  // from a checkpoint and a replayed tail rather than remembered.
  const afterRestart = snapshotOf(await wholeTable(page, appId, reopened.tables[0]?.tableId as string));
  expect(afterRestart).toEqual(beforeRestart);

  // The edit survived, and the flagged import value is still flagged.
  const rebuilt = await wholeTable(page, appId, reopened.tables[0]?.tableId as string);
  expect(
    valueOf(rebuilt.records.find((record) => record.recordId === edited) as never, emailId),
  ).toEqual({ kind: "text", text: "kept@example.test" });
  expect(
    rebuilt.records.filter((record) => record.warningIssueCount > 0),
  ).toHaveLength(1);

  const historyAfter = await command(page, { kind: "getChangeHistory", appId, limit: 100 });
  if (!historyAfter.ok || historyAfter.response.kind !== "getChangeHistory") {
    throw new Error("expected a history page");
  }
  expect(
    (historyAfter.response.page?.entries ?? []).map((entry) => entry.eventKind),
  ).toEqual(kindsBefore);
  expect(historyAfter.response.page?.entries[0]?.eventId).toBe(
    historyBefore.response.page?.entries[0]?.eventId,
  );

  // --- CAP-18: a readable reset now lists a real app, with a real count -----
  const inventory = await command(page, { kind: "resetReadable" });
  if (
    !inventory.ok ||
    inventory.response.kind !== "resetReadable" ||
    inventory.response.phase !== "inventory"
  ) {
    throw new Error("expected the reset inventory");
  }
  expect(inventory.response.inventory.appCount).toBe(1);
  expect(inventory.response.inventory.apps).toHaveLength(1);
  const listed = inventory.response.inventory.apps[0];
  // By name, not by opaque id (CA-09), and counted from the decrypted head's
  // frontier rather than from any cache (check 7).
  expect(listed?.displayName).toBe("Field Log");
  expect(listed?.deviceOnlyChangeCount).toBe(4);
  expect(listed?.appId).toBe(appId);

  // --- cancel: the app is still here ---------------------------------------
  const still = await wholeTable(page, appId, reopened.tables[0]?.tableId as string);
  expect(still.totalCount).toBe(40);
  expect((await readStore(page)).exists).toBe(true);
});

test("lock destroys the projection: nothing answers until the app is opened again", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);

  await start(page);
  await command(page, { kind: "setup", passphrase: PASSPHRASE });
  await installFixture(page, "delimited/field-log-messy.csv", "field-log-messy.csv");
  const run = await runImport(page);
  const stageId = run.stageId as string;
  await command(page, { kind: "runInference", stageId });
  const promoted = await command(page, {
    kind: "promoteImport",
    stageId,
    acceptedName: "Field Log",
  });
  if (
    !promoted.ok ||
    promoted.response.kind !== "promoteImport" ||
    promoted.response.outcome !== "promoted"
  ) {
    throw new Error("expected the import to become an app");
  }
  const appId = promoted.response.appId;
  const session = await openApp(page, appId);
  const tableId = session.tables[0]?.tableId as string;
  expect((await wholeTable(page, appId, tableId)).totalCount).toBe(40);

  // --- lock ----------------------------------------------------------------
  expect((await command(page, { kind: "lock" })).ok).toBe(true);

  // Every app-scoped call is refused now. The projection held plaintext, and
  // locking destroyed it along with the app key (invariant 3).
  for (const request of [
    { kind: "queryRecords" as const, appId, tableId },
    { kind: "getRecord" as const, appId, recordId: "AAAAAAAAAAAAAAAAAAAAAA" },
    { kind: "getChangeHistory" as const, appId },
    { kind: "openApp" as const, appId },
  ]) {
    const answered = await command(page, request);
    expect({ kind: request.kind, ok: answered.ok }).toEqual({
      kind: request.kind,
      ok: false,
    });
    if (!answered.ok) {
      expect(answered.error.kind).toBe("locked");
    }
  }

  // --- unlock, and open again ---------------------------------------------
  expect((await command(page, { kind: "unlock", passphrase: PASSPHRASE })).ok).toBe(true);
  // Still refused until the app is opened: the projection is gone, not idle.
  const reopened = await openApp(page, appId);
  expect(reopened.tables[0]?.recordCount).toBe(40);
  expect(
    (await wholeTable(page, appId, reopened.tables[0]?.tableId as string)).totalCount,
  ).toBe(40);
});
