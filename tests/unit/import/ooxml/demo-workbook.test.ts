import { describe, expect, it } from "vitest";
import { ooxmlAdapter, ooxmlInventoryReader } from "../../../../src/import/formats/ooxml/index.js";
import type { WorkbookFactStreamItemV2, WorkbookFactV2 } from "../../../../src/import/facts/index.js";
import { preflightWorkbook } from "../../../../src/import/preflight/workbook.js";
import { sniffContent } from "../../../../src/import/source/sniff.js";
import { openZipContainer } from "../../../../src/import/source/zip.js";
import {
  DEMO_FACT_COUNTS,
  DEMO_PRESERVED_PARTS,
  DEMO_SHEET_NAMES,
  DEMO_SUMMARY,
} from "../../../fixtures/workbooks/ooxml/demo-counts.js";
import { JOB_COUNT, MISSING_CUSTOMER_ROWS, TBD_ROWS } from "../../../fixtures/workbooks/ooxml/build-demo.js";
import { assertConformingStream } from "../facts/conformance.js";
import { fixtureSource } from "../fixtures.js";

const DEMO = "ooxml/fieldwork-q3.xlsx";

const parse = async (selection: readonly number[]): Promise<WorkbookFactStreamItemV2[]> => {
  const zip = await openZipContainer(await fixtureSource(DEMO));
  const items: WorkbookFactStreamItemV2[] = [];
  for await (const item of ooxmlAdapter.parseSheets({ kind: "zip", zip }, selection, { cancellation: { aborted: false } })) {
    items.push(item);
  }
  return items;
};

/** Facts grouped by the sheet that opened them. */
const bySheet = (items: readonly WorkbookFactStreamItemV2[]): Map<string, WorkbookFactV2[]> => {
  const sheets = new Map<string, WorkbookFactV2[]>();
  let current: WorkbookFactV2[] = [];
  for (const item of items) {
    if (item.kind !== "batch") continue;
    for (const fact of item.facts) {
      if (fact.kind === "sheet") {
        current = [];
        sheets.set(fact.name, current);
      }
      current.push(fact);
    }
  }
  return sheets;
};

const tally = (facts: readonly WorkbookFactV2[], key: (fact: WorkbookFactV2) => string | null) => {
  const counts: Record<string, number> = {};
  for (const fact of facts) {
    const name = key(fact);
    if (name !== null) counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
};

const valueAt = (facts: readonly WorkbookFactV2[], rowIndex: number, columnIndex: number) =>
  facts.find((fact) => fact.kind === "value" && fact.rowIndex === rowIndex && fact.columnIndex === columnIndex);

describe("the GATE-F03 demo workbook", () => {
  it("streams every sheet with the pinned fact counts, conformingly", async () => {
    const items = await parse([0, 1, 2, 3, 4, 5, 6]);
    assertConformingStream(items);
    const sheets = bySheet(items);
    expect([...sheets.keys()]).toEqual([...DEMO_SHEET_NAMES]);
    for (const name of DEMO_SHEET_NAMES) {
      const facts = sheets.get(name) ?? [];
      expect(tally(facts, (fact) => fact.kind), name).toEqual(DEMO_FACT_COUNTS[name]);
      expect(tally(facts, (fact) => (fact.kind === "preserved-part" ? fact.partKind : null)), name).toEqual(
        DEMO_PRESERVED_PARTS[name],
      );
    }
    expect(items.at(-1)).toMatchObject({ kind: "summary", ...DEMO_SUMMARY });
  });

  it("carries the declared structure S02 infers from", async () => {
    const jobs = bySheet(await parse([0])).get("Jobs") ?? [];
    expect(jobs.find((fact) => fact.kind === "declared-table")).toMatchObject({
      name: "JobsTable",
      range: { firstRow: 0, firstColumn: 0, lastRow: JOB_COUNT, lastColumn: 9 },
      columns: ["Job ID", "Customer ID", "Customer", "Status", "Quoted amount", "Paid", "Balance", "Due date", "Approved", "Material"],
    });
    expect(jobs.filter((fact) => fact.kind === "validation")).toEqual([
      {
        kind: "validation",
        range: { firstRow: 1, firstColumn: 3, lastRow: JOB_COUNT, lastColumn: 3 },
        rule: "list",
        operator: null,
        listSource: { kind: "inline", values: ["Scheduled", "In progress", "Waiting", "Complete"] },
        formula1: '"Scheduled,In progress,Waiting,Complete"',
        formula2: null,
      },
      {
        kind: "validation",
        range: { firstRow: 1, firstColumn: 9, lastRow: JOB_COUNT, lastColumn: 9 },
        rule: "list",
        operator: null,
        listSource: { kind: "range", ref: "Materials!$A$2:$A$9" },
        formula1: "Materials!$A$2:$A$9",
        formula2: null,
      },
    ]);
    const formulas = jobs.filter((fact) => fact.kind === "formula");
    expect(formulas[0]).toEqual({
      kind: "formula",
      rowIndex: 1,
      columnIndex: 2,
      text: "VLOOKUP(B2,Customers!A:B,2,FALSE)",
      sharedGroup: 0,
      isArray: false,
      isExternal: false,
    });
    expect(formulas.filter((fact) => fact.kind === "formula" && fact.sharedGroup === 0)).toHaveLength(JOB_COUNT);
    expect(formulas.filter((fact) => fact.kind === "formula" && fact.sharedGroup === 1)).toHaveLength(JOB_COUNT);

    for (const row of MISSING_CUSTOMER_ROWS) {
      expect(valueAt(jobs, row - 1, 1)).toMatchObject({ value: { kind: "text", text: "C-013" } });
      expect(valueAt(jobs, row - 1, 2)).toMatchObject({ value: { kind: "invalid-preserved", sourceText: "#N/A" } });
    }
    for (const row of TBD_ROWS) {
      expect(valueAt(jobs, row - 1, 4)).toMatchObject({ value: { kind: "text", text: "TBD" } });
    }
    expect(jobs.find((fact) => fact.kind === "cell-format" && fact.columnIndex === 4)).toMatchObject({
      numberFormat: '"$"#,##0.00',
      formatClass: "currency",
      currencySymbol: "$",
    });
    expect(jobs.find((fact) => fact.kind === "cell-format" && fact.columnIndex === 7)).toMatchObject({
      formatClass: "date",
    });
    expect(valueAt(jobs, 5, 8)).toMatchObject({ value: { kind: "boolean", boolean: false } });
  });

  it("carries the Overview chart's definition on its one chart fact, moving no pinned count (CA-31)", async () => {
    const overview = bySheet(await parse([5])).get("Overview") ?? [];
    const charts = overview.filter((fact) => fact.kind === "preserved-part" && fact.partKind === "chart");
    expect(charts).toEqual([
      {
        kind: "preserved-part",
        partKind: "chart",
        location: "Overview!D2:K18",
        reasonKey: "chart-not-live-yet",
        anchor: { firstRow: 1, firstColumn: 3, lastRow: 17, lastColumn: 10 },
        partPath: "xl/charts/chart1.xml",
        definition: {
          chartType: "bar",
          barDirection: "col",
          grouping: "clustered",
          title: "Quoted by status",
          series: [{ name: "Jobs!$E$1", categoriesRef: "Jobs!$D$2:$D$61", valuesRef: "Jobs!$E$2:$E$61", xRef: null, yRef: null }],
        },
      },
    ]);
    // The definition rides the existing fact: F03's pins stand as they were.
    expect(DEMO_FACT_COUNTS.Overview).toEqual({ sheet: 1, "preserved-part": 4, row: 5, value: 9, formula: 4, "cell-format": 1 });
    expect(DEMO_PRESERVED_PARTS.Overview).toEqual({ drawing: 2, chart: 1, "cell-styling": 1 });
    expect(DEMO_SUMMARY).toEqual({ rowCount: 2169, columnCount: 10, valueCount: 8996 });
    expect(overview.filter((fact) => fact.kind === "preserved-part" && "definition" in fact)).toHaveLength(1);
  });

  it("keeps Visits' Job IDs inside Jobs', Crew's spacer and repeated heading, and the missing customer", async () => {
    const sheets = bySheet(await parse([0, 1, 2, 3]));
    const column = (sheet: string, columnIndex: number) =>
      (sheets.get(sheet) ?? [])
        .filter((fact) => fact.kind === "value" && fact.columnIndex === columnIndex && fact.rowIndex > 0)
        .map((fact) => (fact.kind === "value" && fact.value.kind === "text" ? fact.value.text : null));
    const jobIds = new Set(column("Jobs", 0));
    expect(column("Visits", 1).every((id) => jobIds.has(id))).toBe(true);
    expect(column("Customers", 0)).not.toContain("C-013");

    const crew = sheets.get("Crew") ?? [];
    expect(crew.some((fact) => fact.kind === "row" && fact.rowIndex === 28)).toBe(false);
    expect(valueAt(crew, 29, 0)).toMatchObject({ value: { kind: "text", text: "Name" } });
    expect(valueAt(crew, 3, 0)).toMatchObject({ value: { kind: "text", text: "Name" } });
  });

  it("parses only the selected sheets (D39) and cancels without a summary", async () => {
    const selected = await parse([0, 5]);
    expect([...bySheet(selected).keys()]).toEqual(["Jobs", "Overview"]);
    assertConformingStream(selected);

    const zip = await openZipContainer(await fixtureSource(DEMO));
    const token = { aborted: false };
    const items: WorkbookFactStreamItemV2[] = [];
    for await (const item of ooxmlAdapter.parseSheets({ kind: "zip", zip }, [6], { cancellation: token, factsPerBatch: 100 })) {
      items.push(item);
      if (items.length === 3) token.aborted = true;
    }
    expect(items).toHaveLength(3);
    assertConformingStream(items, { isComplete: false, factsPerBatch: 100 });
  });

  it("is sized as fits by pre-flight with every sheet preselected", async () => {
    const source = await fixtureSource(DEMO);
    const outcome = await preflightWorkbook(
      source,
      await sniffContent(source, "fieldwork-q3.xlsx"),
      new Map([["xlsx", ooxmlInventoryReader]]),
    );
    expect(outcome).toMatchObject({
      kind: "proceed",
      report: { format: "xlsx", route: "fits", defaultSelection: [0, 1, 2, 3, 4, 5, 6], dateSystem: "1900" },
    });
  });
});
