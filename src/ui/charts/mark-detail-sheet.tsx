import type { ReactNode } from "react";
import type { ChartDetailVm, ChartMarkVm } from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { describeRecordCount } from "../records/values.js";
import { describeCategory, describeMark, describeMarkValue } from "./chart-text.js";
import styles from "./charts.module.css";

/**
 * SHT-012 — chart-mark detail (sheet-atlas.html; chart-detail.html's
 * "Selected mark" panel). Required contents: *series/category/value,
 * apply/clear filter*. Applying opens the records list filtered to exactly the
 * rows this mark counted (the intent travels in navigation state, D63);
 * clearing leaves the chart with nothing selected. A mark whose rows no
 * filter can name says so, and offers nothing to apply.
 */

export interface MarkDetailSheetProps {
  readonly vm: ChartDetailVm;
  readonly mark: Extract<ChartMarkVm, { kind: "group" }>;
  readonly onApply: (mark: Extract<ChartMarkVm, { kind: "group" }>) => void;
  readonly onClear: () => void;
}

export function MarkDetailSheet({ vm, mark, onApply, onClear }: MarkDetailSheetProps): ReactNode {
  const records = describeRecordCount(mark.records);
  return (
    <Dialog
      footer={
        <>
          <Button onPress={onClear}>Clear filter</Button>
          {mark.filterIntent === null ? (
            <Button disabledReason="No filter finds exactly the records this mark counts." isDisabled tone="primary">
              {`View all ${records}`}
            </Button>
          ) : (
            <Button
              onPress={() => {
                onApply(mark);
              }}
              tone="primary"
            >
              {`View all ${records}`}
            </Button>
          )}
        </>
      }
      isOpen
      onOpenChange={(open) => {
        if (!open) onClear();
      }}
      title="Selected mark"
    >
      <div className={cx(styles["sheetBody"])} data-sheet="SHT-012">
        <p className={cx(styles["markHeading"])}>{`${describeMark(mark)} · ${describeMarkValue(mark.value, vm.measure)}`}</p>
        {vm.groupName !== null && <span className={cx(styles["chip"])}>{`${vm.groupName}: ${describeCategory(mark.category)}`}</span>}
        {vm.seriesName !== null && mark.series !== null && (
          <span className={cx(styles["chip"])}>{`${vm.seriesName}: ${describeCategory(mark.series)}`}</span>
        )}
        <p className={cx(styles["lede"])}>{`${records} in ${vm.tableName}.`}</p>
      </div>
    </Dialog>
  );
}
