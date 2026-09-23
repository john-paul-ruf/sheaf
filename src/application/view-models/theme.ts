/**
 * SCR-036, the theme editor (M37; CAP-37, CA-32, D56; theme.html).
 *
 * The editor holds a draft — a palette, an optional custom accent, a mode, a
 * density and what to do with the logo — and this module says what that draft
 * looks like and whether it may be saved. The verdict is the same pure gate the
 * worker's `changeTheme` runs (M01 `evaluateThemeContrast`), over every mode
 * the draft can be drawn in, so the page never offers a save the worker would
 * refuse on contrast.
 *
 * Copy is theme.html's where it has words; the contrast failure names the pair
 * with design.md's contrast-table headings ("Accent / canvas") and the mode,
 * and the settings summary follows app-settings.html ("Cedar · light ·
 * comfortable"), composed from the stored theme's facts.
 */

import {
  evaluateThemeContrast,
  themeRenderings,
  type AppThemeTokensV1,
  type ThemeContrastCheckV1,
  type ThemeContrastPairV1,
} from "../../domain/model/events.js";
import type {
  AppLogoWireV1,
  AppThemeDensityWireV1,
  AppThemeModeWireV1,
  AppThemeWireV1,
  ChangeThemeRequestV1,
  ThemeOutcomeWireV1,
  ThemePaletteWireV1,
} from "../../workers/protocol/messages.js";

export type ThemeLogoDraft = ChangeThemeRequestV1["logo"];

export interface ThemeDraft {
  /** A built-in palette key, or the stored legacy key until one is chosen. */
  readonly themeKey: string;
  readonly customAccent: string | null;
  readonly mode: AppThemeModeWireV1;
  readonly density: AppThemeDensityWireV1;
  readonly logo: ThemeLogoDraft;
}

/** The draft the editor opens with: the stored theme, as it is. */
export function draftFromTheme(theme: AppThemeWireV1): ThemeDraft {
  return {
    themeKey: theme.themeKey,
    customAccent: theme.customAccent ?? null,
    mode: theme.mode ?? "light",
    density: theme.density ?? "comfortable",
    logo: { kind: "keep" },
  };
}

/** The logo the draft would leave the app with. */
export function draftLogo(draft: ThemeDraft, stored: AppThemeWireV1): AppLogoWireV1 | null {
  switch (draft.logo.kind) {
    case "keep":
      return stored.logo ?? null;
    case "remove":
      return null;
    case "set":
      return { pngBase64: draft.logo.pngBase64, width: draft.logo.width, height: draft.logo.height };
    default: {
      const unreachable: never = draft.logo;
      return unreachable;
    }
  }
}

/**
 * The theme the draft would save, as the app frame draws it: a palette's
 * light set and dark set, or — while no palette is chosen — the stored tokens.
 */
export function draftTheme(
  draft: ThemeDraft,
  stored: AppThemeWireV1,
  palettes: readonly ThemePaletteWireV1[],
): AppThemeWireV1 {
  const palette = palettes.find((candidate) => candidate.key === draft.themeKey);
  const logo = draftLogo(draft, stored);
  return {
    themeKey: draft.themeKey,
    tokens: palette?.light ?? stored.tokens,
    mode: draft.mode,
    density: draft.density,
    ...(palette === undefined ? {} : { darkTokens: palette.dark }),
    ...(draft.customAccent === null ? {} : { customAccent: draft.customAccent }),
    ...(logo === null ? {} : { logo }),
  };
}

/** design.md's contrast-table column headings. */
const PAIR_NAMES: Readonly<Record<ThemeContrastPairV1, string>> = Object.freeze({
  "ink-canvas": "Ink / canvas",
  "ink-surface": "Ink / surface",
  "primary-label": "Primary label",
  "accent-canvas": "Accent / canvas",
  "accent-surface": "Accent / surface",
  "focus-canvas": "Focus / canvas",
  "focus-surface": "Focus / surface",
  "focus-chrome": "Focus / app-ink chrome",
});

/** "Accent / canvas (dark)". */
export function describeContrastCheck(check: Pick<ThemeContrastCheckV1, "mode" | "pair">): string {
  return `${PAIR_NAMES[check.pair]} (${check.mode})`;
}

export interface ThemeVerdictVm {
  readonly passes: boolean;
  /** "Contrast passes" / "Contrast fails: Accent / canvas (dark)". */
  readonly title: string;
  readonly detail: string;
  readonly failures: readonly string[];
}

const MODES_CHECKED: Readonly<Record<string, string>> = Object.freeze({
  light: "in light mode",
  dark: "in dark mode",
  "light,dark": "in both modes",
});

/** The draft's contrast, over every mode it can be drawn in (CA-32). */
export function selectThemeVerdict(theme: AppThemeWireV1): ThemeVerdictVm {
  const darkTokens: AppThemeTokensV1 | null = theme.darkTokens ?? null;
  // A theme with no dark set is drawn light whatever it asks for.
  const renderings = themeRenderings(
    {
      themeKey: theme.themeKey,
      tokens: theme.tokens,
      mode: darkTokens === null ? "light" : (theme.mode ?? "light"),
      ...(theme.customAccent === undefined ? {} : { customAccent: theme.customAccent }),
    },
    darkTokens,
  );
  const checks = evaluateThemeContrast(renderings);
  const failures = checks.filter((check) => !check.passes).map(describeContrastCheck);
  const modes = MODES_CHECKED[renderings.map((rendering) => rendering.mode).join(",")] ?? "";
  if (failures.length === 0) {
    return {
      passes: true,
      title: "Contrast passes",
      // theme.html's sentence, with the modes this theme is actually drawn in.
      detail: `All text and focus indicators meet the visual contract ${modes}.`,
      failures,
    };
  }
  return {
    passes: false,
    title: `Contrast fails: ${failures.join(", ")}`,
    detail: `Choose another accent or palette. Text needs 4.5:1 and indicators 3:1 ${modes}.`,
    failures,
  };
}

export interface ThemePaletteChoiceVm {
  readonly key: string;
  readonly name: string;
  /** The palette's identity colour: its light primary (design.md, CTL-115). */
  readonly swatch: string;
  /** The label colour on it (design.md § Built-in app palettes). */
  readonly swatchLabel: string;
  readonly isSelected: boolean;
}

export type ThemeSaveVm =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: string };

export interface ThemeEditorVm {
  readonly screen: "SCR-036";
  readonly title: string;
  readonly palettes: readonly ThemePaletteChoiceVm[];
  /** The accent the draft draws with: the custom one, or the palette's. */
  readonly accent: string;
  readonly isCustomAccent: boolean;
  readonly mode: AppThemeModeWireV1;
  readonly density: AppThemeDensityWireV1;
  readonly logo: AppLogoWireV1 | null;
  readonly verdict: ThemeVerdictVm;
  readonly save: ThemeSaveVm;
  /** The theme the preview draws. */
  readonly preview: AppThemeWireV1;
}

const sameLogo = (left: AppLogoWireV1 | null, right: AppLogoWireV1 | null): boolean =>
  left?.pngBase64 === right?.pngBase64 && left?.width === right?.width && left?.height === right?.height;

function isUnchanged(theme: AppThemeWireV1, stored: AppThemeWireV1): boolean {
  return (
    theme.themeKey === stored.themeKey &&
    (theme.customAccent ?? null) === (stored.customAccent ?? null) &&
    theme.mode === (stored.mode ?? "light") &&
    theme.density === (stored.density ?? "comfortable") &&
    sameLogo(theme.logo ?? null, stored.logo ?? null)
  );
}

export function selectThemeEditorVm(input: {
  readonly appName: string;
  readonly stored: AppThemeWireV1;
  readonly palettes: readonly ThemePaletteWireV1[];
  readonly draft: ThemeDraft;
}): ThemeEditorVm {
  const { appName, stored, palettes, draft } = input;
  const preview = draftTheme(draft, stored, palettes);
  const verdict = selectThemeVerdict(preview);
  const hasPalette = palettes.some((palette) => palette.key === draft.themeKey);
  const save: ThemeSaveVm = !hasPalette
    ? { enabled: false, reason: "Choose a palette first." }
    : !verdict.passes
      ? { enabled: false, reason: verdict.title }
      : isUnchanged(preview, stored)
        ? { enabled: false, reason: "Change the theme first." }
        : { enabled: true };
  return {
    screen: "SCR-036",
    // theme.html: "Theme Cedar & Finch."
    title: `Theme ${appName}.`,
    palettes: palettes.map((palette) => ({
      key: palette.key,
      name: palette.name,
      swatch: palette.light["app-primary"],
      swatchLabel: palette.light["app-surface"],
      isSelected: palette.key === draft.themeKey,
    })),
    accent: draft.customAccent ?? preview.tokens["app-accent"],
    isCustomAccent: draft.customAccent !== null,
    mode: draft.mode,
    density: draft.density,
    logo: preview.logo ?? null,
    verdict,
    save,
    preview,
  };
}

const MODE_WORDS: Readonly<Record<AppThemeModeWireV1, string>> = Object.freeze({
  light: "light",
  dark: "dark",
  system: "follow device",
});

/** app-settings.html's "Cedar · light · comfortable", from the stored theme. */
export function describeThemeSummary(theme: AppThemeWireV1, palettes: readonly ThemePaletteWireV1[]): string {
  const palette = palettes.find((candidate) => candidate.key === theme.themeKey);
  const parts = [MODE_WORDS[theme.mode ?? "light"], theme.density ?? "comfortable"];
  const summary = palette === undefined ? parts.join(" · ") : [palette.name, ...parts].join(" · ");
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

/** Why a logo was not taken; the initials remain (theme.html, D56). */
export type LogoRefusalV1 = "unreadable" | "over-bytes" | "over-edge";

export function describeLogoRefusal(reason: LogoRefusalV1): string {
  switch (reason) {
    case "unreadable":
      return "This image could not be read, so the initials remain.";
    case "over-bytes":
      return "This image is over 64 KiB even at 256 × 256 pixels, so the initials remain.";
    case "over-edge":
      return "This image is over 256 × 256 pixels, so the initials remain.";
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

/** What a save's answer says. `null` for a save that changed nothing to announce. */
export function describeThemeOutcome(outcome: ThemeOutcomeWireV1): { readonly saved: boolean; readonly sentence: string | null } {
  switch (outcome.result) {
    case "changed":
      return { saved: true, sentence: "Saved on this device." };
    case "unchanged":
      return { saved: true, sentence: null };
    case "unknown-app":
      return { saved: false, sentence: "This app is no longer on this device, so nothing was saved." };
    case "refused":
      switch (outcome.refusal.kind) {
        case "contrast":
          return {
            saved: false,
            sentence: `Contrast fails: ${outcome.refusal.failures.map(describeContrastCheck).join(", ")}`,
          };
        case "unknown-palette":
          return { saved: false, sentence: "Choose a palette first." };
        case "logo":
          return { saved: false, sentence: describeLogoRefusal(outcome.refusal.reason) };
        case "invalid-accent":
          return { saved: false, sentence: "This accent is not a colour Sheaf can draw, so nothing was saved." };
        default: {
          const unreachable: never = outcome.refusal;
          return unreachable;
        }
      }
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}
