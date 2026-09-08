import { useState, type ReactNode } from "react";
import type {
  ImportReviewVm,
  ReviewEmptinessV1,
  ReviewEditRejectionVm,
  ReviewFieldVm,
  ReviewSectionVm,
  ReviewStatementVm,
  ReviewTableVm,
} from "../../application/view-models/import.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { UnlockedFrame, type SecurityNavigation } from "../security/frames.js";
import { formatCount } from "./delimited-target-screen.js";
import { ImportProgressRegion } from "./import-progress-screen.js";
import { ImportStages } from "./import-stages.js";
import {
  ReviewEditDialog,
  describeFieldType,
  describeFieldTypePhrase,
  type ReviewEditDraftV1,
  type ReviewEditIntentV1,
} from "./review-edit-dialog.js";
import { EvidenceSheet, describeDiagnostic, evidenceTag } from "./review-evidence.js";
import styles from "./import.module.css";

/**
 * SCR-023 — the one review (review.html, CAP-12, FR-4/FR-6/FR-8/FR-9).
 *
 * **One route, anchored sections, no wizard.** design.md §Import and review is
 * explicit: "The review screen is one route with anchored sections, not a
 * dismissible wizard whose later steps can be accidentally skipped." The
 * summary links into the sections; nothing here advances a step.
 *
 * **Nothing is accepted until "Create app".** The button is the only accept,
 * `confirm.canCreate` is the machine's own `can({type:"CREATE_APP"})`, and a
 * promotion that is refused returns *here* with its issues rather than
 * destroying the stage (D23).
 *
 * **An empty section says which kind of empty it is (STA-025).** "There was
 * nothing of this kind to look for" and "Sheaf looked and found none" are
 * different claims; `ReviewEmptinessV1` keeps them different and this file
 * never collapses them into "0".
 *
 * **A nulled measurement is not a measurement of zero.** A `set-header-row`
 * edit re-derives the columns and nulls the violation counts, so those fields
 * read "not measured yet" and the needs-attention total says it is no longer
 * exact (S03; `isNeedsAttentionExact`).
 *
 * **A rejection is a stored choice, not a dismissal.** review.html: "A user's
 * rejection is represented as a stored choice in the copy, not a transient
 * close icon" — so every statement prints its disposition.
 */

const EMPTINESS: Readonly<Record<ReviewEmptinessV1, string>> = Object.freeze({
  // delimited-import.html's own words for why these sections cannot apply.
  "not-applicable-value-only":
    "CSV and TSV carry values, not workbook structure, so there was nothing of this kind to look for.",
  "none-found": "Sheaf looked and found none.",
});

const DISPOSITION: Readonly<
  Record<ReviewStatementVm["disposition"], string | null>
> = Object.freeze({
  accepted: null,
  edited: "You changed this",
  rejected: "You rejected this",
});

/** S03's closed rejection list, in the user's language (CA-16). */
const EDIT_REJECTION: Readonly<Record<ReviewEditRejectionVm, string>> =
  Object.freeze({
    "unknown-column": "That column is not part of this table.",
    "row-outside-leading-rows":
      "That row is not one of the rows Sheaf read before the table starts.",
    "empty-name": "A name cannot be empty.",
    "name-not-nfc":
      "That name is written in a form Sheaf cannot store unchanged. Retype it.",
    "duplicate-name": "Another field already has that name.",
    "not-an-enum-field": "That field is not a choice list.",
    "no-enum-options": "A choice list needs at least one choice.",
    "duplicate-enum-option": "That list has the same choice twice.",
    "too-many-enum-options": "That is more choices than a list may hold.",
    "unrecognised-rejection":
      "Sheaf refused that change and did not say which rule it broke.",
  });

/** Composed from the statement's subject and the facts it is about. */
export function describeStatement(
  statement: ReviewStatementVm,
  vm: ImportReviewVm,
): string {
  const field = vm.fields.find(
    (candidate) => candidate.columnIndex === statement.columnIndex,
  );
  const table = vm.table;

  switch (statement.subject) {
    case "app-name":
      return `This app will be called “${vm.appName}”.`;
    case "table-name":
      return `This table will be called “${table?.tableName ?? vm.appName}”.`;
    case "header-row":
      return table === null || table.headerRowIndex === null
        ? "No row looks like a header, so Sheaf named the fields itself."
        : `“${table.tableName}” starts on row ${formatCount(
            table.headerRowIndex + 1,
          )}.`;
    case "discarded-rows":
      return table === null || table.discardedRowCount === 0
        ? "Every row became a record."
        : `${formatCount(
            table.discardedRowCount,
          )} rows will not become records. They are kept and stay readable.`;
    case "field-name":
      return field === undefined
        ? "A field was named."
        : field.isNameGenerated
          ? `Column ${formatCount(
              field.columnIndex + 1,
            )} had no heading, so Sheaf named it “${field.fieldName}”.`
          : `Column ${formatCount(field.columnIndex + 1)} will be called “${
              field.fieldName
            }”.`;
    case "field-type":
      return field === undefined
        ? "A field's type was inferred."
        : `“${field.fieldName}” looks like ${describeFieldTypePhrase(
            field.type,
          )}.`;
    case "enum-options":
      return field === undefined
        ? "A choice list was inferred."
        : `“${field.fieldName}” looks like a choice with ${formatCount(
            field.enumOptions.length,
          )} options.`;
  }
}

/** Which draft a statement's Edit opens. `null` leaves no control at all. */
function draftFor(
  statement: ReviewStatementVm,
  vm: ImportReviewVm,
): ReviewEditDraftV1 | null {
  const field = vm.fields.find(
    (candidate) => candidate.columnIndex === statement.columnIndex,
  );

  switch (statement.editKind) {
    case "rename-app":
      return { kind: "rename-app", appName: vm.appName };
    case "rename-table":
      return vm.table === null
        ? null
        : { kind: "rename-table", tableName: vm.table.tableName };
    case "rename-field":
      return field === undefined
        ? null
        : {
            kind: "rename-field",
            columnIndex: field.columnIndex,
            fieldName: field.fieldName,
          };
    case "override-type":
      return field === undefined
        ? null
        : {
            kind: "override-type",
            columnIndex: field.columnIndex,
            type: field.type,
            fieldName: field.fieldName,
          };
    case "set-header-row":
      return vm.table === null
        ? null
        : {
            kind: "set-header-row",
            rowIndex: vm.table.headerRowIndex,
            leadingRows: vm.table.leadingRows,
          };
    case "edit-enum-options":
      return field === undefined
        ? null
        : {
            kind: "edit-enum-options",
            columnIndex: field.columnIndex,
            fieldName: field.fieldName,
            options: field.enumOptions.map((option) => option.label),
          };
    case null:
      return null;
  }
}

/** "2 need attention", and whether that number is still the whole story. */
export function describeNeedsAttention(vm: ImportReviewVm): string {
  if (vm.needsAttentionCount === 0) {
    return vm.isNeedsAttentionExact
      ? "Nothing needs your attention."
      : "Nothing measured needs your attention. Some fields have not been measured since you moved the header row.";
  }
  const values =
    vm.needsAttentionCount === 1
      ? "1 original value does not match its field"
      : `${formatCount(
          vm.needsAttentionCount,
        )} original values do not match their fields`;
  return vm.isNeedsAttentionExact
    ? `${values}.`
    : `${values}, and some fields have not been measured since you moved the header row.`;
}

export interface ReviewScreenProps {
  readonly vm: ImportReviewVm;
  readonly nav: SecurityNavigation;
  readonly onApplyEdit: (edit: ReviewEditIntentV1) => void;
  readonly onCreateApp: () => void;
  readonly onCancel: () => void;
  readonly topBarActions?: ReactNode;
}

export function ReviewScreen({
  vm,
  nav,
  onApplyEdit,
  onCreateApp,
  onCancel,
  topBarActions,
}: ReviewScreenProps): ReactNode {
  const [draft, setDraft] = useState<ReviewEditDraftV1 | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<ReviewStatementVm | null>(
    null,
  );

  if (vm.step === "inferring") {
    return (
      <UnlockedFrame
        announcement={vm.announcement}
        area="library"
        nav={nav}
        title="Review"
        {...(topBarActions === undefined ? {} : { topBarActions })}
      >
        <div className={cx(styles["stack"])} data-screen="SCR-023">
          <ImportStages current="review" />
          <ImportProgressRegion phase="done">
            <span className={cx(styles["lede"])}>
              Reading what this file contains.
            </span>
          </ImportProgressRegion>
          <div className={cx(styles["actions"])}>
            <Button onPress={onCancel}>Cancel import…</Button>
          </div>
        </div>
      </UnlockedFrame>
    );
  }

  const busy = vm.step === "applyingEdit" || vm.step === "promoting";

  const statementRow = (statement: ReviewStatementVm): ReactNode => {
    const sentence = describeStatement(statement, vm);
    const editDraft = draftFor(statement, vm);
    const disposition = DISPOSITION[statement.disposition];

    return (
      <li
        className={cx(styles["statement"])}
        data-statement={statement.statementId}
        key={statement.statementId}
      >
        <p className={cx(styles["statementText"])}>{sentence}</p>
        <div className={cx(styles["statementMeta"])}>
          {statement.evidence.map((evidence, index) => (
            <span
              className={cx(styles["badge"])}
              key={`${evidence.kind}-${String(index)}`}
            >
              {evidenceTag(evidence)}
            </span>
          ))}
          {disposition !== null && (
            <span className={cx(styles["badge"])}>{disposition}</span>
          )}
        </div>
        <div className={cx(styles["actions"])}>
          <Button
            onPress={() => {
              setEvidenceFor(statement);
            }}
          >
            Why?
          </Button>
          {editDraft !== null &&
            (busy ? (
              <Button
                disabledReason="Sheaf is applying your last change."
                isDisabled
              >
                Edit
              </Button>
            ) : (
              <Button
                onPress={() => {
                  setDraft(editDraft);
                }}
              >
                Edit
              </Button>
            ))}
        </div>
      </li>
    );
  };

  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="library"
      nav={nav}
      title="Review what Sheaf found"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-023">
        <ImportStages current="review" />

        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>
            One review · nothing auto-accepted
          </span>
          <h1 className={cx(styles["title"])}>Here is what Sheaf found.</h1>
          <p className={cx(styles["lede"])}>
            Read it in plain language, change anything that looks wrong, then
            create your app once.
          </p>
        </div>

        {vm.promotionIssues.length > 0 && (
          <StatusBanner title="The app was not created." tone="danger">
            {`${formatCount(
              vm.promotionIssues.length,
            )} values were refused by the rules that check every record. Nothing was written, and this review is unchanged.`}
          </StatusBanner>
        )}

        {vm.editRejection !== null && (
          <StatusBanner title="That change was not made." tone="warning">
            {EDIT_REJECTION[vm.editRejection]}
          </StatusBanner>
        )}

        <section className={cx(styles["card"])}>
          <h2 className={cx(styles["cardTitle"])}>Review summary</h2>
          <dl className={cx(styles["facts"])}>
            {vm.sections.map((section) => (
              <SummaryRow key={section.id} section={section} />
            ))}
            <dt>Needs attention</dt>
            <dd>{formatCount(vm.needsAttentionCount)}</dd>
            <dt>File</dt>
            <dd>{vm.fileName}</dd>
          </dl>
          <p className={cx(styles["note"])}>
            No durable home yet. This app will live on this device only.
          </p>
        </section>

        {vm.needsAttentionCount > 0 && (
          <StatusBanner title={describeNeedsAttention(vm)} tone="warning">
            Both the original values and Sheaf&rsquo;s reading of them are
            kept. Nothing is coerced or discarded.
          </StatusBanner>
        )}

        {vm.table !== null && (
          <TableSection
            statementRow={statementRow}
            table={vm.table}
            section={sectionById(vm.sections, "tables-and-rows")}
          />
        )}

        <section
          aria-labelledby="review-fields"
          className={cx(styles["card"])}
          data-section="fields-and-choices"
          id="fields-and-choices"
        >
          <div className={cx(styles["cardHead"])}>
            <h2 className={cx(styles["cardTitle"])} id="review-fields">
              Fields &amp; choices
            </h2>
            <span className={cx(styles["badge"])}>
              {formatCount(vm.fields.length)}
            </span>
          </div>
          {vm.fields.length === 0 ? (
            <p className={cx(styles["lede"])}>
              {EMPTINESS[
                sectionById(vm.sections, "fields-and-choices")?.emptiness ??
                  "none-found"
              ]}
            </p>
          ) : (
            <ul className={cx(styles["fields"])}>
              {vm.fields.map((field) => (
                <FieldRow
                  field={field}
                  key={field.columnIndex}
                  statementRow={statementRow}
                />
              ))}
            </ul>
          )}
        </section>

        {vm.sections
          .filter(
            (section) =>
              section.id !== "tables-and-rows" &&
              section.id !== "fields-and-choices",
          )
          .map((section) => (
            <section
              className={cx(styles["card"])}
              data-section={section.id}
              id={section.id}
              key={section.id}
            >
              <div className={cx(styles["cardHead"])}>
                <h2 className={cx(styles["cardTitle"])}>{section.label}</h2>
                <span className={cx(styles["badge"])}>
                  {formatCount(section.count)}
                </span>
              </div>
              {section.emptiness !== null && (
                <p className={cx(styles["lede"])}>
                  {EMPTINESS[section.emptiness]}
                </p>
              )}
            </section>
          ))}

        {vm.diagnostics.length > 0 && (
          <section className={cx(styles["card"])} data-section="diagnostics">
            <h2 className={cx(styles["cardTitle"])}>
              What Sheaf noticed while reading
            </h2>
            <ul className={cx(styles["steps"])}>
              {vm.diagnostics.map((diagnostic) => (
                <li key={diagnostic.code}>{describeDiagnostic(diagnostic)}</li>
              ))}
            </ul>
          </section>
        )}

        <section className={cx(styles["card"])}>
          <div className={cx(styles["cardHead"])}>
            <h2 className={cx(styles["cardTitle"])}>Ready when you are</h2>
            <span className={cx(styles["badge"])}>{vm.confirm.assurance}</span>
          </div>
          {vm.confirm.busy && (
            <ImportProgressRegion phase="done">
              <span className={cx(styles["lede"])}>
                Creating {vm.confirm.appName} on this device.
              </span>
            </ImportProgressRegion>
          )}
          <div className={cx(styles["actions"])}>
            {vm.confirm.canCreate ? (
              <Button onPress={onCreateApp} tone="primary">
                Create {vm.confirm.appName}
              </Button>
            ) : (
              <Button
                disabledReason={
                  vm.confirm.blocker === "no-fields-found"
                    ? "Sheaf found no columns in this file, so there is nothing to create an app from."
                    : "Sheaf is still working on your last change."
                }
                isDisabled
                tone="primary"
              >
                Create {vm.confirm.appName}
              </Button>
            )}
            <Button onPress={onCancel}>Cancel import…</Button>
          </div>
        </section>

        <ReviewEditDialog
          draft={draft}
          onApply={(edit) => {
            setDraft(null);
            onApplyEdit(edit);
          }}
          onCancel={() => {
            setDraft(null);
          }}
        />

        <EvidenceSheet
          evidence={evidenceFor?.evidence ?? []}
          isOpen={evidenceFor !== null}
          onClose={() => {
            setEvidenceFor(null);
          }}
          statement={
            evidenceFor === null ? "" : describeStatement(evidenceFor, vm)
          }
        />
      </div>
    </UnlockedFrame>
  );
}

function sectionById(
  sections: readonly ReviewSectionVm[],
  id: ReviewSectionVm["id"],
): ReviewSectionVm | undefined {
  return sections.find((section) => section.id === id);
}

function SummaryRow({ section }: { readonly section: ReviewSectionVm }): ReactNode {
  return (
    <>
      <dt>
        <InlineLink target={{ kind: "internal", href: `#${section.id}` }}>
          {section.label}
        </InlineLink>
      </dt>
      <dd>{formatCount(section.count)}</dd>
    </>
  );
}

function TableSection({
  section,
  statementRow,
  table,
}: {
  readonly section: ReviewSectionVm | undefined;
  readonly statementRow: (statement: ReviewStatementVm) => ReactNode;
  readonly table: ReviewTableVm;
}): ReactNode {
  return (
    <section
      className={cx(styles["card"])}
      data-section="tables-and-rows"
      id="tables-and-rows"
    >
      <div className={cx(styles["cardHead"])}>
        <h2 className={cx(styles["cardTitle"])}>
          {section?.label ?? "Tables & rows"}
        </h2>
        <span className={cx(styles["badge"])}>
          {`${formatCount(table.rowCount.value)} records`}
        </span>
      </div>
      <ul className={cx(styles["statements"])}>
        {table.statements.map(statementRow)}
      </ul>
      {table.discardedRows.length > 0 && (
        <details className={cx(styles["details"])}>
          <summary>
            {`View the ${formatCount(
              table.discardedRowCount,
            )} rows that will not become records`}
          </summary>
          <ul className={cx(styles["steps"])}>
            {table.discardedRows.map((row) => (
              <li key={row.rowIndex}>
                {`Row ${formatCount(row.rowIndex + 1)} (${
                  row.reason === "above-header"
                    ? "above the header"
                    : "empty row"
                }): ${row.cells.join(" · ")}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function FieldRow({
  field,
  statementRow,
}: {
  readonly field: ReviewFieldVm;
  readonly statementRow: (statement: ReviewStatementVm) => ReactNode;
}): ReactNode {
  return (
    <li className={cx(styles["field"])} data-field={field.columnIndex}>
      <div className={cx(styles["cardHead"])}>
        <h3 className={cx(styles["cardTitle"])}>{field.fieldName}</h3>
        <span className={cx(styles["badge"])}>
          {describeFieldType(field.type)}
        </span>
      </div>
      <dl className={cx(styles["facts"])}>
        <dt>Values that do not fit</dt>
        <dd data-violations={field.violations.kind}>
          {field.violations.kind === "measured"
            ? formatCount(field.violations.value.count)
            : // A nulled measurement is not a measurement of zero (S03).
              "Not measured yet"}
        </dd>
        {field.enumOptions.length > 0 && (
          <>
            <dt>Choices</dt>
            <dd>
              {field.enumOptions
                .map(
                  (option) =>
                    `${option.label} (${formatCount(option.occurrences)})`,
                )
                .join(", ")}
            </dd>
          </>
        )}
      </dl>
      <ul className={cx(styles["statements"])}>
        {field.statements.map(statementRow)}
      </ul>
    </li>
  );
}
