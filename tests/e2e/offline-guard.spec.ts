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
