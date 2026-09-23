import type { ReactNode } from "react";
import type {
  ComputedCellVm,
  RecordValueVm,
} from "../../application/view-models/records.js";
import { cx } from "../primitives/class-names.js";
import { describeValue, type FieldTypeVm } from "./values.js";
import styles from "./records.module.css";

/**
 * A computed column's value (CA-26; design.md § Records and data entry):
 * visibly read-only, labelled with what kind of value it is, and the
 * expression in the app's own names beneath it. Nothing here is an input.
 *
 * - **Live** — the recalculated result; blank when the calculation has none.
 * - **Frozen at import** — the workbook's value, kept as it was (RAND and kin).
 * - **Unsupported formula** (STA-013) — the imported value kept, or, on a row
 *   the workbook never calculated, left empty and flagged. Never a zero.
 *
 * Every state without a result says why in words (M37's `note`).
 */
export function ComputedValue({
  computed,
  value,
  type,
  isRecalculated = false,
}: {
  readonly computed: ComputedCellVm;
  readonly value: RecordValueVm | null;
  readonly type: FieldTypeVm | undefined;
  /** The worker just re-derived it (D60): it underlines for a moment. */
  readonly isRecalculated?: boolean;
}): ReactNode {
  const shown =
    value === null || value.kind === "missing" || value.kind === "blank" ? "" : describeValue(value, type);
  return (
    <div className={cx(styles["computedValue"])} data-computed={computed.state ?? "pending"} data-recalculated={isRecalculated}>
      <span className={cx(styles["recalculated"])}>{shown}</span>
      <span className={cx(styles["computedBadge"])} data-badge={computed.badge}>
        {`Read-only · ${computed.badge}`}
      </span>
      {computed.note !== null && <p className={cx(styles["description"])}>{computed.note}</p>}
      {computed.expression !== null && (
        <p className={cx(styles["expression"])}>{computed.expression}</p>
      )}
    </div>
  );
}
