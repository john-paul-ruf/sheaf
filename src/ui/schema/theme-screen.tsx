import { useId, type ChangeEvent, type ReactNode } from "react";
import type { ThemeEditorVm } from "../../application/view-models/theme.js";
import type { AppThemeDensityV1, AppThemeModeV1 } from "../../domain/model/events.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { StatusBanner } from "../primitives/status-banner.js";
import visuallyHidden from "../primitives/visually-hidden.module.css";
import { AppFrame, type AppIdentity, type AppNavigation } from "../records/app-frame.js";
import { appThemeVariables, logoSource, useAppRenderMode } from "../theme/app-theme.js";
import schema from "./schema.module.css";
import styles from "./theme.module.css";

/**
 * SCR-036 — the theme editor (theme.html; CAP-37, CA-32, D56).
 *
 * Palette swatches carry their names (colour is never the only carrier); the
 * custom accent, mode and density change the draft; the contrast verdict and
 * the preview follow every change, drawn with the same M40 mapping the app
 * frame uses. "Save theme locally" is off with its reason while the draft
 * fails contrast, has no palette, or is the theme already saved, and a save is
 * acknowledged only by the route, after the worker's commit (invariant 1).
 */

/** theme.html's mode and density choices, in its words. */
const MODES: readonly (readonly [AppThemeModeV1, string])[] = [
  ["light", "Light"],
  ["dark", "Dark"],
  ["system", "Follow device"],
];
const DENSITIES: readonly (readonly [AppThemeDensityV1, string])[] = [
  ["comfortable", "Comfortable"],
  ["compact", "Compact"],
];

/** theme.html's file control. */
const LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

export interface ThemeScreenProps {
  readonly vm: ThemeEditorVm;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  /** The initials the logo replaces (the app's library glyph). */
  readonly glyph: string;
  /** The first table and its count, for a preview drawn from the app's own facts. */
  readonly previewTable: { readonly name: string; readonly count: string } | null;
  /** SCR-037, where the close control goes. */
  readonly settingsHref: string;
  readonly isSaving: boolean;
  /** Why the last chosen file was not taken; the initials remain. */
  readonly logoRefusal: string | null;
  /** Why the last save did not happen. */
  readonly failure: string | null;
  readonly onChoosePalette: (key: string) => void;
  /** A colour to draw the accent with, or `null` for the palette's own. */
  readonly onCustomAccent: (accent: string | null) => void;
  readonly onMode: (mode: AppThemeModeV1) => void;
  readonly onDensity: (density: AppThemeDensityV1) => void;
  readonly onChooseLogo: (file: File) => void;
  readonly onRemoveLogo: () => void;
  readonly onSave: () => void;
  readonly announcement?: string;
  readonly topBarActions?: ReactNode;
}

function Segmented<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  readonly legend: string;
  readonly name: string;
  readonly options: readonly (readonly [T, string])[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}): ReactNode {
  return (
    <fieldset className={cx(styles["fieldset"])}>
      <legend className={cx(styles["legend"])}>{legend}</legend>
      <div className={cx(styles["segmented"])}>
        {options.map(([option, label]) => (
          <label className={cx(styles["segment"])} key={option}>
            <input
              checked={value === option}
              className={cx(visuallyHidden["root"])}
              name={name}
              onChange={() => {
                onChange(option);
              }}
              type="radio"
              value={option}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** theme.html's phone preview, drawn in the draft theme. */
function ThemePreview({
  vm,
  appName,
  glyph,
  table,
}: {
  readonly vm: ThemeEditorVm;
  readonly appName: string;
  readonly glyph: string;
  readonly table: ThemeScreenProps["previewTable"];
}): ReactNode {
  const mode = useAppRenderMode(vm.preview);
  return (
    <aside aria-label="Preview" className={cx(styles["phone"])}>
      <div
        className={cx(styles["phoneScreen"])}
        data-app-density={vm.density}
        data-app-mode={mode}
        data-theme-preview=""
        style={appThemeVariables(vm.preview, mode)}
      >
        <div className={cx(styles["phoneHead"])}>
          {vm.logo === null ? (
            <span aria-hidden="true" className={cx(styles["mark"])}>
              {glyph}
            </span>
          ) : (
            <img
              alt=""
              className={cx(styles["mark"], styles["logo"])}
              height={vm.logo.height}
              src={logoSource(vm.logo)}
              width={vm.logo.width}
            />
          )}
          <strong>{appName}</strong>
        </div>
        <div className={cx(styles["phoneBody"])}>
          <span className={cx(styles["previewBadge"])}>Preview</span>
          {table !== null && (
            <div className={cx(styles["metric"])}>
              <span className={cx(styles["metricLabel"])}>{table.name}</span>
              <strong className={cx(styles["metricValue"])}>{table.count}</strong>
            </div>
          )}
          <span className={cx(styles["primary"])}>Add a record</span>
          <span aria-hidden="true" className={cx(styles["accentBar"])} />
        </div>
      </div>
    </aside>
  );
}

export function ThemeScreen({
  vm,
  app,
  nav,
  glyph,
  previewTable,
  settingsHref,
  isSaving,
  logoRefusal,
  failure,
  onChoosePalette,
  onCustomAccent,
  onMode,
  onDensity,
  onChooseLogo,
  onRemoveLogo,
  onSave,
  announcement,
  topBarActions,
}: ThemeScreenProps): ReactNode {
  const accentId = useId();
  const logoId = useId();
  const logoHelpId = useId();

  return (
    <AppFrame
      app={app}
      area="settings"
      nav={nav}
      title="Theme editor"
      topBarActions={
        <>
          <a aria-label="Close" className={cx(styles["close"])} href={settingsHref}>
            ×
          </a>
          {topBarActions}
        </>
      }
      {...(announcement === undefined ? {} : { announcement })}
    >
      <div className={cx(schema["page"])} data-screen={vm.screen}>
        <section aria-labelledby="theme-title" className={cx(schema["intro"])}>
          <span className={cx(schema["eyebrow"])}>App identity</span>
          <h1 className={cx(schema["title"])} id="theme-title">
            {vm.title}
          </h1>
          <p className={cx(schema["lede"])}>
            Brand the generated app without weakening status, focus, validation, or destructive-action semantics.
          </p>
        </section>

        <div className={cx(styles["split"])}>
          <form
            className={cx(schema["panel"])}
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <fieldset className={cx(styles["fieldset"])}>
              <legend className={cx(styles["legend"])}>Palette</legend>
              <div className={cx(styles["swatches"])}>
                {vm.palettes.map((palette) => (
                  <label
                    className={cx(styles["swatch"])}
                    data-selected={palette.isSelected ? "true" : undefined}
                    key={palette.key}
                    style={{ background: palette.swatch, color: palette.swatchLabel }}
                  >
                    <input
                      checked={palette.isSelected}
                      className={cx(visuallyHidden["root"])}
                      name="palette"
                      onChange={() => {
                        onChoosePalette(palette.key);
                      }}
                      type="radio"
                      value={palette.key}
                    />
                    <span>{palette.isSelected ? `✓ ${palette.name}` : palette.name}</span>
                  </label>
                ))}
                <button
                  aria-pressed={vm.isCustomAccent}
                  className={cx(styles["swatch"], styles["customSwatch"])}
                  onClick={() => {
                    onCustomAccent(vm.isCustomAccent ? null : vm.accent);
                  }}
                  type="button"
                >
                  <span>{vm.isCustomAccent ? "✓ Custom" : "Custom"}</span>
                </button>
              </div>
            </fieldset>

            <div className={cx(styles["field"])}>
              <label className={cx(styles["legend"])} htmlFor={accentId}>
                Custom accent
              </label>
              <input
                className={cx(styles["colour"])}
                id={accentId}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  onCustomAccent(event.target.value.toLowerCase());
                }}
                type="color"
                value={vm.accent}
              />
            </div>

            <Segmented legend="Mode" name="mode" onChange={onMode} options={MODES} value={vm.mode} />
            <Segmented legend="Density" name="density" onChange={onDensity} options={DENSITIES} value={vm.density} />

            <div className={cx(styles["field"])}>
              <label className={cx(styles["legend"])} htmlFor={logoId}>
                App logo
              </label>
              <input
                accept={LOGO_ACCEPT}
                aria-describedby={logoHelpId}
                className={cx(styles["file"])}
                id={logoId}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) onChooseLogo(file);
                  event.target.value = "";
                }}
                type="file"
              />
              <span className={cx(schema["hint"])} id={logoHelpId}>
                If absent or unreadable, initials remain.
              </span>
              {logoRefusal !== null && <StatusBanner title={logoRefusal} tone="warning" />}
              {vm.logo !== null && (
                <div className={cx(styles["logoRow"])}>
                  <img
                    alt=""
                    className={cx(styles["mark"], styles["logo"])}
                    height={vm.logo.height}
                    src={logoSource(vm.logo)}
                    width={vm.logo.width}
                  />
                  <Button onPress={onRemoveLogo}>Remove logo</Button>
                </div>
              )}
            </div>

            <StatusBanner title={vm.verdict.title} tone={vm.verdict.passes ? "success" : "danger"}>
              {vm.verdict.detail}
            </StatusBanner>

            {failure !== null && <StatusBanner title={failure} tone="danger" />}

            {isSaving ? (
              <Button disabledReason="Saving on this device." isDisabled tone="primary">
                Save theme locally
              </Button>
            ) : vm.save.enabled ? (
              <Button onPress={onSave} tone="primary">
                Save theme locally
              </Button>
            ) : (
              <Button disabledReason={vm.save.reason} isDisabled tone="primary">
                Save theme locally
              </Button>
            )}
          </form>

          <ThemePreview appName={app.displayName} glyph={glyph} table={previewTable} vm={vm} />
        </div>
      </div>
    </AppFrame>
  );
}
