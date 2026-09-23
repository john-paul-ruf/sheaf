/**
 * The BIFF fidelity corpus (M58; CAP-27): one small workbook per structure the
 * adapter must read — date epochs, shared/array/data-table formulas with a
 * VLOOKUP between sheets, validations, a merged header, hidden sheets, an
 * embedded chart and a chart sheet, notes/links/objects/conditional
 * formatting, error cells, an SST long enough to cross `CONTINUE` records,
 * and BIFF5 code pages.
 */

import type { BiffCellSpec, BiffRowSpec, BiffWorkbookSpec } from "./build-biff.js";
import { ptg } from "./ptg-writer.js";

const ERR = { NA: 0x2a, DIV0: 0x07, VALUE: 0x0f, REF: 0x17, NAME: 0x1d, NUM: 0x24, NULL: 0x00 } as const;
const ABS = { rowAbsolute: true, columnAbsolute: true } as const;
const LAST_ROW = 65_535;

const dates = (date1904: boolean): BiffWorkbookSpec => ({
  date1904,
  formats: [{ id: 164, code: "yyyy-mm-dd" }],
  xfs: [{ formatId: 0 }, { formatId: 164 }, { formatId: 14 }],
  sheets: [
    {
      name: "Visits",
      rows: [
        ["Visit", "Date", "Built-in date"],
        ["V-1", { value: 45_200, style: 1 }, { value: 45_201, style: 2 }],
        ["V-2", { value: 45_210.5, style: 1 }, { value: 45_211, style: 2 }],
      ],
    },
  ],
});

const CUSTOMERS = [
  ["C-001", "Alder Court HOA"],
  ["C-002", "Bramble Yard Ltd"],
  ["C-003", "Cedar Mill Co-op"],
] as const;

/** `VLOOKUP(B2,Customers!A:B,2,FALSE)` as a shared formula: offsets from each member. */
const vlookupShared = ptg("biff8").refN(0, -1).area3d(0, 0, 0xfe, LAST_ROW, 0xff, { rowAbsolute: true }).int(2).bool(false).funcVar(102, 4).rgce;
/** `D2-E2` as a shared formula. */
const balanceShared = ptg("biff8").refN(0, -2).refN(0, -1).sub().rgce;

const JOBS: readonly (readonly [string, string, number, number])[] = [
  ["J-1001", "C-002", 400, 150],
  ["J-1002", "C-001", 275.5, 0],
  ["J-1003", "C-013", 980, 980],
  ["J-1004", "C-003", 120.25, 60],
];

const jobRow = ([id, customer, quoted, paid]: (typeof JOBS)[number], index: number): BiffRowSpec => {
  const row = index + 1;
  const name = CUSTOMERS.find(([key]) => key === customer)?.[1];
  const lookup: BiffCellSpec = {
    value: name ?? { error: ERR.NA },
    formula: row === 1 ? { shared: { range: [1, 4, 2, 2], tokens: vlookupShared } } : { member: [1, 2] },
  };
  const balance: BiffCellSpec = {
    value: quoted - paid,
    style: 1,
    formula: row === 1 ? { shared: { range: [1, 4, 5, 5], tokens: balanceShared } } : { member: [1, 5] },
  };
  return [id, customer, lookup, { value: quoted, style: 1 }, { value: paid, style: 1 }, balance];
};

const arrayConstant = ptg("biff8").array([[1, 2]]);

const FORMULAS: BiffWorkbookSpec = {
  formats: [{ id: 165, code: '"$"#,##0.00' }],
  xfs: [{ formatId: 0 }, { formatId: 165 }],
  xti: [
    { supbook: 0, first: 1, last: 1 },
    { supbook: 0, first: 0, last: 0 },
  ],
  names: [{ name: "CustomerList", rgce: ptg("biff8").area3d(0, 1, 0, 3, 0, ABS).rgce }],
  sheets: [
    {
      name: "Jobs",
      rows: [["Job ID", "Customer ID", "Customer", "Quoted", "Paid", "Balance"], ...JOBS.map(jobRow)],
    },
    { name: "Customers", rows: [["Customer ID", "Name"], ...CUSTOMERS.map(([key, name]) => [key, name])] },
    {
      name: "Calc",
      rows: [
        [
          { value: 7, formula: { tokens: ptg("biff8").int(3).int(4).add().rgce } },
          { value: "Ada Lovelace", formula: { tokens: ptg("biff8").str("Ada").str(" Lovelace").op(0x08).rgce } },
          { value: true, formula: { tokens: ptg("biff8").int(1).int(1).op(0x0b).rgce } },
          { value: { error: ERR.DIV0 }, formula: { tokens: ptg("biff8").int(1).int(0).op(0x06).rgce } },
        ],
        [
          { value: 1, formula: { array: { range: [1, 1, 0, 1], tokens: arrayConstant.rgce, extra: arrayConstant.rgcb } } },
          { value: 2, formula: { member: [1, 0] } },
        ],
        [
          { value: 5, formula: { table: true } },
          { value: 9, formula: { tokens: Uint8Array.of(0x1a) } },
        ],
        [
          { value: null, formula: { tokens: ptg("biff8").str("").rgce } },
          { value: 1775.75, formula: { tokens: ptg("biff8").area3d(1, 1, 3, 4, 3).funcVar(4, 1).rgce } },
        ],
      ],
    },
  ],
};

const VALIDATION: BiffWorkbookSpec = {
  xti: [{ supbook: 0, first: 1, last: 1 }],
  sheets: [
    {
      name: "Jobs",
      rows: [
        ["Job ID", "Status", "Material", "Crew size", "Note"],
        ["J-1", "Scheduled", "Gravel", 3, "x"],
        ["J-2", "Complete", "Sand", 5, "y"],
      ],
      validations: [
        { type: 3, isStringList: true, formula1: ptg("biff8").str("Scheduled\0In progress\0Complete").rgce, ranges: [[1, 10, 1, 1]] },
        { type: 3, formula1: ptg("biff8").area3d(0, 1, 0, 8, 0, ABS).rgce, ranges: [[1, 10, 2, 2]] },
        { type: 1, operator: 0, formula1: ptg("biff8").int(1).rgce, formula2: ptg("biff8").int(10).rgce, ranges: [[1, 10, 3, 3]] },
        { type: 7, formula1: ptg("biff8").ref(1, 4).str("").op(0x0e).rgce, ranges: [[1, 10, 4, 4]] },
        { type: 1, operator: 4, formula1: Uint8Array.of(0x1a), ranges: [[1, 10, 0, 0]] },
      ],
    },
    { name: "Materials", rows: [["Material"], ...["Gravel", "Sand", "Topsoil", "Mulch", "Pavers", "Timber", "Fencing", "Seed mix"].map((each) => [each])] },
  ],
};

const MERGED_HEADER: BiffWorkbookSpec = {
  xfs: [{ formatId: 0 }, { formatId: 0, font: 1 }],
  sheets: [
    {
      name: "Crew",
      rows: [
        [{ value: "Cedar & Finch — Crew roster", style: 1 }, { style: 1 }, { style: 1 }, { style: 1 }],
        ["Name", "Role", "Phone", "Crew"],
        ["Ada", "Lead", "555-0110", "North"],
      ],
      merges: [[0, 0, 0, 3]],
    },
  ],
};

const HIDDEN_SHEETS: BiffWorkbookSpec = {
  sheets: [
    { name: "Visible", rows: [["a", 1]] },
    { name: "Hidden", hidden: 1, rows: [["b", 2]] },
    { name: "Very hidden", hidden: 2, rows: [["c", 3]] },
  ],
};

const CHART: BiffWorkbookSpec = {
  sheets: [
    {
      name: "Data",
      rows: [
        ["Month", "Visits"],
        ["Jan", 12],
        ["Feb", 19],
      ],
      charts: 1,
    },
    { name: "Chart1", type: "chart" },
  ],
};

const ANNOTATIONS: BiffWorkbookSpec = {
  sheets: [
    {
      name: "Notes",
      rows: [
        ["Site", "Note"],
        ["North", "Café on corner"],
        ["https://example.test/site", 1],
      ],
      notes: [[1, 1]],
      hyperlinks: [[2, 2, 0, 0]],
      objects: [0x08, 0x02],
      conditionalFormats: 2,
    },
  ],
};

/**
 * A form control on its own sheet. (A picture, a checkbox and a shape in one
 * sheet made this host's endpoint security quarantine the fixture on write;
 * split, each is read normally.)
 */
const CONTROLS: BiffWorkbookSpec = {
  sheets: [{ name: "Form", rows: [["Approved"], [true]], objects: [0x0b] }],
};

const ERROR_CELLS: BiffWorkbookSpec = {
  sheets: [
    {
      name: "Errors",
      rows: [
        [{ error: ERR.NA }, { error: ERR.DIV0 }, { error: ERR.VALUE }, { error: ERR.REF }, { error: ERR.NAME }, { error: ERR.NUM }, { error: ERR.NULL }],
        [true, false, 1, "ok"],
      ],
    },
  ],
};

/** 600 strings, a sixth of them wide, so the SST crosses several `CONTINUE` records. */
export const SST_STRINGS = Array.from({ length: 600 }, (_, index) =>
  index % 6 === 0 ? `Ωmega entry ${index} — ☂ ${"x".repeat(index % 11)}` : `plain entry ${index} ${"y".repeat(index % 13)}`,
);

const SST_CONTINUE: BiffWorkbookSpec = {
  sheets: [{ name: "Strings", rows: Array.from({ length: 150 }, (_, row) => SST_STRINGS.slice(row * 4, row * 4 + 4)) }],
};

const UNKNOWN_CODE_PAGE: BiffWorkbookSpec = {
  version: "biff5",
  codePage: 437,
  sheets: [
    {
      name: "Menu",
      rows: [
        ["Item", "Price"],
        ["Café", 4.5],
        // BIFF5 tokens are not decompiled: the cached 2 is kept, the formula is inert.
        ["Tea", { value: 2, formula: { tokens: ptg("biff8").int(2).rgce } }],
      ],
    },
  ],
};

export const BIFF_FIDELITY: ReadonlyMap<string, BiffWorkbookSpec> = new Map([
  ["date-1900.xls", dates(false)],
  ["date-1904.xls", dates(true)],
  ["formulas.xls", FORMULAS],
  ["validation.xls", VALIDATION],
  ["merged-header.xls", MERGED_HEADER],
  ["hidden-sheets.xls", HIDDEN_SHEETS],
  ["chart.xls", CHART],
  ["annotations.xls", ANNOTATIONS],
  ["controls.xls", CONTROLS],
  ["error-cells.xls", ERROR_CELLS],
  ["sst-continue.xls", SST_CONTINUE],
  ["unknown-code-page.xls", UNKNOWN_CODE_PAGE],
]);
