import { useState, type ReactNode } from "react";
import { LATER_RELEASE, type AppSettingsVm } from "../../application/view-models/schema.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { TextField } from "../primitives/text-field.js";
import { AppFrame, type AppIdentity, type AppNavigation } from "../records/app-frame.js";
import styles from "./schema.module.css";

/**
 * SCR-037 — app settings (app-settings.html), truthful per feature.
 *
 * Every route the mock names is here. The ones this release serves are
 * links — structure, sheet snapshots, change history — and the app's name is
 * changed like any other structure change, with a preview first. The ones a
 * later release brings (re-upload, export, remove) are named and disabled
 * with the reason, the SHT-016 precedent GATE-F03 approved (D62). "Theme &
 * logo" is absent until its route exists: a row that leads nowhere is not a
 * row. Durability states only the facts this device holds, and offers no
 * backup, because in this release there is nowhere for one to go.
 */

export interface AppSettingsScreenProps {
  readonly vm: AppSettingsVm;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  readonly structureHref: string;
  readonly onRename: (name: string) => void;
  readonly announcement?: string;
  readonly topBarActions?: ReactNode;
  readonly overlays?: ReactNode;
}

function LaterRow({ title, hint }: { readonly title: string; readonly hint: string }): ReactNode {
  return (
    <li className={cx(styles["settingsRow"])} data-later={title}>
      <span className={cx(styles["rowCopy"])}>
        <strong>{title}</strong>
        <span className={cx(styles["hint"])}>{hint}</span>
      </span>
      <Button disabledReason={LATER_RELEASE} isDisabled>
        {title}
      </Button>
    </li>
  );
}

export function AppSettingsScreen({
  vm,
  app,
  nav,
  structureHref,
  onRename,
  announcement,
  topBarActions,
  overlays,
}: AppSettingsScreenProps): ReactNode {
  const [name, setName] = useState(vm.appName);
  const trimmed = name.normalize("NFC").trim();
  return (
    <AppFrame
      app={app}
      area="settings"
      nav={nav}
      title="App settings"
      {...(announcement === undefined ? {} : { announcement })}
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["page"])} data-screen="SCR-037">
        <section aria-labelledby="settings-title" className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>{vm.appName}</span>
          <h1 className={cx(styles["title"])} id="settings-title">
            App settings
          </h1>
          <p className={cx(styles["lede"])}>Every structural, visual, durable, export, and destructive route is named here.</p>
        </section>

        <div className={cx(styles["settingsGrid"])}>
          <section aria-labelledby="settings-identity" className={cx(styles["panel"])} data-section="identity">
            <span className={cx(styles["eyebrow"])} id="settings-identity">
              Identity
            </span>
            <TextField label="App name" onChange={setName} value={name} />
            {trimmed === "" || trimmed === vm.appName ? (
              <Button disabledReason={trimmed === "" ? "A name cannot be empty." : "Type a new name first."} isDisabled>
                Save name
              </Button>
            ) : (
              <Button onPress={() => { onRename(trimmed); }}>Save name</Button>
            )}
          </section>

          <section aria-labelledby="settings-structure" className={cx(styles["panel"])} data-section="structure">
            <span className={cx(styles["eyebrow"])} id="settings-structure">
              Structure &amp; source
            </span>
            <ul className={cx(styles["rows"])}>
              <li className={cx(styles["settingsRow"])}>
                <span className={cx(styles["rowCopy"])}>
                  <InlineLink target={{ kind: "internal", href: structureHref }}>
                    <strong>Tables, fields &amp; rules</strong>
                  </InlineLink>
                  {vm.structureSummary !== null && <span className={cx(styles["hint"])}>{vm.structureSummary}</span>}
                </span>
              </li>
              <LaterRow hint="Compare explicitly; the source is not watched." title="Re-upload a newer workbook" />
              <li className={cx(styles["settingsRow"])}>
                <span className={cx(styles["rowCopy"])}>
                  <InlineLink target={{ kind: "internal", href: nav.appSnapshots }}>
                    <strong>Original sheet snapshots</strong>
                  </InlineLink>
                  {vm.snapshotsSummary !== null && <span className={cx(styles["hint"])}>{vm.snapshotsSummary}</span>}
                </span>
              </li>
            </ul>
          </section>

          <section aria-labelledby="settings-durability" className={cx(styles["card"])} data-section="durability">
            <span className={cx(styles["eyebrow"])} id="settings-durability">
              Durability
            </span>
            <StatusBanner title={vm.durabilityTitle} tone="warning">
              {vm.durabilityDetail === "" ? undefined : vm.durabilityDetail}
            </StatusBanner>
          </section>

          <section aria-labelledby="settings-ownership" className={cx(styles["card"])} data-section="ownership">
            <span className={cx(styles["eyebrow"])} id="settings-ownership">
              Ownership
            </span>
            <ul className={cx(styles["rows"])}>
              <LaterRow hint="Plaintext destination warning applies." title="Export data & charts" />
            </ul>
          </section>

          <section aria-labelledby="settings-safety" className={cx(styles["card"])} data-section="safety">
            <span className={cx(styles["eyebrow"])} id="settings-safety">
              Safety
            </span>
            <ul className={cx(styles["rows"])}>
              <LaterRow hint="Exact locations, changes, and survivors shown first." title="Remove or delete" />
            </ul>
          </section>
        </div>

        <section aria-labelledby="settings-history" className={cx(styles["card"])} data-section="history">
          <div className={cx(styles["head"])}>
            <div className={cx(styles["headText"])}>
              <h2 className={cx(styles["sectionTitle"])} id="settings-history">
                Change history
              </h2>
              <p className={cx(styles["hint"])}>Every change made to this app on this device.</p>
            </div>
            <InlineLink target={{ kind: "internal", href: nav.appHistory }}>Open history</InlineLink>
          </div>
        </section>
      </div>
      {overlays}
    </AppFrame>
  );
}
