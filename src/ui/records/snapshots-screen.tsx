import type { ReactNode } from "react";
import type {
  SheetSnapshotRowVm,
  SnapshotsListVm,
} from "../../application/view-models/records.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { AppFrame, type AppIdentity, type AppNavigation } from "./app-frame.js";
import styles from "./records.module.css";

/**
 * SCR-030 — every imported sheet (snapshots.html; CAP-25, FR-5, FR-9).
 *
 * Each row is CTL-078: the sheet's use in the mock's own three words
 * ("Interactive table", "Read-only snapshot", "Mixed use"), what the source
 * declared about its size (or that it declared nothing — never "0 rows"), and
 * how many inert items were kept, with the way into the snapshot. A sheet the
 * app made tables from says "View original sheet"; one kept only as a
 * snapshot says "Open snapshot" — both open the same read-only viewer.
 *
 * The mock's "Choose region" for mixed sheets and its per-sheet merged-header
 * count are absent: the list read (`listSheetSnapshots`) carries neither a
 * region list nor a merge count, and a number the worker did not give is not
 * one this screen may print.
 */

export interface SnapshotsScreenProps {
  readonly vm: SnapshotsListVm;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  readonly snapshotHref: (sheetId: string) => string;
  readonly topBarActions?: ReactNode;
}

export function SnapshotsScreen({
  vm,
  app,
  nav,
  snapshotHref,
  topBarActions,
}: SnapshotsScreenProps): ReactNode {
  return (
    <AppFrame
      announcement={vm.announcement}
      app={app}
      area="snapshots"
      nav={nav}
      title="Sheet snapshots"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-030">
        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>Preserved source</span>
          <h1 className={cx(styles["title"])}>Sheet snapshots</h1>
          <p className={cx(styles["lede"])}>
            Every original sheet remains findable, even when its contents are not
            interactive app structure.
          </p>
        </div>

        {vm.emptiness === "no-sheets" ? (
          <section className={cx(styles["emptyState"])} data-empty="no-sheets">
            <h2 className={cx(styles["cardTitle"])}>No sheet snapshots.</h2>
            <p className={cx(styles["lede"])}>
              This app holds no preserved sheet to show.
            </p>
          </section>
        ) : (
          <ul className={cx(styles["tableList"])}>
            {vm.sheets.map((sheet) => (
              <SheetRow href={snapshotHref(sheet.sheetId)} key={sheet.sheetId} sheet={sheet} />
            ))}
          </ul>
        )}
      </div>
    </AppFrame>
  );
}

function SheetRow({
  sheet,
  href,
}: {
  readonly sheet: SheetSnapshotRowVm;
  readonly href: string;
}): ReactNode {
  return (
    <li className={cx(styles["card"])} data-sheet-row={sheet.sheetId} data-use={sheet.tag}>
      <span className={cx(styles["useTag"])} data-use={sheet.tag}>
        {sheet.tagLabel}
      </span>
      <h2 className={cx(styles["cardTitle"])}>{sheet.displayName}</h2>
      <p className={cx(styles["lede"])}>{sheet.sizeLine}</p>
      {sheet.inertLine !== null && (
        <div className={cx(styles["inertNote"])}>
          <span aria-hidden="true" className={cx(styles["inertGlyph"])}>
            ◇
          </span>
          <div>
            <p className={cx(styles["inertTitle"])}>Preserved, not interpreted</p>
            <p className={cx(styles["lede"])}>{sheet.inertLine}</p>
          </div>
        </div>
      )}
      <div className={cx(styles["actions"])}>
        <InlineLink target={{ kind: "internal", href }}>
          {sheet.tag === "read-only-snapshot"
            ? `Open snapshot of ${sheet.displayName}`
            : `View original ${sheet.displayName} sheet`}
        </InlineLink>
      </div>
    </li>
  );
}
