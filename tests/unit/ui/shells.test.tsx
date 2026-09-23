import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppShell,
  type ShellDestination,
} from "../../../src/ui/layout/app-shell.js";
import { AuthShell } from "../../../src/ui/layout/auth-shell.js";
import { AppFrame, type AppIdentity, type AppNavigation } from "../../../src/ui/records/app-frame.js";
import { BUILT_IN_PALETTES } from "../../../src/import/staging/theme.js";
import "../../../src/ui/theme/base.css";
import { cssRulesFor, interact, query, queryAll, render } from "./render.js";

const DESTINATIONS: readonly ShellDestination[] = [
  { id: "library", label: "All apps", href: "#/library", glyph: "A" },
  {
    id: "security",
    label: "Security",
    href: "#/settings/security",
    glyph: "S",
    isCurrent: true,
  },
];

describe("AuthShell — pre-unlock frame", () => {
  it("puts one main landmark behind a skip link that targets it", async () => {
    await render(
      <AuthShell wordmark={<span>Sheaf</span>}>
        <h1>Unlock Sheaf</h1>
      </AuthShell>,
    );

    const skip = query<HTMLAnchorElement>("a");
    const main = query("main");
    expect(skip.textContent).toBe("Skip to content");
    expect(skip.getAttribute("href")).toBe(`#${main.id}`);
    expect(main.id).not.toBe("");
    expect(queryAll("main")).toHaveLength(1);
  });

  it("offers no navigation: nothing else is reachable while locked", async () => {
    await render(
      <AuthShell wordmark={<span>Sheaf</span>}>
        <h1>Unlock Sheaf</h1>
      </AuthShell>,
    );
    expect(queryAll("nav")).toHaveLength(0);
  });

  it("renders the wordmark and header status the caller supplies", async () => {
    await render(
      <AuthShell
        wordmark={<span>Sheaf</span>}
        headerAside={<span>No network needed</span>}
      >
        <h1>Unlock Sheaf</h1>
      </AuthShell>,
    );
    const header = query("header");
    expect(header.textContent).toContain("Sheaf");
    expect(header.textContent).toContain("No network needed");
  });

  it("keeps DOM order equal to visual order: header, then content", async () => {
    const { container } = await render(
      <AuthShell wordmark={<span>Sheaf</span>}>
        <h1>Unlock Sheaf</h1>
      </AuthShell>,
    );
    const landmarks = [...container.querySelectorAll("header, main")].map(
      (element) => element.tagName,
    );
    expect(landmarks).toEqual(["HEADER", "MAIN"]);
  });

  it("pads for the safe area at the bottom of the column", async () => {
    await render(
      <AuthShell wordmark={<span>Sheaf</span>}>
        <h1>Unlock Sheaf</h1>
      </AuthShell>,
    );
    expect(cssRulesFor(query("main")).join(" ")).toContain(
      "env(safe-area-inset-bottom)",
    );
  });

  it("declares each layout class gutter design.md names", async () => {
    await render(
      <AuthShell wordmark={<span>Sheaf</span>}>
        <h1>Unlock Sheaf</h1>
      </AuthShell>,
    );
    const inMedia = cssRulesFor(query("main"), { insideMediaQuery: true }).join(
      " ",
    );
    expect(cssRulesFor(query("main")).join(" ")).toContain(
      "var(--gutter-compact)",
    );
    expect(inMedia).toContain("var(--gutter-wide)");
    expect(inMedia).toContain("var(--gutter-desktop)");
  });
});

describe("AppShell — post-unlock frame", () => {
  const renderShell = () =>
    render(
      <AppShell
        destinations={DESTINATIONS}
        title="Security"
        topBarActions={<span>Unlocked</span>}
        wordmark={<span>Sheaf</span>}
      >
        <h1>Security &amp; local unlock</h1>
      </AppShell>,
    );

  it("offers the same destinations in the rail and the bottom bar", async () => {
    await renderShell();
    const navs = queryAll("nav");
    expect(navs).toHaveLength(2);

    const hrefsOf = (nav: Element): readonly string[] =>
      [...nav.querySelectorAll("a")].map((link) => link.getAttribute("href") ?? "");

    // Same destinations, same order — the keyboard path does not change with
    // width, and no destination exists at one layout class only.
    expect(hrefsOf(navs[0] as Element)).toEqual(["#/library", "#/settings/security"]);
    expect(hrefsOf(navs[0] as Element)).toEqual(hrefsOf(navs[1] as Element));
  });

  it("marks the current destination in both navigations", async () => {
    await renderShell();
    const current = queryAll('[aria-current="page"]');
    expect(current).toHaveLength(2);
    for (const link of current) {
      expect(link.getAttribute("href")).toBe("#/settings/security");
    }
  });

  it("labels every destination in text, with the glyph decorative", async () => {
    await renderShell();
    const link = query('nav a[href="#/library"]');
    expect(link.textContent).toContain("All apps");
    expect(link.querySelector('[aria-hidden="true"]')?.textContent).toBe("A");
  });

  it("keeps the rail link's accessible name where the label is not drawn", async () => {
    await renderShell();
    // 900–1199px hides `.railLabel`; the name has to survive that.
    const railLink = query('aside nav a[href="#/library"]');
    expect(railLink.getAttribute("aria-label")).toBe("All apps");
  });

  it("keeps exactly one main landmark, reachable by skip link", async () => {
    await renderShell();
    const main = query("main");
    expect(queryAll("main")).toHaveLength(1);
    expect(query<HTMLAnchorElement>("a").getAttribute("href")).toBe(
      `#${main.id}`,
    );
  });

  it("reserves room so the fixed bottom bar never covers the last content", async () => {
    await renderShell();
    const pageRules = cssRulesFor(query("main")).join(" ");
    expect(pageRules).toContain("padding-bottom");
    expect(pageRules).toContain("env(safe-area-inset-bottom)");
  });

  it("swaps the bottom bar for the rail at the tablet-landscape class", async () => {
    await renderShell();
    const bottomBar = queryAll("nav")[1] as Element;
    const rail = query("aside");

    // Compact and wide phone: bottom bar shown, rail hidden.
    expect(cssRulesFor(rail).join(" ")).toContain("display: none");
    // Tablet landscape and up: the two trade places, inside a media query.
    const railInMedia = cssRulesFor(rail, { insideMediaQuery: true }).join(" ");
    const barInMedia = cssRulesFor(bottomBar, { insideMediaQuery: true }).join(" ");
    expect(railInMedia).toContain("display: flex");
    expect(barInMedia).toContain("display: none");
  });

  it("declares all four layout classes design.md names", async () => {
    await renderShell();
    const widths = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule)
      .map((rule) => rule.conditionText);

    expect(widths).toContain("(min-width: 600px)");
    expect(widths).toContain("(min-width: 900px)");
    expect(widths).toContain("(min-width: 1200px)");
  });

  it("puts the rail before main in the DOM, matching its visual position", async () => {
    const { container } = await render(
      <AppShell destinations={DESTINATIONS} wordmark={<span>Sheaf</span>}>
        <h1>Library</h1>
      </AppShell>,
    );
    const order = [...container.querySelectorAll("aside, main, nav")].map(
      (element) => element.tagName,
    );
    expect(order).toEqual(["ASIDE", "NAV", "MAIN", "NAV"]);
  });
});

describe("AppFrame — the app's theme, mode and density on its root (CAP-37)", () => {
  const indigo = BUILT_IN_PALETTES.find((palette) => palette.key === "indigo")!;
  const nav: AppNavigation = {
    library: "#/library",
    appHome: "#/app/a",
    appHistory: "#/app/a/history",
    appSnapshots: "#/app/a/snapshots",
    tables: [],
  };
  const app = (theme: Partial<AppIdentity["theme"]>): AppIdentity => ({
    appId: "a",
    displayName: "Cedar & Finch",
    theme: { themeKey: "indigo", tokens: indigo.light, darkTokens: indigo.dark, ...theme },
  });
  const frame = (identity: AppIdentity) => (
    <AppFrame app={identity} area="home" nav={nav} title="App home">
      <p>Body</p>
    </AppFrame>
  );
  const root = (): HTMLElement => query("[data-app-mode]");

  /** A device colour scheme the test can flip, as `matchMedia` reports it. */
  function deviceScheme(initiallyDark: boolean) {
    let isDark = initiallyDark;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      media: query,
      get matches() {
        return query === "(prefers-color-scheme: dark)" && isDark;
      },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }));
    return {
      listeners,
      flip: (dark: boolean) => {
        isDark = dark;
        for (const listener of listeners) listener();
      },
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws a dark theme with the dark set and marks the root dark", async () => {
    await render(frame(app({ mode: "dark" })));
    expect(root().dataset["appMode"]).toBe("dark");
    expect(root().style.getPropertyValue("--app-primary")).toBe(indigo.dark["app-primary"]);
    expect(root().style.getPropertyValue("--color-canvas")).toBe(indigo.dark["app-canvas"]);
    expect(root().style.getPropertyValue("--color-danger")).toBe("");
    expect(root().style.getPropertyValue("--focus-ring-color")).toBe("");
  });

  it("follows the device live in system mode, and stops listening when it leaves", async () => {
    const device = deviceScheme(false);
    const mounted = await render(frame(app({ mode: "system" })));
    expect(root().dataset["appMode"]).toBe("light");
    expect(root().style.getPropertyValue("--app-canvas")).toBe(indigo.light["app-canvas"]);

    await interact(() => device.flip(true));
    expect(root().dataset["appMode"]).toBe("dark");
    expect(root().style.getPropertyValue("--app-canvas")).toBe(indigo.dark["app-canvas"]);

    mounted.unmount();
    expect(device.listeners.size).toBe(0);
  });

  it("ignores the device for an explicit mode", async () => {
    deviceScheme(true);
    await render(frame(app({ mode: "light" })));
    expect(root().dataset["appMode"]).toBe("light");
  });

  it("marks the density, and compact steps the 16px spacing to 12px", async () => {
    await render(frame(app({ density: "compact" })));
    expect(root().dataset["appDensity"]).toBe("compact");
    expect(root().style.getPropertyValue("--space-16")).toBe("var(--space-12)");
  });

  it("refuses to draw a theme that reaches a system-owned property", async () => {
    const tokens = { ...indigo.light, "--color-danger": "#000000" } as typeof indigo.light;
    const hostile = { ...app({}), theme: { themeKey: "indigo", tokens } };
    // Only the six named tokens are read, so a stray key never reaches the root.
    await render(frame(hostile));
    expect(root().style.getPropertyValue("--color-danger")).toBe("");
  });
});
