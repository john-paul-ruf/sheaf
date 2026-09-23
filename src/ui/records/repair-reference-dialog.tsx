import { useState, type ReactNode } from "react";
import type { MissingReferenceVm } from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import {
  ReferenceSearchBody,
  type ReferenceChoice,
  type ReferenceSearch,
} from "./reference-picker-sheet.js";
import styles from "./records.module.css";

/**
 * MOD-011 — repair a broken reference (dialog-atlas.html).
 *
 * Decision contract, verbatim: *original key, search related table, leave
 * flagged*. All three are here:
 *
 * - the original key is shown as it was kept (D36), so the person can see
 *   what the workbook said before choosing what it should say;
 * - the related table is searched by human label through SHT-002's own search
 *   body, inside this dialog rather than a second one stacked over it;
 * - **leaving it flagged is a real choice and changes nothing** — it closes the
 *   dialog and writes no event, which is exactly what keeping the kept key
 *   means.
 *
 * Repairing authors the chosen record id through the ordinary patch command;
 * the one validator decides whether it is acceptable (invariant 5).
 */

export interface RepairReferenceDialogProps {
  readonly missing: MissingReferenceVm;
  readonly search: ReferenceSearch;
  readonly busy: boolean;
  readonly onRepair: (choice: ReferenceChoice) => void;
  readonly onLeaveFlagged: () => void;
}

export function RepairReferenceDialog({
  missing,
  search,
  busy,
  onRepair,
  onLeaveFlagged,
}: RepairReferenceDialogProps): ReactNode {
  const [selected, setSelected] = useState<ReferenceChoice | null>(null);

  return (
    <Dialog
      footer={
        <>
          <Button onPress={onLeaveFlagged}>Leave flagged</Button>
          {selected === null || busy ? (
            <Button
              disabledReason={
                busy
                  ? "This repair is being written to this device."
                  : "Choose a record first."
              }
              isDisabled
              tone="primary"
            >
              Repair reference
            </Button>
          ) : (
            <Button
              onPress={() => {
                onRepair(selected);
              }}
              tone="primary"
            >
              {`Point it at “${selected.label}”`}
            </Button>
          )}
        </>
      }
      isOpen
      onOpenChange={(open) => {
        if (!open) onLeaveFlagged();
      }}
      title="Repair broken reference"
    >
      <p className={cx(styles["lede"])}>
        {`${missing.relationName} points at a record that is not on this device.`}
      </p>
      <dl className={cx(styles["facts"])}>
        <dt>Original key</dt>
        <dd className={cx(styles["preserved"])}>
          {missing.kind === "broken"
            ? missing.originalKey
            : "No original key was recorded for it."}
        </dd>
      </dl>
      <ReferenceSearchBody
        fieldName={missing.relationName}
        onSelect={(candidate) => {
          setSelected({ recordId: candidate.recordId, label: candidate.label });
        }}
        search={search}
        selectedId={selected?.recordId ?? null}
      />
      <p className={cx(styles["note"])}>
        Leaving it flagged keeps the original key exactly as it is.
      </p>
    </Dialog>
  );
}
