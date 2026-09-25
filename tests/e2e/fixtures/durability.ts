import { createHash } from "node:crypto";
import { readdir, readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type BrowserContext } from "@playwright/test";

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

export async function inspectDurability(page: Page, label: string, destination: "s02" | "s06" = "s02"): Promise<void> {
  await mkdir(`test-results/f05/${destination}`, { recursive: true });
  for (const width of [320, 600, 900, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `test-results/f05/${destination}/${label}-${width}.png`, fullPage: true });
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


export async function writeDurabilityEvidence(name: string, facts: Record<string, unknown>, destination: "s02" | "s06" = "s02"): Promise<void> {
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
  await mkdir(`test-results/f05/${destination}`, { recursive: true });
  await writeFile(`test-results/f05/${destination}/${name}.json`, JSON.stringify({ ...facts,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    source: await identity(["src"]),
    configuration: await identity(["package.json", "pnpm-lock.yaml", "vite.config.ts", "playwright.config.ts", "src/config/public-config.ts", "tests/browser/sync/fixtures/bundle-reader.config.ts"]),
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

/**
 * Opens `/` and identifies the one same-origin data worker the production
 * bootstrap creates, after proving every served entry asset equals the
 * emitted `dist` file. `override` values exist only for negative controls.
 */
export async function openProductionPage(context: BrowserContext, override?: { readonly workerAsset?: string; readonly localAssets?: string }) {
  const names = await readdir("dist/assets");
  const unique = (prefix: string) => {
    const matches = names.filter((name) => name.startsWith(prefix) && name.endsWith(".js"));
    if (matches.length !== 1) throw new Error(`expected one emitted ${prefix} asset`);
    return matches[0]!;
  };
  const workerAsset = override?.workerAsset ?? unique("data.worker-");
  const bootstrapAsset = unique("app-bootstrap-");
  const mainAsset = unique("main-");
  const ioAsset = names.find((name) => name.startsWith("io.worker-") && name.endsWith(".js"));
  const bootstrap = await readFile(`dist/assets/${bootstrapAsset}`, "utf8");
  if (!bootstrap.includes(workerAsset)) throw new Error("bootstrap does not name the emitted data worker");
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const arrived = page.waitForEvent("worker", { predicate: (worker) => new URL(worker.url()).pathname === `/assets/${workerAsset}`, timeout: 10_000 });
  try {
    const [, worker] = await Promise.all([page.goto("/"), arrived]);
    const matches = page.workers().filter((candidate) => candidate.url() === worker.url());
    if (matches.length !== 1 || !/^https?:/.test(worker.url()) || new URL(worker.url()).origin !== new URL(page.url()).origin) {
      throw new Error("unexpected or duplicate production data worker");
    }
    const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    const assets: Record<string, string> = {};
    for (const path of ["index.html", `assets/${mainAsset}`, `assets/${bootstrapAsset}`, `assets/${workerAsset}`, ...(ioAsset === undefined ? [] : [`assets/${ioAsset}`])]) {
      const local = await readFile(`${override?.localAssets ?? "dist"}/${path}`);
      const response = await page.request.get(`/${path}`, { timeout: 10_000 });
      if (!response.ok() || digest(await response.body()) !== digest(local)) throw new Error(`served build differs: ${path}`);
      assets[path] = digest(local);
    }
    let closed = false;
    const closedPromise = new Promise<void>((resolve) => worker.once("close", () => { closed = true; resolve(); }));
    return { page, worker, assets, isClosed: () => closed, closedPromise, async close() {
      if (!page.isClosed()) await boundedReminder(page.close());
      await boundedReminder(closedPromise);
    } };
  } catch (error) {
    if (!page.isClosed()) await page.close();
    throw error;
  }
}

/** Controls the production worker's dynamic ClockPort; storage and transport stay real. */
export async function openReminderPage(context: BrowserContext) {
  let opened: Awaited<ReturnType<typeof openProductionPage>>;
  try { opened = await openProductionPage(context); } catch (error) { await context.close(); throw error; }
  const { page, worker, assets, closedPromise } = opened;
  try {
    const ensureLive = () => { if (opened.isClosed() || page.isClosed()) throw new Error("reminder worker closed"); };
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
      try { if (!opened.isClosed() && !page.isClosed()) await clock.restore(); }
      finally {
        if (!page.isClosed()) await boundedReminder(page.close());
        await boundedReminder(closedPromise);
      }
    } };
  } catch (error) {
    await context.close();
    throw error;
  }
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
  const paths = [...dirty, "playwright.config.ts", "vite.config.ts", "src/config/public-config.ts", "package.json", "pnpm-lock.yaml"];
  const digests = await Promise.all(paths.map(async (path) => [path, hash(await readFile(path))]));
  const buildId = await page.evaluate(() => (window as unknown as { __sheafBuildId: string }).__sheafBuildId);
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  expect(buildId).toBe(revision);
  await mkdir("test-results/f05/s03", { recursive: true });
  const evidence = JSON.stringify({ ...facts, revision, buildId, endpoint: page.url(), digests }, null, 2);
  const attachment = test.info().outputPath(`${name}.json`);
  await writeFile(attachment, evidence);
  await test.info().attach(name, { path: attachment, contentType: "application/json" });
  await writeFile(`test-results/f05/s03/${name}.json`, evidence);
}

export async function inspectReminderStatus(page: Page, label: string): Promise<void> {
  for (const width of [320, 600, 900, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ html }) => html) }))).toEqual([]);
    await page.screenshot({ path: `test-results/f05/s03/${label}-${width}.png`, fullPage: true });
  }
}

/**
 * A native save destination whose written bytes the test reads back; no download dialog or confirmation step.
 * Setting `window.holdSave` keeps the transfer (and its backup pin) open until `window.releaseSave()`.
 */
export async function useNativeDestination(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: () => Promise.resolve({
      createWritable: () => Promise.resolve({
        write: async (blob: Blob) => {
          const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
          if ((window as unknown as { holdSave?: boolean }).holdSave === true) {
            await new Promise<void>((resolve) => { Object.assign(window, { heldBundle: bytes, releaseSave: resolve }); });
          }
          Object.assign(window, { savedBundle: bytes });
        },
        close: () => Promise.resolve(),
        abort: () => { Object.assign(window, { savedBundle: undefined }); return Promise.resolve(); },
      }),
    }) });
  });
}

async function nativeSave(page: Page): Promise<Buffer> {
  await page.evaluate(() => { Object.assign(window, { savedBundle: undefined }); });
  await page.getByRole("button", { name: "Choose destination" }).click();
  await expect(page.getByRole("dialog")).toContainText("Save confirmed by the platform.", { timeout: 60_000 });
  const bytes = Buffer.from(await page.evaluate(() => (window as unknown as { savedBundle: number[] }).savedBundle));
  await expect(page.locator("[data-pending-count]")).toHaveAttribute("data-pending-count", "0");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return bytes;
}

/** Creates a named bundle vault from the app home and saves the first artifact to the native destination. */
export async function createNativeBundleHome(page: Page, appHash: string, vaultName: string, secret: string): Promise<Buffer> {
  await page.evaluate((hash) => { window.location.hash = hash; }, appHash);
  await page.getByRole("link", { name: "Choose a durable home" }).click();
  await page.getByRole("button", { name: "Save a bundle", exact: true }).click();
  await page.getByLabel("Vault name", { exact: true }).fill(vaultName);
  await page.getByRole("radio", { name: "Create a different passphrase" }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel(`${vaultName} vault passphrase`, { exact: true }).fill(secret);
  await page.getByLabel(`Confirm ${vaultName} vault passphrase`, { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Create vault", exact: true }).click();
  await page.getByRole("checkbox", { name: "I saved this code", exact: true }).check();
  await page.getByRole("button", { name: "Continue to bundle" }).click();
  return nativeSave(page);
}

/** One complete "Save a fresh bundle" operation through the real IO transfer; it finishes before returning. */
export async function saveFreshNativeBundle(page: Page, appHash: string): Promise<Buffer> {
  await page.evaluate((hash) => { window.location.hash = hash; }, `${appHash}/backup`);
  await page.getByRole("button", { name: "Save a fresh bundle", exact: true }).click();
  return nativeSave(page);
}

export interface DecodedGraphFactsV1 {
  readonly headVersion: number;
  readonly checkpointFrontier: readonly { readonly deviceId: string; readonly commitSequence: string }[];
  readonly frontier: readonly { readonly deviceId: string; readonly commitSequence: string }[];
  /** Commits strictly after the checkpoint frontier, counted from the decoded tail segments. */
  readonly tailCommits: number;
  readonly auditPages: number;
  readonly originalCommits: number;
}

/** Facts from one independent vault-only decode (see `readBundle`), never from the live context. */
export function decodedGraphFacts(decoded: string): DecodedGraphFactsV1 {
  type Entry = { deviceId: number[]; commitSequence: string };
  const json = JSON.parse(decoded) as { head: { headVersion?: string | number; auditPages?: unknown[] }; checkpoint: { frontier: Entry[] };
    events: { commits: { deviceId: number[]; deviceCommitSequence: string }[] }[]; frontier: Entry[]; originalCommits: unknown[] };
  const key = (id: number[]) => Buffer.from(id).toString("base64url");
  const covered = new Map(json.checkpoint.frontier.map((entry) => [key(entry.deviceId), BigInt(entry.commitSequence)]));
  const tailCommits = json.events.flatMap((segment) => segment.commits)
    .filter((commit) => BigInt(commit.deviceCommitSequence) > (covered.get(key(commit.deviceId)) ?? 0n)).length;
  const entries = (list: Entry[]) => list.map((entry) => ({ deviceId: key(entry.deviceId), commitSequence: String(entry.commitSequence) }));
  return { headVersion: Number(json.head.headVersion ?? 1), checkpointFrontier: entries(json.checkpoint.frontier), frontier: entries(json.frontier),
    tailCommits, auditPages: json.head.auditPages?.length ?? 0, originalCommits: json.originalCommits.length };
}
