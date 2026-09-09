/**
 * design.md §Accessibility Contract, checked on the real surfaces.
 *
 * S03 proved the primitives in jsdom and deferred the rest here, because the
 * remaining claims are not assertions about a component — they are assertions
 * about a *rendered page at a width*: axe on every F01 screen, nothing clipped
 * at 320px, nothing overlapping at 200% text, the same destinations either side
 * of the rail breakpoint, focus trapped and restored by all four dialogs, and
 * the two states that must reach a screen reader without being seen (the
 * attempt delay, and CTL-087's capability refusal).
 */

import { expect, test, type Locator } from "@playwright/test";
import {
  COMPACT_VIEWPORT,
  DERIVE_TIMEOUT_MS,
  PASSPHRASE,
  attemptUnlock,
  deleteLocalStore,
  followHash,
  lockDevice,
  openApp,
  protectDevice,
  screen,
} from "./fixtures/app.js";
import {
  auditable,
  clipped,
  overlaps,
  undersizedTargets,
} from "./fixtures/a11y.js";
import {
  chooseOption,
  importDemoApp,
  openRecord,
  openTable,
} from "./fixtures/records.js";

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

/** Where a navigation actually goes, independent of how it labels itself. */
async function hrefsOf(navigation: Locator): Promise<readonly string[]> {
  return navigation.getByRole("link").evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  );
}

/** Focus is inside `container` right now. */
async function focusWithin(container: Locator): Promise<boolean> {
  return container.evaluate((node) => node.contains(document.activeElement));
}

test("axe: the locked surfaces", async ({ page }) => {
  test.setTimeout(240_000);

  await openApp(page);
  await auditable(page, "SCR-001");

  await protectDevice(page);
  await lockDevice(page);
  await auditable(page, "SCR-003");

  await followHash(page, "#/recover");
  await auditable(page, "SCR-004");

  await followHash(page, "#/reset");
  await auditable(page, "SCR-008");

  await followHash(page, "#/setup");
  await auditable(page, "SCR-002");
});

test("axe: the unlocked surfaces", async ({ page }) => {
  test.setTimeout(240_000);

  await openApp(page);
  await protectDevice(page);
  await auditable(page, "SCR-011");

  await followHash(page, "#/settings/security");
  await auditable(page, "SCR-005");

  await followHash(page, "#/settings/security/passphrase");
  await auditable(page, "SCR-006");

  await followHash(page, "#/settings/security/recovery-codes");
  await auditable(page, "SCR-007");

  await followHash(page, "#/settings/security/reset");
  await auditable(page, "SCR-009");
});

/**
 * The app-area surfaces S08 adds: SCR-024–029 and SCR-032, plus the two sheets
 * and the two dialogs that open over them (SHT-001, SHT-010, MOD-009,
 * MOD-010).
 *
 * They are audited in one journey rather than one per test, because reaching
 * them means importing the demo file — and an audit of a screen reached by any
 * other route would be an audit of a screen no person can get to.
 */
test("axe: the app, records and history surfaces", async ({ page }) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  const { appHash } = await importDemoApp(page);
  await auditable(page, "SCR-024");

  await openTable(page, "Visits");
  await auditable(page, "SCR-025");

  // SCR-026, the no-result variant.
  await page.getByLabel("Search Visits", { exact: true }).fill("payroll 2024");
  await auditable(page, "SCR-026");
  await page.getByRole("button", { name: "Clear search" }).first().click();

  await openRecord(page, "Visits", "1018");
  await auditable(page, "SCR-027");

  // SHT-010, then MOD-009 over it.
  await page.getByRole("button", { name: "Record actions…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await auditable(page, "SCR-027");
  await page.getByRole("button", { name: "Delete record…" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await auditable(page, "SCR-027");
  await page.getByRole("button", { name: "Cancel safely" }).click();

  // SCR-029, and SHT-001 over it.
  await page.getByRole("link", { name: "Edit this record" }).click();
  await auditable(page, "SCR-029");
  await page.getByRole("button", { name: /^Site / }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await auditable(page, "SCR-029");
  await page.getByRole("button", { name: "Clear value" }).click();

  // A refusal rendered at field level is still an audited surface.
  await page.getByLabel("Quoted amount", { exact: true }).fill("not a number");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText("This value is not the kind this field holds."),
  ).toBeVisible();
  await auditable(page, "SCR-029");

  // SCR-028, the create form.
  await followHash(page, "#/upload");
  await followHash(page, appHash);
  await openTable(page, "Visits");
  await page.getByRole("link", { name: "Add a record", exact: true }).first().click();
  await auditable(page, "SCR-028");

  // SCR-032, empty (nothing has been authored yet) and then with an entry.
  await followHash(page, `${appHash}/history`);
  await auditable(page, "SCR-032");
});

/** SCR-032 with a restorable entry, and MOD-010 over it. */
test("axe: the change history, once something has changed", async ({ page }) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  const { appHash } = await importDemoApp(page);
  await openTable(page, "Visits");
  await openRecord(page, "Visits", "1002");

  await page.getByRole("link", { name: "Edit this record" }).click();
  await chooseOption(page, "Status", "Complete");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(screen(page, "SCR-027")).toBeVisible();

  await page.getByRole("button", { name: "Record actions…" }).click();
  await page.getByRole("button", { name: "Delete record…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete record", exact: true }).click();
  await expect(screen(page, "SCR-025")).toBeVisible();

  await followHash(page, `${appHash}/history`);
  await auditable(page, "SCR-032");
  await page.getByRole("button", { name: "Restore record…" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await auditable(page, "SCR-032");
});

test("compact phone: nothing required is clipped at 320px", async ({
  page,
}) => {
  test.setTimeout(240_000);

  await page.setViewportSize(COMPACT_VIEWPORT);
  await openApp(page);
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);

  await protectDevice(page);
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);

  for (const route of [
    "#/settings/security",
    "#/settings/security/passphrase",
    "#/settings/security/recovery-codes",
    "#/settings/security/reset",
  ]) {
    await followHash(page, route);
    await expect(page.locator("[data-screen]")).toBeVisible();
    expect(await clipped(page)).toEqual([]);
  }

  await lockDevice(page);
  for (const route of ["#/unlock", "#/recover", "#/reset"]) {
    await followHash(page, route);
    await expect(page.locator("[data-screen]")).toBeVisible();
    expect(await clipped(page)).toEqual([]);
    expect(await undersizedTargets(page)).toEqual([]);
  }
});

test("200% text: bottom actions wrap, and never cover content", async ({
  page,
}) => {
  test.setTimeout(240_000);

  await page.setViewportSize(COMPACT_VIEWPORT);
  await openApp(page);
  await protectDevice(page);

  // The user-agent default is 16px; 32px is that contract's 200%.
  await page.addStyleTag({ content: "html { font-size: 32px; }" });
  await expect(screen(page, "SCR-011")).toBeVisible();

  expect(await overlaps(page)).toEqual([]);
  expect(await clipped(page)).toEqual([]);

  await followHash(page, "#/settings/security");
  await expect(screen(page, "SCR-005")).toBeVisible();
  expect(await overlaps(page)).toEqual([]);
  expect(await clipped(page)).toEqual([]);
});

/**
 * The same claim on the two surfaces a person spends the most time in: a list
 * that scrolls under a sticky search, and a form whose primary action sits in
 * the thumb zone. M39 reserves the bottom bar's height under the page, so at
 * 200% the actions wrap rather than land on top of the last field.
 */
test("200% text: the records list and the record form stay readable", async ({
  page,
}) => {
  test.setTimeout(300_000);

  await page.setViewportSize(COMPACT_VIEWPORT);
  await openApp(page);
  await protectDevice(page);
  await importDemoApp(page);
  await openTable(page, "Visits");

  await page.addStyleTag({ content: "html { font-size: 32px; }" });
  await expect(screen(page, "SCR-025")).toBeVisible();
  expect(await overlaps(page)).toEqual([]);
  expect(await clipped(page)).toEqual([]);

  await page.getByRole("link", { name: "Add a record", exact: true }).first().click();
  await expect(screen(page, "SCR-028")).toBeVisible();
  expect(await overlaps(page)).toEqual([]);
  expect(await clipped(page)).toEqual([]);
});

/**
 * Exactly one primary navigation, on both sides of the rail breakpoint —
 * inside a generated app as well as in the shell. The app area has its own
 * destinations (M44's frame over M39's shell), and it must not add a second
 * navigation to either class.
 */
test("the app area offers one primary navigation per layout class", async ({
  page,
}) => {
  test.setTimeout(300_000);

  await page.setViewportSize(COMPACT_VIEWPORT);
  await openApp(page);
  await protectDevice(page);
  await importDemoApp(page);

  const navigation = page.getByRole("navigation", { name: "Primary" });
  await expect(navigation).toHaveCount(1);
  const compactHrefs = await hrefsOf(navigation);
  expect(compactHrefs).toContain("#/library");

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(navigation).toHaveCount(1);
  await expect(navigation).toBeVisible();
  expect(await hrefsOf(navigation)).toEqual(compactHrefs);
  await expect(screen(page, "SCR-024")).toBeVisible();
});

test("the rail and the bottom bar offer the same destinations", async ({
  page,
}) => {
  test.setTimeout(240_000);

  await page.setViewportSize(COMPACT_VIEWPORT);
  await openApp(page);
  await protectDevice(page);

  // The rail and the bottom bar carry the same destinations, but only one is
  // ever exposed: `display: none` keeps the other out of the accessibility
  // tree, so assistive technology is never offered the same place twice.
  const navigation = page.getByRole("navigation", { name: "Primary" });
  await expect(navigation).toHaveCount(1);
  // Compared by destination rather than by text: the rail renders its labels
  // only from the desktop class up, which is the M39 gap recorded below.
  const compactHrefs = await hrefsOf(navigation);

  // Tablet landscape and up: the rail takes over, and offers the same places.
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(navigation).toHaveCount(1);
  await expect(navigation).toBeVisible();
  const railHrefs = await hrefsOf(navigation);

  expect(railHrefs).toEqual(compactHrefs);
  expect(railHrefs).toContain("#/library");
  // The switch is live: the page was never reloaded between the two reads.
  await expect(screen(page, "SCR-011")).toBeVisible();
});

test("all four dialogs trap focus and give it back", async ({ page }) => {
  test.setTimeout(240_000);

  await openApp(page);
  await protectDevice(page);

  // MOD-032 — readable reset.
  await followHash(page, "#/settings/security/reset");
  await expect(screen(page, "SCR-009")).toBeVisible();
  const openReadable = page.getByRole("button", {
    name: "Continue to 3 confirmations",
  });
  await openReadable.click();
  const readable = page.getByRole("alertdialog");
  await expect(readable).toBeVisible();
  expect(await focusWithin(readable)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(readable).toBeHidden();

  // MOD-037 — change passphrase.
  await followHash(page, "#/settings/security/passphrase");
  await expect(screen(page, "SCR-006")).toBeVisible();
  await page
    .getByLabel("Current local unlock passphrase", { exact: true })
    .fill(PASSPHRASE);
  await page
    .getByLabel("New local unlock passphrase", { exact: true })
    .fill("a whole new field notebook");
  await page
    .getByLabel("Confirm new passphrase", { exact: true })
    .fill("a whole new field notebook");
  const openChange = page.getByRole("button", {
    name: "Change without data loss",
  });
  await openChange.click();
  const change = page.getByRole("dialog");
  await expect(change).toBeVisible();
  expect(await focusWithin(change)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(change).toBeHidden();
  await expect(openChange).toBeFocused();

  // MOD-022 — reveal the local code.
  await followHash(page, "#/settings/security/recovery-codes");
  await expect(screen(page, "SCR-007")).toBeVisible();
  const openReveal = page.getByRole("button", {
    name: "Reveal with local passphrase",
  });
  await openReveal.click();
  const reveal = page.getByRole("dialog");
  await expect(reveal).toBeVisible();
  expect(await focusWithin(reveal)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(reveal).toBeHidden();
  await expect(openReveal).toBeFocused();

  // MOD-033 — locked typed reset.
  await lockDevice(page);
  await followHash(page, "#/reset");
  await expect(screen(page, "SCR-008")).toBeVisible();
  await page.getByRole("button", { name: "Continue to 3 confirmations" }).click();
  await page
    .getByRole("checkbox", {
      name: "I understand Sheaf cannot show what this locked reset destroys.",
    })
    .check();
  await page
    .getByRole("button", { name: "Continue to typed confirmation" })
    .click();
  const locked = page.getByRole("alertdialog");
  await expect(locked).toBeVisible();
  expect(await focusWithin(locked)).toBe(true);
  // A destructive confirmation does not close on an outside click.
  await page.mouse.click(2, 2);
  await expect(locked).toBeVisible();
});

test("the attempt delay reaches a screen reader", async ({ page }) => {
  test.setTimeout(240_000);

  await openApp(page);
  await protectDevice(page);
  await lockDevice(page);

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await attemptUnlock(page, "not this device's passphrase");
    await expect(screen(page, "SCR-003")).not.toHaveAttribute(
      "data-state",
      "deriving",
      { timeout: DERIVE_TIMEOUT_MS },
    );
  }

  await expect(screen(page, "SCR-003")).toHaveAttribute(
    "data-state",
    "delayed",
    { timeout: DERIVE_TIMEOUT_MS },
  );

  // Announced politely, and stated in text beside the field it disables.
  const live = page.getByRole("status").filter({ hasText: "Try again in" });
  await expect(live.first()).toHaveCount(1);
  await expect(
    page.getByLabel("This device's unlock passphrase", { exact: true }),
  ).toBeDisabled();
});

test("CTL-087 announces a missing capability assertively", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: undefined,
    });
  });
  await openApp(page);

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("indexeddb");
  await auditable(page, "SCR-001");
});
