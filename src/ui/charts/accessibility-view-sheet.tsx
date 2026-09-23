import type { ReactNode } from "react";
import type { ChartDetailVm, ChartMarkVm } from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { formatCount } from "../records/values.js";
import { describeCategory, describeMarkValue, describeMeasure, describeNumber, describeScope, describeSummary } from "./chart-text.js";
import styles from "./charts.module.css";

/**
 * SHT-017 — the chart/table accessibility view (sheet-atlas.html; CTL-077:
 * summary, complete data, named partial data). The text summary, then the
 * data table: every category the chart aggregated, drawn or not, a page at a
 * time. When the chart read a sample or left categories undrawn, the title
 * says the table is partial and the scope is named above it (STA-015).
 */

export interface AccessibilityViewSheetProps {
  readonly vm: ChartDetailVm;
  /** Present while more rows remain; appends the next page. */
  readonly onShowMore?: () => void;
  readonly busy?: boolean;
  readonly onClose: () => void;
}

export function AccessibilityViewSheet({ vm, onShowMore, busy = false, onClose }: AccessibilityViewSheetProps): ReactNode {
  const isScatter = vm.type === "scatter";
  const headers = isScatter
    ? [vm.axes?.x ?? "", vm.axes?.y ?? ""]
    : [
        vm.groupName ?? "",
        ...(vm.seriesName === null ? [] : [vm.seriesName]),
        ...(vm.measure.kind === "count" ? [] : [describeMeasure(vm.measure)]),
        "Records",
      ];
  const cells = (mark: ChartMarkVm): readonly string[] => {
    if (mark.kind === "point") {
      return [describeNumber(mark.x, vm.axes?.xType ?? null), describeNumber(mark.y, vm.axes?.yType ?? null)];
    }
    return [
      describeCategory(mark.category),
      ...(vm.seriesName === null ? [] : [mark.series === null ? "" : describeCategory(mark.series)]),
      ...(vm.measure.kind === "count" ? [] : [describeMarkValue(mark.value, vm.measure)]),
      formatCount(mark.records),
    ];
  };
  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={vm.scope.isPartial ? "Text summary and partial data table" : "Text summary and complete data table"}
    >
      <div className={cx(styles["sheetBody"])} data-sheet="SHT-017">
        <p className={cx(styles["summary"])}>{describeSummary(vm)}</p>
        <ul className={cx(styles["lede"])}>
          {describeScope(vm).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {/* A focusable, named region, so a keyboard can scroll a table wider than the sheet. */}
        <div aria-label={`${vm.name}, data table`} className={cx(styles["tableScroll"])} role="region" tabIndex={0}>
          <table className={cx(styles["dataTable"])}>
            <caption>{vm.name}</caption>
            <thead>
              <tr>
                {headers.map((header, index) => (
                  <th key={`${header}-${String(index)}`} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vm.table.rows.map((mark) => (
                <tr data-row={mark.index} key={mark.index}>
                  {cells(mark).map((cell, index) =>
                    index === 0 && !isScatter ? (
                      <th key={index} scope="row">
                        {cell}
                      </th>
                    ) : (
                      <td data-kind={index === 0 ? "text" : "number"} key={index}>
                        {cell}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={cx(styles["lede"])}>{`${formatCount(vm.table.rows.length)} of ${formatCount(vm.table.total)} rows shown.`}</p>
        {vm.table.hasMore && onShowMore !== undefined && (
          <Button
            onPress={onShowMore}
            {...(busy ? { isDisabled: true as const, disabledReason: "The next rows are being read." } : {})}
          >
            Show more rows
          </Button>
        )}
      </div>
    </Dialog>
  );
}
