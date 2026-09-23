/**
 * The review screen's edits, as pure functions over a proposal (CA-16; FR-8).
 *
 * {@link applyReviewEdit} is **total**: it throws for nothing a user or a
 * malformed message can do. An edit that cannot land comes back as a rejection
 * value naming why, so a surface renders the reason instead of a crash, and a
 * worker never has to translate an exception into a wire error.
 *
 * It is also **pure**. The proposal in, the proposal out; no clock, no
 * identity, no store. That is what makes the review screen's undo trivial and
 * what lets S04 replay a sequence of edits over a staged proposal and get the
 * same answer the page had.
 *
 * Every edit marks the statement it touched `edited`, which is exactly the
 * disposition promotion writes into `inference-decision.recorded`: the review
 * screen does not have to remember what the user changed, because the proposal
 * already says.
 *
 * **What an edit deliberately does not do.** Moving the header row re-derives
 * names, discards, and the row count, but it does *not* re-infer types: a pure
 * function over the proposal has no access to the fact stream that would be
 * needed to measure them. The types stand, their measured violation counts are
 * dropped to `null` rather than left stale, and the user overrides any that are
 * now wrong — which is the same one-screen gesture they already have.
 */

import { isNfcText } from "../../domain/model/values.js";
import type { DateSystemV1 } from "../facts/index.js";
import { refreshFormulas, type FormulaIdentitiesV1 } from "./formulas.js";
import type { ProposedAppV1, ProposedFieldV1, ProposedRowV1 } from "./infer.js";
import { fieldNamesFrom, type WorkbookDiscardedRowV1 } from "./regions.js";
import {
  joinTargetOf,
  setRelationshipApplied,
  statementEffect,
} from "./rejection-memory.js";
import {
  EVIDENCE_EXAMPLE_LIMIT,
  evidenceFingerprintInput,
  inferenceStatement,
  statementIdOf,
  workbookFingerprintInput,
  workbookStatementIdOf,
  type EvidenceV1,
  type InferenceStatementV1,
  type InferenceSubjectV1,
  type WorkbookEvidenceV1,
  type WorkbookInferenceSubjectV1,
  type WorkbookStatementV1,
} from "./statements.js";
import { ENUM_OPTION_LIMIT, VALIDATION_ENUM_OPTION_LIMIT } from "./types.js";
import type { ProposedFieldTypeV1, WorkbookSourceValueFormatV1 } from "./values.js";
import type {
  ProposedTableV2,
  ProposedWorkbookFieldV1,
  ProposedWorkbookV1,
} from "./workbook-proposal.js";

export type ReviewEditV1 =
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
      readonly type: ProposedFieldTypeV1;
    }
  | { readonly kind: "set-header-row"; readonly rowIndex: number | null }
  | {
      readonly kind: "edit-enum-options";
      readonly columnIndex: number;
      readonly options: readonly string[];
    };

export const REVIEW_EDIT_REJECTIONS = Object.freeze([
  "unknown-column",
  "row-outside-leading-rows",
  "empty-name",
  "name-not-nfc",
  "duplicate-name",
  "not-an-enum-field",
  "no-enum-options",
  "duplicate-enum-option",
  "too-many-enum-options",
] as const);

export type ReviewEditRejectionV1 = (typeof REVIEW_EDIT_REJECTIONS)[number];

export type ReviewEditResultV1 =
  | { readonly kind: "applied"; readonly proposal: ProposedAppV1 }
  | { readonly kind: "rejected"; readonly reason: ReviewEditRejectionV1 };

const rejected = (reason: ReviewEditRejectionV1): ReviewEditResultV1 => ({
  kind: "rejected",
  reason,
});

/** A name the user typed: trimmed, present, and NFC like every stored text. */
const checkName = (raw: string): ReviewEditRejectionV1 | null => {
  const name = raw.trim();
  if (name === "") {
    return "empty-name";
  }
  return isNfcText(name) ? null : "name-not-nfc";
};

const markEdited = (
  statements: readonly InferenceStatementV1[],
  statementId: string,
): readonly InferenceStatementV1[] =>
  statements.map((statement) =>
    statement.statementId === statementId
      ? { ...statement, disposition: "edited" as const }
      : statement,
  );

const replaceField = (
  proposal: ProposedAppV1,
  columnIndex: number,
  change: (field: ProposedFieldV1) => ProposedFieldV1,
): ProposedAppV1 => ({
  ...proposal,
  table: {
    ...proposal.table,
    fields: proposal.table.fields.map((field) =>
      field.columnIndex === columnIndex ? change(field) : field,
    ),
  },
});

const fieldAt = (
  proposal: ProposedAppV1,
  columnIndex: number,
): ProposedFieldV1 | undefined =>
  proposal.table.fields.find((field) => field.columnIndex === columnIndex);

const isEmptyRow = (row: ProposedRowV1): boolean =>
  row.cells.every((cell) => cell === "");

/**
 * How many data rows the leading region gains or loses when the header moves.
 * Only the leading rows can change side, and every one of them is in hand, so
 * the new count stays exact rather than becoming an estimate again.
 */
const rowCountAfterHeaderMove = (
  proposal: ProposedAppV1,
  nextHeaderRowIndex: number | null,
): number => {
  const before = proposal.headerRowIndex ?? -1;
  const after = nextHeaderRowIndex ?? -1;
  const [low, high] = before < after ? [before, after] : [after, before];
  const moved = proposal.leadingRows.filter(
    (row) => row.rowIndex > low && row.rowIndex <= high && !isEmptyRow(row),
  ).length;
  return before < after ? proposal.rowCount - moved : proposal.rowCount + moved;
};

const setHeaderRow = (
  proposal: ProposedAppV1,
  rowIndex: number | null,
): ReviewEditResultV1 => {
  if (
    rowIndex !== null &&
    !proposal.leadingRows.some((row) => row.rowIndex === rowIndex)
  ) {
    return rejected("row-outside-leading-rows");
  }

  const headerRow =
    rowIndex === null
      ? null
      : (proposal.leadingRows.find((row) => row.rowIndex === rowIndex)?.cells ??
        null);
  const names = fieldNamesFrom(headerRow, proposal.table.fields.length);

  const fields = proposal.table.fields.map((field, index) => {
    const named = names[index];
    return {
      ...field,
      fieldName: named?.name ?? field.fieldName,
      isNameGenerated: named?.isGenerated ?? field.isNameGenerated,
    };
  });

  const discardedRows = proposal.leadingRows
    .filter((row) => rowIndex !== null && row.rowIndex < rowIndex)
    .map((row) => ({
      rowIndex: row.rowIndex,
      reason: "above-header" as const,
      cells: row.cells,
    }));

  // Regenerated, not left standing: a statement whose evidence still described
  // the old header would be the one thing a review screen must never show.
  const regenerated = new Map(
    fields
      .map((field) =>
        inferenceStatement("field-name", field.columnIndex, "rename-field", [
          headerRow === null || field.isNameGenerated
            ? { kind: "file-name", fileName: proposal.fileName }
            : {
                kind: "header-text",
                rowIndex: rowIndex ?? 0,
                text: field.fieldName,
              },
        ]),
      )
      .map((statement) => [statement.statementId, statement] as const),
  );
  const discardedStatementId = statementIdOf("discarded-rows", null);
  if (
    proposal.statements.some(
      (statement) => statement.statementId === discardedStatementId,
    )
  ) {
    regenerated.set(
      discardedStatementId,
      inferenceStatement(
        "discarded-rows",
        null,
        "set-header-row",
        discardedRows.slice(0, EVIDENCE_EXAMPLE_LIMIT).map((row) => ({
          kind: "row-shape" as const,
          rowIndex: row.rowIndex,
          cellCount: row.cells.length,
          valueCount: row.cells.filter((cell) => cell !== "").length,
        })),
      ),
    );
  }

  return {
    kind: "applied",
    proposal: {
      ...proposal,
      headerRowIndex: rowIndex,
      table: { ...proposal.table, fields },
      discardedRows,
      discardedRowCount: discardedRows.length,
      rowCount: rowCountAfterHeaderMove(proposal, rowIndex),
      statements: markEdited(
        proposal.statements.map(
          (statement) => regenerated.get(statement.statementId) ?? statement,
        ),
        statementIdOf("header-row", null),
      ),
    },
  };
};

/**
 * Applies one review edit. Never throws; an impossible edit is a rejection
 * value, and an applied edit returns a new proposal leaving the old untouched.
 */
export function applyReviewEdit(
  proposal: ProposedAppV1,
  edit: ReviewEditV1,
): ReviewEditResultV1 {
  switch (edit.kind) {
    case "rename-app": {
      const problem = checkName(edit.appName);
      return problem !== null
        ? rejected(problem)
        : {
            kind: "applied",
            proposal: {
              ...proposal,
              appName: edit.appName.trim(),
              statements: markEdited(
                proposal.statements,
                statementIdOf("app-name", null),
              ),
            },
          };
    }

    case "rename-table": {
      const problem = checkName(edit.tableName);
      return problem !== null
        ? rejected(problem)
        : {
            kind: "applied",
            proposal: {
              ...proposal,
              table: { ...proposal.table, tableName: edit.tableName.trim() },
              statements: markEdited(
                proposal.statements,
                statementIdOf("table-name", null),
              ),
            },
          };
    }

    case "rename-field": {
      if (fieldAt(proposal, edit.columnIndex) === undefined) {
        return rejected("unknown-column");
      }
      const problem = checkName(edit.fieldName);
      if (problem !== null) {
        return rejected(problem);
      }
      const name = edit.fieldName.trim();
      if (
        proposal.table.fields.some(
          (field) =>
            field.columnIndex !== edit.columnIndex && field.fieldName === name,
        )
      ) {
        return rejected("duplicate-name");
      }
      const next = replaceField(proposal, edit.columnIndex, (field) => ({
        ...field,
        fieldName: name,
        isNameGenerated: false,
      }));
      return {
        kind: "applied",
        proposal: {
          ...next,
          statements: markEdited(
            next.statements,
            statementIdOf("field-name", edit.columnIndex),
          ),
        },
      };
    }

    case "override-type": {
      const field = fieldAt(proposal, edit.columnIndex);
      if (field === undefined) {
        return rejected("unknown-column");
      }
      const next = replaceField(proposal, edit.columnIndex, (existing) => ({
        ...existing,
        type: edit.type,
        sourceFormat: defaultSourceFormat(edit.type),
        enumOptions: edit.type.kind === "enum" ? existing.enumOptions : [],
        // Nothing has measured the user's type against the file; promotion
        // will, and whatever does not fit is preserved and flagged (FR-6).
        violations: null,
      }));
      return {
        kind: "applied",
        proposal: {
          ...next,
          statements: markEdited(
            next.statements,
            statementIdOf("field-type", edit.columnIndex),
          ),
        },
      };
    }

    case "set-header-row":
      return setHeaderRow(proposal, edit.rowIndex);

    case "edit-enum-options": {
      const field = fieldAt(proposal, edit.columnIndex);
      if (field === undefined) {
        return rejected("unknown-column");
      }
      if (field.type.kind !== "enum") {
        return rejected("not-an-enum-field");
      }
      const labels = edit.options.map((option) => option.trim());
      if (labels.length === 0) {
        return rejected("no-enum-options");
      }
      if (labels.length > ENUM_OPTION_LIMIT) {
        return rejected("too-many-enum-options");
      }
      for (const label of labels) {
        const problem = checkName(label);
        if (problem !== null) {
          return rejected(problem);
        }
      }
      if (new Set(labels).size !== labels.length) {
        return rejected("duplicate-enum-option");
      }

      const occurrences = new Map(
        field.enumOptions.map((option) => [option.label, option.occurrences]),
      );
      const next = replaceField(proposal, edit.columnIndex, (existing) => ({
        ...existing,
        enumOptions: labels.map((label) => ({
          label,
          occurrences: occurrences.get(label) ?? 0,
        })),
      }));
      return {
        kind: "applied",
        proposal: {
          ...next,
          statements: markEdited(
            next.statements,
            statementIdOf("enum-options", edit.columnIndex),
          ),
        },
      };
    }

    default: {
      const unreachable: never = edit;
      return unreachable;
    }
  }
}

/**
 * The reading rule a user-chosen type starts from. Inference derives a format
 * from evidence; an override has none, so it gets the canonical spelling for
 * the type and the user sees the flagged values that do not fit it.
 */
export function defaultSourceFormat(
  type: ProposedFieldTypeV1,
): ProposedFieldV1["sourceFormat"] {
  switch (type.kind) {
    case "date":
      return { kind: "iso-date" };
    case "currency":
    case "number":
      return { kind: "decimal", currencySymbol: null };
    case "boolean":
      return { kind: "boolean" };
    case "enum":
      return { kind: "enum" };
    case "phone":
    case "email":
    case "url":
    case "address":
    case "text":
      return { kind: "text" };
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

// ------------------------------------------------------------ workbook (F03) --
//
// `applyWorkbookReviewEdit` is the same contract over a `ProposedWorkbookV1`:
// total, pure, idempotent, and it marks at most the one statement it names —
// `edited` for a change, `rejected` for a rejection (the disposition promotion
// writes). Targets are the proposal's stable keys, never display names. The
// F02 edit above stays exactly as pinned until S06 migrates its callers.

export type WorkbookReviewEditV1 =
  | { readonly kind: "rename-app"; readonly appName: string }
  | { readonly kind: "rename-table"; readonly tableKey: string; readonly tableName: string }
  | { readonly kind: "rename-field"; readonly tableKey: string; readonly columnKey: string; readonly fieldName: string }
  | { readonly kind: "override-type"; readonly tableKey: string; readonly columnKey: string; readonly type: ProposedFieldTypeV1 }
  /** `regionKey` is the table key of the region's table. */
  | { readonly kind: "set-header-row"; readonly regionKey: string; readonly rowIndex: number | null }
  | { readonly kind: "edit-enum-options"; readonly tableKey: string; readonly columnKey: string; readonly options: readonly string[] }
  | { readonly kind: "reject-relationship"; readonly relationshipKey: string }
  | { readonly kind: "restore-relationship"; readonly relationshipKey: string }
  | { readonly kind: "retarget-relationship"; readonly relationshipKey: string; readonly toTableKey: string }
  /** For `table-split`, `table-merge`, `sheet-classification`, `record-rule` and `formula` statements. */
  | { readonly kind: "reject-statement"; readonly statementId: string }
  | { readonly kind: "restore-statement"; readonly statementId: string }
  | { readonly kind: "set-key"; readonly tableKey: string; readonly columnKey: string | null }
  | { readonly kind: "set-label"; readonly tableKey: string; readonly columnKey: string };

/** F02's reasons, then the workbook's (append only). */
export const WORKBOOK_REVIEW_EDIT_REJECTIONS = Object.freeze([
  ...REVIEW_EDIT_REJECTIONS,
  "unknown-table",
  "unknown-relationship",
  "unknown-statement",
  "statement-not-rejectable",
  "field-is-reference",
  "retarget-not-evidenced",
  "parent-key-changed",
  "key-used-by-relationship",
  "regions-not-joinable",
] as const);

export type WorkbookReviewEditRejectionV1 = (typeof WORKBOOK_REVIEW_EDIT_REJECTIONS)[number];

export type ReviewEditResultV2 =
  | { readonly kind: "applied"; readonly proposal: ProposedWorkbookV1 }
  | { readonly kind: "rejected"; readonly reason: WorkbookReviewEditRejectionV1 };

const REJECTABLE_SUBJECTS: ReadonlySet<WorkbookInferenceSubjectV1> = new Set([
  "table-split",
  "table-merge",
  "sheet-classification",
  "record-rule",
  "formula",
]);

const refuse = (reason: WorkbookReviewEditRejectionV1): ReviewEditResultV2 => ({ kind: "rejected", reason });

const withDisposition = (
  proposal: ProposedWorkbookV1,
  statementId: string,
  disposition: WorkbookStatementV1["disposition"],
): ReviewEditResultV2 => ({
  kind: "applied",
  proposal: {
    ...proposal,
    statements: proposal.statements.map((statement) =>
      statement.statementId === statementId ? { ...statement, disposition } : statement,
    ),
  },
});

const tableOf = (proposal: ProposedWorkbookV1, tableKey: string): ProposedTableV2 | undefined =>
  proposal.tables.find((table) => table.tableKey === tableKey);

const replaceTable = (
  proposal: ProposedWorkbookV1,
  tableKey: string,
  change: (table: ProposedTableV2) => ProposedTableV2,
): ProposedWorkbookV1 => ({
  ...proposal,
  tables: proposal.tables.map((table) => (table.tableKey === tableKey ? change(table) : table)),
});

const replaceWorkbookField = (
  proposal: ProposedWorkbookV1,
  tableKey: string,
  columnKey: string,
  change: (field: ProposedWorkbookFieldV1) => ProposedWorkbookFieldV1,
): ProposedWorkbookV1 =>
  replaceTable(proposal, tableKey, (table) => ({
    ...table,
    fields: table.fields.map((field) => (field.columnKey === columnKey ? change(field) : field)),
  }));

/** The reading a user-chosen type starts from; a workbook date is a serial. */
const workbookSourceFormat = (type: ProposedFieldTypeV1, dateSystem: DateSystemV1 | null): WorkbookSourceValueFormatV1 =>
  type.kind === "date" && dateSystem !== null ? { kind: "serial-date", system: dateSystem } : defaultSourceFormat(type);

/** A fingerprint input computed as inference computes it for this proposal. */
const fingerprintFor = (
  proposal: ProposedWorkbookV1,
  table: ProposedTableV2,
  subject: InferenceSubjectV1,
  columnIndex: number | null,
  evidence: readonly WorkbookEvidenceV1[],
): string => {
  if (proposal.isDelimited) {
    return evidenceFingerprintInput(subject, columnIndex, evidence as readonly EvidenceV1[]);
  }
  const sheetName = proposal.sheets.find((sheet) => sheet.sheetKey === table.sheetKey)?.name ?? "";
  const identity = table.source.kind === "declared-table" ? table.source.name : (table.tableKey.split(".")[1] ?? "");
  return workbookFingerprintInput(subject, columnIndex === null ? [sheetName, identity] : [sheetName, identity, columnIndex], evidence);
};

const regenerated = (
  proposal: ProposedWorkbookV1,
  table: ProposedTableV2,
  subject: InferenceSubjectV1,
  columnIndex: number | null,
  editKind: WorkbookStatementV1["editKind"],
  targetKey: string,
  evidence: readonly WorkbookEvidenceV1[],
): WorkbookStatementV1 => ({
  statementId: workbookStatementIdOf(subject, targetKey),
  subject,
  editKind,
  targetKey,
  columnIndex,
  evidence,
  evidenceFingerprint: fingerprintFor(proposal, table, subject, columnIndex, evidence),
  disposition: "accepted",
});

const rowShapeOf = (row: ProposedRowV1): EvidenceV1 => ({
  kind: "row-shape",
  rowIndex: row.rowIndex,
  cellCount: row.cells.length,
  valueCount: row.cells.filter((cell) => cell !== "").length,
});

/**
 * F02's header move over one table: names, discards and the exact row count
 * are re-derived from the rows kept; types stand and their violations drop to
 * `null` (not measured); the affected statements' evidence is regenerated.
 */
const setWorkbookHeaderRow = (proposal: ProposedWorkbookV1, table: ProposedTableV2, rowIndex: number | null): ReviewEditResultV2 => {
  if (rowIndex !== null && !table.leadingRows.some((row) => row.rowIndex === rowIndex)) {
    return refuse("row-outside-leading-rows");
  }
  const headerRow = rowIndex === null ? null : (table.leadingRows.find((row) => row.rowIndex === rowIndex)?.cells ?? null);
  const names = fieldNamesFrom(headerRow, table.fields.length);
  const fields = table.fields.map((field, index) => ({
    ...field,
    fieldName: names[index]?.name ?? field.fieldName,
    isNameGenerated: names[index]?.isGenerated ?? field.isNameGenerated,
    violations: null,
  }));

  // Only the leading rows can change side, and every one of them is in hand,
  // so the new count stays exact (F02).
  const before = table.headerRowIndex ?? -1;
  const after = rowIndex ?? -1;
  const [low, high] = before < after ? [before, after] : [after, before];
  const isFilled = (row: ProposedRowV1): boolean => row.cells.some((cell) => cell !== "");
  const moving = table.leadingRows.filter((row) => row.rowIndex > low && row.rowIndex <= high);
  const moved = moving.filter(isFilled).length;
  const rowCount = before < after ? table.rowCount - moved : table.rowCount + moved;

  const kept = table.discardedRows.filter((row) => row.reason !== "above-header" && row.rowIndex > after);
  const aboveHeader: WorkbookDiscardedRowV1[] = table.leadingRows
    .filter((row) => row.rowIndex < after)
    .map((row) => ({ rowIndex: row.rowIndex, reason: "above-header", cells: row.cells }));
  const nowEmpty: WorkbookDiscardedRowV1[] = moving
    .filter((row) => before > after && !isFilled(row) && row.rowIndex > after)
    .map((row) => ({ rowIndex: row.rowIndex, reason: "empty-row", cells: row.cells }));
  const discardedRows = [...aboveHeader, ...nowEmpty, ...kept].sort((left, right) => left.rowIndex - right.rowIndex);
  const removed = table.discardedRows.length - kept.length;
  const discardedRowCount = table.discardedRowCount - removed + aboveHeader.length + nowEmpty.length;

  const next: ProposedTableV2 = { ...table, headerRowIndex: rowIndex, fields, discardedRows, discardedRowCount, rowCount };
  const declared: WorkbookEvidenceV1 | null = table.source.kind === "declared-table" ? table.source : null;
  const replacements = new Map<string, WorkbookStatementV1>();
  for (const field of fields) {
    const evidence: WorkbookEvidenceV1 =
      headerRow === null || field.isNameGenerated
        ? (declared ?? { kind: "file-name", fileName: proposal.fileName })
        : { kind: "header-text", rowIndex: rowIndex ?? 0, text: field.fieldName };
    const statement = regenerated(proposal, table, "field-name", field.columnIndex, "rename-field", field.columnKey, [evidence]);
    replacements.set(statement.statementId, statement);
  }
  const discardStatement = regenerated(
    proposal,
    table,
    "discarded-rows",
    null,
    "set-header-row",
    table.tableKey,
    discardedRows.slice(0, EVIDENCE_EXAMPLE_LIMIT).map(rowShapeOf),
  );
  const headerId = workbookStatementIdOf("header-row", table.tableKey);
  const hasDiscardStatement = proposal.statements.some((statement) => statement.statementId === discardStatement.statementId);
  const statements = proposal.statements.flatMap((statement) => {
    if (statement.statementId === headerId) {
      const marked = { ...statement, disposition: "edited" as const };
      return !hasDiscardStatement && discardedRowCount > 0 ? [marked, discardStatement] : [marked];
    }
    if (statement.statementId === discardStatement.statementId) return [discardStatement];
    return [replacements.get(statement.statementId) ?? statement];
  });
  return {
    kind: "applied",
    proposal: { ...proposal, tables: proposal.tables.map((candidate) => (candidate === table ? next : candidate)), statements },
  };
};

/**
 * Applies one workbook review edit. Never throws; an impossible edit is a
 * rejection value, and an applied edit returns a new proposal.
 *
 * `formulaIdentities` are the stand-ins the formula translation names (the
 * same kind inference was given): with them, every formula's outcome is
 * re-derived after the edit, since a relationship, a header or a join can
 * change what a formula becomes (D49). Without them outcomes stand as they were.
 */
export function applyWorkbookReviewEdit(
  proposal: ProposedWorkbookV1,
  edit: WorkbookReviewEditV1,
  formulaIdentities?: FormulaIdentitiesV1,
): ReviewEditResultV2 {
  const result = applyEdit(proposal, edit);
  return result.kind === "applied" && formulaIdentities !== undefined
    ? { kind: "applied", proposal: refreshFormulas(result.proposal, formulaIdentities) }
    : result;
}

function applyEdit(proposal: ProposedWorkbookV1, edit: WorkbookReviewEditV1): ReviewEditResultV2 {
  switch (edit.kind) {
    case "rename-app": {
      const problem = checkName(edit.appName);
      return problem !== null
        ? refuse(problem)
        : withDisposition({ ...proposal, appName: edit.appName.trim() }, workbookStatementIdOf("app-name", null), "edited");
    }

    case "rename-table": {
      if (tableOf(proposal, edit.tableKey) === undefined) return refuse("unknown-table");
      const problem = checkName(edit.tableName);
      if (problem !== null) return refuse(problem);
      const name = edit.tableName.trim();
      if (proposal.tables.some((table) => table.tableKey !== edit.tableKey && table.tableName === name)) return refuse("duplicate-name");
      return withDisposition(
        replaceTable(proposal, edit.tableKey, (table) => ({ ...table, tableName: name })),
        workbookStatementIdOf("table-name", edit.tableKey),
        "edited",
      );
    }

    case "rename-field": {
      const table = tableOf(proposal, edit.tableKey);
      if (table === undefined) return refuse("unknown-table");
      if (!table.fields.some((field) => field.columnKey === edit.columnKey)) return refuse("unknown-column");
      const problem = checkName(edit.fieldName);
      if (problem !== null) return refuse(problem);
      const name = edit.fieldName.trim();
      if (table.fields.some((field) => field.columnKey !== edit.columnKey && field.fieldName === name)) return refuse("duplicate-name");
      return withDisposition(
        replaceWorkbookField(proposal, edit.tableKey, edit.columnKey, (field) => ({ ...field, fieldName: name, isNameGenerated: false })),
        workbookStatementIdOf("field-name", edit.columnKey),
        "edited",
      );
    }

    case "override-type": {
      const table = tableOf(proposal, edit.tableKey);
      if (table === undefined) return refuse("unknown-table");
      const field = table.fields.find((candidate) => candidate.columnKey === edit.columnKey);
      if (field === undefined) return refuse("unknown-column");
      if (field.type.kind === "reference") return refuse("field-is-reference");
      const dateSystem = proposal.sheets.find((sheet) => sheet.sheetKey === table.sheetKey)?.dateSystem ?? null;
      return withDisposition(
        replaceWorkbookField(proposal, edit.tableKey, edit.columnKey, (existing) => ({
          ...existing,
          type: edit.type,
          valueType: edit.type,
          sourceFormat: workbookSourceFormat(edit.type, dateSystem),
          enumOptions: edit.type.kind === "enum" ? existing.enumOptions : [],
          violations: null,
        })),
        workbookStatementIdOf("field-type", edit.columnKey),
        "edited",
      );
    }

    case "set-header-row": {
      const table = tableOf(proposal, edit.regionKey);
      return table === undefined ? refuse("unknown-table") : setWorkbookHeaderRow(proposal, table, edit.rowIndex);
    }

    case "edit-enum-options": {
      const table = tableOf(proposal, edit.tableKey);
      if (table === undefined) return refuse("unknown-table");
      const field = table.fields.find((candidate) => candidate.columnKey === edit.columnKey);
      if (field === undefined) return refuse("unknown-column");
      if (field.type.kind !== "enum") return refuse("not-an-enum-field");
      const labels = edit.options.map((option) => option.trim());
      if (labels.length === 0) return refuse("no-enum-options");
      if (labels.length > VALIDATION_ENUM_OPTION_LIMIT) return refuse("too-many-enum-options");
      for (const label of labels) {
        const problem = checkName(label);
        if (problem !== null) return refuse(problem);
      }
      if (new Set(labels).size !== labels.length) return refuse("duplicate-enum-option");
      const occurrences = new Map(field.enumOptions.map((option) => [option.label, option.occurrences]));
      return withDisposition(
        replaceWorkbookField(proposal, edit.tableKey, edit.columnKey, (existing) => ({
          ...existing,
          enumOptions: labels.map((label) => ({ label, occurrences: occurrences.get(label) ?? 0 })),
        })),
        workbookStatementIdOf("enum-options", edit.columnKey),
        "edited",
      );
    }

    case "reject-relationship": {
      if (!proposal.relationships.some((relationship) => relationship.relationshipKey === edit.relationshipKey)) {
        return refuse("unknown-relationship");
      }
      return withDisposition(
        setRelationshipApplied(proposal, edit.relationshipKey, false),
        workbookStatementIdOf("relationship", edit.relationshipKey),
        "rejected",
      );
    }

    case "restore-relationship": {
      const relationship = proposal.relationships.find((candidate) => candidate.relationshipKey === edit.relationshipKey);
      if (relationship === undefined) return refuse("unknown-relationship");
      const statementId = workbookStatementIdOf("relationship", edit.relationshipKey);
      if (proposal.statements.find((statement) => statement.statementId === statementId)?.disposition !== "rejected") {
        return { kind: "applied", proposal };
      }
      if (tableOf(proposal, relationship.toTableKey)?.keyColumnKey !== relationship.toColumnKey) return refuse("parent-key-changed");
      return withDisposition(setRelationshipApplied(proposal, edit.relationshipKey, true), statementId, "edited");
    }

    case "retarget-relationship": {
      const relationship = proposal.relationships.find((candidate) => candidate.relationshipKey === edit.relationshipKey);
      if (relationship === undefined) return refuse("unknown-relationship");
      const candidate = relationship.candidates.find((entry) => entry.toTableKey === edit.toTableKey);
      if (candidate === undefined) return refuse("retarget-not-evidenced");
      if (tableOf(proposal, candidate.toTableKey)?.keyColumnKey !== candidate.toColumnKey) return refuse("parent-key-changed");
      const retargeted: ProposedWorkbookV1 = {
        ...proposal,
        relationships: proposal.relationships.map((entry) =>
          entry === relationship
            ? {
                ...entry,
                toTableKey: candidate.toTableKey,
                toColumnKey: candidate.toColumnKey,
                brokenReferenceCount: candidate.brokenReferenceCount,
                detectionSource: "user",
              }
            : entry,
        ),
      };
      return withDisposition(
        setRelationshipApplied(retargeted, edit.relationshipKey, true),
        workbookStatementIdOf("relationship", edit.relationshipKey),
        "edited",
      );
    }

    case "reject-statement":
    case "restore-statement": {
      const statement = proposal.statements.find((candidate) => candidate.statementId === edit.statementId);
      if (statement === undefined) return refuse("unknown-statement");
      if (!REJECTABLE_SUBJECTS.has(statement.subject)) return refuse("statement-not-rejectable");
      const isRejecting = edit.kind === "reject-statement";
      if (!isRejecting && statement.disposition !== "rejected") return { kind: "applied", proposal };
      const joins =
        (statement.subject === "table-split" && isRejecting) || (statement.subject === "table-merge" && !isRejecting);
      if (joins && statement.targetKey !== null && joinTargetOf(proposal, statement.targetKey) === null) {
        return refuse("regions-not-joinable");
      }
      return withDisposition(
        statementEffect(proposal, statement, isRejecting),
        statement.statementId,
        isRejecting ? "rejected" : "edited",
      );
    }

    case "set-key": {
      const table = tableOf(proposal, edit.tableKey);
      if (table === undefined) return refuse("unknown-table");
      if (edit.columnKey !== null && !table.fields.some((field) => field.columnKey === edit.columnKey)) return refuse("unknown-column");
      if (
        proposal.relationships.some(
          (relationship) => relationship.isApplied && relationship.toTableKey === edit.tableKey && relationship.toColumnKey !== edit.columnKey,
        )
      ) {
        return refuse("key-used-by-relationship");
      }
      return withDisposition(
        replaceTable(proposal, edit.tableKey, (existing) => ({ ...existing, keyColumnKey: edit.columnKey })),
        workbookStatementIdOf("table-key", edit.tableKey),
        "edited",
      );
    }

    case "set-label": {
      const table = tableOf(proposal, edit.tableKey);
      if (table === undefined) return refuse("unknown-table");
      if (!table.fields.some((field) => field.columnKey === edit.columnKey)) return refuse("unknown-column");
      return withDisposition(
        replaceTable(proposal, edit.tableKey, (existing) => ({ ...existing, labelColumnKey: edit.columnKey })),
        workbookStatementIdOf("table-label", edit.tableKey),
        "edited",
      );
    }

    default: {
      const unreachable: never = edit;
      return unreachable;
    }
  }
}
