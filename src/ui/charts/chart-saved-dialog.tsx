import { useState, type ReactNode } from "react";
import { Button } from "../primitives/button.js";
import { Checkbox } from "../primitives/checkbox.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { TextField } from "../primitives/text-field.js";
import styles from "./charts.module.css";

/**
 * MOD-013 — chart saved / pin choice (dialog-atlas.html). Its decision
 * contract: *the saved name and the pin-to-home decision*, confirmed before
 * the chart is committed. Nothing says "saved" until the worker has confirmed
 * the encrypted commit (invariant 1): while it runs the action waits, and a
 * refusal comes back here in words.
 */

export interface ChartSavedDialogProps {
  readonly name: string;
  readonly pinned: boolean;
  readonly onSave: (name: string, pinned: boolean) => void;
  readonly onCancel: () => void;
  readonly busy?: boolean;
  /** Why the last attempt did not save. */
  readonly failure?: string;
}

export function ChartSavedDialog({ name, pinned, onSave, onCancel, busy = false, failure }: ChartSavedDialogProps): ReactNode {
  const [draftName, setDraftName] = useState(name);
  const [isPinned, setIsPinned] = useState(pinned);
  const blocker = busy ? "The chart is being saved on this device." : draftName.trim() === "" ? "Name the chart to save it." : null;
  return (
    <Dialog
      footer={
        <>
          <Button onPress={onCancel}>Cancel</Button>
          {blocker === null ? (
            <Button
              onPress={() => {
                onSave(draftName.normalize("NFC").trim(), isPinned);
              }}
              tone="primary"
            >
              Save chart
            </Button>
          ) : (
            <Button disabledReason={blocker} isDisabled tone="primary">
              Save chart
            </Button>
          )}
        </>
      }
      isOpen
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="Save chart"
    >
      <div className={cx(styles["sheetBody"])} data-dialog="MOD-013">
        <TextField label="Chart name" onChange={setDraftName} value={draftName} />
        <Checkbox isSelected={isPinned} onChange={setIsPinned}>
          <strong>Pin to app home</strong>
          <span className={cx(styles["hint"])}>Saving a chart is a user change and will appear in backup status.</span>
        </Checkbox>
        {failure !== undefined && (
          <p className={cx(styles["failure"])} role="alert">
            {failure}
          </p>
        )}
      </div>
    </Dialog>
  );
}
