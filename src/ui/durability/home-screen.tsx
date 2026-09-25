import type { ReactNode } from "react";
import type { AppDurabilityVm } from "../../application/view-models/durability.js";
import { selectBackupStatus } from "../../application/view-models/durability.js";
import { AppFrame, type AppIdentity, type AppNavigation } from "../records/app-frame.js";
import { Button } from "../primitives/button.js";
import { InlineLink } from "../primitives/inline-link.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { formatInstant } from "../records/values.js";
import styles from "./durability.module.css";

export function HomeScreen({ app, nav, facts, onCreate, onSave, onReveal, topBarActions, children }: {
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  readonly facts: AppDurabilityVm;
  readonly onCreate: () => void;
  readonly onSave: () => void;
  readonly onReveal: () => void;
  readonly topBarActions: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const status = selectBackupStatus(facts);
  return <AppFrame app={app} nav={nav} area="home" title="Durable home" topBarActions={topBarActions}>
    <div className={styles["stack"]} data-screen={facts.homeId === null ? "SCR-038" : "SCR-039"}>
      <p className={styles["eyebrow"]}>{app.displayName} · Durability</p>
      <h1 className={styles["title"]}>{facts.homeId === null ? "Give this app a durable home." : "Backup detail"}</h1>
      <p>The local copy keeps working. A durable home makes an encrypted copy recoverable on your terms.</p>
      <InlineLink target={{ kind: "internal", href: nav.appHome }}>Back to app</InlineLink>
      <StatusBanner tone={status.tone} title={status.title}>
        <dl className={styles["facts"]}><div><dt>Last confirmed backup</dt><dd data-backup-time={facts.confirmedAtMs ?? "never"}>{facts.confirmedAtMs === null ? "Never confirmed" : formatInstant(facts.confirmedAtMs)}</dd></div>
          <div><dt>Changes only on this device</dt><dd data-pending-count={facts.deviceOnlyChangeCount}>{facts.deviceOnlyChangeCount}</dd></div></dl>
      </StatusBanner>
      <div className={styles["split"]}>
        <section className={styles["card"]}><h2>{facts.homeName ?? "Your storage, not ours"}</h2><h3>Encrypted bundle file</h3>
          <p>Save wherever you like. It cannot be found automatically and becomes stale after the next change.</p>
          <p>Open by hand · Manual refresh</p>
          <Button tone="primary" onPress={facts.homeId === null ? onCreate : onSave}>{facts.homeId === null ? "Save a bundle" : "Save a fresh bundle"}</Button>
        </section>
        <aside className={styles["stack"]}>
          <section className={styles["card"]}><h2>Exactly what is sent</h2><p>Encrypted app data. No readable records, table names, or column names. Nothing to Sheaf.</p></section>
          <section className={styles["card"]}><h2>Two codes, two jobs</h2><p>The local recovery code opens this device’s store only. A vault recovery code opens only this home’s vault on any device.</p>
            {facts.homeId !== null && <Button onPress={onReveal}>Re-view vault recovery code</Button>}
          </section>
        </aside>
      </div>
      {children}
    </div>
  </AppFrame>;
}
