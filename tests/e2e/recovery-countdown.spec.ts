import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openApp, protectDevice, screen, attemptUnlock } from "./fixtures/app.js";

const NEXT = "copper heron timber meadow";

test("CAP-05 renders the real worker's recovery delay and requires a replacement local passphrase", async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext();
  const other = await browser.newContext();
  try {
    const wrongPage = await other.newPage();
    await openApp(wrongPage);
    const wrongCode = await protectDevice(wrongPage);
    await other.close();
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await openApp(page);
    const localCode = await protectDevice(page);
    expect(wrongCode).not.toBe(localCode);
    await page.getByRole("button", { name: "Lock device" }).click();
    await page.getByRole("link", { name: /local recovery code/i }).click();
    const input = page.getByLabel("Local recovery code", { exact: true });
    const submit = page.getByRole("button", { name: "Recover and unlock", exact: true });
    for (let failure = 1; failure <= 6; failure++) {
      await input.fill(wrongCode); await submit.click();
      await expect(page.getByRole("alert")).toContainText("That is not this device's local recovery code.");
      await expect(input).toHaveValue("");
      if (failure < 6) await expect(submit).toBeEnabled();
    }
    await expect(submit).toBeDisabled();
    await expect(page.locator("[data-recovery-wait]")).toContainText("2 seconds");
    await expect(page.locator("[data-recovery-wait]")).toContainText("1 seconds");
    await expect(submit).toBeEnabled();
    await input.fill(wrongCode); await submit.click();
    await expect(page.locator("[data-recovery-wait]")).toContainText("4 seconds");
    await expect(submit).toBeDisabled();
    await expect(input).toHaveValue("");
    await expect(page.locator("[data-recovery-wait]")).toContainText("3 seconds");
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({ path: "test-results/f05/s02/recovery-countdown-320.png", fullPage: true });
    await expect(submit).toBeEnabled({ timeout: 6000 });
    await expect(page.locator("[data-recovery-wait]")).toHaveCount(0);
    await input.fill(localCode); await submit.click();
    await expect(page.getByLabel("New local unlock passphrase", { exact: true })).toBeVisible();
    await expect(screen(page, "SCR-011")).toHaveCount(0);
    await page.getByLabel("New local unlock passphrase", { exact: true }).fill(NEXT);
    await page.getByLabel("Confirm new passphrase", { exact: true }).fill(NEXT);
    await submit.click();
    await expect(screen(page, "SCR-011")).toBeVisible();
    await page.getByRole("button", { name: "Lock device" }).click();
    await attemptUnlock(page, NEXT);
    await expect(screen(page, "SCR-011")).toBeVisible();
    const buildId = await page.evaluate(() => (window as unknown as { __sheafBuildId: string }).__sheafBuildId);
    expect(buildId).toBe(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
    await mkdir("test-results/f05/s02", { recursive: true });
    await writeFile("test-results/f05/s02/recovery-countdown.json", JSON.stringify({ buildId, observedSeconds: [2, 1, 4, 3, 0], replacementInstalled: true }));
  } finally { await context.close(); await other.close(); }
});
