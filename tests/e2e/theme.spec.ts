/**
 * CAP-37 through the real entry (S08 CP4; CA-32, D56; SCR-036).
 *
 * `index.html` → theme services → the data worker → an encrypted
 * `theme.changed` commit → reload and unlock → the theme read back from the
 * durable bytes. The palette values asserted are DF-1's (design.md § Built-in
 * app palettes); the logo is a PNG drawn in the page by this test.
 *
 * Under the no-network fixture, at 320px and at desktop, with axe in light and
 * dark and the focus ring checked on dark chrome (design.md § Accessibility
 * Contract).
 */

import type { Page } from "@playwright/test";
import { auditable, clipped, undersizedTargets } from "./fixtures/a11y.js";
import { attemptUnlock, COMPACT_VIEWPORT, DERIVE_TIMEOUT_MS, deleteLocalStore, openApp, protectDevice, screen } from "./fixtures/app.js";
import { expect, test } from "./fixtures/no-network.js";
import { APP_NAME, importJobsApp } from "./fixtures/structure.js";

/** DF-1, design.md § Built-in app palettes: Indigo · dark and Indigo · light. */
const INDIGO_DARK = { primary: "#a9b8d6", canvas: "#121620", surface: "#1b2130" };
const INDIGO_LIGHT_PRIMARY = "#3d4e69";
/** Sprout 300, the system focus colour on every dark background. */
const SPROUT = "rgb(203, 234, 128)";

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

/** A 96×48 PNG drawn by the page itself, as the bytes a person would choose. */
async function drawnPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(96, 48);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.fillStyle = "rgb(61, 78, 105)";
    context.fillRect(0, 0, 96, 48);
    context.fillStyle = "rgb(227, 154, 94)";
    context.fillRect(24, 12, 48, 24);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return btoa(String.fromCharCode(...bytes));
  });
  return Buffer.from(base64, "base64");
}

async function openThemeEditor(page: Page, appHash: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = `${hash}/settings`;
  }, appHash);
  const settings = screen(page, "SCR-037");
  await expect(settings).toBeVisible();
  await settings.getByRole("link", { name: "Theme & logo" }).click();
  await expect(screen(page, "SCR-036")).toBeVisible();
}

const appRoot = (page: Page) => page.locator("[data-app-mode]:not([data-theme-preview])").first();

async function appVariable(page: Page, name: string): Promise<string> {
  return appRoot(page).evaluate((element, property) => getComputedStyle(element).getPropertyValue(property).trim(), name);
}

test("CAP-37: Indigo, dark, compact and a logo, saved, persisted and on the tile — at 320px, offline", async ({ page, network }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(COMPACT_VIEWPORT);
  await openApp(page);
  await protectDevice(page);
  const { appHash } = await importJobsApp(page);

  await openThemeEditor(page, appHash);
  await auditable(page, "SCR-036");
  await page.screenshot({ path: "test-results/theme/320-editor-light.png", fullPage: true });

  const editor = screen(page, "SCR-036");
  await editor.getByText("Indigo", { exact: true }).click();
  await editor.getByText("Dark", { exact: true }).click();
  await editor.getByText("Compact", { exact: true }).click();
  await editor.getByLabel("App logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: await drawnPng(page) });
  await expect(editor.locator("[data-theme-preview] img")).toBeVisible();
  await expect(editor).toContainText("Contrast passes");
  await expect(editor).toContainText("in dark mode.");
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);
  await page.screenshot({ path: "test-results/theme/320-editor-indigo-dark.png", fullPage: true });

  await editor.getByRole("button", { name: "Save theme locally" }).click();
  await expect(screen(page, "SCR-037")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Saved on this device." }).first()).toBeAttached();

  // The chrome is drawn from the saved theme: Indigo's dark set, compact, dark.
  await expect(appRoot(page)).toHaveAttribute("data-app-mode", "dark");
  await expect(appRoot(page)).toHaveAttribute("data-app-density", "compact");
  expect(await appVariable(page, "--app-primary")).toBe(INDIGO_DARK.primary);
  expect(await appVariable(page, "--color-canvas")).toBe(INDIGO_DARK.canvas);
  await expect(screen(page, "SCR-037")).toContainText("Indigo · dark · compact");
  await auditable(page, "SCR-037");
  await page.screenshot({ path: "test-results/theme/320-settings-dark.png", fullPage: true });

  // The app home shows the logo where the initials were, named as the app.
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, appHash);
  const home = screen(page, "SCR-024");
  await expect(home).toBeVisible();
  await expect(home.getByRole("img", { name: APP_NAME })).toBeVisible();
  await auditable(page, "SCR-024");
  await page.screenshot({ path: "test-results/theme/320-home-dark.png", fullPage: true });

  // The library tile carries the theme: its logo, on the tile the app names.
  await page.evaluate(() => {
    window.location.hash = "#/library";
  });
  const tile = page.locator("[data-tile]").filter({ hasText: APP_NAME });
  await expect(tile.locator("img")).toBeVisible();
  await page.screenshot({ path: "test-results/theme/320-library.png", fullPage: true });

  // Reload locks; unlocking reads the theme back from the durable bytes.
  await page.reload();
  await expect(screen(page, "SCR-003")).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
  await attemptUnlock(page, "correct horse battery staple");
  await expect(screen(page, "SCR-010")).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
  await expect(page.locator("[data-tile]").filter({ hasText: APP_NAME }).locator("img")).toBeVisible();
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, appHash);
  await expect(screen(page, "SCR-024")).toBeVisible();
  expect(await appVariable(page, "--app-primary")).toBe(INDIGO_DARK.primary);
  await expect(screen(page, "SCR-024").getByRole("img", { name: APP_NAME })).toBeVisible();

  // A custom accent that fails contrast holds the save, and names the pair.
  await openThemeEditor(page, appHash);
  await screen(page, "SCR-036").getByLabel("Custom accent").fill(INDIGO_DARK.surface);
  const save = page.getByRole("button", { name: "Save theme locally" });
  await expect(save).toBeDisabled();
  await expect(screen(page, "SCR-036")).toContainText("Contrast fails: Accent / canvas (dark), Accent / surface (dark)");
  await page.screenshot({ path: "test-results/theme/320-editor-failing.png", fullPage: true });

  expect(network.unexpected).toEqual([]);
});

test("CAP-37 at desktop: axe in light and dark, and the focus ring visible on dark chrome", async ({ page, network }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page);
  await protectDevice(page);
  const { appHash } = await importJobsApp(page);

  await openThemeEditor(page, appHash);
  const editor = screen(page, "SCR-036");
  await editor.getByText("Indigo", { exact: true }).click();
  await auditable(page, "SCR-036");
  await page.screenshot({ path: "test-results/theme/desktop-editor-light.png", fullPage: true });
  await editor.getByRole("button", { name: "Save theme locally" }).click();
  await expect(screen(page, "SCR-037")).toBeVisible();
  expect(await appVariable(page, "--app-primary")).toBe(INDIGO_LIGHT_PRIMARY);
  await auditable(page, "SCR-037");

  await openThemeEditor(page, appHash);
  await screen(page, "SCR-036").getByText("Dark", { exact: true }).click();
  await page.getByRole("button", { name: "Save theme locally" }).click();
  await expect(screen(page, "SCR-037")).toBeVisible();
  await expect(appRoot(page)).toHaveAttribute("data-app-mode", "dark");
  await auditable(page, "SCR-037");
  await page.screenshot({ path: "test-results/theme/desktop-settings-dark.png", fullPage: true });

  // Keyboard focus on the dark rail: the system's Sprout ring, 3px.
  const railLink = page.locator("aside nav a").first();
  await railLink.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const ring = await railLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.outlineColor, width: style.outlineWidth, style: style.outlineStyle };
  });
  expect(ring).toEqual({ color: SPROUT, width: "3px", style: "solid" });

  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, appHash);
  await auditable(page, "SCR-024");
  await page.screenshot({ path: "test-results/theme/desktop-home-dark.png", fullPage: true });

  expect(network.unexpected).toEqual([]);
});
