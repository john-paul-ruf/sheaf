import { useState, type ReactNode } from "react";
import type { ChartDetailVm, ChartMarkVm } from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { AppFrame, type AppIdentity, type AppNavigation } from "../records/app-frame.js";
import { AccessibilityViewSheet } from "./accessibility-view-sheet.js";
import { ChartFigure, ChartScope } from "./chart-figure.js";
import { MarkDetailSheet } from "./mark-detail-sheet.js";
import styles from "./charts.module.css";

/**
 * SCR-033 — chart detail (chart-detail.html; CAP-32, FR-16).
 *
 * Touch selection, a filtered records list, the summary/table alternative and
 * the partial state, in that order of the mock: the chart names its scope
 * (every local row, or the newest sample — STA-015); a mark chosen on the
 * canvas *or* in the mark list opens SHT-012, whose apply opens the records
 * list filtered to exactly that mark's rows; **Accessibility view** opens
 * SHT-017. Nothing here computes an aggregate: the dataset is the worker's
 * (M45 must-not).
 */

export interface ChartDetailScreenProps {
  readonly vm: ChartDetailVm;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  /** The chart's table, unfiltered: STA-015's "Open full data". */
  readonly fullDataHref: string;
  /** Opens the records list with the mark's filter in navigation state (D63). */
  readonly onApplyMark: (mark: Extract<ChartMarkVm, { kind: "group" }>) => void;
  /** SHT-017's next page; absent when there is none to read. */
  readonly onShowMoreRows?: () => void;
  readonly rowsBusy?: boolean;
  /** SCR-034 on this chart. */
  readonly editHref?: string;
  /** A confirmed write's sentence ("Saved on this device."), announced once. */
  readonly announcement?: string;
  readonly topBarActions?: ReactNode;
}

const MARK_NOUN: Readonly<Record<ChartDetailVm["type"], string | null>> = {
  bar: "bar",
  stacked: "bar",
  line: "point",
  pie: "slice",
  scatter: null,
};

export function ChartDetailScreen({
  vm,
  app,
  nav,
  fullDataHref,
  onApplyMark,
  onShowMoreRows,
  rowsBusy = false,
  editHref,
  announcement,
  topBarActions,
}: ChartDetailScreenProps): ReactNode {
  const [selected, setSelected] = useState<number | null>(null);
  const [isTableOpen, setIsTableOpen] = useState(false);
  const mark = selected === null ? undefined : vm.marks[selected];
  const noun = MARK_NOUN[vm.type];

  return (
    <AppFrame
      app={app}
      area="charts"
      nav={nav}
      title="Chart detail"
      {...(announcement === undefined ? {} : { announcement })}
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["page"])} data-chart={vm.chartId ?? "draft"} data-screen="SCR-033">
        <section aria-labelledby="chart-title" className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>{`Charts · ${vm.tableName}`}</span>
          <h1 className={cx(styles["title"])} id="chart-title">
            {vm.name}
          </h1>
          <p className={cx(styles["lede"])}>
            {noun === null
              ? "Each point is one record. Colour never carries meaning by itself."
              : `Select a ${noun} to filter the related record list. Colour never carries meaning by itself.`}
          </p>
          {editHref !== undefined && (
            <div className={cx(styles["actions"])}>
              <InlineLink target={{ kind: "internal", href: editHref }}>Edit chart</InlineLink>
            </div>
          )}
        </section>

        <section aria-label="Chart" className={cx(styles["panel"])}>
          <div className={cx(styles["panelHead"])}>
            <ChartScope fullDataHref={fullDataHref} vm={vm} />
            <Button
              onPress={() => {
                setIsTableOpen(true);
              }}
            >
              Accessibility view
            </Button>
          </div>
          <ChartFigure
            onSelectMark={(chosen) => {
              setSelected(chosen.index);
            }}
            selectedMark={selected}
            vm={vm}
            markLabel={(chosen, text) => (chosen.index === selected ? `${text}, selected` : text)}
          />
        </section>
      </div>

      {mark?.kind === "group" && (
        <MarkDetailSheet
          mark={mark}
          onApply={onApplyMark}
          onClear={() => {
            setSelected(null);
          }}
          vm={vm}
        />
      )}
      {isTableOpen && (
        <AccessibilityViewSheet
          busy={rowsBusy}
          onClose={() => {
            setIsTableOpen(false);
          }}
          vm={vm}
          {...(onShowMoreRows === undefined ? {} : { onShowMore: onShowMoreRows })}
        />
      )}
    </AppFrame>
  );
}
