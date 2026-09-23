import { describe, expect, it } from "vitest";
import { decimalValue, textValue } from "../../../../src/domain/model/values.js";
import type { WorkbookFactStreamItemV2, WorkbookFactV2 } from "../../../../src/import/facts/index.js";
import { inferProposal } from "../../../../src/import/inference/infer.js";
import { sourceTextToCellValue } from "../../../../src/import/inference/values.js";
import { inferWorkbook } from "../../../../src/import/inference/workbook.js";
import type { ProposedTableV2, ProposedWorkbookV1 } from "../../../../src/import/inference/workbook-proposal.js";
import { parseFixture } from "../parse-harness.js";
import { contextFor, DEMO, parseWorkbook, proposeFixture } from "./demo-harness.js";

const ALL = [0, 1, 2, 3, 4, 5, 6];

const tableNamed = (proposal: ProposedWorkbookV1, name: string): ProposedTableV2 => {
  const table = proposal.tables.find((candidate) => candidate.tableName === name);
  if (table === undefined) throw new Error(`no table ${name}`);
  return table;
};

const fieldNamed = (table: ProposedTableV2, name: string) => {
  const field = table.fields.find((candidate) => candidate.fieldName === name);
  if (field === undefined) throw new Error(`no field ${name}`);
  return field;
};

const statement = (proposal: ProposedWorkbookV1, statementId: string) => {
  const found = proposal.statements.find((candidate) => candidate.statementId === statementId);
  if (found === undefined) throw new Error(`no statement ${statementId}`);
  return found;
};

/** A one-sheet V2 stream from hand-written facts, in batches of 1024. */
const stream = (facts: readonly WorkbookFactV2[]): WorkbookFactStreamItemV2[] => [
  { kind: "batch", batchSeq: 0, facts },
  {
    kind: "summary",
    rowCount: facts.filter((fact) => fact.kind === "row").length,
    columnCount: Math.max(0, ...facts.map((fact) => (fact.kind === "row" ? fact.cellCount : 0))),
    valueCount: facts.filter((fact) => fact.kind === "value").length,
    batchCount: 1,
    diagnostics: [],
  },
];

const sheetFact = (name: string, sheetIndex = 0): WorkbookFactV2 => ({
  kind: "sheet",
  sheetIndex,
  name,
  sheetKind: "worksheet",
  visibility: "visible",
  declaredRange: null,
  dateSystem: "1900",
});

const rowFacts = (rowIndex: number, cells: readonly (string | number | null)[]): WorkbookFactV2[] => [
  { kind: "row", rowIndex, cellCount: cells.length },
  ...cells.flatMap((cell, columnIndex): WorkbookFactV2[] =>
    cell === null
      ? []
      : [{ kind: "value", rowIndex, columnIndex, value: typeof cell === "number" ? decimalValue(String(cell)) : textValue(cell) }],
  ),
];

describe("inferWorkbook — the demo workbook's structure", () => {
  it("keeps Crew as one table across its spacer, discarding the three title rows", async () => {
    const proposal = await proposeFixture(DEMO, ALL);
    const crew = proposal.tables.filter((table) => table.sheetKey === "s2");
    expect(crew.map((table) => [table.tableKey, table.joinedToTableKey, table.headerRowIndex, table.rowCount])).toEqual([
      ["s2.r0", null, 3, 24],
      ["s2.r1", "s2.r0", 29, 10],
    ]);
    const head = crew[0] as ProposedTableV2;
    expect(head.discardedRows.map((row) => [row.rowIndex, row.reason])).toEqual([
      [0, "above-header"],
      [1, "above-header"],
      [2, "above-header"],
    ]);
    expect(statement(proposal, "table-merge:s2.r1")).toMatchObject({
      subject: "table-merge",
      editKind: "reject-statement",
      disposition: "accepted",
      evidence: [{ kind: "matching-headings", headings: ["Name", "Role", "Phone", "Crew"], rowIndex: 29 }],
    });
    // One table promoted: the merged head measures both regions' values.
    expect(fieldNamed(head, "Role").enumOptions.reduce((sum, option) => sum + option.occurrences, 0)).toBe(34);
  });

  it("types Jobs from its declarations before its values", async () => {
    const proposal = await proposeFixture(DEMO, ALL);
    const jobs = tableNamed(proposal, "Jobs");
    expect(jobs.source).toEqual({
      kind: "declared-table",
      name: "JobsTable",
      range: { firstRow: 0, firstColumn: 0, lastRow: 60, lastColumn: 9 },
      headerRowCount: 1,
      totalsRowCount: 0,
    });

    const status = fieldNamed(jobs, "Status");
    expect(status).toMatchObject({ type: { kind: "enum" }, sourceFormat: { kind: "enum" }, violations: { count: 0 } });
    expect(status.enumOptions.map((option) => option.label)).toEqual(["Scheduled", "In progress", "Waiting", "Complete"]);
    expect(statement(proposal, `field-type:${status.columnKey}`).evidence).toEqual([
      {
        kind: "validation-rule",
        rule: "list",
        operator: null,
        listSource: { kind: "inline", values: ["Scheduled", "In progress", "Waiting", "Complete"] },
        formula1: '"Scheduled,In progress,Waiting,Complete"',
        formula2: null,
        listOptions: ["Scheduled", "In progress", "Waiting", "Complete"],
      },
    ]);

    const quoted = fieldNamed(jobs, "Quoted amount");
    expect(quoted).toMatchObject({
      type: { kind: "currency", currencyCode: "USD" },
      sourceFormat: { kind: "decimal", currencySymbol: null },
      violations: {
        count: 2,
        examples: [
          { rowIndex: 8, sourceText: "TBD" },
          { rowIndex: 30, sourceText: "TBD" },
        ],
      },
    });
    expect(statement(proposal, `field-type:${quoted.columnKey}`).evidence).toEqual([
      { kind: "number-format", numberFormat: '"$"#,##0.00', formatClass: "currency", currencySymbol: "$", matched: 58, sampled: 60 },
      { kind: "value-conflict", count: 2, examples: quoted.violations?.examples },
    ]);

    // The Material list lives on another sheet; its options are read from there.
    expect(fieldNamed(jobs, "Material").enumOptions.map((option) => option.label)).toEqual([
      "Gravel", "Sand", "Topsoil", "Mulch", "Pavers", "Timber", "Fencing", "Seed mix",
    ]);
    const due = fieldNamed(jobs, "Due date");
    expect(due).toMatchObject({ type: { kind: "date" }, sourceFormat: { kind: "serial-date", system: "1900" } });
    expect(fieldNamed(jobs, "Approved").type).toEqual({ kind: "boolean" });
  });

  it("keeps formula columns authored, typed from cached values, with a formula statement", async () => {
    const proposal = await proposeFixture(DEMO, ALL);
    const jobs = tableNamed(proposal, "Jobs");
    const balance = fieldNamed(jobs, "Balance");
    expect(balance).toMatchObject({
      type: { kind: "currency", currencyCode: "USD" },
      formulaText: "E2-F2",
      violations: { count: 2 },
    });
    expect(statement(proposal, `formula:${balance.columnKey}`)).toMatchObject({
      subject: "formula",
      evidence: [{ kind: "formula-text", text: "E2-F2", isArray: false, isExternal: false, formulaCount: 60 }],
    });
    expect(fieldNamed(jobs, "Customer")).toMatchObject({ type: { kind: "text" }, formulaText: "VLOOKUP(B2,Customers!A:B,2,FALSE)" });
  });

  it("converts serial dates with the one converter promotion reuses", async () => {
    const proposal = await proposeFixture(DEMO, ALL);
    const due = fieldNamed(tableNamed(proposal, "Jobs"), "Due date");
    const typing = { type: due.valueType, sourceFormat: due.sourceFormat, enumOptions: [] };
    expect(sourceTextToCellValue("45203", typing)).toEqual({ kind: "value", value: { kind: "date", epochDay: 45203 - 25569 } });
    expect(sourceTextToCellValue("45203.5", typing)).toEqual({ kind: "value", value: { kind: "invalid-preserved", sourceText: "45203.5" } });
    expect(sourceTextToCellValue("60", typing)).toEqual({ kind: "value", value: { kind: "invalid-preserved", sourceText: "60" } });
    expect(sourceTextToCellValue("59", typing)).toEqual({ kind: "value", value: { kind: "date", epochDay: -25509 } });
    expect(
      sourceTextToCellValue("0", { ...typing, sourceFormat: { kind: "serial-date", system: "1904" } }),
    ).toEqual({ kind: "value", value: { kind: "date", epochDay: -24107 } });
  });
});

describe("inferWorkbook — regions", () => {
  it("splits side-by-side and stacked regions, naming the gap", async () => {
    const proposal = await proposeFixture("ooxml/multiple-regions.xlsx", [0]);
    expect(proposal.tables.map((table) => [table.tableKey, table.tableName, table.firstColumn, table.lastColumn, table.rowCount])).toEqual([
      ["s0.r0", "Board 1", 0, 2, 3],
      ["s0.r1", "Board 2", 5, 6, 2],
      ["s0.r2", "Board 3", 0, 1, 2],
    ]);
    expect(statement(proposal, "table-split:s0.r1").evidence).toEqual([
      { kind: "column-gap", afterColumnIndex: 2, beforeColumnIndex: 5 },
    ]);
    expect(statement(proposal, "table-split:s0.r2").evidence).toEqual([
      { kind: "blank-row-gap", afterRowIndex: 3, beforeRowIndex: 7 },
    ]);
  });

  it("proposes no table from a region without a heading row", () => {
    const proposal = inferWorkbook(
      stream([sheetFact("Notes"), ...rowFacts(0, ["Fieldwork overview"]), ...rowFacts(2, ["Open jobs", 4]), ...rowFacts(3, ["Paid", 12])]),
      contextFor("notes.xlsx", null),
    );
    expect(proposal.tables).toEqual([]);
    expect(proposal.sheets[0]?.classification).toEqual(["snapshot"]);
  });

  it("routes a declared table's rows to it and infers regions beside it", () => {
    const proposal = inferWorkbook(
      stream([
        sheetFact("Mixed"),
        {
          kind: "declared-table",
          name: "Rates",
          range: { firstRow: 0, firstColumn: 0, lastRow: 3, lastColumn: 1 },
          headerRowCount: 1,
          totalsRowCount: 1,
          columns: ["Code", "Rate"],
        },
        ...rowFacts(0, ["Code", "Rate", null, "Note"]),
        ...rowFacts(1, ["A", 1, null, "first"]),
        ...rowFacts(2, ["B", 2, null, "second"]),
        ...rowFacts(3, ["Total", 3]),
      ]),
      contextFor("mixed.xlsx", null),
    );
    const [rates, notes] = proposal.tables;
    expect(rates).toMatchObject({ tableKey: "s0.t0", tableName: "Rates", rowCount: 2, discardedRowCount: 1 });
    expect(rates?.discardedRows).toEqual([{ rowIndex: 3, reason: "totals-row", cells: ["Total", "3"] }]);
    expect(notes).toMatchObject({ tableKey: "s0.r0", firstColumn: 3, rowCount: 2 });
  });
});

describe("inferWorkbook — record rules and inert validations", () => {
  const withValidations = (validations: readonly WorkbookFactV2[]): ProposedWorkbookV1 =>
    inferWorkbook(
      stream([
        sheetFact("Stock"),
        ...rowFacts(0, ["Item", "Count", "Size"]),
        ...rowFacts(1, ["Nut", 5, 2]),
        ...rowFacts(2, ["Bolt", 5, 3]),
        ...validations,
      ]),
      contextFor("stock.xlsx", null),
    );
  const validation = (
    column: number,
    rule: "whole" | "text-length" | "custom" | "list",
    operator: "equal" | "not-equal" | "between" | null,
    formula1: string,
    range = { firstRow: 1, firstColumn: column, lastRow: 2, lastColumn: column },
  ): WorkbookFactV2 => ({
    kind: "validation",
    range,
    rule,
    operator,
    listSource: rule === "list" ? { kind: "inline", values: formula1.split(",") } : null,
    formula1,
    formula2: null,
  });

  it("states what M02's rule IR can express as a proposed rule", () => {
    const proposal = withValidations([validation(1, "whole", "equal", "5"), validation(2, "whole", "not-equal", "4")]);
    expect(proposal.recordRules).toEqual([
      { ruleKey: "rule:s0.r0.c1", tableKey: "s0.r0", columnKey: "s0.r0.c1", condition: { kind: "field-equals", columnKey: "s0.r0.c1", value: { kind: "decimal", decimal: "5" } }, isActive: true },
      {
        ruleKey: "rule:s0.r0.c2",
        tableKey: "s0.r0",
        columnKey: "s0.r0.c2",
        condition: { kind: "not", condition: { kind: "field-equals", columnKey: "s0.r0.c2", value: { kind: "decimal", decimal: "4" } } },
        isActive: true,
      },
    ]);
    expect(statement(proposal, "record-rule:rule:s0.r0.c1")).toMatchObject({ editKind: "reject-statement", evidence: [{ kind: "validation-rule", rule: "whole" }] });
    // The rule also types the column; it is still a number, not a guess.
    expect(proposal.tables[0]?.fields[1]?.type).toEqual({ kind: "number" });
    expect(proposal.inertItems).toEqual([]);
  });

  it("keeps anything else as an inert unsupported-validation item, never a guessed rule", () => {
    const proposal = withValidations([
      validation(1, "whole", "between", "1"),
      validation(0, "text-length", "equal", "3"),
      validation(0, "custom", null, "LEN(A2)>1"),
      validation(5, "list", null, "a,b", { firstRow: 10, firstColumn: 5, lastRow: 12, lastColumn: 5 }),
    ]);
    expect(proposal.recordRules).toEqual([]);
    expect(proposal.inertItems.map((item) => [item.kind, item.location, item.reasonKey])).toEqual([
      ["unsupported-validation", "Stock!B2:B3", "validation-not-expressible"],
      ["unsupported-validation", "Stock!A2:A3", "validation-not-expressible"],
      ["unsupported-validation", "Stock!A2:A3", "validation-not-expressible"],
      ["unsupported-validation", "Stock!F11:F13", "validation-not-expressible"],
    ]);
  });
});

describe("inferWorkbook — the delimited special case", () => {
  it("is one sheet and one table that maps exactly onto the F02 pinned proposal", async () => {
    const { items } = await parseFixture("delimited/field-log-messy.csv", "field-log-messy.csv");
    const workbook = inferWorkbook(items, contextFor("field-log-messy.csv", null));
    const f02 = inferProposal(items, { fileName: "field-log-messy.csv" });

    expect(workbook.sheets).toHaveLength(1);
    expect(workbook.sheets[0]).toMatchObject({ sheetKey: "s0", isSelected: true, classification: ["table"] });
    expect(workbook.tables).toHaveLength(1);
    const table = workbook.tables[0] as ProposedTableV2;
    expect({
      appName: workbook.appName,
      tableName: table.tableName,
      headerRowIndex: table.headerRowIndex,
      rowCount: table.rowCount,
      discardedRows: table.discardedRows,
      leadingRows: table.leadingRows,
      fields: table.fields.map((field) => ({
        columnIndex: field.columnIndex,
        fieldName: field.fieldName,
        isNameGenerated: field.isNameGenerated,
        type: field.type,
        sourceFormat: field.sourceFormat,
        enumOptions: field.enumOptions,
        violations: field.violations,
      })),
    }).toEqual({
      appName: f02.appName,
      tableName: f02.table.tableName,
      headerRowIndex: f02.headerRowIndex,
      rowCount: f02.rowCount,
      discardedRows: f02.discardedRows,
      leadingRows: f02.leadingRows,
      fields: f02.table.fields,
    });
    expect(
      workbook.statements.map((entry) => [entry.subject, entry.columnIndex, entry.editKind, entry.evidence, entry.evidenceFingerprint, entry.disposition]),
    ).toEqual(f02.statements.map((entry) => [entry.subject, entry.columnIndex, entry.editKind, entry.evidence, entry.evidenceFingerprint, entry.disposition]));
    expect(table.keyColumnKey).toBeNull();
  });

  it("refuses a stream that never finished, workbook or delimited", async () => {
    const batches = (await parseWorkbook(DEMO, [0])).filter((item) => item.kind === "batch");
    expect(() => inferWorkbook(batches, contextFor("fieldwork-q3.xlsx", null))).toThrow(/completed fact stream/);
    expect(() => inferWorkbook([], contextFor("empty.csv", null))).toThrow(/completed fact stream/);
  });
});
