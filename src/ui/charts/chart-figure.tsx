import { useMemo, type ReactNode } from "react";
import type { ChartDetailVm, ChartMarkVm } from "../../application/view-models/records.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { ChartCanvas } from "./chart-canvas.js";
import { canvasDataOf, describeChartGroup, describeMark, describeMarkValue, describeScope, describeSummary } from "./chart-text.js";
import styles from "./charts.module.css";

/**
 * One chart as every chart surface draws it (SCR-033, SCR-024's pinned chart,
 * SCR-034's preview): the canvas, the mark list a keyboard reaches (CTL-075),
 * and the text summary beside them. The canvas is decoration for a reader who
 * cannot see it; the list and the summary are the same facts in text.
 *
 * A scatter plots records, not categories, so it has no mark list: a point
 * filters nothing, and its values are in the data table (SHT-017).
 */

export interface ChartFigureProps {
  readonly vm: ChartDetailVm;
  readonly selectedMark: number | null;
  readonly onSelectMark: (mark: ChartMarkVm) => void;
  /** The accessible name of a mark's button; the detail and the home say it differently. */
  readonly markLabel?: (mark: ChartMarkVm, text: string) => string;
  /** False for a builder's preview, which filters nothing: its summary still says every fact. */
  readonly showMarks?: boolean;
}

export function ChartFigure({ vm, selectedMark, onSelectMark, markLabel, showMarks = true }: ChartFigureProps): ReactNode {
  const data = useMemo(() => canvasDataOf(vm), [vm]);
  const select = (index: number): void => {
    const mark = vm.marks[index];
    if (mark !== undefined) onSelectMark(mark);
  };
  return (
    <figure className={cx(styles["figure"])}>
      <div aria-label={describeChartGroup(vm)} role="group">
        <ChartCanvas data={data} onMark={select} selectedMark={selectedMark} />
      </div>
      {showMarks && vm.type !== "scatter" && vm.marks.length > 0 && (
        <ul aria-label="Chart marks" className={cx(styles["markList"])}>
          {vm.marks.map((mark) => {
            const name = describeMark(mark);
            const value = mark.kind === "group" ? describeMarkValue(mark.value, vm.measure) : "";
            const text = `${name}, ${value}`;
            return (
              <li key={mark.index}>
                <button
                  aria-label={markLabel === undefined ? text : markLabel(mark, text)}
                  aria-pressed={selectedMark === mark.index}
                  className={cx(styles["mark"])}
                  data-mark={mark.index}
                  onClick={() => {
                    onSelectMark(mark);
                  }}
                  type="button"
                >
                  <span className={cx(styles["markName"])}>{name}</span>
                  <span className={cx(styles["markValue"])}>{value}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <figcaption className={cx(styles["summary"])} data-summary="true">
        {describeSummary(vm)}
      </figcaption>
    </figure>
  );
}

/**
 * STA-015: the scope as a quiet badge when every row was read and every
 * category drawn; otherwise the named omission, with design.md's remedy —
 * **Open full data**, the table's own records list, which holds every row.
 */
export function ChartScope({ vm, fullDataHref }: { readonly vm: ChartDetailVm; readonly fullDataHref: string }): ReactNode {
  const [first = "", ...rest] = describeScope(vm);
  if (!vm.scope.isPartial) {
    return (
      <span className={cx(styles["scopeBadge"])} data-scope="all">
        {first}
      </span>
    );
  }
  return (
    <div data-scope={vm.scope.kind} data-state="STA-015">
      <StatusBanner
        action={<InlineLink target={{ kind: "internal", href: fullDataHref }}>Open full data</InlineLink>}
        title={first}
        tone="warning"
      >
        {rest.length > 0 ? `${rest.join(". ")}.` : undefined}
      </StatusBanner>
    </div>
  );
}
