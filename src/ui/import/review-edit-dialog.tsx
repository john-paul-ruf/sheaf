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
 * The controlled edits SCR-023 offers (CA-19, FR-4/FR-6/FR-7/FR-8).
 *
 * Every edit leaves here as a `ReviewEditIntentV1` and goes to the machine as
 * `APPLY_EDIT`; the stage is the authority and answers with a whole new
 * proposal or with a closed rejection reason (D23). Nothing is changed
 * locally and nothing is optimistic — a rejected edit must be able to leave
 * the screen exactly as it was. Every target is a key, never a name.
 *
 * **Currency is only offered where a currency code already exists.** There is
 * nowhere truthful to get a code for a field that is not currency yet —
 * inventing "USD" would put a value into the domain that no one wrote.
 *
 * **The intent is not the wire type.** `src/ui/**` may not reach into
 * `src/workers/` (`tests/unit/ui/architecture.test.ts`), so an edit leaves
 * here as {@link ReviewEditIntentV1} and the route table hands it to the
 * machine. The two are the same shape on purpose: the route's `send` is where
 * TypeScript checks that they still are.
 */

/** What a field's values look like — the type an override may choose. */
export type FieldTypeVm = ReviewFieldVm["valueType"];

/** What a field will be, a connection's reference included. */
export type FieldKindVm = ReviewFieldVm["type"];

/** Structurally `WorkbookReviewEditWireV1`; checked against it at the route table. */
export type ReviewEditIntentV1 =
  | { readonly kind: "rename-app"; readonly appName: string }
  | { readonly kind: "rename-table"; readonly tableKey: string; readonly tableName: string }
  | {
      readonly kind: "rename-field";
      readonly tableKey: string;
      readonly columnKey: string;
      readonly fieldName: string;
    }
  | {
      readonly kind: "override-type";
      readonly tableKey: string;
      readonly columnKey: string;
      readonly type: FieldTypeVm;
    }
  | { readonly kind: "set-header-row"; readonly regionKey: string; readonly rowIndex: number | null }
  | {
      readonly kind: "edit-enum-options";
      readonly tableKey: string;
      readonly columnKey: string;
      readonly options: readonly string[];
    }
  | { readonly kind: "reject-relationship"; readonly relationshipKey: string }
  | { readonly kind: "restore-relationship"; readonly relationshipKey: string }
  | { readonly kind: "retarget-relationship"; readonly relationshipKey: string; readonly toTableKey: string }
  | { readonly kind: "reject-statement"; readonly statementId: string }
  | { readonly kind: "restore-statement"; readonly statementId: string }
  | { readonly kind: "set-key"; readonly tableKey: string; readonly columnKey: string | null }
  | { readonly kind: "set-label"; readonly tableKey: string; readonly columnKey: string };

const TYPE_LABEL: Readonly<Record<FieldKindVm["kind"], string>> =
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
    reference: "A connection to another table",
  });

export function describeFieldType(type: FieldKindVm): string {
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
const TYPE_PHRASE: Readonly<Record<FieldKindVm["kind"], string>> =
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
    reference: "a connection to another table",
  });

export function describeFieldTypePhrase(type: FieldKindVm): string {
  return type.kind === "currency"
    ? `currency in ${type.currencyCode}`
    : TYPE_PHRASE[type.kind];
}

interface FieldChoiceV1 {
  readonly columnKey: string;
  readonly fieldName: string;
}

/** What is being edited. One dialog per shape, chosen by the statement. */
export type ReviewEditDraftV1 =
  | { readonly kind: "rename-app"; readonly appName: string }
  | { readonly kind: "rename-table"; readonly tableKey: string; readonly tableName: string }
  | {
      readonly kind: "rename-field";
      readonly tableKey: string;
      readonly columnKey: string;
      readonly fieldName: string;
    }
  | {
      readonly kind: "override-type";
      readonly tableKey: string;
      readonly columnKey: string;
      readonly type: FieldTypeVm;
      readonly fieldName: string;
    }
  | {
      readonly kind: "set-header-row";
      readonly regionKey: string;
      readonly rowIndex: number | null;
      readonly leadingRows: readonly {
        readonly rowIndex: number;
        readonly cells: readonly string[];
      }[];
    }
  | {
      readonly kind: "edit-enum-options";
      readonly tableKey: string;
      readonly columnKey: string;
      readonly fieldName: string;
      readonly options: readonly string[];
    }
  | {
      readonly kind: "set-key";
      readonly tableKey: string;
      readonly tableName: string;
      readonly columnKey: string | null;
      readonly fields: readonly FieldChoiceV1[];
    }
  | {
      readonly kind: "set-label";
      readonly tableKey: string;
      readonly tableName: string;
      readonly columnKey: string | null;
      readonly fields: readonly FieldChoiceV1[];
    }
  | {
      /** SHT-013's "Change connection": keep, reject, restore or retarget it. */
      readonly kind: "change-connection";
      readonly relationshipKey: string;
      readonly isApplied: boolean;
      readonly fromTableName: string;
      readonly toTableName: string;
      readonly retargets: readonly { readonly toTableKey: string; readonly toTableName: string }[];
    }
  | {
      /** A split, merge or classification: rejected or restored as a stored choice. */
      readonly kind: "reject-or-restore";
      readonly statementId: string;
      readonly isRejected: boolean;
      readonly sentence: string;
    };

const TITLE: Readonly<Record<ReviewEditDraftV1["kind"], string>> =
  Object.freeze({
    "rename-app": "Rename this app",
    "rename-table": "Rename this table",
    "rename-field": "Rename this field",
    "override-type": "Change what this field holds",
    "set-header-row": "Choose the header row",
    "edit-enum-options": "Edit the list of choices",
    "set-key": "Choose what identifies a record",
    "set-label": "Choose what names a record",
    "change-connection": "Change connection",
    "reject-or-restore": "Change this finding",
  });

const NO_HEADER = "none";
const NO_KEY = "none";
const KEEP = "keep";
const REJECT = "reject";
const RESTORE = "restore";
const RETARGET = "retarget:";

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
  switch (draft.kind) {
    case "rename-app":
      return draft.kind;
    case "rename-table":
    case "set-key":
    case "set-label":
      return `${draft.kind}-${draft.tableKey}`;
    case "rename-field":
    case "override-type":
    case "edit-enum-options":
      return `${draft.kind}-${draft.columnKey}`;
    case "set-header-row":
      return `${draft.kind}-${draft.regionKey}`;
    case "change-connection":
      return `${draft.kind}-${draft.relationshipKey}`;
    case "reject-or-restore":
      return `${draft.kind}-${draft.statementId}`;
  }
}

function initialChoice(draft: ReviewEditDraftV1): string {
  switch (draft.kind) {
    case "override-type":
      return draft.type.kind;
    case "set-header-row":
      return draft.rowIndex === null ? NO_HEADER : String(draft.rowIndex);
    case "set-key":
    case "set-label":
      return draft.columnKey ?? NO_KEY;
    default:
      return KEEP;
  }
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
  const [choice, setChoice] = useState(initialChoice(draft));

  const edit = buildEdit(draft, text, choice);
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
              disabledReason={
                draft.kind === "change-connection" || draft.kind === "set-key" || draft.kind === "set-label"
                  ? "Choose a different option to change this."
                  : "Fill this in before saving."
              }
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
              {draft.kind === "reject-or-restore"
                ? draft.isRejected
                  ? "Restore this"
                  : "Reject this"
                : "Save change"}
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
            onChange={setChoice}
            options={typeOptions(draft.type)}
            value={choice}
          />
        )}

        {draft.kind === "set-header-row" && (
          <SelectField
            description="Rows above the header are kept, and become no records."
            label="Header row"
            onChange={setChoice}
            options={[
              { value: NO_HEADER, label: "There is no header row" },
              ...draft.leadingRows.map((row) => ({
                value: String(row.rowIndex),
                label: `Row ${String(row.rowIndex + 1)}: ${row.cells
                  .slice(0, 4)
                  .join(", ")}`,
              })),
            ]}
            value={choice}
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

        {draft.kind === "set-key" && (
          <SelectField
            description={`A key is what another table uses to point at a record in “${draft.tableName}”.`}
            label="Each record is identified by"
            onChange={setChoice}
            options={[
              { value: NO_KEY, label: "Nothing identifies a record" },
              ...draft.fields.map((field) => ({ value: field.columnKey, label: field.fieldName })),
            ]}
            value={choice}
          />
        )}

        {draft.kind === "set-label" && (
          <SelectField
            description={`Connections show this instead of a record's raw key in “${draft.tableName}”.`}
            label="Each record is named by"
            onChange={setChoice}
            options={draft.fields.map((field) => ({ value: field.columnKey, label: field.fieldName }))}
            value={choice}
          />
        )}

        {draft.kind === "change-connection" && (
          <SelectField
            description="A rejected connection is kept as your choice, and the column stays as its values."
            label="This connection"
            onChange={setChoice}
            options={connectionOptions(draft)}
            value={choice}
          />
        )}

        {draft.kind === "reject-or-restore" && (
          <p>
            {draft.isRejected
              ? `You rejected this: ${draft.sentence} Restore it to use it again.`
              : `${draft.sentence} Reject it and Sheaf will not use it; your choice is kept.`}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function connectionOptions(
  draft: Extract<ReviewEditDraftV1, { kind: "change-connection" }>,
): readonly { readonly value: string; readonly label: string }[] {
  if (!draft.isApplied) {
    return [
      { value: KEEP, label: "Keep these lists unconnected" },
      { value: RESTORE, label: `Connect “${draft.fromTableName}” to “${draft.toTableName}” again` },
    ];
  }
  return [
    { value: KEEP, label: `Keep: “${draft.fromTableName}” belongs to “${draft.toTableName}”` },
    { value: REJECT, label: "Do not connect these lists" },
    ...draft.retargets.map((target) => ({
      value: `${RETARGET}${target.toTableKey}`,
      label: `Connect to “${target.toTableName}” instead`,
    })),
  ];
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
  return (Object.keys(TYPE_LABEL) as FieldKindVm["kind"][])
    .filter((kind) => kind !== "reference")
    .filter((kind) => kind !== "currency" || current.kind === "currency")
    .map((kind) => ({ value: kind, label: TYPE_LABEL[kind] }));
}

/** `null` when the draft is not yet a change the stage would accept. */
function buildEdit(
  draft: ReviewEditDraftV1,
  text: string,
  choice: string,
): ReviewEditIntentV1 | null {
  switch (draft.kind) {
    case "rename-app":
      return text.trim() === "" ? null : { kind: "rename-app", appName: text };
    case "rename-table":
      return text.trim() === ""
        ? null
        : { kind: "rename-table", tableKey: draft.tableKey, tableName: text };
    case "rename-field":
      return text.trim() === ""
        ? null
        : {
            kind: "rename-field",
            tableKey: draft.tableKey,
            columnKey: draft.columnKey,
            fieldName: text,
          };
    case "override-type":
      return {
        kind: "override-type",
        tableKey: draft.tableKey,
        columnKey: draft.columnKey,
        type:
          choice === "currency" && draft.type.kind === "currency"
            ? { kind: "currency", currencyCode: draft.type.currencyCode }
            : ({ kind: choice } as FieldTypeVm),
      };
    case "set-header-row":
      return {
        kind: "set-header-row",
        regionKey: draft.regionKey,
        rowIndex: choice === NO_HEADER ? null : Number(choice),
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
            tableKey: draft.tableKey,
            columnKey: draft.columnKey,
            options,
          };
    }
    case "set-key": {
      const columnKey = choice === NO_KEY ? null : choice;
      return columnKey === draft.columnKey ? null : { kind: "set-key", tableKey: draft.tableKey, columnKey };
    }
    case "set-label":
      return choice === draft.columnKey || choice === NO_KEY
        ? null
        : { kind: "set-label", tableKey: draft.tableKey, columnKey: choice };
    case "change-connection":
      if (choice === REJECT) return { kind: "reject-relationship", relationshipKey: draft.relationshipKey };
      if (choice === RESTORE) return { kind: "restore-relationship", relationshipKey: draft.relationshipKey };
      if (choice.startsWith(RETARGET)) {
        return {
          kind: "retarget-relationship",
          relationshipKey: draft.relationshipKey,
          toTableKey: choice.slice(RETARGET.length),
        };
      }
      return null;
    case "reject-or-restore":
      return draft.isRejected
        ? { kind: "restore-statement", statementId: draft.statementId }
        : { kind: "reject-statement", statementId: draft.statementId };
  }
}
