import type { ReactNode } from "react";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import styles from "./schema.module.css";

/**
 * SHT-014 — the field/table action menu (sheet-atlas.html#sht-014). Its
 * required contents: *rename, change type, relationship, formula, delete*.
 *
 * Each action takes the person to the editor for it; none changes anything
 * here, because every change is previewed with its counts first (MOD-014).
 * "Delete" is said truthfully: a field is removed and its values are kept
 * (D57), so the action is "Remove field", never "Delete".
 */

export type FieldActionV1 = "rename" | "change-type" | "connection" | "calculation" | "remove" | "restore" | "rename-table";

export interface FieldActionsSheetProps {
  readonly fieldName: string;
  readonly tableName: string;
  readonly isActive: boolean;
  readonly isComputed: boolean;
  readonly onChoose: (action: FieldActionV1) => void;
  readonly onClose: () => void;
}

export function FieldActionsSheet({
  fieldName,
  tableName,
  isActive,
  isComputed,
  onChoose,
  onClose,
}: FieldActionsSheetProps): ReactNode {
  const action = (id: FieldActionV1, label: string, hint: string): ReactNode => (
    <li>
      <button
        className={cx(styles["anchor"])}
        data-action={id}
        onClick={() => {
          onChoose(id);
        }}
        type="button"
      >
        <span className={cx(styles["rowCopy"])}>
          <strong>{label}</strong>
          <span className={cx(styles["hint"])}>{hint}</span>
        </span>
      </button>
    </li>
  );
  return (
    <Dialog footer={<Button onPress={onClose}>Close</Button>} isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={`${fieldName} · ${tableName}`}>
      <ul className={cx(styles["anchorList"])} data-sheet="SHT-014">
        {action("rename", "Rename", "Change what people see.")}
        {!isComputed && action("change-type", "Change type", "Values that fit are converted; the rest are kept and flagged.")}
        {!isComputed && action("connection", "Connection", "Connect this field to another table, or change its connection.")}
        {isComputed && action("calculation", "Live calculation", "Change or remove the calculation.")}
        {isActive
          ? action("remove", "Remove field", "Records keep its values; it is no longer shown or asked for.")
          : action("restore", "Restore field", "Show it and ask for it again, with the values records kept.")}
        {action("rename-table", `Rename ${tableName}`, "Change the table's name everywhere it is shown.")}
      </ul>
    </Dialog>
  );
}
