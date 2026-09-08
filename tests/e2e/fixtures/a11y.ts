/**
 * The accessibility-contract probes, shared by every e2e spec that renders a
 * surface (design.md §Accessibility Contract).
 *
 * They started inside `accessibility.spec.ts`, where F01's surfaces were all
 * there was to check. SESSION-07 adds nine more approved screens and asserts
 * the same three claims about them, so the probes moved here rather than being
 * copied: one definition of "clipped", one of "too small to hit", one axe
 * configuration — a second copy is how two suites end up disagreeing about
 * what passing means.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { DERIVE_TIMEOUT_MS, screen } from "./app.js";

/** The four tag sets design.md's contract is written against. */
export const AXE_TAGS = Object.freeze([
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
]);

/** Waits for an approved surface, then audits the page it is on. */
export async function auditable(page: Page, id: string): Promise<void> {
  await expect(screen(page, id)).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
  const results = await new AxeBuilder({ page })
    .withTags([...AXE_TAGS])
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
export async function clipped(page: Page): Promise<readonly string[]> {
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
export async function undersizedTargets(
  page: Page,
): Promise<readonly string[]> {
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
export async function overlaps(page: Page): Promise<readonly string[]> {
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
