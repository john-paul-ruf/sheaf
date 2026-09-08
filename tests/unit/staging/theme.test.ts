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
  DEFAULT_APP_THEME,
  DEFAULT_THEME_KEY,
  accentForApp,
  glyphForApp,
} from "../../../src/import/staging/theme.js";
import { APP_THEME_TOKENS } from "../../../src/domain/model/events.js";
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
