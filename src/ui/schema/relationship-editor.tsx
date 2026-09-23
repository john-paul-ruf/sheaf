import { useState, type ReactNode } from "react";
import type {
  SchemaChangeVm,
  StructureConnectionVm,
  StructureTableRowVm,
} from "../../application/view-models/schema.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { SelectField } from "../primitives/select-field.js";
import styles from "./schema.module.css";

/**
 * The connection editor (D64): retarget a connection to another table's key,
 * turn it off or on, remove it — or create one by converting this field's
 * values to connections (D57: matched values link, unmatched values are kept
 * and flagged). Every one of them is previewed with its counts first.
 *
 * Removing says what it means: the connection's values stay, and Sheaf will
 * not suggest the same connection again when the workbook is re-read (FR-7).
 */

export interface RelationshipEditorProps {
  readonly fieldId: string;
  readonly fieldName: string;
  readonly tableId: string;
  readonly connection: StructureConnectionVm | null;
  /** Every table of the app; only those with a key may be connected to. */
  readonly tables: readonly StructureTableRowVm[];
  readonly onPropose: (change: SchemaChangeVm) => void;
  /** The control that first takes focus when SHT-014 sends the person here. */
  readonly focusId: string;
}

export function RelationshipEditor({
  fieldId,
  fieldName,
  tableId,
  connection,
  tables,
  onPropose,
  focusId,
}: RelationshipEditorProps): ReactNode {
  const targets = tables.filter((table) => table.hasKey && table.tableId !== tableId);
  const [target, setTarget] = useState<string | null>(connection?.toTableId ?? targets[0]?.tableId ?? null);
  const targetName = targets.find((table) => table.tableId === target)?.name;

  return (
    <div className={cx(styles["stack"])} data-editor="connection" id={focusId} tabIndex={-1}>
      <span className={cx(styles["listTitle"])}>Connection</span>
      <p className={cx(styles["lede"])}>
        {connection === null
          ? `${fieldName} is not connected to another table.`
          : connection.isActive
            ? `${fieldName} connects each record to a record in ${connection.toTableName}.`
            : `${fieldName}'s connection to ${connection.toTableName} is turned off.`}
      </p>
      {targets.length === 0 ? (
        <p className={cx(styles["hint"])}>No other table has a key to connect to. Choose a table&apos;s key first.</p>
      ) : (
        <div className={cx(styles["inlineForm"])}>
          <SelectField
            label={`Connect ${fieldName} to`}
            onChange={setTarget}
            options={targets.map((table) => ({ value: table.tableId, label: table.name }))}
            value={target}
          />
          {target === null || (connection?.isActive === true && connection.toTableId === target) ? (
            <Button
              disabledReason={target === null ? "Choose a table first." : `${fieldName} already connects to ${targetName ?? "that table"}.`}
              isDisabled
            >
              Review connection
            </Button>
          ) : (
            <Button
              onPress={() => {
                onPropose({
                  kind: "set-relationship",
                  relationshipId: connection?.relationshipId ?? null,
                  fromFieldId: fieldId,
                  toTableId: target,
                  isActive: true,
                });
              }}
            >
              Review connection
            </Button>
          )}
        </div>
      )}
      {connection !== null && (
        <div className={cx(styles["actions"])}>
          {connection.isActive && (
            <Button
              onPress={() => {
                onPropose({
                  kind: "set-relationship",
                  relationshipId: connection.relationshipId,
                  fromFieldId: fieldId,
                  toTableId: connection.toTableId,
                  isActive: false,
                });
              }}
            >
              Turn off connection
            </Button>
          )}
          <Button
            onPress={() => {
              onPropose({ kind: "remove-relationship", relationshipId: connection.relationshipId });
            }}
          >
            Remove connection
          </Button>
        </div>
      )}
      {connection !== null && (
        <span className={cx(styles["hint"])}>
          Removing keeps every value, and Sheaf will not suggest this connection again.
        </span>
      )}
    </div>
  );
}
