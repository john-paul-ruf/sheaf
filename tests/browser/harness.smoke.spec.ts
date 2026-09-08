import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import sodium from "libsodium-wrappers-sumo";
import type { CURRENT_FORMAT_VERSIONS } from "../../src/migrations/index.js";

/**
 * The prerequisite mechanism cited by SESSION-04 CP3, SESSION-05 CP2/CP3 and
 * SESSION-07: a real module and a real worker reached from built output.
 */
const MIGRATIONS_SPECIFIER = "/src/migrations/index.ts";
const PROBE_SPECIFIER = "/src/harness/probe.worker.ts";
const PROBE_INPUT = "sheaf-harness-probe";

const headRevision = execSync("git rev-parse HEAD").toString().trim();

test.beforeEach(async ({ page }) => {
  await page.goto("/harness.html");
});

test("serves the harness built from the current revision", async ({ page }) => {
  await expect
    .poll(async () => page.evaluate(() => window.__sheafBuildId))
    .toBe(headRevision);

  expect(
    await page.evaluate(() => window.__sheafHarness.buildId),
  ).toBe(headRevision);
});

test("loads a real module from built output", async ({ page }) => {
  expect(await page.evaluate(() => window.__sheafHarness.listModules())).toContain(
    MIGRATIONS_SPECIFIER,
  );

  const versions = await page.evaluate(async (specifier) => {
    const loaded = await window.__sheafHarness.module<{
      CURRENT_FORMAT_VERSIONS: typeof CURRENT_FORMAT_VERSIONS;
    }>(specifier);
    return loaded.CURRENT_FORMAT_VERSIONS;
  }, MIGRATIONS_SPECIFIER);

  expect(versions.envelope).toBe(1);
});

test("spawns a real worker from built output", async ({ page }) => {
  expect(await page.evaluate(() => window.__sheafHarness.listWorkers())).toContain(
    PROBE_SPECIFIER,
  );

  const message = await page.evaluate(async (specifier) => {
    const worker = window.__sheafHarness.worker(specifier);
    try {
      return await new Promise<unknown>((resolve, reject) => {
        worker.addEventListener("message", (event: MessageEvent<unknown>) => {
          resolve(event.data);
        });
        worker.addEventListener("error", (event) => {
          reject(new Error(event.message));
        });
      });
    } finally {
      worker.terminate();
    }
  }, PROBE_SPECIFIER);

  await sodium.ready;
  expect(message).toEqual({
    input: PROBE_INPUT,
    hash: sodium.crypto_generichash(32, PROBE_INPUT, null, "hex"),
  });
});

test("names the mechanism when a specifier is unknown", async ({ page }) => {
  const failure = await page.evaluate(async () => {
    try {
      await window.__sheafHarness.module("/src/nope.ts");
      return "no error";
    } catch (cause) {
      return String(cause);
    }
  });

  expect(failure).toContain("/src/nope.ts");
  expect(failure).toContain(MIGRATIONS_SPECIFIER);
});

test("stays out of the production entry graph", async ({ page }) => {
  await page.goto("/");

  expect(
    await page.evaluate(() => typeof window.__sheafHarness),
  ).toBe("undefined");
  expect(await page.evaluate(() => window.__sheafBuildId)).toBe(headRevision);
});
