/**
 * The theme RPCs of an open app (M33; CAP-37, CA-32, D56).
 *
 * Thin like the chart and structure handlers beside them. The worker owns the
 * two things the application layer may not reach itself:
 *
 * - **The palettes.** The caller names a built-in palette key and its choices;
 *   the tokens are composed here from M23's DF-1 constants, never taken from
 *   the page, so a stored theme can only ever hold approved values.
 * - **The tile cache.** After the commit lands, the catalog's tile identity is
 *   refreshed the way `noteAppOpened` refreshes its time: an operational
 *   write beside the authored one, so the library shows the new identity
 *   without opening the app.
 *
 * The logo crosses as base64 text (no byte type may cross the wire) and is
 * turned back into bytes here; M34 judges it by its header only.
 */

import {
  changeTheme,
  type ThemeCommandResultV1,
  type ThemeRefusalV1,
} from "../../application/commands/theme-commands.js";
import type { ClockPort } from "../../application/ports/clock.js";
import type { EntropyPort } from "../../application/ports/entropy.js";
import type { AppThemeLogoV1, AppThemeV1 } from "../../domain/model/events.js";
import { BUILT_IN_PALETTES, builtInPalette } from "../../import/staging/theme.js";
import type {
  AppLogoWireV1,
  AppThemeWireV1,
  ChangeThemeRequestV1,
  DataWorkerResponseV1,
  LibraryThemeTileV1,
  ThemeOutcomeWireV1,
  ThemeRefusalWireV1,
} from "../protocol/messages.js";
import type { AppSessionV1 } from "./app-session.js";
import type { AppThemeTileV1, LocalCatalogV1 } from "./catalog.js";
import type { WorkerSessionContextV1 } from "./event-store.js";

export interface ThemeHandlerDependenciesV1 {
  readonly clock: ClockPort;
  readonly entropy: EntropyPort;
  readonly appSession: (appId: string) => Promise<AppSessionV1 | undefined>;
  /** Drops a session whose projection a failed commit disposed. */
  readonly closeAppSession: (appId: string) => void;
  readonly getContext: () => WorkerSessionContextV1;
  /** Reseals the catalog for an operational write (the tile cache). */
  readonly commitCatalog: (next: LocalCatalogV1) => Promise<void>;
}

export interface ThemeHandlersV1 {
  listThemePalettes(): DataWorkerResponseV1;
  changeTheme(request: ChangeThemeRequestV1): Promise<DataWorkerResponseV1>;
}

// ------------------------------------------------------------------ base64 --

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Null for text that is not base64: a logo that cannot be read is refused. */
function fromBase64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- views --

const logoWire = (logo: { readonly bytes: Uint8Array; readonly width: number; readonly height: number }): AppLogoWireV1 => ({
  pngBase64: toBase64(logo.bytes),
  width: logo.width,
  height: logo.height,
});

/** A stored theme as the page may hold it, with its palette's dark set. */
export function toThemeWire(theme: AppThemeV1): AppThemeWireV1 {
  const dark = builtInPalette(theme.themeKey)?.dark;
  return {
    themeKey: theme.themeKey,
    tokens: theme.tokens,
    ...(theme.mode === undefined ? {} : { mode: theme.mode }),
    ...(theme.density === undefined ? {} : { density: theme.density }),
    ...(theme.customAccent === undefined ? {} : { customAccent: theme.customAccent }),
    ...(dark === undefined ? {} : { darkTokens: dark }),
    ...(theme.logo === undefined ? {} : { logo: logoWire(theme.logo) }),
  };
}

/** The tile a theme gives its app: the light primary, its label colour, the logo. */
export function themeTileOf(theme: AppThemeV1): AppThemeTileV1 {
  return {
    primary: theme.tokens["app-primary"],
    label: theme.tokens["app-surface"],
    logo: theme.logo === undefined ? null : { bytes: theme.logo.bytes, width: theme.logo.width, height: theme.logo.height },
  };
}

export function toThemeTileWire(tile: AppThemeTileV1): LibraryThemeTileV1 {
  return { primary: tile.primary, label: tile.label, logo: tile.logo === null ? null : logoWire(tile.logo) };
}

function toRefusalWire(refusal: ThemeRefusalV1): ThemeRefusalWireV1 {
  switch (refusal.kind) {
    case "unknown-palette":
    case "invalid-accent":
      return { kind: refusal.kind };
    case "logo":
      return { kind: "logo", reason: refusal.reason };
    case "contrast":
      return {
        kind: "contrast",
        failures: refusal.failures.map(({ mode, pair, ratio, minimum }) => ({ mode, pair, ratio, minimum })),
      };
    default: {
      const unreachable: never = refusal;
      return unreachable;
    }
  }
}

function toOutcomeWire(result: ThemeCommandResultV1): ThemeOutcomeWireV1 {
  switch (result.outcome) {
    case "changed":
    case "unchanged":
      return { result: result.outcome, theme: toThemeWire(result.theme) };
    case "refused":
      return { result: "refused", refusal: toRefusalWire(result.refusal) };
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

// ---------------------------------------------------------------- handlers --

export function createThemeHandlers(deps: ThemeHandlerDependenciesV1): ThemeHandlersV1 {
  /** The logo the request asks for, or null when its text is not base64. */
  function logoOf(request: ChangeThemeRequestV1, current: AppThemeV1): AppThemeLogoV1 | undefined | null {
    switch (request.logo.kind) {
      case "keep":
        return current.logo;
      case "remove":
        return undefined;
      case "set": {
        const bytes = fromBase64(request.logo.pngBase64);
        return bytes === null
          ? null
          : { mediaType: "image/png", bytes, width: request.logo.width, height: request.logo.height };
      }
      default: {
        const unreachable: never = request.logo;
        return unreachable;
      }
    }
  }

  async function refreshTile(appId: string, theme: AppThemeV1): Promise<void> {
    const { catalog } = deps.getContext();
    if (!catalog.apps.some((app) => app.appId === appId)) return;
    const themeTile = themeTileOf(theme);
    await deps.commitCatalog({
      ...catalog,
      catalogRevision: catalog.catalogRevision + 1,
      apps: catalog.apps.map((app) => (app.appId === appId ? { ...app, themeTile } : app)),
    });
  }

  return {
    listThemePalettes() {
      return {
        kind: "listThemePalettes",
        palettes: BUILT_IN_PALETTES.map(({ key, name, light, dark }) => ({ key, name, light, dark })),
      };
    },

    async changeTheme(request) {
      const palette = builtInPalette(request.themeKey);
      if (palette === undefined) {
        return { kind: "changeTheme", outcome: { result: "refused", refusal: { kind: "unknown-palette" } } };
      }
      const session = await deps.appSession(request.appId);
      if (session === undefined) return { kind: "changeTheme", outcome: { result: "unknown-app" } };

      const current = session.projection.execute({ kind: "app-state" }).theme;
      const logo = logoOf(request, current);
      if (logo === null) {
        return { kind: "changeTheme", outcome: { result: "refused", refusal: { kind: "logo", reason: "unreadable" } } };
      }
      const theme: AppThemeV1 = {
        themeKey: palette.key,
        tokens: palette.light,
        mode: request.mode,
        density: request.density,
        ...(request.customAccent === null ? {} : { customAccent: request.customAccent.toLowerCase() }),
        ...(logo === undefined ? {} : { logo }),
      };

      let result: ThemeCommandResultV1;
      try {
        result = await changeTheme(
          {
            clock: deps.clock,
            entropy: deps.entropy,
            projection: session.projection,
            repository: session.repository,
          },
          { theme, darkTokens: palette.dark },
        );
      } catch (cause) {
        deps.closeAppSession(request.appId);
        throw cause;
      }
      if (result.outcome === "changed") {
        await refreshTile(request.appId, result.theme);
      }
      return { kind: "changeTheme", outcome: toOutcomeWire(result) };
    },
  };
}
