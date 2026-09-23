/**
 * GATE-F03 — the ROADMAP F03 demo script, verbatim, executable
 * (workbook-fidelity SESSION-08 CP4).
 *
 * > import a multi-sheet .xlsx with relationships, formats, validations →
 * > sheet selection → review evidence ledger → reject a proposed relationship
 * > → create → navigate related records → view snapshot of a non-tabular
 * > sheet → macro workbook → whole-import refusal → oversized workbook →
 * > desktop-handoff instructions. Formulas/charts appear preserved with
 * > provenance (live in F04).
 *
 * At 320px (the smallest declared width), under the no-network fixture, through
 * the real entry and the production workers. The selection leaves Archive 2018
 * out — the prescribed demo path (SESSION-08, ROADMAP).
 *
 * The "intentionally absent" facts are asserted, not merely unmentioned:
 * formulas read as preserved-not-live, the chart as a preserved inert item
 * that becomes live in a later release, and the handoff card says exactly its
 * approved conditional copy and nothing more (D31: the budget is not yet
 * device-sensitive, so no larger device is promised a larger budget).
 */

import { buildOversizedWorkbook } from "../fixtures/workbooks/build/oversized.js";
import { auditable } from "./fixtures/a11y.js";
import {
  COMPACT_VIEWPORT,
  deleteLocalStore,
  openApp,
  protectDevice,
  screen,
} from "./fixtures/app.js";
import { expect, test } from "./fixtures/no-network.js";
import { openRecord, openTable } from "./fixtures/records.js";
import {
  DEMO_XLSX,
  MACRO_WORKBOOK,
  VISITS_TO_JOBS,
  WORKBOOK_TIMEOUT_MS,
  chooseFile,
  openUpload,
  rejectConnection,
  toggleSheet,
} from "./fixtures/workbook.js";

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

test("GATE-F03: the F03 demo script, end to end at 320px, offline", async ({ page, network }) => {
  test.setTimeout(420_000);
  await page.setViewportSize(COMPACT_VIEWPORT);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await openApp(page);
  await protectDevice(page);

  // 1. Import a multi-sheet .xlsx with relationships, formats, validations.
  await openUpload(page);
  await chooseFile(page, DEMO_XLSX);

  // 2. Sheet selection — sized from metadata; Archive 2018 left out.
  const preflight = screen(page, "SCR-018");
  await expect(preflight).toBeVisible({ timeout: WORKBOOK_TIMEOUT_MS });
  await expect(preflight).toContainText("This workbook fits this device.");
  await expect(preflight).toContainText("7 of 7 selected");
  await toggleSheet(page, "Archive 2018");
  await expect(preflight).toContainText("6 of 7 selected");
  await page.getByRole("button", { name: "Import 6 selected sheets" }).click();

  // 3. Review the evidence ledger: every statement carries its evidence.
  const review = screen(page, "SCR-023");
  await expect(review).toBeVisible({ timeout: WORKBOOK_TIMEOUT_MS });
  await expect(review).toContainText("Workbook declared table");
  await expect(review).toContainText("Excel validation rule");
  await expect(review).toContainText("Your VLOOKUP formula");
  await expect(review).toContainText("Each record in “Jobs” belongs to one record in “Customers”.");
  // Intentionally absent: live formulas (F04) — preserved, with provenance.
  await expect(review).toContainText("Formulas are preserved, not live yet");
  await expect(review).toContainText("Original formula preserved");
  await expect(review).toContainText("“Overview” is kept as a snapshot");
  await auditable(page, "SCR-023");

  // 4. Reject a proposed relationship (Visits → Jobs).
  await rejectConnection(page, VISITS_TO_JOBS);
  await expect(review.locator(`[data-connection="${VISITS_TO_JOBS}"]`)).toContainText("You rejected this");

  // 5. Create.
  await page.getByRole("button", { name: "Create Fieldwork Q3" }).click();
  const home = screen(page, "SCR-024");
  await expect(home).toBeVisible({ timeout: WORKBOOK_TIMEOUT_MS });
  const appHash = new URL(page.url()).hash;

  // 6. Navigate related records: a job → its customer → back to the job.
  await openTable(page, "Jobs");
  await openRecord(page, "Jobs", "J-1001");
  await expect(page.locator("[data-belongs-to]")).toContainText("Harbor View Inn");
  await page.locator("[data-belongs-to]").getByRole("link", { name: "Open in Customers →" }).click();
  await expect(page.locator("[data-has-many]")).toContainText("in Jobs");
  await page.locator("[data-has-many]").getByRole("link", { name: "J-1001", exact: true }).click();
  await expect(page.locator("[data-belongs-to]")).toContainText("Harbor View Inn");
  // The rejected connection made no relationship: a job has no “has many” visits.
  await expect(page.locator("[data-has-many]")).toHaveCount(0);
  await auditable(page, "SCR-027");

  // 7. View the snapshot of a non-tabular sheet (Overview).
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `${appHash}/snapshots`);
  const overviewRow = screen(page, "SCR-030").locator("[data-sheet-row]").filter({ hasText: "Overview" });
  await expect(overviewRow).toContainText("Read-only snapshot");
  await overviewRow.getByRole("link").click();
  const snapshot = screen(page, "SCR-031");
  await expect(snapshot).toContainText("Overview · read only");
  await expect(snapshot.locator("table")).toContainText("Quoted total");
  // Intentionally absent: live charts (F04) — preserved as an inert item.
  await expect(snapshot.locator('[data-inert-marker="chart"]')).toContainText("Chart preserved");
  await expect(snapshot.locator('[data-inert="chart"]')).toContainText(
    "Kept as a snapshot; rebuilt as a live chart in a later release.",
  );
  await expect(snapshot.locator('[data-inert="formula"]')).toContainText(
    "Imported results are kept as values. The formula is preserved and is not recalculated yet.",
  );
  await auditable(page, "SCR-031");

  // 8–9. A macro workbook → the whole import is refused.
  await page.evaluate(() => {
    window.location.hash = "#/library";
  });
  await expect(screen(page, "SCR-010")).toBeVisible();
  await openUpload(page);
  await chooseFile(page, MACRO_WORKBOOK);
  await expect(screen(page, "SCR-021")).toBeVisible({ timeout: WORKBOOK_TIMEOUT_MS });
  const macro = page.getByRole("dialog");
  await expect(macro).toContainText("“payroll.xlsm” contains macros");
  await expect(macro).toContainText("Sheaf never runs or strips macros, so no app was created.");
  await macro.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Return to library" }).click();
  await expect(screen(page, "SCR-010")).toContainText("1 app is on this device.");

  // 10–11. An oversized workbook → the desktop-handoff instructions.
  await openUpload(page);
  await chooseFile(page, {
    name: "archive-only.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(buildOversizedWorkbook()),
  });
  const handoff = screen(page, "SCR-019");
  await expect(handoff).toBeVisible({ timeout: WORKBOOK_TIMEOUT_MS });
  await expect(handoff).toContainText("This workbook is too large for this device.");
  // D31: the card says its approved conditional copy and claims nothing more.
  const card = page.locator('section[aria-labelledby="handoff"]');
  await expect(card).toHaveText(
    "Use a larger deviceImport everything on desktop.No work is transferred automatically. Open this same source file in Sheaf on a device with a larger local budget.Copy handoff instructions",
  );
  await page.getByRole("button", { name: "Copy handoff instructions" }).click();
  await expect(handoff).toContainText("Handoff instructions copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Import everything on desktop: “archive-only.xlsx”.");
  expect(copied).toContain("Desktop solves importing only.");
  await auditable(page, "SCR-019");

  expect(network.unexpected).toEqual([]);
});
