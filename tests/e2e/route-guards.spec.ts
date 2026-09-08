/**
 * CA-07 — the lock-state route guards, verified.
 *
 * This agreement already exists in STATE.md; this file is its proof, not its
 * proposal (replan finding F-11). The matrix under test is exactly the recorded
 * one:
 *
 * - **first-run** (no bootstrap row): only welcome and setup are reachable,
 *   and everything else — `#/unlock` included — lands on welcome, because
 *   there is nothing yet to unlock.
 * - **locked**: welcome, setup, unlock, recover and the locked reset are
 *   reachable; every unlocked route and every unknown path lands on unlock.
 * - **unlocked**: those five redirect to the library, as does anything unknown.
 *
 * SESSION-07's amendment adds three unlocked-only paths — `#/library/search`,
 * `#/upload` and `#/import` — and reserves `#/app/…` without serving it. The
 * reservation is the interesting row: a post-create navigation goes there, and
 * because the guard does not know it, the unknown-route rule lands it on the
 * library, where the new tile is. `#/import` is one route whose *stage* the
 * import machine chooses, so a deep link into it with no run in flight lands
 * on `#/upload` rather than on a screen with nothing behind it.
 *
 * The locked cases are driven by **full page loads**, which is what a deep
 * link actually is. The unlocked cases follow the hash in-page, because a
 * reload terminates the worker — and that termination *is* the lock, so a
 * "deep link while unlocked" delivered by reload would be testing the wrong
 * thing.
 */

import { expect, test } from "@playwright/test";
import {
  currentScreen,
  deleteLocalStore,
  followHash,
  lockDevice,
  openApp,
  protectDevice,
  screen,
} from "./fixtures/app.js";

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

/** Path → the screen a phase is expected to end on. */
type Matrix = readonly (readonly [string, string, string])[];

const FIRST_RUN: Matrix = [
  ["#/welcome", "SCR-001", "#/welcome"],
  ["#/setup", "SCR-002", "#/setup"],
  ["#/unlock", "SCR-001", "#/welcome"],
  ["#/recover", "SCR-001", "#/welcome"],
  ["#/reset", "SCR-001", "#/welcome"],
  ["#/library", "SCR-001", "#/welcome"],
  ["#/settings/security", "SCR-001", "#/welcome"],
  ["#/settings/security/passphrase", "SCR-001", "#/welcome"],
  ["#/settings/security/recovery-codes", "SCR-001", "#/welcome"],
  ["#/settings/security/reset", "SCR-001", "#/welcome"],
  ["#/library/search", "SCR-001", "#/welcome"],
  ["#/upload", "SCR-001", "#/welcome"],
  ["#/import", "SCR-001", "#/welcome"],
  ["#/app/anything", "SCR-001", "#/welcome"],
  ["#/nowhere", "SCR-001", "#/welcome"],
  ["", "SCR-001", "#/welcome"],
];

const LOCKED: Matrix = [
  ["#/welcome", "SCR-001", "#/welcome"],
  ["#/setup", "SCR-002", "#/setup"],
  ["#/unlock", "SCR-003", "#/unlock"],
  ["#/recover", "SCR-004", "#/recover"],
  ["#/reset", "SCR-008", "#/reset"],
  ["#/library", "SCR-003", "#/unlock"],
  ["#/settings/security", "SCR-003", "#/unlock"],
  ["#/settings/security/passphrase", "SCR-003", "#/unlock"],
  ["#/settings/security/recovery-codes", "SCR-003", "#/unlock"],
  ["#/settings/security/reset", "SCR-003", "#/unlock"],
  ["#/library/search", "SCR-003", "#/unlock"],
  ["#/upload", "SCR-003", "#/unlock"],
  ["#/import", "SCR-003", "#/unlock"],
  ["#/app/anything", "SCR-003", "#/unlock"],
  ["#/nowhere", "SCR-003", "#/unlock"],
  ["", "SCR-003", "#/unlock"],
];

const UNLOCKED: Matrix = [
  ["#/library", "SCR-011", "#/library"],
  // No app exists yet, so the search route renders STA-025's invitation rather
  // than a search over nothing (SCR-012 needs something to search).
  ["#/library/search", "SCR-011", "#/library/search"],
  ["#/upload", "SCR-016", "#/upload"],
  // The stage is the machine's, not the URL's: no run is in flight, so the
  // import route lands on the one screen that is true.
  ["#/import", "SCR-016", "#/upload"],
  // Reserved, not served: S08 lands `#/app/:appId`.
  ["#/app/anything", "SCR-011", "#/library"],
  ["#/settings/security", "SCR-005", "#/settings/security"],
  ["#/settings/security/passphrase", "SCR-006", "#/settings/security/passphrase"],
  [
    "#/settings/security/recovery-codes",
    "SCR-007",
    "#/settings/security/recovery-codes",
  ],
  ["#/settings/security/reset", "SCR-009", "#/settings/security/reset"],
  ["#/welcome", "SCR-011", "#/library"],
  ["#/setup", "SCR-011", "#/library"],
  ["#/unlock", "SCR-011", "#/library"],
  ["#/recover", "SCR-011", "#/library"],
  ["#/reset", "SCR-011", "#/library"],
  ["#/nowhere", "SCR-011", "#/library"],
];

test("first run: every route lands on welcome except setup", async ({
  page,
}) => {
  for (const [entry, expected, url] of FIRST_RUN) {
    await openApp(page, entry);
    await expect
      .poll(async () => currentScreen(page), { message: `deep link ${entry}` })
      .toBe(expected);
    expect(page.url()).toContain(url);
  }
});

test("locked: deep links reach only the five locked routes", async ({
  page,
}) => {
  test.setTimeout(240_000);

  await openApp(page);
  await protectDevice(page);
  await lockDevice(page);

  for (const [entry, expected, url] of LOCKED) {
    // A full load, which is what a deep link from outside the app really is.
    await openApp(page, entry);
    await expect
      .poll(async () => currentScreen(page), { message: `deep link ${entry}` })
      .toBe(expected);
    expect(page.url()).toContain(url);

    // FR-22/FR-23: nothing behind the unlock is named on any of these.
    await expect(page.getByRole("link", { name: "All apps" })).toHaveCount(0);
  }
});

test("unlocked: the locked routes redirect to the library", async ({
  page,
}) => {
  test.setTimeout(240_000);

  await openApp(page);
  await protectDevice(page);

  for (const [entry, expected, url] of UNLOCKED) {
    await followHash(page, entry);
    await expect
      .poll(async () => currentScreen(page), { message: `route ${entry}` })
      .toBe(expected);
    expect(page.url()).toContain(url);
    await expect(screen(page, expected)).toBeVisible();
  }
});
