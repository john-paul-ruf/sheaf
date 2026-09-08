import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { ProjectionWorkerResultV1 } from "./fixtures/projection.worker.js";

/**
 * The projection where it will actually live: inside a real dedicated module
 * worker, built by the production pipeline.
 *
 * `engine.spec.ts` proves the engine's semantics on the harness page. This file
 * proves the context: that `@sqlite.org/sqlite-wasm`, the vendored `.wasm`, the
 * `?raw` migration asset, and M12's whole import graph resolve and run inside a
 * worker — which is the only place M12 is allowed to run, and what S05 needs
 * before composing it into `data.worker.ts`.
 *
 * The fixture is built through the **production `vite.config.ts`** (passed as
 * `configFile`), so `worker.format`, `assetsInclude`, and the build target are
 * the ones `pnpm build` uses; only the rollup input and output directory differ.
 * That follows S01's sqlite smoke exactly, and for the same reason: the probe is
 * test-only and must never ship inside the product artifact.
 */
const FIXTURE_BASE = "/__projection__/";
const FIXTURE_ENTRY_URL = `${FIXTURE_BASE}projection.entry.js`;

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixtureOutDir = fileURLToPath(
  new URL(`../../../dist${FIXTURE_BASE}`, import.meta.url),
);

declare global {
  interface Window {
    __sheafProjectionWorkerResult: Promise<unknown>;
  }
}

test.beforeAll(async () => {
  await build({
    configFile: fileURLToPath(new URL("../../../vite.config.ts", import.meta.url)),
    root: repositoryRoot,
    base: FIXTURE_BASE,
    logLevel: "warn",
    build: {
      outDir: `dist${FIXTURE_BASE}`,
      emptyOutDir: true,
      rollupOptions: {
        input: fileURLToPath(
          new URL("./fixtures/projection.entry.ts", import.meta.url),
        ),
        output: { entryFileNames: "projection.entry.js" },
      },
    },
  });
});

test("the projection's own build graph vendors the sqlite WASM binary", async () => {
  const entries = await readdir(fixtureOutDir, {
    withFileTypes: true,
    recursive: true,
  });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

  // M12 is now the importer of sqlite-wasm, so the binary must travel with it.
  expect(files.filter((name) => name.endsWith(".wasm"))).toHaveLength(1);
});

test("hydrates an app inside a real dedicated module worker", async ({ page }) => {
  const requestedOrigins = new Set<string>();
  page.on("request", (request) => {
    requestedOrigins.add(new URL(request.url()).origin);
  });

  await page.goto("/");
  await page.addScriptTag({ type: "module", url: FIXTURE_ENTRY_URL });

  const message = await page.evaluate(
    async () => window.__sheafProjectionWorkerResult,
  );

  expect(message).toEqual({
    ok: true,
    result: {
      userVersion: 1,
      recordCount: 2,
      // Migration 005's `cells` CHECK: `length(decimal_order_key) = 20`.
      decimalKeyBytes: 20,
      // Both rows are named "Row …", and FTS found both through the join.
      searchHit: 2,
      memoryOnly: true,
      disposedAfterClose: true,
    } satisfies Record<keyof ProjectionWorkerResultV1, unknown>,
  });

  // Invariant 12 and the vendoring rule: nothing was fetched from a CDN.
  expect([...requestedOrigins]).toEqual([new URL(page.url()).origin]);
});
