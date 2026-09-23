import type { ReactNode } from "react";
import type { ImpactDialogVm } from "../../application/view-models/schema.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { StatusBanner } from "../primitives/status-banner.js";
import styles from "./schema.module.css";

/**
 * MOD-014 — schema impact confirmation (dialog-atlas.html#mod-014). Its
 * decision contract: *exact affected counts; preserve and flag*.
 *
 * The counts are the preview's, at the revision the apply will name (CA-28);
 * nothing here estimates. Apply is disabled, with its reason in words, when
 * the worker refused the change or it is too large for one commit (D57). A
 * change that preserves every value is not destructive, so the dialog is a
 * standard one: Escape and Cancel leave the app as it was. While the apply
 * runs, neither can interrupt it.
 */

export interface ImpactDialogProps {
  readonly vm: ImpactDialogVm;
  readonly onApply: () => void;
  readonly onCancel: () => void;
  readonly busy?: boolean;
  /** Why the last apply did not land. */
  readonly failure?: string;
}

export function ImpactDialog({ vm, onApply, onCancel, busy = false, failure }: ImpactDialogProps): ReactNode {
  const blocker = busy ? "The change is being applied on this device." : vm.blocker;
  return (
    <Dialog
      footer={
        <>
          {busy ? (
            <Button disabledReason="The change is being applied on this device." isDisabled>
              Cancel
            </Button>
          ) : (
            <Button onPress={onCancel}>Cancel</Button>
          )}
          {blocker === null ? (
            <Button onPress={onApply} tone="primary">
              {vm.applyLabel}
            </Button>
          ) : (
            <Button disabledReason={blocker} isDisabled tone="primary">
              {vm.applyLabel}
            </Button>
          )}
        </>
      }
      isDismissable={!busy}
      isOpen
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={vm.title}
    >
      <div className={cx(styles["stack"])} data-dialog="MOD-014">
        {vm.staleNote !== null && <StatusBanner title={vm.staleNote} tone="info" />}
        <ul className={cx(styles["countList"])}>
          {vm.counts.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className={cx(styles["lede"])}>{vm.preservation}</p>
        {failure !== undefined && (
          <p className={cx(styles["failure"])} role="alert">
            {failure}
          </p>
        )}
      </div>
    </Dialog>
  );
}
