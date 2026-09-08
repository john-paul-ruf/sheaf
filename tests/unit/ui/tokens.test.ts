import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { SYSTEM_OWNED_PROPERTIES } from "../../../src/ui/theme/theme.js";

// The jsdom project serves modules over http://, so `import.meta.url` is not a
// file URL here. Vitest roots the run at the repository, which is stable.
const UI_ROOT = resolve(process.cwd(), "src/ui") + sep;
const TOKENS_CSS = readFileSync(join(UI_ROOT, "theme/tokens.css"), "utf8");
const BASE_CSS = readFileSync(join(UI_ROOT, "theme/base.css"), "utf8");

const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";
const [rootSource = "", reducedMotionSource = ""] =
  TOKENS_CSS.split(REDUCED_MOTION);

function declarations(source: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const [, name = "", value = ""] of source.matchAll(
    /(--[a-z0-9-]+)\s*:\s*([^;]+);/g,
  )) {
    found.set(name, value.trim());
  }
  return found;
}

const tokens = declarations(rootSource);
const reducedMotion = declarations(reducedMotionSource);

/** design.md §Color palette — the table is normative, values included. */
const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["--ink-950", "#17211c"],
  ["--ink-800", "#2b3932"],
  ["--paper-50", "#f7f5ee"],
  ["--paper-100", "#efece2"],
  ["--paper-200", "#e2ded2"],
  ["--white", "#fffdf8"],
  ["--leaf-700", "#2d5a4b"],
  ["--leaf-500", "#4f7d6c"],
  ["--sprout-300", "#cbea80"],
  ["--clay-600", "#a84f32"],
  ["--marigold-500", "#c78316"],
  ["--river-600", "#396b8c"],
  ["--violet-600", "#705b91"],
];

describe("tokens.css — palette", () => {
  it.each(PALETTE)("declares %s as %s", (name, value) => {
    expect(tokens.get(name)).toBe(value);
  });

  it("is the only file in src/ui that carries a colour literal", () => {
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.(css|tsx?)$/.test(entry.name)) {
          const relative = path.slice(UI_ROOT.length);
          if (relative === "theme/tokens.css") continue;
          if (/#[0-9a-f]{3,8}\b/i.test(readFileSync(path, "utf8"))) {
            offenders.push(relative);
          }
        }
      }
    };
    walk(UI_ROOT);
    expect(offenders).toEqual([]);
  });
});

describe("tokens.css — scales", () => {
  it("declares the 4px spacing scale and the three gutters", () => {
    for (const step of [4, 8, 12, 16, 20, 24, 32, 40, 48, 64]) {
      expect(tokens.get(`--space-${String(step)}`)).toBe(`${String(step)}px`);
    }
    expect(tokens.get("--gutter-compact")).toBe("16px");
    expect(tokens.get("--gutter-wide")).toBe("24px");
    expect(tokens.get("--gutter-desktop")).toBe("32px");
  });

  it("declares the shape scale", () => {
    expect(tokens.get("--radius-control")).toBe("10px");
    expect(tokens.get("--radius-card")).toBe("16px");
    expect(tokens.get("--radius-panel")).toBe("22px");
    expect(tokens.get("--radius-pill")).toBe("999px");
  });

  it("declares the two elevation shadows", () => {
    expect(tokens.get("--shadow-level-1")).toBe("0 8px 24px rgb(23 33 28 / 8%)");
    expect(tokens.get("--shadow-level-2")).toBe(
      "0 20px 60px rgb(23 33 28 / 16%)",
    );
  });

  it("declares the type scale and the three weights", () => {
    expect(tokens.get("--text-caption")).toBe("12px");
    expect(tokens.get("--text-supporting")).toBe("14px");
    expect(tokens.get("--text-body")).toBe("16px");
    expect(tokens.get("--text-section")).toBe("20px");
    expect(tokens.get("--text-page")).toBe("28px");
    expect(tokens.get("--text-display")).toBe("36px");
    expect(tokens.get("--weight-body")).toBe("450");
    expect(tokens.get("--weight-control")).toBe("600");
    expect(tokens.get("--weight-status")).toBe("700");
  });

  it("declares system font stacks and no webfont file (D7)", () => {
    expect(tokens.get("--font-display")).toContain("serif");
    expect(tokens.get("--font-interface")).toContain("sans-serif");
    expect(tokens.get("--font-mono")).toContain("monospace");
    expect(TOKENS_CSS).not.toContain("@font-face");
    expect(BASE_CSS).not.toContain("@font-face");
  });

  it("declares a stacking scale so no component invents a z-index", () => {
    for (const name of [
      "--z-sticky",
      "--z-rail",
      "--z-bottom-bar",
      "--z-overlay",
      "--z-skip-link",
    ]) {
      expect(tokens.get(name)).toMatch(/^\d+$/);
    }
  });
});

describe("tokens.css — motion", () => {
  const durationOf = (value: string | undefined): number =>
    Number.parseFloat(value ?? "NaN");

  it("keeps durations inside design.md's two bands", () => {
    const control = durationOf(tokens.get("--duration-control"));
    const panel = durationOf(tokens.get("--duration-panel"));
    expect(control).toBeGreaterThanOrEqual(120);
    expect(control).toBeLessThanOrEqual(180);
    expect(panel).toBeGreaterThanOrEqual(220);
    expect(panel).toBeLessThanOrEqual(280);
  });

  it("collapses both durations under reduced motion", () => {
    expect(durationOf(reducedMotion.get("--duration-control"))).toBeLessThan(10);
    expect(durationOf(reducedMotion.get("--duration-panel"))).toBeLessThan(10);
  });
});

describe("tokens.css — system-owned semantics", () => {
  it("declares every safety alias and the hit-target floor", () => {
    expect(tokens.get("--color-danger")).toBe("var(--clay-600)");
    expect(tokens.get("--color-warning")).toBe("var(--marigold-500)");
    expect(tokens.get("--color-info")).toBe("var(--river-600)");
    expect(tokens.get("--color-success")).toBe("var(--leaf-700)");
    expect(tokens.get("--focus-ring-width")).toBe("3px");
    expect(tokens.get("--focus-ring-offset")).toBe("2px");
    expect(tokens.get("--target-min")).toBe("44px");
  });

  it("uses a focus colour that is actually visible on the paper canvas", () => {
    // Sprout 300 on Paper 50 is ~1.2:1. design.md names "Leaf/Sprout": Leaf on
    // paper, Sprout reserved for dark chrome.
    expect(tokens.get("--focus-ring-color")).toBe("var(--leaf-700)");
    expect(tokens.get("--focus-ring-color-on-ink")).toBe("var(--sprout-300)");
  });

  it("matches theme.ts's runtime deny-list exactly", () => {
    for (const name of SYSTEM_OWNED_PROPERTIES) {
      expect(tokens.has(name)).toBe(true);
    }
    expect([...SYSTEM_OWNED_PROPERTIES]).toEqual(
      [...SYSTEM_OWNED_PROPERTIES].filter((name) => tokens.has(name)),
    );
  });
});

describe("base.css — cascade layers", () => {
  it("declares reset, tokens and base in that order before any rule", () => {
    expect(BASE_CSS.indexOf("@layer reset, tokens, base;")).toBeLessThan(
      BASE_CSS.indexOf("@layer reset {"),
    );
  });

  it("pulls the token sheet in so one import mounts the whole shell", () => {
    expect(BASE_CSS).toContain('@import "./tokens.css";');
  });

  it("holds the 44px floor and the 16px editable minimum through tokens", () => {
    expect(BASE_CSS).toContain("min-height: var(--target-min);");
    expect(BASE_CSS).toContain("font-size: max(1rem, var(--text-body));");
  });

  it("wins its layer battles by order, never by force", () => {
    const stripComments = (css: string): string =>
      css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripComments(BASE_CSS)).not.toContain("!important");
    expect(stripComments(TOKENS_CSS)).not.toContain("!important");
  });
});
