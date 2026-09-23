import { useState, type ReactNode } from "react";
import type { SchemaChangeVm, StructureOptionVm } from "../../application/view-models/schema.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { TextField } from "../primitives/text-field.js";
import styles from "./schema.module.css";

/**
 * schema.html's "Choices" — add, rename, reorder and remove a choice list's
 * options, then preview the whole list as one `set-enum-options` change.
 *
 * An option keeps its id through a rename and a move (S03), so records that
 * hold it keep holding it. Removing an option is `isActive = false`: records
 * that hold it are counted, kept and flagged (D57), and the option can be
 * restored. A new option has no id until the worker gives it one.
 */

interface DraftOption {
  readonly optionId: string | null;
  readonly label: string;
  readonly isActive: boolean;
  /** The row's own key while it has no option id. */
  readonly key: string;
}

export interface EnumEditorProps {
  readonly fieldId: string;
  readonly fieldName: string;
  readonly options: readonly StructureOptionVm[];
  readonly onPropose: (change: SchemaChangeVm) => void;
}

export function EnumEditor({ fieldId, fieldName, options, onPropose }: EnumEditorProps): ReactNode {
  const initial = options.map((option) => ({ ...option, key: option.optionId }));
  const [draft, setDraft] = useState<readonly DraftOption[]>(initial);
  const [added, setAdded] = useState("");
  const [nextKey, setNextKey] = useState(0);

  const isDirty =
    JSON.stringify(draft.map((option) => [option.optionId, option.label, option.isActive])) !==
    JSON.stringify(options.map((option) => [option.optionId, option.label, option.isActive]));
  const hasEmpty = draft.some((option) => option.label.trim() === "");
  const update = (index: number, next: Partial<DraftOption>): void => {
    setDraft((current) => current.map((option, at) => (at === index ? { ...option, ...next } : option)));
  };
  const move = (index: number, by: -1 | 1): void => {
    setDraft((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved !== undefined) next.splice(index + by, 0, moved);
      return next;
    });
  };
  const blocker = !isDirty ? "No choice has changed yet." : hasEmpty ? "Every choice needs a name." : null;

  return (
    <div className={cx(styles["stack"])} data-editor="choices">
      <span className={cx(styles["listTitle"])} id={`choices-${fieldId}`}>
        Choices
      </span>
      <ol aria-labelledby={`choices-${fieldId}`} className={cx(styles["rows"])}>
        {draft.map((option, index) => (
          <li className={cx(styles["row"])} data-option={option.optionId ?? "new"} key={option.key}>
            <span aria-hidden="true" className={cx(styles["leading"])}>
              {index + 1}
            </span>
            <TextField
              label={`Choice ${String(index + 1)} of ${fieldName}`}
              onChange={(label) => {
                update(index, { label });
              }}
              value={option.label}
              {...(option.isActive ? {} : { description: "Removed · records that hold it are kept and flagged" })}
            />
            <div className={cx(styles["rowActions"])}>
              {index > 0 ? (
                <Button onPress={() => { move(index, -1); }}>{`Move ${option.label || "choice"} up`}</Button>
              ) : null}
              {index < draft.length - 1 ? (
                <Button onPress={() => { move(index, 1); }}>{`Move ${option.label || "choice"} down`}</Button>
              ) : null}
              {option.optionId === null ? (
                <Button onPress={() => { setDraft((current) => current.filter((_, at) => at !== index)); }}>
                  {`Discard new choice ${option.label}`.trim()}
                </Button>
              ) : (
                <Button onPress={() => { update(index, { isActive: !option.isActive }); }}>
                  {option.isActive ? `Remove ${option.label}` : `Restore ${option.label}`}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className={cx(styles["inlineForm"])}>
        <TextField label={`New choice for ${fieldName}`} onChange={setAdded} value={added} />
        {added.trim() === "" ? (
          <Button disabledReason="Name the new choice first." isDisabled>
            Add choice
          </Button>
        ) : (
          <Button
            onPress={() => {
              setDraft((current) => [...current, { optionId: null, label: added.normalize("NFC").trim(), isActive: true, key: `new-${String(nextKey)}` }]);
              setNextKey((current) => current + 1);
              setAdded("");
            }}
          >
            Add choice
          </Button>
        )}
      </div>
      {blocker === null ? (
        <Button
          onPress={() => {
            onPropose({
              kind: "set-enum-options",
              fieldId,
              options: draft.map((option) => ({ optionId: option.optionId, label: option.label.normalize("NFC").trim(), isActive: option.isActive })),
            });
          }}
        >
          Review choice changes
        </Button>
      ) : (
        <Button disabledReason={blocker} isDisabled>
          Review choice changes
        </Button>
      )}
    </div>
  );
}
