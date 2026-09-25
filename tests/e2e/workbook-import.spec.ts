import { dismissExpectedScratchReminder } from "./fixtures/durability.js";
/**
 * CAP-19, CAP-20, CAP-21, CAP-22 and CAP-23's create-lands-on-home leg,
 * through the real entry (workbook-fidelity SESSION-07 CP4).
 *
 * `index.html` → `src/main.tsx` → `startApp()` → the production data worker →
 * the production import worker (page declares both flows, D48) → a
 * page-created `MessageChannel` → real staging and promotion in real
 * IndexedDB. No harness, no double, no stubbed response; every journey runs
 * under the no-network fixture, and the only thing supplied is the file a
 * person would have picked.
 *
 * Over-budget workbooks are generated at test time with S01's
 * `build/oversized.ts` and handed to the file input in memory, so nothing is
 * written into `tests/fixtures/` (another session's corpus) or anywhere else.
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import {
  buildOversizedWorkbook,
  buildSubsetWorkbook,
} from "../fixtures/workbooks/build/oversized.js";
import { buildOoxml, type RowSpec } from "../fixtures/workbooks/build/ooxml-builder.js";
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
import {
  DEMO_XLSX,
  MACRO_WORKBOOK,
  WORKBOOK_TIMEOUT_MS as PARSE_TIMEOUT_MS,
  chooseFile as choose,
  openUpload,
  toggleSheet,
} from "./fixtures/workbook.js";

const CORPUS = resolve(process.cwd(), "tests/fixtures/workbooks");
const ZIP_BOMB = resolve(CORPUS, "unsafe/zip-bomb.xlsx");
const headRevision = execSync("git rev-parse HEAD").toString().trim();

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

/**
 * Records every name the import's progress region had, so a stream that
 * finishes in a blink still leaves the sheets it named behind.
 */
async function recordProgressNames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __progressNames: string[] }).__progressNames = seen;
    const note = (): void => {
      for (const bar of document.querySelectorAll('[role="progressbar"]')) {
        const name = bar.getAttribute("aria-label");
        if (name !== null && !seen.includes(name)) seen.push(name);
      }
    };
    new MutationObserver(note).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-label"],
    });
  });
}

async function progressNames(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => (window as unknown as { __progressNames: string[] }).__progressNames);
}

function expectNoEgress(network: { readonly unexpected: readonly string[] }): void {
  expect(network.unexpected).toEqual([]);
}

test("the demo workbook becomes a multi-table app that survives a reload", async ({ page, network }) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  await openUpload(page);
  await choose(page, DEMO_XLSX);

  // --- CAP-19: SCR-018, sized from metadata, 7 sheets, fits ---------------
  const preflight = screen(page, "SCR-018");
  await expect(preflight).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await expect(preflight).toContainText("This workbook fits this device.");
  await expect(preflight).toContainText("7 of 7 selected");
  for (const sheet of ["Jobs", "Customers", "Crew", "Visits", "Materials", "Overview", "Archive 2018"]) {
    await expect(page.getByRole("checkbox", { name: new RegExp(`^${sheet}\\b`, "u") })).toBeChecked();
  }
  await expect(preflight).toContainText("Declared table · about");
  await expect(preflight).toContainText("Dashboard");
  await expect(preflight).toContainText("2 drawing objects may remain read-only");
  await auditable(page, "SCR-018");

  // --- D39: leave Archive 2018 out ------------------------------------------
  await toggleSheet(page, "Archive 2018");
  await expect(preflight).toContainText("6 of 7 selected");
  await expect(preflight).toContainText("preserved if selected");

  // --- CAP-21: the stream names the sheet it is reading ---------------------
  await recordProgressNames(page);
  await page.getByRole("button", { name: "Import 6 selected sheets" }).click();

  const review = screen(page, "SCR-023");
  await expect(review).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  const named = await progressNames(page);
  expect(named.some((name) => / · Sheet \d of 6: (Jobs|Customers|Crew|Visits|Materials|Overview)$/u.test(name))).toBe(true);

  // --- CAP-22: the one review, every section present ------------------------
  for (const id of ["tables-and-rows", "fields-and-choices", "connections", "live-calculations", "sheets-and-snapshots"]) {
    await expect(review.locator(`[data-section="${id}"]`)).toBeVisible();
  }
  await expect(review).toContainText("Each record in “Jobs” belongs to one record in “Customers”.");
  await expect(review).toContainText("Your VLOOKUP formula");
  // F04: formulas/chart now live (CAP-38, CAP-34).
  await expect(review).toContainText("6 formulas keep working");
  await expect(review).toContainText("Live computed value");
  await expect(review).toContainText("“Archive 2018” is excluded by your choice");
  await expect(review).toContainText("“Overview” becomes your app dashboard");
  await auditable(page, "SCR-023");

  // --- CAP-22: reject the Visits → Jobs connection --------------------------
  await review
    .locator('[data-connection="rel:s3.t0.c1"]')
    .getByRole("button", { name: "Change connection" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /This connection/u }).click();
  await page.getByRole("option", { name: "Do not connect these lists" }).click();
  await dialog.getByRole("button", { name: "Save change" }).click();
  const visits = review.locator('[data-connection="rel:s3.t0.c1"]');
  await expect(visits).toHaveAttribute("data-applied", "false", { timeout: PARSE_TIMEOUT_MS });
  await expect(visits).toContainText("You chose not to connect “Visits” to “Jobs”.");
  await expect(visits).toContainText("You rejected this");

  // --- CAP-23: Create lands on the new app's home ---------------------------
  await page.getByRole("button", { name: "Create Fieldwork Q3" }).click();
  const home = screen(page, "SCR-024");
  await expect(home).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  expect(page.url()).toContain("#/app/");
  const appHash = new URL(page.url()).hash;
  for (const table of ["Jobs", "Customers", "Crew", "Visits", "Materials"]) {
    await expect(home).toContainText(table);
  }
  await expect(home).not.toContainText("Archive 2018");

  // --- it survives a reload, which is a lock and a fresh worker -------------
  await openApp(page);
  await attemptUnlock(page, PASSPHRASE);
  await expect(screen(page, "SCR-010")).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
  await expect(screen(page, "SCR-010")).toContainText("Fieldwork Q3");
  await followHash(page, appHash);
  await expect(screen(page, "SCR-024")).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
  for (const table of ["Jobs", "Customers", "Crew", "Visits", "Materials"]) {
    await expect(screen(page, "SCR-024")).toContainText(table);
  }

  expectNoEgress(network);
});

test("CAP-38/CAP-34/CAP-29: the demo's formulas and chart are live — reviewed once, on the home, recalculating, and filtering", async ({
  page,
  network,
}, testInfo) => {
  test.setTimeout(300_000);

  await openApp(page);
  // The page is the one built from this revision (the webServer's freshness check).
  expect(await page.evaluate(() => window.__sheafBuildId)).toBe(headRevision);
  testInfo.annotations.push({ type: "sheafBuildId", description: headRevision });
  await protectDevice(page);
  await openUpload(page);
  await choose(page, DEMO_XLSX);
  await expect(screen(page, "SCR-018")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await toggleSheet(page, "Archive 2018");
  await page.getByRole("button", { name: "Import 6 selected sheets" }).click();

  // --- the one review: Live calculations, the rebuilt chart (SCR-023) -------
  const review = screen(page, "SCR-023");
  await expect(review).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  const calculations = review.locator('[data-section="live-calculations"]');
  await expect(calculations).toContainText("6 formulas keep working");
  await expect(review.locator('[data-calculation="s0.t0.c6"]')).toContainText("“Balance” is a live calculation.");
  await expect(review.locator('[data-calculation="s0.t0.c6"]')).toContainText("Live computed value");
  await expect(review.locator('[data-calculation="s5.R3C2"]')).toContainText("“Open jobs” is a live summary value.");
  const sheets = review.locator('[data-section="sheets-and-snapshots"]');
  await expect(sheets).toContainText("1 chart and 4 summary values rebuilt");
  await expect(sheets).toContainText("“Quoted by status” is rebuilt as a live chart from “Jobs”, pinned to the app's home.");
  await page.screenshot({ path: testInfo.outputPath("scr-023-live-calculations.png"), fullPage: true });
  await auditable(page, "SCR-023");
  await page.getByRole("button", { name: "Create Fieldwork Q3" }).click();

  // --- SCR-024: the dashboard values, and the Overview chart pinned (D65) ---
  const home = screen(page, "SCR-024");
  await expect(home).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  const appHash = new URL(page.url()).hash;
  await expect(home).toContainText("At a glance");
  for (const label of ["Open jobs", "Quoted total", "Paid total", "Balance"]) await expect(home).toContainText(label);
  await expect(home.locator("[data-metric]")).toHaveCount(4);
  await expect(home.locator('[data-metric][data-status="ok"]')).toHaveCount(4);
  const pinned = home.locator("[data-pinned-chart]");
  await expect(pinned).toContainText("Quoted by status");
  await page.screenshot({ path: testInfo.outputPath("scr-024-imported.png"), fullPage: true });
  await auditable(page, "SCR-024");

  // --- a mark of the rebuilt chart → exactly the In-progress jobs ---------
  await pinned.getByRole("button", { name: /^Filter by In progress, /u }).click();
  await expect(screen(page, "SCR-025")).toBeVisible();
  await expect(page.locator("[data-match-count]")).toHaveText("15 records match.");
  await expect(page.locator("[data-record]")).toHaveCount(15);

  // --- a record's Balance is live; editing Quoted recalculates it -----------
  await followHash(page, appHash);
  await page.getByRole("link", { name: "Jobs", exact: true }).first().click();
  await expect(screen(page, "SCR-025")).toBeVisible();
  await page.getByLabel("Search Jobs", { exact: true }).fill("J-1001");
  await page.getByRole("link", { name: "J-1001", exact: true }).click();
  const detail = screen(page, "SCR-027");
  await expect(detail).toBeVisible();
  const balance = detail.locator('[data-computed="ok"]').filter({ hasText: "$" });
  await expect(balance).toContainText("$287.25");
  await expect(balance).toContainText("Read-only");
  const recordHash = new URL(page.url()).hash;
  await page.getByRole("link", { name: "Edit this record" }).click();
  await expect(screen(page, "SCR-029")).toBeVisible();
  await page.getByLabel("Quoted amount", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(detail).toContainText("Saved on this device.");
  await dismissExpectedScratchReminder(page);
  await expect(detail.locator('[data-computed="ok"]').filter({ hasText: "$" })).toContainText("$500.00");

  // --- reload + unlock: recomputed from the roots, the edit kept ------------
  await openApp(page);
  await attemptUnlock(page, PASSPHRASE);
  await expect(screen(page, "SCR-010")).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
  await followHash(page, recordHash);
  await expect(screen(page, "SCR-027").locator('[data-computed="ok"]').filter({ hasText: "$" })).toContainText("$500.00", {
    timeout: DERIVE_TIMEOUT_MS,
  });
  await followHash(page, appHash);
  await expect(screen(page, "SCR-024").locator("[data-pinned-chart]")).toContainText("Quoted by status");
  await expect(screen(page, "SCR-024").locator("[data-metric]")).toHaveCount(4);
  expectNoEgress(network);
});

test("an oversized workbook offers the desktop handoff, and copying is announced", async ({ page, network }) => {
  test.setTimeout(300_000);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await openApp(page);
  await protectDevice(page);
  await openUpload(page);
  await choose(page, {
    name: "archive-only.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(buildOversizedWorkbook()),
  });

  // --- CAP-20: no single sheet fits → the handoff alone ---------------------
  const handoff = screen(page, "SCR-019");
  await expect(handoff).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await expect(handoff).toContainText("This workbook is too large for this device.");
  await expect(handoff).toContainText("Import everything on desktop.");
  await expect(handoff).not.toContainText("Stream plan");
  await auditable(page, "SCR-019");

  await page.getByRole("button", { name: "Copy handoff instructions" }).click();
  await expect(handoff).toContainText("Handoff instructions copied");
  await expect(page.getByText("The handoff instructions were copied.")).toBeAttached();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Import everything on desktop: “archive-only.xlsx”.");
  expect(copied).toContain("Desktop solves importing only.");

  // Nothing was staged: the library is still empty.
  await followHash(page, "#/library");
  await expect(screen(page, "SCR-011")).toBeVisible();
  expectNoEgress(network);
});

test("an oversized workbook with a fitting subset imports the subset", async ({ page, network }) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  await openUpload(page);
  await choose(page, {
    name: "weekly-and-archive.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(buildSubsetWorkbook()),
  });

  const subset = screen(page, "SCR-019");
  await expect(subset).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await expect(subset).toContainText("Choose a smaller scope");
  await expect(subset).toContainText("1 of 3 selected");

  // Adding the one sheet that does not fit is a reason, not a start.
  await toggleSheet(page, "Archive");
  await expect(subset).toContainText("Selected scope is still too large");
  await expect(page.getByRole("button", { name: "Import 2 selected sheets" })).toBeDisabled();
  await toggleSheet(page, "Archive");

  await toggleSheet(page, "Crew");
  await expect(subset).toContainText("Selected scope fits");
  await page.getByRole("button", { name: "Import 2 selected sheets" }).click();

  await expect(screen(page, "SCR-023")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await expect(screen(page, "SCR-023")).toContainText("“Archive” is excluded by your choice");
  await page.getByRole("button", { name: /^Create / }).click();
  await expect(screen(page, "SCR-024")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await expect(screen(page, "SCR-024")).toContainText("This week");
  await expect(screen(page, "SCR-024")).toContainText("Crew");
  expectNoEgress(network);
});

test("a macro workbook and an unsafe container are refused whole, by name", async ({ page, network }) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);

  // --- CAP-19: MOD-005 + SCR-021 macro variant ------------------------------
  await openUpload(page);
  await choose(page, MACRO_WORKBOOK);
  await expect(screen(page, "SCR-021")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  const notice = page.getByRole("dialog");
  await expect(notice).toContainText("“payroll.xlsm” contains macros");
  await expect(notice).toContainText("Sheaf never runs or strips macros, so no app was created.");
  await auditable(page, "SCR-021");
  await notice.getByRole("button", { name: "Close" }).click();
  await expect(screen(page, "SCR-021")).toContainText("Macro-enabled workbook");
  await page.getByRole("button", { name: "Return to library" }).click();
  await expect(screen(page, "SCR-011")).toBeVisible();

  // --- D42/D43: an unsafe container names its reason ------------------------
  await openUpload(page);
  await choose(page, ZIP_BOMB);
  await expect(screen(page, "SCR-021")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await expect(screen(page, "SCR-021")).toContainText("Unsafe compression");
  await expect(screen(page, "SCR-021")).toContainText(
    "Part of the file expands to far more data than its stored size.",
  );
  await auditable(page, "SCR-021");
  await page.getByRole("button", { name: "Return to library" }).click();
  await expect(screen(page, "SCR-011")).toBeVisible();
  expectNoEgress(network);
});

/** Rows enough that a workbook parse can be interrupted, inside the budget. */
function cancellableWorkbook(): Buffer {
  const rows: RowSpec[] = [["Visit", "Crew", "Hours", "Rate", "Total"]];
  for (let row = 1; row < 45_000; row += 1) rows.push([row, row % 7, (row % 9) + 0.5, 40 + (row % 5), row * 3]);
  return Buffer.from(buildOoxml({ method: "stored", sheets: [{ name: "Visits", rows }] }));
}

test("cancelling a workbook mid-stream leaves no partial app (STA-019)", async ({ page, network }) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  await openUpload(page);
  await choose(page, {
    name: "long-visits.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: cancellableWorkbook(),
  });
  await expect(screen(page, "SCR-018")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await page.getByRole("button", { name: "Import 1 selected sheet" }).click();

  const progress = screen(page, "SCR-020");
  await expect(progress).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await expect(progress).toContainText("Sheet 1 of 1");
  await auditable(page, "SCR-020");
  await page.getByRole("button", { name: "Cancel import…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel import", exact: true }).click();

  const ended = screen(page, "SCR-022");
  await expect(ended).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await expect(ended).toContainText("You cancelled the import.");
  await expect(ended).toContainText("No partial app remains.");
  await expect(ended).toContainText(/staged items? (was|were) removed/u);
  await page.getByRole("button", { name: "Return to library" }).click();
  await expect(screen(page, "SCR-011")).toBeVisible();
  expectNoEgress(network);
});

test("a sheet that fails mid-stream names its stage, sheet and diagnostic (SCR-022, MOD-008)", async ({ page, network }) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  await openUpload(page);
  // S05's hostile ODS: its metadata sizes fine, and its cells hit a bound.
  await choose(page, resolve(CORPUS, "ods/hostile-repeat.ods"));
  await expect(screen(page, "SCR-018")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await page.getByRole("button", { name: /^Import \d+ selected sheets?$/u }).click();

  // The bound is hit before the first sheet opens, so the worker names no
  // sheet (`sheetOrdinal: null`, CA-24) and the surface names the file.
  const ended = screen(page, "SCR-022");
  await expect(ended).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await expect(ended).toContainText("hostile-repeat.ods could not be imported.");
  await expect(ended).toContainText("Part of the file expands to far more data than its stored size.");
  await expect(ended).toContainText("Cell stream");
  await expect(ended.locator("code")).toHaveText("expansion-limit");
  await expect(ended).toContainText("No partial app remains.");
  await auditable(page, "SCR-022");

  await page.getByRole("button", { name: "Details" }).click();
  const details = page.getByRole("dialog");
  await expect(details).toContainText("Failed stage");
  await expect(details).toContainText("Cell stream");
  await expect(details).toContainText("expansion-limit");
  await details.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Return to library" }).click();
  await expect(screen(page, "SCR-011")).toBeVisible();
  expectNoEgress(network);
});

for (const [label, fixture, contradiction] of [
  ["XLSB", "xlsb/fieldwork-jobs.xlsb", false],
  ["XLS", "biff/formulas.xls", false],
  ["ODS", "ods/fieldwork-jobs-customers.ods", false],
  ["HTML saved as XLS", "html-table/excel-export.xls", true],
] as const) {
  test(`smoke: ${label} imports into an app`, async ({ page, network }) => {
    test.setTimeout(300_000);

    await openApp(page);
    await protectDevice(page);
    await openUpload(page);
    await choose(page, resolve(CORPUS, fixture));

    const preflight = screen(page, "SCR-018");
    await expect(preflight).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
    if (contradiction) {
      // MOD-004: the name says .xls, the content is an HTML table.
      const mismatch = page.getByRole("dialog");
      await expect(mismatch).toContainText("Content/extension mismatch");
      await expect(mismatch).toContainText("HTML table saved as a spreadsheet");
      await mismatch.getByRole("button", { name: "Continue" }).click();
    }
    await page.getByRole("button", { name: /^Import \d+ selected sheets?$/u }).click();
    await expect(screen(page, "SCR-023")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
    await page.getByRole("button", { name: /^Create / }).click();
    await expect(screen(page, "SCR-024")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
    expect(page.url()).toContain("#/app/");
    await followHash(page, "#/library");
    await expect(screen(page, "SCR-010")).toContainText("1 app is on this device.");
    expectNoEgress(network);
  });
}

test("axe and 320px: the workbook surfaces", async ({ page, network }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(COMPACT_VIEWPORT);

  await openApp(page);
  await protectDevice(page);
  await openUpload(page);
  await auditable(page, "SCR-016");
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);

  await choose(page, DEMO_XLSX);
  await expect(screen(page, "SCR-018")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await auditable(page, "SCR-018");
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);

  await page.getByRole("button", { name: "Import 7 selected sheets" }).click();
  await expect(screen(page, "SCR-023")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await auditable(page, "SCR-023");
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);

  // A review in progress keeps the route on it; leaving is a cancel.
  await page.getByRole("button", { name: "Cancel import…" }).click();
  await expect(screen(page, "SCR-022")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await expect(screen(page, "SCR-022")).toContainText("No partial app remains.");
  await choose(page, {
    name: "weekly-and-archive.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(buildSubsetWorkbook()),
  });
  await expect(screen(page, "SCR-019")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await auditable(page, "SCR-019");
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);
  expectNoEgress(network);
});
