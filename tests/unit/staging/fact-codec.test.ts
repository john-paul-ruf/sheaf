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
