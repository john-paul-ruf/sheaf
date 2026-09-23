/**
 * CAP-38 (inference leg) — what each imported formula becomes (D49, D51):
 * a filled-down column is a computed column, a totals row or footer is a
 * table metric, a summary tab's formulas are dashboard values; a lookup is
 * live only through an applied relationship; whatever cannot be made live
 * keeps its imported values and says why.
 */

import { describe, expect, it } from "vitest";
import { applyWorkbookReviewEdit } from "../../../../src/import/inference/review-edits.js";
import type { ProposedWorkbookV1 } from "../../../../src/import/inference/workbook-proposal.js";
import { testFormulaIdentities } from "../delimited-proposal.js";
import { inferWorkbook } from "../../../../src/import/inference/workbook.js";
import { streamWorkbookFixture } from "../../staging/workbook-streams.js";
import { DEMO, contextFor, proposeFixture } from "./demo-harness.js";

const LIVE = "ooxml/formulas-live.xlsx";

const outcomes = (proposal: ProposedWorkbookV1) =>
  proposal.formulas.map((formula) => [
    formula.formulaKey,
    formula.target.kind,
    formula.displayName,
    formula.location,
    formula.shapeMatchCount,
    formula.disposition,
    formula.determinism,
    formula.reason,
    formula.detail,
    formula.isActive,
  ]);

const applied = (proposal: ProposedWorkbookV1, edit: Parameters<typeof applyWorkbookReviewEdit>[1]): ProposedWorkbookV1 => {
  const result = applyWorkbookReviewEdit(proposal, edit, testFormulaIdentities());
  if (result.kind !== "applied") throw new Error(`edit rejected: ${result.reason}`);
  return result.proposal;
};

const formulaInert = (proposal: ProposedWorkbookV1) =>
  proposal.inertItems.filter((item) => item.kind === "formula").map((item) => [item.location, item.reasonKey]);

describe("formulas-live.xlsx — one of each disposition", () => {
  it("proposes each formula with its outcome and the reason it is kept", async () => {
    const proposal = await proposeFixture(LIVE, [0, 1, 2]);
    expect(outcomes(proposal)).toEqual([
      ["s0.t0.c3", "computed-column", null, "Jobs!D2:D6", 5, "live", "deterministic", null, null, true],
      ["s0.t0.c4", "computed-column", null, "Jobs!E2:E6", 5, "live", "clock-volatile", null, null, true],
      ["s0.t0.c5", "computed-column", null, "Jobs!F2:F6", 5, "frozen", "frozen-nondeterministic", null, null, true],
      ["s0.t0.c6", "computed-column", null, "Jobs!G2:G6", 5, "unsupported", "unsupported", "unsupported-function", "OFFSET", true],
      // Row 6 multiplies by 3, not 2: four of five rows share the shape.
      ["s0.t0.c7", "computed-column", null, "Jobs!H2:H6", 4, "unsupported", "unsupported", "not-filled-down", null, true],
      ["s0.t0.c1.R7", "table-metric", "Total Quoted", "Jobs!B7", 1, "live", "deterministic", null, null, true],
      // A cycle translates; the projection flags it and never evaluates it.
      ["s1.R1C2", "dashboard-value", "Loop A", "Summary!B1", 1, "live", "deterministic", null, null, true],
      ["s1.R2C2", "dashboard-value", "Loop B", "Summary!B2", 1, "live", "deterministic", null, null, true],
      ["s1.R3C2", "dashboard-value", "Quoted total", "Summary!B3", 1, "live", "deterministic", null, null, true],
      ["s2.r0.c1.R5", "table-metric", "Total Qty", "Stock!B5", 1, "live", "deterministic", null, null, true],
    ]);
    expect(proposal.formulas.find((formula) => formula.formulaKey === "s0.t0.c7")?.shapeBreakRowIndex).toBe(5);
    // Only what cannot be calculated stays inert, with the new reason (CA-33).
    expect(formulaInert(proposal)).toEqual([
      ["Jobs!G2:G6", "formula-not-supported"],
      ["Jobs!H2:H6", "formula-not-supported"],
    ]);
    expect(proposal.sheets.map((sheet) => sheet.classification)).toEqual([["table"], ["summary"], ["table"]]);
  });

  it("takes a totals row and a region's footer out of the records, as table metrics", async () => {
    const proposal = await proposeFixture(LIVE, [0, 1, 2]);
    const [jobs, stock] = proposal.tables;
    expect([jobs?.rowCount, jobs?.lastDataRowIndex, jobs?.discardedRows.map((row) => [row.rowIndex, row.reason])]).toEqual([
      5,
      5,
      [[6, "totals-row"]],
    ]);
    expect([stock?.rowCount, stock?.lastDataRowIndex, stock?.discardedRows.map((row) => [row.rowIndex, row.reason])]).toEqual([
      3,
      3,
      [[4, "totals-row"]],
    ]);
  });

  it("states each outcome as evidence on the formula's own statement, which the review may reject", async () => {
    const proposal = await proposeFixture(LIVE, [0, 1, 2]);
    const rate = proposal.statements.find((statement) => statement.statementId === "formula:s0.t0.c6");
    expect(rate).toMatchObject({
      subject: "formula",
      editKind: "reject-statement",
      evidence: [
        { kind: "formula-text", text: "OFFSET(B2,0,0)", formulaCount: 5 },
        { kind: "formula-outcome", target: "computed-column", disposition: "unsupported", reason: "unsupported-function", detail: "OFFSET", rowCount: 5 },
      ],
    });
  });
});

describe("the review decides, and every outcome follows", () => {
  it("a declined formula keeps its values as authored literals and says so; restoring undoes it", async () => {
    const proposal = await proposeFixture(LIVE, [0, 1, 2]);
    const declined = applied(proposal, { kind: "reject-statement", statementId: "formula:s0.t0.c3" });
    expect(declined.formulas.find((formula) => formula.formulaKey === "s0.t0.c3")?.isActive).toBe(false);
    expect(declined.statements.find((statement) => statement.statementId === "formula:s0.t0.c3")?.disposition).toBe("rejected");
    expect(formulaInert(declined)).toContainEqual(["Jobs!D2:D6", "formula-not-live-yet"]);
    expect(declined.inertCounts.formula).toBe(3);

    const restored = applied(declined, { kind: "restore-statement", statementId: "formula:s0.t0.c3" });
    expect(restored.formulas).toEqual(proposal.formulas);
    expect(formulaInert(restored)).toEqual(formulaInert(proposal));
    expect(restored.inertCounts).toEqual(proposal.inertCounts);
  });

  it("a lookup is live only through its relationship: rejecting it keeps the values, restoring makes it live (D49)", async () => {
    const proposal = await proposeFixture(DEMO, [0, 1, 2, 3, 4, 5, 6]);
    const lookup = (candidate: ProposedWorkbookV1) => candidate.formulas.find((formula) => formula.formulaKey === "s0.t0.c2");
    expect(lookup(proposal)).toMatchObject({ disposition: "live", relationshipKey: "rel:s0.t0.c1" });

    const rejected = applied(proposal, { kind: "reject-relationship", relationshipKey: "rel:s0.t0.c1" });
    expect(lookup(rejected)).toMatchObject({ disposition: "unsupported", reason: "unsupported-lookup", relationshipKey: null });
    expect(formulaInert(rejected)).toEqual([["Jobs!C2:C61", "formula-not-supported"]]);
    expect(
      rejected.statements.find((statement) => statement.statementId === "formula:s0.t0.c2")?.evidence.at(-1),
    ).toMatchObject({ kind: "formula-outcome", disposition: "unsupported", reason: "unsupported-lookup" });

    const restored = applied(rejected, { kind: "restore-relationship", relationshipKey: "rel:s0.t0.c1" });
    expect(lookup(restored)).toEqual(lookup(proposal));
    expect(formulaInert(restored)).toEqual([]);
  });

  it("the demo's lookup names the parent table it reads through", async () => {
    const proposal = await proposeFixture(DEMO, [0, 1, 2, 3, 4, 5, 6]);
    expect(
      proposal.statements.find((statement) => statement.statementId === "formula:s0.t0.c2")?.evidence.at(-1),
    ).toMatchObject({ kind: "formula-outcome", disposition: "live", relatedTableName: "Customers" });
  });
});

describe("a formula whose text cannot be read", () => {
  it("is never proposed (migration 005 keeps no formula without text); its values stay, and say so", async () => {
    const stream = await streamWorkbookFixture("biff/formulas.xls", {});
    if (stream === null) throw new Error("formulas.xls did not size");
    const proposal = inferWorkbook(stream.items, contextFor("formulas.xls", null));
    expect(proposal.formulas.every((formula) => formula.originalText !== "")).toBe(true);
    // The two undecodable cells are the adapter's own preserved parts, listed once; the array formula is kept.
    expect(formulaInert(proposal)).toEqual([
      ["Calc!A3", "formula-not-live-yet"],
      ["Calc!B3", "formula-not-live-yet"],
      ["Calc!A2", "formula-not-supported"],
    ]);
  });
});
