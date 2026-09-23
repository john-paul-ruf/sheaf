import { useState, type ReactNode } from "react";
import type {
  RecordsListVm,
  RecordsSortV1,
} from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import styles from "./records.module.css";

/**
 * SHT-009 — the sort picker (sheet-atlas.html; FR-13, CA-29).
 *
 * Required contents: *every column, ascending/descending*. One column and one
 * direction at a time, and the rule for missing values is said where the
 * choice is made: records with no value sort last either way, so a descending
 * sort never leads with blanks.
 */

export interface SortSheetProps {
  readonly vm: Pick<RecordsListVm, "sort" | "sortableFields">;
  /** `null` returns the list to its own order. */
  readonly onApply: (sort: RecordsSortV1 | null) => void;
  readonly onClose: () => void;
}

export function SortSheet({ vm, onApply, onClose }: SortSheetProps): ReactNode {
  const [fieldId, setFieldId] = useState<string | null>(vm.sort?.fieldId ?? null);
  const [direction, setDirection] = useState<RecordsSortV1["direction"]>(vm.sort?.direction ?? "asc");

  return (
    <Dialog
      footer={
        <>
          {vm.sort !== null && (
            <Button
              onPress={() => {
                onApply(null);
              }}
            >
              Clear sort
            </Button>
          )}
          {fieldId === null ? (
            <Button disabledReason="Choose a column to sort by." isDisabled tone="primary">
              Apply sort
            </Button>
          ) : (
            <Button
              onPress={() => {
                onApply({ fieldId, direction });
              }}
              tone="primary"
            >
              Apply sort
            </Button>
          )}
        </>
      }
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Sort records"
    >
      <div className={cx(styles["sheetBody"])} data-sheet="SHT-009">
        <div aria-label="Direction" className={cx(styles["segmented"])} role="group">
          {(["asc", "desc"] as const).map((value) => (
            <button
              aria-pressed={direction === value}
              className={cx(styles["segment"])}
              data-selected={direction === value}
              key={value}
              onClick={() => {
                setDirection(value);
              }}
              type="button"
            >
              {value === "asc" ? "Ascending" : "Descending"}
            </button>
          ))}
        </div>
        <p className={cx(styles["note"])}>Records with no value sort last in either direction.</p>
        <ul aria-label="Columns" className={cx(styles["sheetList"])}>
          {vm.sortableFields.map((field) => (
            <li key={field.fieldId}>
              <button
                aria-pressed={fieldId === field.fieldId}
                className={cx(styles["sheetOption"])}
                data-selected={fieldId === field.fieldId}
                onClick={() => {
                  setFieldId(field.fieldId);
                }}
                type="button"
              >
                {field.fieldName}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
