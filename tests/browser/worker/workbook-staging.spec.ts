/**
 * CAP-19 / CAP-21 at the worker tier, CA-18's worker leg, and CA-24 (S06 CP2),
 * in a real browser: the real import worker routes a workbook by the flows the
 * page declares (D48), sizes it from metadata through the registry (D35),
 * streams only the selected sheets over the page's channel into the real data
 * worker's stage, and cancels, refuses and fails exactly as the protocol says.
 *
 * Refusals are checked against raw IndexedDB: a refused file leaves the store
 * byte-for-byte where it was — no stage row, no workflow, no revision.
 */

import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { ImportWorkerEventV1 } from "../../../src/workers/protocol/import-messages.js";
import { PASSPHRASE, command, installFixture, readStore, start, teardown } from "./runtime.js";
import { corruptZipEntryCrc, installBytes, runWorkbookImport } from "./workbook-runtime.js";

const JOURNEY_TIMEOUT_MS = 180_000;
const WORKBOOK_FLOWS = ["delimited", "workbook"] as const;
const DEMO = "ooxml/fieldwork-q3.xlsx";

test.beforeEach(async ({ page }) => {
  await page.goto("/harness.html");
});

test.afterEach(async ({ page }) => {
  await teardown(page);
});

async function unlockedPage(page: Page): Promise<void> {
  await start(page);
  const created = await command(page, { kind: "setup", passphrase: PASSPHRASE });
  expect(created.ok).toBe(true);
}

const terminalOf = (events: readonly ImportWorkerEventV1[]): ImportWorkerEventV1 | undefined =>
  events.find((event) => ["refused", "completed", "cancelled", "failed"].includes(event.kind));

/** Cancels the stage and asserts every row the import wrote is gone again. */
async function expectCleanedUp(page: Page, stageId: string, before: Awaited<ReturnType<typeof readStore>>) {
  const receipt = await command(page, { kind: "cancelImportStage", stageId });
  if (!receipt.ok || receipt.response.kind !== "cancelImportStage") {
    throw new Error("expected a cleanup receipt");
  }
  expect(receipt.response.receipt.completed).toBe(true);
  const gone = await command(page, { kind: "getImportStage", stageId });
  expect(gone.ok && gone.response.kind === "getImportStage" ? gone.response.stage : "missing").toBeNull();
  const after = await readStore(page);
  // What remains beyond the starting rows is exactly the superseded catalogs
  // (F05's mark-and-sweep collects those, as for every F02 cancel).
  const catalogsWritten = (after.transactionRevision as number) - (before.transactionRevision as number);
  expect(after.envelopes.length).toBe(before.envelopes.length + catalogsWritten);
  return receipt.response.receipt;
}

test("a workbook is sized from metadata, streamed sheet by sheet, and staged (CAP-19/21, CA-18, CA-24)", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await unlockedPage(page);
  await installFixture(page, DEMO, "fieldwork-q3.xlsx");

  // Every sheet but Archive 2018 (D47: the user deselects it).
  const run = await runWorkbookImport(page, { flows: WORKBOOK_FLOWS, selection: [0, 1, 2, 3, 4, 5] });

  const preflight = run.events.find((event) => event.kind === "workbook-preflight");
  if (preflight?.kind !== "workbook-preflight") throw new Error("expected a workbook-preflight event");
  expect(preflight.detected).toEqual({ kind: "zip-container", container: "ooxml" });
  expect(preflight.report).toMatchObject({ format: "xlsx", route: "fits", isEstimate: true, sheetListKnown: true });
  expect(preflight.report.sheets).toHaveLength(7);
  expect(preflight.report.defaultSelection).toEqual([0, 1, 2, 3, 4, 5, 6]);
  // Estimates, flagged as such: nothing here was counted from cells (D24).
  expect(preflight.report.totals.estimatedCellCount).toBeGreaterThan(0);
  expect(run.events.some((event) => event.kind === "preflight")).toBe(false);

  expect(terminalOf(run.events)?.kind).toBe("completed");
  const named = run.events.flatMap((event) =>
    event.kind === "progress" && event.sheetName !== undefined
      ? [`${String(event.sheetOrdinal)} of ${String(event.sheetCount)} · ${event.sheetName}`]
      : [],
  );
  expect([...new Set(named)]).toEqual([
    "1 of 6 · Jobs",
    "2 of 6 · Customers",
    "3 of 6 · Crew",
    "4 of 6 · Visits",
    "5 of 6 · Materials",
    "6 of 6 · Overview",
  ]);
  expect(named.some((entry) => entry.includes("Archive"))).toBe(false);

  const stage = await command(page, { kind: "getImportStage", stageId: run.stageId as string });
  if (!stage.ok || stage.response.kind !== "getImportStage" || stage.response.stage === null) {
    throw new Error("expected a staged import");
  }
  expect(stage.response.stage).toMatchObject({ status: "staged", phase: "inferring" });
  // The six selected sheets' rows, exactly: S01's pins, Archive excluded.
  expect(stage.response.stage.rowsSoFar).toBe(61 + 13 + 39 + 41 + 9 + 5);
});

test("the same workbook, from a page without the workbook flow, keeps F02's truthful refusal", async ({ page }) => {
  await unlockedPage(page);
  const before = await readStore(page);
  await installFixture(page, DEMO, "fieldwork-q3.xlsx");

  const run = await runWorkbookImport(page);

  expect(terminalOf(run.events)).toEqual({
    kind: "refused",
    refusal: {
      kind: "workbook-format-later-release",
      fileName: "fieldwork-q3.xlsx",
      remedy: "await-later-release",
      format: "ooxml",
    },
  });
  expect(run.stageId).toBeNull();
  expect(await readStore(page)).toEqual(before);
});

test("a macro workbook is refused before any stage exists — raw IndexedDB is unchanged", async ({ page }) => {
  await unlockedPage(page);
  const before = await readStore(page);
  await installFixture(page, "unsafe/payroll.xlsm", "payroll.xlsm");

  const run = await runWorkbookImport(page, { flows: WORKBOOK_FLOWS });

  expect(terminalOf(run.events)).toEqual({
    kind: "refused",
    refusal: { kind: "macro-content", fileName: "payroll.xlsm", remedy: "reupload-macro-free-copy" },
  });
  expect(run.stageId).toBeNull();
  // Not one row, not one revision: there was never a stage to clean up.
  expect(await readStore(page)).toEqual(before);
});

test("an unsafe container is refused by its closed detail, with nothing staged", async ({ page }) => {
  await unlockedPage(page);
  const before = await readStore(page);
  await installFixture(page, "unsafe/zip-bomb.xlsx", "zip-bomb.xlsx");

  const run = await runWorkbookImport(page, { flows: WORKBOOK_FLOWS });

  expect(terminalOf(run.events)).toEqual({
    kind: "refused",
    refusal: {
      kind: "binary-unreadable",
      fileName: "zip-bomb.xlsx",
      remedy: "choose-another-file",
      detail: "expansion-limit",
    },
  });
  expect(await readStore(page)).toEqual(before);
});

test("cancelling mid-sheet stops the parser, and the stage is cleaned up with a receipt", async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await unlockedPage(page);
  const before = await readStore(page);
  await installFixture(page, DEMO, "fieldwork-q3.xlsx");

  // Archive 2018 alone: ~2000 rows, many batches, so the cancel lands mid-sheet.
  const run = await runWorkbookImport(page, { flows: WORKBOOK_FLOWS, selection: [6], cancelAfterBatches: 2 });

  expect(terminalOf(run.events)?.kind).toBe("cancelled");
  expect(run.events.some((event) => event.kind === "completed")).toBe(false);
  // S07 judges PARSER_STOP_TIMEOUT_MS against this: CANCEL sent → parser terminal.
  expect(run.cancelLatencyMs).not.toBeNull();
  console.log(`xlsx cancel latency (CANCEL → cancelled): ${(run.cancelLatencyMs as number).toFixed(1)} ms`);
  expect(run.cancelLatencyMs as number).toBeLessThan(5_000);

  await expectCleanedUp(page, run.stageId as string, before);
});

test("a sheet body damaged behind intact metadata fails with its detail, and cleans up", async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await unlockedPage(page);
  const before = await readStore(page);

  // Pre-flight's metadata read stops before the end of the Jobs sheet's part,
  // so it never reaches the CRC and sizes the file normally; the parse reads
  // the whole part, and the damaged CRC-32 is what it meets.
  const bytes = corruptZipEntryCrc(
    Uint8Array.from(await readFile(`tests/fixtures/workbooks/${DEMO}`)),
    "xl/worksheets/sheet1.xml",
  );
  await installBytes(page, bytes, "fieldwork-q3.xlsx");

  const run = await runWorkbookImport(page, { flows: WORKBOOK_FLOWS, selection: [0, 1] });

  expect(run.events.some((event) => event.kind === "workbook-preflight")).toBe(true);
  const failed = terminalOf(run.events);
  if (failed?.kind !== "failed") throw new Error(`expected a failure, got ${JSON.stringify(failed)}`);
  expect(failed.reason).toBe("parse-failed");
  // Jobs fits in one batch, so the adapter met the CRC before it yielded
  // anything: which sheet it was on is not evidenced, and is not guessed.
  expect(failed.detail).toEqual({ stage: "sheet-stream", sheetOrdinal: null, diagnostic: "malformed-structure" });
  expect(run.stageId).not.toBeNull();

  await expectCleanedUp(page, run.stageId as string, before);
});

test("a proceed naming a sheet the inventory does not have is refused before a sheet is read", async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await unlockedPage(page);
  await installFixture(page, "ooxml/hidden-sheets.xlsx", "hidden-sheets.xlsx");

  // The data worker validates its own copy too; this reaches the import
  // worker's check by staging a valid selection and proceeding with another.
  const outcome = await page.evaluate(async () => {
    const app = window.__sheafApp;
    const file = window.__sheafFixture;
    if (app === undefined || file === undefined) throw new Error("missing runtime");
    const spawn = await window.__sheafHarness.module<typeof import("../../../src/bootstrap/import-worker.js")>(
      "/src/bootstrap/import-worker.ts",
    );
    const client = spawn.createImportWorkerClient();
    const channel = new MessageChannel();
    const events: string[] = [];
    const done = new Promise<void>((resolve) => {
      client.on((event) => {
        events.push(event.kind === "failed" ? `failed:${event.reason}` : event.kind);
        if (event.kind === "workbook-preflight") {
          void (async () => {
            const response = await app.client.send(
              {
                kind: "beginImportStage",
                fileName: file.name,
                detected: { kind: "workbook", format: event.report.format },
                preflight: {
                  kind: "workbook",
                  sheets: event.report.sheets.map((sheet) => ({
                    sheetIndex: sheet.sheetIndex,
                    name: sheet.name,
                    sheetKind: sheet.kind,
                    visibility: sheet.visibility,
                    estimatedRowCount: sheet.estimatedRowCount,
                    estimatedCellCount: sheet.estimatedCellCount,
                  })),
                  selectedSheets: [0],
                  sourceByteLength: event.report.sourceByteLength,
                  isEstimate: true,
                },
              },
              [channel.port2],
            );
            if (response.kind === "beginImportStage") {
              client.send({ kind: "proceed", stageId: response.stageId, selectedSheets: [0, 99] });
            }
          })();
        }
        if (event.kind === "failed" || event.kind === "completed") resolve();
      });
    });
    client.send(
      { kind: "startImport", file, fileName: file.name, acceptedFlows: ["delimited", "workbook"] },
      [channel.port1],
    );
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 30_000))]);
    client.dispose();
    return events;
  });

  expect(outcome).toContain("failed:malformed-request");
  expect(outcome).not.toContain("completed");
  expect(outcome.filter((kind) => kind === "progress").length).toBeLessThanOrEqual(3);
});
