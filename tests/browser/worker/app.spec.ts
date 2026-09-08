/**
 * Opening a durable app and reading it: CAP-15 and CA-13 at the worker tier,
 * in a real browser (S05 CP2/CP3).
 *
 * Every app here comes from **S04's real promotion path** — the import worker,
 * the page-created channel, the data worker, IndexedDB — so what is hydrated is
 * the durable bytes an import actually wrote, not a fixture shaped to be easy
 * to load. The projection is the real SQLite WASM engine; the store is real
 * IndexedDB; the keys are real.
 *
 * `usage-journey.spec.ts` holds the single connected journey. These are the
 * narrower claims that journey stands on.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  PASSPHRASE,
  command,
  installFixture,
  runImport,
  start,
  teardown,
} from "./runtime.js";
import { DEFAULT_APP_THEME } from "../../../src/import/staging/theme.js";
import type {
  AppSessionViewV1,
  CellWireValueV1,
  RecordDetailViewV1,
  RecordPageViewV1,
} from "../../../src/workers/protocol/messages.js";

const APP_TIMEOUT_MS = 180_000;

test.beforeEach(async ({ page }) => {
  await page.goto("/harness.html");
});

test.afterEach(async ({ page }) => {
  await teardown(page);
});

/** Sets a device up and promotes the demo fixture through the real path. */
async function promotedDemo(page: Page): Promise<string> {
  await start(page);
  expect((await command(page, { kind: "setup", passphrase: PASSPHRASE })).ok).toBe(
    true,
  );

  await installFixture(
    page,
    "delimited/field-log-messy.csv",
    "field-log-messy.csv",
  );
  const run = await runImport(page);
  const stageId = run.stageId as string;
  expect(stageId).not.toBeNull();

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
    throw new Error("expected the demo import to promote");
  }
  return promoted.response.appId;
}

async function openApp(page: Page, appId: string): Promise<AppSessionViewV1> {
  const opened = await command(page, { kind: "openApp", appId });
  if (!opened.ok || opened.response.kind !== "openApp") {
    throw new Error("expected an openApp response");
  }
  if (opened.response.session === null) {
    throw new Error("expected the app to open");
  }
  return opened.response.session;
}

async function queryRecords(
  page: Page,
  request: {
    readonly appId: string;
    readonly tableId: string;
    readonly cursor?: number | null;
    readonly limit?: number;
    readonly search?: string | null;
  },
): Promise<RecordPageViewV1> {
  const answered = await command(page, { kind: "queryRecords", ...request });
  if (!answered.ok || answered.response.kind !== "queryRecords") {
    throw new Error("expected a queryRecords response");
  }
  if (answered.response.page === null) {
    throw new Error("expected a page");
  }
  return answered.response.page;
}

const valueOf = (
  record: { readonly values: readonly { readonly fieldId: string; readonly value: CellWireValueV1 }[] },
  fieldId: string,
): CellWireValueV1 | undefined =>
  record.values.find((entry) => entry.fieldId === fieldId)?.value;

test("openApp hydrates the promoted app from its own durable roots", async ({
  page,
}) => {
  test.setTimeout(APP_TIMEOUT_MS);
  const appId = await promotedDemo(page);

  const session = await openApp(page, appId);

  // The identity and theme came out of the checkpoint promotion wrote (D29);
  // nothing here composed a default.
  expect(session.appId).toBe(appId);
  expect(session.displayName).toBe("Field Log");
  expect(session.theme.themeKey).toBe(DEFAULT_APP_THEME.themeKey);
  expect(session.theme.tokens).toEqual(DEFAULT_APP_THEME.tokens);
  expect(session.schemaRevision).toBe(1);
  expect(session.isScratch).toBe(true);
  // CAP-18: the import commit is the one change this device holds, counted
  // from the head's frontier rather than from any cache.
  expect(session.deviceOnlyChangeCount).toBe(1);

  expect(session.tables).toHaveLength(1);
  const table = session.tables[0];
  expect(table?.fields).toHaveLength(9);
  // The rows live in the checkpoint's record pages, and all forty arrived.
  expect(table?.recordCount).toBe(40);
  expect(table?.isRecordCountExact).toBe(true);

  // The enum column carries its options; every other field carries none.
  const status = table?.fields.find((field) => field.displayName === "Status");
  expect(status?.type.kind).toBe("enum");
  expect(status?.enumOptions.map((option) => option.label).sort()).toEqual([
    "Complete",
    "In progress",
    "Scheduled",
    "Waiting",
  ]);
  expect(
    table?.fields
      .filter((field) => field.type.kind !== "enum")
      .every((field) => field.enumOptions.length === 0),
  ).toBe(true);
});

test("queryRecords pages truthfully, with an exact total and stable cursors", async ({
  page,
}) => {
  test.setTimeout(APP_TIMEOUT_MS);
  const appId = await promotedDemo(page);
  const session = await openApp(page, appId);
  const tableId = session.tables[0]?.tableId as string;

  const first = await queryRecords(page, { appId, tableId, limit: 15 });
  expect(first.records).toHaveLength(15);
  expect(first.hasMore).toBe(true);
  expect(first.nextCursor).not.toBeNull();
  expect(first.scope).toEqual({ kind: "table" });
  // Exact because it is `count(*)`, and the type says so (CA-14).
  expect(first.totalCount).toBe(40);
  expect(first.isTotalExact).toBe(true);

  const second = await queryRecords(page, {
    appId,
    tableId,
    limit: 15,
    cursor: first.nextCursor,
  });
  const third = await queryRecords(page, {
    appId,
    tableId,
    limit: 15,
    cursor: second.nextCursor,
  });

  expect(second.records).toHaveLength(15);
  expect(third.records).toHaveLength(10);
  expect(third.hasMore).toBe(false);
  // The end of the table offers no cursor to continue from.
  expect(third.nextCursor).toBeNull();

  const seen = [...first.records, ...second.records, ...third.records].map(
    (record) => record.recordId,
  );
  expect(new Set(seen).size).toBe(40);
  // Cursors are row keys, so a page never skips or repeats.
  expect([...seen].sort()).toEqual([...new Set(seen)].sort());
});

test("search finds a seeded row and states the scope it searched", async ({
  page,
}) => {
  test.setTimeout(APP_TIMEOUT_MS);
  const appId = await promotedDemo(page);
  const session = await openApp(page, appId);
  const table = session.tables[0];
  const tableId = table?.tableId as string;
  const site = table?.fields.find((field) => field.displayName === "Site");
  const siteField = site?.fieldId as string;
  // Inference read `Site` as an enum: few distinct values, repeated. So the
  // stored value is an option id and the searchable text is the option's
  // *label* — which is what makes searching for what you can read work at all.
  expect(site?.type.kind).toBe("enum");
  const bramble = site?.enumOptions.find(
    (option) => option.label === "Bramble Yard",
  );
  expect(bramble).toBeDefined();

  const found = await queryRecords(page, {
    appId,
    tableId,
    search: "Bramble",
  });
  expect(found.scope).toEqual({ kind: "search", text: "Bramble" });
  expect(found.records.length).toBeGreaterThan(0);
  for (const record of found.records) {
    expect(valueOf(record, siteField)).toEqual({
      kind: "option",
      optionId: bramble?.optionId,
    });
  }
  // The total belongs to the table, and `scope` is what says the page does not.
  expect(found.totalCount).toBe(40);

  const none = await queryRecords(page, {
    appId,
    tableId,
    search: "quarry",
  });
  expect(none.records).toEqual([]);
  expect(none.hasMore).toBe(false);
  // Truthfully empty *within this table*, which still holds forty rows.
  expect(none.scope).toEqual({ kind: "search", text: "quarry" });
  expect(none.totalCount).toBe(40);
});

test("getRecord shows the flagged cell's preserved source value beside its issue", async ({
  page,
}) => {
  test.setTimeout(APP_TIMEOUT_MS);
  const appId = await promotedDemo(page);
  const session = await openApp(page, appId);
  const table = session.tables[0];
  const tableId = table?.tableId as string;
  const amountField = table?.fields.find((field) =>
    field.displayName.includes("amount"),
  );
  expect(amountField?.type.kind).toBe("currency");

  // Row 1018's quoted amount reads "TBD" — not a currency value. FR-4 keeps it.
  const flagged = await queryRecords(page, { appId, tableId, search: "TBD" });
  expect(flagged.records).toHaveLength(1);
  const summary = flagged.records[0];
  expect(summary?.warningIssueCount).toBe(1);
  expect(summary?.blockingIssueCount).toBe(0);

  const answered = await command(page, {
    kind: "getRecord",
    appId,
    recordId: summary?.recordId as string,
  });
  if (!answered.ok || answered.response.kind !== "getRecord") {
    throw new Error("expected a getRecord response");
  }
  const record: RecordDetailViewV1 | null = answered.response.record;
  if (record === null) {
    throw new Error("expected the flagged record");
  }

  // The authored source text, preserved verbatim — never coerced to zero, to
  // an empty string, or to `missing` (FR-4/FR-6).
  expect(valueOf(record, amountField?.fieldId as string)).toEqual({
    kind: "invalid",
    sourceText: "TBD",
  });

  // The validator's issue rides beside it, with the parameters a sentence
  // needs. It is a warning: a preserved value never refuses the row.
  const issue = record.issues.find(
    (candidate) => candidate.fieldId === amountField?.fieldId,
  );
  expect(issue?.severity).toBe("warning");
  expect(issue?.messageKey).toBe("validation.preserved-invalid");
  expect(issue?.messageParameters["fieldLabel"]).toBe(amountField?.displayName);
  expect(issue?.messageParameters["expectedType"]).toBe("currency");

  // The value has no typed lane — that is *why* it is flagged — while a value
  // that fits its field does (CA-13(b)/(c)).
  expect(record.indexedFieldIds).not.toContain(amountField?.fieldId);
  const siteField = table?.fields.find((field) => field.displayName === "Site");
  expect(record.indexedFieldIds).toContain(siteField?.fieldId);

  // Other rows in the same column are ordinary decimals, exact as authored.
  const ordinary = await queryRecords(page, { appId, tableId, search: "Cedar Mill" });
  const first = ordinary.records[0];
  if (first === undefined) {
    throw new Error("expected a Cedar Mill row");
  }
  expect(valueOf(first, amountField?.fieldId as string)).toEqual({
    kind: "number",
    decimal: "75.25",
  });
});

test("an unknown app and an unknown record are answered, not refused", async ({
  page,
}) => {
  test.setTimeout(APP_TIMEOUT_MS);
  const appId = await promotedDemo(page);
  const stranger = "AAAAAAAAAAAAAAAAAAAAAA";

  const opened = await command(page, { kind: "openApp", appId: stranger });
  if (!opened.ok || opened.response.kind !== "openApp") {
    throw new Error("expected an openApp response");
  }
  // A stale link is ordinary; `null` is the answer, not an error kind.
  expect(opened.response.session).toBeNull();

  const missing = await command(page, {
    kind: "getRecord",
    appId,
    recordId: stranger,
  });
  if (!missing.ok || missing.response.kind !== "getRecord") {
    throw new Error("expected a getRecord response");
  }
  expect(missing.response.record).toBeNull();

  // Closing an app that was never opened is the same request already answered.
  const closed = await command(page, { kind: "closeApp", appId: stranger });
  expect(closed.ok).toBe(true);
});

test("noteAppOpened records the time as a cache, authoring no event", async ({
  page,
}) => {
  test.setTimeout(APP_TIMEOUT_MS);
  const appId = await promotedDemo(page);

  const before = await command(page, { kind: "listLibrary" });
  if (!before.ok || before.response.kind !== "listLibrary") {
    throw new Error("expected a library listing");
  }
  expect(before.response.apps[0]?.lastOpenedAtEpochMs).toBeNull();

  const noted = await command(page, { kind: "noteAppOpened", appId });
  if (!noted.ok || noted.response.kind !== "noteAppOpened") {
    throw new Error("expected a noteAppOpened response");
  }
  expect(noted.response.lastOpenedAtEpochMs).toBeGreaterThan(0);

  const after = await command(page, { kind: "listLibrary" });
  if (!after.ok || after.response.kind !== "listLibrary") {
    throw new Error("expected a library listing");
  }
  expect(after.response.apps[0]?.lastOpenedAtEpochMs).toBe(
    noted.response.lastOpenedAtEpochMs,
  );

  // It is an operational write: the app's own history did not gain an entry,
  // because there is no last-opened event to author.
  const history = await command(page, { kind: "getChangeHistory", appId });
  if (!history.ok || history.response.kind !== "getChangeHistory") {
    throw new Error("expected a history page");
  }
  const kinds = (history.response.page?.entries ?? []).map(
    (entry) => entry.eventKind,
  );
  expect(kinds).not.toContain("app.opened");
  expect(kinds.every((kind) => kind.startsWith("app.") || kind.startsWith("record.") || kind.startsWith("table.") || kind.startsWith("field.") || kind.startsWith("enum.") || kind.startsWith("import.") || kind.startsWith("inference-decision."))).toBe(true);
});
