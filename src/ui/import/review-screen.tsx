import { useState, type ReactNode } from "react";
import type {
  ImportReviewVm,
  PromotionRejectionVm,
  ReviewConnectionVm,
  ReviewEmptinessV1,
  ReviewEditRejectionVm,
  ReviewFieldVm,
  ReviewSectionVm,
  ReviewSheetVm,
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
import {
  EvidenceSheet,
  INERT_REASON,
  describeDiagnostic,
  describeParts,
  evidenceTag,
} from "./review-evidence.js";
import styles from "./import.module.css";

/**
 * SCR-023 — the one review (review.html, CAP-12, CAP-22, FR-4–FR-9).
 *
 * **One route, anchored sections, no wizard.** design.md §Import and review:
 * "The review screen is one route with anchored sections, not a dismissible
 * wizard whose later steps can be accidentally skipped." The summary links
 * into the sections; nothing here advances a step.
 *
 * **Nothing is accepted until "Create app".** The button is the only accept,
 * `confirm.canCreate` is the machine's own `can({type:"CREATE_APP"})`, and a
 * promotion that is refused returns *here* with its issues rather than
 * destroying the stage (D23). Every edit round-trips through the stage.
 *
 * **An empty section says which kind of empty it is (STA-025).** "There was
 * nothing of this kind to look for" and "Sheaf looked and found none" are
 * different claims, and a delimited file keeps F02's exact sentences.
 *
 * **A rejection is a stored choice, not a dismissal.** review.html: "A user's
 * rejection is represented as a stored choice in the copy, not a transient
 * close icon" — a rejected connection stays on the page, saying so.
 *
 * **Formulas are preserved, not live (D33, D43).** The "Live calculations"
 * section keeps review.html's label and its "Original formula preserved" tag,
 * and says what is true in F03: imported results are kept as values and the
 * formula is not recalculated yet. No sentence here says a formula keeps
 * working.
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

/** S02's closed rejection list, in the user's language (CA-19). */
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
    "unknown-table": "That table is not part of this review.",
    "unknown-relationship": "That connection is not part of this review.",
    "unknown-statement": "That finding is not part of this review.",
    "statement-not-rejectable": "That finding cannot be rejected on its own. Change it instead.",
    "field-is-reference": "That field is a connection. Change the connection instead.",
    "retarget-not-evidenced": "Nothing in the workbook points that column at that table.",
    "parent-key-changed": "The table it pointed at no longer has that key.",
    "key-used-by-relationship": "A connection uses that key. Change the connection first.",
    "regions-not-joinable": "Those two parts of the sheet cannot be one table.",
    "unrecognised-rejection":
      "Sheaf refused that change and did not say which rule it broke.",
  });

/**
 * A refused promotion, by its closed token (D23, D42). The append-too-large
 * sentence is composed from D38's fact — one commit, one segment — and names
 * the way out that does work (D43).
 */
const PROMOTION_REJECTION: Readonly<Record<PromotionRejectionVm, { readonly title: string; readonly body: string }>> =
  Object.freeze({
    "schema-invalid": {
      title: "The app was not created.",
      body: "The tables and fields as reviewed do not form a valid app. Nothing was written, and this review is unchanged.",
    },
    "record-invalid": {
      title: "The app was not created.",
      body: "Some values were refused by the rules that check every record. Nothing was written, and this review is unchanged.",
    },
    "no-proposal": {
      title: "The app was not created.",
      body: "There is no reviewed proposal to create an app from. Nothing was written.",
    },
    "empty-table": {
      title: "The app was not created.",
      body: "A table in this review has no fields, so there is nothing to create. Nothing was written.",
    },
    "append-too-large": {
      title: "The table was not added.",
      body: "This file has more rows than one addition to an app can hold, so nothing was written and this review is unchanged. It can be imported as a new app instead.",
    },
    "unrecognised-rejection": {
      title: "The app was not created.",
      body: "Sheaf refused to create it and did not say why. Nothing was written, and this review is unchanged.",
    },
  });

/** Every table, field, connection and sheet the review names, by key. */
interface ReviewIndexV1 {
  readonly tables: ReadonlyMap<string, ReviewTableVm>;
  readonly joinedHead: ReadonlyMap<string, ReviewTableVm>;
  readonly fields: ReadonlyMap<string, ReviewFieldVm>;
  readonly connections: ReadonlyMap<string, ReviewConnectionVm>;
  readonly sheets: readonly ReviewSheetVm[];
}

function indexOf(vm: ImportReviewVm): ReviewIndexV1 {
  return {
    tables: new Map(vm.tables.map((table) => [table.tableKey, table])),
    joinedHead: new Map(
      vm.tables.flatMap((table) => table.joined.map((joined) => [joined.tableKey, table] as const)),
    ),
    fields: new Map(vm.tables.flatMap((table) => table.fields.map((field) => [field.columnKey, field] as const))),
    connections: new Map(vm.connections.map((connection) => [connection.relationshipKey, connection])),
    sheets: vm.sheets,
  };
}

/** review.html's plain connection sentence, composed from the table names (CA-19). */
export function describeConnection(connection: ReviewConnectionVm): string {
  return connection.isApplied
    ? `Each record in “${connection.fromTableName}” belongs to one record in “${connection.toTableName}”.`
    : `You chose not to connect “${connection.fromTableName}” to “${connection.toTableName}”.`;
}

function describeConnectionDetail(connection: ReviewConnectionVm): string {
  if (!connection.isApplied) {
    return `“${connection.fromFieldName}” stays a column of its own values. Change the connection to restore it.`;
  }
  const shown =
    connection.toLabelFieldName === null ? "the linked record" : `its “${connection.toLabelFieldName}”`;
  return `Each “${connection.toTableName}” record will list its “${connection.fromTableName}” records, and each “${connection.fromTableName}” record will show ${shown} instead of the raw “${connection.fromFieldName}”.`;
}

/** Composed from the statement's subject and the facts it is about. */
export function describeStatement(
  statement: ReviewStatementVm,
  vm: ImportReviewVm,
  index: ReviewIndexV1 = indexOf(vm),
): string {
  const key = statement.targetKey ?? "";
  const field = index.fields.get(key);
  const table = index.tables.get(key) ?? index.joinedHead.get(key);

  switch (statement.subject) {
    case "app-name":
      return `This app will be called “${vm.appName}”.`;
    case "table-name":
      return `This table will be called “${table?.tableName ?? vm.appName}”.`;
    case "header-row":
      return table === undefined || table.headerRowIndex === null
        ? "No row looks like a header, so Sheaf named the fields itself."
        : `“${table.tableName}” starts on row ${formatCount(table.headerRowIndex + 1)}.`;
    case "discarded-rows":
      return table === undefined || table.discardedRowCount === 0
        ? "Every row became a record."
        : `${formatCount(table.discardedRowCount)} rows will not become records. They are kept and stay readable.`;
    case "field-name":
      return field === undefined
        ? "A field was named."
        : field.isNameGenerated
          ? `Column ${formatCount(field.columnIndex + 1)} had no heading, so Sheaf named it “${field.fieldName}”.`
          : `Column ${formatCount(field.columnIndex + 1)} will be called “${field.fieldName}”.`;
    case "field-type":
      return field === undefined
        ? "A field's type was inferred."
        : `“${field.fieldName}” looks like ${describeFieldTypePhrase(field.type)}.`;
    case "enum-options":
      return field === undefined
        ? "A choice list was inferred."
        : `“${field.fieldName}” looks like a choice with ${formatCount(field.enumOptions.length)} options.`;
    case "formula":
      return field === undefined
        ? "A column came from a formula. Its imported results are kept as values."
        : `“${field.fieldName}” came from a formula. Its imported results are kept as values.`;
    case "table-merge":
      return table === undefined
        ? "Two parts of a sheet look like one list."
        : `“${table.tableName}” looks like one list, even with a blank row.`;
    case "table-split":
      return table === undefined
        ? "Part of a sheet looks like a table of its own."
        : `“${table.tableName}” looks like a table of its own, set apart by blank space.`;
    case "table-key":
      return table === undefined
        ? "A column identifies each record."
        : table.keyFieldName === null
          ? `No column identifies a record in “${table.tableName}”.`
          : `“${table.keyFieldName}” identifies each record in “${table.tableName}”.`;
    case "table-label":
      return table === undefined || table.labelFieldName === null
        ? "A column names each record."
        : `Records in “${table.tableName}” are named by “${table.labelFieldName}”.`;
    case "relationship": {
      const connection = index.connections.get(key);
      return connection === undefined ? "Two tables look connected." : describeConnection(connection);
    }
    case "sheet-classification":
      return describeClassification(key, index.sheets);
    case "record-rule":
      return "A validation rule from the workbook will check every record.";
  }
}

/** A classification statement targets `<sheetKey>.<classification>` (S02). */
function describeClassification(targetKey: string, sheets: readonly ReviewSheetVm[]): string {
  const cut = targetKey.lastIndexOf(".");
  const sheet = sheets.find((candidate) => candidate.sheetKey === targetKey.slice(0, cut));
  const name = sheet === undefined ? "This sheet" : `“${sheet.name}”`;
  switch (targetKey.slice(cut + 1)) {
    case "lookup":
      return `${name} supplies choice values.`;
    case "summary":
      return `${name} holds summary values. They are kept as a snapshot.`;
    case "chart":
      return `${name} holds a chart. It is kept as a snapshot; rebuilt as a live chart in a later release.`;
    case "snapshot":
      return `${name} is kept as a read-only snapshot.`;
    default:
      return `${name} becomes a working table.`;
  }
}

/** Which draft a statement's Edit opens. `null` leaves no control at all. */
function draftFor(
  statement: ReviewStatementVm,
  vm: ImportReviewVm,
  index: ReviewIndexV1,
): ReviewEditDraftV1 | null {
  const key = statement.targetKey ?? "";
  const field = index.fields.get(key);
  const table = index.tables.get(key);
  const fieldChoices = (owner: ReviewTableVm) =>
    owner.fields.map((candidate) => ({ columnKey: candidate.columnKey, fieldName: candidate.fieldName }));

  switch (statement.editKind) {
    case "rename-app":
      return { kind: "rename-app", appName: vm.appName };
    case "rename-table":
      return table === undefined ? null : { kind: "rename-table", tableKey: table.tableKey, tableName: table.tableName };
    case "rename-field":
      return field === undefined
        ? null
        : { kind: "rename-field", tableKey: field.tableKey, columnKey: field.columnKey, fieldName: field.fieldName };
    case "override-type":
      return field === undefined
        ? null
        : {
            kind: "override-type",
            tableKey: field.tableKey,
            columnKey: field.columnKey,
            type: field.valueType,
            fieldName: field.fieldName,
          };
    case "set-header-row":
      return table === undefined
        ? null
        : {
            kind: "set-header-row",
            regionKey: table.tableKey,
            rowIndex: table.headerRowIndex,
            leadingRows: table.leadingRows,
          };
    case "edit-enum-options":
      return field === undefined
        ? null
        : {
            kind: "edit-enum-options",
            tableKey: field.tableKey,
            columnKey: field.columnKey,
            fieldName: field.fieldName,
            options: field.enumOptions.map((option) => option.label),
          };
    case "set-key":
      return table === undefined
        ? null
        : {
            kind: "set-key",
            tableKey: table.tableKey,
            tableName: table.tableName,
            columnKey: table.fields.find((candidate) => candidate.fieldName === table.keyFieldName)?.columnKey ?? null,
            fields: fieldChoices(table),
          };
    case "set-label":
      return table === undefined
        ? null
        : {
            kind: "set-label",
            tableKey: table.tableKey,
            tableName: table.tableName,
            columnKey: table.fields.find((candidate) => candidate.fieldName === table.labelFieldName)?.columnKey ?? null,
            fields: fieldChoices(table),
          };
    case "reject-relationship":
    case "restore-relationship":
    case "retarget-relationship": {
      const connection = index.connections.get(key);
      return connection === undefined ? null : connectionDraft(connection);
    }
    case "reject-statement":
    case "restore-statement":
      return {
        kind: "reject-or-restore",
        statementId: statement.statementId,
        isRejected: statement.disposition === "rejected",
        sentence: describeStatement(statement, vm, index),
      };
    case null:
      return null;
  }
}

function connectionDraft(connection: ReviewConnectionVm): ReviewEditDraftV1 {
  return {
    kind: "change-connection",
    relationshipKey: connection.relationshipKey,
    isApplied: connection.isApplied,
    fromTableName: connection.fromTableName,
    toTableName: connection.toTableName,
    retargets: connection.retargets,
  };
}

/** "2 need attention", and whether that number is still the whole story. */
export function describeNeedsAttention(vm: ImportReviewVm): string {
  if (vm.needsAttentionCount === 0) {
    return vm.isNeedsAttentionExact
      ? "Nothing needs your attention."
      : "Nothing measured needs your attention. Some fields have not been measured since you moved the header row.";
  }
  const values = vm.needsAttentionCount - vm.brokenReferenceCount;
  const parts: string[] = [];
  if (values > 0) {
    parts.push(
      values === 1
        ? "1 original value does not match its field"
        : `${formatCount(values)} original values do not match their fields`,
    );
  }
  if (vm.brokenReferenceCount > 0) {
    parts.push(
      vm.brokenReferenceCount === 1
        ? "1 reference matches no record"
        : `${formatCount(vm.brokenReferenceCount)} references match no record`,
    );
  }
  const joined = parts.join(", and ");
  return vm.isNeedsAttentionExact
    ? `${joined}.`
    : `${joined}, and some fields have not been measured since you moved the header row.`;
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
  const index = indexOf(vm);
  const multiTable = vm.tables.length > 1;

  const editButton = (editDraft: ReviewEditDraftV1 | null, label = "Edit"): ReactNode =>
    editDraft === null ? null : busy ? (
      <Button disabledReason="Sheaf is applying your last change." isDisabled>
        {label}
      </Button>
    ) : (
      <Button
        onPress={() => {
          setDraft(editDraft);
        }}
      >
        {label}
      </Button>
    );

  const statementRow = (statement: ReviewStatementVm): ReactNode => {
    const disposition = DISPOSITION[statement.disposition];
    return (
      <li
        className={cx(styles["statement"])}
        data-statement={statement.statementId}
        key={statement.statementId}
      >
        <p className={cx(styles["statementText"])}>{describeStatement(statement, vm, index)}</p>
        <div className={cx(styles["statementMeta"])}>
          {statement.evidence.map((evidence, position) => (
            <span
              className={cx(styles["badge"])}
              key={`${evidence.kind}-${String(position)}`}
            >
              {evidenceTag(evidence, vm.isExcelWorkbook)}
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
          {editButton(draftFor(statement, vm, index))}
        </div>
      </li>
    );
  };

  const rejection = vm.promotionRejection === null ? null : PROMOTION_REJECTION[vm.promotionRejection];
  const createLabel =
    vm.confirm.kind === "add-table"
      ? `Add “${vm.confirm.tableName ?? ""}” to ${vm.confirm.appName}`
      : `Create ${vm.confirm.appName}`;

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

        {rejection !== null && (
          <StatusBanner title={rejection.title} tone="danger">
            {rejection.body}
            {vm.promotionIssues.length > 0 && (
              <ul className={cx(styles["steps"])} data-promotion-issues="">
                {vm.promotionIssues.map((group) => (
                  <li key={`${group.fieldId ?? "record"}-${group.token}`}>
                    {group.fieldId === null
                      ? `A whole record: ${group.sentence}`
                      : `${
                          group.fieldName === null
                            ? "One field"
                            : `“${group.fieldName}” in “${group.tableName ?? vm.appName}”`
                        }, ${group.count === 1 ? "1 value" : `${formatCount(group.count)} values`}: ${group.sentence}`}
                  </li>
                ))}
              </ul>
            )}
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
          {vm.confirm.kind === "create-app" && (
            <p className={cx(styles["note"])}>
              No durable home yet. This app will live on this device only.
            </p>
          )}
        </section>

        {vm.needsAttentionCount > 0 && (
          <StatusBanner title={describeNeedsAttention(vm)} tone="warning">
            Both the original values and Sheaf&rsquo;s reading of them are
            kept. Nothing is coerced or discarded.
          </StatusBanner>
        )}

        <ReviewSection section={sectionById(vm.sections, "tables-and-rows")}>
          <ul className={cx(styles["fields"])}>
            {vm.tables.map((table) => (
              <TableArticle key={table.tableKey} statementRow={statementRow} table={table} />
            ))}
          </ul>
        </ReviewSection>

        <ReviewSection section={sectionById(vm.sections, "fields-and-choices")}>
          {vm.tables.map((table) => (
            <div className={cx(styles["stack"])} key={table.tableKey}>
              {multiTable && <h3 className={cx(styles["cardTitle"])}>{table.tableName}</h3>}
              <ul className={cx(styles["fields"])}>
                {table.fields.map((field) => (
                  <FieldRow field={field} key={field.columnKey} statementRow={statementRow} />
                ))}
              </ul>
            </div>
          ))}
        </ReviewSection>

        <ReviewSection section={sectionById(vm.sections, "connections")}>
          <ul className={cx(styles["fields"])}>
            {vm.connections.map((connection) => (
              <ConnectionArticle
                changeButton={editButton(connectionDraft(connection), "Change connection")}
                connection={connection}
                isExcel={vm.isExcelWorkbook}
                key={connection.relationshipKey}
                onWhy={setEvidenceFor}
              />
            ))}
          </ul>
        </ReviewSection>

        <ReviewSection
          heading="Formulas are preserved, not live yet"
          section={sectionById(vm.sections, "live-calculations")}
        >
          <ul className={cx(styles["fields"])}>
            {vm.calculations.map((calculation) => (
              <li className={cx(styles["field"])} key={`${calculation.tableName}-${calculation.fieldName}`}>
                <h3 className={cx(styles["cardTitle"])}>
                  {`“${calculation.fieldName}” in “${calculation.tableName}” came from a formula.`}
                </h3>
                <p className={cx(styles["lede"])}>
                  Its imported results are kept as values, and the original formula{" "}
                  <code className={cx(styles["code"])}>{calculation.formulaText}</code> is preserved. Sheaf does not
                  recalculate it yet.
                </p>
                <div className={cx(styles["statementMeta"])}>
                  <span className={cx(styles["badge"])}>Original formula preserved</span>
                </div>
              </li>
            ))}
          </ul>
          <p className={cx(styles["note"])}>
            {`${describeParts("formula", vm.formulaRegionCount)} are preserved in all; each is listed with its sheet under Sheets & snapshots.`}
          </p>
        </ReviewSection>

        <ReviewSection
          badge={
            vm.isDelimited
              ? null
              : `${formatCount(vm.sheets.length)} of ${formatCount(vm.sheets.length)} preserved`
          }
          heading="Nothing was silently dropped"
          section={sectionById(vm.sections, "sheets-and-snapshots")}
        >
          <ul className={cx(styles["fields"])}>
            {vm.sheets.map((sheet) => (
              <SheetItem key={sheet.sheetKey} sheet={sheet} statementRow={statementRow} />
            ))}
          </ul>
        </ReviewSection>

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
                {vm.confirm.kind === "add-table"
                  ? `Adding the table to ${vm.confirm.appName} on this device.`
                  : `Creating ${vm.confirm.appName} on this device.`}
              </span>
            </ImportProgressRegion>
          )}
          <div className={cx(styles["actions"])}>
            {vm.confirm.canCreate ? (
              <Button onPress={onCreateApp} tone="primary">
                {createLabel}
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
                {createLabel}
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
          isExcel={vm.isExcelWorkbook}
          isOpen={evidenceFor !== null}
          onClose={() => {
            setEvidenceFor(null);
          }}
          statement={
            evidenceFor === null ? "" : describeStatement(evidenceFor, vm, index)
          }
        />
      </div>
    </UnlockedFrame>
  );
}

function sectionById(
  sections: readonly ReviewSectionVm[],
  id: ReviewSectionVm["id"],
): ReviewSectionVm {
  return sections.find((section) => section.id === id) ?? { id, label: id, count: 0, emptiness: "none-found" };
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

/** One anchored section: its label, its count, and what is in it or why nothing is. */
function ReviewSection({
  section,
  heading,
  badge,
  children,
}: {
  readonly section: ReviewSectionVm;
  readonly heading?: string;
  readonly badge?: string | null;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section
      aria-labelledby={`${section.id}-title`}
      className={cx(styles["card"])}
      data-section={section.id}
      id={section.id}
    >
      <div className={cx(styles["cardHead"])}>
        <div className={cx(styles["intro"])}>
          {heading !== undefined && section.emptiness === null && (
            <span className={cx(styles["extensions"])}>{section.label}</span>
          )}
          <h2 className={cx(styles["cardTitle"])} id={`${section.id}-title`}>
            {heading !== undefined && section.emptiness === null ? heading : section.label}
          </h2>
        </div>
        <span className={cx(styles["badge"])}>{badge ?? formatCount(section.count)}</span>
      </div>
      {section.emptiness === null ? (
        children
      ) : (
        <p className={cx(styles["lede"])}>{EMPTINESS[section.emptiness]}</p>
      )}
    </section>
  );
}

function TableArticle({
  statementRow,
  table,
}: {
  readonly statementRow: (statement: ReviewStatementVm) => ReactNode;
  readonly table: ReviewTableVm;
}): ReactNode {
  return (
    <li className={cx(styles["field"])} data-table={table.tableKey}>
      <div className={cx(styles["cardHead"])}>
        <h3 className={cx(styles["cardTitle"])}>{table.tableName}</h3>
        <span className={cx(styles["badge"])}>
          {table.rowCount.value === 1 ? "1 record" : `${formatCount(table.rowCount.value)} records`}
        </span>
      </div>
      {table.declaredTableName !== null && (
        <div className={cx(styles["statementMeta"])}>
          <span className={cx(styles["badge"])}>Workbook declared table</span>
        </div>
      )}
      <ul className={cx(styles["statements"])}>
        {table.statements.map(statementRow)}
        {table.joined.flatMap((joined) => joined.statements.map(statementRow))}
      </ul>
      {table.discardedRows.length > 0 && (
        <details className={cx(styles["details"])}>
          <summary>View preserved rows</summary>
          <ul className={cx(styles["steps"])}>
            {table.discardedRows.map((row) => (
              <li key={row.rowIndex}>
                {`Row ${formatCount(row.rowIndex + 1)} (${
                  row.reason === "above-header"
                    ? "above the header"
                    : row.reason === "totals-row"
                      ? "totals row"
                      : "empty row"
                }): ${row.cells.join(" · ")}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
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

const SIGNAL: Readonly<Record<ReviewConnectionVm["detectionSource"], string>> = Object.freeze({
  "lookup-formula": "Your lookup formula",
  "key-match": "Matching IDs",
  user: "Your choice",
});

function ConnectionArticle({
  connection,
  changeButton,
  isExcel,
  onWhy,
}: {
  readonly connection: ReviewConnectionVm;
  readonly changeButton: ReactNode;
  readonly isExcel: boolean;
  readonly onWhy: (statement: ReviewStatementVm) => void;
}): ReactNode {
  const { statement } = connection;
  const signal = statement?.evidence.find(
    (evidence) => evidence.kind === "lookup-formula" || evidence.kind === "key-match",
  );
  return (
    <li
      className={cx(styles["field"])}
      data-connection={connection.relationshipKey}
      data-applied={String(connection.isApplied)}
    >
      <h3 className={cx(styles["cardTitle"])}>{describeConnection(connection)}</h3>
      <p className={cx(styles["lede"])}>{describeConnectionDetail(connection)}</p>
      {connection.isApplied && connection.brokenReferenceCount > 0 && (
        <p className={cx(styles["note"])}>
          {`${formatCount(connection.brokenReferenceCount)} “${connection.fromFieldName}” ${
            connection.brokenReferenceCount === 1 ? "key matches" : "keys match"
          } no record in “${connection.toTableName}”. They are kept and flagged.`}
        </p>
      )}
      <div className={cx(styles["statementMeta"])}>
        <span className={cx(styles["badge"])}>
          {signal === undefined ? SIGNAL[connection.detectionSource] : evidenceTag(signal, isExcel)}
        </span>
        <span className={cx(styles["badge"])}>{`${connection.fromTableName} → ${connection.toTableName}`}</span>
        <span className={cx(styles["badge"])}>{connection.fromFieldName}</span>
        {!connection.isApplied && <span className={cx(styles["badge"])}>You rejected this</span>}
      </div>
      <div className={cx(styles["actions"])}>
        {changeButton}
        {statement !== null && (
          <Button
            onPress={() => {
              onWhy(statement);
            }}
          >
            Why?
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * One sheet: what it becomes, the classification statements behind that, and
 * every preserved-but-inert item on it (STA-012: type, location, reason).
 * The snapshot a link would open does not exist until the app does, so the
 * item names the snapshot it will be kept in instead of offering a link.
 */
function SheetItem({
  sheet,
  statementRow,
}: {
  readonly sheet: ReviewSheetVm;
  readonly statementRow: (statement: ReviewStatementVm) => ReactNode;
}): ReactNode {
  const { title, detail, tag } = describeSheet(sheet);
  const groups = new Map<string, { kind: ReviewSheetVm["inertItems"][number]["kind"]; reasonKey: ReviewSheetVm["inertItems"][number]["reasonKey"]; locations: string[] }>();
  for (const item of sheet.inertItems) {
    const key = `${item.kind}|${item.reasonKey}`;
    const group = groups.get(key) ?? { kind: item.kind, reasonKey: item.reasonKey, locations: [] };
    group.locations.push(item.location);
    groups.set(key, group);
  }
  return (
    <li className={cx(styles["field"])} data-sheet={sheet.sheetKey}>
      <div className={cx(styles["cardHead"])}>
        <h3 className={cx(styles["cardTitle"])}>{title}</h3>
        <span className={cx(styles["badge"])}>{tag}</span>
      </div>
      <p className={cx(styles["lede"])}>{detail}</p>
      {sheet.statements.length > 0 && (
        <ul className={cx(styles["statements"])}>{sheet.statements.map(statementRow)}</ul>
      )}
      {groups.size > 0 && (
        <ul className={cx(styles["steps"])} data-inert="">
          {[...groups.values()].map((group) => (
            <li key={`${group.kind}-${group.reasonKey}`}>
              {`${describeParts(group.kind, group.locations.length)} kept in “${sheet.name}” (${group.locations.join(", ")}). ${INERT_REASON[group.reasonKey]}`}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * review.html's sheet lines, composed for what F03 actually does (D39, D43,
 * D45): a chart or summary sheet is kept as a snapshot and is not rebuilt yet,
 * and an unselected sheet is excluded by the user's choice.
 */
function describeSheet(sheet: ReviewSheetVm): { title: string; detail: string; tag: string } {
  if (!sheet.isSelected) {
    return {
      title: `“${sheet.name}” is excluded by your choice`,
      detail: "It was not imported, and it remains in the source workbook Sheaf keeps.",
      tag: "Excluded",
    };
  }
  if (sheet.classification.includes("chart") || sheet.classification.includes("summary")) {
    return {
      title: `“${sheet.name}” is kept as a snapshot`,
      detail: "Its charts and summary values are preserved as they were; rebuilt as a live chart in a later release.",
      tag: "Read-only",
    };
  }
  if (sheet.classification.includes("lookup")) {
    return {
      title: `“${sheet.name}” supplies choice values`,
      detail: "Also remains available as a working table and snapshot.",
      tag: "Interactive",
    };
  }
  if (sheet.classification.includes("table")) {
    return {
      title: `“${sheet.name}” becomes a working table`,
      detail: "Also kept as a read-only snapshot.",
      tag: "Interactive",
    };
  }
  return {
    title: `“${sheet.name}” is kept as a snapshot`,
    detail: "Its cells are preserved as they were.",
    tag: "Read-only",
  };
}
