import { beforeEach, describe, expect, it } from "vitest";
import {
  applyShellTheme,
  SYSTEM_OWNED_PROPERTIES,
} from "../../../src/ui/theme/theme.js";
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
