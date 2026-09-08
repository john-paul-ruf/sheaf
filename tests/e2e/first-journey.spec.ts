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
  NEXT_PASSPHRASE,
  PASSPHRASE,
  RECOVERY_CODE_PATTERN,
  RECOVERY_PASSPHRASE,
  currentScreen,
  deleteLocalStore,
  fillSecret,
  followHash,
  idleTimeoutControl,
  lockDevice,
  openApp,
  openSecuritySettings,
  protectDevice,
  readLocalStore,
  screen,
  selectIdleTimeout,
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

test("first journey: protect, lock, unlock, settle, change, recover, reveal, reset", async ({
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

  // --- CAP-03 / AD-7: the idle timeout is a durable setting ----------------
  await openSecuritySettings(page);
  await expect(idleTimeoutControl(page)).toContainText("Off");
  await selectIdleTimeout(page, "15 minutes");

  // --- CAP-04: MOD-037 confirms before anything is re-wrapped --------------
  await followHash(page, "#/settings/security/passphrase");
  await expect(screen(page, "SCR-006")).toBeVisible();
  await fillSecret(page, "Current local unlock passphrase", PASSPHRASE);
  await fillSecret(page, "New local unlock passphrase", NEXT_PASSPHRASE);
  await fillSecret(page, "Confirm new passphrase", NEXT_PASSPHRASE);
  await page.getByRole("button", { name: "Change without data loss" }).click();

  const confirm = page.getByRole("dialog");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(
    "Your apps, histories, and durable copies remain intact.",
  );
  await confirm.getByRole("button", { name: "Continue" }).click();
  await expect(screen(page, "SCR-005")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });

  // --- The setting survives a lock, a full reload, and a new worker --------
  await lockDevice(page);
  await openApp(page);
  expect(await currentScreen(page)).toBe("SCR-003");
  await unlock(page, NEXT_PASSPHRASE);
  await openSecuritySettings(page);
  await expect(idleTimeoutControl(page)).toContainText("15 minutes");

  // --- CAP-05: the local code unlocks, then forces a new passphrase --------
  await lockDevice(page);
  await page.getByRole("link", { name: "Use local recovery code" }).click();
  await expect(screen(page, "SCR-004")).toBeVisible();

  await page
    .getByLabel("Local recovery code", { exact: true })
    .fill(recoveryCode);
  await page.getByRole("button", { name: "Recover and unlock" }).click();

  // FR-23: there is no "unlock and carry on" — a replacement is required.
  await expect(screen(page, "SCR-004")).toContainText(
    "Set a new unlock passphrase for this device to finish recovering.",
    { timeout: DERIVE_TIMEOUT_MS },
  );
  await fillSecret(page, "New local unlock passphrase", RECOVERY_PASSPHRASE);
  await fillSecret(page, "Confirm new passphrase", RECOVERY_PASSPHRASE);
  await page.getByRole("button", { name: "Recover and unlock" }).click();
  await expect(screen(page, "SCR-011")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });

  // The setting is the catalog's, not the session's: recovery did not lose it.
  await openSecuritySettings(page);
  await expect(idleTimeoutControl(page)).toContainText("15 minutes");

  // --- CAP-06: MOD-022 re-shows the code, passphrase-gated -----------------
  await followHash(page, "#/settings/security/recovery-codes");
  await expect(screen(page, "SCR-007")).toBeVisible();
  await page
    .getByRole("button", { name: "Reveal with local passphrase" })
    .click();

  const reveal = page.getByRole("dialog");
  await expect(reveal).toBeVisible();
  // The gate is real: an unlocked session is not authority to see the code.
  await fillSecret(page, "Current local unlock passphrase", PASSPHRASE);
  await reveal.getByRole("button", { name: "Reveal", exact: true }).click();
  await expect(reveal).toContainText(
    "That is not this device's unlock passphrase.",
    { timeout: DERIVE_TIMEOUT_MS },
  );

  // And a refusal does not disable the retry: the second attempt is accepted.
  await fillSecret(
    page,
    "Current local unlock passphrase",
    RECOVERY_PASSPHRASE,
  );
  await reveal.getByRole("button", { name: "Reveal", exact: true }).click();
  const shown = reveal.getByRole("status", { name: "Local recovery code" });
  await expect(shown).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
  await reveal.getByRole("button", { name: "Reveal", exact: true }).click();
  expect(((await shown.textContent()) ?? "").trim()).toBe(recoveryCode);

  await reveal
    .getByRole("checkbox", { name: /I saved this code/ })
    .check();
  await reveal.getByRole("button", { name: "Close" }).click();

  // --- CAP-07: the locked, generic reset destroys the store ----------------
  await lockDevice(page);
  await page.getByRole("link", { name: "Review reset consequences" }).click();
  await expect(screen(page, "SCR-008")).toBeVisible();

  // FR-23: a locked reset enumerates nothing and says why.
  await expect(screen(page, "SCR-008")).toContainText(
    "Sheaf cannot list the apps, record counts, backup times, or device-only changes that would be destroyed",
  );
  // Custom Rule 3: Google Drive is settled as *not* a durable home, so it is
  // never named as one. `\bdrive\b` deliberately does not match "OneDrive",
  // which is a durable home and is named on purpose.
  await expect(screen(page, "SCR-008")).not.toContainText(/google|\bdrive\b/i);

  await page.getByRole("button", { name: "Continue to 3 confirmations" }).click();
  await page
    .getByRole("checkbox", {
      name: "I understand Sheaf cannot show what this locked reset destroys.",
    })
    .check();
  await page
    .getByRole("button", { name: "Continue to typed confirmation" })
    .click();

  const typed = page.getByRole("alertdialog");
  await expect(typed).toBeVisible();
  await expect(
    typed.getByRole("button", { name: "Confirm consequence" }),
  ).toBeDisabled();
  await typed.getByLabel("Type RESET THIS DEVICE").fill("RESET THIS DEVICE");
  await typed.getByRole("button", { name: "Confirm consequence" }).click();

  // --- Post-reset: SCR-001 again, and the store is genuinely gone ----------
  await expect(screen(page, "SCR-001")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });
  const purged = await readLocalStore(page);
  expect(purged.bootstrapRows).toBe(0);
  expect(purged.envelopeRows).toBe(0);
});

/**
 * The readable variant's own ending (CAP-07, MOD-032). The journey above stops
 * this path short on purpose — it needs the store alive for the locked reset —
 * so the successful purge is proved here.
 */
test("readable reset: enumerates truthfully, purges, and lands on welcome", async ({
  page,
}) => {
  test.setTimeout(240_000);

  await openApp(page);
  await protectDevice(page);
  await followHash(page, "#/settings/security/reset");
  await expect(screen(page, "SCR-009")).toBeVisible();

  // F01 has no apps, and "none" is a fact — never "unknown" (FR-23).
  await expect(screen(page, "SCR-009")).toContainText(
    "No apps are on this device, so none would be destroyed.",
  );
  await expect(screen(page, "SCR-009")).not.toContainText(/unknown/i);

  await page.getByRole("button", { name: "Continue to 3 confirmations" }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Continue to typed confirmation" }),
  ).toBeDisabled();
  await dialog
    .getByRole("checkbox", {
      name: "I understand this reset destroys this device's local store.",
    })
    .check();
  await dialog
    .getByRole("button", { name: "Continue to typed confirmation" })
    .click();

  await expect(
    dialog.getByRole("button", { name: "Confirm consequence" }),
  ).toBeDisabled();
  await dialog.getByLabel("Type RESET THIS DEVICE").fill("RESET THIS DEVICE");
  await dialog.getByRole("button", { name: "Confirm consequence" }).click();

  await expect(screen(page, "SCR-001")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });
  const purged = await readLocalStore(page);
  expect(purged.bootstrapRows).toBe(0);
  expect(purged.envelopeRows).toBe(0);
});
