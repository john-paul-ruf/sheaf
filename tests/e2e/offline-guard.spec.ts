/**
 * Invariant 12 / FR-22 — the security journeys touch no network.
 *
 * **F01 scope, stated out loud:** this file proves a *behaviour* — the setup,
 * unlock and lock journeys issue no request beyond the origin the built
 * `dist/` is served from. It is **not** the egress policy. There is no
 * Content-Security-Policy and no allowlist in F01; CSP enforcement, the egress
 * allowlist and the M64 security-test module are **F08 / M64** work, and this
 * spec must not be read as evidence that they exist.
 *
 * SCR-003's copy claims Sheaf unlocks without a signal, and GATE-F01's demo
 * script repeats it. This is where that claim is checked rather than asserted.
 */

import {
  DERIVE_TIMEOUT_MS,
  PASSPHRASE,
  deleteLocalStore,
  lockDevice,
  openApp,
  protectDevice,
  screen,
  attemptUnlock,
} from "./fixtures/app.js";
import {
  chooseOption,
  importDemoApp,
  openRecord,
  openTable,
  PARSE_TIMEOUT_MS,
} from "./fixtures/records.js";
import { expect, test } from "./fixtures/no-network.js";

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

test("setup, lock and unlock leave this device entirely alone", async ({
  page,
  network,
}) => {
  test.setTimeout(240_000);

  await openApp(page);
  await protectDevice(page);
  await lockDevice(page);

  // The cold unlock is the strongest claim on SCR-003, so it gets the
  // strongest assertion: not "no egress" but "no request at all". Everything
  // it needs — the worker, the WASM, the database — is already on this device.
  network.mark();
  await attemptUnlock(page, PASSPHRASE);
  await expect(screen(page, "SCR-011")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });
  expect(network.since()).toEqual([]);

  await lockDevice(page);

  // And across the whole journey, nothing left the served origin.
  expect(network.unexpected).toEqual([]);
});

test("a fresh load of the locked device asks the network for nothing new", async ({
  page,
  network,
}) => {
  test.setTimeout(240_000);

  await openApp(page);
  await protectDevice(page);
  await lockDevice(page);

  // A cold start does load the document and its assets; what it must not do is
  // reach anywhere else while doing it.
  await openApp(page);
  await expect(screen(page, "SCR-003")).toBeVisible();

  network.mark();
  await attemptUnlock(page, PASSPHRASE);
  await expect(screen(page, "SCR-011")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });
  expect(network.since()).toEqual([]);

  expect(network.unexpected).toEqual([]);
  // Every request this journey made was to the origin the build is served from.
  expect(
    network.all.filter((entry) => !entry.includes("127.0.0.1")),
  ).toEqual([]);
});

/**
 * S08's extension: the *import* and the *records* journeys are as silent as the
 * security ones (invariant 12).
 *
 * The file is read by the page, parsed by a worker on this device, committed
 * to IndexedDB on this device, and read back from there. Nothing about that
 * needs a network, and the strongest form of that claim is the one asserted
 * here: **after the app is open, authoring a record makes no request at all**,
 * to any origin, not even the one Sheaf was served from.
 *
 * Scope, restated so F08 does not think this is the policy: this is behaviour,
 * not enforcement. There is still no CSP and no egress allowlist — those are
 * F08/M64.
 */
test("import and CRUD leave this device entirely alone", async ({
  page,
  network,
}) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);

  // The import: two workers, a channel, and the WASM they need — all of it
  // from the origin this build is served from, and nowhere else.
  await importDemoApp(page);
  expect(network.unexpected).toEqual([]);

  await openTable(page, "Visits");
  await openRecord(page, "Visits", "1002");

  // The CRUD leg, with everything already loaded: not "no egress" but "no
  // request".
  network.mark();
  await page.getByRole("link", { name: "Edit this record" }).click();
  await expect(screen(page, "SCR-029")).toBeVisible();
  await chooseOption(page, "Status", "Complete");
  await page.getByLabel("Quoted amount", { exact: true }).fill("512.75");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(screen(page, "SCR-027")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });
  await expect(screen(page, "SCR-027")).toContainText("Saved on this device.");
  expect(network.since()).toEqual([]);

  expect(network.unexpected).toEqual([]);
  expect(
    network.all.filter((entry) => !entry.includes("127.0.0.1")),
  ).toEqual([]);
});
