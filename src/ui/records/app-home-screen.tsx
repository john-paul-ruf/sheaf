import type { ReactNode } from "react";
import type {
  AppHomeVm,
  ChartDetailVm,
  ChartMarkVm,
  TableSwitcherVm,
} from "../../application/view-models/records.js";
import { ChartFigure, ChartScope } from "../charts/chart-figure.js";
import chartStyles from "../charts/charts.module.css";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { logoSource } from "../theme/app-theme.js";
import { AppBackupStatus, AppFrame, type AppNavigation } from "./app-frame.js";
import { TableSwitcherTrigger } from "./table-switcher-sheet.js";
import {
  describeRecordCount,
  describeValue,
  formatCount,
  formatInstant,
  isoInstant,
  monogramFor,
} from "./values.js";
import styles from "./records.module.css";

/**
 * SCR-024 — the generated app's home (app-home.html, CAP-15, FR-11 subset).
 *
 * **Only what the app holds is drawn.** "At a glance" (CAP-29, CA-26) shows
 * the metrics and dashboard values the app actually has, each with its live
 * value or, when there is none, the reason in words; an app with none draws
 * no section, and the mock's narrative line ("Four jobs need you today") is
 * sample data, never composed here. Each pinned chart is drawn from its own
 * worker dataset (CA-30): tapping a mark opens the records list filtered to
 * exactly that mark's rows (D63), and "View data table" opens the chart's
 * detail, where SHT-017 is. Until an app has metrics or a pinned chart, the
 * absence of computed surfaces is *stated* rather than left as a hole
 * (STA-025).
 *
 * The scratch status links to the durable-home chooser; an assigned home
 * links to the receipt and pending-change facts in Backup detail.
 *
 * Times are formatted here, from the reader's own locale: a view model holds
 * no clock (M37 must-not).
 */

export interface AppHomeScreenProps {
  readonly backupHref?: string;
  readonly vm: AppHomeVm;
  readonly nav: AppNavigation;
  /** Where a table's records list lives. */
  readonly tableHref: (tableId: string) => string;
  /** Where a new record for a table is authored. */
  readonly newRecordHref: (tableId: string) => string;
  /** CTL-059's state; present when the app has more than one table. */
  readonly tableSwitcher?: TableSwitcherVm;
  readonly onOpenTableSwitcher?: () => void;
  /** SHT-003 and anything else the route composed. */
  readonly overlays?: ReactNode;
  readonly topBarActions?: ReactNode;
  /** A pinned chart's detail (SCR-033), where its data table is. */
  readonly chartHref?: (chartId: string) => string;
  /** A pinned chart's builder (SCR-034), once its route exists. */
  readonly chartEditHref?: (chartId: string) => string;
  /** Opens the records list filtered to exactly a tapped mark's rows. */
  readonly onApplyMark?: (chart: ChartDetailVm, mark: Extract<ChartMarkVm, { kind: "group" }>) => void;
}

export function AppHomeScreen({
  backupHref,
  vm,
  nav,
  tableHref,
  newRecordHref,
  tableSwitcher,
  onOpenTableSwitcher,
  overlays,
  topBarActions,
  chartHref,
  chartEditHref,
  onApplyMark,
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
            {vm.theme.logo === undefined ? (
              <span aria-hidden="true" className={cx(styles["monogram"])}>
                {monogramFor(vm.displayName)}
              </span>
            ) : (
              <img
                alt={vm.displayName}
                className={cx(styles["monogram"])}
                data-app-logo=""
                height={vm.theme.logo.height}
                src={logoSource(vm.theme.logo)}
                style={{ objectFit: "contain" }}
                width={vm.theme.logo.width}
              />
            )}
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

        {vm.durability !== undefined && backupHref !== undefined && <AppBackupStatus facts={vm.durability} href={backupHref} />}
        {vm.isScratch && vm.durability === undefined && (
          <StatusBanner
            title="On this device only · not backed up"
            tone="warning"
          >
            {`${vm.displayName} has no durable home, so ${
              vm.deviceOnlyChangeCount === 1
                ? "1 change exists"
                : `${formatCount(vm.deviceOnlyChangeCount)} changes exist`
            } only here.`}{" "}
            {backupHref !== undefined && <InlineLink target={{ kind: "internal", href: backupHref }}>Choose a durable home</InlineLink>}
          </StatusBanner>
        )}

        {vm.isScratch && vm.durability !== undefined && backupHref !== undefined && <InlineLink target={{ kind: "internal", href: backupHref }}>Choose a durable home</InlineLink>}

        {!vm.isScratch && backupHref !== undefined && <InlineLink target={{ kind: "internal", href: backupHref }}>Backup detail</InlineLink>}

        {vm.metrics.length > 0 && (
          <section aria-labelledby="app-glance" data-section="glance">
            <div className={cx(styles["sectionHead"])}>
              <h2 className={cx(styles["sectionTitle"])} id="app-glance">
                At a glance
              </h2>
              <span className={cx(styles["note"])}>Live from local data</span>
            </div>
            <ul className={cx(styles["glance"])}>
              {vm.metrics.map((metric) => (
                <li className={cx(styles["metric"])} data-metric={metric.formulaId} data-status={metric.status} key={metric.formulaId}>
                  <span className={cx(styles["metricLabel"])}>
                    {metric.tableName === null ? metric.label : `${metric.label} · ${metric.tableName}`}
                  </span>
                  <span className={cx(styles["metricValue"])}>
                    {metric.value === null ? "—" : describeValue(metric.value, undefined)}
                  </span>
                  <span className={cx(styles["metricNote"])}>{metric.note}</span>
                  {metric.expression !== null && (
                    <span className={cx(styles["expression"])}>{metric.expression}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {vm.pinnedCharts.map((chart) => (
          <PinnedChart
            chart={chart}
            fullDataHref={tableHref(chart.tableId)}
            key={chart.chartId}
            {...(chartHref === undefined || chart.chartId === null ? {} : { href: chartHref(chart.chartId) })}
            {...(chartEditHref === undefined || chart.chartId === null ? {} : { editHref: chartEditHref(chart.chartId) })}
            {...(onApplyMark === undefined ? {} : { onApplyMark })}
          />
        ))}

        <section aria-labelledby="app-tables">
          <div className={cx(styles["sectionHead"])}>
            <h2 className={cx(styles["sectionTitle"])} id="app-tables">
              Open a table
            </h2>
            <div className={cx(styles["actions"])}>
              {tableSwitcher !== undefined && onOpenTableSwitcher !== undefined && (
                <TableSwitcherTrigger onOpen={onOpenTableSwitcher} vm={tableSwitcher} />
              )}
              <InlineLink target={{ kind: "internal", href: nav.appSnapshots }}>
                Sheet snapshots
              </InlineLink>
              <InlineLink target={{ kind: "internal", href: nav.appHistory }}>
                Change history
              </InlineLink>
              {/* app-home.html: "Working lists · Open a table … Edit structure" (SCR-035). */}
              {nav.structure !== undefined && (
                <InlineLink target={{ kind: "internal", href: nav.structure }}>Edit structure</InlineLink>
              )}
            </div>
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

        {vm.metrics.length === 0 && vm.pinnedCharts.length === 0 && (
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
        )}
      </div>
      {overlays}
    </AppFrame>
  );
}

/**
 * app-home.html's pinned chart: "Pinned chart", its name, "Tap a bar to
 * filter the list", its scope, and "View data table". Each mark filters the
 * list directly; the chart detail is one link away for the table and summary.
 */
function PinnedChart({
  chart,
  href,
  editHref,
  fullDataHref,
  onApplyMark,
}: {
  readonly chart: ChartDetailVm;
  readonly href?: string;
  readonly editHref?: string;
  readonly fullDataHref: string;
  readonly onApplyMark?: (chart: ChartDetailVm, mark: Extract<ChartMarkVm, { kind: "group" }>) => void;
}): ReactNode {
  const headingId = `pinned-${chart.chartId ?? "draft"}`;
  const noun = chart.type === "pie" ? "slice" : chart.type === "line" ? "point" : "bar";
  return (
    <section aria-labelledby={headingId} className={cx(chartStyles["pinned"])} data-pinned-chart={chart.chartId}>
      <div className={cx(chartStyles["pinnedHead"])}>
        <div>
          <span className={cx(styles["eyebrow"])}>Pinned chart</span>
          <h2 className={cx(styles["sectionTitle"])} id={headingId}>
            {chart.name}
          </h2>
        </div>
        {editHref !== undefined && <InlineLink target={{ kind: "internal", href: editHref }}>Edit chart</InlineLink>}
      </div>
      <div className={cx(chartStyles["panel"])}>
        <div className={cx(chartStyles["panelHead"])}>
          {chart.type !== "scatter" && <span className={cx(styles["note"])}>{`Tap a ${noun} to filter the list`}</span>}
          <ChartScope fullDataHref={fullDataHref} vm={chart} />
        </div>
        <ChartFigure
          markLabel={(mark, text) =>
            mark.kind === "group" && mark.filterIntent !== null ? `Filter by ${text}` : text
          }
          onSelectMark={(mark) => {
            if (mark.kind === "group" && mark.filterIntent !== null) onApplyMark?.(chart, mark);
          }}
          selectedMark={null}
          vm={chart}
        />
        {href !== undefined && (
          <div className={cx(chartStyles["actions"])}>
            <InlineLink target={{ kind: "internal", href }}>View data table</InlineLink>
          </div>
        )}
      </div>
    </section>
  );
}
