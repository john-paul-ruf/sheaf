import { createHash } from "node:crypto";
import { readdir, readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type BrowserContext } from "@playwright/test";

export function buildBundleReader(): void {
  execFileSync("pnpm", ["exec", "vite", "build", "--config", "tests/browser/sync/fixtures/bundle-reader.config.ts"], { stdio: "pipe" });
}

export async function readBundle(context: BrowserContext, bytes: Uint8Array, value: string, kind: "passphrase" | "recovery" = "passphrase"): Promise<string> {
  const page = await context.newPage();
  try {
    await page.goto("/f05-reader/bundle-reader.html");
    await expect.poll(() => page.evaluate(() => "readBundle" in window)).toBe(true);
    return await page.evaluate(({ bytes, secret }) => (window as unknown as {
      readBundle(bytes: number[], secret: { kind: "passphrase" | "recovery"; value: string }): Promise<string>;
    }).readBundle(bytes, secret), { bytes: Array.from(bytes), secret: { kind, value } });
  } finally { await page.close(); }
}

export async function inspectDurability(page: Page, label: string): Promise<void> {
  for (const width of [320, 600, 900, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `test-results/f05/s02/${label}-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ html }) => html) }))).toEqual([]);
  }
  if (await page.getByRole("dialog").count()) {
    await page.keyboard.press("Tab");
    expect(await page.getByRole("dialog").evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Shift+Tab");
    expect(await page.getByRole("dialog").evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  }
}


export async function writeDurabilityEvidence(name: string, facts: Record<string, unknown>): Promise<void> {
  const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  async function files(path: string): Promise<string[]> {
    if (!(await stat(path)).isDirectory()) return [path];
    return (await Promise.all((await readdir(path)).sort().map((child) => files(`${path}/${child}`)))).flat();
  }
  async function identity(paths: string[]) {
    const entries = (await Promise.all(paths.map(files))).flat().sort();
    const hashes = await Promise.all(entries.map(async (path) => [path, digest(await readFile(path))]));
    return { sha256: digest(JSON.stringify(hashes)), files: hashes };
  }
  await mkdir("test-results/f05/s02", { recursive: true });
  await writeFile(`test-results/f05/s02/${name}.json`, JSON.stringify({ ...facts,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    source: await identity(["src"]),
    configuration: await identity(["vite.config.ts", "playwright.config.ts", "src/config/public-config.ts", "tests/browser/sync/fixtures/bundle-reader.config.ts"]),
    fixtures: await identity(["tests/browser/sync/fixtures", "tests/e2e/fixtures/durability.ts", "tests/e2e/bundle-backup.spec.ts", "tests/e2e/recovery-countdown.spec.ts", "tests/browser/sync/bundle.spec.ts"]),
    output: await identity(["dist"]),
  }, null, 2));
}

export async function boundedReminder<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Error("reminder worker operation exceeded 10 seconds")); }, 10_000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Controls the production worker's dynamic ClockPort; storage and transport stay real. */
export async function openReminderPage(context: BrowserContext) {
  const names = await readdir("dist/assets");
  const unique = (prefix: string) => {
    const matches = names.filter((name) => name.startsWith(prefix) && name.endsWith(".js"));
    if (matches.length !== 1) throw new Error(`expected one emitted ${prefix} asset`);
    return matches[0]!;
  };
  const workerAsset = unique("data.worker-");
  const bootstrapAsset = unique("app-bootstrap-");
  const mainAsset = unique("main-");
  const bootstrap = await readFile(`dist/assets/${bootstrapAsset}`, "utf8");
  if (!bootstrap.includes(workerAsset)) throw new Error("bootstrap does not name the emitted data worker");
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const arrived = page.waitForEvent("worker", { predicate: (worker) => new URL(worker.url()).pathname === `/assets/${workerAsset}`, timeout: 10_000 });
  await page.goto("/");
  const worker = await arrived;
  const matches = page.workers().filter((candidate) => candidate.url() === worker.url());
  if (matches.length !== 1 || !/^https?:/.test(worker.url()) || new URL(worker.url()).origin !== new URL(page.url()).origin) {
    throw new Error("unexpected or duplicate production data worker");
  }
  const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const assets: Record<string, string> = {};
  for (const path of ["index.html", `assets/${mainAsset}`, `assets/${bootstrapAsset}`, `assets/${workerAsset}`]) {
    const local = await readFile(`dist/${path}`);
    const response = await page.request.get(`/${path}`, { timeout: 10_000 });
    if (!response.ok() || digest(await response.body()) !== digest(local)) throw new Error(`served build differs: ${path}`);
    assets[path] = digest(local);
  }
  let closed = false;
  const closedPromise = new Promise<void>((resolve) => worker.once("close", () => { closed = true; resolve(); }));
  const ensureLive = () => { if (closed || page.isClosed()) throw new Error("reminder worker closed"); };
  const clock = {
    worker,
    async readEpochMs() { ensureLive(); return boundedReminder(worker.evaluate(() => Date.now())); },
    async setEpochMs(epochMs: number) {
      ensureLive();
      if (!Number.isSafeInteger(epochMs) || epochMs < 0) throw new Error("invalid reminder epoch");
      await boundedReminder(worker.evaluate((epoch) => {
        const realm = globalThis as unknown as { reminderOriginalNow?: PropertyDescriptor };
        realm.reminderOriginalNow ??= Object.getOwnPropertyDescriptor(Date, "now")!;
        Object.defineProperty(Date, "now", { configurable: true, writable: true, value: () => epoch });
      }, epochMs));
      expect(await clock.readEpochMs()).toBe(epochMs);
    },
    async restore() {
      ensureLive();
      await boundedReminder(worker.evaluate(() => {
        const realm = globalThis as unknown as { reminderOriginalNow?: PropertyDescriptor };
        if (realm.reminderOriginalNow !== undefined) {
          Object.defineProperty(Date, "now", realm.reminderOriginalNow);
          delete realm.reminderOriginalNow;
        }
      }));
    },
  };
  return { page, clock, assets, async close() {
    if (!closed && !page.isClosed()) await clock.restore();
    if (!page.isClosed()) await boundedReminder(page.close());
    await boundedReminder(closedPromise);
  } };
}

/** Only call at a known successful authored-save boundary in an older journey. */
export async function dismissExpectedScratchReminder(page: Page): Promise<void> {
  await expect(page.locator("[data-reminder-state]")).toHaveAttribute("data-reminder-state", "ready");
  const reminder = page.locator("[data-scratch-reminder]");
  if (await reminder.count()) {
    await reminder.getByRole("button", { name: "Keep working", exact: true }).click();
    await expect(reminder).toHaveCount(0);
    await expect(page.locator("[data-reminder-state]")).toHaveAttribute("data-reminder-state", "ready");
  }
}

export async function writeReminderEvidence(page: Page, name: string, facts: Record<string, unknown>): Promise<void> {
  const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
  const dirty = execFileSync("git", ["ls-files", "--modified", "--others", "--exclude-standard", "--", "src", "tests"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const paths = [...dirty, "playwright.config.ts", "vite.config.ts", "package.json", "pnpm-lock.yaml"];
  const digests = await Promise.all(paths.map(async (path) => [path, hash(await readFile(path))]));
  const buildId = await page.evaluate(() => (window as unknown as { __sheafBuildId: string }).__sheafBuildId);
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  expect(buildId).toBe(revision);
  await mkdir("test-results/f05/s03", { recursive: true });
  await writeFile(`test-results/f05/s03/${name}.json`, JSON.stringify({ ...facts, revision, buildId, endpoint: page.url(), digests }, null, 2));
}
