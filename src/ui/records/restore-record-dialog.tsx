import type { ReactNode } from "react";
import type { RestoreRecordDialogVm } from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { describeValue, formatInstant, isoInstant } from "./values.js";
import styles from "./records.module.css";

/**
 * MOD-010 — restore a deleted record (dialog-atlas.html).
 *
 * Decision contract: *show original record/time and validation before
 * restore*. All three are here:
 *
 * - **the original record** — the values the delete preserved, read through
 *   `getDeletedRecord` (CA-21) and listed in the table's field order, so the
 *   person sees what will come back before choosing it;
 * - **the time** — when the delete happened, from the delete itself;
 * - **validation** — the one validator runs when the restore is written
 *   (invariant 5). Before that it is stated as what will happen; after a
 *   refusal the dialog stays open and names each field at fault.
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
        {vm.tableName === null ? "." : ` from ${vm.tableName}.`}
      </p>

      {vm.original.kind === "values" ? (
        vm.original.facts.length === 0 ? (
          <p className={cx(styles["lede"])}>The deleted record held no values.</p>
        ) : (
          <dl className={cx(styles["facts"])} data-original="">
            {vm.original.facts.map((fact) => (
              <div key={fact.fieldId}>
                <dt>{fact.displayName}</dt>
                <dd>
                  {/* A deleted record's reference is not resolved here; it is
                      named for what it is rather than left "reading". */}
                  {fact.value.kind === "reference" && fact.value.reference.kind === "pending"
                    ? "A record in a related table"
                    : describeValue(fact.value, undefined)}
                </dd>
              </div>
            ))}
          </dl>
        )
      ) : (
        <p className={cx(styles["lede"])} role="status">
          {vm.original.kind === "reading"
            ? "Reading the values this record held when it was deleted."
            : "The values this record held could not be read on this device."}
        </p>
      )}

      {vm.validation.kind === "rejected" ? (
        <StatusBanner title="This record was not restored" tone="danger">
          <ul className={cx(styles["issueList"])}>
            {vm.validation.issues.map((issue, index) => (
              <li key={`${issue.kind}-${String(index)}`}>{issue.sentence}</li>
            ))}
          </ul>
        </StatusBanner>
      ) : (
        <p className={cx(styles["lede"])}>{vm.assurance}</p>
      )}
    </Dialog>
  );
}
