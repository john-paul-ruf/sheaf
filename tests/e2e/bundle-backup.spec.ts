import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { attemptUnlock, followHash, openApp, protectDevice, screen, PASSPHRASE } from "./fixtures/app.js";
import { buildBundleReader, inspectDurability, readBundle } from "./fixtures/durability.js";
import { importDemoWorkbook } from "./fixtures/workbook.js";

const VAULT = "separate cedar lantern river";
const EVIDENCE = "test-results/f05/s02";
test.beforeAll(buildBundleReader);

for (const destination of ["download", "native"] as const) test(`J1 ${destination}: delivers exact bytes and reads its receipt after page replacement`, async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({ acceptDownloads: true });
  let page = await context.newPage();
  page.setDefaultTimeout(20_000);
  try {
    await context.addInitScript((destination) => {
      Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: destination === "download" ? undefined : () => Promise.resolve({
        createWritable: () => Promise.resolve({
          write: async (blob: Blob) => { Object.assign(window, { savedBundle: Array.from(new Uint8Array(await blob.arrayBuffer())) }); },
          close: () => { Object.assign(window, { destinationClosed: true }); return Promise.resolve(); },
          abort: () => { Object.assign(window, { savedBundle: undefined }); return Promise.resolve(); },
        }),
      }) });
    }, destination);
    await openApp(page);
    const localCode = await protectDevice(page);
    const appHash = await importDemoWorkbook(page);
    await page.getByRole("link", { name: "Jobs", exact: true }).first().click();
    await page.getByLabel("Search Jobs", { exact: true }).fill("J-1001");
    await page.getByRole("link", { name: "J-1001", exact: true }).click();
    const recordHash = new URL(page.url()).hash;
    await page.getByRole("link", { name: "Edit this record" }).click();
    await page.getByLabel("Quoted amount", { exact: true }).fill("500");
    await page.getByRole("button", { name: "Save on this device" }).click();
    await expect(screen(page, "SCR-027")).toContainText("Saved on this device.");
    await followHash(page, appHash);
    await page.getByRole("link", { name: "Choose a durable home" }).click();
    await expect(screen(page, "SCR-038")).toBeVisible();
    await page.getByRole("button", { name: "Save a bundle", exact: true }).click();
    if (destination === "download") await inspectDurability(page, "vault-choice");
    await page.getByLabel("Vault name", { exact: true }).fill("Fieldwork bundle");
    await page.getByRole("radio", { name: "Create a different passphrase" }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    if (destination === "download") await inspectDurability(page, "vault-passphrase");
    await page.getByLabel("Fieldwork bundle vault passphrase", { exact: true }).fill(VAULT);
    await page.getByLabel("Confirm Fieldwork bundle vault passphrase", { exact: true }).fill(VAULT);
    await page.getByRole("button", { name: "Create vault", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Keep your vault recovery code");
    if (destination === "download") await inspectDurability(page, "vault-code-masked");
    await page.getByRole("button", { name: "Reveal", exact: true }).click();
    const vaultCode = await page.getByRole("status", { name: "Fieldwork bundle vault recovery code" }).textContent();
    expect(vaultCode?.trim()).not.toBe(localCode);
    await page.getByRole("checkbox", { name: "I saved this code", exact: true }).check();
    await page.getByRole("button", { name: "Continue to bundle" }).click();
    const download = destination === "download" ? page.waitForEvent("download") : null;
    await page.getByRole("button", { name: "Choose destination" }).click();
    await mkdir(EVIDENCE, { recursive: true });
    let bytes: Buffer;
    if (download !== null) {
      await (await download).saveAs(`${EVIDENCE}/j1-${destination}.bundle`);
      bytes = await readFile(`${EVIDENCE}/j1-${destination}.bundle`);
    } else {
      await expect(page.getByRole("dialog")).toContainText("Save confirmed by the platform.");
      expect(await page.evaluate(() => (window as unknown as { destinationClosed: boolean }).destinationClosed)).toBe(true);
      bytes = Buffer.from(await page.evaluate(() => (window as unknown as { savedBundle: number[] }).savedBundle));
      await writeFile(`${EVIDENCE}/j1-${destination}.bundle`, bytes);
    }
    expect(bytes.length).toBeGreaterThan(1000);
    for (const sentinel of [VAULT, PASSPHRASE, localCode, vaultCode!.trim(), "Fieldwork bundle", "J-1001"]) expect(bytes.includes(Buffer.from(sentinel))).toBe(false);
    const decoder = await browser.newContext();
    try {
      const decoded = await readBundle(decoder, bytes, VAULT);
      expect(decoded).toContain("500");
      expect(await readBundle(decoder, bytes, vaultCode!.trim(), "recovery")).toBe(decoded);
      await expect(readBundle(decoder, bytes, localCode, "recovery")).rejects.toThrow("artifact rejected");
      await expect(readBundle(decoder, bytes, PASSPHRASE)).rejects.toThrow("artifact rejected");
      const tampered = Buffer.from(bytes); tampered[Math.floor(tampered.length / 2)]! ^= 1;
      await expect(readBundle(decoder, tampered, VAULT)).rejects.toThrow("artifact rejected");
    } finally { await decoder.close(); }
    if (destination === "download") {
      await expect(page.getByRole("dialog")).toContainText("Did you save this bundle?");
      await expect(page.locator("[data-backup-time]")).toHaveAttribute("data-backup-time", "never");
      const editor = await context.newPage();
      try {
        await openApp(editor); await attemptUnlock(editor, PASSPHRASE);
        await expect(screen(editor, "SCR-010")).toBeVisible();
        await followHash(editor, recordHash);
        await editor.getByRole("link", { name: "Edit this record" }).click();
        await editor.getByLabel("Quoted amount", { exact: true }).fill("501");
        await editor.getByRole("button", { name: "Save on this device" }).click();
        await expect(screen(editor, "SCR-027")).toContainText("Saved on this device.");
      } finally { await editor.close(); }
      await page.getByRole("button", { name: "I saved this bundle", exact: true }).click();
    }
    await expect(page.locator("[data-pending-count]")).toHaveAttribute("data-pending-count", destination === "download" ? "1" : "0");
    const confirmedAt = await page.locator("[data-backup-time]").getAttribute("data-backup-time");
    expect(confirmedAt).not.toBe("never");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const buildId = await page.evaluate(() => (window as unknown as { __sheafBuildId: string }).__sheafBuildId);
    expect(buildId).toBe(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
    await page.close();
    page = await context.newPage();
    await openApp(page);
    await attemptUnlock(page, PASSPHRASE);
    await expect(screen(page, "SCR-010")).toBeVisible({ timeout: 90_000 });
    await followHash(page, recordHash);
    await expect(screen(page, "SCR-027")).toContainText(destination === "download" ? "$501.00" : "$500.00");
    await followHash(page, `${appHash}/backup`);
    await expect(page.locator("[data-pending-count]")).toHaveAttribute("data-pending-count", destination === "download" ? "1" : "0");
    await expect(page.locator("[data-backup-time]")).toHaveAttribute("data-backup-time", confirmedAt!);
    if (destination === "download") await inspectDurability(page, "backup-detail");
    for (const width of [320, 600, 900, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `${EVIDENCE}/backup-${destination}-${width}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByRole("button", { name: "Re-view vault recovery code" }).click();
    await page.getByLabel("Fieldwork bundle vault passphrase", { exact: true }).fill(VAULT);
    await page.getByRole("button", { name: "Reveal vault code", exact: true }).click();
    await page.getByRole("button", { name: "Reveal", exact: true }).click();
    await expect(page.getByRole("status", { name: "Fieldwork bundle vault recovery code" })).toHaveText(vaultCode!);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: "Re-view vault recovery code" })).toBeFocused();
    await followHash(page, recordHash);
    await page.getByRole("link", { name: "Edit this record" }).click();
    await page.getByLabel("Quoted amount", { exact: true }).fill("502");
    await page.getByRole("button", { name: "Save on this device" }).click();
    await expect(screen(page, "SCR-027")).toContainText("Saved on this device.");
    await followHash(page, `${appHash}/backup`);
    await expect(page.locator("[data-pending-count]")).toHaveAttribute("data-pending-count", destination === "download" ? "2" : "1");
    await expect(page.locator("[data-backup-time]")).toHaveAttribute("data-backup-time", confirmedAt!);
    if (destination === "download") {
      await page.getByRole("button", { name: "Save a fresh bundle", exact: true }).click();
      const dismissed = page.waitForEvent("download");
      await page.getByRole("button", { name: "Choose destination" }).click();
      await dismissed;
      await expect(page.getByRole("dialog")).toContainText("Did you save this bundle?");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.close(); page = await context.newPage(); await openApp(page); await attemptUnlock(page, PASSPHRASE);
      await expect(screen(page, "SCR-010")).toBeVisible();
      await followHash(page, `${appHash}/backup`);
      await expect(page.locator("[data-pending-count]")).toHaveAttribute("data-pending-count", destination === "download" ? "2" : "1");
      await expect(page.locator("[data-backup-time]")).toHaveAttribute("data-backup-time", confirmedAt!);
    }
    await followHash(page, "#/library");
    await expect(page.locator("[data-library-pending]")).toHaveAttribute("data-library-pending", destination === "download" ? "2" : "1");
    if (destination === "download") await inspectDurability(page, "library-backup");
    await followHash(page, "#/settings/security/reset");
    await expect(page.locator("[data-reset-app]")).toContainText(`${destination === "download" ? 2 : 1} changes only on this device`);
    await expect(page.locator("[data-reset-app]")).toContainText("Last confirmed backup:");
    if (destination === "download") await inspectDurability(page, "readable-reset");
    await page.getByRole("link", { name: "Back up before reset" }).click();
    await page.getByRole("button", { name: "Save a fresh bundle", exact: true }).click();
    const freshDownload = destination === "download" ? page.waitForEvent("download") : null;
    await page.getByRole("button", { name: "Choose destination" }).click();
    if (freshDownload !== null) {
      await freshDownload;
      await page.getByRole("button", { name: "I saved this bundle", exact: true }).click();
    }
    await expect(page.locator("[data-pending-count]")).toHaveAttribute("data-pending-count", "0");
    const freshTime = await page.locator("[data-backup-time]").getAttribute("data-backup-time");
    expect(Number(freshTime)).toBeGreaterThan(Number(confirmedAt));
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.close(); page = await context.newPage(); await openApp(page); await attemptUnlock(page, PASSPHRASE);
    await expect(screen(page, "SCR-010")).toBeVisible();
    await expect(page.locator("[data-library-pending]")).toHaveAttribute("data-library-pending", "0");
    await followHash(page, "#/settings/security/reset");
    await expect(page.locator("[data-reset-app]")).toContainText("0 changes only on this device");
    await followHash(page, `${appHash}/backup`);
    await expect(page.locator("[data-backup-time]")).toHaveAttribute("data-backup-time", freshTime!);
    await followHash(page, "#/settings/security/recovery-codes");
    await page.getByRole("link", { name: "Re-view Fieldwork bundle vault code" }).click();
    await expect(page.getByRole("dialog")).toContainText("Re-view Fieldwork bundle vault code");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Lock device" }).click();
    await page.getByRole("link", { name: /local recovery code/i }).click();
    await page.getByLabel("Local recovery code", { exact: true }).fill(vaultCode!.trim());
    await page.getByRole("button", { name: "Recover and unlock", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("That is not this device's local recovery code.");
    await writeFile(`${EVIDENCE}/j1-${destination}.json`, JSON.stringify({ buildId, artifactSha256: createHash("sha256").update(bytes).digest("hex"), confirmedAt,
      sourceDiffSha256: createHash("sha256").update(execFileSync("git", ["diff", "--", "src", "tests"])).digest("hex") }));
  } finally { await context.close(); }
});
