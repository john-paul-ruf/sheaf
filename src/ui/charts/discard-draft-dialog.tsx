import type { ReactNode } from "react";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import styles from "./charts.module.css";

/**
 * MOD-012 — discard chart draft (dialog-atlas.html; D61). The decision
 * contract, verbatim: *leave, keep editing, or save draft locally*. It is an
 * alert dialog, so a click outside never makes the choice; Escape keeps
 * editing, which loses nothing. A draft saved locally is encrypted
 * operational state on this device, never a chart and never a change.
 */

export interface DiscardDraftDialogProps {
  readonly onLeave: () => void;
  readonly onKeepEditing: () => void;
  readonly onSaveDraft: () => void;
  readonly busy?: boolean;
}

export function DiscardDraftDialog({ onLeave, onKeepEditing, onSaveDraft, busy = false }: DiscardDraftDialogProps): ReactNode {
  return (
    <Dialog
      footer={
        <>
          <Button autoFocus onPress={onKeepEditing}>
            Keep editing
          </Button>
          <Button onPress={onSaveDraft} {...(busy ? { isDisabled: true as const, disabledReason: "The draft is being saved on this device." } : {})}>
            Save draft locally
          </Button>
          <Button onPress={onLeave} tone="destructive">
            Leave
          </Button>
        </>
      }
      isOpen
      kind="destructive"
      onOpenChange={(open) => {
        if (!open) onKeepEditing();
      }}
      title="Discard chart draft"
    >
      <p className={cx(styles["lede"])} data-dialog="MOD-012">
        This chart is not saved. Leaving discards it; a draft saved locally stays on this device to finish later.
      </p>
    </Dialog>
  );
}
