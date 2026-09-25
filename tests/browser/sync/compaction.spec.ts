import { execFileSync } from "node:child_process";
import { cp, mkdtemp, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { attemptUnlock, followHash, protectDevice, screen, PASSPHRASE } from "../../e2e/fixtures/app.js";
import { importDemoApp, openRecord, openTable } from "../../e2e/fixtures/records.js";
import { buildBundleReader, createNativeBundleHome, decodedGraphFacts, openProductionPage, readBundle, saveFreshNativeBundle,
  useNativeDestination, writeDurabilityEvidence, type DecodedGraphFactsV1 } from "../../e2e/fixtures/durability.js";

/** Production defaults (compaction.ts): the harness never lowers them. */
const THRESHOLD = 128;
const INTERVAL_MS = 1500;
const SECRET = "compaction cedar lantern river";

test.beforeAll(buildBundleReader);

test("identifies the production-bootstrapped data worker across restart and refuses a wrong worker or stale assets", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext();
  const stale = await mkdtemp(join(tmpdir(), "sheaf-s06-stale-"));
  try {
    const first = await openProductionPage(context);
    expect(new URL(first.worker.url()).pathname).toMatch(/^\/assets\/data\.worker-[\w-]+\.js$/);
    expect(await first.page.evaluate(() => window.__sheafBuildId)).toBe(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
    await first.close();
    expect(first.isClosed()).toBe(true);
    const second = await openProductionPage(context);
    expect(second.worker).not.toBe(first.worker);
    expect(second.assets).toEqual(first.assets);
    await second.close();
    const io = Object.keys(first.assets).find((path) => path.startsWith("assets/io.worker-"))!;
    await expect(openProductionPage(context, { workerAsset: io.slice("assets/".length) })).rejects.toThrow(/bootstrap does not name/);
    await cp("dist", stale, { recursive: true });
    await appendFile(join(stale, "index.html"), "<!-- stale -->");
    await expect(openProductionPage(context, { localAssets: stale })).rejects.toThrow("served build differs: index.html");
    expect(context.pages()).toHaveLength(0);
  } finally { await context.close(); await rm(stale, { recursive: true, force: true }); }
});

test("the production timer compacts at 128 post-checkpoint commits only, waits for a pinned save with a concurrent edit, never repeats on an empty tail, and recurs after worker replacement", async ({ browser }) => {
  test.setTimeout(600_000);
  const context = await browser.newContext();
  await useNativeDestination(context);
  const decoder = await browser.newContext();
  let live = await openProductionPage(context);
  let page: Page = live.page;
  page.setDefaultTimeout(20_000);
  const observations: { label: string; facts: DecodedGraphFactsV1; at: number }[] = [];
  try {
    await expect(page.locator("[data-screen]")).toBeVisible({ timeout: 90_000 });
    await protectDevice(page);
    const { appHash } = await importDemoApp(page);
    const record = async (label: string, bytes: Buffer) => {
      const facts = decodedGraphFacts(await readBundle(decoder, bytes, SECRET));
      observations.push({ label, facts, at: Date.now() });
      return facts;
    };
    const observe = async (label: string) => record(label, await saveFreshNativeBundle(page, appHash));
    const initial = await record("home", await createNativeBundleHome(page, appHash, "Compaction bundle", SECRET));
    expect(initial.headVersion).toBe(1);
    await followHash(page, appHash);
    await openTable(page, "Visits");
    await openRecord(page, "Visits", "1002");
    const recordHash = new URL(page.url()).hash;
    let amount = 1000;
    const edit = async (count: number) => {
      await followHash(page, recordHash);
      for (let index = 0; index < count; index++) {
        await page.getByRole("link", { name: "Edit this record" }).click();
        await page.getByLabel("Quoted amount", { exact: true }).fill(`${++amount}.00`);
        await page.getByRole("button", { name: "Save on this device" }).click();
        await expect(screen(page, "SCR-027")).toContainText("Saved on this device.");
      }
    };
    const idle = () => page.waitForTimeout(2 * INTERVAL_MS + 500);
    const untilCompacted = async (label: string, previous: DecodedGraphFactsV1["checkpointFrontier"]) => {
      let facts: DecodedGraphFactsV1 | undefined;
      await expect.poll(async () => { facts = await observe(label); return facts.headVersion === 2 && JSON.stringify(facts.checkpointFrontier) !== JSON.stringify(previous); },
        { timeout: 30_000, intervals: [INTERVAL_MS] }).toBe(true);
      expect(facts!).toMatchObject({ tailCommits: 0, checkpointFrontier: facts!.frontier });
      return facts!;
    };

    await edit(THRESHOLD - 1 - initial.tailCommits);
    const below = await observe("127");
    expect(below).toMatchObject({ headVersion: 1, tailCommits: THRESHOLD - 1 });
    await idle();
    expect(await observe("127-after-two-intervals")).toMatchObject({ headVersion: 1, tailCommits: THRESHOLD - 1, checkpointFrontier: below.checkpointFrontier });

    // The 128th commit is authored while a pinned bundle transfer is still open.
    await page.evaluate(() => { Object.assign(window, { holdSave: true, heldBundle: undefined }); });
    await followHash(page, `${appHash}/backup`);
    await page.getByRole("button", { name: "Save a fresh bundle", exact: true }).click();
    await page.getByRole("button", { name: "Choose destination" }).click();
    await expect.poll(() => page.evaluate(() => "heldBundle" in window && (window as unknown as { heldBundle?: unknown }).heldBundle !== undefined)).toBe(true);
    const editor = await context.newPage();
    editor.setDefaultTimeout(20_000);
    try {
      await editor.goto("/");
      await attemptUnlock(editor, PASSPHRASE);
      await expect(screen(editor, "SCR-010")).toBeVisible({ timeout: 90_000 });
      await followHash(editor, recordHash);
      await editor.getByRole("link", { name: "Edit this record" }).click();
      await editor.getByLabel("Quoted amount", { exact: true }).fill(`${++amount}.00`);
      await editor.getByRole("button", { name: "Save on this device" }).click();
      await expect(screen(editor, "SCR-027")).toContainText("Saved on this device.");
    } finally { await editor.close(); }
    await idle();
    const held = Buffer.from(await page.evaluate(() => (window as unknown as { heldBundle: number[] }).heldBundle));
    await page.evaluate(() => { Object.assign(window, { holdSave: false }); (window as unknown as { releaseSave(): void }).releaseSave(); });
    await expect(page.getByRole("dialog")).toContainText("Save confirmed by the platform.", { timeout: 60_000 });
    await expect(page.locator("[data-pending-count]")).toHaveAttribute("data-pending-count", "1");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    expect(await record("pinned-127", held)).toMatchObject({ headVersion: 1, tailCommits: THRESHOLD - 1, checkpointFrontier: below.checkpointFrontier });

    const first = await untilCompacted("first-compaction", below.checkpointFrontier);
    expect(first.auditPages).toBeGreaterThan(0);
    expect(first.originalCommits).toBeGreaterThanOrEqual(THRESHOLD);
    await idle();
    expect(await observe("empty-tail")).toMatchObject({ headVersion: 2, tailCommits: 0, checkpointFrontier: first.checkpointFrontier });

    await edit(THRESHOLD - 1);
    expect(await observe("second-127")).toMatchObject({ headVersion: 2, tailCommits: THRESHOLD - 1, checkpointFrontier: first.checkpointFrontier });
    await edit(1);
    // The eligible job is cut off by worker termination and retried by the next unlocked worker.
    await live.close();
    live = await openProductionPage(context);
    page = live.page;
    page.setDefaultTimeout(20_000);
    await attemptUnlock(page, PASSPHRASE);
    await expect(screen(page, "SCR-010")).toBeVisible({ timeout: 90_000 });
    const second = await untilCompacted("second-compaction", first.checkpointFrontier);
    expect(second.originalCommits).toBe(first.originalCommits + THRESHOLD);
    await followHash(page, recordHash);
    await expect(screen(page, "SCR-027")).toContainText(`$${amount.toLocaleString("en-US")}.00`);
    await followHash(page, `${appHash}/history`);
    await expect(page.locator("[data-event]").first()).toContainText("Record changed");
    await writeDurabilityEvidence("cp3-periodic-compaction", { endpoint: new URL(page.url()).origin, workerUrl: live.worker.url(), assets: live.assets,
      buildId: await page.evaluate(() => window.__sheafBuildId), threshold: THRESHOLD, intervalMs: INTERVAL_MS, observations,
      quotaRefusal: "not inducible in Playwright Chromium: Storage.overrideQuotaForOrigin is accepted but estimate() and IndexedDB writes ignore it; proven in tests/unit/workers/compaction.test.ts" }, "s06");
  } finally { await live.close().catch(() => undefined); await context.close(); await decoder.close(); }
});
