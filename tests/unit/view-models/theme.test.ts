/**
 * SCR-036's view model (M37; CAP-37, CA-32): the verdict is the gate the
 * worker runs, over every mode the draft is drawn in; the save is off with a
 * reason whenever the worker would refuse or there is nothing to save; the
 * copy names pairs with design.md's contrast-table headings.
 */

import { describe, expect, it } from "vitest";
import {
  describeThemeOutcome,
  describeThemeSummary,
  draftFromTheme,
  draftTheme,
  selectThemeEditorVm,
  selectThemeVerdict,
} from "../../../src/application/view-models/theme.js";
import { BUILT_IN_PALETTES, DEFAULT_APP_THEME } from "../../../src/import/staging/theme.js";
import type { AppThemeWireV1, ThemePaletteWireV1 } from "../../../src/workers/protocol/messages.js";

const palettes: readonly ThemePaletteWireV1[] = BUILT_IN_PALETTES.map(({ key, name, light, dark }) => ({ key, name, light, dark }));
const indigo = palettes[1]!;
const stored: AppThemeWireV1 = { themeKey: "indigo", tokens: indigo.light, darkTokens: indigo.dark };
const legacy: AppThemeWireV1 = { themeKey: DEFAULT_APP_THEME.themeKey, tokens: DEFAULT_APP_THEME.tokens };

describe("the contrast verdict (CA-32)", () => {
  it("passes every built-in palette in every mode, and says which modes it checked", () => {
    for (const palette of palettes) {
      for (const mode of ["light", "dark", "system"] as const) {
        const verdict = selectThemeVerdict({ themeKey: palette.key, tokens: palette.light, darkTokens: palette.dark, mode });
        expect(verdict.passes, `${palette.key} ${mode}`).toBe(true);
      }
    }
    expect(selectThemeVerdict({ ...stored, mode: "system" }).detail).toBe(
      "All text and focus indicators meet the visual contract in both modes.",
    );
    expect(selectThemeVerdict({ ...stored, mode: "dark" }).detail).toContain("in dark mode.");
  });

  it("names each failing pair by its design.md heading and mode", () => {
    const verdict = selectThemeVerdict({ ...stored, mode: "system", customAccent: "#1b2130" });
    expect(verdict.passes).toBe(false);
    expect(verdict.failures).toEqual(["Accent / canvas (dark)", "Accent / surface (dark)"]);
    expect(verdict.title).toBe("Contrast fails: Accent / canvas (dark), Accent / surface (dark)");
  });

  it("judges a theme with no dark set as the light theme it is drawn as", () => {
    expect(selectThemeVerdict({ ...legacy, mode: "dark" }).detail).toContain("in light mode.");
  });
});

describe("the editor (SCR-036)", () => {
  const vm = (draft = draftFromTheme(stored), from = stored) =>
    selectThemeEditorVm({ appName: "Cedar & Finch", stored: from, palettes, draft });

  it("opens on the stored theme with nothing to save", () => {
    const opened = vm();
    expect(opened.title).toBe("Theme Cedar & Finch.");
    expect(opened.palettes.filter((choice) => choice.isSelected).map((choice) => choice.key)).toEqual(["indigo"]);
    expect(opened.palettes[1]).toMatchObject({ swatch: indigo.light["app-primary"], swatchLabel: indigo.light["app-surface"] });
    expect(opened.save).toEqual({ enabled: false, reason: "Change the theme first." });
  });

  it("enables a changed draft that passes, and refuses one that fails with the failure as its reason", () => {
    expect(vm({ ...draftFromTheme(stored), density: "compact" }).save).toEqual({ enabled: true });
    const failing = vm({ ...draftFromTheme(stored), mode: "dark", customAccent: "#1b2130" });
    expect(failing.save).toEqual({ enabled: false, reason: failing.verdict.title });
    expect(failing.accent).toBe("#1b2130");
  });

  it("asks an F02 theme for a palette before anything is saved", () => {
    const legacyVm = vm({ ...draftFromTheme(legacy), mode: "dark" }, legacy);
    expect(legacyVm.save).toEqual({ enabled: false, reason: "Choose a palette first." });
    expect(vm({ ...draftFromTheme(legacy), themeKey: "cedar" }, legacy).save).toEqual({ enabled: true });
  });

  it("draws the draft's logo: kept, replaced or removed", () => {
    const logo = { pngBase64: "AAAA", width: 2, height: 2 };
    const withLogo = { ...stored, logo };
    expect(draftTheme(draftFromTheme(withLogo), withLogo, palettes).logo).toEqual(logo);
    expect(draftTheme({ ...draftFromTheme(withLogo), logo: { kind: "remove" } }, withLogo, palettes)).not.toHaveProperty("logo");
    const next = { pngBase64: "BBBB", width: 3, height: 1 };
    expect(draftTheme({ ...draftFromTheme(stored), logo: { kind: "set", ...next } }, stored, palettes).logo).toEqual(next);
  });
});

describe("the words", () => {
  it("summarises the stored theme as app-settings.html does", () => {
    expect(describeThemeSummary({ ...stored, mode: "dark", density: "compact" }, palettes)).toBe("Indigo · dark · compact");
    expect(describeThemeSummary(stored, palettes)).toBe("Indigo · light · comfortable");
    expect(describeThemeSummary({ ...legacy, mode: "system" }, palettes)).toBe("Follow device · comfortable");
  });

  it("acknowledges only a commit, and names every refusal", () => {
    expect(describeThemeOutcome({ result: "changed", theme: stored })).toEqual({ saved: true, sentence: "Saved on this device." });
    expect(describeThemeOutcome({ result: "unchanged", theme: stored })).toEqual({ saved: true, sentence: null });
    expect(describeThemeOutcome({ result: "refused", refusal: { kind: "unknown-palette" } }).sentence).toBe("Choose a palette first.");
    expect(describeThemeOutcome({ result: "refused", refusal: { kind: "logo", reason: "unreadable" } }).sentence).toBe(
      "This image could not be read, so the initials remain.",
    );
    expect(describeThemeOutcome({ result: "unknown-app" }).saved).toBe(false);
  });
});
