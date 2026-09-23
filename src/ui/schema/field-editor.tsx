import { useState, type ReactNode } from "react";
import {
  typeChoicesFor,
  typeForChoice,
  type FieldTypeKindVm,
  type SchemaChangeVm,
  type StructureFieldVm,
  type StructureTableRowVm,
} from "../../application/view-models/schema.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { SelectField } from "../primitives/select-field.js";
import { TextField } from "../primitives/text-field.js";
import { EnumEditor } from "./enum-editor.js";
import { RelationshipEditor } from "./relationship-editor.js";
import styles from "./schema.module.css";

/**
 * schema.html's field panel: "What people see", "What kind of
 * information?", the choices, the connection, and — for a computed field —
 * its calculation, read-only here and edited in the live-calculation editor.
 *
 * Nothing on this panel changes the app by itself. Each editor proposes one
 * D59 change, and the route previews it with exact counts (MOD-014) before
 * anything is applied (CA-28).
 */

/** Where SHT-014's actions send focus. */
export const FIELD_FOCUS = Object.freeze({
  name: "structure-field-name",
  type: "structure-field-type",
  connection: "structure-field-connection",
  calculation: "structure-field-calculation",
});

export interface FieldEditorProps {
  readonly field: StructureFieldVm;
  readonly tables: readonly StructureTableRowVm[];
  readonly onPropose: (change: SchemaChangeVm) => void;
  readonly onOpenActions: () => void;
  /** Opens the live-calculation editor on this field's calculation. */
  readonly onEditCalculation?: () => void;
}

export function FieldEditor({ field, tables, onPropose, onOpenActions, onEditCalculation }: FieldEditorProps): ReactNode {
  const [name, setName] = useState(field.name);
  const [kind, setKind] = useState<FieldTypeKindVm>(field.type.kind);
  const isComputed = field.calculation !== null;
  const trimmed = name.normalize("NFC").trim();

  return (
    <section aria-labelledby="field-title" className={cx(styles["panel"])} data-structure-detail={field.fieldId}>
      <div className={cx(styles["head"])}>
        <div className={cx(styles["headText"])}>
          <span className={cx(styles["eyebrow"])}>{field.position}</span>
          <h2 className={cx(styles["sectionTitle"])} id="field-title">
            {field.name}
          </h2>
        </div>
        <div className={cx(styles["actions"])}>
          {field.calculation !== null && <span className={cx(styles["badge"])}>{field.calculation.badge}</span>}
          <Button onPress={onOpenActions}>Field actions</Button>
        </div>
      </div>

      <div className={cx(styles["inlineForm"])}>
        <TextField inputId={FIELD_FOCUS.name} label="What people see" onChange={setName} value={name} />
        {trimmed === "" || trimmed === field.name ? (
          <Button disabledReason={trimmed === "" ? "A name cannot be empty." : "Type a new name first."} isDisabled>
            Rename field
          </Button>
        ) : (
          <Button onPress={() => { onPropose({ kind: "rename-field", fieldId: field.fieldId, name: trimmed }); }}>
            Rename field
          </Button>
        )}
      </div>

      {isComputed ? (
        <dl className={cx(styles["facts"])}>
          <dt>What kind of information?</dt>
          <dd>{`${field.typeLabel}, calculated`}</dd>
        </dl>
      ) : (
        <div className={cx(styles["inlineForm"])} id={FIELD_FOCUS.type} tabIndex={-1}>
          <SelectField
            label="What kind of information?"
            onChange={setKind}
            options={typeChoicesFor(field.type)}
            value={kind}
          />
          {kind === field.type.kind ? (
            <Button disabledReason="Choose another kind first." isDisabled>
              Change type
            </Button>
          ) : (
            <Button
              onPress={() => {
                onPropose({ kind: "change-field-type", fieldId: field.fieldId, type: typeForChoice(kind, field.type) });
              }}
            >
              Change type
            </Button>
          )}
        </div>
      )}

      {!isComputed && field.isActive && (
        <div className={cx(styles["stack"])}>
          <span className={cx(styles["listTitle"])}>Required</span>
          <p className={cx(styles["lede"])}>
            {field.isRequired ? "Every record needs a value." : "A record may leave it empty."}
          </p>
          <div className={cx(styles["actions"])}>
            <Button onPress={() => { onPropose({ kind: "set-required", fieldId: field.fieldId, isRequired: !field.isRequired }); }}>
              {field.isRequired ? "Make optional" : "Make required"}
            </Button>
          </div>
        </div>
      )}

      {field.isActive && (
        <div className={cx(styles["stack"])}>
          <span className={cx(styles["listTitle"])}>Role in the table</span>
          <p className={cx(styles["lede"])}>
            {[
              field.isKey ? "The key other tables connect to." : null,
              field.isLabel ? "What each record is called." : null,
            ]
              .filter((part) => part !== null)
              .join(" ") || "Neither the key nor the record label."}
          </p>
          <div className={cx(styles["actions"])}>
            <Button
              onPress={() => {
                onPropose({ kind: "set-table-key", tableId: field.tableId, keyFieldId: field.isKey ? null : field.fieldId });
              }}
            >
              {field.isKey ? "Stop using as the key" : "Use as the key"}
            </Button>
            <Button
              onPress={() => {
                onPropose({ kind: "set-table-label", tableId: field.tableId, labelFieldId: field.isLabel ? null : field.fieldId });
              }}
            >
              {field.isLabel ? "Stop using as the label" : "Use as the record label"}
            </Button>
          </div>
        </div>
      )}

      {field.type.kind === "enum" && !isComputed && (
        <EnumEditor fieldId={field.fieldId} fieldName={field.name} onPropose={onPropose} options={field.options} />
      )}

      {!isComputed && field.type.kind !== "enum" && field.type.kind !== "boolean" && (
        <RelationshipEditor
          connection={field.connection}
          fieldId={field.fieldId}
          fieldName={field.name}
          focusId={FIELD_FOCUS.connection}
          onPropose={onPropose}
          tableId={field.tableId}
          tables={tables}
        />
      )}

      {field.calculation !== null && (
        <div className={cx(styles["stack"])} data-calculation={field.calculation.formulaId} id={FIELD_FOCUS.calculation} tabIndex={-1}>
          <span className={cx(styles["listTitle"])}>In plain language</span>
          <code className={cx(styles["expression"])}>{field.calculation.text}</code>
          {onEditCalculation !== undefined && (
            <div className={cx(styles["actions"])}>
              <Button onPress={onEditCalculation}>Edit calculation</Button>
            </div>
          )}
        </div>
      )}

      {field.connection?.evidence != null && (
        <div className={cx(styles["notice"])}>
          <strong>Why Sheaf chose this</strong>
          <span>{field.connection.evidence}</span>
        </div>
      )}

      <div className={cx(styles["actions"])}>
        {field.isActive ? (
          <Button
            onPress={() => {
              // A computed column is removed by removing its calculation (D51): its field is deactivated with it.
              onPropose(
                field.calculation === null
                  ? { kind: "deactivate-field", fieldId: field.fieldId }
                  : { kind: "remove-formula", formulaId: field.calculation.formulaId },
              );
            }}
          >
            Remove field
          </Button>
        ) : (
          <Button onPress={() => { onPropose({ kind: "reactivate-field", fieldId: field.fieldId }); }}>
            Restore field
          </Button>
        )}
        <span className={cx(styles["hint"])}>
          {field.isActive
            ? field.calculation === null
              ? "Removing keeps every record's value for this field."
              : "Removing stops the calculation; no calculated value is stored in its place."
            : "Records kept this field's values; restoring shows them again."}
        </span>
      </div>
    </section>
  );
}
