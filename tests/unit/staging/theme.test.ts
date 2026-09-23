/**
 * D29: the built-in theme is composed from M40, not invented.
 *
 * `app_state.theme_cbor` is NOT NULL, so promotion must write *some* theme;
 * the danger is that "some theme" quietly becomes a colour nobody approved.
 * These cases pin every token to a literal that already appears in
 * `src/ui/theme/tokens.css`, so inventing a value here fails rather than
 * shipping. `src/ui/**` is read-only to this session and stays that way — the
 * file is read as text, never imported.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_ACCENT_ORDER,
  BUILT_IN_PALETTES,
  builtInPalette,
  DEFAULT_APP_THEME,
  DEFAULT_THEME_KEY,
  accentForApp,
  glyphForApp,
} from "../../../src/import/staging/theme.js";
import { APP_THEME_TOKENS, evaluateThemeContrast, themeRenderings } from "../../../src/domain/model/events.js";
import { APP_ACCENT_IDS } from "../../../src/workers/data/catalog.js";
import { asDomainId } from "../../../src/domain/model/ids.js";

const tokensCss = readFileSync(
  fileURLToPath(new URL("../../../src/ui/theme/tokens.css", import.meta.url)),
  "utf8",
).toLowerCase();

const appId = (first: number, last: number) =>
  asDomainId(
    "app",
    Uint8Array.from({ length: 16 }, (_unused, index) =>
      index === 0 ? first : index === 15 ? last : 0,
    ),
  );

describe("the built-in app theme", () => {
  it("names every token design.md's per-app contract declares", () => {
    expect(Object.keys(DEFAULT_APP_THEME.tokens).sort()).toEqual(
      [...APP_THEME_TOKENS].sort(),
    );
    expect(DEFAULT_APP_THEME.themeKey).toBe(DEFAULT_THEME_KEY);
  });

  it("uses only colours M40 already declares", () => {
    for (const [token, value] of Object.entries(DEFAULT_APP_THEME.tokens)) {
      expect(
        { token, value, inTokensCss: tokensCss.includes(value.toLowerCase()) },
      ).toEqual({ token, value, inTokensCss: true });
    }
  });

  it("names no system-owned semantic colour", () => {
    // Danger, warning, info and success are Sheaf's, not an app's: a theme
    // that reused one of those literals could make a safety state ambiguous.
    const systemOwned = ["#a84f32", "#c78316", "#396b8c"];
    for (const value of Object.values(DEFAULT_APP_THEME.tokens)) {
      expect(systemOwned).not.toContain(value.toLowerCase());
    }
  });

  it("is frozen, so a caller cannot mutate the one built-in theme", () => {
    expect(Object.isFrozen(DEFAULT_APP_THEME)).toBe(true);
    expect(Object.isFrozen(DEFAULT_APP_THEME.tokens)).toBe(true);
  });
});

describe("app identity", () => {
  it("only ever picks an accent the catalog validator approves", () => {
    expect([...APP_ACCENT_ORDER].sort()).toEqual([...APP_ACCENT_IDS].sort());
    for (let first = 0; first < 256; first += 7) {
      for (const last of [0, 31, 128, 255]) {
        expect(APP_ACCENT_IDS).toContain(accentForApp(appId(first, last)));
      }
    }
  });

  it("is stable for one app and spreads across several", () => {
    expect(accentForApp(appId(3, 4))).toBe(accentForApp(appId(3, 4)));
    const seen = new Set(
      Array.from({ length: 20 }, (_unused, index) =>
        accentForApp(appId(index, index)),
      ),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it("builds a monogram of at most two initials", () => {
    expect(glyphForApp("Field Log")).toBe("FL");
    expect(glyphForApp("Cedar and Finch Fieldbook")).toBe("CA");
    expect(glyphForApp("Inventory")).toBe("I");
    expect(glyphForApp("field  log")).toBe("FL");
  });

  it("never returns an empty monogram, whatever the name", () => {
    // A tile with no monogram would look broken rather than truthful, so even
    // a name with no letters yields something.
    for (const name of ["7", "—", "  x  ", "日本語 テスト"]) {
      const glyph = glyphForApp(name);
      expect(glyph.length).toBeGreaterThan(0);
      expect(glyph.length).toBeLessThanOrEqual(2);
    }
  });
});

/**
 * DF-1 (design.md § Per-app theming contract → "Built-in app palettes",
 * committed `3a4317d`), read as text: the token table pins every palette
 * constant, and the contrast table is the fixture the gate must reproduce.
 */
const designMd = readFileSync(
  fileURLToPath(new URL("../../../program/sheaf/specs/design.md", import.meta.url)),
  "utf8",
);
const dfSection = designMd.slice(designMd.indexOf("#### Built-in app palettes"), designMd.indexOf("### Typography"));

/** `| Palette · mode | a | b | … |` rows, cells with backticks and labels stripped. */
const tableRows = (header: string): readonly (readonly string[])[] => {
  const start = dfSection.indexOf(header);
  const lines = dfSection.slice(start).split("\n");
  const rows: string[][] = [];
  for (const line of lines.slice(2)) {
    if (!line.startsWith("|")) break;
    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replaceAll("`", "").replace(/\s*\(.*\)$/u, "")),
    );
  }
  return rows;
};

const TOKEN_COLUMNS = ["app-ink", "app-canvas", "app-surface", "app-primary", "app-accent", "app-muted"] as const;

describe("the built-in palettes (DF-1)", () => {
  const tokenRows = tableRows("| Palette · mode | `app-ink`");
  const contrastRows = tableRows("| Palette · mode | Ink / canvas");

  it("read eight token rows and eight contrast rows — a parse that found nothing would pass nothing", () => {
    expect(tokenRows).toHaveLength(8);
    expect(contrastRows).toHaveLength(8);
  });

  it("are the four palettes theme.html names, keyed and frozen", () => {
    expect(BUILT_IN_PALETTES.map((candidate) => [candidate.key, candidate.name])).toEqual([
      ["cedar", "Cedar"],
      ["indigo", "Indigo"],
      ["clay", "Clay"],
      ["graphite", "Graphite"],
    ]);
    expect(Object.isFrozen(BUILT_IN_PALETTES)).toBe(true);
    expect(BUILT_IN_PALETTES.every((candidate) => Object.isFrozen(candidate.light) && Object.isFrozen(candidate.dark))).toBe(true);
    expect(builtInPalette("indigo")?.name).toBe("Indigo");
    expect(builtInPalette(DEFAULT_THEME_KEY)).toBeUndefined();
  });

  it("hold exactly design.md's token table, every value", () => {
    for (const [label = "", ...values] of tokenRows) {
      const [name, mode] = label.split(" · ") as [string, "light" | "dark"];
      const found = BUILT_IN_PALETTES.find((candidate) => candidate.name === name);
      expect(found, label).toBeDefined();
      const tokens = TOKEN_COLUMNS.map((token) => found?.[mode][token]);
      expect({ label, tokens }).toEqual({ label, tokens: values.map((value) => value.toLowerCase()) });
    }
  });

  it("show the swatch colours theme.html draws: each light primary", () => {
    for (const swatch of ["#315c49", "#3d4e69", "#7a4030", "#3d3c3a"]) {
      expect(BUILT_IN_PALETTES.map((candidate) => candidate.light["app-primary"])).toContain(swatch);
    }
  });

  it("reproduce design.md's contrast table through the gate, rounded down to two decimals, and all pass", () => {
    const columns = [
      "ink-canvas",
      "ink-surface",
      "primary-label",
      "accent-canvas",
      "accent-surface",
      "focus-canvas",
      "focus-surface",
      "focus-chrome",
    ] as const;
    for (const [label = "", ...cells] of contrastRows) {
      const [name, mode] = label.split(" · ") as [string, "light" | "dark"];
      const found = builtInPalette(name.toLowerCase());
      if (found === undefined) throw new Error(`no palette ${name}`);
      const checks = evaluateThemeContrast(
        themeRenderings({ themeKey: found.key, tokens: found.light, mode }, found.dark),
      );
      const measured = columns.map((pair) => {
        const check = checks.find((candidate) => candidate.pair === pair);
        return check === undefined ? "—" : (Math.floor(check.ratio * 100) / 100).toFixed(2);
      });
      expect({ label, measured }).toEqual({ label, measured: cells });
      expect(checks.every((check) => check.passes)).toBe(true);
    }
  });

  it("never names a system-owned semantic colour", () => {
    const systemOwned = ["#a84f32", "#c78316", "#396b8c"];
    for (const candidate of BUILT_IN_PALETTES) {
      for (const value of [...Object.values(candidate.light), ...Object.values(candidate.dark)]) {
        expect(systemOwned).not.toContain(value);
      }
    }
  });
});
