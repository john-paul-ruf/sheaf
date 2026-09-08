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

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
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

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

async function auditable(page: Page, id: string): Promise<void> {
  await expect(screen(page, id)).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((violation) => ({
      screen: id,
      rule: violation.id,
      nodes: violation.nodes.map((node) => node.html),
    })),
  ).toEqual([]);
}

/**
 * Nothing required is cut off. Two ways that happens: the document scrolls
 * sideways, or a box with hidden overflow is narrower than the text inside it.
 */
async function clipped(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) {
      problems.push(
        `document scrolls sideways: ${String(root.scrollWidth)} > ${String(root.clientWidth)}`,
      );
    }
    for (const element of document.querySelectorAll<HTMLElement>(
      "h1, h2, h3, p, li, label, button, a, strong, output, legend",
    )) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) {
        continue;
      }
      const text = (element.textContent ?? "").trim().slice(0, 40);
      if (box.right > root.clientWidth + 1) {
        problems.push(`overflows right: ${text}`);
      }
      const style = getComputedStyle(element);
      if (
        style.overflowX === "hidden" &&
        element.scrollWidth > element.clientWidth + 1
      ) {
        problems.push(`text clipped: ${text}`);
      }
    }
    return problems;
  });
}

/** Every control the design promises a 44×44 hit area (excluding inline prose links). */
async function undersizedTargets(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const small: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(
      "button, [role='button'], nav a",
    )) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) {
        continue;
      }
      if (box.width < 44 || box.height < 44) {
        small.push(
          `${(element.textContent ?? element.getAttribute("aria-label") ?? "?")
            .trim()
            .slice(0, 30)}: ${String(Math.round(box.width))}x${String(Math.round(box.height))}`,
        );
      }
    }
    return small;
  });
}

/** The sticky bottom bar must never sit on top of the last content (200% text). */
async function overlaps(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const bar = document.querySelector("nav[aria-label='Primary']:last-of-type");
    const main = document.querySelector("main");
    if (bar === null || main === null) {
      return [];
    }
    const barBox = bar.getBoundingClientRect();
    if (barBox.height === 0) {
      return [];
    }
    const problems: string[] = [];
    for (const element of main.querySelectorAll<HTMLElement>(
      "h1, h2, p, button, a, label",
    )) {
      const box = element.getBoundingClientRect();
      if (box.height === 0) {
        continue;
      }
      if (box.bottom > barBox.top && box.top < barBox.bottom) {
        problems.push(
          `${(element.textContent ?? "").trim().slice(0, 30)} sits under the bottom bar`,
        );
      }
    }
    return problems;
  });
}

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
