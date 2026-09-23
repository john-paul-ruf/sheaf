import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  booleanValue,
  decimalValue,
  textValue,
} from "../../../../src/domain/model/values.js";
import type {
  WorkbookFactStreamItemV2,
  WorkbookFactV2,
} from "../../../../src/import/facts/index.js";
import { parseFixture } from "../parse-harness.js";
import { assertConformingStream } from "./conformance.js";

const range = (firstRow: number, firstColumn: number, lastRow: number, lastColumn: number) => ({
  firstRow,
  firstColumn,
  lastRow,
  lastColumn,
});

const sheet = (sheetIndex: number): WorkbookFactV2 => ({
  kind: "sheet",
  sheetIndex,
  name: `Sheet ${sheetIndex}`,
  sheetKind: "worksheet",
  visibility: "visible",
  declaredRange: range(0, 0, 1, 1),
  dateSystem: "1900",
});

/** A small stream using every V2 kind, with its true summary. */
const conforming = (): WorkbookFactStreamItemV2[] => {
  const facts: WorkbookFactV2[] = [
    sheet(0),
    { kind: "defined-name", name: "Rates", ref: "Sheet0!$B$1:$B$2", sheetIndex: null },
    { kind: "row", rowIndex: 0, cellCount: 2 },
    { kind: "value", rowIndex: 0, columnIndex: 0, value: textValue("Rate") },
    { kind: "cell-format", rowIndex: 0, columnIndex: 1, numberFormat: "0%", formatClass: "percent", currencySymbol: null },
    { kind: "formula", rowIndex: 0, columnIndex: 1, text: "A2/2", sharedGroup: null, isArray: false, isExternal: false },
    { kind: "value", rowIndex: 0, columnIndex: 1, value: decimalValue("0.5") },
    { kind: "merge", range: range(1, 0, 1, 1) },
    { kind: "declared-table", name: "T", range: range(0, 0, 1, 1), headerRowCount: 1, totalsRowCount: 0, columns: ["A", "B"] },
    { kind: "validation", range: range(1, 0, 1, 0), rule: "list", operator: null, listSource: { kind: "inline", values: ["a", "b"] }, formula1: '"a,b"', formula2: null },
    sheet(2),
    { kind: "row", rowIndex: 0, cellCount: 1 },
    { kind: "value", rowIndex: 0, columnIndex: 0, value: booleanValue(true) },
    { kind: "preserved-part", partKind: "chart", location: "Sheet 2!A1:B2", reasonKey: "chart-not-live-yet", anchor: range(0, 0, 1, 1), partPath: "xl/charts/chart1.xml" },
    { kind: "diagnostic", diagnostic: { code: "error-value", severity: "warning", firstRowIndex: 0, firstColumnIndex: 0, occurrences: 1 } },
  ];
  return [
    { kind: "batch", batchSeq: 0, facts: facts.slice(0, 8) },
    { kind: "batch", batchSeq: 1, facts: facts.slice(8) },
    {
      kind: "summary",
      rowCount: 2,
      columnCount: 2,
      valueCount: 3,
      batchCount: 2,
      diagnostics: [{ code: "error-value", severity: "warning", firstRowIndex: 0, firstColumnIndex: 0, occurrences: 1 }],
    },
  ];
};

const replaceFact = (index: number, fact: WorkbookFactV2): WorkbookFactStreamItemV2[] => {
  const items = conforming();
  const first = items[0];
  if (first?.kind !== "batch") throw new Error("fixture shape");
  const facts = [...first.facts];
  facts[index] = fact;
  return [{ ...first, facts }, ...items.slice(1)];
};

describe("the V2 conformance suite", () => {
  it("accepts a stream that uses every V2 kind", () => {
    expect(() => assertConformingStream(conforming())).not.toThrow();
  });

  it("accepts every F02 delimited fixture: V1 streams are V2 streams", async () => {
    const names = (await readdir("tests/fixtures/workbooks/delimited")).filter((name) =>
      /\.(csv|tsv)$/.test(name),
    );
    expect(names.length).toBeGreaterThanOrEqual(12);
    for (const name of names) {
      const parsed = await parseFixture(`delimited/${name}`, name);
      expect(() => assertConformingStream(parsed.items), name).not.toThrow();
      const small = await parseFixture(`delimited/${name}`, name, { factsPerBatch: 7 });
      expect(() => assertConformingStream(small.items, { factsPerBatch: 7 }), name).not.toThrow();
    }
  });

  it("rejects each contract violation", () => {
    const cases: [string, WorkbookFactStreamItemV2[], { factsPerBatch?: number; isComplete?: boolean }?][] = [
      ["missing summary", conforming().slice(0, 2)],
      ["summary on a cancelled stream", conforming(), { isComplete: false }],
      ["oversized batch", conforming(), { factsPerBatch: 7 }],
      ["batch sequence gap", conforming().map((item) => (item.kind === "batch" && item.batchSeq === 1 ? { ...item, batchSeq: 2 } : item))],
      ["value beyond cellCount", replaceFact(3, { kind: "value", rowIndex: 0, columnIndex: 2, value: textValue("x") })],
      ["value outside its row", replaceFact(3, { kind: "value", rowIndex: 1, columnIndex: 0, value: textValue("x") })],
      ["row out of order", [{ kind: "batch", batchSeq: 0, facts: [sheet(0), { kind: "row", rowIndex: 1, cellCount: 1 }, { kind: "row", rowIndex: 0, cellCount: 1 }] }, { kind: "summary", rowCount: 2, columnCount: 1, valueCount: 0, batchCount: 1, diagnostics: [] }]],
      ["stream opens without its sheet", replaceFact(0, { kind: "merge", range: range(0, 0, 0, 0) })],
      ["range outside the grid", replaceFact(7, { kind: "merge", range: range(0, 0, 1_048_576, 0) })],
      ["inverted range", replaceFact(7, { kind: "merge", range: range(1, 0, 0, 0) })],
      ["summary counts wrong", conforming().map((item) => (item.kind === "summary" ? { ...item, valueCount: 4 } : item))],
      ["non-canonical fact", replaceFact(1, { kind: "defined-name", name: "x", ref: "y", sheetIndex: 0.5 })],
    ];
    for (const [name, items, options] of cases) {
      expect(() => assertConformingStream(items, options), name).toThrow(/does not conform/);
    }
  });
});
