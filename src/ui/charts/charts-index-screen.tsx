import type { ReactNode } from "react";
import type { ChartIndexRowVm, ChartsIndexVm } from "../../application/view-models/records.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { AppFrame, type AppIdentity, type AppNavigation } from "../records/app-frame.js";
import { formatCount } from "../records/values.js";
import { CHART_TYPE_NAMES } from "./chart-text.js";
import styles from "./charts.module.css";

/**
 * SCR-053 — the app's Charts destination (charts.html; DF-2, D63).
 *
 * Every chart the app holds, rebuilt from its workbook or made here, in one
 * list sorted by name: its name, its type and table, how it groups, where it
 * came from, and whether it is on app home. The pin is a toggle button whose
 * label never changes — "Pin to app home" — with its state in `aria-pressed`
 * and a mark, so a pin is never told by colour or by a changing word. Pinning
 * is a user change: it is saved on this device and counts toward backup.
 */

export interface ChartsIndexScreenProps {
  readonly vm: ChartsIndexVm;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  readonly newChartHref: string;
  readonly chartHref: (chartId: string) => string;
  readonly onTogglePin: (row: ChartIndexRowVm) => void;
  /** The chart whose pin is being written; its toggle waits. */
  readonly pinning?: string | null;
  readonly topBarActions?: ReactNode;
}

const GLYPH: Readonly<Record<ChartIndexRowVm["type"], string>> = {
  bar: "▥",
  line: "⌁",
  pie: "◔",
  scatter: "∷",
  stacked: "▤",
};

/** charts.html's second line: "Line · Jobs, grouped by Due date (month)". */
function describeRow(row: ChartIndexRowVm): string {
  const base = `${CHART_TYPE_NAMES[row.type]} · ${row.tableName}`;
  switch (row.grouping.kind) {
    case "related":
      return `${base}, grouped through ${row.grouping.parentName} → ${row.grouping.fieldName}`;
    case "date":
      return `${base}, grouped by ${row.grouping.fieldName} (${row.grouping.unit})`;
    case "field":
    case "points":
      return base;
    default: {
      const unreachable: never = row.grouping;
      return unreachable;
    }
  }
}

export function ChartsIndexScreen({
  vm,
  app,
  nav,
  newChartHref,
  chartHref,
  onTogglePin,
  pinning = null,
  topBarActions,
}: ChartsIndexScreenProps): ReactNode {
  const newChart = (
    <InlineLink target={{ kind: "internal", href: newChartHref }}>
      <span aria-hidden="true">＋</span> New chart
    </InlineLink>
  );
  return (
    <AppFrame
      announcement={vm.announcement}
      app={app}
      area="charts"
      nav={nav}
      title="Charts"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["page"])} data-screen="SCR-053">
        <section aria-labelledby="charts-title" className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>{`${app.displayName} · Charts`}</span>
          <h1 className={cx(styles["title"])} id="charts-title">
            Your charts
          </h1>
          <p className={cx(styles["lede"])}>
            Charts rebuilt from your workbook and charts you made here, in one list. Pin one to show it on app home.
          </p>
          <div className={cx(styles["actions"])}>{newChart}</div>
        </section>

        {vm.rows.length === 0 ? (
          <section aria-labelledby="empty-title" className={cx(styles["card"])} data-empty="no-charts">
            <span aria-hidden="true" className={cx(styles["leading"])}>
              ▥
            </span>
            <h2 className={cx(styles["sectionTitle"])} id="empty-title">
              No charts yet
            </h2>
            <p className={cx(styles["lede"])}>
              Your workbook had no pivot tables or chart sheets to rebuild. Choose a table, what to group by and what to measure. Sheaf
              draws the chart from data on this device.
            </p>
            <div className={cx(styles["actions"])}>{newChart}</div>
          </section>
        ) : (
          <section aria-labelledby="all-charts-title" className={cx(styles["pinned"])}>
            <div className={cx(styles["pinnedHead"])}>
              <div>
                <h2 className={cx(styles["sectionTitle"])} id="all-charts-title">
                  All charts
                </h2>
                <p className={cx(styles["lede"])}>
                  {`${vm.rows.length === 1 ? "1 chart" : `${formatCount(vm.rows.length)} charts`} · ${formatCount(vm.pinnedCount)} pinned to app home`}
                </p>
              </div>
              <span className={cx(styles["lede"])}>Sorted by name</span>
            </div>
            <ul className={cx(styles["chartList"])}>
              {vm.rows.map((row) => (
                <li className={cx(styles["chartRow"])} data-chart-row={row.chartId} key={row.chartId}>
                  <span aria-hidden="true" className={cx(styles["leading"])}>
                    {GLYPH[row.type]}
                  </span>
                  <div className={cx(styles["chartOpen"])}>
                    <InlineLink target={{ kind: "internal", href: chartHref(row.chartId) }}>
                      <strong>{row.name}</strong>
                    </InlineLink>
                    <span className={cx(styles["hint"])}>{describeRow(row)}</span>
                    <span className={cx(styles["actions"])}>
                      <span className={cx(styles["neutralBadge"])}>{row.provenance === "imported" ? "From workbook" : "Made here"}</span>
                      {row.pinned && <span className={cx(styles["goodBadge"])}>On app home</span>}
                    </span>
                  </div>
                  <button
                    aria-label={`Pin to app home: ${row.name}`}
                    aria-pressed={row.pinned}
                    className={cx(styles["pinToggle"])}
                    disabled={pinning === row.chartId}
                    onClick={() => {
                      onTogglePin(row);
                    }}
                    type="button"
                  >
                    <span aria-hidden="true" className={cx(styles["pinMark"])}>
                      {row.pinned ? "✓" : ""}
                    </span>
                    Pin to app home
                  </button>
                </li>
              ))}
            </ul>
            <p className={cx(styles["lede"])}>
              Pinning or unpinning changes what app home shows. It is saved on this device and counts toward the changes waiting for backup.
            </p>
          </section>
        )}
      </div>
    </AppFrame>
  );
}
