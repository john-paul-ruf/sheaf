import { useId, useState, type FormEvent, type ReactNode } from "react";
import type {
  RecordFormFieldVm,
  RecordFormVm,
  RecordIssueVm,
  RecordValueVm,
} from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { StatusBanner } from "../primitives/status-banner.js";
import {
  AppFrame,
  type AppIdentity,
  type AppNavigation,
} from "./app-frame.js";
import { EnumPickerSheet } from "./enum-picker-sheet.js";
import {
  epochDayToIsoDate,
  isCanonicalDecimalText,
  isoDateToEpochDay,
} from "./values.js";
import styles from "./records.module.css";

/**
 * SCR-028 and SCR-029 — authoring a record (record-create.html,
 * record-edit.html; CAP-16, FR-12, D23).
 *
 * **The keyboard is decided by the field's type, not by the screen.** M37's
 * `inputForField` maps every `FieldTypeV1` to a control and a keyboard, and
 * this file renders that map and nothing else — so a phone field cannot come
 * up with a text keyboard because a surface forgot.
 *
 * **A number is text on the way in.** CTL-030 requires an *invalid* state, and
 * `type="number"` cannot hold one — a browser silently empties the field, and
 * what the person typed is gone before anyone can explain it. So an amount is
 * a text input with the decimal keypad, and what was typed reaches the worker
 * either as a `number` (when it is a canonical decimal) or as `text` (when it
 * is not). The second case is not this file deciding anything: it is the
 * truthful wire shape for "TBD", and the **one validator** is what refuses it
 * with a wrong-type issue this screen then renders in user language
 * (invariant 5, D23).
 *
 * **`noValidate`, and Save stays alive after a refusal.** The browser's own
 * validation would refuse before the domain ever saw the value, and a form
 * that disables its own submit when a refusal arrives cannot be corrected —
 * F01's lesson, restated as behaviour: the refusal is rendered, every field
 * keeps what was typed, and Save is live again the moment the write is over.
 *
 * **Nothing is acknowledged here.** The success sentence belongs to the
 * confirmed outcome and is rendered where the route sends the person after the
 * commit is durable (invariant 1).
 *
 * A `reference` field is read-only with its reason, because F02 has no
 * producer for one and `AuthoredCellWireValueV1` type-excludes it (D25).
 */

/** Structurally `AuthoredCellWireValueV1`; checked against it at the route. */
export type AuthoredValueIntentV1 =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "number"; readonly decimal: string }
  | { readonly kind: "boolean"; readonly boolean: boolean }
  | { readonly kind: "option"; readonly optionId: string }
  | { readonly kind: "date"; readonly epochDay: number }
  | { readonly kind: "blank" }
  | { readonly kind: "missing" };

export interface AuthoredEntryIntentV1 {
  readonly fieldId: string;
  readonly value: AuthoredValueIntentV1;
}

/** What a control is holding right now, before it becomes a wire value. */
type Draft =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "boolean"; readonly boolean: boolean }
  | { readonly kind: "option"; readonly optionId: string | null };

/** The type-to-keyboard map, read off control-atlas.html (CTL-030–036). */
interface KeyboardV1 {
  readonly type: "text" | "email" | "url" | "tel";
  readonly inputMode: "text" | "decimal" | "email" | "url" | "tel";
}

const TEXT_KEYBOARD: KeyboardV1 = Object.freeze({
  type: "text",
  inputMode: "text",
});

const KEYBOARD: Readonly<Record<string, KeyboardV1>> = Object.freeze({
  text: { type: "text", inputMode: "text" },
  number: { type: "text", inputMode: "decimal" },
  currency: { type: "text", inputMode: "decimal" },
  email: { type: "email", inputMode: "email" },
  url: { type: "url", inputMode: "url" },
  phone: { type: "tel", inputMode: "tel" },
  address: { type: "text", inputMode: "text" },
});

export function initialDraft(field: RecordFormFieldVm): Draft {
  const value = field.value;
  switch (field.input.kind) {
    case "boolean":
      return {
        kind: "boolean",
        boolean: value?.kind === "boolean" ? value.boolean : false,
      };
    case "enum":
      return {
        kind: "option",
        optionId: value?.kind === "option" ? value.optionId : null,
      };
    default:
      return { kind: "text", text: initialText(value) };
  }
}

/** What the control shows: exactly what is stored, including a kept invalid. */
function initialText(value: RecordValueVm | null): string {
  if (value === null) return "";
  switch (value.kind) {
    case "text":
      return value.text;
    case "number":
      return value.decimal;
    case "date":
      return epochDayToIsoDate(value.epochDay);
    // FR-6: the import kept the original, so the form offers the original.
    case "invalid-preserved":
      return value.sourceText;
    default:
      return "";
  }
}

/**
 * `null` when the control holds nothing to author on a create — a field never
 * given a value is `missing`, and saying so by *omission* is what keeps it
 * distinct from a `blank` someone deliberately cleared.
 */
export function intentFor(
  field: RecordFormFieldVm,
  draft: Draft,
  mode: "create" | "edit",
): AuthoredEntryIntentV1 | null {
  const cleared: AuthoredEntryIntentV1 | null =
    mode === "create" ? null : { fieldId: field.fieldId, value: { kind: "blank" } };

  if (draft.kind === "boolean") {
    return {
      fieldId: field.fieldId,
      value: { kind: "boolean", boolean: draft.boolean },
    };
  }
  if (draft.kind === "option") {
    return draft.optionId === null
      ? cleared
      : {
          fieldId: field.fieldId,
          value: { kind: "option", optionId: draft.optionId },
        };
  }

  const text = draft.text;
  if (text.trim() === "") return cleared;

  if (field.input.kind === "number" || field.input.kind === "currency") {
    const decimal = text.trim();
    return {
      fieldId: field.fieldId,
      value: isCanonicalDecimalText(decimal)
        ? { kind: "number", decimal }
        : // Not a number the domain holds. It crosses as what it is — text —
          // and the one validator says so in the report this screen renders.
          { kind: "text", text },
    };
  }

  if (field.input.kind === "date") {
    const epochDay = isoDateToEpochDay(text);
    return {
      fieldId: field.fieldId,
      value:
        epochDay === null ? { kind: "text", text } : { kind: "date", epochDay },
    };
  }

  return { fieldId: field.fieldId, value: { kind: "text", text } };
}

export interface RecordFormScreenProps {
  readonly vm: RecordFormVm;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  readonly cancelHref: string;
  readonly onSave: (entries: readonly AuthoredEntryIntentV1[]) => void;
  /** Edit mode only: opens MOD-009. */
  readonly onDelete?: () => void;
  /** MOD-009 and anything else the route composed. */
  readonly overlays?: ReactNode;
  readonly topBarActions?: ReactNode;
}

export function RecordFormScreen({
  vm,
  app,
  nav,
  cancelHref,
  onSave,
  onDelete,
  overlays,
  topBarActions,
}: RecordFormScreenProps): ReactNode {
  // Only what the person touched. An untouched field on a create stays
  // `missing`; on an edit it is simply not part of the patch.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, Draft>>(new Map());
  const [picking, setPicking] = useState<string | null>(null);

  const draftFor = (field: RecordFormFieldVm): Draft =>
    drafts.get(field.fieldId) ?? initialDraft(field);

  const setDraft = (fieldId: string, draft: Draft): void => {
    setDrafts((current) => new Map(current).set(fieldId, draft));
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (vm.busy) return;
    onSave(
      vm.fields.flatMap((field) => {
        if (!drafts.has(field.fieldId)) return [];
        const intent = intentFor(field, draftFor(field), vm.mode);
        return intent === null ? [] : [intent];
      }),
    );
  };

  const picked = vm.fields.find((field) => field.fieldId === picking);
  const pickedOptions =
    picked?.input.kind === "enum" ? picked.input.options : [];
  const pickedDraft = picked === undefined ? null : draftFor(picked);

  return (
    <AppFrame
      announcement={vm.announcement}
      app={app}
      area="records"
      currentTableId={vm.tableId}
      nav={nav}
      title={vm.mode === "create" ? "New record" : "Edit record"}
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen={vm.screen}>
        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>
            {`${vm.tableName} · ${vm.mode === "create" ? "New record" : "Editing"}`}
          </span>
          <h1 className={cx(styles["title"])}>
            {vm.mode === "create"
              ? `Add a record to ${vm.tableName}.`
              : `Edit this ${vm.tableName} record.`}
          </h1>
          <p className={cx(styles["lede"])}>
            Values are checked against this app's own rules, and the record is
            saved on this device before anything is acknowledged.
          </p>
        </div>

        {vm.recordIssues.length > 0 && (
          <StatusBanner title="This record was not saved" tone="danger">
            <ul className={cx(styles["issueList"])}>
              {vm.recordIssues.map((issue, index) => (
                <li key={`${issue.kind}-${String(index)}`}>{issue.sentence}</li>
              ))}
            </ul>
          </StatusBanner>
        )}

        {/* The typed refusals are the worker's; the browser's own validation
            would pre-empt them and never let the domain answer. */}
        <form className={cx(styles["form"])} noValidate onSubmit={submit}>
          {vm.fields.map((field) => (
            <FormField
              draft={draftFor(field)}
              field={field}
              key={field.fieldId}
              onOpenPicker={() => {
                setPicking(field.fieldId);
              }}
              onSetDraft={(draft) => {
                setDraft(field.fieldId, draft);
              }}
            />
          ))}

          <div className={cx(styles["thumbActions"])}>
            {vm.busy ? (
              <Button
                disabledReason="This record is being written to this device."
                isDisabled
                tone="primary"
              >
                Save on this device
              </Button>
            ) : (
              <Button tone="primary" type="submit">
                Save on this device
              </Button>
            )}
            <InlineLink target={{ kind: "internal", href: cancelHref }}>
              Cancel
            </InlineLink>
            {onDelete !== undefined && (
              <Button onPress={onDelete} tone="destructive">
                Delete record…
              </Button>
            )}
          </div>
        </form>

        <p className={cx(styles["note"])}>
          Saved records stay on this device. Backup runs separately and never
          blocks an edit.
        </p>
      </div>

      {picked !== undefined && pickedDraft !== null && (
        <EnumPickerSheet
          fieldName={picked.displayName}
          isOpen
          onApply={(optionId) => {
            setDraft(picked.fieldId, { kind: "option", optionId });
            setPicking(null);
          }}
          onClose={() => {
            setPicking(null);
          }}
          options={pickedOptions}
          value={pickedDraft.kind === "option" ? pickedDraft.optionId : null}
        />
      )}
      {overlays}
    </AppFrame>
  );
}

function FormField({
  field,
  draft,
  onSetDraft,
  onOpenPicker,
}: {
  readonly field: RecordFormFieldVm;
  readonly draft: Draft;
  readonly onSetDraft: (draft: Draft) => void;
  readonly onOpenPicker: () => void;
}): ReactNode {
  const inputId = useId();
  const labelId = useId();
  const describedBy = useId();
  const blocking = field.issues.some((issue) => issue.severity === "blocking");
  const input = field.input;

  // record-create.html renders a boolean as a choice row: the label carries
  // the field's name *and* the checkbox, so the whole row is the hit area.
  if (input.kind === "boolean") {
    return (
      <div className={cx(styles["fieldGroup"])} data-field={field.fieldId}>
        <label className={cx(styles["switchRow"])} htmlFor={inputId}>
          <input
            aria-describedby={describedBy}
            checked={draft.kind === "boolean" && draft.boolean}
            data-control="switch"
            id={inputId}
            onChange={(event) => {
              onSetDraft({ kind: "boolean", boolean: event.target.checked });
            }}
            type="checkbox"
          />
          <span className={cx(styles["label"])}>
            {field.displayName}
            {field.isRequired && " (required)"}
          </span>
          <span className={cx(styles["switchState"])}>
            {draft.kind === "boolean" && draft.boolean ? "Yes" : "No"}
          </span>
        </label>
        <FieldNotes describedBy={describedBy} field={field} />
      </div>
    );
  }

  return (
    <div className={cx(styles["fieldGroup"])} data-field={field.fieldId}>
      <label className={cx(styles["label"])} htmlFor={inputId} id={labelId}>
        {field.displayName}
        {field.isRequired && " (required)"}
      </label>

      {input.kind === "unsupported" ? (
        <p className={cx(styles["readOnly"])} id={inputId}>
          This field holds a link to another record. Editing one arrives in a
          later release, so its value is shown here and left as it is.
        </p>
      ) : input.kind === "enum" ? (
        <button
          aria-describedby={describedBy}
          // The field's name *and* the value it is holding: a `<label for>` on
          // a button replaces its contents as the accessible name, which would
          // announce "Site" and never what Site currently says.
          aria-labelledby={`${labelId} ${inputId}`}
          className={cx(styles["input"])}
          data-control="option-sheet"
          data-invalid={blocking}
          id={inputId}
          onClick={onOpenPicker}
          type="button"
        >
          {draft.kind === "option" && draft.optionId !== null
            ? (input.options.find(
                (option) => option.optionId === draft.optionId,
              )?.label ?? "A choice that is no longer in this field's list")
            : "Choose a value"}
        </button>
      ) : input.kind === "date" ? (
        <input
          aria-describedby={describedBy}
          aria-invalid={blocking}
          className={cx(styles["input"])}
          data-control="native-date-picker"
          data-invalid={blocking}
          id={inputId}
          onChange={(event) => {
            onSetDraft({ kind: "text", text: event.target.value });
          }}
          type="date"
          value={draft.kind === "text" ? draft.text : ""}
        />
      ) : (
        <input
          aria-describedby={describedBy}
          aria-invalid={blocking}
          className={cx(styles["input"])}
          data-control={input.control}
          data-invalid={blocking}
          id={inputId}
          inputMode={(KEYBOARD[input.kind] ?? TEXT_KEYBOARD).inputMode}
          onChange={(event) => {
            onSetDraft({ kind: "text", text: event.target.value });
          }}
          type={(KEYBOARD[input.kind] ?? TEXT_KEYBOARD).type}
          value={draft.kind === "text" ? draft.text : ""}
        />
      )}

      <FieldNotes describedBy={describedBy} field={field} />
    </div>
  );
}

/** What the field says about itself: its unit, and anything refused about it. */
function FieldNotes({
  field,
  describedBy,
}: {
  readonly field: RecordFormFieldVm;
  readonly describedBy: string;
}): ReactNode {
  return (
    <div className={cx(styles["description"])} id={describedBy}>
      {field.input.kind === "currency" && (
        <span>{`Amount in ${field.input.currencyCode}.`}</span>
      )}
      {field.issues.length > 0 && (
        <ul className={cx(styles["issueList"])}>
          {field.issues.map((issue, index) => (
            <FieldIssue issue={issue} key={`${issue.kind}-${String(index)}`} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldIssue({ issue }: { readonly issue: RecordIssueVm }): ReactNode {
  return (
    <li className={cx(styles["issue"])} data-severity={issue.severity}>
      {issue.sentence}
    </li>
  );
}
