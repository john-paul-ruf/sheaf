import type { ReactNode } from "react";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { InlineLink } from "../primitives/inline-link.js";
import styles from "./records.module.css";

/**
 * SHT-010 — record actions, F02 subset (sheet-atlas.html).
 *
 * The atlas lists *edit, duplicate, history, delete*. Three of the four ship
 * here; **duplicate is absent because nothing produces it** — there is no
 * duplicate command in M34's F02 set, and an action that cannot be performed
 * is not an action a sheet may offer. It arrives with the command, not with a
 * button that fails.
 *
 * Delete opens MOD-009 rather than deleting: a destructive action confirms
 * first, and this sheet is not the confirmation.
 */

export interface RecordActionsSheetProps {
  readonly isOpen: boolean;
  /** What the record is called, so the sheet names what it acts on. */
  readonly recordLabel: string;
  readonly editHref: string;
  readonly historyHref: string;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}

export function RecordActionsSheet({
  isOpen,
  recordLabel,
  editHref,
  historyHref,
  onDelete,
  onClose,
}: RecordActionsSheetProps): ReactNode {
  if (!isOpen) return null;

  return (
    <Dialog
      footer={<Button onPress={onClose}>Close</Button>}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Record actions"
    >
      <p className={cx(styles["lede"])}>{recordLabel}</p>
      <ul className={cx(styles["sheetList"])} data-sheet="SHT-010">
        <li>
          <InlineLink target={{ kind: "internal", href: editHref }}>
            Edit this record
          </InlineLink>
        </li>
        <li>
          <InlineLink target={{ kind: "internal", href: historyHref }}>
            Change history
          </InlineLink>
        </li>
        <li>
          <Button onPress={onDelete} tone="destructive">
            Delete record…
          </Button>
        </li>
      </ul>
    </Dialog>
  );
}
