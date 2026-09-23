import { useState, type ReactNode } from "react";
import type {
  ImportReviewVm,
  PromotionRejectionVm,
  ReviewCalculationVm,
  ReviewChartVm,
  ReviewConnectionVm,
  ReviewEmptinessV1,
  ReviewEditRejectionVm,
  ReviewFieldVm,
  ReviewRuleVm,
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
  describeEvidence,
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
 * **Formulas become live, or say why not (D49, D51, D62).** "Live
 * calculations" lists every workbook formula as review.html draws it: a live
 * one with its "Live computed value" badge, one Sheaf cannot calculate as
 * "not supported yet" with its imported results kept and "Needs attention",
 * a frozen one as frozen at import — each with its evidence (SHT-013) and a
 * reject/restore. A declined formula keeps its imported values, and says so.
 * Rebuilt charts are read with their sheet ("becomes your app dashboard").
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
  readonly calculations: ReadonlyMap<string, ReviewCalculationVm>;
  readonly charts: ReadonlyMap<string, ReviewChartVm>;
  readonly rules: ReadonlyMap<string, ReviewRuleVm>;
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
    calculations: new Map(vm.calculations.map((calculation) => [calculation.formulaKey, calculation])),
    charts: new Map(vm.charts.map((chart) => [chart.chartKey, chart])),
    rules: new Map(vm.rules.map((rule) => [rule.ruleKey, rule])),
    sheets: vm.sheets,
  };
}

/** A calculation's headline, in review.html's voice (D62). */
export function describeCalculation(calculation: ReviewCalculationVm): string {
  const name = `“${calculation.name}”`;
  if (!calculation.isActive) return `${name} keeps its imported values.`;
  switch (calculation.disposition) {
    case "live":
      return calculation.target === "computed-column"
        ? `${name} is a live calculation.`
        : calculation.target === "table-metric"
          ? `${name} is a live total of “${calculation.tableName ?? ""}”.`
          : `${name} is a live summary value.`;
    case "frozen":
      return `${name} is frozen at import.`;
    case "unsupported":
      return calculation.reason === "unsupported-function" && calculation.detail !== null
        ? `${calculation.detail} is not supported yet.`
        : `${name} cannot be calculated.`;
  }
}

/** Why, and what it means for the rows: the statement's own outcome evidence. */
function describeCalculationDetail(calculation: ReviewCalculationVm): string {
  if (!calculation.isActive) {
    return "You chose not to make it live. Its values stay as the workbook calculated them.";
  }
  const outcome = calculation.statement?.evidence.find((evidence) => evidence.kind === "formula-outcome");
  return outcome === undefined ? "" : describeEvidence(outcome);
}

/** "Quoted must be at least 0": a rule's condition in words, its values as written (CA-27). */
export function describeRule(rule: ReviewRuleVm): string {
  const valueText = (value: Extract<ReviewRuleVm["condition"], { kind: "compare" }>["value"]): string => {
    switch (value.kind) {
      case "decimal":
        return value.decimal;
      case "date":
        return new Date(value.epochDay * 86_400_000).toISOString().slice(0, 10);
      case "text":
        return `“${value.text}”`;
      case "boolean":
        return value.boolean ? "yes" : "no";
      case "invalid-preserved":
        return `“${value.sourceText}”`;
      case "missing":
      case "blank":
        return "empty";
    }
  };
  const field = `“${rule.fieldName}”`;
  const condition = rule.condition;
  const length = (measure: "text-length" | null): string => (measure === null ? "" : " characters long");
  switch (condition.kind) {
    case "compare": {
      const value = valueText(condition.value);
      const phrase = { ge: `at least ${value}`, gt: `more than ${value}`, le: `at most ${value}`, lt: `less than ${value}`, eq: value, ne: `anything but ${value}` }[
        condition.op
      ];
      return `${field} must be ${phrase}${length(condition.measure)}`;
    }
    case "between":
      return `${field} must be between ${valueText(condition.low)} and ${valueText(condition.high)}${length(condition.measure)}`;
    case "not-between":
      return `${field} must not be between ${valueText(condition.low)} and ${valueText(condition.high)}${length(condition.measure)}`;
    case "field-equals":
      return `${field} must be ${valueText(condition.value)}`;
    case "not":
      return condition.condition.kind === "field-equals"
        ? `${field} must not be ${valueText(condition.condition.value)}`
        : `${field} is checked by a workbook rule`;
  }
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
    case "formula": {
      const calculation = index.calculations.get(key);
      return calculation === undefined ? "A workbook formula was found." : describeCalculation(calculation);
    }
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
    case "record-rule": {
      // review.html: "Quoted must be at least 0 (the workbook declared this)."
      const rule = index.rules.get(key);
      return rule === undefined
        ? "A validation rule from the workbook will check every record."
        : `${describeRule(rule)} (the workbook declared this).`;
    }
    case "chart": {
      const chart = index.charts.get(key);
      const mapping = statement.evidence.find((evidence) => evidence.kind === "chart-mapping");
      const name = `“${chart?.name ?? ""}”`;
      if (chart !== undefined && !chart.isActive) return `${name} stays a snapshot of the workbook's chart.`;
      const from = mapping?.kind === "chart-mapping" ? ` from “${mapping.tableName}”` : "";
      return chart?.isPinned === true
        ? `${name} is rebuilt as a live chart${from}, pinned to the app's home.`
        : `${name} is rebuilt as a live chart${from}.`;
    }
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
      return `${name} holds summary values. Each is listed under Live calculations.`;
    case "chart":
      return `${name} holds charts. Each is rebuilt as a live chart where Sheaf can, or kept as a snapshot.`;
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

        <ReviewSection heading={describeWorkingCount(vm.calculations)} section={sectionById(vm.sections, "live-calculations")}>
          <ul className={cx(styles["fields"])}>
            {vm.calculations.map((calculation) => (
              <CalculationArticle
                actionButton={
                  calculation.statement === null
                    ? null
                    : editButton(draftFor(calculation.statement, vm, index), calculation.isActive ? "Reject…" : "Restore…")
                }
                calculation={calculation}
                key={calculation.formulaKey}
                onWhy={setEvidenceFor}
              />
            ))}
          </ul>
          {vm.formulaRegionCount > 0 && (
            <p className={cx(styles["note"])}>
              {`${describeParts("formula", vm.formulaRegionCount)} ${
                vm.formulaRegionCount === 1 ? "keeps" : "keep"
              } the workbook's values; each is listed with its sheet under Sheets & snapshots.`}
            </p>
          )}
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
              <SheetItem
                calculations={vm.calculations}
                charts={vm.charts}
                key={sheet.sheetKey}
                sheet={sheet}
                statementRow={statementRow}
              />
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

/** review.html: "Seven formulas keep working" — the live and frozen ones the review kept. */
function describeWorkingCount(calculations: readonly ReviewCalculationVm[]): string {
  const working = calculations.filter((calculation) => calculation.isActive && calculation.disposition !== "unsupported").length;
  return working === 0
    ? "No formula is calculated live"
    : working === 1
      ? "1 formula keeps working"
      : `${formatCount(working)} formulas keep working`;
}

/** One workbook formula, as review.html's Live calculations draws it. */
function CalculationArticle({
  actionButton,
  calculation,
  onWhy,
}: {
  readonly actionButton: ReactNode;
  readonly calculation: ReviewCalculationVm;
  readonly onWhy: (statement: ReviewStatementVm) => void;
}): ReactNode {
  const { statement } = calculation;
  const isLive = calculation.isActive && calculation.disposition !== "unsupported";
  const origin =
    calculation.target === "computed-column" ? "Filled-down formula" : calculation.target === "table-metric" ? "Totals row formula" : "Summary formula";
  const state = !calculation.isActive
    ? "You rejected this"
    : calculation.disposition === "live"
      ? "Live computed value"
      : calculation.disposition === "frozen"
        ? "Frozen at import"
        : "Needs attention";
  return (
    <li
      className={cx(styles["field"])}
      data-calculation={calculation.formulaKey}
      data-disposition={calculation.isActive ? calculation.disposition : "declined"}
    >
      <h3 className={cx(styles["cardTitle"])}>{describeCalculation(calculation)}</h3>
      <p className={cx(styles["lede"])}>{describeCalculationDetail(calculation)}</p>
      <p className={cx(styles["note"])}>
        {`From ${calculation.location}: `}
        <code className={cx(styles["code"])}>{`=${calculation.originalText}`}</code>
      </p>
      <div className={cx(styles["statementMeta"])}>
        <span className={cx(styles["badge"])}>{isLive ? origin : "Original formula preserved"}</span>
        <span className={cx(styles["badge"])}>{state}</span>
      </div>
      <div className={cx(styles["actions"])}>
        {actionButton}
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
  calculations,
  charts,
  sheet,
  statementRow,
}: {
  readonly calculations: readonly ReviewCalculationVm[];
  readonly charts: readonly ReviewChartVm[];
  readonly sheet: ReviewSheetVm;
  readonly statementRow: (statement: ReviewStatementVm) => ReactNode;
}): ReactNode {
  const { title, detail, tag } = describeSheet(sheet, {
    charts: charts.filter((chart) => chart.sheetKey === sheet.sheetKey && chart.isActive),
    values: calculations.filter(
      (calculation) =>
        calculation.target === "dashboard-value" && calculation.sheetName === sheet.name && calculation.isActive && calculation.disposition === "live",
    ).length,
  });
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
 * review.html's sheet lines, composed from what the import does (D39, D55,
 * D65): a chart or summary sheet whose charts or values are rebuilt live
 * "becomes your app dashboard" when they reach the app's home (its values, or
 * its charts pinned there); one that keeps only snapshots says so; and an
 * unselected sheet is excluded by the user's choice.
 */
function describeSheet(
  sheet: ReviewSheetVm,
  rebuilt: { readonly charts: readonly ReviewChartVm[]; readonly values: number },
): { title: string; detail: string; tag: string } {
  if (!sheet.isSelected) {
    return {
      title: `“${sheet.name}” is excluded by your choice`,
      detail: "It was not imported, and it remains in the source workbook Sheaf keeps.",
      tag: "Excluded",
    };
  }
  if (sheet.classification.includes("chart") || sheet.classification.includes("summary")) {
    const count = (value: number, one: string, many: string): string | null =>
      value === 0 ? null : value === 1 ? `1 ${one}` : `${formatCount(value)} ${many}`;
    const parts = [count(rebuilt.charts.length, "chart", "charts"), count(rebuilt.values, "summary value", "summary values")].filter(
      (part): part is string => part !== null,
    );
    if (parts.length === 0) {
      return {
        title: `“${sheet.name}” is kept as a snapshot`,
        detail: "Its charts and summary values are preserved as they were.",
        tag: "Read-only",
      };
    }
    const reachesHome = rebuilt.values > 0 || rebuilt.charts.some((chart) => chart.isPinned);
    return {
      title: reachesHome ? `“${sheet.name}” becomes your app dashboard` : `“${sheet.name}” is rebuilt as live charts`,
      detail: `${parts.join(" and ")} rebuilt`,
      tag: "Interactive",
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
