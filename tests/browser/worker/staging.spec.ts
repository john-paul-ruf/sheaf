/**
 * CA-10 / CAP-11 at the worker tier, in a real browser (S04 CP3).
 *
 * Everything below is production code doing production work: the real import
 * worker built by Vite, a real `MessageChannel` the page created, the real
 * data worker, real libsodium, and real IndexedDB. The only test-shaped thing
 * is where the file comes from — a fixture handed across node-side, which is
 * exactly the `File` the picker would have produced.
 */

import { expect, test } from "@playwright/test";
import {
  PASSPHRASE,
  command,
  installFixture,
  installSyntheticFixture,
  readStore,
  runImport,
  start,
  teardown,
} from "./runtime.js";

/** Argon2id at setup plus a full parse; generous, and far under a hang. */
const JOURNEY_TIMEOUT_MS = 180_000;

test.beforeEach(async ({ page }) => {
  await page.goto("/harness.html");
});

test.afterEach(async ({ page }) => {
  await teardown(page);
});

async function unlockedPage(page: import("@playwright/test").Page): Promise<void> {
  await start(page);
  const created = await command(page, { kind: "setup", passphrase: PASSPHRASE });
  expect(created.ok).toBe(true);
}

test("the import worker is a real second worker in the built output", async ({
  page,
}) => {
  const workers = await page.evaluate(() =>
    window.__sheafHarness.listWorkers(),
  );
  // D11: the workers glob reaches it with no build-input edit.
  expect(workers).toContain("/src/workers/import.worker.ts");
});

test("the built import-worker chunk contains neither dexie nor libsodium", async ({
  page,
}) => {
  // The source-level proof is `tests/unit/workers/module-boundaries.test.ts`.
  // This is the other half: what Vite actually emitted, fetched from the
  // preview server that is serving this very build.
  const report = await page.evaluate(async () => {
    const workers = window.__sheafHarness.listWorkers();
    if (!workers.includes("/src/workers/import.worker.ts")) {
      return { found: false, hasDexie: false, hasSodium: false, bytes: 0 };
    }

    // Vite names a worker chunk after its entry file, so the emitted asset is
    // `assets/import.worker-<hash>.js`. The harness page lists every asset it
    // was built with; find the one the worker entry produced.
    // Minified output quotes with `"`, `'` **and** backticks — the worker URL
    // in particular lands in a template literal — so all three count.
    const assetsIn = (text: string): string[] => [
      // A static import is `"./name-hash.js"`.
      ...[...text.matchAll(/["'`](\.\/[^"'`]+\.js)["'`]/g)].map(
        (match) => `/assets/${(match[1] as string).slice(2)}`,
      ),
      // A worker entry is `new Worker(new URL(`/assets/name-hash.js`, …))`.
      ...[...text.matchAll(/["'`](\/assets\/[^"'`]+\.js)["'`]/g)].map(
        (match) => match[1] as string,
      ),
    ];

    const listing = await (await fetch("/harness.html")).text();
    const seen = new Set<string>();
    const queue = assetsIn(listing);
    while (queue.length > 0) {
      const url = queue.pop() as string;
      if (seen.has(url)) {
        continue;
      }
      seen.add(url);
      queue.push(...assetsIn(await (await fetch(url)).text()));
    }

    const chunkUrl = [...seen].find((url) =>
      url.includes("/assets/import.worker-"),
    );
    if (chunkUrl === undefined) {
      return { found: false, hasDexie: false, hasSodium: false, bytes: 0 };
    }

    const chunk = await (await fetch(chunkUrl)).text();
    return {
      found: true,
      // Dexie's and libsodium's own identifying strings; either would mean the
      // parser's bundle carries the database or the cipher.
      hasDexie: /DexieError|IDBKeyRange|indexedDB\.open/.test(chunk),
      hasSodium: /crypto_aead_xchacha20poly1305|libsodium|_sodium/.test(chunk),
      bytes: chunk.length,
    };
  });

  expect(report.found).toBe(true);
  expect(report.bytes).toBeGreaterThan(1000);
  expect(report.hasDexie).toBe(false);
  expect(report.hasSodium).toBe(false);
});

test("a workbook format is refused before any stage exists", async ({ page }) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await unlockedPage(page);

  const before = await readStore(page);
  await installFixture(page, "refusals/fieldwork.xlsx", "fieldwork.xlsx");
  const run = await runImport(page);

  const refused = run.events.find((event) => event.kind === "refused");
  expect(refused).toBeDefined();
  if (refused?.kind !== "refused") {
    throw new Error("expected a refusal");
  }
  expect(refused.refusal.kind).toBe("workbook-format-later-release");
  expect(refused.refusal.fileName).toBe("fieldwork.xlsx");

  // FR-2, structurally: no stage was created, so there is nothing to clean up.
  expect(run.stageId).toBeNull();
  const after = await readStore(page);
  expect(after.envelopes).toHaveLength(before.envelopes.length);
  expect(after.transactionRevision).toBe(before.transactionRevision);
});

test("batches commit one at a time, ack-gated, and the revision advances per batch", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await unlockedPage(page);

  const before = await readStore(page);
  await installFixture(page, "delimited/large-sample.csv", "large-sample.csv");
  const run = await runImport(page);

  const completed = run.events.find((event) => event.kind === "completed");
  expect(completed).toBeDefined();
  if (completed?.kind !== "completed") {
    throw new Error("expected the run to complete");
  }
  expect(run.stageId).not.toBeNull();

  // Backpressure: the acked count only ever moves up by one. A parser that
  // ran ahead of its acks would show a jump.
  const steps = run.ackTrace.filter((value, index) =>
    index === 0 ? true : value !== run.ackTrace[index - 1],
  );
  for (const [index, value] of steps.entries()) {
    expect(value).toBe(index === 0 ? steps[0] : (steps[index - 1] as number) + 1);
  }
  expect(Math.max(...run.ackTrace)).toBe(completed.batchesSent);

  const stage = await command(page, {
    kind: "getImportStage",
    stageId: run.stageId as string,
  });
  if (!stage.ok || stage.response.kind !== "getImportStage") {
    throw new Error("expected a stage view");
  }
  expect(stage.response.stage).not.toBeNull();
  // Every batch the parser sent is durable: acked means committed (CA-10).
  expect(stage.response.stage?.batchesCommitted).toBe(completed.batchesSent);
  expect(stage.response.stage?.factChunkCount).toBe(completed.batchesSent);
  expect(stage.response.stage?.status).toBe("staged");
  expect(stage.response.stage?.rowsSoFar).toBeGreaterThan(0);

  // One commit per batch, so the store's revision moved by at least that much.
  const after = await readStore(page);
  expect((after.transactionRevision as number) - (before.transactionRevision as number))
    .toBeGreaterThanOrEqual(completed.batchesSent);
  // Still no app: staging creates nothing the library can show.
  const status = await command(page, { kind: "getStatus" });
  if (!status.ok || status.response.kind !== "getStatus") {
    throw new Error("expected a status");
  }
  expect(
    status.response.status.state === "unlocked" && status.response.status.appCount,
  ).toBe(0);
});

test("cancelling mid-parse returns the store to its pre-import row count", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await unlockedPage(page);

  const before = await readStore(page);
  // Enough rows to make many batches, so the cancel lands mid-parse rather
  // than after a file that was already finished.
  await installSyntheticFixture(page, { rows: 4000 });
  const run = await runImport(page, { cancelAfterBatches: 2 });

  const cancelled = run.events.find((event) => event.kind === "cancelled");
  expect(cancelled).toBeDefined();
  expect(run.stageId).not.toBeNull();

  const receipt = await command(page, {
    kind: "cancelImportStage",
    stageId: run.stageId as string,
  });
  if (!receipt.ok || receipt.response.kind !== "cancelImportStage") {
    throw new Error("expected a cleanup receipt");
  }
  expect(receipt.response.receipt.completed).toBe(true);

  // The stage is gone, truthfully rather than as an error.
  const gone = await command(page, {
    kind: "getImportStage",
    stageId: run.stageId as string,
  });
  if (!gone.ok || gone.response.kind !== "getImportStage") {
    throw new Error("expected a stage view");
  }
  expect(gone.response.stage).toBeNull();

  // Every row the import wrote is absent. What remains beyond the starting
  // count is exactly the superseded catalogs, which F01's `updateSettings`
  // leaves behind too; F05's mark-and-sweep collects those.
  const after = await readStore(page);
  const catalogsWritten =
    (after.transactionRevision as number) - (before.transactionRevision as number);
  expect(after.envelopes.length).toBe(before.envelopes.length + catalogsWritten);
  expect(after.envelopeFields).toEqual(before.envelopeFields);
});
