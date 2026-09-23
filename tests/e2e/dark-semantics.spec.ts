/**
 * CAP-37: semantic text on a dark app's background passes 4.5:1
 * (design.md § Built-in app palettes → System semantics in dark mode).
 *
 * `index.html` → an imported app → a record edit the validator refuses, so
 * SCR-029 shows its danger issue line directly on the app background. In the
 * default light theme the line keeps Clay ink; after Indigo · dark is saved
 * through the theme editor (SCR-036), the same line is drawn in the system's
 * Clay 300 and axe finds nothing on the page. At 320px, offline, on the build
 * made from this revision.
 */

import { execSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { auditable } from "./fixtures/a11y.js";
import { COMPACT_VIEWPORT, deleteLocalStore, followHash, openApp, protectDevice, screen } from "./fixtures/app.js";
import { expect, test } from "./fixtures/no-network.js";
import { importJobsApp } from "./fixtures/structure.js";

const headRevision = execSync("git rev-parse HEAD").toString().trim();

/** Clay ink `#833B26` (light) and Clay 300 `#E08A6E` (dark), as computed. */
const CLAY_INK = "rgb(131, 59, 38)";
const CLAY_300 = "rgb(224, 138, 110)";
const REFUSED = "This value is not the kind this field holds.";

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

test.use({ actionTimeout: 20_000 });

/** Deck repair's edit form, with a Quoted value the validator refuses. */
async function refusedEdit(page: Page, appHash: string): Promise<void> {
  await followHash(page, appHash);
  await page.getByRole("link", { name: "Jobs", exact: true }).first().click();
  await expect(screen(page, "SCR-025")).toBeVisible();
  await page.getByLabel("Search Jobs", { exact: true }).fill("Deck repair");
  await page.getByRole("link", { name: "Deck repair", exact: true }).click();
  await expect(screen(page, "SCR-027")).toBeVisible();
  await page.getByRole("link", { name: "Edit this record" }).click();
  await expect(screen(page, "SCR-029")).toBeVisible();
  await page.getByLabel("Quoted", { exact: true }).fill("about a thousand");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(screen(page, "SCR-029").getByText(REFUSED)).toBeVisible();
}

async function issueColor(page: Page): Promise<string> {
  return screen(page, "SCR-029").getByText(REFUSED).evaluate((element) => getComputedStyle(element).color);
}

test("CAP-37: a danger issue line on a dark app's background, in Clay 300, passes axe — at 320px, offline", async ({ page, network }, testInfo) => {
  test.setTimeout(300_000);
  await page.setViewportSize(COMPACT_VIEWPORT);
  await openApp(page);
  expect(await page.evaluate(() => window.__sheafBuildId)).toBe(headRevision);
  testInfo.annotations.push({ type: "sheafBuildId", description: headRevision });
  await protectDevice(page);
  const { appHash } = await importJobsApp(page);

  // Light: the line keeps the ink it always had.
  await refusedEdit(page, appHash);
  expect(await issueColor(page)).toBe(CLAY_INK);
  await page.screenshot({ path: "test-results/dark-semantics/320-issue-light.png", fullPage: true });

  // Indigo · dark, saved through the theme editor.
  await followHash(page, `${appHash}/settings`);
  await screen(page, "SCR-037").getByRole("link", { name: "Theme & logo" }).click();
  const editor = screen(page, "SCR-036");
  await expect(editor).toBeVisible();
  await editor.getByText("Indigo", { exact: true }).click();
  await editor.getByText("Dark", { exact: true }).click();
  await editor.getByRole("button", { name: "Save theme locally" }).click();
  await expect(screen(page, "SCR-037")).toBeVisible();
  await expect(page.locator("[data-app-mode]:not([data-theme-preview])").first()).toHaveAttribute("data-app-mode", "dark");

  // Dark: the same line, in the system's dark-mode danger text, and axe passes.
  await refusedEdit(page, appHash);
  expect(await issueColor(page)).toBe(CLAY_300);
  await auditable(page, "SCR-029");
  await page.screenshot({ path: "test-results/dark-semantics/320-issue-dark.png", fullPage: true });

  expect(network.unexpected).toEqual([]);
});
