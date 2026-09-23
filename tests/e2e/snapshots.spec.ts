/**
 * CAP-25 through the real entry — workbook-fidelity SESSION-08 CP4, CA-22's
 * viewer proof and CA-07 amendment 3's routes.
 *
 * The snapshots were written by S06's promotion (`SheetSnapshotWriter`) and
 * are read here page by page through S03's RPCs (`listSheetSnapshots`,
 * `getSnapshotPage`, `findInSnapshot`, `listInertItems`), decrypted in the
 * data worker. Nothing is stubbed.
 *
 * The demo's sheets (`build-demo.ts`): Overview has summary formulas, one
 * chart (D2:K18) and two shapes (D20:F24, H20:J24) and no merge; Crew has
 * three title rows above its header and the one merged region (A1:D1); Jobs
 * has 61 rows, so a find for J-1055 lands on the second 50-row page.
 */

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
import { importDemoApp, openTable } from "./fixtures/records.js";
import { importDemoWorkbook } from "./fixtures/workbook.js";

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

const SHEETS = ["Jobs", "Customers", "Crew", "Visits", "Materials", "Overview"] as const;

test("every imported sheet is a readable snapshot, inert items and discarded rows included", async ({
  page,
  network,
}) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  const appHash = await importDemoWorkbook(page);

  // --- SCR-030 from the app home ---------------------------------------------
  await screen(page, "SCR-024").getByRole("link", { name: "Sheet snapshots" }).click();
  const list = screen(page, "SCR-030");
  await expect(list).toBeVisible();
  await expect(list.locator("[data-sheet-row]")).toHaveCount(SHEETS.length);
  for (const sheet of SHEETS) {
    await expect(list.locator("[data-sheet-row]").filter({ hasText: sheet })).toHaveCount(1);
  }
  // D39: an unselected sheet is not snapshotted.
  await expect(list).not.toContainText("Archive 2018");
  const overviewRow = list.locator("[data-sheet-row]").filter({ hasText: "Overview" });
  await expect(overviewRow).toContainText("Read-only snapshot");
  // F04: formulas/chart now live — the Overview chart is rebuilt, so it is not listed as preserved.
  await expect(overviewRow).not.toContainText("chart");
  await expect(overviewRow).toContainText("2 drawing objects");
  await expect(list.locator("[data-sheet-row]").filter({ hasText: "Jobs" })).toContainText("Interactive table");
  await auditable(page, "SCR-030");

  // --- SCR-031: Overview — cells, formula results, chart and drawings ------
  await overviewRow.getByRole("link").click();
  const viewer = screen(page, "SCR-031");
  await expect(viewer).toBeVisible();
  const grid = viewer.locator("table");
  await expect(grid).toContainText("Fieldwork Q3 overview");
  await expect(grid).toContainText("Open jobs");
  // F04: formulas/chart now live — the drawings stay inert; the chart and formulas are not.
  await expect(grid.locator('[data-inert-marker="chart"]')).toHaveCount(0);
  await expect(grid.locator('[data-inert-marker="drawing"]')).toHaveCount(2);
  await expect(viewer.locator('[data-inert="formula"]')).toHaveCount(0);
  await expect(viewer.locator('[data-inert="chart"]')).toHaveCount(0);
  await auditable(page, "SCR-031");

  // --- SHT-016: export is present, disabled, with its reason ---------------
  await page.getByRole("button", { name: "Snapshot options" }).click();
  const options = page.locator('[data-sheet="SHT-016"]');
  await expect(options.getByRole("button", { name: "Export sheet" })).toBeDisabled();
  await expect(options).toContainText("Export arrives in a later release.");
  await expect(options.getByRole("button", { name: "Return to app home" })).toBeVisible();
  await options.getByRole("button", { name: "Find in sheet" }).click();
  await expect(page.getByLabel("Find in sheet", { exact: true })).toBeFocused();

  // --- Crew: the merged title and the three title rows kept, marked --------
  await followHash(page, `${appHash}/snapshots`);
  await screen(page, "SCR-030").locator("[data-sheet-row]").filter({ hasText: "Crew" }).getByRole("link").click();
  await expect(screen(page, "SCR-031")).toContainText("Crew · read only");
  const merged = screen(page, "SCR-031").locator('td[data-merged="true"]');
  await expect(merged).toHaveAttribute("colspan", "4");
  await expect(merged).toHaveText("Cedar & Finch — Crew roster");
  const discarded = screen(page, "SCR-031").locator('tr[data-discarded="true"]');
  await expect(discarded.first()).toContainText("Not imported · above the header row");
  await expect(discarded.filter({ hasText: "Prepared by Operations" })).toHaveCount(1);

  // --- find crosses a page (Jobs has 61 rows; pages are 50) ----------------
  await followHash(page, `${appHash}/snapshots`);
  await screen(page, "SCR-030").locator("[data-sheet-row]").filter({ hasText: "Jobs" }).getByRole("link").click();
  const jobs = screen(page, "SCR-031");
  await expect(jobs.locator("caption")).toContainText("rows 1 to 50 of 61");
  await page.getByLabel("Find in sheet", { exact: true }).fill("J-1055");
  await page.getByRole("button", { name: "Find next" }).click();
  await expect(jobs.locator("[data-find]")).toHaveText("Found “J-1055” in A56.");
  await expect(jobs.locator("caption")).toContainText("rows 51 to 61 of 61");
  await expect(jobs.locator('td[aria-current="true"]')).toHaveText("J-1055");
  await page.getByRole("button", { name: "Find next" }).click();
  await expect(jobs.locator("[data-find]")).toHaveText("No more cells contain “J-1055” after row 56.");
  await page.getByRole("button", { name: "Earlier rows" }).click();
  await expect(jobs.locator("caption")).toContainText("rows 1 to 50 of 61");
  // A sheet the app made a table from returns to that table.
  await page.getByRole("link", { name: "Return to live Jobs" }).click();
  await expect(screen(page, "SCR-025")).toContainText("This table holds 60 records.");

  // --- CA-07 am. 3: an unknown sheet id is answered at the path -------------
  await followHash(page, `${appHash}/snapshots/not-a-sheet`);
  await expect(page.getByRole("heading", { name: "That sheet snapshot is not in this app." })).toBeVisible();
  expect(page.url()).toContain("/snapshots/not-a-sheet");
  await page.getByRole("button", { name: "All snapshots" }).click();
  await expect(screen(page, "SCR-030")).toBeVisible();

  expect(network.unexpected).toEqual([]);
});

test("the full seven-sheet selection creates, snapshots every sheet and survives a reload (CAP-23)", async ({
  page,
  network,
}) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  const appHash = await importDemoWorkbook(page, { allSheets: true });

  const expectFullApp = async (): Promise<void> => {
    await followHash(page, `${appHash}/snapshots`);
    const list = screen(page, "SCR-030");
    await expect(list.locator("[data-sheet-row]")).toHaveCount(SHEETS.length + 1, { timeout: DERIVE_TIMEOUT_MS });
    await expect(list.locator("[data-sheet-row]").filter({ hasText: "Archive 2018" })).toHaveCount(1);
    await followHash(page, appHash);
    await openTable(page, "Archive 2018");
    await expect(screen(page, "SCR-025")).toContainText("This table holds 2,000 records.");
  };

  await expectFullApp();
  // A reload is a lock and a fresh data worker; every sheet and row holds.
  await openApp(page);
  await attemptUnlock(page, PASSPHRASE);
  await expect(screen(page, "SCR-010")).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
  await expectFullApp();

  expect(network.unexpected).toEqual([]);
});

test("an F02 CSV app's snapshot opens with its discarded pre-header rows", async ({ page, network }) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  const { appHash } = await importDemoApp(page);
  await followHash(page, `${appHash}/snapshots`);
  const list = screen(page, "SCR-030");
  await expect(list.locator("[data-sheet-row]")).toHaveCount(1);
  await list.locator("[data-sheet-row]").getByRole("link").click();
  const viewer = screen(page, "SCR-031");
  await expect(viewer).toBeVisible();
  // The title and export lines above the header are there, where they were.
  await expect(viewer.locator("table tbody tr").first()).toContainText("Cedar & Finch Field Log");
  await expect(viewer.locator("table")).toContainText("Exported 2026-03-14");
  await expect(viewer.locator("table")).toContainText("Visit ID");
  expect(network.unexpected).toEqual([]);
});

test("axe and 320px: the snapshot surfaces", async ({ page, network }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(COMPACT_VIEWPORT);

  await openApp(page);
  await protectDevice(page);
  const appHash = await importDemoWorkbook(page);
  await followHash(page, `${appHash}/snapshots`);
  await auditable(page, "SCR-030");
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);

  await screen(page, "SCR-030").locator("[data-sheet-row]").filter({ hasText: "Overview" }).getByRole("link").click();
  await auditable(page, "SCR-031");
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);

  await page.getByRole("button", { name: "Snapshot options" }).click();
  await expect(page.locator('[data-sheet="SHT-016"]')).toBeVisible();
  await auditable(page, "SCR-031");
  expect(await clipped(page)).toEqual([]);
  expect(network.unexpected).toEqual([]);
});
