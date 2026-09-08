import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

/**
 * Minimal React 19 mount helper. The pinned dependency set (D1) has no
 * testing-library, and root manifests are not in this session's lease, so
 * these tests drive `react-dom/client` directly.
 */
interface Mounted {
  /** The container the tree was rendered into. */
  readonly container: HTMLElement;
  /** Re-render with new props. */
  readonly rerender: (next: ReactNode) => Promise<void>;
  readonly unmount: () => void;
}

// React 19 requires this flag before `act` will flush effects synchronously.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mounted: Root[] = [];

afterEach(() => {
  for (const root of mounted.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
});

export async function render(ui: ReactNode): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);

  await interact(() => {
    root.render(ui);
  });

  return {
    container,
    rerender: (next) =>
      interact(() => {
        root.render(next);
      }),
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

/**
 * Runs `fn` inside `act`, then lets the scheduler settle.
 *
 * React Aria moves and restores focus on a later task, not in the effect that
 * opens an overlay, so a microtask flush alone would observe a half-open
 * dialog.
 */
export async function interact(fn: () => void): Promise<void> {
  await act(async () => {
    fn();
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    });
  });
}

/**
 * Waits for work React Aria defers past the frame that triggered it.
 *
 * Focus *restoration* on overlay close lands a frame after the unmount that
 * causes it, so an assertion about where focus went needs this; `interact`
 * alone is enough for everything else.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  });
}

/**
 * Dialogs and popovers portal to `document.body`, so queries default to the
 * whole document rather than a container.
 */
export function query<E extends Element = HTMLElement>(selector: string): E {
  const found = document.body.querySelector<E>(selector);
  if (found === null) throw new Error(`No element matches ${selector}`);
  return found;
}

export function queryAll<E extends Element = HTMLElement>(
  selector: string,
): readonly E[] {
  return [...document.body.querySelectorAll<E>(selector)];
}

/**
 * Types `value` into `input` the way a user would: React listens for the
 * native `input` event, so setting `.value` alone is invisible to it.
 */
export function typeInto(
  input: HTMLInputElement,
  value: string,
): Promise<void> {
  // React dedupes by tracking the DOM value, so assigning `input.value`
  // directly is invisible to it; the prototype setter is the supported route.
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.bind(input);
  if (setValue === undefined) {
    throw new Error("No value setter on HTMLInputElement.prototype");
  }

  return interact(() => {
    setValue(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/**
 * The CSS rules whose selector mentions one of `element`'s own class names.
 *
 * jsdom never evaluates `:focus-visible`, `:visited` or media queries through
 * `getComputedStyle`, so state-dependent styling is asserted structurally —
 * against the rules the stylesheet actually shipped. Whether those rules paint
 * correctly is SESSION-07's browser evidence, not this runner's.
 */
export function cssRulesFor(
  element: Element,
  options: { readonly insideMediaQuery?: boolean } = {},
): readonly string[] {
  const classNames = [...element.classList];
  if (classNames.length === 0) return [];

  const collect = (rules: CSSRuleList, inMedia: boolean): string[] =>
    [...rules].flatMap((rule) => {
      if (rule instanceof CSSMediaRule) return collect(rule.cssRules, true);
      if (!(rule instanceof CSSStyleRule)) return [];
      if (inMedia !== (options.insideMediaQuery ?? false)) return [];
      return classNames.some((name) =>
        rule.selectorText.includes(`.${name}`),
      )
        ? [rule.cssText]
        : [];
    });

  return [...document.styleSheets].flatMap((sheet) =>
    collect(sheet.cssRules, false),
  );
}

/** The accessible name of `element`, as far as jsdom can resolve it. */
export function accessibleName(element: Element): string {
  const label = element.getAttribute("aria-label");
  if (label !== null) return label;

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }

  if (element.id !== "") {
    const explicit = document.querySelector(
      `label[for="${CSS.escape(element.id)}"]`,
    );
    if (explicit !== null) return explicit.textContent?.trim() ?? "";
  }

  return element.textContent?.trim() ?? "";
}

/**
 * The token values declared in `tokens.css`, read from the file. jsdom does
 * not resolve `var()`, so geometry assertions compare a computed literal
 * against the token that is supposed to be its only source.
 */
export const TOKENS: ReadonlyMap<string, string> = new Map(
  [
    ...readFileSync(
      resolve(process.cwd(), "src/ui/theme/tokens.css"),
      "utf8",
    ).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g),
  ].map(([, name = "", value = ""]) => [name, value.trim()]),
);

/** Asserts nothing; returns the required minimum hit area, e.g. `"44px"`. */
export const TARGET_MIN = TOKENS.get("--target-min") ?? "";
