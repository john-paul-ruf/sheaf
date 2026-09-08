/**
 * Page plumbing shared by every F01 e2e spec.
 *
 * Everything here drives the **production entry**: `index.html` →
 * `src/main.tsx` → `startApp()` → the real data worker → real IndexedDB.
 * S01's `/harness.html` is deliberately never opened by an e2e spec — it is a
 * test-toolchain artifact and proves nothing about what a user reaches.
 *
 * The helpers speak in accessible names, not CSS, so a change that keeps the
 * pixels and loses the label fails here rather than passing quietly.
 */

import { expect, type Locator, type Page } from "@playwright/test";

export const PASSPHRASE = "correct horse battery staple";
export const NEXT_PASSPHRASE = "north star copper gate";
export const RECOVERY_PASSPHRASE = "quiet harbour lantern spruce";

/** The shipped format: 8 groups of 7 Crockford characters, no prefix (AD-10). */
export const RECOVERY_CODE_PATTERN =
  /^[0-9A-HJKMNP-TV-Z]{7}(-[0-9A-HJKMNP-TV-Z]{7}){7}$/;

/** The one database this build creates. */
export const LOCAL_DATABASE = "sheaf-local";

/** design.md §Layout Classes: the smallest declared width, where UI dies. */
export const COMPACT_VIEWPORT = Object.freeze({ width: 320, height: 720 });

/** An Argon2id calibration plus a derivation, on a busy CI machine. */
export const DERIVE_TIMEOUT_MS = 90_000;

const LOCAL_PASSPHRASE_LABEL = "This device's unlock passphrase";
const CONFIRM_PASSPHRASE_LABEL = "Confirm this device's unlock passphrase";

/** Opens the real entry and waits for the router to settle on a screen. */
export async function openApp(page: Page, hash = ""): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(page.locator("[data-screen]")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });
}

/**
 * Follows a hash route **without reloading**, which is the only way to deep
 * link inside an unlocked session: a reload terminates the worker, and
 * terminating the worker is what locking means (FR-22).
 */
export async function followHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    window.location.hash = next;
  }, hash);
}

/** Which approved surface is on screen right now. */
export async function currentScreen(page: Page): Promise<string | null> {
  return page.locator("[data-screen]").first().getAttribute("data-screen");
}

export function screen(page: Page, id: string): Locator {
  return page.locator(`[data-screen="${id}"]`);
}

/** Fills a `PassphraseField` by its visible, scope-naming label. */
export async function fillSecret(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  await page.getByLabel(label, { exact: true }).fill(value);
}

/**
 * CAP-01 end to end through the surface: welcome → passphrase → issued code →
 * saved acknowledgement → unlocked library. Returns the code as it was shown.
 */
export async function protectDevice(
  page: Page,
  passphrase = PASSPHRASE,
): Promise<string> {
  await page.getByRole("button", { name: "Protect this device" }).click();

  await fillSecret(page, LOCAL_PASSPHRASE_LABEL, passphrase);
  await fillSecret(page, CONFIRM_PASSPHRASE_LABEL, passphrase);
  await page.getByRole("button", { name: "Protect this device" }).click();

  const code = page.getByRole("status", { name: "Write this down once" });
  await expect(code).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });

  await page.getByRole("button", { name: "Reveal" }).click();
  const recoveryCode = ((await code.textContent()) ?? "").trim();

  await page
    .getByRole("checkbox", { name: /I saved the local recovery code/ })
    .check();
  await page.getByRole("button", { name: "Finish secure setup" }).click();

  await expect(screen(page, "SCR-011")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });
  return recoveryCode;
}

/** CAP-02: one unlock attempt through SCR-003. Does not assert the outcome. */
export async function attemptUnlock(
  page: Page,
  passphrase: string,
): Promise<void> {
  await fillSecret(page, LOCAL_PASSPHRASE_LABEL, passphrase);
  await page.getByRole("button", { name: "Unlock offline" }).click();
}

export async function unlock(
  page: Page,
  passphrase = PASSPHRASE,
): Promise<void> {
  await attemptUnlock(page, passphrase);
  await expect(screen(page, "SCR-011")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });
}

/** CAP-03: the shell's lock action, followed by the cold-unlock screen. */
export async function lockDevice(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Lock device" }).click();
  await expect(screen(page, "SCR-003")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });
}

/** Follows the shell to SCR-005 and waits for it. */
export async function openSecuritySettings(page: Page): Promise<void> {
  await followHash(page, "#/settings/security");
  await expect(screen(page, "SCR-005")).toBeVisible();
}

/** CTL-038's trigger, whose text is the value the worker confirmed it stored. */
export function idleTimeoutControl(page: Page): Locator {
  return page.getByRole("button", { name: /Idle timeout/ });
}

/** Chooses an approved idle timeout and waits for the persisted value to land. */
export async function selectIdleTimeout(
  page: Page,
  label: string,
): Promise<void> {
  await idleTimeoutControl(page).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(idleTimeoutControl(page)).toContainText(label);
}

/** What the origin's database holds, read directly rather than through the store. */
export interface LocalStoreState {
  readonly databaseExists: boolean;
  readonly bootstrapRows: number;
  readonly envelopeRows: number;
}

/**
 * Reads IndexedDB straight, so an assertion about erasure does not travel
 * through the code it is checking.
 *
 * Note that the *database* existing is not the same as this device being
 * protected: the very first `getStatus` opens (and therefore creates) an empty
 * `sheaf-local` in order to answer "no bootstrap row". Rows are the fact.
 */
export async function readLocalStore(page: Page): Promise<LocalStoreState> {
  return page.evaluate(async (name): Promise<LocalStoreState> => {
    const empty: LocalStoreState = {
      databaseExists: false,
      bootstrapRows: 0,
      envelopeRows: 0,
    };
    if (!(await indexedDB.databases()).some((entry) => entry.name === name)) {
      return empty;
    }

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error(`cannot open ${name}`));
      };
    });

    const stores = [...database.objectStoreNames];
    if (!stores.includes("bootstrap") || !stores.includes("envelopes")) {
      database.close();
      return { ...empty, databaseExists: true };
    }

    const count = async (store: string): Promise<number> =>
      new Promise<number>((resolve, reject) => {
        const request = database
          .transaction([store], "readonly")
          .objectStore(store)
          .count();
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(new Error(`cannot count ${store}`));
        };
      });

    const bootstrapRows = await count("bootstrap");
    const envelopeRows = await count("envelopes");
    database.close();
    return { databaseExists: true, bootstrapRows, envelopeRows };
  }, LOCAL_DATABASE);
}

/** Removes the origin's database so the next test starts on a fresh device. */
export async function deleteLocalStore(page: Page): Promise<void> {
  await page.evaluate(
    async (name) =>
      new Promise<void>((resolve) => {
        // A capability-gate spec may have removed it before the page loaded.
        if (globalThis.indexedDB === undefined) {
          resolve();
          return;
        }
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => {
          resolve();
        };
        request.onerror = () => {
          resolve();
        };
        request.onblocked = () => {
          resolve();
        };
      }),
    LOCAL_DATABASE,
  );
}
