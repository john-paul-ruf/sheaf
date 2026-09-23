/**
 * M40 — an app's theme applied to its root (D56, CA-32; design.md § Per-app
 * theming contract → "Built-in app palettes").
 *
 * The app root gets the six `--app-*` tokens for the mode it is drawn in, and
 * the shell's *presentation* roles remapped onto them, so every surface under
 * the root — which reads `--color-canvas`, `--color-text`, `--color-action` …
 * — is drawn in the app's palette without knowing it has one. The
 * system-owned semantics are not among them: the variables pass through
 * {@link assertPresentationOnly}, which throws on any of them.
 *
 * What the system decides per mode is in `tokens.css`, keyed by
 * `data-app-mode`: in a dark app the focus ring is Sprout 300 on every
 * background. That is the system's choice, not the theme's.
 *
 * - Light chrome is `app-ink` with `app-surface` on it; dark chrome is
 *   `app-surface` with `app-ink` on it. Both are the ink/surface pair the gate
 *   measures.
 * - Text on `app-primary` is `app-surface` in light and `app-canvas` in dark.
 * - Compact density is design.md § Spacing system's dense step — 12px where
 *   comfortable has 16px. Hit targets read `--target-min`, which no density
 *   touches.
 */

import { useSyncExternalStore } from "react";
import type {
  AppThemeDensityV1,
  AppThemeModeV1,
  AppThemeTokenV1,
} from "../../domain/model/events.js";
import { assertPresentationOnly, type ThemeVariables } from "./theme.js";

export type AppThemeTokenSet = Readonly<Record<AppThemeTokenV1, string>>;

/** The theme as the page holds it: the wire shape, structurally. */
export interface AppThemeSource {
  readonly tokens: AppThemeTokenSet;
  /** The palette's dark set; absent, the theme can be drawn only in light. */
  readonly darkTokens?: AppThemeTokenSet;
  readonly customAccent?: string;
  readonly mode?: AppThemeModeV1;
  readonly density?: AppThemeDensityV1;
}

export type AppRenderMode = "light" | "dark";

/** The six tokens a theme is drawn with in `mode`, the custom accent in place. */
export function appThemeTokens(theme: AppThemeSource, mode: AppRenderMode): AppThemeTokenSet {
  const tokens = mode === "dark" && theme.darkTokens !== undefined ? theme.darkTokens : theme.tokens;
  return theme.customAccent === undefined ? tokens : { ...tokens, "app-accent": theme.customAccent };
}

/**
 * Every custom property the app root carries when drawn in `drawn` (from
 * {@link useAppRenderMode}). Throws on a system-owned one.
 */
export function appThemeVariables(theme: AppThemeSource, drawn: AppRenderMode): ThemeVariables {
  const tokens = appThemeTokens(theme, drawn);
  const variables: Record<`--${string}`, string> = {
    "--app-ink": tokens["app-ink"],
    "--app-canvas": tokens["app-canvas"],
    "--app-surface": tokens["app-surface"],
    "--app-primary": tokens["app-primary"],
    "--app-accent": tokens["app-accent"],
    "--app-muted": tokens["app-muted"],
    "--color-canvas": tokens["app-canvas"],
    "--color-surface": tokens["app-surface"],
    "--color-text": tokens["app-ink"],
    "--color-action": tokens["app-primary"],
    "--color-accent": tokens["app-accent"],
  };
  if (drawn === "light") {
    variables["--color-action-text"] = tokens["app-surface"];
    variables["--color-chrome"] = tokens["app-ink"];
    variables["--color-chrome-text"] = tokens["app-surface"];
  } else {
    // The shell's muted text, hairlines and panels are light-canvas values;
    // on a dark canvas the palette's own ink and muted take their place.
    variables["--color-action-text"] = tokens["app-canvas"];
    variables["--color-chrome"] = tokens["app-surface"];
    variables["--color-chrome-text"] = tokens["app-ink"];
    variables["--color-text-muted"] = tokens["app-ink"];
    variables["--color-panel"] = tokens["app-muted"];
    variables["--color-border"] = tokens["app-muted"];
    variables["--color-border-input"] = tokens["app-muted"];
    variables["--color-disabled-fill"] = tokens["app-muted"];
  }
  if (theme.density === "compact") {
    variables["--space-16"] = "var(--space-12)";
  }
  assertPresentationOnly(variables);
  return variables;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

const darkMedia = (): MediaQueryList | null =>
  typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;

function subscribeToScheme(onChange: () => void): () => void {
  const media = darkMedia();
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}

const prefersDark = (): boolean => darkMedia()?.matches ?? false;

/**
 * The mode an app is drawn in now: `system` follows the device, live, and a
 * theme with no dark set is drawn light whatever it asks for — so the root
 * never claims a dark mode (and its Sprout focus ring) over a light canvas.
 */
export function useAppRenderMode(theme: AppThemeSource): AppRenderMode {
  const deviceIsDark = useSyncExternalStore(subscribeToScheme, prefersDark, () => false);
  const requested = theme.mode === "system" ? (deviceIsDark ? "dark" : "light") : (theme.mode ?? "light");
  return requested === "dark" && theme.darkTokens !== undefined ? "dark" : "light";
}

/** A logo as an image source. The bytes are a PNG the page re-encoded itself (D56). */
export function logoSource(logo: { readonly pngBase64: string }): string {
  return `data:image/png;base64,${logo.pngBase64}`;
}
