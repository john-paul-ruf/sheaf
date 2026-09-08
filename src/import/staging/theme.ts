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
import type { AppThemeV1 } from "../../domain/model/events.js";

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
