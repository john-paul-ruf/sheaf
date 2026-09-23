/**
 * CAP-32 and CAP-33 through the real entry (S05 CP4; CA-29/30; D61, D63).
 *
 * `index.html` → `src/main.tsx` → the production data worker → the real
 * SQLite projection, on S03's demo CSV imported through the UI (40 visits,
 * eight sites of five, a USD Quoted amount with one kept-as-written "TBD").
 * Every step is a person's: the builder's cards and selects, MOD-013, the
 * chart's mark list, SHT-012, SHT-017, the records chips.
 *
 * The journey, at 320px and at desktop width: the app's Charts destination
 * (SCR-053) is empty → New chart → build a bar chart of Quoted amount summed
 * by Site → the preview draws all eight sites within budget →
 * save it named and pinned → app home shows it → its accessibility table
 * matches the preview → a mark chosen from the keyboard path opens SHT-012 →
 * applying it filters the records list to exactly that site's five visits,
 * the heading names the chart, and clearing restores all forty → a reload
 * and unlock find the chart still there (a durable `chart.saved`) → the index
 * lists it, made here and on app home, and its pin toggled off takes it off
 * app home. The
 * canvas is proven drawn by reading its pixels. At desktop, MOD-012 keeps an
 * unsaved chart as a local draft and restores it. Axe runs on each surface,
 * nothing is clipped at 320px, and no request leaves the origin.
 *
 * **A sampled or partial chart is not fabricated here.** D53's source budget
 * is 20,000 rows; STA-015 is proven at the browser-projection tier with
 * injected budgets (`tests/browser/projection/chart-dataset.spec.ts`).
 */

import { execSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/no-network.js";
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
import { auditable, clipped, overlaps, undersizedTargets } from "./fixtures/a11y.js";
import { importDemoApp } from "./fixtures/records.js";

const headRevision = execSync("git rev-parse HEAD").toString().trim();

// A step that cannot happen fails in seconds, not at the test's timeout.
test.use({ actionTimeout: 20_000 });

/** Quoted amount summed by Site, from the CSV itself: Alder Court's "TBD" is kept, not summed. */
const QUOTED_BY_SITE: readonly (readonly [string, string])[] = [
  ["Ridgeway Depot", "$6,250.00"],
  ["Alder Court", "$1,722.00"],
  ["Bramble Yard", "$14,500.00"],
  ["Cedar Mill", "$376.25"],
  ["Dunmore Lot", "$92,000.00"],
  ["Eastgate Works", "$3,200.00"],
  ["Fennel Row", "$1,563.75"],
  ["Granary Lane", "$25,400.00"],
];
const SUMMARY = "Dunmore Lot is highest at $92,000.00; Cedar Mill is lowest at $376.25.";

/** A React Aria select: open it by its label, choose an option by its name. */
async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`${label}$`, "u") }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(`${label}$`, "u") })).toContainText(option);
}

/** Opens the builder the way the app does, and waits for its first preview. */
async function openBuilder(page: Page, appHash: string): Promise<void> {
  await followHash(page, `${appHash}/charts/new`);
  await expect(screen(page, "SCR-034")).toBeVisible();
}

async function buildQuotedBySite(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /^Bar/u })).toHaveAttribute("aria-pressed", "true");
  await choose(page, "Group by", "Site");
  await choose(page, "Measure", "Sum of quoted amount");
  const preview = page.locator('[data-preview="true"]');
  await expect(preview.locator('[data-summary="true"]')).toHaveText(SUMMARY);
  await expect(preview).toContainText("40 local rows · all included");
  await expect(preview).toContainText("Within chart budget");
}

/**
 * Nothing required is cut off or too small to hit; at 320px, nothing is left
 * under the bottom bar at the end of the page (the probe reads the compact
 * class's bottom bar; the desktop rail sits beside the content).
 */
async function expectGeometry(page: Page): Promise<void> {
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);
  if ((page.viewportSize()?.width ?? 0) > COMPACT_VIEWPORT.width) return;
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  expect(await overlaps(page)).toEqual([]);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
}

/** The canvas drew something: not every pixel of it is transparent. */
async function canvasHasInk(page: Page): Promise<boolean> {
  return page.locator("[data-chart-canvas] canvas").first().evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (context === null || canvas.width === 0 || canvas.height === 0) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if ((pixels[index] ?? 0) > 0) return true;
    }
    return false;
  });
}

const layouts = [
  { name: "320px", viewport: COMPACT_VIEWPORT },
  { name: "desktop", viewport: { width: 1280, height: 900 } },
] as const;

test.describe("the charts journey", () => {
  test.afterEach(async ({ page }) => {
    await deleteLocalStore(page);
  });

  for (const layout of layouts) {
    test(`charts at ${layout.name}: build, save and pin, view, filter by a mark, reopen`, async ({ page, network }, testInfo) => {
      test.setTimeout(300_000);
      await page.setViewportSize(layout.viewport);

      await openApp(page);
      // D15: the page is the one built from this revision.
      expect(await page.evaluate(() => window.__sheafBuildId)).toBe(headRevision);
      testInfo.annotations.push({ type: "sheafBuildId", description: headRevision });

      await protectDevice(page);
      const { appHash } = await importDemoApp(page);

      // --- SCR-053: the app's Charts destination, empty, then SCR-034 -----------
      await page.getByRole("link", { name: "Charts", exact: true }).first().click();
      const index = screen(page, "SCR-053");
      await expect(index).toBeVisible();
      await expect(index.locator('[data-empty="no-charts"]')).toContainText("No charts yet");
      await page.screenshot({ path: testInfo.outputPath(`scr-053-empty-${layout.name}.png`), fullPage: true });
      await expectGeometry(page);
      await auditable(page, "SCR-053");
      await index.getByRole("link", { name: "New chart" }).first().click();

      // --- SCR-034: build, preview, save and pin --------------------------------
      await expect(screen(page, "SCR-034")).toBeVisible();
      await buildQuotedBySite(page);
      await page.getByLabel("Chart name", { exact: true }).fill("Quoted by site");
      await page.screenshot({ path: testInfo.outputPath(`scr-034-${layout.name}.png`), fullPage: true });
      await expectGeometry(page);
      await auditable(page, "SCR-034");

      await page.getByRole("button", { name: "Save & pin" }).click();
      const save = page.getByRole("dialog");
      await expect(save).toContainText("Saving a chart is a user change and will appear in backup status.");
      await expect(save.getByLabel("Chart name", { exact: true })).toHaveValue("Quoted by site");
      await page.screenshot({ path: testInfo.outputPath(`mod-013-${layout.name}.png`) });
      await save.getByRole("button", { name: "Save chart" }).click();

      // --- SCR-033: the saved chart, said once it is durable --------------------
      const detail = screen(page, "SCR-033");
      await expect(detail).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Saved on this device." })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Quoted by site");
      await expect(detail.locator('[data-scope="all"]')).toHaveText("Showing all 40 local rows");
      await expect(detail.locator('[data-summary="true"]')).toHaveText(SUMMARY);
      await expect.poll(() => canvasHasInk(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`scr-033-${layout.name}.png`), fullPage: true });
      await expectGeometry(page);
      await auditable(page, "SCR-033");

      // SHT-017: the accessible table says exactly what the preview drew.
      await detail.getByRole("button", { name: "Accessibility view" }).click();
      const table = page.getByRole("dialog");
      await expect(table).toContainText("Text summary and complete data table");
      await expect(table.locator("tbody tr")).toHaveCount(8);
      for (const [site, amount] of QUOTED_BY_SITE) {
        await expect(table.locator("tbody tr").filter({ hasText: site })).toContainText(`${site}${amount}5`);
      }
      await page.screenshot({ path: testInfo.outputPath(`sht-017-${layout.name}.png`) });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // --- a mark from the keyboard path → SHT-012 → the filtered list ---------
      const alder = detail.getByRole("button", { name: "Alder Court, $1,722.00" });
      await alder.focus();
      await page.keyboard.press("Enter");
      const mark = page.getByRole("dialog");
      await expect(mark).toContainText("Alder Court · $1,722.00");
      await expect(mark).toContainText("Site: Alder Court");
      await page.screenshot({ path: testInfo.outputPath(`sht-012-${layout.name}.png`) });
      await mark.getByRole("button", { name: "View all 5 records" }).click();

      const list = screen(page, "SCR-025");
      await expect(list).toBeVisible();
      await expect(page.locator("[data-chart-origin]")).toHaveText("Selected mark · Quoted by site");
      await expect(page.locator("[data-match-count]")).toHaveText("5 records match.");
      await expect(page.locator("[data-record]")).toHaveCount(5);
      await expect(page.getByRole("status").filter({ hasText: "Selected mark · Quoted by site." })).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath(`scr-025-from-chart-${layout.name}.png`), fullPage: true });
      expect(await clipped(page)).toEqual([]);
      await page.getByRole("button", { name: "Clear filter Site: Alder Court" }).click();
      await expect(page.locator("[data-record]")).toHaveCount(40);
      await expect(page.locator("[data-chart-origin]")).toHaveCount(0);

      // --- SCR-024: the pinned chart, and a mark filtering straight from it -----
      await followHash(page, appHash);
      const home = screen(page, "SCR-024");
      await expect(home).toBeVisible();
      const pinned = home.locator("[data-pinned-chart]");
      await expect(pinned).toContainText("Pinned chart");
      await expect(pinned).toContainText("Quoted by site");
      await expect(pinned).toContainText("Tap a bar to filter the list");
      await page.screenshot({ path: testInfo.outputPath(`scr-024-pinned-${layout.name}.png`), fullPage: true });
      await expectGeometry(page);
      await auditable(page, "SCR-024");
      await pinned.getByRole("button", { name: "Filter by Cedar Mill, $376.25" }).click();
      await expect(screen(page, "SCR-025")).toBeVisible();
      await expect(page.locator("[data-record]")).toHaveCount(5);

      // --- reload + unlock: the chart is durable --------------------------------
      // A fresh load of the entry: the worker is gone, so this is a cold unlock.
      await openApp(page);
      await attemptUnlock(page, PASSPHRASE);
      // The library now holds the app (SCR-010), not the empty one `unlock()` waits for.
      await expect(screen(page, "SCR-010")).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
      await followHash(page, appHash);
      await expect(screen(page, "SCR-024").locator("[data-pinned-chart]")).toContainText("Quoted by site");
      await screen(page, "SCR-024").getByRole("link", { name: "View data table" }).click();
      await expect(screen(page, "SCR-033").locator('[data-summary="true"]')).toHaveText(SUMMARY);

      // --- SCR-053: the saved chart, its origin, and its pin toggled off --------
      await page.getByRole("link", { name: "Charts", exact: true }).first().click();
      const row = screen(page, "SCR-053").locator("[data-chart-row]");
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("Quoted by site");
      await expect(row).toContainText("Bar · Visits");
      await expect(row).toContainText("Made here");
      await expect(row).toContainText("On app home");
      const pin = row.getByRole("button", { name: "Pin to app home: Quoted by site" });
      await expect(pin).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({ path: testInfo.outputPath(`scr-053-${layout.name}.png`), fullPage: true });
      await expectGeometry(page);
      await auditable(page, "SCR-053");
      await pin.click();
      await expect(pin).toHaveAttribute("aria-pressed", "false");
      await expect(screen(page, "SCR-053")).toContainText("1 chart · 0 pinned to app home");
      await followHash(page, appHash);
      await expect(screen(page, "SCR-024")).toBeVisible();
      await expect(screen(page, "SCR-024").locator("[data-pinned-chart]")).toHaveCount(0);

      if (layout.name === "desktop") {
        // --- MOD-012: an unsaved chart kept as a local draft (D61) --------------
        await openBuilder(page, appHash);
        await choose(page, "Group by", "Follow up");
        await page.getByRole("button", { name: "Cancel" }).click();
        const leave = page.getByRole("alertdialog");
        await expect(leave).toContainText("Discard chart draft");
        await page.screenshot({ path: testInfo.outputPath(`mod-012-${layout.name}.png`) });
        await leave.getByRole("button", { name: "Save draft locally" }).click();
        await expect(screen(page, "SCR-053")).toBeVisible();

        await openBuilder(page, appHash);
        await expect(page.getByText("Draft saved locally", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: /Group by$/u })).toContainText("Follow up");
        await page.getByRole("button", { name: "Cancel" }).click();
        await page.getByRole("alertdialog").getByRole("button", { name: "Leave" }).click();
        // Leaving waits for the discard, then goes to the index; reopen only once it has.
        await expect(screen(page, "SCR-053")).toBeVisible();
        await openBuilder(page, appHash);
        await expect(page.getByText("Draft saved locally", { exact: true })).toHaveCount(0);
      }

      expect(network.unexpected).toEqual([]);
    });
  }
});
