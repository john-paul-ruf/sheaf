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
