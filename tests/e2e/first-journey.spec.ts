/**
 * The first narrow journey through the real entry (CAP-01..08, CA-01..07).
 *
 * `index.html` → `src/main.tsx` → `startApp()` → the production
 * `DataWorkerClient` → the production data worker → real libsodium WASM →
 * real IndexedDB. No mock, no double, and no `/harness.html` anywhere on this
 * path: this is the proof that a person, not a test harness, can reach every
 * F01 capability.
 *
 * Every step is driven by an accessible name, so the journey also demonstrates
 * that each capability is reachable by keyboard and by screen reader, not only
 * by a selector that happens to match.
 */

import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import {
  DERIVE_TIMEOUT_MS,
  PASSPHRASE,
  RECOVERY_CODE_PATTERN,
  currentScreen,
  deleteLocalStore,
  lockDevice,
  openApp,
  protectDevice,
  readLocalStore,
  screen,
  unlock,
} from "./fixtures/app.js";

const headRevision = execSync("git rev-parse HEAD").toString().trim();

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

/**
 * D15's mechanism, read back. `vite preview` never rebuilds, so a preview left
 * over from another slot would answer with a different id; `playwright.config`
 * builds before it serves and refuses to reuse a server, and this is the
 * assertion that says so out loud.
 */
test("serves the page built from the current revision", async ({ page }) => {
  await openApp(page);

  expect(await page.evaluate(() => window.__sheafBuildId)).toBe(headRevision);
  expect(
    await page.evaluate(
      () => document.documentElement.dataset["sheafBuildId"],
    ),
  ).toBe(headRevision);
});

test("fresh device: welcome, setup, library, lock, unlock", async ({
  page,
}) => {
  // Argon2id calibrates once and derives on setup and on each unlock.
  test.setTimeout(240_000);

  // --- CAP-01: a device with no bootstrap row starts on SCR-001 ------------
  await openApp(page);
  expect(await currentScreen(page)).toBe("SCR-001");
  // The status probe opens an empty database to answer "no bootstrap row";
  // what makes this a fresh device is that the row is not there.
  expect((await readLocalStore(page)).bootstrapRows).toBe(0);

  const recoveryCode = await protectDevice(page);

  // AD-10: 8 groups of 7 Crockford characters, and no prefix is claimed.
  expect(recoveryCode).toMatch(RECOVERY_CODE_PATTERN);
  await expect(page.locator("body")).not.toContainText("LCL-");

  // --- Post-unlock destination: SCR-011, truthfully empty (D5, STA-025) ----
  await expect(
    page.getByRole("heading", { name: "Your apps will live here." }),
  ).toBeVisible();

  const choose = page.getByRole("button", { name: "Choose a workbook" });
  const connect = page.getByRole("button", { name: "Connect a durable home" });
  await expect(choose).toBeVisible();
  await expect(choose).toBeDisabled();
  await expect(connect).toBeVisible();
  await expect(connect).toBeDisabled();
  // CTL-014's contract: a disabled action states its reason in text.
  await expect(screen(page, "SCR-011")).toContainText(
    "Uploading a workbook is not available in this release.",
  );
  await expect(screen(page, "SCR-011")).toContainText(
    "Connecting a durable home is not available in this release.",
  );

  // The shell labels the way back to the library "All apps" (design.md).
  await expect(
    page.getByRole("link", { name: "All apps" }).first(),
  ).toBeVisible();

  // --- CAP-03: lock now terminates the session -----------------------------
  await lockDevice(page);

  // FR-22: nothing inside the store may be named while it is locked.
  await expect(screen(page, "SCR-003")).toContainText(
    "Your app names, record counts, and backup details stay encrypted until you unlock.",
  );
  await expect(page.getByRole("link", { name: "All apps" })).toHaveCount(0);

  // FR-22 ordering: the lossless route is met before the destructive one.
  const routes = page.getByRole("navigation", { name: "If you cannot unlock" });
  await expect(routes.getByRole("link")).toHaveText([
    "Use local recovery code",
    "Review reset consequences →",
  ]);

  // --- CAP-02: the same passphrase reopens the same store ------------------
  await unlock(page);
  await expect(
    page.getByRole("heading", { name: "Your apps will live here." }),
  ).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });

  // --- The store outlived a real termination, not just a route change ------
  const stored = await readLocalStore(page);
  expect(stored.bootstrapRows).toBe(1);
  expect(stored.envelopeRows).toBeGreaterThan(0);
  await openApp(page);
  expect(await currentScreen(page)).toBe("SCR-003");
  await unlock(page, PASSPHRASE);
});
