/**
 * GATE-F04 — the ROADMAP F04 demo script, verbatim, executable
 * (formulas-queries-charts SESSION-08 CP4).
 *
 * > open imported app → formulas recalc live on edit → filter + sort +
 * > relationship traversal → open imported chart → tap a mark → filtered
 * > records → build a new chart → pin it → edit schema (add column with rule)
 * > → change app theme → contrast holds.
 *
 * At 320px (the smallest declared width), under the no-network fixture,
 * through the real entry and the production workers, on the demo workbook
 * (`fixtures/workbook.ts`). The build served is the one built from this
 * revision (D15). The demo carries no unsupported formula (all six are live),
 * so MOD-015 is proven on `formulas-live.xlsx`'s imported "Rate" (OFFSET) in
 * a second test in this file.
 *
 * "Add a column" is a live calculation column: F04 has no surface for adding
 * an authored field, and the rule the script asks for is a rule across two
 * existing fields that a save then breaks.
 *
 * Intentionally absent at GATE-F04 (asserted elsewhere or named in the
 * handoff): adaptive budgets and the capacity door (F07), durable homes and the
 * backup reminder on edits (F05), chart export (F07), re-upload (F06), a
 * non-OOXML chart rebuild (named gap D55), and live formulas for F03-era apps
 * (D50).
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { auditable, clipped } from "./fixtures/a11y.js";
import { COMPACT_VIEWPORT, deleteLocalStore, followHash, openApp, protectDevice, screen } from "./fixtures/app.js";
import { expect, test } from "./fixtures/no-network.js";
import { applyImpact } from "./fixtures/structure.js";
import { WORKBOOK_TIMEOUT_MS, chooseFile, importDemoWorkbook, openUpload } from "./fixtures/workbook.js";

const headRevision = execSync("git rev-parse HEAD").toString().trim();
const FORMULAS_LIVE = resolve(process.cwd(), "tests/fixtures/workbooks/ooxml/formulas-live.xlsx");

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

// A step that cannot happen fails in seconds, not at the test's timeout.
test.use({ actionTimeout: 20_000 });

/**
 * A React Aria select, chosen by its label, from the keyboard: focus the
 * trigger, open its list with the arrow key, take the option. (At 320px the
 * builder's Measure list did not open to a pointer click after a Group by
 * change in this journey; the keyboard path reaches it, as the accessibility
 * contract requires. Reported to the chart builder's owner.)
 */
async function choose(page: Page, label: string, option: string): Promise<void> {
  const trigger = page.getByRole("button", { name: new RegExp(`${label}$`, "u") });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
  await expect(trigger).toContainText(option);
}

/** A metric tile's value on the app home, by its label. */
async function metric(page: Page, label: string): Promise<string> {
  return (await screen(page, "SCR-024").locator("[data-metric]").filter({ hasText: label }).first().textContent()) ?? "";
}

/** A query chip's sheet, opened by the chip's name. */
async function openChip(page: Page, name: string): Promise<void> {
  await page.getByRole("list", { name: "Sort and filters" }).getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function applySheet(page: Page, name: "Apply filter" | "Apply sort"): Promise<void> {
  await page.getByRole("dialog").getByRole("button", { name }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function openJob(page: Page, appHash: string, job: string): Promise<void> {
  await followHash(page, appHash);
  await page.getByRole("link", { name: "Jobs", exact: true }).first().click();
  await expect(screen(page, "SCR-025")).toBeVisible();
  await page.getByLabel("Search Jobs", { exact: true }).fill(job);
  await page.getByRole("link", { name: job, exact: true }).click();
  await expect(screen(page, "SCR-027")).toBeVisible();
}

test("GATE-F04: the F04 demo script, end to end at 320px, offline", async ({ page, network }, testInfo) => {
  test.setTimeout(600_000);
  await page.setViewportSize(COMPACT_VIEWPORT);
  await openApp(page);
  expect(await page.evaluate(() => window.__sheafBuildId)).toBe(headRevision);
  testInfo.annotations.push({ type: "sheafBuildId", description: headRevision });
  await protectDevice(page);

  // 1. Import the demo workbook → create → open the imported app.
  const appHash = await importDemoWorkbook(page);
  const home = screen(page, "SCR-024");
  await expect(home.locator("[data-metric]")).toHaveCount(4);
  await expect(home.locator("[data-pinned-chart]")).toContainText("Quoted by status");
  const quotedTotal = await metric(page, "Quoted total");

  // 2. Formulas recalc live on edit: J-1001's Balance, then the home's totals.
  await openJob(page, appHash, "J-1001");
  const detail = screen(page, "SCR-027");
  const balance = detail.locator('[data-computed="ok"]').filter({ hasText: "$" });
  await expect(balance).toContainText("$287.25");
  await page.getByRole("link", { name: "Edit this record" }).click();
  await expect(screen(page, "SCR-029")).toBeVisible();
  await page.getByLabel("Quoted amount", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(detail).toContainText("Saved on this device.");
  await expect(balance).toContainText("$500.00");
  await followHash(page, appHash);
  await expect(home).toBeVisible();
  await expect.poll(() => metric(page, "Quoted total")).not.toBe(quotedTotal);
  await page.screenshot({ path: testInfo.outputPath("gate-1-2-home-recalculated.png"), fullPage: true });

  // 3. Filter + sort + relationship traversal.
  await page.getByRole("link", { name: "Jobs", exact: true }).first().click();
  const list = screen(page, "SCR-025");
  await expect(list).toBeVisible();
  await openChip(page, "Status");
  await page.getByRole("dialog").getByText("In progress", { exact: true }).click();
  await applySheet(page, "Apply filter");
  await openChip(page, "Sort");
  await page.getByRole("dialog").getByRole("button", { name: "Ascending" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Due date", exact: true }).click();
  await applySheet(page, "Apply sort");
  await expect(page.locator("[data-match-count]")).toHaveText("15 records match · sorted by due date, ascending.");
  await expect(page.getByRole("list", { name: "Sort and filters" })).toContainText("Status: In progress");
  expect(await clipped(page)).toEqual([]);
  await auditable(page, "SCR-025");

  await openJob(page, appHash, "J-1001");
  const belongsTo = page.locator("[data-belongs-to]");
  await expect(belongsTo).toContainText("Harbor View Inn");
  await belongsTo.getByRole("link", { name: "Open in Customers →" }).click();
  const theirJobs = page.locator("[data-has-many]");
  await expect(theirJobs).toContainText("in Jobs");
  await theirJobs.getByRole("link", { name: "J-1001", exact: true }).click();
  await expect(page.locator("[data-belongs-to]")).toContainText("Harbor View Inn");

  // 4. Open the imported chart → tap a mark → the filtered records.
  await followHash(page, appHash);
  const imported = home.locator("[data-pinned-chart]").filter({ hasText: "Quoted by status" });
  await imported.getByRole("button", { name: /^Filter by In progress, /u }).click();
  await expect(screen(page, "SCR-025")).toBeVisible();
  await expect(page.locator("[data-match-count]")).toHaveText("15 records match.");
  await expect(page.locator("[data-record]")).toHaveCount(15);

  // 5. Build a new chart → pin it; the home shows both.
  await followHash(page, `${appHash}/charts/new`);
  await expect(screen(page, "SCR-034")).toBeVisible();
  await choose(page, "Group by", "Status");
  await choose(page, "Measure", "Sum of paid");
  await page.getByLabel("Chart name", { exact: true }).fill("Paid by status");
  await page.getByRole("button", { name: "Save & pin" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save chart" }).click();
  await expect(screen(page, "SCR-033")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Paid by status");
  await followHash(page, appHash);
  await expect(home.locator("[data-pinned-chart]")).toHaveCount(2);
  await expect(home.locator("[data-pinned-chart]").filter({ hasText: "Paid by status" })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("gate-5-home-two-charts.png"), fullPage: true });

  // 6. Edit schema: add a column, and a rule a save then breaks.
  await home.getByRole("link", { name: "Edit structure" }).click();
  const structure = screen(page, "SCR-035");
  await expect(structure).toBeVisible();
  await structure.locator("[data-structure-table]").filter({ hasText: /^Jobs/u }).click();
  await structure.getByRole("button", { name: "Add a live calculation" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Column name", { exact: true }).fill("Deposit");
  await editor.getByLabel("Calculation", { exact: true }).fill("[Quoted amount]*0.25");
  await editor.getByRole("button", { name: "Preview impact" }).click();
  await applyImpact(page, []);
  await expect(structure.locator("[data-structure-field]").filter({ hasText: /^Deposit/u })).toHaveText("DepositLive");

  await structure.getByRole("button", { name: "Add rule" }).click();
  const rule = page.getByRole("dialog");
  await choose(page, "Field to check", "Paid");
  await choose(page, "Must be", "is at most");
  await choose(page, "Other field", "Quoted amount");
  await expect(rule.locator("[data-rule-sentence]")).toHaveText("Paid is at most Quoted amount");
  await rule.getByRole("button", { name: "Preview impact" }).click();
  await applyImpact(page, []);
  await expect(structure.locator('[data-section="rules"]')).toContainText("Paid is at most Quoted amount");

  await openJob(page, appHash, "J-1001");
  await expect(screen(page, "SCR-027")).toContainText("Deposit");
  await page.getByRole("link", { name: "Edit this record" }).click();
  await page.getByLabel("Paid", { exact: true }).fill("600");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(screen(page, "SCR-029")).toBeVisible();
  await expect(screen(page, "SCR-029")).toContainText(/Paid must be at most Quoted amount/u);
  await page.screenshot({ path: testInfo.outputPath("gate-6-rule-refused.png"), fullPage: true });

  // 7. Change the app theme → contrast holds.
  await followHash(page, `${appHash}/settings`);
  await screen(page, "SCR-037").getByRole("link", { name: "Theme & logo" }).click();
  const theme = screen(page, "SCR-036");
  await expect(theme).toBeVisible();
  await theme.getByText("Clay", { exact: true }).click();
  await theme.getByText("Dark", { exact: true }).click();
  await expect(theme).toContainText("Contrast passes");
  await auditable(page, "SCR-036");
  await page.getByRole("button", { name: "Save theme locally" }).click();
  await expect(screen(page, "SCR-037")).toContainText("Clay · dark · comfortable");
  await auditable(page, "SCR-037");
  await followHash(page, appHash);
  await expect(page.locator("[data-app-mode]").first()).toHaveAttribute("data-app-mode", "dark");
  await auditable(page, "SCR-024");
  await page.screenshot({ path: testInfo.outputPath("gate-7-home-clay-dark.png"), fullPage: true });

  expect(network.unexpected).toEqual([]);
});

test("GATE-F04: MOD-015 rewrites an imported unsupported formula through the real entry", async ({ page, network }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(COMPACT_VIEWPORT);
  await openApp(page);
  await protectDevice(page);

  await openUpload(page);
  await chooseFile(page, FORMULAS_LIVE);
  await expect(screen(page, "SCR-018")).toBeVisible({ timeout: WORKBOOK_TIMEOUT_MS });
  await page.getByRole("button", { name: /^Import \d+ selected sheets?$/u }).click();
  await expect(screen(page, "SCR-023")).toBeVisible({ timeout: WORKBOOK_TIMEOUT_MS });
  await page.getByRole("button", { name: /^Create /u }).click();
  await expect(screen(page, "SCR-024")).toBeVisible({ timeout: WORKBOOK_TIMEOUT_MS });

  await screen(page, "SCR-024").getByRole("link", { name: "Edit structure" }).click();
  const structure = screen(page, "SCR-035");
  await expect(structure).toBeVisible();
  await structure.locator("[data-structure-table]").filter({ hasText: /^Jobs/u }).click();
  await structure.getByRole("button", { name: "Rewrite Rate" }).click();

  const rewrite = page.locator('[data-dialog="MOD-015"]');
  await expect(rewrite).toBeVisible();
  await expect(rewrite).toContainText("OFFSET(B2,0,0)");
  await expect(rewrite).toContainText("Each imported record keeps the value the workbook held. Nothing is recalculated over it.");
  await expect(rewrite).toContainText("A record added here stays empty and flagged, because Sheaf cannot calculate this formula.");
  await auditable(page, "SCR-035");
  await page.getByLabel("Rewrite in Sheaf's syntax", { exact: true }).fill("[Quoted]");
  await page.getByRole("dialog").getByRole("button", { name: "Preview impact" }).click();
  await applyImpact(page, []);
  await expect(structure.locator("[data-structure-field]").filter({ hasText: /^Rate/u })).toHaveText("RateLive");

  expect(network.unexpected).toEqual([]);
});
