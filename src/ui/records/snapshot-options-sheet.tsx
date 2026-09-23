import type { ReactNode } from "react";
import type { SnapshotOptionsVm } from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import styles from "./records.module.css";

/**
 * SHT-016 — snapshot options (sheet-atlas.html).
 *
 * Required contents, verbatim: *find, export sheet, inert items, return to
 * live table*. All four are listed. Export is F07's: it is present and
 * disabled, and the reason travels with it so the absence is stated rather
 * than hidden.
 */

export type SnapshotOptionId = SnapshotOptionsVm["options"][number]["id"];

export interface SnapshotOptionsSheetProps {
  readonly isOpen: boolean;
  readonly vm: SnapshotOptionsVm;
  readonly onChoose: (id: Exclude<SnapshotOptionId, "export">) => void;
  readonly onClose: () => void;
}

export function SnapshotOptionsSheet({
  isOpen,
  vm,
  onChoose,
  onClose,
}: SnapshotOptionsSheetProps): ReactNode {
  if (!isOpen) return null;
  return (
    <Dialog
      footer={<Button onPress={onClose}>Close</Button>}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Snapshot options"
    >
      <ul className={cx(styles["sheetList"])} data-sheet="SHT-016">
        {vm.options.map((option) => (
          <li key={option.id}>
            {option.isEnabled ? (
              <Button
                onPress={() => {
                  onChoose(option.id);
                }}
              >
                {option.label}
              </Button>
            ) : (
              <Button disabledReason={option.disabledReason} isDisabled>
                {option.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
