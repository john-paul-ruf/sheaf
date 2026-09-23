/**
 * The OOXML fidelity corpus (M58; architecture § Parser and fidelity corpus):
 * one small workbook per declared-structure feature the adapter must read.
 * Bytes are committed beside this file and pinned by the corpus test.
 */

import type { RowSpec, WorkbookSpec } from "../build/ooxml-builder.js";

const CREW_ROWS = [
  ["Name", "Role", "Rate"],
  ["Ada", "Lead", 41.5],
  ["Grace", "Technician", 38],
];

/** `formulas-live.xlsx`'s jobs: id, quoted, paid, and the cached RAND() value. */
const LIVE_JOBS: readonly (readonly [string, number, number, number])[] = [
  ["J-1", 400, 100, 0.42],
  ["J-2", 250, 250, 0.17],
  ["J-3", 900, 300, 0.93],
  ["J-4", 120, 0, 0.08],
  ["J-5", 610, 10, 0.61],
];

/** Jobs per month, the series most charts in `charts.xlsx` plot. */
const MONTHLY = { series: [{ nameRef: "Data!$B$1", cat: "Data!$A$2:$A$5", val: "Data!$B$2:$B$5" }] } as const;

export const FIDELITY_WORKBOOKS: ReadonlyMap<string, WorkbookSpec> = new Map<string, WorkbookSpec>([
  [
    "strict-namespace.xlsx",
    {
      strict: true,
      sheets: [
        {
          name: "Crew",
          rows: CREW_ROWS,
          tables: [{ name: "CrewTable", ref: "A1:C3", columns: ["Name", "Role", "Rate"] }],
          merges: ["E1:F1"],
        },
      ],
    },
  ],
  [
    "date-1904.xlsx",
    {
      date1904: true,
      styles: { numFmts: [{ id: 164, code: "yyyy-mm-dd" }], cellXfs: [{ numFmtId: 0 }, { numFmtId: 164 }, { numFmtId: 22 }] },
      sheets: [
        {
          name: "Visits",
          rows: [
            ["Visit", "Date", "Logged"],
            ["V-1", { value: 43000, style: 1 }, { value: 43000.5, style: 2 }],
            ["V-2", { value: 43031, style: 1 }, { value: 43031.25, style: 2 }],
          ],
        },
      ],
    },
  ],
  [
    "inline-strings.xlsx",
    {
      sheets: [{ name: "Notes", rows: [[{ inline: "Site" }, { inline: " padded " }], [{ inline: "Café" }, { inline: "Ridgeway" }]] }],
    },
  ],
  [
    "rich-text.xlsx",
    {
      sheets: [{ name: "Notes", rows: [["Note"], [{ rich: ["Due ", "Friday", " at noon"] }], [{ rich: ["Plain"] }]] }],
    },
  ],
  [
    "formulas.xlsx",
    {
      externalLinks: 1,
      sheets: [
        {
          name: "Totals",
          rows: [
            ["Qty", "Price", "Total", "Double", "Linked"],
            [2, 3, { value: 6, formula: { shared: { si: 0, ref: "C2:C4", text: "A2*B2" } } }, { value: 4, formula: { array: { ref: "D2:D3", text: "A2:A3*2" } } }, { value: 10, formula: { text: "[1]Sheet1!A1" } }],
            [4, 5, { value: 20, formula: { shared: { si: 0 } } }, 8],
            [1, 1, { value: 1, formula: { shared: { si: 0 } } }],
            [{ formula: { text: "SUM(A2:A4)" } }, undefined, { value: "high", formula: { text: 'IF(C2>5,"high","low")' } }],
          ],
        },
      ],
    },
  ],
  [
    "multiple-regions.xlsx",
    {
      sheets: [
        {
          name: "Board",
          rows: [
            ["Job", "Status", "Crew", undefined, undefined, "Crew", "Phone"],
            ["J-1", "Open", "North", undefined, undefined, "North", "555-0101"],
            ["J-2", "Done", "South", undefined, undefined, "South", "555-0102"],
            ["J-3", "Open", "North"],
            [],
            [],
            [],
            ["Material", "Stock"],
            ["Gravel", 12],
            ["Sand", 4],
          ],
        },
      ],
    },
  ],
  [
    "hidden-sheets.xlsx",
    {
      sheets: [
        { name: "Visible", rows: [["A"], [1]] },
        { name: "Hidden", state: "hidden", rows: [["B"], [2]] },
        { name: "Very hidden", state: "veryHidden", rows: [["C"], [3]] },
      ],
    },
  ],
  [
    "chartsheet.xlsx",
    {
      sheets: [
        { name: "Data", rows: [["Month", "Jobs"], ["Jan", 12], ["Feb", 15]] },
        { name: "Jobs chart", kind: "chartsheet", charts: [{ range: "A1:A1" }] },
      ],
    },
  ],
  [
    "charts.xlsx",
    {
      sheets: [
        {
          name: "Data",
          rows: [
            ["Month", "Jobs", "Hours", "Rate"],
            ["Jan", 12, 96, 38],
            ["Feb", 15, 118, 39],
            ["Mar", 9, 70, 41],
            ["Apr", 14, 104, 40],
          ],
        },
        { name: "Other", rows: [["Month", "Visits"], ["Jan", 4], ["Feb", 6], ["Mar", 3], ["Apr", 5]] },
        {
          name: "Charts",
          charts: [
            { range: "A1:H15", ...MONTHLY, type: "barChart", barDir: "col", grouping: "clustered", title: "Jobs by month" },
            {
              range: "J1:Q15",
              type: "barChart",
              barDir: "bar",
              grouping: "stacked",
              series: [
                { nameRef: "Data!$B$1", cat: "Data!$A$2:$A$5", val: "Data!$B$2:$B$5" },
                { nameRef: "Data!$C$1", cat: "Data!$A$2:$A$5", val: "Data!$C$2:$C$5" },
              ],
            },
            { range: "S1:Z15", ...MONTHLY, type: "bar3DChart", barDir: "col", grouping: "percentStacked" },
            { range: "A17:H31", ...MONTHLY, type: "lineChart", grouping: "standard" },
            { range: "J17:Q31", ...MONTHLY, type: "pieChart" },
            { range: "S17:Z31", ...MONTHLY, type: "doughnutChart" },
            {
              range: "A33:H47",
              type: "scatterChart",
              title: "Hours by rate",
              series: [{ name: "Hours", x: "Data!$D$2:$D$5", y: "Data!$C$2:$C$5" }],
            },
            { range: "J33:Q47", ...MONTHLY, type: "areaChart", grouping: "standard" },
            {
              range: "S33:Z47",
              type: "barChart",
              barDir: "col",
              grouping: "clustered",
              series: [{ nameRef: "Other!$B$1", cat: "Data!$A$2:$A$5", val: "Other!$B$2:$B$5" }],
            },
          ],
        },
      ],
    },
  ],
  [
    "pivot-table.xlsx",
    {
      sheets: [
        { name: "Data", rows: [["Crew", "Hours"], ["North", 8], ["South", 6], ["North", 4]] },
        {
          name: "Summary",
          rows: [[], [], ["Crew", "Sum of Hours", "Count of Crew"], ["North", 12, 2], ["South", 6, 1]],
          pivotTables: [
            {
              name: "HoursPivot",
              ref: "A3:C5",
              cache: {
                fields: ["Crew", "Hours"],
                source: { sheet: "Data", ref: "A1:B4" },
                rowFields: [0],
                colFields: [-2],
                dataFields: [
                  { name: "Sum of Hours", fld: 1 },
                  { name: "Count of Crew", fld: 0, subtotal: "count" },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
  [
    "malformed-values.xlsx",
    {
      sheets: [
        {
          name: "Ledger",
          rows: [
            ["Amount", "Flag", "Check"],
            [{ raw: "12,5", type: "n" }, { raw: "2", type: "b" }, { error: "#N/A" }],
            [{ raw: "1e400", type: "n" }, { raw: "99", type: "s" }, { error: "#DIV/0!" }],
            [7.25, true, { raw: "2024-03-01", type: "d" }],
          ],
        },
      ],
    },
  ],
  [
    "preserved-parts.xlsx",
    {
      externalLinks: 1,
      connections: true,
      styles: { cellXfs: [{ numFmtId: 0 }, { numFmtId: 0, fontId: 1 }] },
      sheets: [
        {
          name: "Site log",
          rows: [
            [{ value: "Site", style: 1 }, { value: "Link", style: 1 }],
            ["Ridgeway", "Map"],
            ["Alder", "Map"],
          ],
          comments: [{ ref: "A2", text: "Gate code on file" }],
          hyperlinks: [{ ref: "B2", target: "https://example.test/ridgeway" }],
          conditionalFormatting: ["A2:A3"],
          sparklines: true,
          oleObjects: 1,
          formControls: 1,
          shapes: [{ range: "D2:F6" }],
          pictures: [{ range: "D8:E12" }],
        },
      ],
    },
  ],
  [
    /**
     * F04 (S07): one of each formula disposition the import makes live or keeps.
     * Jobs is a declared table with a totals row: Balance fills down live, Checked
     * reads TODAY (live, never stored), Lucky draws RAND (frozen), Rate calls
     * OFFSET (not in the catalog), Mixed breaks its shape on the last row, and
     * the totals row sums Quoted, and Quoted must be at least 0. Summary is a summary tab whose first two
     * values read each other (a cycle) and whose third sums Jobs. Stock is a
     * region whose footer row sums the column above it (a table metric).
     */
    "formulas-live.xlsx",
    {
      styles: { numFmts: [{ id: 164, code: "yyyy-mm-dd" }], cellXfs: [{ numFmtId: 0 }, { numFmtId: 164 }] },
      sheets: [
        {
          name: "Jobs",
          rows: [
            ["Job", "Quoted", "Paid", "Balance", "Checked", "Lucky", "Rate", "Mixed"],
            ...LIVE_JOBS.map(([job, quoted, paid, lucky], index): RowSpec => {
              const row = String(index + 2);
              const factor = index === LIVE_JOBS.length - 1 ? 3 : 2;
              return [
                job,
                quoted,
                paid,
                { value: quoted - paid, formula: { text: `B${row}-C${row}` } },
                { value: 45566, style: 1, formula: { text: "TODAY()" } },
                { value: lucky, formula: { text: "RAND()" } },
                { value: quoted, formula: { text: `OFFSET(B${row},0,0)` } },
                { value: quoted * factor, formula: { text: `B${row}*${String(factor)}` } },
              ];
            }),
            ["Total", { value: 2280, formula: { text: "SUM(JobsTable[Quoted])" } }],
          ],
          tables: [
            {
              name: "JobsTable",
              ref: "A1:H7",
              columns: ["Job", "Quoted", "Paid", "Balance", "Checked", "Lucky", "Rate", "Mixed"],
              totalsRowCount: 1,
            },
          ],
          validations: [{ sqref: "B2:B6", type: "whole", operator: "greaterThanOrEqual", formula1: "0" }],
        },
        {
          name: "Summary",
          rows: [
            ["Loop A", { value: 0, formula: { text: "B2+1" } }],
            ["Loop B", { value: 0, formula: { text: "B1+1" } }],
            ["Quoted total", { value: 2280, formula: { text: "SUM(Jobs!B2:B6)" } }],
          ],
        },
        {
          name: "Stock",
          rows: [
            ["Material", "Qty"],
            ["Gravel", 12],
            ["Sand", 4],
            ["Mulch", 9],
            ["Total", { value: 25, formula: { text: "SUM(B2:B4)" } }],
          ],
        },
      ],
    },
  ],
]);
