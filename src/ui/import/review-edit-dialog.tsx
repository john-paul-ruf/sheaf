import { useState, type FormEvent, type ReactNode } from "react";
import { Label, TextArea, TextField as AriaTextField } from "react-aria-components";
import type { ReviewFieldVm } from "../../application/view-models/import.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { SelectField } from "../primitives/select-field.js";
import { TextField } from "../primitives/text-field.js";
import styles from "./import.module.css";

/**
 * The controlled edits SCR-023 offers (CA-16, FR-4/FR-6/FR-8).
 *
 * Every edit leaves here as a `ReviewEditIntentV1` and goes to the machine as
 * `APPLY_EDIT`; the stage is the authority and answers with a whole new
 * proposal or with a closed rejection reason (D23). Nothing is changed
 * locally and nothing is optimistic — a rejected edit must be able to leave
 * the screen exactly as it was.
 *
 * **Currency is only offered where a currency code already exists.** A
 * `currency` field carries its `currencyCode`, and there is nowhere truthful
 * to get one for a field that is not currency yet — inventing "USD" would put
 * a value into the domain that no one wrote. Changing *away* from currency is
 * always available; changing *to* it needs F04's schema editor, where a code
 * can be chosen.
 *
 * **The intent is not the wire type.** `src/ui/**` may not reach into
 * `src/workers/` (`tests/unit/ui/architecture.test.ts`), so an edit leaves
 * here as {@link ReviewEditIntentV1} and the route table hands it to the
 * machine. The two are the same shape on purpose: the route's `send` is where
 * TypeScript checks that they still are.
 */

/** The field type as the view model carries it — the wire union, by alias. */
export type FieldTypeVm = ReviewFieldVm["type"];

/** Structurally `ReviewEditWireV1`; checked against it at the route table. */
export type ReviewEditIntentV1 =
  | { readonly kind: "rename-app"; readonly appName: string }
  | { readonly kind: "rename-table"; readonly tableName: string }
  | {
      readonly kind: "rename-field";
      readonly columnIndex: number;
      readonly fieldName: string;
    }
  | {
      readonly kind: "override-type";
      readonly columnIndex: number;
      readonly type: FieldTypeVm;
    }
  | { readonly kind: "set-header-row"; readonly rowIndex: number | null }
  | {
      readonly kind: "edit-enum-options";
      readonly columnIndex: number;
      readonly options: readonly string[];
    };

const TYPE_LABEL: Readonly<Record<FieldTypeVm["kind"], string>> =
  Object.freeze({
    text: "Text",
    number: "Number",
    currency: "Currency",
    date: "Date",
    boolean: "Yes or no",
    enum: "A choice from a list",
    email: "Email address",
    phone: "Phone number",
    url: "Web address",
    address: "Address",
  });

export function describeFieldType(type: FieldTypeVm): string {
  return type.kind === "currency"
    ? `Currency in ${type.currencyCode}`
    : TYPE_LABEL[type.kind];
}

/**
 * The same type inside a sentence — "looks like **a number**".
 *
 * It is a second map rather than a lower-cased first one, because
 * lower-casing "Currency in USD" yields "currency in usd" and English needs
 * the articles a label does not carry.
 */
const TYPE_PHRASE: Readonly<Record<FieldTypeVm["kind"], string>> =
  Object.freeze({
    text: "text",
    number: "a number",
    currency: "currency",
    date: "a date",
    boolean: "yes or no",
    enum: "a choice from a list",
    email: "an email address",
    phone: "a phone number",
    url: "a web address",
    address: "an address",
  });

export function describeFieldTypePhrase(type: FieldTypeVm): string {
  return type.kind === "currency"
    ? `currency in ${type.currencyCode}`
    : TYPE_PHRASE[type.kind];
}

/** What is being edited. One dialog per shape, chosen by the statement. */
export type ReviewEditDraftV1 =
  | { readonly kind: "rename-app"; readonly appName: string }
  | { readonly kind: "rename-table"; readonly tableName: string }
  | {
      readonly kind: "rename-field";
      readonly columnIndex: number;
      readonly fieldName: string;
    }
  | {
      readonly kind: "override-type";
      readonly columnIndex: number;
      readonly type: FieldTypeVm;
      readonly fieldName: string;
    }
  | {
      readonly kind: "set-header-row";
      readonly rowIndex: number | null;
      readonly leadingRows: readonly {
        readonly rowIndex: number;
        readonly cells: readonly string[];
      }[];
    }
  | {
      readonly kind: "edit-enum-options";
      readonly columnIndex: number;
      readonly fieldName: string;
      readonly options: readonly string[];
    };

const TITLE: Readonly<Record<ReviewEditDraftV1["kind"], string>> =
  Object.freeze({
    "rename-app": "Rename this app",
    "rename-table": "Rename this table",
    "rename-field": "Rename this field",
    "override-type": "Change what this field holds",
    "set-header-row": "Choose the header row",
    "edit-enum-options": "Edit the list of choices",
  });

const NO_HEADER = "none";

export interface ReviewEditDialogProps {
  readonly draft: ReviewEditDraftV1 | null;
  readonly onCancel: () => void;
  readonly onApply: (edit: ReviewEditIntentV1) => void;
}

export function ReviewEditDialog({
  draft,
  onCancel,
  onApply,
}: ReviewEditDialogProps): ReactNode {
  if (draft === null) return null;
  return (
    <ReviewEditForm
      draft={draft}
      key={draftKey(draft)}
      onApply={onApply}
      onCancel={onCancel}
    />
  );
}

/** A fresh draft is a fresh form; the key is what makes that literal. */
function draftKey(draft: ReviewEditDraftV1): string {
  return "columnIndex" in draft
    ? `${draft.kind}-${String(draft.columnIndex)}`
    : draft.kind;
}

function ReviewEditForm({
  draft,
  onApply,
  onCancel,
}: {
  readonly draft: ReviewEditDraftV1;
  readonly onApply: (edit: ReviewEditIntentV1) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const [text, setText] = useState(initialText(draft));
  const [typeKind, setTypeKind] = useState<FieldTypeVm["kind"]>(
    draft.kind === "override-type" ? draft.type.kind : "text",
  );
  const [headerRow, setHeaderRow] = useState(
    draft.kind === "set-header-row" && draft.rowIndex !== null
      ? String(draft.rowIndex)
      : NO_HEADER,
  );

  const edit = buildEdit(draft, text, typeKind, headerRow);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (edit !== null) onApply(edit);
  };

  return (
    <Dialog
      footer={
        <>
          <Button onPress={onCancel}>Cancel</Button>
          {edit === null ? (
            <Button
              disabledReason="Fill this in before saving."
              isDisabled
              tone="primary"
            >
              Save change
            </Button>
          ) : (
            <Button
              onPress={() => {
                onApply(edit);
              }}
              tone="primary"
            >
              Save change
            </Button>
          )}
        </>
      }
      isOpen
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={TITLE[draft.kind]}
    >
      <form className={cx(styles["fieldGroup"])} noValidate onSubmit={submit}>
        {(draft.kind === "rename-app" ||
          draft.kind === "rename-table" ||
          draft.kind === "rename-field") && (
          <TextField
            autoComplete="off"
            autoFocus
            isRequired
            label={
              draft.kind === "rename-field" ? "Field name" : "Name"
            }
            onChange={setText}
            value={text}
          />
        )}

        {draft.kind === "override-type" && (
          <SelectField
            description={`“${draft.fieldName}” keeps every value exactly as it was written; changing the type changes how Sheaf reads them.`}
            label="This field holds"
            onChange={(value) => {
              setTypeKind(value as FieldTypeVm["kind"]);
            }}
            options={typeOptions(draft.type)}
            value={typeKind}
          />
        )}

        {draft.kind === "set-header-row" && (
          <SelectField
            description="Rows above the header are kept, and become no records."
            label="Header row"
            onChange={setHeaderRow}
            options={[
              { value: NO_HEADER, label: "There is no header row" },
              ...draft.leadingRows.map((row) => ({
                value: String(row.rowIndex),
                label: `Row ${String(row.rowIndex + 1)}: ${row.cells
                  .slice(0, 4)
                  .join(", ")}`,
              })),
            ]}
            value={headerRow}
          />
        )}

        {draft.kind === "edit-enum-options" && (
          <AriaTextField
            className={cx(styles["fieldGroup"])}
            onChange={setText}
            value={text}
          >
            <Label className={cx(styles["choiceLabel"])}>
              One choice per line
            </Label>
            <TextArea className={cx(styles["textArea"])} rows={6} />
          </AriaTextField>
        )}
      </form>
    </Dialog>
  );
}

function initialText(draft: ReviewEditDraftV1): string {
  switch (draft.kind) {
    case "rename-app":
      return draft.appName;
    case "rename-table":
      return draft.tableName;
    case "rename-field":
      return draft.fieldName;
    case "edit-enum-options":
      return draft.options.join("\n");
    default:
      return "";
  }
}

/**
 * The types this dialog may offer. Currency is present only when the field is
 * already currency, because that is the only place its code exists.
 */
function typeOptions(
  current: FieldTypeVm,
): readonly { readonly value: string; readonly label: string }[] {
  return (Object.keys(TYPE_LABEL) as FieldTypeVm["kind"][])
    .filter((kind) => kind !== "currency" || current.kind === "currency")
    .map((kind) => ({ value: kind, label: TYPE_LABEL[kind] }));
}

/** `null` when the draft is not yet a change the stage would accept. */
function buildEdit(
  draft: ReviewEditDraftV1,
  text: string,
  typeKind: FieldTypeVm["kind"],
  headerRow: string,
): ReviewEditIntentV1 | null {
  switch (draft.kind) {
    case "rename-app":
      return text.trim() === "" ? null : { kind: "rename-app", appName: text };
    case "rename-table":
      return text.trim() === ""
        ? null
        : { kind: "rename-table", tableName: text };
    case "rename-field":
      return text.trim() === ""
        ? null
        : {
            kind: "rename-field",
            columnIndex: draft.columnIndex,
            fieldName: text,
          };
    case "override-type":
      return {
        kind: "override-type",
        columnIndex: draft.columnIndex,
        type:
          typeKind === "currency" && draft.type.kind === "currency"
            ? { kind: "currency", currencyCode: draft.type.currencyCode }
            : ({ kind: typeKind } as FieldTypeVm),
      };
    case "set-header-row":
      return {
        kind: "set-header-row",
        rowIndex: headerRow === NO_HEADER ? null : Number(headerRow),
      };
    case "edit-enum-options": {
      const options = text
        .split("\n")
        .map((option) => option.trim())
        .filter((option) => option !== "");
      return options.length === 0
        ? null
        : {
            kind: "edit-enum-options",
            columnIndex: draft.columnIndex,
            options,
          };
    }
  }
}
