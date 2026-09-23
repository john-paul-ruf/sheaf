/**
 * CAP-35, CAP-36 and CAP-28 through the real entry (S06 CP4; CA-27, CA-28).
 *
 * `index.html` → `src/main.tsx` → schema services → the production data
 * worker → S03's schema commands → an encrypted commit → the projection's
 * recalculation. Nothing is seeded behind the surface: the app is a CSV
 * imported through the UI (`fixtures/structure.ts`), and every change is a
 * person's, through SCR-035 and MOD-014.
 *
 * The journey, at 320px and at desktop width:
 * 1. Unlock → import the CSV → app home, whose "Edit structure" opens SCR-035.
 * 2. Add the computed column Balance = `[Quoted]-[Paid]` → MOD-014 → apply.
 * 3. A record shows Balance, Live and read-only, with its value → edit Quoted
 *    → save → Balance is recalculated, and the recalculation is announced
 *    (**CAP-28, the first real-entry live-recalc proof**).
 * 4. Add "Finish by is on or after Start" → the preview counts the one job
 *    that already breaks it → apply. An edit that breaks it is refused with a
 *    plain-language reason composed from the rule ("Finish by must be on or
 *    after Start."), and nothing reaches the change history (**CAP-36**).
 * 5. Status, Text → Choice list, naming the choices Scheduled and Complete
 *    (never derived from the column). Every record a conversion rewrites must
 *    pass the app's rules (invariant 5), and Gutter clean still breaks the
 *    blocking rule from step 4: MOD-014 says so and cannot apply. Once its
 *    Finish by is corrected, MOD-014 counts 4 values converted and 1 ("In
 *    progress") kept and flagged → apply → the field is a choice list with
 *    exactly the named choices (**CAP-35**, lease r2).
 * 6. Crew size ("12", "x"), Text → Number: 1 converted, 1 kept and flagged
 *    → apply → the flagged job says so.
 * 7. The table is renamed → the app's navigation says the new name.
 * 8. Reload + unlock: every change is still there, and the change history
 *    lists the schema changes.
 * Axe runs on each surface; nothing is clipped or too small at 320px; no
 * request leaves the origin; the served build is HEAD's.
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
import { applyImpact, choose, importJobsApp, openField } from "./fixtures/structure.js";

const headRevision = execSync("git rev-parse HEAD").toString().trim();

// A step that cannot happen fails in seconds, not at the test's timeout.
test.use({ actionTimeout: 20_000 });

/** Nothing required is cut off or too small; at 320px nothing sits under the bottom bar. */
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

/** The app's own Structure destination: the rail or the bottom bar, whichever is shown. */
async function goToStructure(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Structure", exact: true }).click();
  await expect(screen(page, "SCR-035")).toBeVisible();
}

/** Opens a job by its label from the table's list. */
async function openJob(page: Page, tableName: string, job: string): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: tableName, exact: true }).click();
  await expect(screen(page, "SCR-025")).toBeVisible();
  await page.getByLabel(`Search ${tableName}`, { exact: true }).fill(job);
  await page.getByRole("link", { name: job, exact: true }).click();
  await expect(screen(page, "SCR-027")).toBeVisible();
}

/** How many history entries say `text`. */
async function historyCount(page: Page, appHash: string, text: string): Promise<number> {
  await followHash(page, `${appHash}/history`);
  const history = screen(page, "SCR-032");
  await expect(history).toBeVisible();
  return history.getByText(text, { exact: true }).count();
}

const layouts = [
  { name: "320px", viewport: COMPACT_VIEWPORT },
  { name: "desktop", viewport: { width: 1280, height: 900 } },
] as const;

test.describe("the structure journey", () => {
  test.afterEach(async ({ page }) => {
    await deleteLocalStore(page);
  });

  for (const layout of layouts) {
    test(`structure at ${layout.name}: a live column, a rule, conversions, a rename — and all of it after a reload`, async ({
      page,
      network,
    }, testInfo) => {
      test.setTimeout(420_000);
      await page.setViewportSize(layout.viewport);

      await openApp(page);
      // D15: the page is the one built from this revision.
      expect(await page.evaluate(() => window.__sheafBuildId)).toBe(headRevision);
      testInfo.annotations.push({ type: "sheafBuildId", description: headRevision });

      // --- 1. unlock → import the CSV → app home → SCR-035 ----------------------
      await protectDevice(page);
      const { appHash } = await importJobsApp(page);
      await screen(page, "SCR-024").getByRole("link", { name: "Edit structure" }).click();
      const structure = screen(page, "SCR-035");
      await expect(structure).toBeVisible();
      await expect(structure.locator("[data-structure-table]")).toHaveText(["Jobs7 fields"]);
      await page.screenshot({ path: testInfo.outputPath(`scr-035-${layout.name}.png`), fullPage: true });
      await expectGeometry(page);
      await auditable(page, "SCR-035");

      // --- 2. the computed column Balance = [Quoted]-[Paid] ---------------------
      await structure.getByRole("button", { name: "Add a live calculation" }).click();
      const editor = page.getByRole("dialog");
      await editor.getByLabel("Column name", { exact: true }).fill("Balance");
      await editor.getByLabel("Calculation", { exact: true }).fill("[Quoted]-[Paid]");
      await page.screenshot({ path: testInfo.outputPath(`formula-editor-${layout.name}.png`) });
      await auditable(page, "SCR-035");
      await editor.getByRole("button", { name: "Preview impact" }).click();
      await page.screenshot({ path: testInfo.outputPath(`mod-014-${layout.name}.png`) });
      await auditable(page, "SCR-035");
      await applyImpact(page, ["Every record gets a result from this calculation."]);
      await expect(structure.locator("[data-structure-field]").filter({ hasText: /^Balance/u })).toHaveText("BalanceLive");
      await expect(structure.locator('[data-section="table-calculations"]')).toContainText("[Quoted]-[Paid]");

      // --- 3. CAP-28: Live, read-only, recalculated and announced ---------------
      await openJob(page, "Jobs", "Deck repair");
      const balance = screen(page, "SCR-027").locator("[data-computed]");
      await expect(balance).toHaveAttribute("data-computed", "ok");
      await expect(balance).toContainText(/1,?000/u);
      await expect(balance).toContainText("Read-only · Live");
      await page.getByRole("link", { name: "Edit this record" }).click();
      await expect(screen(page, "SCR-029")).toBeVisible();
      // A computed column is never an input.
      await expect(page.getByLabel("Balance", { exact: true })).toHaveCount(0);
      await page.getByLabel("Quoted", { exact: true }).fill("1500");
      await page.getByRole("button", { name: "Save on this device" }).click();
      await expect(screen(page, "SCR-027")).toBeVisible();
      // Said without taking focus: the frame's live region, and the screen's own line.
      await expect(page.locator('main > [role="status"]')).toHaveText("Saved on this device. Balance recalculated.");
      await expect(screen(page, "SCR-027")).toContainText("Saved on this device. Balance recalculated.");
      await expect(balance).toContainText(/1,?300/u);
      await expect(balance).toHaveAttribute("data-recalculated", "true");
      await page.screenshot({ path: testInfo.outputPath(`scr-027-recalculated-${layout.name}.png`), fullPage: true });

      // --- 4. CAP-36: a rule across fields, counted, then enforced --------------
      await goToStructure(page);
      await structure.getByRole("button", { name: "Add rule" }).click();
      const rule = page.getByRole("dialog");
      await choose(page, "Field to check", "Finish by");
      await choose(page, "Other field", "Start");
      await expect(rule.locator("[data-rule-sentence]")).toHaveText("Finish by is on or after Start");
      await page.screenshot({ path: testInfo.outputPath(`rule-editor-${layout.name}.png`) });
      await auditable(page, "SCR-035");
      await rule.getByRole("button", { name: "Preview impact" }).click();
      await applyImpact(page, ["1 current record fails this rule."]);
      await expect(structure.locator('[data-section="rules"]')).toContainText("Finish by is on or after Start");

      const changedBefore = await historyCount(page, appHash, "Record changed");
      await openJob(page, "Jobs", "Deck repair");
      await page.getByRole("link", { name: "Edit this record" }).click();
      await page.getByLabel("Finish by", { exact: true }).fill("2026-03-01");
      await page.getByRole("button", { name: "Save on this device" }).click();
      await expect(screen(page, "SCR-029")).toBeVisible();
      await expect(screen(page, "SCR-029")).toContainText("Finish by must be on or after Start.");
      await page.screenshot({ path: testInfo.outputPath(`scr-029-rule-refused-${layout.name}.png`), fullPage: true });
      expect(await historyCount(page, appHash, "Record changed")).toBe(changedBefore);

      // --- 5. Status, Text → Choice list with the choices a person names ---------
      const proposeChoiceList = async (): Promise<void> => {
        await goToStructure(page);
        await openField(page, "Status");
        await choose(page, "What kind of information\\?", "Choice list");
        await expect(structure.getByRole("button", { name: "Change type" })).toBeDisabled();
        const named = structure.locator('[data-editor="new-choices"]');
        for (const label of ["Scheduled", "Complete"]) {
          await named.getByLabel("New choice for Status", { exact: true }).fill(label);
          await named.getByRole("button", { name: "Add choice" }).click();
        }
        await structure.getByRole("button", { name: "Change type" }).click();
        await expect(page.getByRole("dialog")).toContainText("Change Status to Choice list with the choices Scheduled, Complete");
      };
      await proposeChoiceList();
      // Gutter clean would be rewritten while it still breaks the blocking rule: refused, with nothing applied.
      await expect(page.getByRole("dialog")).toContainText("After this change 1 record would fail the app's rules, so it cannot be applied.");
      await expect(page.getByRole("dialog").getByRole("button", { name: /^Apply/u })).toBeDisabled();
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
      await openJob(page, "Jobs", "Gutter clean");
      await page.getByRole("link", { name: "Edit this record" }).click();
      await page.getByLabel("Finish by", { exact: true }).fill("2026-03-12");
      await page.getByRole("button", { name: "Save on this device" }).click();
      await expect(screen(page, "SCR-027")).toBeVisible();
      await proposeChoiceList();
      await applyImpact(
        page,
        [
          "4 values convert to Choice list.",
          "1 value does not fit and is kept as it was, flagged for review.",
        ],
        /^Apply and flag$/u,
      );
      await expect(structure.locator('[data-editor="choices"] [data-option]')).toHaveCount(2);

      // --- 6. Crew size, Text → Number: 1 converted, 1 kept and flagged ---------
      await openField(page, "Crew size");
      await choose(page, "What kind of information\\?", "Number");
      await structure.getByRole("button", { name: "Change type" }).click();
      await applyImpact(page, ["1 value converts to Number.", "1 value does not fit and is kept as it was, flagged for review."], /^Apply and flag$/u);
      await openJob(page, "Jobs", "Fence paint");
      await expect(screen(page, "SCR-027")).toContainText("does not fit the field");

      // --- 7. the table renamed; the navigation says so --------------------------
      await goToStructure(page);
      await structure.getByLabel("Table name", { exact: true }).fill("Work orders");
      await structure.getByRole("button", { name: "Rename table" }).click();
      await applyImpact(page, ["records are affected."]);
      await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Work orders", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`scr-035-after-${layout.name}.png`), fullPage: true });
      await expectGeometry(page);

      // --- SCR-037, reached from the frame --------------------------------------
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Settings", exact: true }).click();
      const settings = screen(page, "SCR-037");
      await expect(settings).toBeVisible();
      await expect(settings.locator('[data-section="structure"]')).toContainText("1 table · 8 fields · 0 relationships");
      await expect(settings.locator('[data-later="Export data & charts"] button')).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath(`scr-037-${layout.name}.png`), fullPage: true });
      await expectGeometry(page);
      await auditable(page, "SCR-037");

      // --- 8. reload + unlock: every change is durable ---------------------------
      await openApp(page);
      await attemptUnlock(page, PASSPHRASE);
      await expect(screen(page, "SCR-010")).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
      await followHash(page, `${appHash}/structure`);
      await expect(structure).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
      await expect(structure.locator("[data-structure-table]")).toHaveText(["Work orders8 fields"]);
      const fields = structure.locator("[data-structure-field]");
      await expect(fields.filter({ hasText: /^Balance/u })).toHaveText("BalanceLive");
      await expect(fields.filter({ hasText: /^Status/u })).toHaveText("StatusChoice");
      await expect(fields.filter({ hasText: /^Crew size/u })).toHaveText("Crew sizeNumber");
      await expect(structure.locator('[data-section="rules"]')).toContainText("Finish by is on or after Start");
      await openJob(page, "Work orders", "Deck repair");
      await expect(screen(page, "SCR-027").locator("[data-computed]")).toContainText(/1,?300/u);
      await expect(screen(page, "SCR-027")).toContainText("Scheduled");

      await followHash(page, `${appHash}/history`);
      const history = screen(page, "SCR-032");
      await expect(history).toBeVisible();
      for (const entry of ["Calculation changed", "Rule changed", "Field changed", "Choices changed", "Table changed"]) {
        await expect(history.getByText(entry, { exact: true }).first()).toBeVisible();
      }

      expect(network.unexpected).toEqual([]);
    });
  }
});
