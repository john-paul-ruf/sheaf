import { describe, expect, it } from "vitest";
import type { WorkbookFactV2 } from "../../../../src/import/facts/index.js";
import { readChartDefinition } from "../../../../src/import/formats/ooxml/charts.js";
import { ooxmlAdapter } from "../../../../src/import/formats/ooxml/index.js";
import { openZipContainer } from "../../../../src/import/source/zip.js";
import { ooxmlEntries, type WorkbookSpec } from "../../../fixtures/workbooks/build/ooxml-builder.js";
import { writeZip } from "../../../fixtures/workbooks/build/zip-writer.js";
import { bytesSource } from "../fixtures.js";

const TRANSITIONAL = {
  c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
};
const STRICT = {
  c: "http://purl.oclc.org/ooxml/drawingml/chart",
  a: "http://purl.oclc.org/ooxml/drawingml/main",
};

const PART = "xl/charts/chart1.xml";

const chartSpace = (chart: string, ns = TRANSITIONAL): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${ns.c}" xmlns:a="${ns.a}"><c:chart>${chart}</c:chart></c:chartSpace>`;

const plotArea = (...plots: string[]): string =>
  `<c:plotArea><c:layout/>${plots.join("")}<c:catAx><c:axId val="10"/></c:catAx><c:valAx><c:axId val="20"/></c:valAx></c:plotArea>`;

const ref = (tag: string, formula: string, cache = ""): string =>
  `<c:${tag}><c:f>${formula}</c:f>${cache}</c:${tag}>`;

const ser = (index: number, body: string): string =>
  `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${body}</c:ser>`;

const categorySeries = (index: number, category: string, values: string): string =>
  ser(index, `<c:cat>${ref("strRef", category)}</c:cat><c:val>${ref("numRef", values)}</c:val>`);

const plot = (local: string, head: string, ...series: string[]): string =>
  `<c:${local}>${head}${series.join("")}<c:axId val="10"/><c:axId val="20"/></c:${local}>`;

const read = async (xml: string) => {
  const zip = await openZipContainer(bytesSource(writeZip([{ name: PART, data: xml }])));
  return readChartDefinition(zip, PART);
};

const definitionOf = async (xml: string) => {
  const result = await read(xml);
  expect(result.refusal).toBeNull();
  return result.definition;
};

const JOBS_SERIES = categorySeries(0, "Jobs!$D$2:$D$61", "Jobs!$E$2:$E$61");

describe("chart part definitions (CA-31)", () => {
  it.each([
    ["barChart", "bar"],
    ["bar3DChart", "bar"],
    ["lineChart", "line"],
    ["line3DChart", "line"],
    ["pieChart", "pie"],
    ["pie3DChart", "pie"],
    ["doughnutChart", "pie"],
    ["scatterChart", "scatter"],
    ["areaChart", "area"],
    ["area3DChart", "area"],
    ["radarChart", "other"],
    ["ofPieChart", "other"],
    ["stockChart", "other"],
    ["bubbleChart", "other"],
    ["surfaceChart", "other"],
  ] as const)("maps a %s plot to %s", async (local, chartType) => {
    const definition = await definitionOf(chartSpace(plotArea(plot(local, "", JOBS_SERIES))));
    expect(definition).toMatchObject({ chartType });
    expect(definition?.series).toHaveLength(1);
  });

  it("reads a clustered column chart's direction, grouping, title and series references", async () => {
    const title = `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:rPr b="1"/><a:t>Quoted </a:t></a:r><a:r><a:t>by status</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
    const series = ser(
      0,
      `<c:tx>${ref("strRef", "Jobs!$E$1", "<c:strCache><c:ptCount val=\"1\"/><c:pt idx=\"0\"><c:v>Quoted amount</c:v></c:pt></c:strCache>")}</c:tx>` +
        `<c:cat>${ref("strRef", "Jobs!$D$2:$D$61", "<c:strCache><c:pt idx=\"0\"><c:v>Waiting</c:v></c:pt></c:strCache>")}</c:cat>` +
        `<c:val>${ref("numRef", "Jobs!$E$2:$E$61", "<c:numCache><c:formatCode>General</c:formatCode><c:pt idx=\"0\"><c:v>287</c:v></c:pt></c:numCache>")}</c:val>`,
    );
    const xml = chartSpace(
      `${title}<c:autoTitleDeleted val="0"/>${plotArea(plot("barChart", '<c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>', series))}<c:plotVisOnly val="1"/>`,
    );
    expect(await definitionOf(xml)).toEqual({
      chartType: "bar",
      barDirection: "col",
      grouping: "clustered",
      title: "Quoted by status",
      series: [{ name: "Jobs!$E$1", categoriesRef: "Jobs!$D$2:$D$61", valuesRef: "Jobs!$E$2:$E$61", xRef: null, yRef: null }],
    });
  });

  it.each([
    ["barChart", '<c:barDir val="bar"/><c:grouping val="stacked"/>', { barDirection: "bar", grouping: "stacked" }],
    ["barChart", '<c:barDir val="col"/><c:grouping val="percentStacked"/>', { barDirection: "col", grouping: "percentStacked" }],
    ["barChart", '<c:barDir/><c:grouping/>', { barDirection: "col", grouping: "clustered" }],
    ["barChart", '<c:barDir val="col"/>', { barDirection: "col", grouping: null }],
    ["lineChart", '<c:grouping val="standard"/>', { barDirection: null, grouping: "standard" }],
    ["lineChart", '<c:grouping val="stacked"/>', { barDirection: null, grouping: "stacked" }],
    ["areaChart", "<c:grouping/>", { barDirection: null, grouping: "standard" }],
    ["areaChart", '<c:grouping val="sideways"/>', { barDirection: null, grouping: null }],
    ["pieChart", '<c:varyColors val="1"/>', { barDirection: null, grouping: null }],
  ] as const)("reads %s with %s", async (local, head, expected) => {
    expect(await definitionOf(chartSpace(plotArea(plot(local, head, JOBS_SERIES))))).toMatchObject(expected);
  });

  it("reads a scatter plot's x and y references and a literal series name", async () => {
    const series = ser(0, `<c:tx><c:v>Hours by rate</c:v></c:tx><c:xVal>${ref("numRef", "Crew!$C$2:$C$9")}</c:xVal><c:yVal>${ref("numRef", "Crew!$D$2:$D$9")}</c:yVal>`);
    expect(await definitionOf(chartSpace(plotArea(plot("scatterChart", '<c:scatterStyle val="lineMarker"/>', series))))).toEqual({
      chartType: "scatter",
      barDirection: null,
      grouping: null,
      title: null,
      series: [{ name: "Hours by rate", categoriesRef: null, valuesRef: null, xRef: "Crew!$C$2:$C$9", yRef: "Crew!$D$2:$D$9" }],
    });
  });

  it("keeps each series in document order, and a literal category list as no reference", async () => {
    const literal = ser(1, `<c:cat><c:strLit><c:ptCount val="1"/><c:pt idx="0"><c:v>North</c:v></c:pt></c:strLit></c:cat><c:val>${ref("numRef", "Crew!$B$2")}</c:val>`);
    const definition = await definitionOf(chartSpace(plotArea(plot("barChart", '<c:barDir val="bar"/>', JOBS_SERIES, literal))));
    expect(definition?.series.map((each) => [each.categoriesRef, each.valuesRef])).toEqual([
      ["Jobs!$D$2:$D$61", "Jobs!$E$2:$E$61"],
      [null, "Crew!$B$2"],
    ]);
  });

  it("calls a combo chart other, with the series of every plot", async () => {
    const definition = await definitionOf(
      chartSpace(
        plotArea(
          plot("barChart", '<c:barDir val="col"/><c:grouping val="clustered"/>', JOBS_SERIES),
          plot("lineChart", '<c:grouping val="standard"/>', categorySeries(1, "Jobs!$D$2:$D$61", "Jobs!$F$2:$F$61")),
        ),
      ),
    );
    expect(definition).toMatchObject({ chartType: "other", barDirection: null, grouping: null });
    expect(definition?.series.map((each) => each.valuesRef)).toEqual(["Jobs!$E$2:$E$61", "Jobs!$F$2:$F$61"]);
  });

  it("ignores axis titles and caps the chart title at 256 characters, NFC", async () => {
    const long = "é".repeat(300);
    const xml = chartSpace(
      `<c:title><c:tx><c:rich><a:p><a:r><a:t>${long}</a:t></a:r></a:p></c:rich></c:tx></c:title>` +
        plotArea(plot("barChart", "", JOBS_SERIES)).replace(
          "<c:valAx>",
          "<c:valAx><c:title><c:tx><c:rich><a:p><a:r><a:t>Axis</a:t></a:r></a:p></c:rich></c:tx></c:title>",
        ),
    );
    const title = (await definitionOf(xml))?.title ?? "";
    expect(title).toBe("é".repeat(256));
  });

  it("reads Strict and Transitional chart parts to the same definition", async () => {
    const body = plotArea(plot("barChart", '<c:barDir val="bar"/><c:grouping val="stacked"/>', JOBS_SERIES));
    const strict = await definitionOf(chartSpace(body, STRICT));
    expect(strict).toMatchObject({ chartType: "bar", barDirection: "bar", grouping: "stacked" });
    expect(strict).toEqual(await definitionOf(chartSpace(body)));
  });

  it("gives no definition for a chart part with no plot, or that is not a chart", async () => {
    expect(await read(chartSpace(""))).toEqual({ definition: null, refusal: "not-declared" });
    expect(await read(`<c:chartSpace xmlns:c="${TRANSITIONAL.c}"><c:chart/></c:chartSpace>`)).toEqual({ definition: null, refusal: "not-declared" });
    expect(await read(`<chartSpace xmlns="urn:not-a-chart"><chart/></chartSpace>`)).toEqual({ definition: null, refusal: "not-declared" });
  });

  it("refuses a DTD-bearing chart part without expanding it", async () => {
    const xml = chartSpace(plotArea(plot("barChart", "", JOBS_SERIES))).replace(
      "\n",
      '\n<!DOCTYPE c:chartSpace [<!ENTITY boom "Jobs!$A$1">]>\n',
    );
    expect(await read(xml)).toEqual({ definition: null, refusal: "entity-declaration" });
  });

  it("holds 64 series and refuses a 65th", async () => {
    const many = (count: number) =>
      chartSpace(plotArea(plot("lineChart", "", ...Array.from({ length: count }, (_, index) => categorySeries(index, "Data!$A$2:$A$9", `Data!$B$${index + 2}`)))));
    expect((await definitionOf(many(64)))?.series).toHaveLength(64);
    expect(await read(many(65))).toEqual({ definition: null, refusal: "over-bounds" });
  });

  it("holds a 1,024-character reference and refuses a longer one", async () => {
    const refOf = (length: number) => `Data!${"$A$1,".repeat(length)}`.slice(0, length);
    const chart = (formula: string) => chartSpace(plotArea(plot("barChart", "", categorySeries(0, "Data!$A$2:$A$9", formula))));
    expect((await definitionOf(chart(refOf(1_024))))?.series[0]?.valuesRef).toHaveLength(1_024);
    expect(await read(chart(refOf(1_025)))).toEqual({ definition: null, refusal: "over-bounds" });
  });
});

describe("chart definitions on the adapter's preserved-part facts", () => {
  const SPEC: WorkbookSpec = {
    sheets: [
      { name: "Data", rows: [["Status", "Quoted"], ["Open", 10]], charts: [{ range: "D2:K18" }] },
      { name: "Jobs chart", kind: "chartsheet", charts: [{ range: "A1:A1" }] },
    ],
  };
  const COLUMN = chartSpace(plotArea(plot("barChart", '<c:barDir val="col"/><c:grouping val="clustered"/>', categorySeries(0, "Data!$A$2:$A$2", "Data!$B$2:$B$2"))));

  const chartFacts = async (charts: Readonly<Record<string, string>>) => {
    const entries = ooxmlEntries(SPEC).map((entry) => (charts[entry.name] === undefined ? entry : { ...entry, data: charts[entry.name] as string }));
    const zip = await openZipContainer(bytesSource(writeZip(entries)));
    const facts: WorkbookFactV2[] = [];
    for await (const item of ooxmlAdapter.parseSheets({ kind: "zip", zip }, [0, 1], { cancellation: { aborted: false } })) {
      if (item.kind === "batch") facts.push(...item.facts);
    }
    return facts.filter((fact) => fact.kind === "preserved-part" && fact.partKind === "chart");
  };

  it("rides the chart fact of the anchoring sheet and of a chart sheet", async () => {
    const facts = await chartFacts({ "xl/charts/chart1.xml": COLUMN, "xl/charts/chart2.xml": COLUMN.replace('val="col"', 'val="bar"') });
    expect(facts[0]).toEqual({
      kind: "preserved-part",
      partKind: "chart",
      location: "Data!D2:K18",
      reasonKey: "chart-not-live-yet",
      anchor: { firstRow: 1, firstColumn: 3, lastRow: 17, lastColumn: 10 },
      partPath: "xl/charts/chart1.xml",
      definition: {
        chartType: "bar",
        barDirection: "col",
        grouping: "clustered",
        title: null,
        series: [{ name: null, categoriesRef: "Data!$A$2:$A$2", valuesRef: "Data!$B$2:$B$2", xRef: null, yRef: null }],
      },
    });
    expect(facts[1]).toMatchObject({ location: "'Jobs chart'!A1", definition: { chartType: "bar", barDirection: "bar" } });
    expect(facts).toHaveLength(2);
  });

  it("keeps a refused or empty chart part preserved exactly as before, with no definition key", async () => {
    const hostile = COLUMN.replace("\n", '\n<!DOCTYPE c:chartSpace [<!ENTITY x "y">]>\n');
    const facts = await chartFacts({ "xl/charts/chart1.xml": hostile });
    expect(facts).toHaveLength(2);
    for (const fact of facts) expect(Object.keys(fact)).not.toContain("definition");
  });
});
