import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SYSTEM_FOCUS_COLORS } from "../../../src/domain/model/events.js";
import {
  applyShellTheme,
  assertPresentationOnly,
  SYSTEM_OWNED_PROPERTIES,
} from "../../../src/ui/theme/theme.js";
import { appThemeTokens, appThemeVariables } from "../../../src/ui/theme/app-theme.js";
import { BUILT_IN_PALETTES, DEFAULT_APP_THEME } from "../../../src/import/staging/theme.js";
import "../../../src/ui/theme/base.css";

describe("applyShellTheme", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.append(root);
  });

  it("mounts the light scheme by default", () => {
    applyShellTheme(root);
    expect(root.style.colorScheme).toBe("light");
    expect(root.dataset["sheafColorScheme"]).toBe("light");
  });

  it("applies presentation-only custom properties", () => {
    applyShellTheme(root, { variables: { "--app-primary": "#315c49" } });
    expect(root.style.getPropertyValue("--app-primary")).toBe("#315c49");
  });

  it.each(SYSTEM_OWNED_PROPERTIES)("refuses to let a theme remap %s", (name) => {
    expect(() => {
      applyShellTheme(root, { variables: { [name]: "#ff00ff" } });
    }).toThrow(name);
    expect(root.style.getPropertyValue(name)).toBe("");
  });

  it("applies nothing at all when one property is forbidden", () => {
    expect(() => {
      applyShellTheme(root, {
        variables: { "--app-primary": "#315c49", "--color-danger": "#00ff00" },
      });
    }).toThrow("--color-danger");
    expect(root.style.getPropertyValue("--app-primary")).toBe("");
    expect(root.style.colorScheme).toBe("");
  });
});

describe("shell stylesheet", () => {
  it("imports cleanly and resolves its tokens on the document root", () => {
    // `base.css` @imports `tokens.css`; both are injected by the jsdom runner
    // with `css: true`. Reaching a token value here proves the import chain
    // resolved, which is what checkpoint 1 gates on.
    const injected = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .map((rule) => rule.cssText)
      .join("\n");

    expect(injected).toContain("--ink-950");
    expect(injected).toContain("--target-min");
    expect(injected).toContain("@layer reset, tokens, base");
  });
});

describe("the app theme's system-owned guard (CA-32)", () => {
  it("refuses an app theme that names --color-danger, and every other system-owned property", () => {
    expect(() => {
      assertPresentationOnly({ "--app-primary": "#3d4e69", "--color-danger": "#3d4e69" });
    }).toThrow("--color-danger");
    for (const name of SYSTEM_OWNED_PROPERTIES) {
      expect(() => {
        assertPresentationOnly({ [name]: "#000000" });
      }).toThrow(name);
    }
    expect(() => {
      assertPresentationOnly({ "--app-primary": "#3d4e69", "--color-surface": "#fcfcfd" });
    }).not.toThrow();
  });

  it("measures contrast against the same focus colours tokens.css fixes (Leaf 700, Sprout 300)", () => {
    const tokensCss = readFileSync(resolve(process.cwd(), "src/ui/theme/tokens.css"), "utf8");
    expect(tokensCss).toContain("--focus-ring-color: var(--leaf-700);");
    expect(tokensCss).toContain("--focus-ring-color-on-ink: var(--sprout-300);");
    expect(tokensCss).toContain(`--leaf-700: ${SYSTEM_FOCUS_COLORS.onLight};`);
    expect(tokensCss).toContain(`--sprout-300: ${SYSTEM_FOCUS_COLORS.onInk};`);
  });
});

describe("an app theme on its root (M40 app-theme, CA-32)", () => {
  const indigo = BUILT_IN_PALETTES.find((palette) => palette.key === "indigo")!;
  const theme = { tokens: indigo.light, darkTokens: indigo.dark };
  const systemOwned = new Set<string>(SYSTEM_OWNED_PROPERTIES);

  it("draws light with the palette's light set, and remaps the shell's roles onto it", () => {
    const variables = appThemeVariables(theme, "light");
    expect(variables["--app-primary"]).toBe(indigo.light["app-primary"]);
    expect(variables["--color-canvas"]).toBe(indigo.light["app-canvas"]);
    expect(variables["--color-action-text"]).toBe(indigo.light["app-surface"]);
    expect(variables["--color-chrome"]).toBe(indigo.light["app-ink"]);
    expect(variables["--color-chrome-text"]).toBe(indigo.light["app-surface"]);
    // Light keeps the shell's muted text and panels, which the palette canvases carry.
    expect(variables).not.toHaveProperty("--color-text-muted");
  });

  it("draws dark with the dark set: surface chrome, canvas label, ink for muted text", () => {
    const variables = appThemeVariables(theme, "dark");
    expect(variables["--app-primary"]).toBe(indigo.dark["app-primary"]);
    expect(variables["--color-text"]).toBe(indigo.dark["app-ink"]);
    expect(variables["--color-text-muted"]).toBe(indigo.dark["app-ink"]);
    expect(variables["--color-action-text"]).toBe(indigo.dark["app-canvas"]);
    expect(variables["--color-chrome"]).toBe(indigo.dark["app-surface"]);
    expect(variables["--color-panel"]).toBe(indigo.dark["app-muted"]);
  });

  it("puts a custom accent in place of the palette's in every mode", () => {
    const accented = { ...theme, customAccent: "#7fa9d6" };
    expect(appThemeTokens(accented, "light")["app-accent"]).toBe("#7fa9d6");
    expect(appThemeVariables(accented, "dark")["--app-accent"]).toBe("#7fa9d6");
  });

  it("steps compact density to the dense 12px, and leaves the hit-target floor alone", () => {
    expect(appThemeVariables({ ...theme, density: "compact" }, "light")["--space-16"]).toBe("var(--space-12)");
    expect(appThemeVariables(theme, "light")).not.toHaveProperty("--space-16");
  });

  it("draws a theme with no dark set in its only set", () => {
    expect(appThemeVariables(DEFAULT_APP_THEME, "dark")["--app-ink"]).toBe(DEFAULT_APP_THEME.tokens["app-ink"]);
  });

  it("never names a system-owned property, in any mode or density", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const density of ["comfortable", "compact"] as const) {
        const names = Object.keys(appThemeVariables({ ...theme, density }, mode));
        expect(names.filter((name) => systemOwned.has(name))).toEqual([]);
      }
    }
  });
});
