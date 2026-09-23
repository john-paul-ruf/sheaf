import { describe, expect, it } from "vitest";
import type { WorkbookFactV2 } from "../../../../src/import/facts/index.js";
import { ooxmlAdapter } from "../../../../src/import/formats/ooxml/index.js";
import { readPivotDefinition } from "../../../../src/import/formats/ooxml/pivots.js";
import { openZipContainer } from "../../../../src/import/source/zip.js";
import { ooxmlEntries, type PivotSpec, type WorkbookSpec } from "../../../fixtures/workbooks/build/ooxml-builder.js";
import { writeZip, type ZipEntrySpec } from "../../../fixtures/workbooks/build/zip-writer.js";
import { bytesSource, fixtureBytes } from "../fixtures.js";

const PIVOT = "xl/pivotTables/pivotTable1.xml";
const CACHE = "xl/pivotCache/pivotCacheDefinition1.xml";

type Cache = NonNullable<PivotSpec["cache"]>;

const CREW_CACHE: Cache = {
  fields: ["Crew", "Hours", "Rate"],
  source: { sheet: "Data", ref: "A1:C4" },
  rowFields: [0],
  dataFields: [{ name: "Sum of Hours", fld: 1 }],
};

const specOf = (cache: Cache | undefined, strict = false): WorkbookSpec => ({
  strict,
  sheets: [
    { name: "Data", rows: [["Crew", "Hours", "Rate"], ["North", 8, 40], ["South", 6, 38], ["North", 4, 41]] },
    { name: "Summary", pivotTables: [cache === undefined ? { name: "HoursPivot", ref: "A3:B5" } : { name: "HoursPivot", ref: "A3:B5", cache }] },
  ],
});

/** The pivot's parts, with any part's text swapped for a hostile one. */
const zipOf = async (spec: WorkbookSpec, change: (entry: ZipEntrySpec) => ZipEntrySpec = (entry) => entry) =>
  openZipContainer(bytesSource(writeZip(ooxmlEntries(spec).map(change))));

const replacing = (name: string, from: string, to: string) => (entry: ZipEntrySpec): ZipEntrySpec =>
  entry.name === name ? { ...entry, data: String(entry.data).replace(from, to) } : entry;

const read = async (cache: Cache | undefined, change?: (entry: ZipEntrySpec) => ZipEntrySpec) =>
  readPivotDefinition(await zipOf(specOf(cache), change), PIVOT);

const pivotFacts = async (bytes: Uint8Array): Promise<Extract<WorkbookFactV2, { kind: "preserved-part" }>[]> => {
  const zip = await openZipContainer(bytesSource(bytes));
  const facts: WorkbookFactV2[] = [];
  for await (const item of ooxmlAdapter.parseSheets({ kind: "zip", zip }, [0, 1], { cancellation: { aborted: false } })) {
    if (item.kind === "batch") facts.push(...item.facts);
  }
  return facts.filter((fact) => fact.kind === "preserved-part" && fact.partKind === "pivot-table") as Extract<
    WorkbookFactV2,
    { kind: "preserved-part" }
  >[];
};

describe("pivot table definitions (CA-31)", () => {
  it("rides pivot-table.xlsx's pivot fact: a sum by default and an explicit count", async () => {
    expect(await pivotFacts(await fixtureBytes("ooxml/pivot-table.xlsx"))).toEqual([
      {
        kind: "preserved-part",
        partKind: "pivot-table",
        location: "Summary!A3:C5",
        reasonKey: "pivot-not-live-yet",
        anchor: { firstRow: 2, firstColumn: 0, lastRow: 4, lastColumn: 2 },
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
      },
    ]);
  });

  it("keeps sum, count, average, min and max, and drops every other summary", async () => {
    const subtotals = ["sum", "count", "average", "min", "max", "product", "stdDev", "countNums", "var"];
    const result = await read({
      ...CREW_CACHE,
      dataFields: subtotals.map((subtotal, index) => ({ name: `Field ${index}`, fld: index % 3, subtotal })),
    });
    expect(result.definition?.dataFields).toEqual([
      { cacheFieldName: "Crew", subtotal: "sum" },
      { cacheFieldName: "Hours", subtotal: "count" },
      { cacheFieldName: "Rate", subtotal: "average" },
      { cacheFieldName: "Crew", subtotal: "min" },
      { cacheFieldName: "Hours", subtotal: "max" },
    ]);
  });

  it("names every row field, skipping the Values field", async () => {
    const result = await read({ ...CREW_CACHE, rowFields: [2, -2, 0] });
    expect(result).toEqual({
      definition: { sourceSheet: "Data", sourceRef: "A1:C4", rowFields: ["Rate", "Crew"], dataFields: [{ cacheFieldName: "Hours", subtotal: "sum" }] },
      refusal: null,
    });
  });

  it("reads a table- or name-based source as a reference with no sheet", async () => {
    expect((await read({ ...CREW_CACHE, source: { name: "CrewTable" } })).definition).toMatchObject({
      sourceSheet: null,
      sourceRef: "CrewTable",
    });
  });

  it("reads a Strict pivot to the same definition", async () => {
    const strict = await readPivotDefinition(await zipOf(specOf(CREW_CACHE, true)), PIVOT);
    expect(strict.definition).not.toBeNull();
    expect(strict).toEqual(await read(CREW_CACHE));
  });

  it.each([
    ["an external connection", 'type="worksheet"', 'type="external" connectionId="1"'],
    ["a consolidation", 'type="worksheet"', 'type="consolidation"'],
    ["another workbook's range", "<worksheetSource ", '<worksheetSource r:id="rId1" '],
    ["no source range at all", 'ref="A1:C4" sheet="Data"', ""],
  ])("gives no definition over %s", async (_, from, to) => {
    expect(await read(CREW_CACHE, replacing(CACHE, from, to))).toEqual({ definition: null, refusal: "unsupported-source" });
  });

  it.each([
    ["a row field past the cache", PIVOT, '<field x="0"/>', '<field x="3"/>'],
    ["a negative row field", PIVOT, '<field x="0"/>', '<field x="-1"/>'],
    ["a row field that is not a number", PIVOT, '<field x="0"/>', '<field x="zero"/>'],
    ["a data field past the cache", PIVOT, 'fld="1"', 'fld="99"'],
    ["a data field with no field", PIVOT, 'fld="1"', ""],
  ])("gives no definition for %s", async (_, part, from, to) => {
    expect(await read(CREW_CACHE, replacing(part, from, to))).toEqual({ definition: null, refusal: "malformed-structure" });
  });

  it("holds 256 cache fields and refuses a 257th", async () => {
    const fields = (count: number): Cache => ({ ...CREW_CACHE, fields: Array.from({ length: count }, (_, index) => `F${index}`) });
    expect((await read(fields(256))).definition?.rowFields).toEqual(["F0"]);
    expect(await read(fields(257))).toEqual({ definition: null, refusal: "over-bounds" });
  });

  it("gives no definition for F03's bare parts, which relate no cache", async () => {
    expect(await read(undefined)).toEqual({ definition: null, refusal: "not-declared" });
  });

  it("never opens the cached records, even when they are hostile", async () => {
    const records = "xl/pivotCache/pivotCacheRecords1.xml";
    const zip = await openZipContainer(
      bytesSource(
        writeZip([
          ...ooxmlEntries(specOf(CREW_CACHE)).map(replacing(CACHE, 'recordCount="0"', 'r:id="rId1" recordCount="1"')),
          {
            name: "xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels",
            data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords" Target="pivotCacheRecords1.xml"/></Relationships>`,
          },
          { name: records, data: '<!DOCTYPE r [<!ENTITY boom "x">]><pivotCacheRecords>&boom;</pivotCacheRecords>' },
        ]),
      ),
    );
    expect((await readPivotDefinition(zip, PIVOT)).definition).toMatchObject({ rowFields: ["Crew"] });
  });

  it("refuses a DTD-bearing cache part, and the pivot stays preserved without a definition", async () => {
    const hostile = (entry: ZipEntrySpec): ZipEntrySpec =>
      entry.name === CACHE ? { ...entry, data: String(entry.data).replace("\n", '\n<!DOCTYPE p [<!ENTITY x "y">]>\n') } : entry;
    expect(await read(CREW_CACHE, hostile)).toEqual({ definition: null, refusal: "entity-declaration" });
    const facts = await pivotFacts(writeZip(ooxmlEntries(specOf(CREW_CACHE)).map(hostile)));
    expect(facts).toHaveLength(1);
    expect(Object.keys(facts[0] ?? {})).not.toContain("definition");
    expect(facts[0]).toMatchObject({ location: "Summary!A3:B5", reasonKey: "pivot-not-live-yet" });
  });
});
