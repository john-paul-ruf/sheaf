import type { ReactNode } from "react";
import type { DeleteRecordDialogVm } from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { describeValue } from "./values.js";
import styles from "./records.module.css";

/**
 * MOD-009 — delete record (dialog-atlas.html).
 *
 * Decision contract, verbatim: *recoverable change-log deletion confirmation*.
 * The word "recoverable" is only true because D22 ships SCR-032 and MOD-010 in
 * this same feature — `DeleteRecordDialogVm.recoverable` is a literal `true`
 * for that reason, and the sentence beside it names where the record goes.
 *
 * It is an alert dialog: it announces assertively and does not close on an
 * outside click, because losing a destructive confirmation by accident is how
 * data disappears (M38's `Dialog`, design.md § Accessibility Contract).
 */

export interface DeleteRecordDialogProps {
  readonly isOpen: boolean;
  readonly vm: DeleteRecordDialogVm;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function DeleteRecordDialog({
  isOpen,
  vm,
  onConfirm,
  onCancel,
}: DeleteRecordDialogProps): ReactNode {
  if (!isOpen) return null;

  return (
    <Dialog
      footer={
        <>
          <Button onPress={onCancel}>Cancel safely</Button>
          {vm.busy ? (
            <Button
              disabledReason="This delete is being written to this device."
              isDisabled
              tone="destructive"
            >
              Delete record
            </Button>
          ) : (
            <Button onPress={onConfirm} tone="destructive">
              Delete record
            </Button>
          )}
        </>
      }
      isOpen
      kind="destructive"
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="Delete this record?"
    >
      <p className={cx(styles["lede"])}>
        {vm.label === null
          ? "This record has no value to lead with."
          : `${vm.label.displayName}: ${describeValue(vm.label.value, undefined)}`}
      </p>
      <p className={cx(styles["lede"])}>{vm.assurance}</p>
    </Dialog>
  );
}
