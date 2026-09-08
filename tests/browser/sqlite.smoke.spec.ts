import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { SqliteProbeResultV1 } from "./fixtures/sqlite.worker.js";

/**
 * D16's gate: `@sqlite.org/sqlite-wasm` initializes in a real browser, inside a
 * real dedicated module worker, from built output — before M12 (S02) or any
 * consumer depends on it.
 *
 * The fixture is built through the **production `vite.config.ts`** (passed as
 * `configFile`, not `configFile: false`), so the plugin set, `worker.format`,
 * `assetsInclude`, and build target that resolve sqlite-wasm here are literally
 * the ones `pnpm build` uses; only the rollup input and output directory are
 * overridden. A fixture entry is still used rather than a rollup input in
 * `vite.config.ts` because the probe is test-only and must never ship inside
 * the product artifact (F08 precaches `dist/`).
 */
const FIXTURE_BASE = "/__sqlite__/";
const FIXTURE_ENTRY_URL = `${FIXTURE_BASE}sqlite.entry.js`;

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixtureOutDir = fileURLToPath(
  new URL(`../../dist${FIXTURE_BASE}`, import.meta.url),
);

const listOutputFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, {
    withFileTypes: true,
    recursive: true,
  });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
};

test.beforeAll(async () => {
  await build({
    configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
    root: repositoryRoot,
    base: FIXTURE_BASE,
    logLevel: "warn",
    build: {
      outDir: `dist${FIXTURE_BASE}`,
      emptyOutDir: true,
      rollupOptions: {
        input: fileURLToPath(
          new URL("./fixtures/sqlite.entry.ts", import.meta.url),
        ),
        output: { entryFileNames: "sqlite.entry.js" },
      },
    },
  });
});

test("the production build vendors the sqlite WASM binary", async () => {
  const files = await listOutputFiles(fixtureOutDir);

  expect(files.filter((name) => name.endsWith(".wasm"))).toHaveLength(1);
});

test("sqlite-wasm opens an in-memory database with FTS5 in a module worker", async ({
  page,
}) => {
  const requestedOrigins = new Set<string>();
  page.on("request", (request) => {
    requestedOrigins.add(new URL(request.url()).origin);
  });

  await page.goto("/");
  await page.addScriptTag({ type: "module", url: FIXTURE_ENTRY_URL });

  const message = await page.evaluate(
    async () => window.__sheafSqliteProbeResult,
  );

  expect(message).toEqual({
    ok: true,
    result: {
      libVersion: expect.stringMatching(/^3\.\d+\.\d+$/) as unknown as string,
      selectOne: 1,
      hasFts5: true,
      ftsMatchedRowId: 7,
      userVersionAfterSet: 1,
      memoryOnly: true,
    } satisfies Record<keyof SqliteProbeResultV1, unknown>,
  });

  // Invariant 12 / the vendoring rule: nothing was fetched from a CDN.
  expect([...requestedOrigins]).toEqual([new URL(page.url()).origin]);
});
