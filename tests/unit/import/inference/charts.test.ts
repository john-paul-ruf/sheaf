/**
 * CA-31 (mapping leg) — an OOXML chart or pivot is rebuilt only when it maps
 * faithfully (D55); everything else stays a snapshot with `chart-not-rebuilt`.
 */

import { describe, expect, it } from "vitest";
import { applyWorkbookReviewEdit } from "../../../../src/import/inference/review-edits.js";
import type { ProposedWorkbookV1 } from "../../../../src/import/inference/workbook-proposal.js";
import { DEMO, proposeFixture } from "./demo-harness.js";

const mapped = (proposal: ProposedWorkbookV1) =>
  proposal.charts.map((chart) => [chart.chartKey, chart.location, chart.type, chart.name, chart.groupBy, chart.measure, chart.x, chart.y, chart.categoriesRepeat]);

const kept = (proposal: ProposedWorkbookV1) =>
  proposal.inertItems
    .filter((item) => item.kind === "chart" || item.kind === "pivot-table" || item.kind === "sparkline")
    .map((item) => [item.kind, item.location, item.reasonKey]);

describe("charts.xlsx — every family, and the ones that cannot be rebuilt", () => {
  it("rebuilds each single-series chart over one table and keeps the rest as snapshots", async () => {
    const proposal = await proposeFixture("ooxml/charts.xlsx", [0, 1, 2]);
    const month = { kind: "field", columnKey: "s0.r0.c0" };
    const jobs = { kind: "sum", columnKey: "s0.r0.c1" };
    expect(mapped(proposal)).toEqual([
      ["s2.chart0", "Charts!A1:H15", "bar", "Jobs by month", month, jobs, null, null, false],
      ["s2.chart2", "Charts!S1:Z15", "stacked", "Jobs by Month", month, jobs, null, null, false],
      ["s2.chart3", "Charts!A17:H31", "line", "Jobs by Month", month, jobs, null, null, false],
      ["s2.chart4", "Charts!J17:Q31", "pie", "Jobs by Month", month, jobs, null, null, false],
      // A doughnut is a pie (S02 maps the plot).
      ["s2.chart5", "Charts!S17:Z31", "pie", "Jobs by Month", month, jobs, null, null, false],
      ["s2.chart6", "Charts!A33:H47", "scatter", "Hours by rate", null, null, "s0.r0.c3", "s0.r0.c2", false],
    ]);
    // Two value series (one measure per chart, D54), an area chart, a series across two sheets.
    expect(kept(proposal)).toEqual([
      ["chart", "Charts!J1:Q15", "chart-not-rebuilt"],
      ["chart", "Charts!J33:Q47", "chart-not-rebuilt"],
      ["chart", "Charts!S33:Z47", "chart-not-rebuilt"],
    ]);
  });

  it("rebuilds a pivot as a bar of its first row field and first data field", async () => {
    const proposal = await proposeFixture("ooxml/pivot-table.xlsx", [0, 1]);
    expect(mapped(proposal)).toEqual([
      ["s1.chart0", "Summary!A3:C5", "bar", "Hours by Crew", { kind: "field", columnKey: "s0.r0.c0" }, { kind: "sum", columnKey: "s0.r0.c1" }, null, null, true],
    ]);
    expect(kept(proposal)).toEqual([]);
  });

  it("keeps a chart with no definition (an empty or refused part) as a snapshot", async () => {
    const proposal = await proposeFixture("ooxml/chartsheet.xlsx", [0, 1]);
    expect(proposal.charts).toEqual([]);
    expect(kept(proposal)).toEqual([["chart", "'Jobs chart'!A1", "chart-not-rebuilt"]]);
  });
});

describe("the demo chart (CA-31)", () => {
  it("is a bar of the summed Quoted amount by Status, with the grouping evidence (D62)", async () => {
    const proposal = await proposeFixture(DEMO, [0, 1, 2, 3, 4, 5, 6]);
    expect(proposal.statements.find((statement) => statement.statementId === "chart:s5.chart0")?.evidence).toEqual([
      { kind: "preserved-part", partKind: "chart", count: 1 },
      {
        kind: "chart-mapping",
        chartType: "bar",
        chartName: "Quoted by status",
        tableName: "Jobs",
        groupFieldName: "Status",
        measure: "sum",
        measureFieldName: "Quoted amount",
        xFieldName: null,
        yFieldName: null,
        categoriesRepeat: true,
      },
    ]);
  });

  it("declined in review, it is a snapshot again; its evidence follows a rename", async () => {
    const proposal = await proposeFixture(DEMO, [0, 1, 2, 3, 4, 5, 6]);
    const declined = applyWorkbookReviewEdit(proposal, { kind: "reject-statement", statementId: "chart:s5.chart0" });
    if (declined.kind !== "applied") throw new Error("the decline did not apply");
    expect(kept(declined.proposal)).toEqual([["chart", "Overview!D2:K18", "chart-not-rebuilt"]]);
    expect(declined.proposal.inertCounts.chart).toBe(1);

    const renamed = applyWorkbookReviewEdit(proposal, { kind: "rename-field", tableKey: "s0.t0", columnKey: "s0.t0.c3", fieldName: "Stage" });
    if (renamed.kind !== "applied") throw new Error("the rename did not apply");
    expect(renamed.proposal.statements.find((statement) => statement.statementId === "chart:s5.chart0")?.evidence.at(-1)).toMatchObject({
      groupFieldName: "Stage",
    });
  });
});
