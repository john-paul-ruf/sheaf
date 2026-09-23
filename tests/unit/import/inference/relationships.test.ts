import { describe, expect, it } from "vitest";
import { decimalValue, textValue } from "../../../../src/domain/model/values.js";
import type { WorkbookFactStreamItemV2, WorkbookFactV2 } from "../../../../src/import/facts/index.js";
import { chooseKey, isIdentifierHeading } from "../../../../src/import/inference/keys.js";
import { rejectionMemoryKeyOf } from "../../../../src/import/inference/rejection-memory.js";
import { containmentOf, KEY_MATCH_CONTAINMENT, KEY_MATCH_MINIMUM_VALUES } from "../../../../src/import/inference/relationships.js";
import { KEY_SKETCH_LIMIT, newStats, observe } from "../../../../src/import/inference/types.js";
import { inferWorkbook } from "../../../../src/import/inference/workbook.js";
import type { ProposedWorkbookV1 } from "../../../../src/import/inference/workbook-proposal.js";
import { contextFor, DEMO, fakeFingerprint, proposeFixture } from "./demo-harness.js";

const ALL = [0, 1, 2, 3, 4, 5, 6];

const statementOf = (proposal: ProposedWorkbookV1, statementId: string) => {
  const found = proposal.statements.find((candidate) => candidate.statementId === statementId);
  if (found === undefined) throw new Error(`no statement ${statementId}`);
  return found;
};

const fieldAt = (proposal: ProposedWorkbookV1, columnKey: string) =>
  proposal.tables.flatMap((table) => table.fields).find((field) => field.columnKey === columnKey);

describe("CAP-22 — keys, labels and relationships on the demo workbook", () => {
  it("takes the lookup formula as the primary signal and a key match as the secondary", async () => {
    const proposal = await proposeFixture(DEMO, ALL);
    expect(
      proposal.relationships.map((relationship) => ({
        key: relationship.relationshipKey,
        from: relationship.fromColumnKey,
        to: relationship.toColumnKey,
        source: relationship.detectionSource,
        broken: relationship.brokenReferenceCount,
      })),
    ).toEqual([
      { key: "rel:s0.t0.c1", from: "s0.t0.c1", to: "s1.t0.c0", source: "lookup-formula", broken: 1 },
      { key: "rel:s3.t0.c1", from: "s3.t0.c1", to: "s0.t0.c0", source: "key-match", broken: 0 },
    ]);
    expect(statementOf(proposal, "relationship:rel:s0.t0.c1").evidence).toEqual([
      {
        kind: "lookup-formula",
        functionName: "VLOOKUP",
        formulaText: "VLOOKUP(B2,Customers!A:B,2,FALSE)",
        parentSheetName: "Customers",
        parentTableName: "Customers",
        parentColumnName: "Customer ID",
        outcome: "relationship",
      },
    ]);
    expect(statementOf(proposal, "relationship:rel:s3.t0.c1").evidence).toEqual([
      { kind: "key-match", parentTableName: "Jobs", parentColumnName: "Job ID", matched: 40, measured: 40, isSampled: false },
    ]);

    // Jobs.Customer ID is a reference field; its value type stays text.
    expect(fieldAt(proposal, "s0.t0.c1")).toMatchObject({ fieldName: "Customer ID", type: { kind: "reference" }, valueType: { kind: "text" } });
    expect(fieldAt(proposal, "s3.t0.c1")).toMatchObject({ fieldName: "Job ID", type: { kind: "reference" } });
    expect(proposal.tables.map((table) => [table.tableName, table.keyColumnKey, table.labelColumnKey])).toEqual([
      ["Jobs", "s0.t0.c0", "s0.t0.c0"],
      ["Customers", "s1.t0.c0", "s1.t0.c1"],
      ["Crew", null, "s2.r0.c0"],
      ["Crew 2", null, "s2.r1.c0"],
      ["Visits", "s3.t0.c0", "s3.t0.c0"],
      ["Materials", null, "s4.r0.c0"],
      ["Archive 2018", "s6.r0.c0", "s6.r0.c0"],
    ]);
  });

  it("classifies Materials as a lookup and Overview as summary + chart, listing its inert content", async () => {
    const proposal = await proposeFixture(DEMO, ALL);
    expect(proposal.sheets.map((sheet) => [sheet.name, sheet.classification])).toEqual([
      ["Jobs", ["table"]],
      ["Customers", ["table"]],
      ["Crew", ["table"]],
      ["Visits", ["table"]],
      ["Materials", ["table", "lookup"]],
      ["Overview", ["summary", "chart"]],
      ["Archive 2018", ["table"]],
    ]);
    expect(proposal.inertItems.filter((item) => item.sheetKey === "s5").map((item) => [item.kind, item.location, item.reasonKey])).toEqual([
      ["drawing", "Overview!D20:F24", "visual-only"],
      ["drawing", "Overview!H20:J24", "visual-only"],
      ["chart", "Overview!D2:K18", "chart-not-live-yet"],
      ["cell-styling", "Overview", "formatting-not-reproduced"],
      ["formula", "Overview!B3:B6", "formula-not-live-yet"],
    ]);
    expect(proposal.inertItems.filter((item) => item.kind === "formula").map((item) => item.location)).toEqual([
      "Jobs!C2:C61",
      "Jobs!G2:G61",
      "Overview!B3:B6",
    ]);
    expect(proposal.inertCounts).toMatchObject({ formula: 3, chart: 1, drawing: 2, "cell-styling": 7, "unsupported-validation": 0 });
    expect(statementOf(proposal, "sheet-classification:s5.chart").evidence).toEqual([{ kind: "preserved-part", partKind: "chart", count: 1 }]);
    expect(statementOf(proposal, "sheet-classification:s4.lookup")).toMatchObject({ editKind: "reject-statement", evidence: [{ kind: "validation-rule", rule: "list" }] });
  });

  it("lists an unselected sheet as excluded and nothing more (D39)", async () => {
    const proposal = await proposeFixture(DEMO, [0, 1, 2, 3, 4, 5]);
    expect(proposal.sheets.at(-1)).toEqual({
      sheetKey: "s6",
      sheetIndex: 6,
      name: "Archive 2018",
      sheetKind: "worksheet",
      visibility: "visible",
      isSelected: false,
      classification: ["excluded"],
      declaredRange: null,
      dateSystem: null,
      rowCount: null,
      usedCellCount: null,
      formulaCellCount: null,
      omittedRegionCount: 0,
    });
    expect(proposal.tables.some((table) => table.sheetKey === "s6")).toBe(false);
    expect(proposal.inertItems.some((item) => item.sheetKey === "s6")).toBe(false);
    // Archive was only a heading-match candidate for Visits; without it, only Jobs is.
    expect(proposal.relationships[1]?.candidates.map((candidate) => candidate.toTableKey)).toEqual(["s0.t0"]);
  });

  it("proposes a remembered rejection rejected, and leaves Visits.Job ID its value type (D44)", async () => {
    const fresh = await proposeFixture(DEMO, ALL);
    const key = rejectionMemoryKeyOf(statementOf(fresh, "relationship:rel:s3.t0.c1"), fakeFingerprint);
    expect(key).toMatch(/^relationship:[0-9a-f]{8}$/);

    const remembered = await proposeFixture(DEMO, ALL, new Set([key as string]));
    expect(statementOf(remembered, "relationship:rel:s3.t0.c1")).toMatchObject({
      disposition: "rejected",
      evidence: [{ kind: "key-match" }, { kind: "previously-rejected" }],
      evidenceFingerprint: statementOf(fresh, "relationship:rel:s3.t0.c1").evidenceFingerprint,
    });
    expect(remembered.relationships[1]).toMatchObject({ relationshipKey: "rel:s3.t0.c1", isApplied: false });
    expect(fieldAt(remembered, "s3.t0.c1")).toMatchObject({ type: { kind: "text" }, valueType: { kind: "text" } });
    // Nothing else moved.
    expect(statementOf(remembered, "relationship:rel:s0.t0.c1").disposition).toBe("accepted");
    expect(fieldAt(remembered, "s0.t0.c1")?.type).toEqual({ kind: "reference" });
  });

  it("never lets a non-projectable statement or an unknown memory key reject anything", async () => {
    const fresh = await proposeFixture(DEMO, ALL);
    expect(rejectionMemoryKeyOf(statementOf(fresh, "table-name:s0.t0"), fakeFingerprint)).toBeNull();
    const untouched = await proposeFixture(DEMO, ALL, new Set(["relationship:00000000", "column-type:ffffffff"]));
    expect(untouched.statements.every((entry) => entry.disposition === "accepted")).toBe(true);
  });

  it("gives every projectable statement a unique fingerprint input", async () => {
    const proposal = await proposeFixture(DEMO, ALL);
    const projectable = proposal.statements.filter((entry) => rejectionMemoryKeyOf(entry, (input) => input) !== null);
    const keys = projectable.map((entry) => rejectionMemoryKeyOf(entry, (input) => input));
    expect(new Set(keys).size).toBe(projectable.length);
  });
});

/** A two-sheet workbook: Orders looks up Clients' second column by code. */
const lookupWorkbook = (numberHeading: string, codeHeading: string): WorkbookFactStreamItemV2[] => {
  const facts: WorkbookFactV2[] = [];
  const sheet = (name: string, sheetIndex: number) =>
    facts.push({ kind: "sheet", sheetIndex, name, sheetKind: "worksheet", visibility: "visible", declaredRange: null, dateSystem: "1900" });
  const row = (rowIndex: number, cells: readonly string[], formula: string | null = null) => {
    facts.push({ kind: "row", rowIndex, cellCount: cells.length });
    cells.forEach((cell, columnIndex) => {
      if (formula !== null && columnIndex === cells.length - 1) {
        facts.push({ kind: "formula", rowIndex, columnIndex, text: formula, sharedGroup: null, isArray: false, isExternal: false });
      }
      facts.push({ kind: "value", rowIndex, columnIndex, value: /^\d+$/.test(cell) ? decimalValue(cell) : textValue(cell) });
    });
  };
  sheet("Orders", 0);
  row(0, ["Order", "Client code", "Client"]);
  for (let index = 1; index <= 9; index += 1) row(index, [`O-${index}`, `K${index % 3}`, `Client ${index % 3}`], `VLOOKUP(B${index + 1},Clients!B:C,2,FALSE)`);
  sheet("Clients", 1);
  row(0, [numberHeading, codeHeading, "Name"]);
  for (let index = 0; index < 3; index += 1) row(index + 1, [String(100 + index), `K${index}`, `Client ${index}`]);
  return [
    { kind: "batch", batchSeq: 0, facts },
    { kind: "summary", rowCount: 14, columnCount: 3, valueCount: 42, batchCount: 1, diagnostics: [] },
  ];
};

describe("relationship rules", () => {
  it("proposes nothing when the parent is keyed on another column, and says why", () => {
    const proposal = inferWorkbook(lookupWorkbook("Client No", "Code"), contextFor("orders.xlsx", null));
    expect(proposal.tables.map((table) => table.keyColumnKey)).toEqual([null, "s1.r0.c0"]);
    expect(proposal.relationships).toEqual([]);
    expect(statementOf(proposal, "field-type:s0.r0.c1").evidence.at(-1)).toEqual({
      kind: "lookup-formula",
      functionName: "VLOOKUP",
      formulaText: "VLOOKUP(B2,Clients!B:C,2,FALSE)",
      parentSheetName: "Clients",
      parentTableName: "Clients",
      parentColumnName: "Code",
      outcome: "parent-key-differs",
    });
  });

  it("lets the lookup's parent column become the parent's key when the parent has none", () => {
    const proposal = inferWorkbook(lookupWorkbook("Number", "Handle"), contextFor("orders.xlsx", null));
    expect(proposal.tables[1]?.keyColumnKey).toBe("s1.r0.c1");
    expect(proposal.relationships).toMatchObject([
      { fromColumnKey: "s0.r0.c1", toColumnKey: "s1.r0.c1", detectionSource: "lookup-formula", brokenReferenceCount: 0 },
    ]);
  });

  it("recognises identifier headings as whole words only", () => {
    for (const heading of ["ID", "Job Id", "Code", "Item No", "key", "PO #", "SKU-code"]) expect(isIdentifierHeading(heading), heading).toBe(true);
    for (const heading of ["Idea", "Notes", "Keyboard", "Barcode", "Nothing"]) expect(isIdentifierHeading(heading), heading).toBe(false);
  });

  it("never proposes a key it has not measured unique and complete", () => {
    const column = (values: readonly string[], limit = KEY_SKETCH_LIMIT) => {
      const stats = newStats(limit, null);
      values.forEach((value, index) => observe(stats, index, value));
      return { columnKey: "k", fieldName: "Code", type: { kind: "text" } as const, stats };
    };
    expect(chooseKey([column(["a", "b", "c"])], 3)?.columnKey).toBe("k");
    expect(chooseKey([column(["a", "b", "b"])], 3)).toBeNull();
    expect(chooseKey([column(["a", "b"])], 3)).toBeNull();
    expect(chooseKey([column(["a", "b", "c"], 2)], 3)).toBeNull();
  });

  it("measures containment on the sketch and says when it was sampled", () => {
    const parent = newStats(KEY_SKETCH_LIMIT, null);
    const child = newStats(4, null);
    for (const value of ["a", "b", "c", "d"]) observe(parent, 0, value);
    for (const value of ["a", "b", "b", "c", "x", "y"]) observe(child, 0, value);
    expect(containmentOf(child, parent)).toEqual({ matched: 4, measured: 5, broken: 1, isSampled: true });
    expect([KEY_MATCH_CONTAINMENT, KEY_MATCH_MINIMUM_VALUES, KEY_SKETCH_LIMIT]).toEqual([0.98, 8, 10_000]);
  });
});
