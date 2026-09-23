/**
 * The theme route (M54; CA-07 amendment 4, D63; CAP-37, CA-32).
 *
 * SCR-036 at `#/app/{id}/theme`. The editor holds a draft over the open
 * session's theme; the palettes are the worker's constants; a chosen logo is
 * re-encoded on the page (M36) before it joins the draft. "Save theme
 * locally" sends the draft, and only the worker's answer — after the encrypted
 * commit — is announced (invariant 1). A saved theme re-opens the app so the
 * frame, the settings summary and the library tile read it back from the
 * worker rather than from the draft.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  describeLogoRefusal,
  describeThemeOutcome,
  draftFromTheme,
  selectThemeEditorVm,
  type ThemeDraft,
} from "../application/view-models/theme.js";
import type { ThemeServices } from "../application/workflows/theme-services.js";
import type { AppSessionViewV1, ThemePaletteWireV1 } from "../workers/protocol/messages.js";
import { BusyIndicator } from "../ui/primitives/busy-indicator.js";
import { describeRecordCount, monogramFor } from "../ui/records/values.js";
import { ThemeScreen } from "../ui/schema/theme-screen.js";
import type { AppAreaWiring } from "./app-area-hooks.js";
import { appSettingsPath, hashHref } from "./guards.js";

/** The built-in palettes, read once per visit; `null` until they arrive, or if they cannot. */
export function usePalettes(theme: ThemeServices): readonly ThemePaletteWireV1[] | null {
  const [palettes, setPalettes] = useState<readonly ThemePaletteWireV1[] | null>(null);
  useEffect(() => {
    let live = true;
    void theme.listThemePalettes().then(
      (answered) => {
        if (live) setPalettes(answered.palettes);
      },
      () => {
        if (live) setPalettes(null);
      },
    );
    return () => {
      live = false;
    };
  }, [theme]);
  return palettes;
}

/** The initials a logo replaces: the app's library glyph (D29), or its own name's. */
export function glyphOf(session: AppSessionViewV1): string {
  return session.glyph ?? monogramFor(session.displayName);
}

export function ThemeRoute({ area }: { readonly area: AppAreaWiring }): ReactNode {
  const { identity, nav, session, theme, topBarActions } = area;
  const appId = identity.appId;
  const navigate = useNavigate();
  const palettes = usePalettes(theme);
  const [draft, setDraft] = useState<ThemeDraft>(() => draftFromTheme(session.theme));
  const [isSaving, setIsSaving] = useState(false);
  const [logoRefusal, setLogoRefusal] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (palettes === null) {
    return <BusyIndicator cancellation="unavailable" label="Reading the built-in palettes on this device." />;
  }

  const vm = selectThemeEditorVm({ appName: session.displayName, stored: session.theme, palettes, draft });
  const change = (next: Partial<ThemeDraft>): void => {
    setFailure(null);
    setDraft((current) => ({ ...current, ...next }));
  };
  const first = session.tables[0];
  const settingsHref = hashHref(appSettingsPath(appId));

  return (
    <ThemeScreen
      app={identity}
      failure={failure}
      glyph={glyphOf(session)}
      isSaving={isSaving}
      logoRefusal={logoRefusal}
      nav={nav}
      onChooseLogo={(file) => {
        setLogoRefusal(null);
        void theme.prepareLogo(file).then((prepared) => {
          if (prepared.kind === "ready") {
            change({ logo: { kind: "set", ...prepared.logo } });
          } else {
            setLogoRefusal(describeLogoRefusal(prepared.reason));
          }
        });
      }}
      onChoosePalette={(themeKey) => {
        change({ themeKey });
      }}
      onCustomAccent={(customAccent) => {
        change({ customAccent });
      }}
      onDensity={(density) => {
        change({ density });
      }}
      onMode={(mode) => {
        change({ mode });
      }}
      onRemoveLogo={() => {
        setLogoRefusal(null);
        change({ logo: { kind: "remove" } });
      }}
      onSave={() => {
        setIsSaving(true);
        setFailure(null);
        void theme
          .changeTheme({
            appId,
            themeKey: draft.themeKey,
            mode: draft.mode,
            density: draft.density,
            customAccent: draft.customAccent,
            logo: draft.logo,
          })
          .then(
            ({ outcome }) => {
              const said = describeThemeOutcome(outcome);
              setIsSaving(false);
              if (!said.saved) {
                setFailure(said.sentence);
                return;
              }
              if (said.sentence !== null) area.announce(said.sentence);
              area.refresh();
              void navigate(appSettingsPath(appId));
            },
            () => {
              setIsSaving(false);
              setFailure("This theme could not be saved on this device, so nothing was changed.");
            },
          );
      }}
      previewTable={first === undefined ? null : { name: first.displayName, count: describeRecordCount(first.recordCount) }}
      settingsHref={settingsHref}
      topBarActions={topBarActions}
      vm={vm}
    />
  );
}
