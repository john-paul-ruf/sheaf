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
import {
  ENUM_OPTION_LIMIT,
  fieldNamesFrom,
  type ProposedAppV1,
  type ProposedFieldV1,
  type ProposedRowV1,
} from "./infer.js";
import {
  inferenceStatement,
  statementIdOf,
  type InferenceStatementV1,
} from "./statements.js";
import type { ProposedFieldTypeV1 } from "./values.js";

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

  const renamed = fields.map((field) =>
    inferenceStatement("field-name", field.columnIndex, "rename-field", [
      headerRow === null || field.isNameGenerated
        ? { kind: "file-name", fileName: proposal.appName }
        : {
            kind: "header-text",
            rowIndex: rowIndex ?? 0,
            text: field.fieldName,
          },
    ]),
  );
  const renamedById = new Map(
    renamed.map((statement) => [statement.statementId, statement]),
  );

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
          (statement) => renamedById.get(statement.statementId) ?? statement,
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
