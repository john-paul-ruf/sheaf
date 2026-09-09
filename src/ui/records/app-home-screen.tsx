import type { ReactNode } from "react";
import type { AppHomeVm } from "../../application/view-models/records.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { AppFrame, type AppNavigation } from "./app-frame.js";
import {
  describeRecordCount,
  formatCount,
  formatInstant,
  isoInstant,
  monogramFor,
} from "./values.js";
import styles from "./records.module.css";

/**
 * SCR-024 — the generated app's home (app-home.html, CAP-15, FR-11 subset).
 *
 * **Only what F02 knows is drawn.** app-home.html's "This week's pulse"
 * metrics and its pinned chart are computed surfaces F04 builds; `AppHomeVm`
 * carries no field for either, so this screen cannot fill one with a fiction
 * (STA-025 truthful absence). Their absence is *stated* rather than left as a
 * hole, in the same words S07 used for the formats this release does not read.
 *
 * **The scratch fact is a status line, not a reminder.** D26 defers MOD-001/
 * MOD-002 and their durable-home chooser to F05, so the app says where it
 * lives and how many changes exist only here — and offers no "Back up now",
 * because in this release there is nowhere for that button to go.
 *
 * Times are formatted here, from the reader's own locale: a view model holds
 * no clock (M37 must-not).
 */

export interface AppHomeScreenProps {
  readonly vm: AppHomeVm;
  readonly nav: AppNavigation;
  /** Where a table's records list lives. */
  readonly tableHref: (tableId: string) => string;
  /** Where a new record for a table is authored. */
  readonly newRecordHref: (tableId: string) => string;
  readonly topBarActions?: ReactNode;
}

export function AppHomeScreen({
  vm,
  nav,
  tableHref,
  newRecordHref,
  topBarActions,
}: AppHomeScreenProps): ReactNode {
  // With exactly one table there is one truthful place for "add a record" to
  // go. With several, the choice belongs to the person, on the table itself.
  const onlyTable = vm.tables.length === 1 ? vm.tables[0] : undefined;

  return (
    <AppFrame
      announcement={vm.announcement}
      app={{
        appId: vm.appId,
        displayName: vm.displayName,
        theme: vm.theme,
      }}
      area="home"
      nav={nav}
      title="App home"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-024">
        <section className={cx(styles["hero"])}>
          <div className={cx(styles["heroIdentity"])}>
            <span aria-hidden="true" className={cx(styles["monogram"])}>
              {monogramFor(vm.displayName)}
            </span>
            <div>
              <span className={cx(styles["eyebrow"])}>Generated app</span>
              <h1 className={cx(styles["heroTitle"])}>{vm.displayName}</h1>
            </div>
          </div>

          <dl className={cx(styles["heroFacts"])}>
            <dt>Created</dt>
            <dd>
              <time dateTime={isoInstant(vm.createdAtEpochMs)}>
                {formatInstant(vm.createdAtEpochMs)}
              </time>
            </dd>
            <dt>Opened</dt>
            <dd>
              {vm.lastOpenedAtEpochMs === null ? (
                "Not opened before now"
              ) : (
                <time dateTime={isoInstant(vm.lastOpenedAtEpochMs)}>
                  {formatInstant(vm.lastOpenedAtEpochMs)}
                </time>
              )}
            </dd>
          </dl>

          {onlyTable !== undefined && (
            <div className={cx(styles["actions"])}>
              <InlineLink
                target={{
                  kind: "internal",
                  href: newRecordHref(onlyTable.tableId),
                }}
              >
                Add a record to {onlyTable.displayName}
              </InlineLink>
            </div>
          )}
        </section>

        {vm.isScratch && (
          <StatusBanner
            title="On this device only · not backed up"
            tone="warning"
          >
            {`${vm.displayName} has no durable home, so ${
              vm.deviceOnlyChangeCount === 1
                ? "1 change exists"
                : `${formatCount(vm.deviceOnlyChangeCount)} changes exist`
            } only here.`}{" "}
            Choosing a durable home and backing up arrive in a later release.
          </StatusBanner>
        )}

        <section aria-labelledby="app-tables">
          <div className={cx(styles["sectionHead"])}>
            <h2 className={cx(styles["sectionTitle"])} id="app-tables">
              Open a table
            </h2>
            <InlineLink target={{ kind: "internal", href: nav.appHistory }}>
              Change history
            </InlineLink>
          </div>

          <ul className={cx(styles["tableList"])}>
            {vm.tables.map((table) => (
              <li
                className={cx(styles["card"])}
                data-table={table.tableId}
                key={table.tableId}
              >
                <h3 className={cx(styles["cardTitle"])}>
                  <InlineLink
                    target={{
                      kind: "internal",
                      href: tableHref(table.tableId),
                    }}
                  >
                    {table.displayName}
                  </InlineLink>
                </h3>
                <dl className={cx(styles["facts"])}>
                  <dt>Records</dt>
                  <dd>{describeRecordCount(table.recordCount)}</dd>
                  <dt>Fields</dt>
                  <dd>
                    {table.fieldCount === 1
                      ? "1 field"
                      : `${formatCount(table.fieldCount)} fields`}
                  </dd>
                </dl>
                <div className={cx(styles["actions"])}>
                  <InlineLink
                    target={{
                      kind: "internal",
                      href: newRecordHref(table.tableId),
                    }}
                  >
                    Add a record
                  </InlineLink>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className={cx(styles["card"])}>
          <h2 className={cx(styles["cardTitle"])}>
            This app shows the data it holds.
          </h2>
          <p className={cx(styles["lede"])}>
            Charts, saved views and at-a-glance totals are computed surfaces.
            They arrive in a later release; nothing on this screen is estimated
            or filled in to stand for them.
          </p>
        </section>
      </div>
    </AppFrame>
  );
}
