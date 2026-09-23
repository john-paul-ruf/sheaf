import { useState, type ReactNode } from "react";
import {
  CALCULATED_COLUMN_TYPES,
  type FieldTypeKindVm,
  type StructureCalculationVm,
} from "../../application/view-models/schema.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { SelectField } from "../primitives/select-field.js";
import { TextField } from "../primitives/text-field.js";
import styles from "./schema.module.css";

/**
 * The "Live calculation" editor (schema.html; D58, CAP-28/29).
 *
 * A calculation is written in spreadsheet syntax over the app's own names —
 * `[Quoted]-[Paid]` on this row, `SUM(Jobs[Quoted])` over a table,
 * `RELATED([Customer],[Name])` through a connection — and never with a cell
 * address. The text is not evaluated or parsed here: the worker translates it
 * when the change is previewed, and an unknown name or a syntax error comes
 * back with where it is. Nothing is saved until MOD-014's apply.
 */

export type CalculationTargetV1 = StructureCalculationVm["target"];

export interface FormulaDraftV1 {
  readonly target: CalculationTargetV1;
  readonly name: string;
  readonly type: FieldTypeKindVm;
  readonly text: string;
}

export interface FormulaEditorDialogProps {
  readonly tableName: string;
  /** The calculation being changed; absent for a new one. */
  readonly calculation?: StructureCalculationVm;
  /** Why the last preview was refused, where the worker could say. */
  readonly error?: string;
  readonly busy?: boolean;
  readonly onPreview: (draft: FormulaDraftV1) => void;
  readonly onCancel: () => void;
}

export const SYNTAX_HINT = "Use field names in square brackets: [Quoted]-[Paid], SUM(Jobs[Quoted]) or RELATED([Customer],[Name]).";

export function FormulaEditorDialog({ tableName, calculation, error, busy = false, onPreview, onCancel }: FormulaEditorDialogProps): ReactNode {
  const [target, setTarget] = useState<CalculationTargetV1>(calculation?.target ?? "computed-column");
  const [name, setName] = useState(calculation?.name ?? "");
  const [type, setType] = useState<FieldTypeKindVm>("number");
  const [text, setText] = useState(calculation?.text ?? "");
  const isNew = calculation === undefined;
  // A computed column is named by its field, renamed on the field itself.
  const needsName = isNew || target !== "computed-column";
  const blocker = busy
    ? "The calculation is being counted on this device."
    : needsName && name.trim() === ""
      ? "Name the calculation first."
      : text.trim() === ""
        ? "Write the calculation first."
        : null;

  return (
    <Dialog
      footer={
        <>
          <Button onPress={onCancel}>Cancel</Button>
          {blocker === null ? (
            <Button
              onPress={() => {
                onPreview({ target, name: name.normalize("NFC").trim(), type, text: text.normalize("NFC").trim() });
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
      title={isNew ? `Add a live calculation to ${tableName}` : `Change ${calculation.name}`}
    >
      <div className={cx(styles["stack"])} data-editor="formula">
        {isNew && (
          <SelectField<CalculationTargetV1>
            label="What to calculate"
            onChange={setTarget}
            options={[
              { value: "computed-column", label: `A column on each ${tableName} record` },
              { value: "table-metric", label: `A total for ${tableName}` },
              { value: "dashboard-value", label: "A value on app home" },
            ]}
            value={target}
          />
        )}
        {needsName && (
          <TextField label={target === "computed-column" ? "Column name" : "Name"} onChange={setName} value={name} />
        )}
        {isNew && target === "computed-column" && (
          <SelectField label="What kind of result" onChange={setType} options={CALCULATED_COLUMN_TYPES} value={type} />
        )}
        <TextField
          description={SYNTAX_HINT}
          inputClassName={cx(styles["formulaInput"])}
          label="Calculation"
          onChange={setText}
          value={text}
          {...(error === undefined ? {} : { isInvalid: true, errorMessage: error })}
        />
      </div>
    </Dialog>
  );
}
