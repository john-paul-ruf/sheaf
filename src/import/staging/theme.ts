/**
 * The built-in default app theme, and a new app's visual identity (D29).
 *
 * `app_state.theme_cbor` is NOT NULL in migration 005, so hydration
 * *structurally* requires a theme: an app promoted without one could not be
 * opened. F02 has no theme editor (that is F04), so every app starts from the
 * one theme below.
 *
 * **Every value here already exists in M40.** design.md § Per-app theming
 * contract names the six app tokens; `src/ui/theme/tokens.css` and design.md
 * § Color palette give the shell's palette. Each token below is one of those
 * palette values, quoted with the token it came from. Nothing was invented,
 * and nothing here may be invented later: a colour with no source in M40 is a
 * design-fill seam, not a constant someone picks.
 *
 * The literals are duplicated rather than imported because a durable theme is
 * a **domain fact** sealed into an encrypted payload, not a stylesheet — and
 * because M23 must not import `src/ui/`. `tests/unit/staging/theme.test.ts`
 * pins them against `tokens.css` so a drift is a test failure, not a mismatch
 * a user would see.
 */

import type { AppId } from "../../domain/model/ids.js";
import type { AppThemeTokensV1, AppThemeV1 } from "../../domain/model/events.js";

/** Names the built-in theme this app started from (FR-17, F02 partial). */
export const DEFAULT_THEME_KEY = "sheaf.built-in.v1";

export const DEFAULT_APP_THEME: AppThemeV1 = Object.freeze({
  themeKey: DEFAULT_THEME_KEY,
  tokens: Object.freeze({
    /** Ink 950 — "Primary text, dark app chrome". */
    "app-ink": "#17211c",
    /** Paper 50 — "Shell canvas". */
    "app-canvas": "#f7f5ee",
    /** White — "Raised cards and inputs". */
    "app-surface": "#fffdf8",
    /** Leaf 700 — "Shell primary action and focus". */
    "app-primary": "#2d5a4b",
    /** Leaf 500 — "Secondary shell accents". */
    "app-accent": "#4f7d6c",
    /** Paper 200 — "Dividers and disabled fills". */
    "app-muted": "#e2ded2",
  }),
});

/**
 * The four built-in palettes (FR-17, D56), each as DF-1 gives it: design.md
 * § Per-app theming contract → "Built-in app palettes", the token table, rows
 * "{Palette} · light" and "{Palette} · dark" (design-fill `3a4317d`). Nothing
 * here was picked; `tests/unit/staging/theme.test.ts` reads that table as text
 * and pins every value, so a drift fails a test rather than an app.
 *
 * The key is durable: it is what `AppThemeV1.themeKey` names. A theme written
 * from a palette stores its light set as `tokens`; the dark set is read from
 * here when the theme is drawn dark.
 */
export interface BuiltInPaletteV1 {
  readonly key: string;
  /** The name the palette control shows (theme.html, CTL-115). */
  readonly name: string;
  readonly light: AppThemeTokensV1;
  readonly dark: AppThemeTokensV1;
}

const palette = (
  key: string,
  name: string,
  light: readonly [string, string, string, string, string, string],
  dark: readonly [string, string, string, string, string, string],
): BuiltInPaletteV1 => {
  const tokens = ([ink, canvas, surface, primary, accent, muted]: readonly string[]): AppThemeTokensV1 =>
    Object.freeze({
      "app-ink": ink as string,
      "app-canvas": canvas as string,
      "app-surface": surface as string,
      "app-primary": primary as string,
      "app-accent": accent as string,
      "app-muted": muted as string,
    });
  return Object.freeze({ key, name, light: tokens(light), dark: tokens(dark) });
};

/** Columns in design.md's order: ink, canvas, surface, primary, accent, muted. */
export const BUILT_IN_PALETTES: readonly BuiltInPaletteV1[] = Object.freeze([
  palette(
    "cedar",
    "Cedar",
    ["#17231e", "#f5f1e7", "#fffdf6", "#315c49", "#c66948", "#d9d0bf"],
    ["#f2eee3", "#121b17", "#1b2822", "#9cc7ae", "#e08a6a", "#2e3d35"],
  ),
  palette(
    "indigo",
    "Indigo",
    ["#1a2233", "#f2f3f6", "#fcfcfd", "#3d4e69", "#b5642a", "#d5d9e2"],
    ["#e9ecf3", "#121620", "#1b2130", "#a9b8d6", "#e39a5e", "#2c3446"],
  ),
  palette(
    "clay",
    "Clay",
    ["#2a1a14", "#f6efe9", "#fffbf7", "#7a4030", "#2f7a6e", "#e0d2c6"],
    ["#f4e9e1", "#1b1411", "#261c18", "#e3a58e", "#6cc2b3", "#3a2c26"],
  ),
  palette(
    "graphite",
    "Graphite",
    ["#1c1c1b", "#f4f3f1", "#fdfcfa", "#3d3c3a", "#3a6ea5", "#dad8d4"],
    ["#edece9", "#151514", "#201f1e", "#d6d4cf", "#7fa9d6", "#353432"],
  ),
]);

/** The built-in palette a theme key names, or undefined for the F02 key or any other. */
export function builtInPalette(themeKey: string): BuiltInPaletteV1 | undefined {
  return BUILT_IN_PALETTES.find((candidate) => candidate.key === themeKey);
}

/**
 * The accent ids a library tile may carry, in the order they are assigned.
 * Each names an M40 palette token; the catalog stores the **id**, never the
 * colour, so a palette change cannot leave an app holding a stale literal.
 */
export const APP_ACCENT_ORDER = Object.freeze([
  "leaf",
  "clay",
  "marigold",
  "river",
  "violet",
] as const);

/**
 * Picks an accent from the app's own identity, so two apps created in a row
 * usually differ (the mock's tiles deliberately do) and the same app always
 * looks the same. It is presentation only: nothing depends on which one.
 */
export function accentForApp(appId: AppId): string {
  const seed = (appId[0] ?? 0) + (appId[15] ?? 0);
  return APP_ACCENT_ORDER[seed % APP_ACCENT_ORDER.length] as string;
}

/**
 * The tile monogram: up to two initials from the app's name, uppercased.
 * A name with no letters at all still yields something — the first character
 * — because a tile with an empty monogram would look broken rather than
 * truthful.
 */
export function glyphForApp(displayName: string): string {
  const words = displayName
    .split(/\s+/u)
    .map((word) => [...word][0])
    .filter((initial): initial is string => initial !== undefined);

  const glyph = words.slice(0, 2).join("");
  return (glyph === "" ? [...displayName][0] ?? "?" : glyph).toUpperCase();
}
