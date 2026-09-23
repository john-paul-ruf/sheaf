/**
 * Rejection memory (M21; D44, FR-7): a decision the user rejected once is not
 * silently proposed again.
 *
 * A stored rejection is `${decisionKind}:${fingerprintHex}` — the projected
 * `inference_decisions` row's kind and fingerprint. A statement whose kind and
 * fingerprint match is still proposed, visibly, with disposition `rejected`
 * and `previously-rejected` evidence, and its rejection takes effect: a
 * rejected relationship leaves the child field its value type, a rejected
 * merge leaves the regions split, and so on. M21 stays digest-free — the caller
 * supplies the digest function.
 *
 * The structural effect of rejecting (and restoring) a statement lives here
 * because a stored rejection and the review edit that records one must do
 * exactly the same thing.
 */

import { deriveChartSurface } from "./charts.js";
import { deriveFormulaSurface } from "./formulas.js";
import { decisionKindOf, type WorkbookStatementV1 } from "./statements.js";
import {
  SHEET_ROLES,
  type ProposedSheetClassificationV1,
  type ProposedTableV2,
  type ProposedWorkbookV1,
  type SheetRoleV1,
} from "./workbook-proposal.js";

/** `${decisionKind}:${fingerprintHex}` of every stored rejection. */
export type RejectionMemoryV1 = ReadonlySet<string>;

/** The memory key a statement would be stored under; `null` when not projectable. */
export function rejectionMemoryKeyOf(statement: WorkbookStatementV1, fingerprintOf: (input: string) => string): string | null {
  const kind = decisionKindOf(statement.subject);
  return kind === null ? null : `${kind}:${fingerprintOf(statement.evidenceFingerprint)}`;
}

const withTables = (
  proposal: ProposedWorkbookV1,
  change: (table: ProposedTableV2) => ProposedTableV2,
): ProposedWorkbookV1 => ({ ...proposal, tables: proposal.tables.map(change) });

/** Applies or withdraws a relationship; the child field follows it. */
export function setRelationshipApplied(proposal: ProposedWorkbookV1, relationshipKey: string, isApplied: boolean): ProposedWorkbookV1 {
  const relationship = proposal.relationships.find((candidate) => candidate.relationshipKey === relationshipKey);
  if (relationship === undefined) return proposal;
  return {
    ...withTables(proposal, (table) =>
      table.tableKey !== relationship.fromTableKey
        ? table
        : {
            ...table,
            fields: table.fields.map((field) =>
              field.columnKey !== relationship.fromColumnKey
                ? field
                : { ...field, type: isApplied ? { kind: "reference" } : field.valueType },
            ),
          },
    ),
    relationships: proposal.relationships.map((candidate) =>
      candidate === relationship ? { ...candidate, isApplied } : candidate,
    ),
  };
}

const isRelated = (proposal: ProposedWorkbookV1, tableKey: string): boolean =>
  proposal.relationships.some((relationship) => relationship.fromTableKey === tableKey || relationship.toTableKey === tableKey);

/**
 * The table a region table's rows can join: the nearest earlier region table
 * on its sheet with the same columns, followed to the table it is itself part
 * of. `null` when there is none, or when either takes part in a relationship
 * (whose keys a join or split would move).
 */
export function joinTargetOf(proposal: ProposedWorkbookV1, tableKey: string): ProposedTableV2 | null {
  const index = proposal.tables.findIndex((table) => table.tableKey === tableKey);
  const table = proposal.tables[index];
  if (table === undefined || table.source.kind !== "region") return null;
  const earlier = proposal.tables
    .slice(0, index)
    .reverse()
    .find(
      (candidate) =>
        candidate.sheetKey === table.sheetKey &&
        candidate.source.kind === "region" &&
        candidate.firstColumn === table.firstColumn &&
        candidate.lastColumn === table.lastColumn,
    );
  if (earlier === undefined) return null;
  const head = proposal.tables.find((candidate) => candidate.tableKey === (earlier.joinedToTableKey ?? earlier.tableKey)) ?? null;
  return head === null || isRelated(proposal, head.tableKey) || isRelated(proposal, tableKey) ? null : head;
}

/**
 * Joins a table's rows to `joinedTo` (or splits them off with `null`). The
 * affected head's measured violations are dropped to `null`: they were counted
 * over a different set of rows, and a pure edit cannot recount.
 */
export function setJoined(proposal: ProposedWorkbookV1, tableKey: string, joinedTo: string | null): ProposedWorkbookV1 {
  const table = proposal.tables.find((candidate) => candidate.tableKey === tableKey);
  if (table === undefined || table.joinedToTableKey === joinedTo) return proposal;
  const head = joinedTo ?? table.joinedToTableKey;
  return withTables(proposal, (candidate) =>
    candidate.tableKey === tableKey
      ? { ...candidate, joinedToTableKey: joinedTo }
      : candidate.tableKey === head
        ? { ...candidate, fields: candidate.fields.map((field) => ({ ...field, violations: null })) }
        : candidate,
  );
}

/** Adds or removes one role; a sheet with no other role is a snapshot. */
export function setSheetRole(proposal: ProposedWorkbookV1, sheetKey: string, role: SheetRoleV1, isPresent: boolean): ProposedWorkbookV1 {
  return {
    ...proposal,
    sheets: proposal.sheets.map((sheet) => {
      if (sheet.sheetKey !== sheetKey || !sheet.isSelected) return sheet;
      const roles = new Set<ProposedSheetClassificationV1>(sheet.classification);
      if (isPresent) roles.add(role);
      else roles.delete(role);
      roles.delete("snapshot");
      const classification: SheetRoleV1[] = SHEET_ROLES.filter((candidate) => roles.has(candidate));
      return { ...sheet, classification: classification.length === 0 ? ["snapshot"] : classification };
    }),
  };
}

/** `s4.lookup` → the sheet key and role a classification statement is about. */
export const classificationTargetOf = (targetKey: string): { readonly sheetKey: string; readonly role: SheetRoleV1 } | null => {
  const dot = targetKey.lastIndexOf(".");
  const role = SHEET_ROLES.find((candidate) => candidate === targetKey.slice(dot + 1));
  return dot < 0 || role === undefined ? null : { sheetKey: targetKey.slice(0, dot), role };
};

/** What rejecting (`isRejected`) or restoring a statement does to the proposal's structure. */
export function statementEffect(proposal: ProposedWorkbookV1, statement: WorkbookStatementV1, isRejected: boolean): ProposedWorkbookV1 {
  const target = statement.targetKey;
  if (target === null) return proposal;
  switch (statement.subject) {
    case "relationship":
      return setRelationshipApplied(proposal, target, !isRejected);
    case "table-merge": {
      if (isRejected) return setJoined(proposal, target, null);
      const head = joinTargetOf(proposal, target);
      return head === null ? proposal : setJoined(proposal, target, head.tableKey);
    }
    case "table-split": {
      if (!isRejected) return setJoined(proposal, target, null);
      const head = joinTargetOf(proposal, target);
      return head === null ? proposal : setJoined(proposal, target, head.tableKey);
    }
    case "sheet-classification": {
      const parsed = classificationTargetOf(target);
      return parsed === null ? proposal : setSheetRole(proposal, parsed.sheetKey, parsed.role, !isRejected);
    }
    case "record-rule":
      return {
        ...proposal,
        recordRules: proposal.recordRules.map((rule) => (rule.ruleKey === target ? { ...rule, isActive: !isRejected } : rule)),
      };
    case "formula":
      // Declined, a formula's imported values stay authored literals (D51).
      return deriveFormulaSurface({
        ...proposal,
        formulas: proposal.formulas.map((formula) => (formula.formulaKey === target ? { ...formula, isActive: !isRejected } : formula)),
      });
    case "chart":
      // Declined, a chart stays the workbook's snapshot (D55).
      return deriveChartSurface({
        ...proposal,
        charts: proposal.charts.map((chart) => (chart.chartKey === target ? { ...chart, isActive: !isRejected } : chart)),
      });
    default:
      return proposal;
  }
}

/**
 * Proposes every remembered rejection as rejected, with its effect and a
 * `previously-rejected` piece of evidence (which never enters the fingerprint).
 */
export function applyRejectionMemory(
  proposal: ProposedWorkbookV1,
  memory: RejectionMemoryV1,
  fingerprintOf: (input: string) => string,
): ProposedWorkbookV1 {
  if (memory.size === 0) return proposal;
  let next = proposal;
  const rejected = new Set<string>();
  for (const statement of proposal.statements) {
    const key = rejectionMemoryKeyOf(statement, fingerprintOf);
    if (key === null || !memory.has(key)) continue;
    rejected.add(statement.statementId);
    next = statementEffect(next, statement, true);
  }
  return {
    ...next,
    statements: next.statements.map((statement) =>
      rejected.has(statement.statementId)
        ? { ...statement, disposition: "rejected", evidence: [...statement.evidence, { kind: "previously-rejected" }] }
        : statement,
    ),
  };
}
