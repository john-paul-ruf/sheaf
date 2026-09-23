import { beforeAll, describe, expect, it } from "vitest";
import { textValue } from "../../../../src/domain/model/values.js";
import type { WorkbookFactV2 } from "../../../../src/import/facts/index.js";
import {
  applyWorkbookReviewEdit,
  type WorkbookReviewEditV1,
} from "../../../../src/import/inference/review-edits.js";
import { inferWorkbook } from "../../../../src/import/inference/workbook.js";
import type { ProposedWorkbookV1 } from "../../../../src/import/inference/workbook-proposal.js";
import { contextFor, DEMO, proposeFixture } from "./demo-harness.js";

let demo: ProposedWorkbookV1;
let board: ProposedWorkbookV1;

beforeAll(async () => {
  demo = await proposeFixture(DEMO, [0, 1, 2, 3, 4, 5, 6]);
  board = await proposeFixture("ooxml/multiple-regions.xlsx", [0]);
});

const applied = (proposal: ProposedWorkbookV1, edit: WorkbookReviewEditV1): ProposedWorkbookV1 => {
  const result = applyWorkbookReviewEdit(proposal, edit);
  if (result.kind !== "applied") throw new Error(`edit rejected: ${result.reason}`);
  return result.proposal;
};

const reason = (proposal: ProposedWorkbookV1, edit: WorkbookReviewEditV1) => {
  const result = applyWorkbookReviewEdit(proposal, edit);
  return result.kind === "rejected" ? result.reason : "applied";
};

const disposition = (proposal: ProposedWorkbookV1, statementId: string) =>
  proposal.statements.find((statement) => statement.statementId === statementId)?.disposition;

const field = (proposal: ProposedWorkbookV1, columnKey: string) =>
  proposal.tables.flatMap((table) => table.fields).find((candidate) => candidate.columnKey === columnKey);

const table = (proposal: ProposedWorkbookV1, tableKey: string) => proposal.tables.find((candidate) => candidate.tableKey === tableKey);

describe("applyWorkbookReviewEdit — relationships", () => {
  it("rejects a relationship, reverting the child to its value type, and restores it", () => {
    const rejected = applied(demo, { kind: "reject-relationship", relationshipKey: "rel:s3.t0.c1" });
    expect(rejected.relationships[1]?.isApplied).toBe(false);
    expect(field(rejected, "s3.t0.c1")?.type).toEqual({ kind: "text" });
    expect(disposition(rejected, "relationship:rel:s3.t0.c1")).toBe("rejected");
    expect(applied(rejected, { kind: "reject-relationship", relationshipKey: "rel:s3.t0.c1" })).toEqual(rejected);

    const restored = applied(rejected, { kind: "restore-relationship", relationshipKey: "rel:s3.t0.c1" });
    expect(field(restored, "s3.t0.c1")?.type).toEqual({ kind: "reference" });
    expect(disposition(restored, "relationship:rel:s3.t0.c1")).toBe("edited");
    // Restoring what was never rejected changes nothing.
    expect(applied(demo, { kind: "restore-relationship", relationshipKey: "rel:s0.t0.c1" })).toEqual(demo);
  });

  it("retargets only to a table the proposal holds evidence for", () => {
    const retargeted = applied(demo, { kind: "retarget-relationship", relationshipKey: "rel:s3.t0.c1", toTableKey: "s6.r0" });
    expect(retargeted.relationships[1]).toMatchObject({
      toTableKey: "s6.r0",
      toColumnKey: "s6.r0.c0",
      detectionSource: "user",
      isApplied: true,
      brokenReferenceCount: 40,
    });
    expect(disposition(retargeted, "relationship:rel:s3.t0.c1")).toBe("edited");
    expect(reason(demo, { kind: "retarget-relationship", relationshipKey: "rel:s3.t0.c1", toTableKey: "s1.t0" })).toBe("retarget-not-evidenced");
    expect(reason(demo, { kind: "retarget-relationship", relationshipKey: "rel:nope", toTableKey: "s1.t0" })).toBe("unknown-relationship");
  });

  it("keeps a parent's key while a relationship points at it", () => {
    expect(reason(demo, { kind: "set-key", tableKey: "s1.t0", columnKey: "s1.t0.c1" })).toBe("key-used-by-relationship");
    const withoutKey = applied(applied(demo, { kind: "reject-relationship", relationshipKey: "rel:s0.t0.c1" }), {
      kind: "set-key",
      tableKey: "s1.t0",
      columnKey: null,
    });
    expect(table(withoutKey, "s1.t0")?.keyColumnKey).toBeNull();
    expect(reason(withoutKey, { kind: "restore-relationship", relationshipKey: "rel:s0.t0.c1" })).toBe("parent-key-changed");
  });

  it("refuses to override a reference field's type until its relationship is rejected", () => {
    expect(reason(demo, { kind: "override-type", tableKey: "s3.t0", columnKey: "s3.t0.c1", type: { kind: "number" } })).toBe(
      "field-is-reference",
    );
  });
});

describe("applyWorkbookReviewEdit — structure", () => {
  it("splits a merged table back at its spacer and joins it again", () => {
    const split = applied(demo, { kind: "reject-statement", statementId: "table-merge:s2.r1" });
    expect(table(split, "s2.r1")?.joinedToTableKey).toBeNull();
    expect(table(split, "s2.r0")?.fields.every((entry) => entry.violations === null)).toBe(true);
    expect(table(split, "s2.r1")?.fields.map((entry) => entry.violations)).toEqual(table(demo, "s2.r1")?.fields.map((entry) => entry.violations));
    expect([table(split, "s2.r0")?.rowCount, table(split, "s2.r1")?.rowCount]).toEqual([24, 10]);
    expect(disposition(split, "table-merge:s2.r1")).toBe("rejected");

    const joined = applied(split, { kind: "restore-statement", statementId: "table-merge:s2.r1" });
    expect(table(joined, "s2.r1")?.joinedToTableKey).toBe("s2.r0");
    expect(disposition(joined, "table-merge:s2.r1")).toBe("edited");
  });

  it("joins a split only where the regions line up", () => {
    expect(reason(board, { kind: "reject-statement", statementId: "table-split:s0.r2" })).toBe("regions-not-joinable");
    expect(reason(board, { kind: "reject-statement", statementId: "table-split:s0.r1" })).toBe("regions-not-joinable");

    const facts: WorkbookFactV2[] = [
      { kind: "sheet", sheetIndex: 0, name: "Log", sheetKind: "worksheet", visibility: "visible", declaredRange: null, dateSystem: "1900" },
    ];
    const row = (rowIndex: number, cells: readonly string[]) => {
      facts.push({ kind: "row", rowIndex, cellCount: cells.length });
      cells.forEach((cell, columnIndex) => facts.push({ kind: "value", rowIndex, columnIndex, value: textValue(cell) }));
    };
    row(0, ["Site", "Crew"]);
    row(1, ["North yard", "A"]);
    row(3, ["Tool", "Owner"]);
    row(4, ["Rake", "B"]);
    const log = inferWorkbook(
      [{ kind: "batch", batchSeq: 0, facts }, { kind: "summary", rowCount: 4, columnCount: 2, valueCount: 8, batchCount: 1, diagnostics: [] }],
      contextFor("log.xlsx", null),
    );
    const joined = applied(log, { kind: "reject-statement", statementId: "table-split:s0.r1" });
    expect(table(joined, "s0.r1")?.joinedToTableKey).toBe("s0.r0");
    expect(disposition(joined, "table-split:s0.r1")).toBe("rejected");
    expect(table(applied(joined, { kind: "restore-statement", statementId: "table-split:s0.r1" }), "s0.r1")?.joinedToTableKey).toBeNull();
  });

  it("rejects and restores a sheet role, never the snapshot every sheet keeps", () => {
    const rejected = applied(demo, { kind: "reject-statement", statementId: "sheet-classification:s4.lookup" });
    expect(rejected.sheets[4]?.classification).toEqual(["table"]);
    const overview = applied(
      applied(demo, { kind: "reject-statement", statementId: "sheet-classification:s5.summary" }),
      { kind: "reject-statement", statementId: "sheet-classification:s5.chart" },
    );
    expect(overview.sheets[5]?.classification).toEqual(["snapshot"]);
    expect(applied(rejected, { kind: "restore-statement", statementId: "sheet-classification:s4.lookup" }).sheets[4]?.classification).toEqual([
      "table",
      "lookup",
    ]);
    expect(reason(demo, { kind: "reject-statement", statementId: "field-type:s0.t0.c0" })).toBe("statement-not-rejectable");
    expect(reason(demo, { kind: "reject-statement", statementId: "nope" })).toBe("unknown-statement");
  });

  it("moves a region's header row within its kept rows, as F02 does", () => {
    const moved = applied(demo, { kind: "set-header-row", regionKey: "s2.r0", rowIndex: 4 });
    const crew = table(moved, "s2.r0");
    expect(crew).toMatchObject({ headerRowIndex: 4, rowCount: 23, discardedRowCount: 4 });
    expect(crew?.fields.map((entry) => entry.fieldName)).toEqual(["Crew member 1", "Lead", "555-0210", "North"]);
    expect(crew?.fields.every((entry) => entry.violations === null)).toBe(true);
    expect(disposition(moved, "header-row:s2.r0")).toBe("edited");
    expect(moved.statements.find((statement) => statement.statementId === "discarded-rows:s2.r0")?.evidence).toHaveLength(3);

    const back = applied(moved, { kind: "set-header-row", regionKey: "s2.r0", rowIndex: 3 });
    expect(table(back, "s2.r0")).toMatchObject({ headerRowIndex: 3, rowCount: 24, discardedRowCount: 3 });
    expect(table(back, "s2.r0")?.fields.map((entry) => entry.fieldName)).toEqual(["Name", "Role", "Phone", "Crew"]);
    // Names and evidence regenerate exactly; only violations stay unmeasured.
    expect(back.statements.filter((statement) => statement.subject === "field-name")).toEqual(
      demo.statements.filter((statement) => statement.subject === "field-name"),
    );
    expect(reason(demo, { kind: "set-header-row", regionKey: "s2.r0", rowIndex: 30 })).toBe("row-outside-leading-rows");
  });
});

describe("applyWorkbookReviewEdit — names, types, keys, labels", () => {
  it("renames by key and refuses duplicates", () => {
    const renamed = applied(demo, { kind: "rename-table", tableKey: "s2.r0", tableName: " Field crew " });
    expect(table(renamed, "s2.r0")?.tableName).toBe("Field crew");
    expect(disposition(renamed, "table-name:s2.r0")).toBe("edited");
    expect(reason(demo, { kind: "rename-table", tableKey: "s2.r0", tableName: "Jobs" })).toBe("duplicate-name");
    expect(reason(demo, { kind: "rename-field", tableKey: "s0.t0", columnKey: "s0.t0.c1", fieldName: "Status" })).toBe("duplicate-name");
    expect(reason(demo, { kind: "rename-field", tableKey: "s0.t0", columnKey: "s1.t0.c1", fieldName: "X" })).toBe("unknown-column");
    expect(reason(demo, { kind: "rename-table", tableKey: "s9.t9", tableName: "X" })).toBe("unknown-table");
  });

  it("overrides a workbook date to read serials, and leaves it unmeasured", () => {
    const overridden = applied(demo, { kind: "override-type", tableKey: "s0.t0", columnKey: "s0.t0.c5", type: { kind: "date" } });
    expect(field(overridden, "s0.t0.c5")).toMatchObject({
      type: { kind: "date" },
      valueType: { kind: "date" },
      sourceFormat: { kind: "serial-date", system: "1900" },
      violations: null,
    });
  });

  it("edits enum options up to a validation list's length", () => {
    const options = ["Gravel", "Sand", "Topsoil", "Mulch", "Pavers", "Timber", "Fencing", "Seed mix", "Clay", "Stone", "Brick", "Tile", "Rebar"];
    const edited = applied(demo, { kind: "edit-enum-options", tableKey: "s0.t0", columnKey: "s0.t0.c9", options });
    expect(field(edited, "s0.t0.c9")?.enumOptions.map((option) => option.label)).toEqual(options);
    expect(reason(demo, { kind: "edit-enum-options", tableKey: "s0.t0", columnKey: "s0.t0.c0", options: ["a"] })).toBe("not-an-enum-field");
  });

  it("sets a key and a label on any column of the table", () => {
    const keyed = applied(demo, { kind: "set-key", tableKey: "s2.r0", columnKey: "s2.r0.c2" });
    expect(table(keyed, "s2.r0")?.keyColumnKey).toBe("s2.r0.c2");
    expect(disposition(keyed, "table-key:s2.r0")).toBe("edited");
    const labelled = applied(demo, { kind: "set-label", tableKey: "s0.t0", columnKey: "s0.t0.c2" });
    expect(table(labelled, "s0.t0")?.labelColumnKey).toBe("s0.t0.c2");
    expect(disposition(labelled, "table-label:s0.t0")).toBe("edited");
    expect(reason(demo, { kind: "set-label", tableKey: "s0.t0", columnKey: "s1.t0.c1" })).toBe("unknown-column");
  });
});
