/**
 * The ODS fidelity and refusal corpus, by path under
 * `tests/fixtures/workbooks/` (M58; CAP-27).
 *
 * The committed bytes are the test subject; this map is the evidence of how
 * each was made. `tests/unit/import/ods/corpus.test.ts` asserts every
 * generator reproduces its committed file exactly, and rewrites them when run
 * with `SHEAF_WRITE_FIXTURES=1`.
 */

import { buildOds, esc, FORMAT_STYLES, paragraphs, rowXml, type OdsCell } from "./build-ods.js";
import { buildDemoOds } from "./demo-pair.js";

const str = (text: string, attrs: Readonly<Record<string, string | number>> = {}): OdsCell => ({
  attrs: { "office:value-type": "string", "calcext:value-type": "string", ...attrs },
  inner: paragraphs(text),
});

const num = (value: number, display: string, attrs: Readonly<Record<string, string | number>> = {}): OdsCell => ({
  attrs: { "office:value-type": "float", "office:value": value, "calcext:value-type": "float", ...attrs },
  inner: paragraphs(display),
});

const header = (...names: string[]): string => rowXml(names.map((name) => str(name, { "table:style-name": "ce8" })));

/** Two sheets: a validation list, a range-sourced list, and a VLOOKUP into Products. */
const lookupValidation = (): Uint8Array =>
  buildOds({
    content: {
      automaticStyles: FORMAT_STYLES,
      validations:
        '<table:content-validation table:name="val1" table:condition="of:cell-content-is-in-list(&quot;Open&quot;;&quot;Shipped&quot;;&quot;Closed&quot;)" table:allow-empty-cell="true" table:base-cell-address="Orders.D2"/>' +
        '<table:content-validation table:name="val2" table:condition="of:cell-content-is-whole-number() and cell-content-is-between(1;100)" table:allow-empty-cell="true" table:base-cell-address="Orders.E2"/>' +
        '<table:content-validation table:name="val3" table:condition="of:cell-content-is-in-list([$Products.$A$2:.$A$4])" table:allow-empty-cell="true" table:base-cell-address="Orders.B2"/>',
      tables: [
        {
          name: "Orders",
          rows: [
            header("Order ID", "Product ID", "Product", "Status", "Qty"),
            ...[
              ["O-1", "P-1", "Gravel", "Open", 4],
              ["O-2", "P-3", "Topsoil", "Shipped", 12],
              ["O-3", "P-2", "Sand", "Closed", 1],
            ].map(([order, product, name, status, qty], index) =>
              rowXml([
                str(order as string),
                str(product as string, { "table:content-validation-name": "val3" }),
                str(name as string, { "table:formula": `of:=VLOOKUP([.B${index + 2}];[$Products.$A$2:.$B$4];2;0)` }),
                str(status as string, { "table:content-validation-name": "val1" }),
                num(qty as number, String(qty), { "table:content-validation-name": "val2" }),
              ]),
            ),
            rowXml([
              str("Total"),
              null,
              null,
              null,
              num(17, "17", { "table:formula": "of:=SUM([.E2:.E4])" }),
              num(17, "17", { "table:formula": "of:=SUM([.E2:.E3]~[.E4])" }),
              num(3, "3", { "table:formula": "of:=['file:///C:/prices.ods'#$Sheet1.A1]" }),
            ]),
          ],
        },
        {
          name: "Products",
          rows: [
            header("Product ID", "Name"),
            rowXml([str("P-1"), str("Gravel")]),
            rowXml([str("P-2"), str("Sand")]),
            rowXml([str("P-3"), str("Topsoil")]),
          ],
        },
      ],
      trailer:
        '<table:named-expressions><table:named-range table:name="ProductIds" table:base-cell-address="$Products.$A$1" table:cell-range-address="$Products.$A$2:.$A$4"/></table:named-expressions>' +
        '<table:database-ranges><table:database-range table:name="ProductsTable" table:target-range-address="Products.A1:Products.B4"/>' +
        '<table:database-range table:name="__Anonymous_Sheet_DB__0" table:target-range-address="Orders.A1:Orders.E4" table:display-filter-buttons="true"/></table:database-ranges>',
    },
    meta: { tableCount: 2, cellCount: 31 },
  });

/** Sparse repeats: a repeated value run, a repeated row, a blank gap and the million-row tail. */
const repeats = (): Uint8Array =>
  buildOds({
    content: {
      tables: [
        {
          name: "Repeats",
          columns: '<table:table-column table:number-columns-repeated="1024"/>',
          rows: [
            rowXml([str("A"), str("B"), { attrs: { "table:number-columns-repeated": 1022 } }]),
            rowXml([
              { attrs: { "office:value-type": "string", "table:number-columns-repeated": 3 }, inner: paragraphs("x") },
              { attrs: { "table:number-columns-repeated": 2 } },
              num(5, "5"),
              { attrs: { "table:number-columns-repeated": 1018 } },
            ]),
            rowXml([num(1, "1"), num(2, "2"), { attrs: { "table:number-columns-repeated": 1022 } }], {
              "table:number-rows-repeated": 2,
            }),
            rowXml([{ attrs: { "table:number-columns-repeated": 1024 } }], { "table:number-rows-repeated": 5 }),
            rowXml([str("after gap")]),
            rowXml([{ attrs: { "table:number-columns-repeated": 1024 } }], { "table:number-rows-repeated": 1_048_566 }),
          ],
        },
      ],
    },
  });

/** One value repeated 1,000 × 1,000: a million cells from 200 bytes. */
const hostileRepeat = (): Uint8Array =>
  buildOds({
    content: {
      tables: [
        {
          name: "Hostile",
          rows: [
            rowXml([{ attrs: { "office:value-type": "float", "office:value": 7, "table:number-columns-repeated": 1000 }, inner: paragraphs("7") }], {
              "table:number-rows-repeated": 1000,
            }),
          ],
        },
      ],
    },
  });

const typed = (type: string, attrs: Readonly<Record<string, string | number>>, display: string, style: string): OdsCell => ({
  attrs: { "office:value-type": type, ...attrs, "calcext:value-type": type, "table:style-name": style },
  inner: paragraphs(display),
});

/** Every ODS value type, its data style, and the values that do not fit. */
const formats = (): Uint8Array =>
  buildOds({
    content: {
      automaticStyles: FORMAT_STYLES,
      tables: [
        {
          name: "Formats",
          rows: [
            header("Kind", "Value"),
            rowXml([str("currency"), typed("currency", { "office:currency": "USD", "office:value": "1234.5" }, "$1,234.50", "ce1")]),
            rowXml([str("percentage"), typed("percentage", { "office:value": "0.125" }, "12.5%", "ce2")]),
            rowXml([str("date"), typed("date", { "office:date-value": "2024-03-15" }, "2024-03-15", "ce3")]),
            rowXml([str("datetime"), typed("date", { "office:date-value": "2024-03-15T08:30:00" }, "2024-03-15 08:30", "ce4")]),
            rowXml([str("time"), typed("time", { "office:time-value": "PT08H30M00S" }, "08:30:00", "ce5")]),
            rowXml([str("boolean"), typed("boolean", { "office:boolean-value": "true" }, "TRUE", "ce6")]),
            rowXml([str("number"), typed("float", { "office:value": "3.14159" }, "3.14", "ce7")]),
            rowXml([str("early date"), typed("date", { "office:date-value": "1900-01-01" }, "1900-01-01", "ce3")]),
            rowXml([
              str("error"),
              {
                attrs: { "table:formula": "of:=1/0", "office:value-type": "float", "office:value": "0", "calcext:value-type": "error" },
                inner: paragraphs("#DIV/0!"),
              },
            ]),
            rowXml([str("malformed"), { attrs: { "office:value-type": "float", "office:value": "abc" }, inner: paragraphs("abc") }]),
            rowXml([str("nfd"), str("Cafe\u0301")]),
            rowXml([
              str("paragraphs"),
              {
                attrs: { "office:value-type": "string" },
                inner: "<text:p>Line one</text:p><text:p>Line<text:s/> two<text:tab/>end<text:line-break/>last</text:p>",
              },
            ]),
          ],
        },
      ],
    },
  });

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const CHART_CONTENT =
  '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2"><office:body><office:chart/></office:body></office:document-content>';

/** Inert content: an annotation, a link, a merge, a chart, an image, a hidden sheet, styling. */
const annotationChart = (): Uint8Array =>
  buildOds({
    content: {
      automaticStyles: FORMAT_STYLES,
      tables: [
        {
          name: "Site log",
          styleName: "ta1",
          prelude:
            '<table:shapes><draw:frame draw:z-index="0" draw:name="Logo" svg:width="2cm" svg:height="1cm" svg:x="5cm" svg:y="1cm">' +
            '<draw:image xlink:href="Pictures/logo.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></table:shapes>',
          rows: [
            header("Note", "Link"),
            rowXml([
              {
                attrs: { "office:value-type": "string" },
                inner: `<office:annotation><dc:creator>Ops</dc:creator>${paragraphs("Check the gate code")}</office:annotation>${paragraphs("Gate open")}`,
              },
              {
                attrs: { "office:value-type": "string" },
                inner: `<text:p><text:a xlink:type="simple" xlink:href="${esc("https://example.test/site?a=1&b=2")}">Site page</text:a></text:p>`,
              },
            ]),
            rowXml([
              { attrs: { "office:value-type": "string", "table:number-columns-spanned": 2, "table:number-rows-spanned": 1 }, inner: paragraphs("Merged heading") },
              { covered: true },
            ]),
            rowXml([
              {
                inner:
                  "<draw:frame draw:z-index=\"1\" draw:name=\"Chart 1\" table:end-cell-address=\"'Site log'.D8\" svg:width=\"8cm\" svg:height=\"5cm\">" +
                  "<draw:object draw:notify-on-update-of-ranges=\"'Site log'.A1:'Site log'.B3\" xlink:href=\"./Object 1\" xlink:type=\"simple\" xlink:show=\"embed\" xlink:actuate=\"onLoad\"/>" +
                  '<draw:image xlink:href="./ObjectReplacements/Object 1" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>',
              },
            ]),
          ],
          trailer:
            "<calcext:conditional-formats><calcext:conditional-format calcext:target-range-address=\"'Site log'.A2:'Site log'.A3\">" +
            '<calcext:condition calcext:apply-style-name="ce8" calcext:value="begins-with(&quot;Gate&quot;)" calcext:base-cell-address="\'Site log\'.A2"/>' +
            "</calcext:conditional-format></calcext:conditional-formats>",
        },
        { name: "Hidden notes", styleName: "ta2", rows: [rowXml([str("secret")])] },
      ],
    },
    extraEntries: [
      { name: "Pictures/logo.png", data: PNG, mediaType: "image/png", method: "stored" },
      { name: "Object 1/content.xml", data: CHART_CONTENT, mediaType: "text/xml" },
      { name: "ObjectReplacements/Object 1", data: PNG, mediaType: "application/x-openoffice-gdimetafile;windows_formatname=\"GDIMetaFile\"", method: "stored" },
    ],
    manifestEntries: [{ path: "Object 1/", mediaType: "application/vnd.oasis.opendocument.chart" }],
  });

const SMALL_TABLE = { name: "Ledger", rows: [rowXml([str("Account"), str("Balance")]), rowXml([str("Cash"), num(120, "120")])] };

/** ODF package encryption: the manifest says `content.xml` is encrypted. */
const encrypted = (): Uint8Array => buildOds({ content: { tables: [SMALL_TABLE] }, encrypted: ["content.xml"] });

const BASIC_MODULE =
  '<?xml version="1.0" encoding="UTF-8"?>\n<script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module1" script:language="StarBasic">Sub Main\nEnd Sub</script:module>';

/** A StarBasic library: macro content, refused whole. */
const basicMacro = (): Uint8Array =>
  buildOds({
    content: { tables: [SMALL_TABLE] },
    extraEntries: [
      { name: "Basic/script-lc.xml", data: '<?xml version="1.0" encoding="UTF-8"?>\n<library:libraries xmlns:library="http://openoffice.org/2000/library"/>', mediaType: "text/xml" },
      { name: "Basic/Standard/Module1.xml", data: BASIC_MODULE, mediaType: "text/xml" },
    ],
  });

/** No `settings.xml`: the sheet names are unknowable without reading cells. */
const noSettings = (): Uint8Array =>
  buildOds({
    content: { tables: [SMALL_TABLE, { name: "Notes", rows: [rowXml([str("Reviewed")])] }] },
    settings: null,
    meta: { tableCount: 2, cellCount: 5 },
  });

export const ODS_CORPUS: ReadonlyMap<string, () => Uint8Array> = new Map([
  ["ods/lookup-validation.ods", lookupValidation],
  ["ods/repeats.ods", repeats],
  ["ods/hostile-repeat.ods", hostileRepeat],
  ["ods/formats.ods", formats],
  ["ods/annotation-chart.ods", annotationChart],
  ["ods/encrypted.ods", encrypted],
  ["ods/basic-macro.ods", basicMacro],
  ["ods/no-settings.ods", noSettings],
  ["ods/fieldwork-jobs-customers.ods", buildDemoOds],
]);
