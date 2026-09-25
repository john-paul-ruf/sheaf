import { dismissExpectedScratchReminder } from "./fixtures/durability.js";
/**
 * CAP-24 (and CAP-23's app-side leg) through the real entry — workbook-fidelity
 * SESSION-08 CP4, CA-21's consumer proof.
 *
 * `index.html` → `src/main.tsx` → the production data and import workers →
 * real staging, promotion and IndexedDB → S03's relationship reads
 * (`getRelatedRecords`, `getRelatedChildren`, `searchReferenceCandidates`,
 * `getDeletedRecord`, `listTables`) → the records surfaces. Nothing is
 * stubbed; the only input is the demo workbook a person would pick.
 *
 * The demo (`build-demo.ts`): 60 jobs, each with a Customer ID looked up into
 * Customers by VLOOKUP (the relationship); J-1016 and J-1042 carry `C-013`,
 * which no customer has — the broken references STA-011 shows.
 */

import type { Page } from "@playwright/test";
import { auditable, clipped, undersizedTargets } from "./fixtures/a11y.js";
import {
  COMPACT_VIEWPORT,
  DERIVE_TIMEOUT_MS,
  PASSPHRASE,
  attemptUnlock,
  deleteLocalStore,
  followHash,
  openApp,
  protectDevice,
  screen,
} from "./fixtures/app.js";
import { expect, test } from "./fixtures/no-network.js";
import { openRecord, openTable } from "./fixtures/records.js";
import { WORKBOOK_TIMEOUT_MS, importDemoWorkbook } from "./fixtures/workbook.js";

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

async function openJob(page: Page, appHash: string, jobId: string): Promise<string> {
  await followHash(page, appHash);
  await openTable(page, "Jobs");
  await openRecord(page, "Jobs", jobId);
  return new URL(page.url()).hash;
}

/** SHT-002 / MOD-011's shared search: type, choose by label. */
async function chooseCandidate(page: Page, fieldName: string, text: string, label: string): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(`Search ${fieldName} choices`, { exact: true }).fill(text);
  await dialog.getByRole("button", { name: new RegExp(`^${label}`, "u") }).click();
}

test("related records navigate both ways, broken ones repair, and it all survives a reload", async ({
  page,
  network,
}) => {
  test.setTimeout(420_000);

  await openApp(page);
  await protectDevice(page);
  const appHash = await importDemoWorkbook(page);

  // --- Jobs pages past 50 (closes F02's paging gap) -------------------------
  await followHash(page, appHash);
  await openTable(page, "Jobs");
  const list = screen(page, "SCR-025");
  await expect(list).toContainText("This table holds 60 records.");
  await expect(list.locator("[data-record]")).toHaveCount(50);
  await page.getByRole("button", { name: "Show more records" }).click();
  await expect(list.locator("[data-record]")).toHaveCount(60);
  await expect(page.getByRole("button", { name: "Show more records" })).toHaveCount(0);
  // A reference column reads as the customer's name, a broken one with its key.
  await expect(list.locator("[data-record]").filter({ hasText: /^J-1016/u })).toContainText(
    "Missing related record · original key C-013",
  );

  // --- SHT-003: every table, exact counts, the current one marked -----------
  await page.getByRole("button", { name: "Jobs · 60 records · switch table" }).click();
  const switcher = page.locator('[data-sheet="SHT-003"]');
  await expect(switcher.getByRole("link", { name: /^Customers/u })).toContainText("12 records");
  await expect(switcher.getByRole("link", { name: /^Jobs/u })).toHaveAttribute("aria-current", "page");
  await auditable(page, "SCR-025");
  await page.keyboard.press("Escape");

  // --- belongs to: J-1001 → Harbor View Inn --------------------------------
  const j1001 = await openJob(page, appHash, "J-1001");
  const belongsTo = page.locator('[data-belongs-to]');
  await expect(belongsTo).toContainText("Harbor View Inn");
  await expect(belongsTo).toContainText("Customers · Customer ID");
  await auditable(page, "SCR-027");
  await belongsTo.getByRole("link", { name: "Open in Customers →" }).click();

  // --- has many: the customer's jobs, and back -------------------------------
  const customer = screen(page, "SCR-027");
  await expect(customer).toContainText("C-008");
  const jobs = page.locator("[data-has-many]");
  await expect(jobs).toContainText("5 in Jobs");
  await jobs.getByRole("link", { name: "J-1001", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe(j1001);
  await expect(page.locator("[data-belongs-to]")).toContainText("Harbor View Inn");

  // --- STA-011 + MOD-011: J-1016's C-013 is missing; repair it ---------------
  const j1016 = await openJob(page, appHash, "J-1016");
  const missing = page.locator('[data-missing]');
  await expect(missing).toContainText("Missing related record");
  await expect(missing).toContainText("Customer ID");
  await missing.getByText("Show original key").click();
  await expect(missing).toContainText("C-013");
  await auditable(page, "SCR-027");
  await missing.getByRole("button", { name: "Repair reference" }).click();
  const repair = page.getByRole("dialog");
  await expect(repair).toContainText("Repair broken reference");
  await expect(repair).toContainText("C-013");
  await chooseCandidate(page, "Customer ID", "Harbor", "Harbor View Inn");
  await repair.getByRole("button", { name: "Point it at “Harbor View Inn”" }).click();
  await expect(screen(page, "SCR-027")).toContainText("Saved on this device.");
  await dismissExpectedScratchReminder(page);
  await expect(page.locator("[data-belongs-to]")).toContainText("Harbor View Inn");
  await expect(page.locator("[data-missing]")).toHaveCount(0);

  // --- leaving J-1042 flagged is a real choice and writes nothing -----------
  await followHash(page, `${appHash}/history`);
  await expect(screen(page, "SCR-032").locator("[data-event]")).toHaveCount(1);
  await openJob(page, appHash, "J-1042");
  await page.locator("[data-missing]").getByRole("button", { name: "Repair reference" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave flagged" }).click();
  await expect(page.locator("[data-missing]")).toContainText("Customer ID");
  await followHash(page, `${appHash}/history`);
  await expect(screen(page, "SCR-032").locator("[data-event]")).toHaveCount(1);
  await expect(screen(page, "SCR-032")).toContainText("Jobs");

  // --- “show all” pages the children (Harbor now has 6) ---------------------
  await followHash(page, j1016);
  await page.locator("[data-belongs-to]").getByRole("link").click();
  await expect(page.locator("[data-has-many]")).toContainText("6 in Jobs");
  await page.getByRole("button", { name: "Show all 6 in Jobs" }).click();
  await expect(page.locator("[data-has-many] a")).toHaveCount(6);
  await expect(page.locator("[data-has-many]")).toContainText("J-1016");

  // --- SHT-002: create a job, choosing its customer by name ------------------
  await followHash(page, appHash);
  await openTable(page, "Jobs");
  await page.getByRole("link", { name: "Add a record", exact: true }).first().click();
  await expect(screen(page, "SCR-028")).toBeVisible();
  await page.getByLabel("Job ID", { exact: true }).fill("J-2001");
  await page.locator('[data-control="reference-picker"]').click();
  await chooseCandidate(page, "Customer ID", "Alder", "Alder Court HOA");
  await page.getByRole("dialog").getByRole("button", { name: "Apply choice" }).click();
  await expect(page.locator('[data-control="reference-picker"]')).toHaveText("Alder Court HOA");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(screen(page, "SCR-027")).toContainText("Created on this device.", {
    timeout: WORKBOOK_TIMEOUT_MS,
  });
  await expect(page.locator("[data-belongs-to]")).toContainText("Alder Court HOA");
  const j2001 = new URL(page.url()).hash;

  // --- delete the customer: its jobs break, keeping its key -----------------
  await page.locator("[data-belongs-to]").getByRole("link").click();
  await expect(screen(page, "SCR-027")).toContainText("C-001");
  await page.getByRole("button", { name: "Record actions…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete record…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete record", exact: true }).click();
  await expect(screen(page, "SCR-025")).toContainText("This table holds 11 records.", {
    timeout: WORKBOOK_TIMEOUT_MS,
  });
  await followHash(page, j2001);
  await expect(page.locator("[data-missing]")).toContainText("Customer ID");
  await page.locator("[data-missing]").getByText("Show original key").click();
  await expect(page.locator("[data-missing]")).toContainText("C-001");

  // --- MOD-010: the original values, then the restore ------------------------
  await followHash(page, `${appHash}/history`);
  await expect(screen(page, "SCR-032")).toContainText("Record deleted");
  await page.getByRole("button", { name: "Restore record…" }).click();
  const restore = page.getByRole("alertdialog");
  await expect(restore).toContainText("from Customers.");
  await expect(restore.locator("[data-original]")).toContainText("Alder Court HOA");
  await expect(restore.locator("[data-original]")).toContainText("C-001");
  await auditable(page, "SCR-032");
  await restore.getByRole("button", { name: "Restore record", exact: true }).click();
  await expect(screen(page, "SCR-032")).toContainText("Restored on this device.");
  await followHash(page, j2001);
  await expect(page.locator("[data-belongs-to]")).toContainText("Alder Court HOA");
  await expect(page.locator("[data-missing]")).toHaveCount(0);

  // --- reload is a lock and a fresh worker: every fact holds ----------------
  await openApp(page);
  await attemptUnlock(page, PASSPHRASE);
  await expect(screen(page, "SCR-010")).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
  await followHash(page, j1016);
  await expect(page.locator("[data-belongs-to]")).toContainText("Harbor View Inn", {
    timeout: DERIVE_TIMEOUT_MS,
  });
  await followHash(page, j2001);
  await expect(page.locator("[data-belongs-to]")).toContainText("Alder Court HOA");
  await openJob(page, appHash, "J-1042");
  await expect(page.locator("[data-missing]")).toContainText("Customer ID");

  expect(network.unexpected).toEqual([]);
});

test("axe and 320px: the relationship surfaces", async ({ page, network }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(COMPACT_VIEWPORT);

  await openApp(page);
  await protectDevice(page);
  const appHash = await importDemoWorkbook(page);
  await auditable(page, "SCR-024");
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);

  await openJob(page, appHash, "J-1016");
  await page.locator("[data-missing]").getByText("Show original key").click();
  await auditable(page, "SCR-027");
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);

  await page.locator("[data-missing]").getByRole("button", { name: "Repair reference" }).click();
  await expect(page.getByRole("dialog")).toContainText("Harbor View Inn");
  await auditable(page, "SCR-027");
  expect(await clipped(page)).toEqual([]);
  await page.getByRole("dialog").getByRole("button", { name: "Leave flagged" }).click();

  await page.getByRole("link", { name: "Edit this record" }).click();
  await expect(screen(page, "SCR-029")).toBeVisible();
  await page.locator('[data-control="reference-picker"]').click();
  await expect(page.getByRole("dialog")).toContainText("Choose Customer ID");
  await auditable(page, "SCR-029");
  expect(await clipped(page)).toEqual([]);
  expect(network.unexpected).toEqual([]);
});
