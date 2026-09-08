import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import sodium from "libsodium-wrappers-sumo";
import { build } from "vite";
import { SMOKE_WORKER_INPUT } from "./fixtures/smoke-input.js";

/**
 * The fixture page module is built into `dist/` at test time rather than
 * declared as a rollup input: it is test-only and must never ship inside the
 * product artifact (it would carry a second copy of libsodium into F08's
 * precache). The build below uses the same worker/target settings as
 * `vite.config.ts`.
 */
const FIXTURE_BASE = "/__fixtures__/";
const FIXTURE_ENTRY_URL = `${FIXTURE_BASE}smoke.entry.js`;

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

let expectedDigest = "";

test.beforeAll(async () => {
  await build({
    configFile: false,
    root: repositoryRoot,
    base: FIXTURE_BASE,
    logLevel: "warn",
    worker: { format: "es" },
    build: {
      outDir: `dist${FIXTURE_BASE}`,
      emptyOutDir: true,
      target: ["safari17", "chrome120", "firefox122"],
      rollupOptions: {
        input: fileURLToPath(
          new URL("./fixtures/smoke.entry.ts", import.meta.url),
        ),
        output: { entryFileNames: "smoke.entry.js" },
      },
    },
  });

  await sodium.ready;
  expectedDigest = sodium.crypto_generichash(
    32,
    SMOKE_WORKER_INPUT,
    null,
    "hex",
  );
});

test("the served page has the runtime capabilities Sheaf requires", async ({
  page,
}) => {
  await page.goto("/");

  await expect
    .poll(async () =>
      page.evaluate(() => ({
        secureContext: window.isSecureContext,
        indexedDB: typeof indexedDB !== "undefined",
        webAssembly: typeof WebAssembly !== "undefined",
        dedicatedWorker: typeof Worker !== "undefined",
      })),
    )
    .toEqual({
      secureContext: true,
      indexedDB: true,
      webAssembly: true,
      dedicatedWorker: true,
    });
});

test("a module worker built by Vite initializes libsodium WASM", async ({
  page,
}) => {
  await page.goto("/");
  await page.addScriptTag({ type: "module", url: FIXTURE_ENTRY_URL });

  const message = await page.evaluate(
    async () => window.__sheafSmokeWorkerResult,
  );

  expect(message).toEqual({ hash: expectedDigest });
});
