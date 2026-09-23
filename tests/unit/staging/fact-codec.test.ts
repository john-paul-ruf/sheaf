/**
 * CA-17, S06's leg: the stage round-trips every V2 fact kind, for all five
 * workbook adapters and the delimited parser.
 *
 * The streams are real — each readable fixture of each adapter's corpus, read
 * through the import worker's own registry (`workbook-streams.ts`) — and the
 * claim is byte-level in both directions: `decode(encode(item))` equals the
 * item, and `encode(decode(bytes))` is the same bytes. The corpus as a whole
 * must exercise every fact kind, or the suite fails rather than passing over
 * a kind nobody emitted.
 */

import { describe, expect, it } from "vitest";
import { CodecError } from "../../../src/domain/model/errors.js";
import {
  factStreamItemToCanonicalValue,
  type WorkbookFactStreamItemV2,
  type WorkbookFactV2,
} from "../../../src/import/facts/index.js";
import { parseDelimited } from "../../../src/import/formats/delimited/parse.js";
import { sniffContent } from "../../../src/import/source/sniff.js";
import { decodeFactStreamItem, encodeFactStreamItem } from "../../../src/import/staging/fact-codec.js";
import { decodeCanonical, encodeCanonical } from "../../../src/persistence/codecs/canonical-cbor.js";
import { fixtureSource } from "../import/fixtures.js";
import { WORKBOOK_FIXTURE_DIRECTORIES, streamWorkbookFixture, workbookFixturePaths } from "./workbook-streams.js";

const ALL_KINDS: readonly WorkbookFactV2["kind"][] = [
  "row",
  "value",
  "diagnostic",
  "sheet",
  "cell-format",
  "formula",
  "declared-table",
  "validation",
  "merge",
  "defined-name",
  "preserved-part",
];

const expectRoundTrip = (item: WorkbookFactStreamItemV2): void => {
  const bytes = encodeFactStreamItem(item);
  const decoded = decodeFactStreamItem(bytes);
  expect(decoded).toEqual(item);
  expect(encodeFactStreamItem(decoded)).toEqual(bytes);
};

describe("staged fact chunks (CA-17)", () => {
  it("encode exactly M65's canonical mapping", async () => {
    const source = await fixtureSource("delimited/field-log-messy.csv");
    const sniff = await sniffContent(source, "field-log-messy.csv");
    if (sniff.format.kind !== "delimited") throw new Error("expected a delimited sniff");
    for await (const item of parseDelimited(source, sniff.format, { sheetName: "field-log-messy" })) {
      expect(encodeFactStreamItem(item)).toEqual(encodeCanonical(factStreamItemToCanonicalValue(item)));
    }
  });

  it("round-trip every item of a delimited stream opened with its sheet fact", async () => {
    const source = await fixtureSource("delimited/field-log-messy.csv");
    const sniff = await sniffContent(source, "field-log-messy.csv");
    if (sniff.format.kind !== "delimited") throw new Error("expected a delimited sniff");
    const items: WorkbookFactStreamItemV2[] = [];
    for await (const item of parseDelimited(source, sniff.format, { sheetName: "field-log-messy" })) {
      items.push(item);
    }
    expect(items[0]?.kind === "batch" ? items[0].facts[0] : null).toEqual({
      kind: "sheet",
      sheetIndex: 0,
      name: "field-log-messy",
      sheetKind: "worksheet",
      visibility: "visible",
      declaredRange: null,
      dateSystem: "1900",
    });
    items.forEach(expectRoundTrip);
  });

  for (const directory of WORKBOOK_FIXTURE_DIRECTORIES) {
    it(`round-trip every item of every readable ${directory} fixture, byte-identically`, async () => {
      const kinds = new Set<string>();
      let streamed = 0;
      for (const path of await workbookFixturePaths(directory)) {
        const stream = await streamWorkbookFixture(path);
        if (stream === null) continue;
        // Every sheet, not just pre-flight's default: a subset route would
        // otherwise leave facts unexercised.
        const whole = await streamWorkbookFixture(path, {
          selection: stream.report.sheets.map((sheet) => sheet.sheetIndex),
        });
        // A hostile body the adapter refused mid-stream still stages what it
        // emitted before the bound, so those items round-trip too.
        for (const item of whole?.items ?? []) {
          if (item.kind === "batch") item.facts.forEach((fact) => kinds.add(fact.kind));
          expectRoundTrip(item);
        }
        streamed += whole?.failure === null ? 1 : 0;
      }
      expect(streamed).toBeGreaterThan(0);
      expect(kinds.has("sheet")).toBe(true);
    });
  }

  it("covers every V2 fact kind across the five corpora", async () => {
    const kinds = new Set<string>();
    for (const directory of WORKBOOK_FIXTURE_DIRECTORIES) {
      for (const path of await workbookFixturePaths(directory)) {
        const stream = await streamWorkbookFixture(path);
        if (stream === null) continue;
        const whole = await streamWorkbookFixture(path, {
          selection: stream.report.sheets.map((sheet) => sheet.sheetIndex),
        });
        for (const item of whole?.items ?? []) {
          if (item.kind === "batch") item.facts.forEach((fact) => kinds.add(fact.kind));
        }
      }
    }
    expect([...kinds].sort()).toEqual([...ALL_KINDS].sort());
  });

  it("stages the OOXML corpus's chart and pivot definitions byte-identically", async () => {
    const defined = new Set<string>();
    for (const path of await workbookFixturePaths("ooxml")) {
      const stream = await streamWorkbookFixture(path);
      if (stream === null) continue;
      const whole = await streamWorkbookFixture(path, { selection: stream.report.sheets.map((sheet) => sheet.sheetIndex) });
      for (const item of whole?.items ?? []) {
        if (item.kind !== "batch") continue;
        const parts = item.facts.filter((fact) => fact.kind === "preserved-part" && fact.definition !== undefined);
        parts.forEach((fact) => defined.add(fact.kind === "preserved-part" ? fact.partKind : fact.kind));
        if (parts.length > 0) expectRoundTrip(item);
      }
    }
    expect([...defined].sort()).toEqual(["pivot-table"]);
  });

  describe("the optional chart and pivot definition (CA-31)", () => {
    const part = {
      kind: "preserved-part",
      partKind: "chart",
      location: "Overview!D2:K18",
      reasonKey: "chart-not-live-yet",
      anchor: { firstRow: 1, firstColumn: 3, lastRow: 17, lastColumn: 10 },
      partPath: "xl/charts/chart1.xml",
    } as const;
    const chart = {
      ...part,
      definition: {
        chartType: "bar",
        barDirection: "col",
        grouping: "clustered",
        title: "Quoted by status",
        series: [{ name: "Jobs!$E$1", categoriesRef: "Jobs!$D$2:$D$61", valuesRef: "Jobs!$E$2:$E$61", xRef: null, yRef: null }],
      },
    } as const;
    const pivot = {
      ...part,
      partKind: "pivot-table",
      reasonKey: "pivot-not-live-yet",
      partPath: "xl/pivotTables/pivotTable1.xml",
      definition: {
        sourceSheet: "Data",
        sourceRef: "A1:B4",
        rowFields: ["Crew"],
        dataFields: [
          { cacheFieldName: "Hours", subtotal: "sum" },
          { cacheFieldName: "Crew", subtotal: "count" },
        ],
      },
    } as const;
    const batch = (...facts: WorkbookFactV2[]): WorkbookFactStreamItemV2 => ({ kind: "batch", batchSeq: 0, facts });
    const definitionOf = (item: WorkbookFactStreamItemV2): Map<string, unknown> =>
      ((decodeCanonical(encodeFactStreamItem(item)) as Map<string, unknown>).get("facts") as Map<string, unknown>[])[0]?.get(
        "definition",
      ) as Map<string, unknown>;

    it("round-trips a chart and a pivot definition byte-identically, and absent stays absent", () => {
      expectRoundTrip(batch(chart, pivot, part));
      const decoded = decodeFactStreamItem(encodeFactStreamItem(batch(part)));
      expect(decoded.kind === "batch" ? Object.keys(decoded.facts[0] ?? {}) : []).not.toContain("definition");
      expect(encodeFactStreamItem(batch(part))).toEqual(encodeCanonical(factStreamItemToCanonicalValue(batch(part))));
    });

    it("refuses a definition on a part kind that has none, or of the other kind", () => {
      const withDefinition = (kind: string, definition: unknown): Uint8Array => {
        const map = decodeCanonical(encodeFactStreamItem(batch(part))) as Map<string, unknown>;
        const fact = (map.get("facts") as Map<string, unknown>[])[0] as Map<string, unknown>;
        fact.set("partKind", kind).set("definition", definition);
        return encodeCanonical(map as never);
      };
      const chartMap = definitionOf(batch(chart));
      const pivotMap = definitionOf(batch(pivot));
      expect(decodeFactStreamItem(withDefinition("chart", chartMap))).toEqual(batch(chart));
      expect(() => decodeFactStreamItem(withDefinition("image", chartMap))).toThrow(CodecError);
      expect(() => decodeFactStreamItem(withDefinition("chart", pivotMap))).toThrow(CodecError);
      expect(() => decodeFactStreamItem(withDefinition("pivot-table", chartMap))).toThrow(CodecError);
      expect(() => decodeFactStreamItem(withDefinition("chart", null))).toThrow(CodecError);
    });

    it("refuses a definition value outside its closed sets or with an extra key", () => {
      const mutated = (change: (definition: Map<string, unknown>) => void, item = batch(chart)): Uint8Array => {
        const map = decodeCanonical(encodeFactStreamItem(item)) as Map<string, unknown>;
        change(((map.get("facts") as Map<string, unknown>[])[0] as Map<string, unknown>).get("definition") as Map<string, unknown>);
        return encodeCanonical(map as never);
      };
      expect(() => decodeFactStreamItem(mutated((definition) => definition.set("chartType", "radar")))).toThrow(CodecError);
      expect(() => decodeFactStreamItem(mutated((definition) => definition.set("grouping", "sideways")))).toThrow(CodecError);
      expect(() => decodeFactStreamItem(mutated((definition) => definition.set("colors", [])))).toThrow(CodecError);
      expect(() =>
        decodeFactStreamItem(
          mutated(
            (definition) => ((definition.get("dataFields") as Map<string, unknown>[])[0] as Map<string, unknown>).set("subtotal", "product"),
            batch(pivot),
          ),
        ),
      ).toThrow(CodecError);
    });
  });

  describe("refuse a chunk that is not exactly a fact", () => {
    const valid: WorkbookFactStreamItemV2 = {
      kind: "batch",
      batchSeq: 0,
      facts: [
        { kind: "row", rowIndex: 0, cellCount: 2 },
        { kind: "merge", range: { firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 1 } },
      ],
    };
    const mutate = (change: (map: Map<string, unknown>) => void): Uint8Array => {
      const decoded = decodeCanonical(encodeFactStreamItem(valid)) as Map<string, unknown>;
      change(decoded);
      return encodeCanonical(decoded as never);
    };
    const firstFact = (map: Map<string, unknown>): Map<string, unknown> =>
      (map.get("facts") as Map<string, unknown>[])[0] as Map<string, unknown>;

    it("accepts the unmutated control", () => {
      expect(decodeFactStreamItem(encodeFactStreamItem(valid))).toEqual(valid);
    });

    it("refuses an extra key", () => {
      expect(() => decodeFactStreamItem(mutate((map) => firstFact(map).set("extra", 1n)))).toThrow(CodecError);
    });

    it("refuses a missing key", () => {
      expect(() => decodeFactStreamItem(mutate((map) => firstFact(map).delete("cellCount")))).toThrow(CodecError);
    });

    it("refuses a kind outside the closed set", () => {
      expect(() => decodeFactStreamItem(mutate((map) => firstFact(map).set("kind", "macro")))).toThrow(CodecError);
    });

    it("refuses a negative count", () => {
      expect(() => decodeFactStreamItem(mutate((map) => firstFact(map).set("rowIndex", -1n)))).toThrow(CodecError);
    });

    it("refuses a stream item that is neither a batch nor a summary", () => {
      expect(() => decodeFactStreamItem(mutate((map) => map.set("kind", "partial")))).toThrow(CodecError);
    });
  });
});
