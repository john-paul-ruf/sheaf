/**
 * The first narrow journey, worker level (CAP-01/02/03, CA-01/02/03/04).
 *
 * setup → settings write → lock → unlock → restart → unlock, against a real
 * dedicated worker, real libsodium WASM, and real IndexedDB in a real browser.
 * Nothing here is mocked: `startApp()` constructs the production
 * `DataWorkerClient`, which spawns the production `src/workers/data.worker.ts`
 * built by Vite from this same build.
 *
 * The entry is S01's harness page (D11/F-01): `dist/` is built from
 * `index.html` → `src/main.tsx`, which does not import bootstrap or the worker
 * until S07, so `/harness.html` is the only reachable entry for them.
 */

import { expect, test } from "@playwright/test";
import {
  BOOTSTRAP_FIELDS,
  BOOTSTRAP_MODULE,
  ENVELOPE_FIELDS,
  PASSPHRASE,
  RECOVERY_CODE_PATTERN,
  command,
  readStore,
  start,
  teardown,
} from "./runtime.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/harness.html");
});

test.afterEach(async ({ page }) => {
  await teardown(page);
});

test("reaches the bootstrap composition root from built output", async ({ page }) => {
  const modules = await page.evaluate(() => window.__sheafHarness.listModules());
  expect(modules).toContain(BOOTSTRAP_MODULE);

  const missing = await start(page);
  // A real Chromium must satisfy the whole baseline; storage persistence is
  // advisory and is allowed to be absent.
  expect(missing.filter((id) => id !== "storage-persistence")).toEqual([]);
});

test("first journey: setup, settings, lock, unlock, restart, unlock", async ({
  page,
}) => {
  // Real Argon2id calibration plus four derivations across the journey.
  test.setTimeout(180_000);

  await start(page);

  // --- CAP-01: setup on a fresh origin -------------------------------------
  const created = await command(page, { kind: "setup", passphrase: PASSPHRASE });
  expect(created.ok).toBe(true);
  if (!created.ok || created.response.kind !== "setup") {
    throw new Error("setup did not answer");
  }
  expect(created.response.recoveryCode).toMatch(RECOVERY_CODE_PATTERN);
  expect(created.response.session).toEqual({
    state: "unlocked",
    unlockedVia: "passphrase",
    settings: { idleTimeoutMinutes: 0 },
    catalogRevision: 1,
    transactionRevision: 1,
    appCount: 0,
    homeCount: 0,
  });

  const afterSetup = await readStore(page);
  expect(afterSetup.bootstrapFields).toEqual(BOOTSTRAP_FIELDS);
  expect(afterSetup.envelopeFields).toEqual(ENVELOPE_FIELDS);
  expect(afterSetup.transactionRevision).toBe(1);
  expect(afterSetup.envelopes.map((envelope) => envelope.revision)).toEqual([1]);

  // --- CAP-03: the settings writer, F01's second commit path ---------------
  const updated = await command(page, {
    kind: "updateSettings",
    idleTimeoutMinutes: 15,
  });
  if (!updated.ok || updated.response.kind !== "updateSettings") {
    throw new Error("updateSettings did not answer");
  }
  expect(updated.response.settings).toEqual({ idleTimeoutMinutes: 15 });

  const afterSettings = await readStore(page);
  expect(afterSettings.transactionRevision).toBe(2);
  expect(afterSettings.catalogStorageId).not.toBe(afterSetup.catalogStorageId);
  expect(
    afterSettings.envelopes.map((envelope) => envelope.revision).sort(),
  ).toEqual([1, 2]);

  // --- CAP-03: lock terminates the worker ---------------------------------
  await page.evaluate(() => window.__sheafApp?.lockNow("user"));
  expect(await page.evaluate(() => window.__sheafApp?.client.isRunning)).toBe(false);

  // A new client, and with it a new worker: the old one is gone.
  await start(page);
  expect(await command(page, { kind: "getStatus" })).toMatchObject({
    ok: true,
    response: { status: { state: "locked" } },
  });

  // --- CAP-02: wrong passphrase, then the right one ------------------------
  const refused = await command(page, { kind: "unlock", passphrase: "not it" });
  expect(refused).toEqual({
    ok: false,
    error: { kind: "wrong-passphrase", retryAfterMs: 0 },
  });

  const unlocked = await command(page, { kind: "unlock", passphrase: PASSPHRASE });
  if (!unlocked.ok || unlocked.response.kind !== "unlock") {
    throw new Error("unlock did not answer");
  }
  expect(unlocked.response.session).toMatchObject({
    state: "unlocked",
    settings: { idleTimeoutMinutes: 15 },
    catalogRevision: 2,
    transactionRevision: 2,
    appCount: 0,
  });

  // --- restart: a new page, a new worker, the same durable store -----------
  await page.reload();
  await start(page);

  const reopened = await command(page, { kind: "unlock", passphrase: PASSPHRASE });
  if (!reopened.ok || reopened.response.kind !== "unlock") {
    throw new Error("unlock after reload did not answer");
  }
  // Decrypting at all proves the AAD was rebuilt byte-exactly from the stored
  // row's own revision (D12/AD-6): nothing else carries the logical revision.
  expect(reopened.response.session).toMatchObject({
    settings: { idleTimeoutMinutes: 15 },
    catalogRevision: 2,
    transactionRevision: 2,
    appCount: 0,
    homeCount: 0,
  });

  const afterRestart = await readStore(page);
  expect(afterRestart.bootstrapFields).toEqual(BOOTSTRAP_FIELDS);
  expect(afterRestart.transactionRevision).toBe(2);
});
