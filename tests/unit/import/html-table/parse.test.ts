import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { htmlTableAdapter } from "../../../../src/import/formats/html-table/index.js";
import { ooxmlAdapter } from "../../../../src/import/formats/ooxml/index.js";
import { openZipContainer } from "../../../../src/import/source/zip.js";
import { decodeCharacterReferences } from "../../../../src/import/formats/html-table/entities.js";
import { detectHtmlEncoding, tokenizeHtml, type HtmlTokenV1 } from "../../../../src/import/formats/html-table/tokenizer.js";
import type { WorkbookFactStreamItemV2, WorkbookFactV2 } from "../../../../src/import/facts/index.js";
import { SNIFF_SAMPLE_BYTES } from "../../../../src/import/source/sniff.js";
import { assertConformingStream } from "../facts/conformance.js";
import { bytesSource, fixtureBytes } from "../fixtures.js";

const ALL = [0, 1, 2, 3];

const parse = async (bytes: Uint8Array, selection: readonly number[] = ALL, factsPerBatch?: number): Promise<WorkbookFactStreamItemV2[]> => {
  const cancellation = { aborted: false };
  const options = factsPerBatch === undefined ? { cancellation } : { cancellation, factsPerBatch };
  const items: WorkbookFactStreamItemV2[] = [];
  for await (const item of htmlTableAdapter.parseSheets({ kind: "text", source: bytesSource(bytes) }, selection, options)) {
    items.push(item);
  }
  return items;
};

const html = (text: string): Uint8Array => new TextEncoder().encode(text);

const factsOf = (items: readonly WorkbookFactStreamItemV2[]): WorkbookFactV2[] =>
  items.flatMap((item) => (item.kind === "batch" ? [...item.facts] : []));

const fixture = async (name: string, selection?: readonly number[]): Promise<WorkbookFactV2[]> =>
  factsOf(await parse(await fixtureBytes(name), selection));

const ofKind = <K extends WorkbookFactV2["kind"]>(facts: readonly WorkbookFactV2[], kind: K) =>
  facts.filter((fact): fact is Extract<WorkbookFactV2, { kind: K }> => fact.kind === kind);

const texts = (facts: readonly WorkbookFactV2[]): unknown[] => ofKind(facts, "value").map((fact) => fact.value);

const countsOf = (facts: readonly WorkbookFactV2[]): Record<string, Record<string, number>> => {
  const counts: Record<string, Record<string, number>> = {};
  let sheet = "(none)";
  for (const fact of facts) {
    if (fact.kind === "sheet") sheet = fact.name;
    const tally = (counts[sheet] ??= {});
    tally[fact.kind] = (tally[fact.kind] ?? 0) + 1;
  }
  return counts;
};

/** Pinned fact counts, every table selected. A change here is a CA-17 change S02/S06 must hear about. */
const PINNED: Readonly<Record<string, Record<string, Record<string, number>>>> = {
  "html-table/merged-headers.html": {
    "Crew roster": { sheet: 1, row: 6, value: 14, merge: 3 },
    Sites: { sheet: 1, row: 2, value: 4 },
  },
  "html-table/active-content.html": { "Table 1": { sheet: 1, row: 6, value: 11, "preserved-part": 14 } },
  "html-table/windows-1252.html": { "Table 1": { sheet: 1, row: 3, value: 6 } },
  "html-table/excel-export.xls": {
    "Q3 Invoices": { sheet: 1, row: 4, value: 15, "cell-format": 3, diagnostic: 1, "preserved-part": 2 },
  },
  "refusals/legacy-export.xls": { "Table 1": { sheet: 1, row: 2, value: 4 } },
  "html-table/fieldwork-jobs-customers.html": {
    Jobs: { sheet: 1, row: 61, value: 610, "cell-format": 8, diagnostic: 1, "preserved-part": 2 },
    Customers: { sheet: 1, row: 13, value: 52, "preserved-part": 1 },
  },
};

describe("HTML-table fact stream (CA-17)", () => {
  it("conforms to V2 on every fixture, at the default and a tiny batch bound", async () => {
    const names = (await readdir("tests/fixtures/workbooks/html-table")).filter((name) => /\.(?:html|xls)$/.test(name));
    expect(names.length).toBeGreaterThanOrEqual(4);
    for (const name of [...names.map((each) => `html-table/${each}`), "refusals/legacy-export.xls"]) {
      const bytes = await fixtureBytes(name);
      assertConformingStream(await parse(bytes));
      assertConformingStream(await parse(bytes, ALL, 3), { factsPerBatch: 3 });
    }
  });

  it("pins every fixture's facts per sheet and kind", async () => {
    for (const [name, expected] of Object.entries(PINNED)) {
      expect(countsOf(await fixture(name)), name).toEqual(expected);
    }
  });

  it("reads F02's legacy-export.xls: one table, a header and one row", async () => {
    expect(texts(await fixture("refusals/legacy-export.xls"))).toEqual([
      { kind: "text", text: "Site" },
      { kind: "text", text: "Crew" },
      { kind: "text", text: "Ridgeway" },
      { kind: "text", text: "North" },
    ]);
  });

  it("lays merged headers on the grid and reads lenient HTML as a browser would", async () => {
    const facts = await fixture("html-table/merged-headers.html");
    expect(ofKind(facts, "merge").map((fact) => fact.range)).toEqual([
      { firstRow: 0, firstColumn: 0, lastRow: 1, lastColumn: 0 },
      { firstRow: 0, firstColumn: 1, lastRow: 0, lastColumn: 2 },
      { firstRow: 4, firstColumn: 1, lastRow: 4, lastColumn: 2 },
    ]);
    // The rowspan above pushes row 1's cells to columns 1 and 2.
    const crew = facts.slice(0, facts.findIndex((fact) => fact.kind === "sheet" && fact.name === "Sites"));
    expect(ofKind(crew, "value").filter((fact) => fact.rowIndex === 1).map((fact) => fact.columnIndex)).toEqual([1, 2]);
    expect(texts(facts).slice(7, 15)).toEqual([
      { kind: "text", text: "Grace Hopper" },
      { kind: "text", text: "555-0111" },
      { kind: "text", text: "grace@example.test" },
      { kind: "text", text: "José & Renée" },
      { kind: "text", text: "Line one\nLine two" },
      { kind: "text", text: "Unknown &bogus; ref" },
      { kind: "text", text: "– dash" },
      { kind: "text", text: "Ridgeway" },
    ]);
    // `&nbsp;` alone is a blank cell: the row still reaches column 3.
    expect(ofKind(facts, "row")[5]).toEqual({ kind: "row", rowIndex: 5, cellCount: 3 });
  });

  it("never lets markup or script text into a fact, and inventories every active part", async () => {
    const facts = await fixture("html-table/active-content.html");
    const serialized = JSON.stringify(facts);
    for (const leaked of ["INJECTED", "alert", "steal", "STYLED", "<", "hidden", "typed", "not markup"]) {
      expect(serialized, leaked).not.toContain(leaked);
    }
    expect(texts(facts)).toEqual([
      { kind: "text", text: "Clickable" },
      { kind: "text", text: "Pictured" },
      { kind: "text", text: "Run me" },
      { kind: "text", text: "Report" },
      { kind: "text", text: "Top" },
      { kind: "text", text: "After script" },
      { kind: "text", text: "No row tag" },
      { kind: "text", text: "stray close above" },
      { kind: "text", text: "Outer\ninner a inner b\ninner c\ntail" },
      { kind: "text", text: "Object" },
      { kind: "text", text: "Cdata" },
    ]);
    expect(ofKind(facts, "preserved-part").map(({ partKind, location }) => [partKind, location])).toEqual([
      ["external-link", "Workbook"],
      ["script", "Workbook"],
      ["script", "Workbook"],
      ["script", "Workbook"],
      ["script", "'Table 1'!A1"],
      ["image", "'Table 1'!B1"],
      ["script", "'Table 1'!A2"],
      ["external-link", "'Table 1'!B2"],
      ["hyperlink", "'Table 1'!A3"],
      ["form-control", "'Table 1'!B3"],
      ["script", "'Table 1'!B3"],
      ["embedded-object", "'Table 1'!B5"],
      ["cell-styling", "Table 1"],
      ["external-link", "Workbook"],
    ]);
  });

  it("types Excel's x:num, x:bool and x:err cells and classifies mso-number-format", async () => {
    const facts = await fixture("html-table/excel-export.xls");
    expect(ofKind(facts, "sheet")[0]?.name).toBe("Q3 Invoices");
    expect(texts(facts).slice(5)).toEqual([
      { kind: "text", text: "INV-001" },
      { kind: "decimal", decimal: "1234.5" },
      { kind: "decimal", decimal: "45366" },
      { kind: "boolean", boolean: true },
      { kind: "decimal", decimal: "0.25" },
      { kind: "text", text: "INV-002 – Café" },
      { kind: "decimal", decimal: "3703.5" },
      { kind: "decimal", decimal: "45380" },
      { kind: "boolean", boolean: false },
      { kind: "invalid-preserved", sourceText: "#DIV/0!" },
    ]);
    expect(ofKind(facts, "cell-format").map(({ columnIndex, numberFormat, formatClass, currencySymbol }) => [columnIndex, numberFormat, formatClass, currencySymbol])).toEqual([
      [1, '"$"#,##0.00', "currency", "$"],
      [2, "m/d/yyyy", "date", null],
      [4, "0.00%", "percent", null],
    ]);
    // Formulas are not read; that the sheet had some is stated once.
    expect(ofKind(facts, "formula")).toEqual([]);
    expect(ofKind(facts, "preserved-part").map((fact) => fact.partKind)).toEqual(["formula", "cell-styling"]);
  });
});

describe("the demo relationship pair as HTML (CAP-27, for S06 CP4)", () => {
  it("holds fieldwork-q3.xlsx's Jobs and Customers values and formats, and no formula at all", async () => {
    const zip = await openZipContainer(bytesSource(await fixtureBytes("ooxml/fieldwork-q3.xlsx")));
    const xlsx: WorkbookFactV2[] = [];
    for await (const item of ooxmlAdapter.parseSheets({ kind: "zip", zip }, [0, 1], { cancellation: { aborted: false } })) {
      if (item.kind === "batch") xlsx.push(...item.facts);
    }
    const facts = await fixture("html-table/fieldwork-jobs-customers.html");
    const cells = (all: readonly WorkbookFactV2[]) => ofKind(all, "value").map(({ rowIndex, columnIndex, value }) => [rowIndex, columnIndex, value]);
    expect(cells(facts)).toEqual(cells(xlsx));
    expect(ofKind(facts, "cell-format").map(({ rowIndex, columnIndex, formatClass }) => [rowIndex, columnIndex, formatClass])).toEqual(
      ofKind(xlsx, "cell-format").map(({ rowIndex, columnIndex, formatClass }) => [rowIndex, columnIndex, formatClass]),
    );
    // Value-only: key matching is the only relationship signal this format offers.
    expect(ofKind(facts, "formula")).toEqual([]);
    expect(ofKind(facts, "declared-table")).toEqual([]);
  });
});

describe("HTML-table encodings", () => {
  it("reads an undeclared export as Windows-1252", async () => {
    expect(texts(await fixture("html-table/windows-1252.html")).slice(2)).toEqual([
      { kind: "text", text: "Café Noir" },
      { kind: "text", text: "€ 12 – “net”" },
      { kind: "text", text: "Façade Ltd" },
      { kind: "text", text: "Straße ½" },
    ]);
  });

  it("decides the encoding by BOM, then meta charset, else Windows-1252", async () => {
    expect(detectHtmlEncoding(Uint8Array.of(0xef, 0xbb, 0xbf, 0x3c))).toEqual({ encoding: "utf-8", bomByteLength: 3 });
    expect(detectHtmlEncoding(Uint8Array.of(0xff, 0xfe, 0x3c, 0))).toEqual({ encoding: "utf-16le", bomByteLength: 2 });
    expect(detectHtmlEncoding(html('<meta charset="UTF-8">'))).toEqual({ encoding: "utf-8", bomByteLength: 0 });
    expect(detectHtmlEncoding(html("<meta http-equiv=Content-Type content='text/html; charset=iso-8859-1'>")).encoding).toBe("windows-1252");
    expect(detectHtmlEncoding(html('<meta charset="utf-16">')).encoding).toBe("utf-8");
    expect(detectHtmlEncoding(html('<meta charset="no-such-code-page">')).encoding).toBe("windows-1252");
    expect(detectHtmlEncoding(html("<table>")).encoding).toBe("windows-1252");

    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from("<table><tr><td>Ünïcode</td></tr></table>", (character) => [character.charCodeAt(0), 0]).flat()]);
    expect(texts(factsOf(await parse(utf16)))).toEqual([{ kind: "text", text: "Ünïcode" }]);

    const declared = html('<meta charset="utf-8"><table><tr><td>Zoë</td></tr></table>');
    expect(texts(factsOf(await parse(declared)))).toEqual([{ kind: "text", text: "Zoë" }]);
    // UTF-8 bytes read by the default rule are what the rule says, not a guess.
    expect(texts(factsOf(await parse(html("<table><tr><td>Zoë</td></tr></table>"))))).toEqual([{ kind: "text", text: "ZoÃ«" }]);
  });

  it("normalizes to NFC and flags replacement characters, with diagnostics", async () => {
    const items = await parse(html('<meta charset="utf-8"><table><tr><td>Café</td><td>&#0;</td></tr></table>'));
    expect(texts(factsOf(items))).toEqual([
      { kind: "text", text: "Café" },
      { kind: "text", text: "�" },
    ]);
    expect(items.at(-1)).toMatchObject({
      diagnostics: [
        { code: "text-normalized-nfc", occurrences: 1 },
        { code: "replacement-character", occurrences: 1 },
      ],
    });
  });
});

describe("HTML-table entities", () => {
  it("decodes the fixed table and numeric references, keeping unknown names literal", () => {
    expect(decodeCharacterReferences("&amp;&lt;&gt;&quot;&apos;&nbsp;&copy;&yuml;&euro;&hellip;&mdash;")).toBe("&<>\"' ©ÿ€…—");
    expect(decodeCharacterReferences("&#65;&#x42;&#150;&#128;&#0;&#xD800;&#1114112;")).toBe("AB–€���");
    expect(decodeCharacterReferences("&bogus; & ; &amp")).toBe("&bogus; & ; &amp");
  });
});

describe("HTML-table bounds", () => {
  it("refuses a cell past the grid and clamps spans as HTML does", async () => {
    await expect(parse(html(`<table><tr>${"<td>x".repeat(16_385)}</tr></table>`))).rejects.toThrow("impossible-dimension");
    const clamped = factsOf(await parse(html('<table><tr><td colspan="99999" rowspan="0">wide</td></tr></table>')));
    expect(ofKind(clamped, "merge")).toEqual([{ kind: "merge", range: { firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 999 } }]);
  });

  it("refuses nesting past the depth bound and an unterminated construct past the markup bound", async () => {
    await expect(parse(html(`<table><tr><td>${"<table>".repeat(300)}</td></tr></table>`))).rejects.toThrow("malformed-structure");
    await expect(parse(html(`<table><tr><td x="${"a".repeat(1_100_000)}`))).rejects.toThrow("malformed-structure");
  });

  it("refuses a stream past the value-cell budget", async () => {
    const rows = Array.from({ length: 1_251 }, () => `<tr>${"<td>1".repeat(200)}`).join("");
    await expect(parse(html(`<table>${rows}</table>`))).rejects.toThrow("expansion-limit");
  });
});

describe("HTML-table selection and cancellation", () => {
  it("streams only the selected tables; the first carries the document's parts", async () => {
    const sites = await fixture("html-table/merged-headers.html", [1]);
    expect(ofKind(sites, "sheet").map((fact) => [fact.sheetIndex, fact.name])).toEqual([[1, "Sites"]]);

    const unknownList = html(`<table><tr><td>a</td></tr></table>${" ".repeat(SNIFF_SAMPLE_BYTES)}<table><tr><td>b</td></tr></table>`);
    expect(ofKind(factsOf(await parse(unknownList, [0])), "sheet").map((fact) => fact.name)).toEqual(["Table 1", "Table 2"]);
    expect(await parse(unknownList, [])).toEqual([
      { kind: "summary", rowCount: 0, columnCount: 0, valueCount: 0, batchCount: 0, diagnostics: [] },
    ]);
  });

  it("ends a cancelled stream without a summary", async () => {
    const cancellation = { aborted: false };
    const items: WorkbookFactStreamItemV2[] = [];
    const source = bytesSource(await fixtureBytes("html-table/merged-headers.html"));
    for await (const item of htmlTableAdapter.parseSheets({ kind: "text", source }, ALL, { cancellation, factsPerBatch: 4 })) {
      items.push(item);
      cancellation.aborted = true;
    }
    expect(items).toHaveLength(1);
    assertConformingStream(items, { factsPerBatch: 4, isComplete: false });
  });
});

describe("HTML tokenizer", () => {
  const tokens = async (chunks: readonly string[]): Promise<HtmlTokenV1[]> => {
    const all: HtmlTokenV1[] = [];
    for await (const token of tokenizeHtml(chunks)) all.push(token);
    // Adjacent text tokens are one run however the input was chunked.
    return all.reduce<HtmlTokenV1[]>((merged, token) => {
      const last = merged.at(-1);
      if (token.kind === "text" && last?.kind === "text") merged[merged.length - 1] = { kind: "text", value: last.value + token.value };
      else merged.push(token);
      return merged;
    }, []);
  };

  it("yields the same tokens however the input is chunked", async () => {
    const text = new TextDecoder().decode(await fixtureBytes("html-table/active-content.html"));
    const whole = await tokens([text]);
    expect(await tokens(Array.from(text))).toEqual(whole);
    expect(await tokens(text.match(/[\s\S]{1,7}/g) ?? [])).toEqual(whole);
  });

  it("skips script content without tokenizing it, and ends it only at its own end tag", async () => {
    expect(await tokens(["<script>a = '</td><td>'; b = 1 < 2;</SCRIPT >after"])).toEqual([
      { kind: "start", name: "script", attributes: [] },
      { kind: "end", name: "script" },
      { kind: "text", value: "after" },
    ]);
  });

  it("reads unquoted, uppercase and valueless attributes", async () => {
    expect(await tokens(["<TD CLASS=xl65 x:num ALIGN='right' title=\"a &amp; b\">"])).toEqual([
      {
        kind: "start",
        name: "td",
        attributes: [
          { name: "class", value: "xl65" },
          { name: "x:num", value: "" },
          { name: "align", value: "right" },
          { name: "title", value: "a & b" },
        ],
      },
    ]);
  });
});
