import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { booleanValue, decimalValue, invalidPreservedValue, textValue, type CellValueV1 } from "../../../src/domain/model/values.js";
import {
  PRESERVED_PART_KINDS,
  PRESERVED_REASON_BY_KIND,
  WORKBOOK_FACTS_PER_BATCH,
  type RangeV1,
  type WorkbookFactStreamItemV2,
  type WorkbookFactV2,
} from "../../../src/import/facts/index.js";
import {
  applyWorkbookReviewEdit,
  WORKBOOK_REVIEW_EDIT_REJECTIONS,
  type WorkbookReviewEditV1,
} from "../../../src/import/inference/review-edits.js";
import type { ProposedFieldTypeV1 } from "../../../src/import/inference/values.js";
import { inferWorkbook } from "../../../src/import/inference/workbook.js";
import type { ProposedWorkbookV1 } from "../../../src/import/inference/workbook-proposal.js";
import { assertConformingStream } from "../../unit/import/facts/conformance.js";
import { contextFor, DEMO, proposeFixture } from "../../unit/import/inference/demo-harness.js";
import { parseFixture } from "../../unit/import/parse-harness.js";

/** Cuts facts into contiguous batches and appends the summary the stream earns. */
const toStream = (facts: readonly WorkbookFactV2[]): WorkbookFactStreamItemV2[] => {
  const items: WorkbookFactStreamItemV2[] = [];
  for (let start = 0; start < facts.length; start += WORKBOOK_FACTS_PER_BATCH) {
    items.push({ kind: "batch", batchSeq: items.length, facts: facts.slice(start, start + WORKBOOK_FACTS_PER_BATCH) });
  }
  items.push({
    kind: "summary",
    rowCount: facts.filter((fact) => fact.kind === "row").length,
    columnCount: Math.max(0, ...facts.map((fact) => (fact.kind === "row" ? fact.cellCount : 0))),
    valueCount: facts.filter((fact) => fact.kind === "value").length,
    batchCount: items.length,
    diagnostics: [],
  });
  return items;
};

// ------------------------------------------------------------------ edits --

let bases: readonly ProposedWorkbookV1[] = [];

beforeAll(async () => {
  const { items } = await parseFixture("delimited/field-log-messy.csv", "field-log-messy.csv");
  bases = [
    await proposeFixture(DEMO, [0, 1, 2, 3, 4, 5, 6]),
    await proposeFixture(DEMO, [0, 2, 3, 5]),
    await proposeFixture("ooxml/multiple-regions.xlsx", [0]),
    inferWorkbook(items, contextFor("field-log-messy.csv", null)),
  ];
});

const TYPES: readonly ProposedFieldTypeV1[] = [
  { kind: "text" },
  { kind: "number" },
  { kind: "date" },
  { kind: "boolean" },
  { kind: "enum" },
  { kind: "phone" },
  { kind: "currency", currencyCode: "USD" },
];

const name = fc.oneof(fc.constantFrom("Site", "Jobs", "Status", "", "  ", "José", "Crew 2"), fc.string({ maxLength: 6 }));

/** Edits aimed at the proposal's own keys, mixed with keys it does not have. */
const editFor = (proposal: ProposedWorkbookV1): fc.Arbitrary<WorkbookReviewEditV1> => {
  const tableKey = fc.constantFrom(...proposal.tables.map((table) => table.tableKey), "s9.t9");
  const columnKey = fc.constantFrom(...proposal.tables.flatMap((table) => table.fields.map((field) => field.columnKey)), "s9.t9.c9");
  const relationshipKey = fc.constantFrom(...proposal.relationships.map((relationship) => relationship.relationshipKey), "rel:nope");
  const statementId = fc.constantFrom(...proposal.statements.map((statement) => statement.statementId), "nope");
  const rowIndex = fc.option(fc.integer({ min: -2, max: 40 }), { nil: null });
  return fc.oneof(
    name.map((appName) => ({ kind: "rename-app" as const, appName })),
    fc.record({ kind: fc.constant("rename-table" as const), tableKey, tableName: name }),
    fc.record({ kind: fc.constant("rename-field" as const), tableKey, columnKey, fieldName: name }),
    fc.record({ kind: fc.constant("override-type" as const), tableKey, columnKey, type: fc.constantFrom(...TYPES) }),
    fc.record({ kind: fc.constant("set-header-row" as const), regionKey: tableKey, rowIndex }),
    fc.record({ kind: fc.constant("edit-enum-options" as const), tableKey, columnKey, options: fc.array(name, { maxLength: 6 }) }),
    fc.record({ kind: fc.constant("reject-relationship" as const), relationshipKey }),
    fc.record({ kind: fc.constant("restore-relationship" as const), relationshipKey }),
    fc.record({ kind: fc.constant("retarget-relationship" as const), relationshipKey, toTableKey: tableKey }),
    fc.record({ kind: fc.constant("reject-statement" as const), statementId }),
    fc.record({ kind: fc.constant("restore-statement" as const), statementId }),
    fc.record({ kind: fc.constant("set-key" as const), tableKey, columnKey: fc.option(columnKey, { nil: null }) }),
    fc.record({ kind: fc.constant("set-label" as const), tableKey, columnKey }),
  );
};

/** A base proposal, a few edits already applied to it, and one more edit. */
const scenario = fc
  .integer({ min: 0, max: 3 })
  .chain((index) => {
    const base = bases[index] as ProposedWorkbookV1;
    return fc.tuple(fc.constant(base), fc.array(editFor(base), { maxLength: 4 }), editFor(base));
  })
  .map(([base, history, edit]) => {
    let proposal = base;
    for (const earlier of history) {
      const result = applyWorkbookReviewEdit(proposal, earlier);
      if (result.kind === "applied") proposal = result.proposal;
    }
    return { base, proposal, edit };
  });

describe("applyWorkbookReviewEdit properties", () => {
  it("is total: applied or refused with a closed reason, never a throw", () => {
    fc.assert(
      fc.property(scenario, ({ proposal, edit }) => {
        const result = applyWorkbookReviewEdit(proposal, edit);
        if (result.kind === "rejected") {
          expect(WORKBOOK_REVIEW_EDIT_REJECTIONS).toContain(result.reason);
          return;
        }
        expect(result.proposal.tables).toHaveLength(proposal.tables.length);
        for (const table of result.proposal.tables) expect(table.rowCount).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 600 },
    );
  });

  it("is pure: the proposal it was given is untouched", () => {
    fc.assert(
      fc.property(scenario, ({ proposal, edit }) => {
        const before = structuredClone(proposal);
        applyWorkbookReviewEdit(proposal, edit);
        expect(proposal).toEqual(before);
      }),
      { numRuns: 600 },
    );
  });

  it("is idempotent: the same edit twice says the same thing", () => {
    fc.assert(
      fc.property(scenario, ({ proposal, edit }) => {
        const once = applyWorkbookReviewEdit(proposal, edit);
        if (once.kind !== "applied") return;
        expect(applyWorkbookReviewEdit(once.proposal, edit)).toEqual(once);
      }),
      { numRuns: 600 },
    );
  });

  it("marks at most the one statement it names", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }).chain((index) => fc.tuple(fc.constant(bases[index] as ProposedWorkbookV1), editFor(bases[index] as ProposedWorkbookV1))),
        ([base, edit]) => {
          const result = applyWorkbookReviewEdit(base, edit);
          if (result.kind !== "applied") return;
          const before = new Map(base.statements.map((statement) => [statement.statementId, statement.disposition]));
          const changed = result.proposal.statements.filter(
            (statement) => before.has(statement.statementId) && before.get(statement.statementId) !== statement.disposition,
          );
          expect(changed.length).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 600 },
    );
  });
});

// -------------------------------------------------------------- inference --

const NFC = (text: string): string => text.normalize("NFC");

const cellValue: fc.Arbitrary<CellValueV1> = fc.oneof(
  fc.constantFrom("Job", "J-1", "North", "2026-03-02", "yes", "a@b.test", "$12.50", "TBD").map(textValue),
  fc.string({ minLength: 1, maxLength: 5 }).map((text) => textValue(NFC(text))),
  fc.constantFrom("1", "2.5", "45200", "-3", "0.15").map(decimalValue),
  fc.boolean().map(booleanValue),
  fc.constantFrom("#N/A", "#REF!").map(invalidPreservedValue),
);

const FORMULAS = [
  "VLOOKUP(A2,Sheet2!A:B,2,FALSE)",
  "INDEX(Sheet1!B:B,MATCH(A2,Sheet1!A:A,0))",
  "_xlfn.XLOOKUP([@Code],Codes[Code],Codes[Name])",
  "SUM(A:A)",
  "(((",
  "VLOOKUP(A2,MaterialList,1,FALSE)",
];

const range = (rows: number, columns: number): fc.Arbitrary<RangeV1> =>
  fc
    .tuple(fc.nat(rows), fc.nat(rows), fc.nat(columns), fc.nat(columns))
    .map(([a, b, c, d]) => ({ firstRow: Math.min(a, b), lastRow: Math.max(a, b), firstColumn: Math.min(c, d), lastColumn: Math.max(c, d) }));

interface CellPlan {
  readonly format: 0 | 1 | 2 | 3 | null;
  readonly formula: number | null;
  readonly value: CellValueV1 | null;
}

const FORMATS = [
  { numberFormat: "General", formatClass: "general", currencySymbol: null },
  { numberFormat: '"$"#,##0.00', formatClass: "currency", currencySymbol: "$" },
  { numberFormat: "yyyy-mm-dd", formatClass: "date", currencySymbol: null },
  { numberFormat: "0%", formatClass: "percent", currencySymbol: null },
] as const;

const sheetPlan = fc.record({
  gaps: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 0, maxLength: 14 }),
  rows: fc.array(
    fc.array(
      fc.record({
        format: fc.option(fc.constantFrom(0 as const, 1 as const, 2 as const, 3 as const), { nil: null, freq: 3 }),
        formula: fc.option(fc.nat(FORMULAS.length), { nil: null, freq: 4 }),
        value: fc.option(cellValue, { nil: null, freq: 5 }),
      }),
      { maxLength: 6 },
    ),
    { maxLength: 14 },
  ),
  hasTable: fc.boolean(),
  validations: fc.array(
    fc.record({
      range: range(15, 6),
      rule: fc.constantFrom("list" as const, "whole" as const, "date" as const, "custom" as const),
      operator: fc.constantFrom(null, "equal" as const, "between" as const),
      source: fc.constantFrom("a,b", "Sheet2!$A$1:$A$3", "MaterialList"),
    }),
    { maxLength: 3 },
  ),
  parts: fc.array(fc.record({ kind: fc.constantFrom(...PRESERVED_PART_KINDS), anchor: fc.option(range(20, 8), { nil: null }) }), { maxLength: 3 }),
});

const workbookFacts = fc.array(sheetPlan, { minLength: 1, maxLength: 3 }).map((sheets) => {
  const facts: WorkbookFactV2[] = [];
  sheets.forEach((plan, sheetIndex) => {
    facts.push({ kind: "sheet", sheetIndex, name: ["Sheet1", "Sheet2", "My Sheet"][sheetIndex] as string, sheetKind: "worksheet", visibility: "visible", declaredRange: null, dateSystem: "1900" });
    if (sheetIndex === 0) facts.push({ kind: "defined-name", name: "MaterialList", ref: "Sheet2!$A$1:$A$4", sheetIndex: null });
    if (plan.hasTable) {
      facts.push({ kind: "declared-table", name: `T${sheetIndex}`, range: { firstRow: 0, firstColumn: 0, lastRow: 6, lastColumn: 2 }, headerRowCount: 1, totalsRowCount: 1, columns: ["Code", "Name", "Qty"] });
    }
    let rowIndex = -1;
    plan.rows.forEach((cells, position) => {
      rowIndex += plan.gaps[position] ?? 1;
      facts.push({ kind: "row", rowIndex, cellCount: cells.length });
      cells.forEach((cell: CellPlan, columnIndex) => {
        if (cell.format !== null) facts.push({ kind: "cell-format", rowIndex, columnIndex, ...FORMATS[cell.format] });
        if (cell.formula !== null) {
          facts.push({ kind: "formula", rowIndex, columnIndex, text: FORMULAS[cell.formula] ?? null, sharedGroup: cell.formula >= FORMULAS.length ? 0 : null, isArray: false, isExternal: false });
        }
        if (cell.value !== null) facts.push({ kind: "value", rowIndex, columnIndex, value: cell.value });
      });
    });
    for (const validation of plan.validations) {
      facts.push({
        kind: "validation",
        range: validation.range,
        rule: validation.rule,
        operator: validation.rule === "list" || validation.rule === "custom" ? null : validation.operator,
        listSource: validation.rule !== "list" ? null : validation.source === "a,b" ? { kind: "inline", values: ["a", "b"] } : { kind: "range", ref: validation.source },
        formula1: validation.rule === "list" ? validation.source : "2",
        formula2: null,
      });
    }
    for (const part of plan.parts) {
      facts.push({ kind: "preserved-part", partKind: part.kind, location: "Somewhere", reasonKey: PRESERVED_REASON_BY_KIND[part.kind], anchor: part.anchor, partPath: null });
    }
  });
  return facts;
});

describe("inferWorkbook properties", () => {
  it("never throws on a conforming stream, and always on one without its summary", () => {
    fc.assert(
      fc.property(workbookFacts, fc.boolean(), (facts, isDeselecting) => {
        const items = toStream(facts);
        assertConformingStream(items);
        const context = contextFor(
          "generated.xlsx",
          isDeselecting ? [{ sheetIndex: 7, name: "Hidden", sheetKind: "worksheet", visibility: "hidden", isSelected: false }] : null,
        );
        const proposal = inferWorkbook(items, context);
        expect(proposal.statements[0]?.subject).toBe("app-name");
        for (const table of proposal.tables) expect(table.fields.length).toBe(table.lastColumn - table.firstColumn + 1);
        expect(() => inferWorkbook(items.slice(0, -1), context)).toThrow(/completed fact stream/);
      }),
      { numRuns: 400 },
    );
  });

  it("keeps every fingerprint input when rows are appended", () => {
    const table = fc.record({
      headings: fc.uniqueArray(fc.constantFrom("Site", "Status", "Crew", "Amount", "Visited", "Notes", "Approved"), { minLength: 1, maxLength: 4 }),
      templates: fc.array(fc.array(cellValue, { minLength: 4, maxLength: 4 }), { minLength: 2, maxLength: 4 }),
      reps: fc.integer({ min: 8, max: 12 }),
      more: fc.integer({ min: 1, max: 30 }),
    });
    const facts = (headings: readonly string[], templates: readonly (readonly CellValueV1[])[], reps: number): WorkbookFactV2[] => {
      const out: WorkbookFactV2[] = [
        { kind: "sheet", sheetIndex: 0, name: "Log", sheetKind: "worksheet", visibility: "visible", declaredRange: null, dateSystem: "1900" },
        { kind: "row", rowIndex: 0, cellCount: headings.length + 1 },
        { kind: "value", rowIndex: 0, columnIndex: 0, value: textValue("Item ID") },
        ...headings.map((heading, index): WorkbookFactV2 => ({ kind: "value", rowIndex: 0, columnIndex: index + 1, value: textValue(heading) })),
      ];
      for (let row = 1; row <= reps * templates.length; row += 1) {
        const template = templates[(row - 1) % templates.length] as readonly CellValueV1[];
        out.push({ kind: "row", rowIndex: row, cellCount: headings.length + 1 });
        out.push({ kind: "value", rowIndex: row, columnIndex: 0, value: textValue(`I-${row}`) });
        headings.forEach((_heading, index) => out.push({ kind: "value", rowIndex: row, columnIndex: index + 1, value: template[index] as CellValueV1 }));
      }
      return out;
    };
    fc.assert(
      fc.property(table, ({ headings, templates, reps, more }) => {
        const prints = (count: number) =>
          inferWorkbook(toStream(facts(headings, templates, count)), contextFor("log.xlsx", null)).statements.map((statement) => [
            statement.statementId,
            statement.evidenceFingerprint,
          ]);
        const before = prints(reps);
        // Non-vacuous: a name and a type statement per column, at least.
        expect(before.length).toBeGreaterThan(2 * (headings.length + 1));
        expect(prints(reps + more)).toEqual(before);
      }),
      { numRuns: 200 },
    );
  });
});
