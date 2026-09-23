import { useState, type ReactNode } from "react";
import {
  operatorChoicesFor,
  ruleValueFrom,
  ruleValueHint,
  ruleValueText,
  type RuleConditionVm,
  type RuleFieldChoiceVm,
  type StructureRuleVm,
} from "../../application/view-models/schema.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { SelectField } from "../primitives/select-field.js";
import { TextField } from "../primitives/text-field.js";
import styles from "./schema.module.css";

/**
 * "Rules across fields" — the rule editor (schema.html; D52, CA-27).
 *
 * A rule is built from structured clauses only: a field, a comparison, and
 * another field or a typed value. There is no free-text rule box, by
 * contract. The sentence the rule list will show is drawn live from the same
 * clause, so what is saved is what is read. Nothing is saved here: "Preview
 * impact" counts the records that fail it now (MOD-014) first.
 */

type CompareOp = Extract<RuleConditionVm, { kind: "compare" }>["op"];
type RightKind = "field" | "value";

export interface RuleDraftV1 {
  readonly displayName: string;
  readonly condition: RuleConditionVm;
  readonly severity: "warning" | "blocking";
}

export interface RuleEditorDialogProps {
  readonly tableName: string;
  readonly fields: readonly RuleFieldChoiceVm[];
  /** The rule being edited; absent for a new rule. */
  readonly rule?: StructureRuleVm;
  /** The sentence a clause will read as, in the app's current names. */
  readonly describe: (condition: RuleConditionVm) => string;
  readonly onPreview: (draft: RuleDraftV1) => void;
  readonly onCancel: () => void;
}

const SEVERITY_CHOICES = [
  { value: "blocking", label: "Refuse the save" },
  { value: "warning", label: "Save it and flag the record" },
] as const;

export function RuleEditorDialog({ tableName, fields, rule, describe, onPreview, onCancel }: RuleEditorDialogProps): ReactNode {
  const initial = rule?.condition.kind === "compare" ? rule.condition : null;
  const [left, setLeft] = useState<string | null>(initial?.left ?? null);
  const [op, setOp] = useState<CompareOp>(initial?.op ?? "ge");
  const [rightKind, setRightKind] = useState<RightKind>(initial !== null && "value" in initial.right ? "value" : "field");
  const [rightField, setRightField] = useState<string | null>(initial !== null && "field" in initial.right ? initial.right.field : null);
  const [rightText, setRightText] = useState(initial !== null && "value" in initial.right ? ruleValueText(initial.right.value) : "");
  const [severity, setSeverity] = useState<"warning" | "blocking">(rule?.severity ?? "blocking");
  const [name, setName] = useState(rule?.name ?? "");

  const leftField = fields.find((field) => field.fieldId === left);
  const value = rightKind === "value" ? ruleValueFrom(rightText, leftField?.type) : null;
  const condition: RuleConditionVm | null =
    left === null
      ? null
      : rightKind === "field"
        ? rightField === null || rightField === left
          ? null
          : { kind: "compare", left, op, right: { field: rightField } }
        : value === null
          ? null
          : { kind: "compare", left, op, right: { value } };
  const sentence = condition === null ? null : describe(condition);
  const blocker =
    left === null
      ? "Choose the field the rule checks."
      : rightKind === "field"
        ? rightField === null
          ? "Choose the field to compare with."
          : rightField === left
            ? "Compare the field with a different field."
            : null
        : value === null
          ? `Enter a value: ${ruleValueHint(leftField?.type)}`
          : null;

  return (
    <Dialog
      footer={
        <>
          <Button onPress={onCancel}>Cancel</Button>
          {blocker === null && condition !== null && sentence !== null ? (
            <Button
              onPress={() => {
                const trimmed = name.normalize("NFC").trim();
                onPreview({ displayName: trimmed === "" ? sentence : trimmed, condition, severity });
              }}
              tone="primary"
            >
              Preview impact
            </Button>
          ) : (
            <Button disabledReason={blocker ?? "Complete the rule first."} isDisabled tone="primary">
              Preview impact
            </Button>
          )}
        </>
      }
      isOpen
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={rule === undefined ? `Add a rule for ${tableName}` : `Edit a rule for ${tableName}`}
    >
      <div className={cx(styles["stack"])} data-editor="rule">
        <SelectField
          label="Field to check"
          onChange={setLeft}
          options={fields.map((field) => ({ value: field.fieldId, label: field.name }))}
          placeholder="Choose a field"
          value={left}
        />
        <SelectField
          label="Must be"
          onChange={setOp}
          options={operatorChoicesFor(leftField?.type)}
          value={op}
        />
        <SelectField<RightKind>
          label="Compared with"
          onChange={setRightKind}
          options={[
            { value: "field", label: "Another field" },
            { value: "value", label: "A value" },
          ]}
          value={rightKind}
        />
        {rightKind === "field" ? (
          <SelectField
            label="Other field"
            onChange={setRightField}
            options={fields.filter((field) => field.fieldId !== left).map((field) => ({ value: field.fieldId, label: field.name }))}
            placeholder="Choose a field"
            value={rightField}
          />
        ) : (
          <TextField description={ruleValueHint(leftField?.type)} label="Value" onChange={setRightText} value={rightText} />
        )}
        <SelectField
          label="When a record breaks it"
          onChange={setSeverity}
          options={SEVERITY_CHOICES}
          value={severity}
        />
        <TextField
          description="Left empty, the rule is named by what it says."
          label="Rule name"
          onChange={setName}
          value={name}
        />
        <div className={cx(styles["notice"])} aria-live="polite">
          <strong>The rule reads</strong>
          <span data-rule-sentence="">{sentence ?? "Choose both sides of the comparison."}</span>
        </div>
      </div>
    </Dialog>
  );
}
