import { describe, expect, it } from "vitest";
import {
  DECISION_KINDS,
  SHEET_CLASSIFICATIONS,
  type DecisionKindV1,
  type SheetClassificationV1,
} from "../../../../src/domain/model/snapshots.js";
import {
  decisionKindOf,
  INFERENCE_DECISION_KINDS,
  INFERENCE_SUBJECTS,
  REVIEW_EDIT_KINDS,
  WORKBOOK_INFERENCE_SUBJECTS,
  WORKBOOK_REVIEW_EDIT_KINDS,
  workbookFingerprintInput,
  type InferenceDecisionKindV1,
} from "../../../../src/import/inference/statements.js";
import { SHEET_ROLES, type SheetRoleV1 } from "../../../../src/import/inference/workbook-proposal.js";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameDecisionKinds: Same<InferenceDecisionKindV1, DecisionKindV1> = true;
const sameRoles: Same<SheetRoleV1, SheetClassificationV1> = true;

describe("CA-19 — the decision-kind mapping", () => {
  it("restates migration 005's decision kinds and sheet roles member for member", () => {
    expect([...INFERENCE_DECISION_KINDS]).toEqual([...DECISION_KINDS]);
    expect([...SHEET_ROLES]).toEqual([...SHEET_CLASSIFICATIONS]);
    expect([sameDecisionKinds, sameRoles]).toEqual([true, true]);
  });

  it("maps every subject exactly as SESSION-02's table says", () => {
    expect(Object.fromEntries(WORKBOOK_INFERENCE_SUBJECTS.map((subject) => [subject, decisionKindOf(subject)]))).toEqual({
      "app-name": null,
      "table-name": null,
      "header-row": "header",
      "discarded-rows": "discarded-row",
      "field-name": null,
      "field-type": "column-type",
      "enum-options": "enum",
      "table-split": "table-split",
      "table-merge": "table-merge",
      relationship: "relationship",
      formula: "formula",
      "sheet-classification": "sheet-classification",
      "record-rule": "record-rule",
      "table-key": null,
      "table-label": null,
    });
    // Total: every projectable kind is reached by exactly one subject.
    const reached = WORKBOOK_INFERENCE_SUBJECTS.map(decisionKindOf).filter((kind) => kind !== null);
    expect([...reached].sort()).toEqual([...DECISION_KINDS].sort());
  });

  it("keeps the F02 vocabularies as a prefix, unchanged", () => {
    expect(WORKBOOK_INFERENCE_SUBJECTS.slice(0, INFERENCE_SUBJECTS.length)).toEqual([...INFERENCE_SUBJECTS]);
    expect(WORKBOOK_REVIEW_EDIT_KINDS.slice(0, REVIEW_EDIT_KINDS.length)).toEqual([...REVIEW_EDIT_KINDS]);
  });

  it("fingerprints what a decision is about, never how much was seen or a stored rejection", () => {
    const format = { kind: "number-format", numberFormat: "0.00", formatClass: "number", currencySymbol: null } as const;
    expect(workbookFingerprintInput("field-type", ["Jobs", "JobsTable", 4], [{ ...format, matched: 3, sampled: 4 }])).toBe(
      workbookFingerprintInput("field-type", ["Jobs", "JobsTable", 4], [{ ...format, matched: 3000, sampled: 4000 }]),
    );
    expect(workbookFingerprintInput("relationship", ["Visits", "VisitsTable", 1], [{ kind: "previously-rejected" }])).toBe(
      workbookFingerprintInput("relationship", ["Visits", "VisitsTable", 1], []),
    );
    expect(workbookFingerprintInput("field-type", ["Jobs", "JobsTable", 4], [{ ...format, matched: 1, sampled: 1 }])).not.toBe(
      workbookFingerprintInput("field-type", ["Jobs", "JobsTable", 5], [{ ...format, matched: 1, sampled: 1 }]),
    );
  });
});
