import type { ReactNode } from "react";
import type { RestoreRecordDialogVm } from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { formatInstant, isoInstant } from "./values.js";
import styles from "./records.module.css";

/**
 * MOD-010 — restore a deleted record (dialog-atlas.html).
 *
 * Decision contract: *show original record/time and validation before restore*.
 * Two of the three are facts this release holds — which record, and when it
 * was deleted — and the third is stated as what will happen: the restore is
 * re-validated against the current schema before it writes a new append-only
 * event (change-history.html, verbatim in the view model's `assurance`).
 *
 * **The original values are not shown, because nothing can read them here.**
 * A deleted record answers `null` to `getRecord`, and F02 has no query that
 * returns a deleted record's payload — the delete event carries it, and only
 * the restore command reads it. Showing "the original values" would mean
 * inventing them, so the dialog names what it knows and no more (the gap is
 * recorded for the feature that adds the read).
 */

export interface RestoreRecordDialogProps {
  readonly isOpen: boolean;
  readonly vm: RestoreRecordDialogVm;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function RestoreRecordDialog({
  isOpen,
  vm,
  onConfirm,
  onCancel,
}: RestoreRecordDialogProps): ReactNode {
  if (!isOpen) return null;

  return (
    <Dialog
      footer={
        <>
          <Button onPress={onCancel}>Cancel safely</Button>
          {vm.busy ? (
            <Button
              disabledReason="This restore is being written to this device."
              isDisabled
              tone="primary"
            >
              Restore record
            </Button>
          ) : (
            <Button onPress={onConfirm} tone="primary">
              Restore record
            </Button>
          )}
        </>
      }
      isOpen
      kind="destructive"
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="Restore this record?"
    >
      <p className={cx(styles["lede"])}>
        {"Deleted "}
        <time dateTime={isoInstant(vm.deletedAtEpochMs)}>
          {formatInstant(vm.deletedAtEpochMs)}
        </time>
        .
      </p>
      <p className={cx(styles["lede"])}>{vm.assurance}</p>
    </Dialog>
  );
}
