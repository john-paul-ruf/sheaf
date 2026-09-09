import { useState, type ReactNode } from "react";
import type { RecordFormFieldVm } from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { TextField } from "../primitives/text-field.js";
import styles from "./records.module.css";

/**
 * SHT-001 — the enum value picker (sheet-atlas.html).
 *
 * Required contents, verbatim from the atlas: *options, search for long sets,
 * current value, clear*. All four are here, and the current value is shown as
 * the selected option rather than as a sentence, so the sheet answers "what is
 * it now" without being read.
 *
 * It composes M38's `Dialog`, which is already a bottom-anchored sheet under
 * 600px and a centred modal above it — the atlas's own "promoted to a tablet
 * popover" rule — so the focus trap, the Escape route and the focus restore
 * are the ones every other overlay in Sheaf uses.
 *
 * Only *active* options are offered. An inactive option that a record already
 * holds stays visible on the record (the validator warns about it); offering
 * it as a new choice would be offering something the schema has retired.
 */

/** The option shape the form's input model carries (M37's `inputForField`). */
export type EnumOptionVm = Extract<
  RecordFormFieldVm["input"],
  { readonly kind: "enum" }
>["options"][number];

/** Above this many options, the atlas's "search for long sets" applies. */
const SEARCHABLE_FROM = 8;

export interface EnumPickerSheetProps {
  readonly isOpen: boolean;
  readonly fieldName: string;
  readonly options: readonly EnumOptionVm[];
  /** The current choice, or `null` when the field holds no option. */
  readonly value: string | null;
  /** `null` clears the field. */
  readonly onApply: (optionId: string | null) => void;
  readonly onClose: () => void;
}

export function EnumPickerSheet(props: EnumPickerSheetProps): ReactNode {
  // A fresh open is a fresh sheet: the key discards a selection that was
  // never applied, so re-opening always starts from the record's own value.
  return props.isOpen ? <OpenSheet key={props.value ?? ""} {...props} /> : null;
}

function OpenSheet({
  fieldName,
  options,
  value,
  onApply,
  onClose,
}: EnumPickerSheetProps): ReactNode {
  const [selected, setSelected] = useState<string | null>(value);
  const [query, setQuery] = useState("");

  const searchable = options.length >= SEARCHABLE_FROM;
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ""
      ? options
      : options.filter((option) =>
          option.label.toLowerCase().includes(needle),
        );

  return (
    <Dialog
      footer={
        <>
          <Button
            onPress={() => {
              onApply(null);
            }}
          >
            Clear value
          </Button>
          <Button
            onPress={() => {
              onApply(selected);
            }}
            tone="primary"
          >
            Apply choice
          </Button>
        </>
      }
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Choose ${fieldName}`}
    >
      {searchable && (
        <TextField
          autoComplete="off"
          label={`Search ${fieldName} choices`}
          onChange={setQuery}
          value={query}
        />
      )}

      {shown.length === 0 ? (
        <p className={cx(styles["lede"])}>
          {`No choice in ${fieldName} matches “${query}”.`}
        </p>
      ) : (
        <ul className={cx(styles["sheetList"])} data-sheet="SHT-001">
          {shown.map((option) => (
            <li key={option.optionId}>
              <button
                aria-pressed={selected === option.optionId}
                className={cx(styles["sheetOption"])}
                data-selected={selected === option.optionId}
                onClick={() => {
                  setSelected(option.optionId);
                }}
                type="button"
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
