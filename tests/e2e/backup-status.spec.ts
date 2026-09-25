import { expect, test, type Page } from "@playwright/test";
import { attemptUnlock, followHash, protectDevice, screen, PASSPHRASE } from "./fixtures/app.js";
import { importDemoWorkbook } from "./fixtures/workbook.js";
import { openReminderPage, writeReminderEvidence } from "./fixtures/durability.js";

async function appFacts(page: Page, count: number, time: string) {
  await expect(page.locator("[data-status-count]")).toHaveAttribute("data-status-count", String(count));
  await expect(page.locator("[data-status-time]")).toHaveAttribute("data-status-time", time);
}

test("CA-36/40 backup facts and remedies agree across shell, app and restart", async ({ browser }) => {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
  });
  let controlled = await openReminderPage(context);
  try {
    let page = controlled.page;
    await protectDevice(page);
    const appHash = await importDemoWorkbook(page);
    await expect(page.locator("[data-status-count]")).toBeVisible();
    const imported = Number(await page.locator("[data-status-count]").getAttribute("data-status-count"));
    expect(imported).toBeGreaterThan(0);
    await appFacts(page, imported, "never");
    await page.getByRole("link", { name: "Back up now", exact: true }).click();
    await expect(screen(page, "SCR-038")).toBeVisible();
    await page.getByRole("button", { name: "Save a bundle", exact: true }).click();
    await page.getByLabel("Vault name", { exact: true }).fill("Status bundle");
    await page.getByRole("radio", { name: "Create a different passphrase" }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Status bundle vault passphrase", { exact: true }).fill("separate cedar lantern river");
    await page.getByLabel("Confirm Status bundle vault passphrase", { exact: true }).fill("separate cedar lantern river");
    await page.getByRole("button", { name: "Create vault", exact: true }).click();
    await page.getByRole("checkbox", { name: "I saved this code", exact: true }).check();
    await page.getByRole("button", { name: "Continue to bundle", exact: true }).click();
    await page.getByRole("button", { name: "Not now", exact: true }).click();
    await expect(page.locator("[data-pending-count]")).toHaveAttribute("data-pending-count", String(imported + 1));
    await followHash(page, `${appHash}/settings`);
    await appFacts(page, imported + 1, "never");
    await expect(screen(page, "SCR-037")).toContainText("Backup not confirmed");
    await page.getByRole("link", { name: "Save a fresh bundle", exact: true }).click();
    await expect(screen(page, "SCR-039")).toBeVisible();
    await page.getByRole("button", { name: "Save a fresh bundle", exact: true }).click();
    await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Choose destination", exact: true }).click(),
    ]);
    await page.getByRole("button", { name: "I saved this bundle", exact: true }).click();
    await expect(page.locator("[data-pending-count]")).toHaveAttribute("data-pending-count", "0");
    const confirmed = (await page.locator("[data-backup-time]").getAttribute("data-backup-time"))!;
    expect(confirmed).not.toBe("never");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await followHash(page, appHash);
    await appFacts(page, 0, confirmed);
    await page.getByRole("link", { name: "Jobs", exact: true }).first().click();
    await appFacts(page, 0, confirmed);
    await page.getByLabel("Search Jobs", { exact: true }).fill("J-1001");
    await page.getByRole("link", { name: "J-1001", exact: true }).click();
    await page.getByRole("link", { name: "Edit this record" }).click();
    await page.getByLabel("Quoted amount", { exact: true }).fill("500");
    await page.getByRole("button", { name: "Save on this device" }).click();
    await expect(screen(page, "SCR-027")).toContainText("Saved on this device.");
    await appFacts(page, 1, confirmed);
    await expect(page.locator("[data-frame-backup]")).toContainText("Bundle out of date");
    await controlled.close();
    controlled = await openReminderPage(context);
    page = controlled.page;
    await attemptUnlock(page, PASSPHRASE);
    await expect(screen(page, "SCR-010")).toBeVisible();
    await expect(page.locator("[data-library-pending]")).toHaveAttribute("data-library-pending", "1");
    await expect(page.locator("[data-library-backup-time]")).toHaveAttribute("data-library-backup-time", confirmed);
    await expect(page.locator("[data-tile]")).toContainText("Bundle out of date");
    await page.getByRole("link", { name: "Save a fresh bundle", exact: true }).click();
    await expect(screen(page, "SCR-039")).toBeVisible();
    await expect(page.locator("[data-backup-time]")).toHaveAttribute("data-backup-time", confirmed);
    await followHash(page, appHash);
    await appFacts(page, 1, confirmed);
    await followHash(page, `${appHash}/settings`);
    await appFacts(page, 1, confirmed);
    await writeReminderEvidence(page, "backup-status", { assets: controlled.assets, worker: controlled.clock.worker.url(), imported, pending: 1, confirmed });
  } finally { await controlled.close(); await context.close(); }
});
