import { describe, expect, it } from "vitest";
import { decodeCanonical, encodeCanonical } from "../../../../src/persistence/codecs/canonical-cbor.js";
import { decimalValue, invalidPreservedValue, textValue } from "../../../../src/domain/model/values.js";
import * as delimited from "../../../../src/import/formats/delimited/facts.js";
import {
  factStreamItemToCanonicalValue,
  IMPORT_DIAGNOSTIC_CODES,
  IMPORT_DIAGNOSTIC_CODES_V1,
  PRESERVED_PART_KINDS,
  PRESERVED_REASON_BY_KIND,
  PRESERVED_REASON_KEYS,
  type WorkbookFactKindV2,
  type WorkbookFactV2,
} from "../../../../src/import/facts/index.js";

const range = { firstRow: 1, firstColumn: 0, lastRow: 60, lastColumn: 8 };

/** One fact of every V2 kind. */
const EVERY_KIND: readonly WorkbookFactV2[] = [
  { kind: "row", rowIndex: 1, cellCount: 9 },
  { kind: "value", rowIndex: 1, columnIndex: 4, value: decimalValue("1250.5") },
  { kind: "diagnostic", diagnostic: { code: "error-value", severity: "warning", firstRowIndex: 3, firstColumnIndex: 2, occurrences: 1 } },
  { kind: "sheet", sheetIndex: 0, name: "Jobs", sheetKind: "worksheet", visibility: "very-hidden", declaredRange: range, dateSystem: "1904" },
  { kind: "cell-format", rowIndex: 1, columnIndex: 4, numberFormat: '"$"#,##0.00', formatClass: "currency", currencySymbol: "$" },
  { kind: "formula", rowIndex: 1, columnIndex: 2, text: null, sharedGroup: 0, isArray: false, isExternal: false },
  { kind: "declared-table", name: "JobsTable", range, headerRowCount: 1, totalsRowCount: 0, columns: ["Job ID", "Status"] },
  { kind: "validation", range, rule: "list", operator: null, listSource: { kind: "range", ref: "Materials!$A$2:$A$9" }, formula1: "Materials!$A$2:$A$9", formula2: null },
  { kind: "merge", range },
  { kind: "defined-name", name: "Rates", ref: "Jobs!$E$2:$E$61", sheetIndex: null },
  { kind: "preserved-part", partKind: "chart", location: "Overview!B2:H18", reasonKey: "chart-not-live-yet", anchor: null, partPath: "xl/charts/chart1.xml" },
];

describe("fact vocabulary V2", () => {
  it("keeps the F02 diagnostic codes in their positions and appends the new ones", () => {
    expect(IMPORT_DIAGNOSTIC_CODES.slice(0, IMPORT_DIAGNOSTIC_CODES_V1.length)).toEqual([
      ...IMPORT_DIAGNOSTIC_CODES_V1,
    ]);
    expect(IMPORT_DIAGNOSTIC_CODES.slice(IMPORT_DIAGNOSTIC_CODES_V1.length)).toEqual([
      "error-value",
      "malformed-value",
    ]);
  });

  it("re-exports exactly the V1 subset from the delimited path (D32)", () => {
    expect(delimited.factStreamItemToCanonicalValue).toBe(factStreamItemToCanonicalValue);
    expect(delimited.IMPORT_DIAGNOSTIC_CODES).toBe(IMPORT_DIAGNOSTIC_CODES_V1);
  });

  it("maps every V2 kind into the canonical CBOR domain and back unchanged", () => {
    const kinds = new Set<WorkbookFactKindV2>(EVERY_KIND.map((fact) => fact.kind));
    expect(kinds.size).toBe(11);
    const item = { kind: "batch" as const, batchSeq: 0, facts: EVERY_KIND };
    const canonical = factStreamItemToCanonicalValue(item);
    const encoded = encodeCanonical(canonical);
    expect(encodeCanonical(decodeCanonical(encoded))).toEqual(encoded);

    const facts = (canonical as ReadonlyMap<string, unknown>).get("facts") as ReadonlyMap<string, unknown>[];
    expect(facts[3]?.get("declaredRange")).toEqual(
      new Map([
        ["firstRow", 1n],
        ["firstColumn", 0n],
        ["lastRow", 60n],
        ["lastColumn", 8n],
      ]),
    );
    expect(facts[5]?.get("sharedGroup")).toBe(0n);
    expect(facts[5]?.get("text")).toBeNull();
    expect(facts[7]?.get("listSource")).toEqual(
      new Map([
        ["kind", "range"],
        ["ref", "Materials!$A$2:$A$9"],
      ]),
    );
  });

  it("maps a V1 item exactly as F02 did", () => {
    const canonical = factStreamItemToCanonicalValue({
      kind: "batch",
      batchSeq: 2,
      facts: [
        { kind: "row", rowIndex: 7, cellCount: 2 },
        { kind: "value", rowIndex: 7, columnIndex: 1, value: textValue("x") },
        { kind: "value", rowIndex: 7, columnIndex: 0, value: invalidPreservedValue("#N/A") },
      ],
    });
    expect(canonical).toEqual(
      new Map<string, unknown>([
        ["kind", "batch"],
        ["batchSeq", 2n],
        [
          "facts",
          [
            new Map<string, unknown>([["kind", "row"], ["rowIndex", 7n], ["cellCount", 2n]]),
            new Map<string, unknown>([["kind", "value"], ["rowIndex", 7n], ["columnIndex", 1n], ["value", new Map([["kind", "text"], ["text", "x"]])]]),
            new Map<string, unknown>([["kind", "value"], ["rowIndex", 7n], ["columnIndex", 0n], ["value", new Map([["kind", "invalid-preserved"], ["sourceText", "#N/A"]])]]),
          ],
        ],
      ]),
    );
  });

  it("gives every preserved-part kind one closed reason", () => {
    for (const kind of PRESERVED_PART_KINDS) {
      expect(PRESERVED_REASON_KEYS).toContain(PRESERVED_REASON_BY_KIND[kind]);
    }
    expect(PRESERVED_REASON_BY_KIND.formula).toBe("formula-not-live-yet");
  });
});
