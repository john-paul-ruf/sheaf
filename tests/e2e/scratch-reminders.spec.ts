import { expect, test, type Page } from "@playwright/test";
import { attemptUnlock, followHash, protectDevice, screen, PASSPHRASE } from "./fixtures/app.js";
import { importDemoWorkbook } from "./fixtures/workbook.js";
import { inspectReminderStatus, openReminderPage, writeReminderEvidence } from "./fixtures/durability.js";

const T0 = 1_800_000_000_000;
const deadlines = [1_800_000_600_000, 1_800_004_200_000, 1_800_090_600_000, 1_800_177_000_000, 1_800_263_400_000];
const marker = (page: Page) => page.locator("[data-reminder-state]");
const reminder = (page: Page) => page.locator("[data-scratch-reminder]");

async function edit(page: Page, appHash: string, amount: string) {
  await followHash(page, appHash);
  await page.getByRole("link", { name: "Jobs", exact: true }).first().click();
  await page.getByLabel("Search Jobs", { exact: true }).fill("J-1001");
  await page.getByRole("link", { name: "J-1001", exact: true }).click();
  await page.getByRole("link", { name: "Edit this record" }).click();
  await page.getByLabel("Quoted amount", { exact: true }).fill(amount);
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(screen(page, "SCR-027")).toContainText("Saved on this device.");
}
async function dismiss(page: Page, count: number) {
  await expect(reminder(page)).toBeVisible();
  await reminder(page).getByRole("button", { name: "Keep working", exact: true }).click();
  await expect(marker(page)).toHaveAttribute("data-reminder-state", "ready");
  await expect(marker(page)).toHaveAttribute("data-reminder-dismissals", String(count));
  await expect(reminder(page)).toHaveCount(0);
}
async function requery(page: Page, appHash: string) {
  const before = Number(await marker(page).getAttribute("data-reminder-query"));
  const target = new URL(page.url()).hash === appHash ? `${appHash}/settings` : appHash;
  await followHash(page, target);
  await expect.poll(async () => Number(await marker(page).getAttribute("data-reminder-query"))).toBeGreaterThan(before);
  await expect(marker(page)).toHaveAttribute("data-reminder-state", "ready");
}
async function unlockApp(page: Page, appHash: string) {
  await expect(screen(page, "SCR-003")).toBeVisible({ timeout: 90_000 });
  await attemptUnlock(page, PASSPHRASE);
  await expect(screen(page, "SCR-010")).toBeVisible({ timeout: 90_000 });
  await followHash(page, appHash);
  await expect(marker(page)).toHaveAttribute("data-reminder-state", "ready");
}

test("J2 clock bridge controls only the built data worker", async ({ browser }) => {
  const context = await browser.newContext();
  let controlled = await openReminderPage(context);
  try {
    const original = await controlled.clock.worker.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Date, "now")!;
      return { configurable: descriptor.configurable, writable: descriptor.writable, enumerable: descriptor.enumerable, source: String(Date.now) };
    });
    await controlled.clock.setEpochMs(T0);
    expect(await controlled.clock.readEpochMs()).toBe(T0);
    await controlled.clock.setEpochMs(T0 + 1);
    expect(Math.abs(await controlled.page.evaluate(() => Date.now()) - Date.now())).toBeLessThan(10_000);
    for (const bad of [NaN, Infinity, 1.5, -1, Number.MAX_SAFE_INTEGER + 1]) await expect(controlled.clock.setEpochMs(bad)).rejects.toThrow("invalid reminder epoch");
    await controlled.clock.restore();
    expect(await controlled.clock.worker.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Date, "now")!;
      return { configurable: descriptor.configurable, writable: descriptor.writable, enumerable: descriptor.enumerable, source: String(Date.now) };
    })).toEqual(original);
    expect(Math.abs(await controlled.clock.readEpochMs() - Date.now())).toBeLessThan(10_000);
    const previous = controlled;
    await previous.close();
    await expect(previous.clock.setEpochMs(T0)).rejects.toThrow("closed");
    controlled = await openReminderPage(context);
    expect(controlled.clock.worker).not.toBe(previous.clock.worker);
    expect(Math.abs(await controlled.clock.readEpochMs() - Date.now())).toBeLessThan(10_000);
    await writeReminderEvidence(controlled.page, "clock-selftest", { assets: controlled.assets, worker: controlled.clock.worker.url() });
  } finally { try { await controlled.close(); } finally { await context.close(); } }
});

test("J2 page-only clock cannot advance worker eligibility", async ({ browser }) => {
  const context = await browser.newContext();
  const controlled = await openReminderPage(context);
  const { page, clock } = controlled;
  try {
    await protectDevice(page);
    const appHash = await importDemoWorkbook(page);
    await clock.setEpochMs(T0);
    await edit(page, appHash, "500");
    await dismiss(page, 1);
    const count = await marker(page).getAttribute("data-reminder-count");
    await page.evaluate((epoch) => {
      Object.assign(window, { originalPageNow: Object.getOwnPropertyDescriptor(Date, "now") });
      Object.defineProperty(Date, "now", { configurable: true, writable: true, value: () => epoch });
    }, deadlines[0]!);
    await requery(page, appHash);
    expect(await clock.readEpochMs()).toBe(T0);
    await expect(reminder(page)).toHaveCount(0);
    await expect(marker(page)).toHaveAttribute("data-reminder-count", count!);
    await expect(page.getByText("On this device only · not backed up", { exact: true }).first()).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(Date, "now", (window as unknown as { originalPageNow: PropertyDescriptor }).originalPageNow);
    });
    await clock.setEpochMs(deadlines[0]!);
    await requery(page, appHash);
    await expect(reminder(page)).toBeVisible();
    await writeReminderEvidence(page, "page-clock-negative", { assets: controlled.assets, worker: clock.worker.url(), workerEpoch: await clock.readEpochMs() });
  } finally { try { await controlled.close(); } finally { await context.close(); } }
});

test("J2 exact dismissal deadlines survive page replacement and repeat daily", async ({ browser }) => {
  const context = await browser.newContext();
  let controlled = await openReminderPage(context);
  try {
    await protectDevice(controlled.page);
    const appHash = await importDemoWorkbook(controlled.page);
    await controlled.clock.setEpochMs(T0);
    await edit(controlled.page, appHash, "500");
    await expect(reminder(controlled.page)).toBeVisible();
    const trigger = await marker(controlled.page).getAttribute("data-reminder-trigger");
    const count = await marker(controlled.page).getAttribute("data-reminder-count");
    const reopened = [];
    for (const [index, deadline] of deadlines.entries()) {
      await dismiss(controlled.page, index + 1);
      await expect(marker(controlled.page)).toHaveAttribute("data-reminder-deadline", String(deadline));
      const previousWorker = controlled.clock.worker;
      await controlled.close();
      controlled = await openReminderPage(context);
      expect(controlled.clock.worker).not.toBe(previousWorker);
      await controlled.clock.setEpochMs(deadline - 1);
      await unlockApp(controlled.page, appHash);
      await expect(marker(controlled.page)).toHaveAttribute("data-reminder-trigger", trigger!);
      await expect(marker(controlled.page)).toHaveAttribute("data-reminder-dismissals", String(index + 1));
      await expect(marker(controlled.page)).toHaveAttribute("data-reminder-count", count!);
      await expect(reminder(controlled.page)).toHaveCount(0);
      await expect(controlled.page.getByText("On this device only · not backed up", { exact: true }).first()).toBeVisible();
      await controlled.clock.setEpochMs(deadline);
      await requery(controlled.page, appHash);
      await expect(reminder(controlled.page)).toBeVisible();
      reopened.push({ worker: controlled.clock.worker.url(), workerReplaced: controlled.clock.worker !== previousWorker,
        dismissalCount: Number(await marker(controlled.page).getAttribute("data-reminder-dismissals")),
        persistedDeadline: Number(await marker(controlled.page).getAttribute("data-reminder-deadline")),
        workerEpoch: await controlled.clock.readEpochMs(), triggerPreserved: await marker(controlled.page).getAttribute("data-reminder-trigger") === trigger,
        countUnchanged: await marker(controlled.page).getAttribute("data-reminder-count") === count });
    }
    await writeReminderEvidence(controlled.page, "exact-deadlines", { assets: controlled.assets, worker: controlled.clock.worker.url(), deadlines, reopened });
  } finally { try { await controlled.close(); } finally { await context.close(); } }
});

test("J2 real clock authored edit dismiss reopen", async ({ browser }) => {
  const context = await browser.newContext();
  let controlled = await openReminderPage(context);
  try {
    await protectDevice(controlled.page);
    const appHash = await importDemoWorkbook(controlled.page);
    await edit(controlled.page, appHash, "500");
    await dismiss(controlled.page, 1);
    await edit(controlled.page, appHash, "501");
    await expect(marker(controlled.page)).toHaveAttribute("data-reminder-state", "ready");
    await expect(reminder(controlled.page)).toHaveCount(0);
    await controlled.close();
    controlled = await openReminderPage(context);
    await unlockApp(controlled.page, appHash);
    await expect(marker(controlled.page)).toHaveAttribute("data-reminder-dismissals", "1");
    await expect(reminder(controlled.page)).toHaveCount(0);
    await controlled.page.getByRole("link", { name: "Jobs", exact: true }).first().click();
    await controlled.page.getByLabel("Search Jobs", { exact: true }).fill("J-1001");
    await controlled.page.getByRole("link", { name: "J-1001", exact: true }).click();
    await expect(screen(controlled.page, "SCR-027")).toContainText("$501.00");
    await writeReminderEvidence(controlled.page, "real-clock", { assets: controlled.assets, worker: controlled.clock.worker.url() });
  } finally { try { await controlled.close(); } finally { await context.close(); } }
});

test("J2 authored schema chart and theme changes share the reminder and home assignment stops it", async ({ browser }) => {
  const context = await browser.newContext();
  const controlled = await openReminderPage(context);
  const { page, clock } = controlled;
  try {
    await protectDevice(page);
    const appHash = await importDemoWorkbook(page);
    await clock.setEpochMs(T0);
    await followHash(page, `${appHash}/settings`);
    await page.getByLabel("App name", { exact: true }).fill("Reminder fieldbook");
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Apply", exact: true }).click();
    await expect(reminder(page)).toBeVisible();
    const schemaCount = Number(await marker(page).getAttribute("data-reminder-count"));
    await dismiss(page, 1);

    await followHash(page, `${appHash}/charts/new`);
    await expect(screen(page, "SCR-034")).toBeVisible();
    await page.getByLabel("Chart name", { exact: true }).fill("Reminder chart");
    await page.getByRole("button", { name: "Save & pin", exact: true }).click();
    await clock.setEpochMs(deadlines[0]!);
    await page.getByRole("dialog").getByRole("button", { name: "Save chart", exact: true }).click();
    await expect(reminder(page)).toBeVisible();
    await expect(marker(page)).toHaveAttribute("data-reminder-count", String(schemaCount + 1));
    await dismiss(page, 2);

    await followHash(page, `${appHash}/theme`);
    await expect(screen(page, "SCR-036")).toBeVisible();
    await page.getByText("Indigo", { exact: true }).click();
    await clock.setEpochMs(deadlines[1]!);
    await page.getByRole("button", { name: "Save theme locally", exact: true }).click();
    await expect(reminder(page)).toBeVisible();
    await expect(marker(page)).toHaveAttribute("data-reminder-count", String(schemaCount + 2));
    await dismiss(page, 3);

    await followHash(page, `${appHash}/backup`);
    await page.getByRole("button", { name: "Save a bundle", exact: true }).click();
    await page.getByLabel("Vault name", { exact: true }).fill("Reminder home");
    await page.getByRole("radio", { name: "Create a different passphrase" }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Reminder home vault passphrase", { exact: true }).fill("separate cedar lantern river");
    await page.getByLabel("Confirm Reminder home vault passphrase", { exact: true }).fill("separate cedar lantern river");
    await page.getByRole("button", { name: "Create vault", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Keep your vault recovery code");
    await page.getByRole("checkbox", { name: "I saved this code", exact: true }).check();
    await page.getByRole("button", { name: "Continue to bundle", exact: true }).click();
    await page.getByRole("button", { name: "Not now", exact: true }).click();
    await clock.setEpochMs(deadlines[4]!);
    await requery(page, appHash);
    await expect(reminder(page)).toHaveCount(0);
    await expect(marker(page)).toHaveAttribute("data-reminder-trigger", "");
    await expect(marker(page)).toHaveAttribute("data-reminder-count", String(schemaCount + 3));
    await writeReminderEvidence(page, "authored-families", { assets: controlled.assets, worker: clock.worker.url(), schemaCount });
  } finally { try { await controlled.close(); } finally { await context.close(); } }
});

test("J2 reminder keyboard focus and responsive status remain usable", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const controlled = await openReminderPage(context);
  const { page, clock } = controlled;
  try {
    await protectDevice(page);
    const appHash = await importDemoWorkbook(page);
    await clock.setEpochMs(T0);
    await edit(page, appHash, "500");
    const dialog = reminder(page);
    await expect(dialog).toHaveCount(1);
    await expect(dialog.getByRole("heading")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Choose a durable home", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Keep working", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Keep working", exact: true })).toBeFocused();
    await inspectReminderStatus(page, "first-reminder");
    for (const button of await dialog.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.mouse.click(2, 2);
    await expect(dialog).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(marker(page)).toHaveAttribute("data-reminder-dismissals", "1");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("main h1")).toBeFocused();
    expect(await page.locator("main").evaluate((main) => main.closest('[inert], [aria-hidden="true"]') === null)).toBe(true);
    await clock.setEpochMs(deadlines[0]!);
    await requery(page, appHash);
    await expect(dialog).toHaveCount(1);
    await expect(dialog.getByRole("heading")).toContainText("changes still need a backup");
    await inspectReminderStatus(page, "later-reminder");
    await page.setViewportSize({ width: 320, height: 480 });
    await dialog.getByRole("button", { name: "Keep working", exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "Keep working", exact: true })).toBeInViewport();
    await page.screenshot({ path: "test-results/f05/s03/reminder-short-phone.png" });
    await dismiss(page, 2);
    await expect(page.getByText("On this device only · not backed up", { exact: true }).first()).toBeVisible();
    await writeReminderEvidence(page, "responsive-keyboard", { assets: controlled.assets, worker: clock.worker.url(), widths: [320, 600, 900, 1200], reducedMotion: true });
  } finally { try { await controlled.close(); } finally { await context.close(); } }
});
