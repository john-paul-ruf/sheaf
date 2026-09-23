/**
 * CAP-31 through the real entry (S04 CP4; CA-29; FR-13).
 *
 * `index.html` → `src/main.tsx` → the production data worker → the real
 * SQLite projection, on an app imported through the UI from S03's demo CSV
 * (40 visits). Every query below is a person's: the search field, the chips,
 * the typed sheets, the sort sheet — nothing reaches past the surface.
 *
 * The journey, at 320px and at desktop width: search + an enum filter + a
 * date range + a sort → exactly the rows and the count that match, in order;
 * clear one filter → the rows widen; clear all → the search alone; a filter
 * that matches nothing → the filtered no-result state with the table's count
 * (STA-026), distinct from an empty table. Axe runs on each state, and no
 * request leaves the origin.
 *
 * **Partial pages are not fabricated here.** D53's budget is 50,000 candidate
 * rows; STA-014 is proven at the browser-projection tier with an injected
 * budget (`tests/browser/projection/query-records.spec.ts`). F07's calibrated
 * budgets own a device-level partial journey.
 */

import { execSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/no-network.js";
import { COMPACT_VIEWPORT, deleteLocalStore, openApp, protectDevice, screen } from "./fixtures/app.js";
import { auditable, clipped, undersizedTargets } from "./fixtures/a11y.js";
import { importDemoApp, openTable } from "./fixtures/records.js";

const TABLE = "Visits";
const headRevision = execSync("git rev-parse HEAD").toString().trim();

// A step that cannot happen fails in seconds, not at the test's timeout.
test.use({ actionTimeout: 20_000 });

/** The visit ids the list shows, in order: each card leads with its Visit ID. */
async function visits(page: Page): Promise<readonly string[]> {
  return page.locator("[data-record] h2").allTextContents();
}

/** A choice row is its label: the box inside it is only the visible mark (CTL-043). */
async function openChip(page: Page, name: string): Promise<void> {
  await page.getByRole("list", { name: "Sort and filters" }).getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function apply(page: Page, name: "Apply filter" | "Apply sort"): Promise<void> {
  await page.getByRole("dialog").getByRole("button", { name }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

const layouts = [
  { name: "320px", viewport: COMPACT_VIEWPORT },
  { name: "desktop", viewport: { width: 1280, height: 900 } },
] as const;

test.describe("the records query journey", () => {
  test.afterEach(async ({ page }) => {
    await deleteLocalStore(page);
  });

  for (const layout of layouts) {
    test(`records query at ${layout.name}: search, filter, sort, clear, and a filtered no-result`, async ({ page, network }, testInfo) => {
      test.setTimeout(300_000);
      await page.setViewportSize(layout.viewport);

      await openApp(page);
      // D15: the page is the one built from this revision.
      expect(await page.evaluate(() => window.__sheafBuildId)).toBe(headRevision);
      testInfo.annotations.push({ type: "sheafBuildId", description: headRevision });

      await protectDevice(page);
      await importDemoApp(page);
      await openTable(page, TABLE);
      const list = screen(page, "SCR-025");
      await expect(list).toContainText("This table holds 40 records.");

      // --- search + an enum filter + a date range + a sort --------------------
      await page.getByLabel(`Search ${TABLE}`, { exact: true }).fill("alder");
      // Unsorted, a page is in row-key order, which is not the file's order.
      await expect.poll(async () => [...(await visits(page))].sort()).toEqual(["1002", "1010", "1018", "1026", "1034"]);

      await openChip(page, "Site");
      await page.getByRole("dialog").getByText("Alder Court", { exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath(`sht-004-${layout.name}.png`) });
      await apply(page, "Apply filter");

      await openChip(page, "Visit date");
      await page.getByRole("dialog").getByLabel("Start date", { exact: true }).fill("2026-03-10");
      await page.getByRole("dialog").getByLabel("End date", { exact: true }).fill("2026-03-31");
      await page.screenshot({ path: testInfo.outputPath(`sht-005-${layout.name}.png`) });
      await apply(page, "Apply filter");

      await openChip(page, "Sort");
      await page.getByRole("dialog").getByRole("button", { name: "Descending" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Visit date", exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath(`sht-009-${layout.name}.png`) });
      await apply(page, "Apply sort");

      await expect.poll(() => visits(page)).toEqual(["1026", "1018", "1010"]);
      await expect(page.locator("[data-match-count]")).toHaveText("3 records match · sorted by visit date, descending.");
      await expect(list).toContainText("This table holds 40 records.");
      const chips = page.getByRole("list", { name: "Sort and filters" });
      await expect(chips).toContainText("Site: Alder Court");
      await expect(chips).toContainText(/Visit date: .+ – .+/u);
      await page.screenshot({ path: testInfo.outputPath(`scr-025-filtered-${layout.name}.png`), fullPage: true });
      expect(await clipped(page)).toEqual([]);
      expect(await undersizedTargets(page)).toEqual([]);
      await auditable(page, "SCR-025");

      // --- clear one filter: the rows widen -----------------------------------
      await page.getByRole("button", { name: /^Clear filter Visit date/u }).click();
      await expect.poll(() => visits(page)).toEqual(["1034", "1026", "1018", "1010", "1002"]);
      await expect(page.locator("[data-match-count]")).toHaveText("5 records match · sorted by visit date, descending.");

      // --- clear all filters: the search alone, still sorted ------------------
      await page.getByRole("button", { name: "Clear all filters" }).click();
      await expect(chips).not.toContainText("Site:");
      await expect.poll(() => visits(page)).toEqual(["1034", "1026", "1018", "1010", "1002"]);
      await page.getByRole("button", { name: "Clear search" }).first().click();
      await expect.poll(async () => (await visits(page)).length).toBe(40);
      await expect(page.locator("[data-match-count]")).toHaveText("40 records match · sorted by visit date, descending.");

      // --- a filter that matches nothing: the filtered no-result state --------
      await openChip(page, "Site");
      await page.getByRole("dialog").getByText("Alder Court", { exact: true }).click();
      await apply(page, "Apply filter");
      await openChip(page, "Follow up");
      await page.getByRole("dialog").getByRole("button", { name: "Yes", exact: true }).click();
      await apply(page, "Apply filter");

      const empty = screen(page, "SCR-026");
      await expect(empty).toBeVisible();
      const state = page.locator("[data-empty='no-results']");
      await expect(state).toContainText("No record matches these filters.");
      await expect(state).toContainText("The table contains 40 records. 2 active filters exclude all of them.");
      await expect(state.getByRole("button", { name: "Clear filter Follow up: Yes" })).toBeVisible();
      await expect(page.locator("[data-empty='empty-table']")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`scr-026-filtered-${layout.name}.png`), fullPage: true });
      expect(await clipped(page)).toEqual([]);
      expect(await undersizedTargets(page)).toEqual([]);
      await auditable(page, "SCR-026");

      // Clearing one of them is enough to see records again.
      await state.getByRole("button", { name: "Clear filter Follow up: Yes" }).click();
      await expect.poll(() => visits(page)).toEqual(["1034", "1026", "1018", "1010", "1002"]);

      expect(network.unexpected).toEqual([]);
    });
  }
});

/**
 * The chip-scroller exemption in `clipped()` must not hide a real clip. Each
 * page is set directly, so the probe is judged on geometry alone.
 */
test("clipped() exempts only a sideways scroller that fits the viewport", async ({ page, network }) => {
  await page.setViewportSize(COMPACT_VIEWPORT);
  const wide = '<button style="flex:none;width:200px">Wide chip</button>';

  // Reachable: the row fits and scrolls.
  await page.setContent(`<div style="display:flex;overflow-x:auto;width:100%">${wide}${wide}${wide}</div>`);
  expect(await clipped(page)).toEqual([]);

  // (a) Past the edge with no scroller: still cut off.
  await page.setContent(`<body style="margin:0;overflow-x:hidden"><div style="display:flex">${wide}${wide}${wide}</div></body>`);
  expect(await clipped(page)).toContain("overflows right: Wide chip");

  // (b) The scroller itself is wider than the viewport: still cut off.
  await page.setContent(`<body style="margin:0;overflow-x:hidden"><div style="display:flex;overflow-x:auto;width:600px">${wide}${wide}${wide}${wide}</div></body>`);
  expect(await clipped(page)).toContain("overflows right: Wide chip");

  expect(network.unexpected).toEqual([]);
});
