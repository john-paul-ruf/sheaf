/**
 * The XLSB fidelity corpus (M58; CAP-27), mirroring the BIFF set — date epochs,
 * shared/array formulas with a VLOOKUP between sheets, validations, a merged
 * header, hidden sheets, charts, notes/links/pictures/conditional formatting,
 * error cells, compact `BrtShort*` rows — plus **the demo workbook's Jobs +
 * Customers pair** (with the Materials list their validation and defined
 * name point at), converted cell for cell from S01's `DEMO_WORKBOOK`, so S06
 * can prove the relationship survives this format.
 */

import { ERROR_TEXT } from "../../../../src/import/formats/biff/ptg.js";
import type { CellInput, CellSpec, RowSpec } from "../build/ooxml-builder.js";
import { DEMO_WORKBOOK } from "../ooxml/build-demo.js";
import { ptg } from "../biff/ptg-writer.js";
import type { XlsbCellInput, XlsbCellSpec, XlsbRange, XlsbRowSpec, XlsbWorkbookSpec } from "./build-xlsb.js";

const ABS = { rowAbsolute: true, columnAbsolute: true } as const;
const LAST_ROW = 1_048_575;
const minus = (offset: number): number => offset & 0x3fff;
const ERR = { NA: 0x2a, DIV0: 0x07, VALUE: 0x0f, REF: 0x17, NAME: 0x1d, NUM: 0x24, NULL: 0x00 } as const;

/** `VLOOKUP(B2,Customers!A:B,2,FALSE)` shared from column C: offsets from each member. */
const vlookupShared = (ixti: number) =>
  ptg("biff12").refN(0, -1).area3d(ixti, 0, minus(-2), LAST_ROW, minus(-1), { rowAbsolute: true }).int(2).bool(false).funcVar(102, 4).rgce;

const dates = (date1904: boolean): XlsbWorkbookSpec => ({
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

const JOBS: readonly (readonly [string, string, number, number])[] = [
  ["J-1001", "C-002", 400, 150],
  ["J-1002", "C-001", 275.5, 0],
  ["J-1003", "C-013", 980, 980],
  ["J-1004", "C-003", 120.25, 60],
];

const arrayConstant = ptg("biff12").array([[1, 2]]);

const FORMULAS: XlsbWorkbookSpec = {
  formats: [{ id: 165, code: '"$"#,##0.00' }],
  xfs: [{ formatId: 0 }, { formatId: 165 }],
  xti: [
    { supbook: 0, first: 1, last: 1 },
    { supbook: 0, first: 0, last: 0 },
  ],
  names: [{ name: "CustomerList", rgce: ptg("biff12").area3d(0, 1, 0, 3, 0, ABS).rgce }],
  sheets: [
    {
      name: "Jobs",
      rows: [
        ["Job ID", "Customer ID", "Customer", "Quoted", "Paid", "Balance"],
        ...JOBS.map(([id, customer, quoted, paid], index): XlsbRowSpec => {
          const name = CUSTOMERS.find(([key]) => key === customer)?.[1];
          return [
            id,
            customer,
            {
              value: name ?? { error: ERR.NA },
              formula: index === 0 ? { shared: { range: [1, 4, 2, 2], tokens: vlookupShared(0) } } : { member: 1 },
            },
            { value: quoted, style: 1 },
            { value: paid, style: 1 },
            {
              value: quoted - paid,
              style: 1,
              formula: index === 0 ? { shared: { range: [1, 4, 5, 5], tokens: ptg("biff12").refN(0, -2).refN(0, -1).sub().rgce } } : { member: 1 },
            },
          ];
        }),
      ],
    },
    { name: "Customers", rows: [["Customer ID", "Name"], ...CUSTOMERS.map(([key, name]): XlsbRowSpec => [key, name])] },
    {
      name: "Calc",
      rows: [
        [
          { value: 7, formula: { tokens: ptg("biff12").int(3).int(4).add().rgce } },
          { value: "Ada Lovelace", formula: { tokens: ptg("biff12").str("Ada").str(" Lovelace").op(0x08).rgce } },
          { value: true, formula: { tokens: ptg("biff12").int(1).int(1).op(0x0b).rgce } },
          { value: { error: ERR.DIV0 }, formula: { tokens: ptg("biff12").int(1).int(0).op(0x06).rgce } },
        ],
        [
          { value: 1, formula: { array: { range: [1, 1, 0, 1], tokens: arrayConstant.rgce, extra: arrayConstant.rgcb } } },
          { value: 2, formula: { member: 1 } },
        ],
        [{ value: 9, formula: { tokens: Uint8Array.of(0x1a) } }],
        [
          { value: null, formula: { tokens: ptg("biff12").str("").rgce } },
          { value: 1775.75, formula: { tokens: ptg("biff12").area3d(1, 1, 3, 4, 3).funcVar(4, 1).rgce } },
        ],
      ],
    },
  ],
};

const MATERIALS = ["Gravel", "Sand", "Topsoil", "Mulch", "Pavers", "Timber", "Fencing", "Seed mix"];

const VALIDATION: XlsbWorkbookSpec = {
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
        { type: 3, isStringList: true, formula1: ptg("biff12").str("Scheduled\0In progress\0Complete").rgce, ranges: [[1, 10, 1, 1]] },
        { type: 3, formula1: ptg("biff12").area3d(0, 1, 0, 8, 0, ABS).rgce, ranges: [[1, 10, 2, 2]] },
        { type: 1, operator: 0, formula1: ptg("biff12").int(1).rgce, formula2: ptg("biff12").int(10).rgce, ranges: [[1, 10, 3, 3]] },
        { type: 7, formula1: ptg("biff12").ref(1, 4).str("").op(0x0e).rgce, ranges: [[1, 10, 4, 4]] },
        { type: 1, operator: 4, formula1: Uint8Array.of(0x1a), ranges: [[1, 10, 0, 0]] },
      ],
    },
    { name: "Materials", rows: [["Material"], ...MATERIALS.map((each): XlsbRowSpec => [each])] },
  ],
};

const MERGED_HEADER: XlsbWorkbookSpec = {
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

const HIDDEN_SHEETS: XlsbWorkbookSpec = {
  sheets: [
    { name: "Visible", rows: [["a", 1]] },
    { name: "Hidden", state: 1, rows: [["b", 2]] },
    { name: "Very hidden", state: 2, rows: [["c", 3]] },
  ],
};

const CHART: XlsbWorkbookSpec = {
  sheets: [
    {
      name: "Data",
      rows: [
        ["Month", "Visits"],
        ["Jan", 12],
        ["Feb", 19],
      ],
      charts: [[1, 10, 3, 8]],
    },
    { name: "Chart1", kind: "chartsheet", charts: [[0, 20, 0, 10]] },
  ],
};

const ANNOTATIONS: XlsbWorkbookSpec = {
  sheets: [
    {
      name: "Notes",
      rows: [
        ["Site", "Note"],
        ["North", "Café on corner"],
        [{ inline: "Inline text" }, 1],
      ],
      comments: [[1, 1]],
      hyperlinks: [{ range: [2, 2, 0, 0], target: "https://example.test/site" }],
      pictures: [[4, 8, 0, 2]],
      shapes: [[4, 8, 3, 5]],
      conditionalFormats: 2,
    },
  ],
};

const ERROR_CELLS: XlsbWorkbookSpec = {
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

const SHORT_CELLS: XlsbWorkbookSpec = {
  sheets: [
    {
      name: "Compact",
      shortRows: [1, 2],
      rows: [
        ["Kind", "Value", "Flag", "Note"],
        ["rk", 41.5, true, null],
        ["real", 1 / 3, { error: ERR.NA }, { inline: "inline" }],
      ],
    },
  ],
};

/** `A1:J61` → `[0, 60, 0, 9]`. */
const rangeOf = (ref: string): XlsbRange => {
  const cell = (text: string): [number, number] => {
    const match = /^([A-Z]+)(\d+)$/.exec(text);
    if (match === null) throw new Error(`not a cell: ${text}`);
    const column = [...(match[1] as string)].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
    return [Number(match[2]) - 1, column];
  };
  const [first, last = first] = ref.split(":") as [string, string?];
  const [r1, c1] = cell(first);
  const [r2, c2] = cell(last);
  return [r1, r2, c1, c2];
};

const ERROR_CODE = new Map([...ERROR_TEXT].map(([code, text]) => [text, code]));

const inputOf = (value: CellInput | undefined): XlsbCellInput => {
  if (value === undefined || value === null || typeof value !== "object") return value ?? null;
  if ("error" in value) return { error: ERROR_CODE.get(value.error) ?? ERR.NA };
  throw new Error("the demo pair uses no inline, rich or raw values");
};

/** The demo's shared formulas, by OOXML `si`: 0 is the Customer VLOOKUP, 1 the Balance. */
const DEMO_SHARED_TOKENS = [vlookupShared(0), ptg("biff12").refN(0, -2).refN(0, -1).sub().rgce];

const demoCell = (input: CellSpec | CellInput | undefined): XlsbCellSpec | XlsbCellInput | undefined => {
  if (input === undefined) return undefined;
  if (input === null || typeof input !== "object" || "error" in input || "inline" in input || "rich" in input || "raw" in input) {
    return inputOf(input);
  }
  const cell = input;
  const formula = cell.formula;
  if (formula === undefined) return { value: inputOf(cell.value), style: cell.style ?? 0 };
  if (!("shared" in formula)) throw new Error("the demo pair's formulas are all shared");
  const tokens = DEMO_SHARED_TOKENS[formula.shared.si];
  if (tokens === undefined) throw new Error(`no tokens for shared group ${formula.shared.si}`);
  return {
    value: inputOf(cell.value),
    style: cell.style ?? 0,
    formula: formula.shared.ref === undefined ? { member: 1 } : { shared: { range: rangeOf(formula.shared.ref), tokens } },
  };
};

const demoSheet = (name: string) => {
  const sheet = DEMO_WORKBOOK.sheets.find((each) => each.name === name);
  if (sheet === undefined) throw new Error(name);
  return sheet;
};

const demoRows = (name: string): XlsbRowSpec[] =>
  (demoSheet(name).rows ?? []).map((row: RowSpec | undefined): XlsbRowSpec => (row ?? []).map(demoCell));

/**
 * `fieldwork-jobs.xlsb`: the demo's Jobs, Customers and Materials sheets —
 * values, styles, the shared VLOOKUP and Balance formulas, both declared
 * tables, the Status and Material validation lists, the `MaterialList` name.
 */
export const FIELDWORK_JOBS: XlsbWorkbookSpec = {
  formats: [
    { id: 164, code: "yyyy-mm-dd" },
    { id: 165, code: '"$"#,##0.00' },
  ],
  xfs: [{ formatId: 0 }, { formatId: 164 }, { formatId: 165 }, { formatId: 0, font: 1 }],
  xti: [
    { supbook: 0, first: 1, last: 1 },
    { supbook: 0, first: 2, last: 2 },
  ],
  names: [{ name: "MaterialList", rgce: ptg("biff12").area3d(1, 1, 0, 8, 0, ABS).rgce }],
  sheets: [
    {
      name: "Jobs",
      rows: demoRows("Jobs"),
      tables: (demoSheet("Jobs").tables ?? []).map((table) => ({ name: table.name, range: rangeOf(table.ref), columns: table.columns })),
      validations: [
        {
          type: 3,
          isStringList: true,
          formula1: ptg("biff12").str("Scheduled\0In progress\0Waiting\0Complete").rgce,
          ranges: [rangeOf("D2:D61")],
        },
        { type: 3, formula1: ptg("biff12").area3d(1, 1, 0, 8, 0, ABS).rgce, ranges: [rangeOf("J2:J61")] },
      ],
    },
    {
      name: "Customers",
      rows: demoRows("Customers"),
      tables: (demoSheet("Customers").tables ?? []).map((table) => ({ name: table.name, range: rangeOf(table.ref), columns: table.columns })),
    },
    { name: "Materials", rows: demoRows("Materials") },
  ],
};

export const XLSB_FIDELITY: ReadonlyMap<string, XlsbWorkbookSpec> = new Map([
  ["date-1900.xlsb", dates(false)],
  ["date-1904.xlsb", dates(true)],
  ["formulas.xlsb", FORMULAS],
  ["validation.xlsb", VALIDATION],
  ["merged-header.xlsb", MERGED_HEADER],
  ["hidden-sheets.xlsb", HIDDEN_SHEETS],
  ["chart.xlsb", CHART],
  ["annotations.xlsb", ANNOTATIONS],
  ["error-cells.xlsb", ERROR_CELLS],
  ["short-cells.xlsb", SHORT_CELLS],
  ["fieldwork-jobs.xlsb", FIELDWORK_JOBS],
]);
