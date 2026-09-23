import { useState, type ReactNode } from "react";
import type { TableSwitcherVm } from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { TextField } from "../primitives/text-field.js";
import { describeRecordCount } from "./values.js";
import styles from "./records.module.css";

/**
 * SHT-003 — the table switcher (sheet-atlas.html; CTL-059, FR-11).
 *
 * Required contents: *tables, row counts, current table*. Each table is a
 * link to its list — switching is navigation, so it is an anchor and the
 * browser's own history carries it — with its exact count (`listTables`, read
 * when the sheet opens) and the current one marked `aria-current`.
 *
 * {@link TableSwitcherTrigger} is CTL-059's control on the surface: it names
 * the current table and its count so the choice is visible before it is
 * opened.
 */

/** Above this many tables, the atlas's "search or refine" applies. */
const SEARCHABLE_FROM = 8;

export function TableSwitcherTrigger({
  vm,
  onOpen,
}: {
  readonly vm: TableSwitcherVm;
  readonly onOpen: () => void;
}): ReactNode {
  return (
    <Button onPress={onOpen}>
      {vm.current === null
        ? `Switch table · ${String(vm.tables.length)} tables`
        : `${vm.current.displayName} · ${describeRecordCount(vm.current.recordCount)} · switch table`}
    </Button>
  );
}

export interface TableSwitcherSheetProps {
  readonly isOpen: boolean;
  readonly vm: TableSwitcherVm;
  readonly tableHref: (tableId: string) => string;
  readonly onClose: () => void;
}

export function TableSwitcherSheet(props: TableSwitcherSheetProps): ReactNode {
  return props.isOpen ? <OpenSwitcher {...props} /> : null;
}

function OpenSwitcher({ vm, tableHref, onClose }: TableSwitcherSheetProps): ReactNode {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ""
      ? vm.tables
      : vm.tables.filter((table) => table.displayName.toLowerCase().includes(needle));

  return (
    <Dialog
      footer={<Button onPress={onClose}>Close</Button>}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Switch table"
    >
      {vm.tables.length >= SEARCHABLE_FROM && (
        <TextField
          autoComplete="off"
          label="Search tables"
          onChange={setQuery}
          value={query}
        />
      )}
      {shown.length === 0 ? (
        <p className={cx(styles["lede"])}>{`No table matches “${query}”.`}</p>
      ) : (
        <ul className={cx(styles["sheetList"])} data-sheet="SHT-003">
          {shown.map((table) => (
            <li key={table.tableId}>
              <a
                className={cx(styles["sheetOption"])}
                data-selected={table.isCurrent}
                href={tableHref(table.tableId)}
                onClick={onClose}
                {...(table.isCurrent ? { "aria-current": "page" as const } : {})}
              >
                <span>{table.displayName}</span>
                <span className={cx(styles["optionState"])}>
                  {table.isCurrent
                    ? `${describeRecordCount(table.recordCount)} · current`
                    : describeRecordCount(table.recordCount)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
