import { useState, type ReactNode } from "react";
import type { UnsupportedFormulaVm } from "../../application/view-models/schema.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { TextField } from "../primitives/text-field.js";
import { SYNTAX_HINT } from "./formula-editor.js";
import styles from "./schema.module.css";

/**
 * MOD-015 — unsupported-formula rewrite (dialog-atlas.html#mod-015). Its
 * decision contract: *original text, imported value, new-row empty
 * behaviour*. All three are said before anything can be typed, so the person
 * rewriting knows what the calculation does today (D51, STA-013). The rewrite
 * is ordinary authored syntax (D58), previewed like every other change.
 */

export interface UnsupportedFormulaDialogProps {
  readonly vm: UnsupportedFormulaVm;
  /** Why the last preview was refused, where the worker could say. */
  readonly error?: string;
  readonly busy?: boolean;
  readonly onPreview: (text: string) => void;
  readonly onCancel: () => void;
}

export function UnsupportedFormulaDialog({ vm, error, busy = false, onPreview, onCancel }: UnsupportedFormulaDialogProps): ReactNode {
  const [text, setText] = useState("");
  const blocker = busy ? "The rewrite is being counted on this device." : text.trim() === "" ? "Write the calculation first." : null;
  return (
    <Dialog
      footer={
        <>
          <Button onPress={onCancel}>Keep it as it is</Button>
          {blocker === null ? (
            <Button
              onPress={() => {
                onPreview(text.normalize("NFC").trim());
              }}
              tone="primary"
            >
              Preview impact
            </Button>
          ) : (
            <Button disabledReason={blocker} isDisabled tone="primary">
              Preview impact
            </Button>
          )}
        </>
      }
      isOpen
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={vm.title}
    >
      <div className={cx(styles["stack"])} data-dialog="MOD-015">
        <dl className={cx(styles["facts"])}>
          <dt>Original text</dt>
          <dd>
            <code className={cx(styles["expression"])}>{vm.originalText}</code>
          </dd>
          <dt>Imported values</dt>
          <dd>{vm.keptSentence}</dd>
          <dt>New records</dt>
          <dd>{vm.newRowSentence}</dd>
        </dl>
        <TextField
          description={SYNTAX_HINT}
          inputClassName={cx(styles["formulaInput"])}
          label="Rewrite in Sheaf's syntax"
          onChange={setText}
          value={text}
          {...(error === undefined ? {} : { isInvalid: true, errorMessage: error })}
        />
      </div>
    </Dialog>
  );
}
