/**
 * The GATE-F03 demo workbook, `fieldwork-q3.xlsx` (M58; CAP-27).
 *
 * Every later tier pins against these bytes: S02 pins its proposal, S06 runs
 * the first narrow journey over it, S08 runs the demo. Its content is chosen
 * to exercise each inference signal once, visibly:
 *
 * - **Jobs** — declared table `JobsTable`, 60 rows (> 50, for paging), a
 *   unique Job ID, a `VLOOKUP` into Customers filled down as a shared formula
 *   (the primary relationship signal), a validation-list Status, currency
 *   columns with two `TBD` values, a filled-down `E-F` Balance (preserved, not
 *   live), a date column, a boolean, and a Material column whose validation
 *   list lives on the Materials sheet;
 * - **Customers** — declared table keyed by Customer ID; one ID that Jobs
 *   references (`C-013`) is missing — the broken reference STA-011 shows;
 * - **Crew** — no declared table: three title rows, a header, a blank spacer
 *   at row 29 and the headings repeated below it;
 * - **Visits** — declared table whose Job IDs all appear in Jobs (key match);
 * - **Materials** — a single-column lookup list;
 * - **Overview** — summary formulas over Jobs, one chart (Quoted amount by
 *   Status, clustered columns), two shapes;
 * - **Archive 2018** — a plain 2,000-row table the demo deselects.
 */

import { buildOoxml, type CellSpec, type RowSpec, type WorkbookSpec } from "../build/ooxml-builder.js";

const DATE = 1;
const CURRENCY = 2;
const HEADER = 3;

const header = (...names: string[]): RowSpec => names.map((value): CellSpec => ({ value, style: HEADER }));

const pad = (value: number): string => String(value).padStart(3, "0");
const cents = (value: number): number => Math.round(value * 100) / 100;

const CUSTOMER_NAMES = [
  "Alder Court HOA",
  "Bramble Yard Ltd",
  "Cedar Mill Co-op",
  "Dunmore Lot Trust",
  "Elm Street Clinic",
  "Fernhill School",
  "Garnet Properties",
  "Harbor View Inn",
  "Ivy Lane Bakery",
  "Juniper Farms",
  "Kestrel Storage",
  "Linden Library",
];
const STATUSES = ["Scheduled", "In progress", "Waiting", "Complete"];
const MATERIALS = ["Gravel", "Sand", "Topsoil", "Mulch", "Pavers", "Timber", "Fencing", "Seed mix"];
const CREW_ROLES = ["Lead", "Technician", "Apprentice", "Driver"];
const CREWS = ["North", "South", "East", "West"];

/** Rows (1-based) whose Customer ID has no Customers row. */
export const MISSING_CUSTOMER_ROWS = [17, 43];
/** Rows (1-based) whose Quoted amount is the text `TBD`. */
export const TBD_ROWS = [9, 31];
export const JOB_COUNT = 60;

const jobId = (index: number): string => `J-${1000 + index}`;

interface Job {
  readonly id: string;
  readonly customerId: string;
  /** `null` when the Customer ID has no Customers row. */
  readonly customer: string | null;
  readonly status: string;
  /** `null` for a `TBD` quote. */
  readonly quoted: number | null;
  readonly paid: number;
  readonly due: number;
  readonly approved: boolean;
  readonly material: string;
}

const JOBS: readonly Job[] = Array.from({ length: JOB_COUNT }, (_, offset): Job => {
  const index = offset + 1;
  const isMissing = MISSING_CUSTOMER_ROWS.includes(index + 1);
  const customer = (index * 7) % CUSTOMER_NAMES.length;
  const quoted = TBD_ROWS.includes(index + 1) ? null : cents(250 + ((index * 37) % 900) + (index % 4) * 0.25);
  return {
    id: jobId(index),
    customerId: isMissing ? "C-013" : `C-${pad(customer + 1)}`,
    customer: isMissing ? null : (CUSTOMER_NAMES[customer] as string),
    status: STATUSES[index % STATUSES.length] as string,
    quoted,
    paid: quoted === null ? 0 : index % 3 === 0 ? quoted : index % 3 === 1 ? 0 : cents(quoted / 2),
    due: 45_200 + index * 3,
    approved: index % 5 !== 0,
    material: MATERIALS[index % MATERIALS.length] as string,
  };
});

const QUOTED_TOTAL = cents(JOBS.reduce((sum, job) => sum + (job.quoted ?? 0), 0));
const PAID_TOTAL = cents(JOBS.reduce((sum, job) => sum + job.paid, 0));

const jobsRows = (): RowSpec[] => [
  header("Job ID", "Customer ID", "Customer", "Status", "Quoted amount", "Paid", "Balance", "Due date", "Approved", "Material"),
  ...JOBS.map((job, offset): RowSpec => [
    job.id,
    job.customerId,
    {
      value: job.customer ?? { error: "#N/A" },
      formula: offset === 0
        ? { shared: { si: 0, ref: `C2:C${JOB_COUNT + 1}`, text: "VLOOKUP(B2,Customers!A:B,2,FALSE)" } }
        : { shared: { si: 0 } },
    },
    job.status,
    job.quoted === null ? "TBD" : { value: job.quoted, style: CURRENCY },
    { value: job.paid, style: CURRENCY },
    {
      value: job.quoted === null ? { error: "#VALUE!" } : cents(job.quoted - job.paid),
      style: CURRENCY,
      formula: offset === 0 ? { shared: { si: 1, ref: `G2:G${JOB_COUNT + 1}`, text: "E2-F2" } } : { shared: { si: 1 } },
    },
    { value: job.due, style: DATE },
    job.approved,
    job.material,
  ]),
];

const customersRows = (): RowSpec[] => [
  header("Customer ID", "Name", "Phone", "Email"),
  ...CUSTOMER_NAMES.map((name, index): RowSpec => [
    `C-${pad(index + 1)}`,
    name,
    `555-01${String(index + 10)}`,
    `${name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/\.$/, "")}@example.test`,
  ]),
];

const crewRow = (index: number): RowSpec => [
  `Crew member ${index + 1}`,
  CREW_ROLES[index % CREW_ROLES.length],
  `555-02${String(index + 10)}`,
  CREWS[index % CREWS.length],
];

const crewRows = (): (RowSpec | undefined)[] => [
  [{ value: "Cedar & Finch — Crew roster", style: HEADER }],
  ["Report date", { value: 45_566, style: DATE }],
  ["Prepared by Operations"],
  header("Name", "Role", "Phone", "Crew"),
  ...Array.from({ length: 24 }, (_, index) => crewRow(index)),
  undefined,
  header("Name", "Role", "Phone", "Crew"),
  ...Array.from({ length: 10 }, (_, index) => crewRow(24 + index)),
];

const visitsRows = (): RowSpec[] => [
  header("Visit ID", "Job ID", "Visit date", "Notes"),
  ...Array.from({ length: 40 }, (_, index): RowSpec => [
    `V-${2001 + index}`,
    (JOBS[(index * 11) % JOB_COUNT] as Job).id,
    { value: 45_190 + index * 2, style: DATE },
    index % 3 === 0 ? "Gate code needed" : index % 3 === 1 ? "Measured site" : "Follow-up booked",
  ]),
];

const archiveRows = (): RowSpec[] => [
  header("Job ID", "Customer", "Amount", "Closed"),
  ...Array.from({ length: 2000 }, (_, index): RowSpec => [
    `A-${10_000 + index}`,
    CUSTOMER_NAMES[index % CUSTOMER_NAMES.length] as string,
    { value: cents(100 + ((index * 53) % 4000) / 4), style: CURRENCY },
    { value: 43_101 + (index % 365), style: DATE },
  ]),
];

export const DEMO_WORKBOOK: WorkbookSpec = {
  styles: {
    numFmts: [
      { id: 164, code: "yyyy-mm-dd" },
      { id: 165, code: '"$"#,##0.00' },
    ],
    cellXfs: [{ numFmtId: 0 }, { numFmtId: 164 }, { numFmtId: 165 }, { numFmtId: 0, fontId: 1 }],
  },
  definedNames: [{ name: "MaterialList", ref: "Materials!$A$2:$A$9" }],
  sheets: [
    {
      name: "Jobs",
      rows: jobsRows(),
      tables: [
        {
          name: "JobsTable",
          ref: `A1:J${JOB_COUNT + 1}`,
          columns: ["Job ID", "Customer ID", "Customer", "Status", "Quoted amount", "Paid", "Balance", "Due date", "Approved", "Material"],
        },
      ],
      validations: [
        { sqref: `D2:D${JOB_COUNT + 1}`, type: "list", formula1: `"${STATUSES.join(",")}"` },
        { sqref: `J2:J${JOB_COUNT + 1}`, type: "list", formula1: "Materials!$A$2:$A$9", extension: true },
      ],
    },
    {
      name: "Customers",
      rows: customersRows(),
      tables: [{ name: "CustomersTable", ref: `A1:D${CUSTOMER_NAMES.length + 1}`, columns: ["Customer ID", "Name", "Phone", "Email"] }],
    },
    { name: "Crew", rows: crewRows(), merges: ["A1:D1"] },
    {
      name: "Visits",
      rows: visitsRows(),
      tables: [{ name: "VisitsTable", ref: "A1:D41", columns: ["Visit ID", "Job ID", "Visit date", "Notes"] }],
    },
    { name: "Materials", rows: [header("Material"), ...MATERIALS.map((material): RowSpec => [material])] },
    {
      name: "Overview",
      rows: [
        [{ value: "Fieldwork Q3 overview", style: HEADER }],
        [],
        ["Open jobs", { value: JOBS.filter((job) => job.status === "In progress").length, formula: { text: `COUNTIF(Jobs!D2:D${JOB_COUNT + 1},"In progress")` } }],
        ["Quoted total", { value: QUOTED_TOTAL, style: CURRENCY, formula: { text: `SUM(Jobs!E2:E${JOB_COUNT + 1})` } }],
        ["Paid total", { value: PAID_TOTAL, style: CURRENCY, formula: { text: `SUM(Jobs!F2:F${JOB_COUNT + 1})` } }],
        ["Balance", { value: cents(QUOTED_TOTAL - PAID_TOTAL), style: CURRENCY, formula: { text: "B4-B5" } }],
      ],
      charts: [
        {
          range: "D2:K18",
          type: "barChart",
          barDir: "col",
          grouping: "clustered",
          title: "Quoted by status",
          series: [{ nameRef: "Jobs!$E$1", cat: `Jobs!$D$2:$D$${JOB_COUNT + 1}`, val: `Jobs!$E$2:$E$${JOB_COUNT + 1}` }],
        },
      ],
      shapes: [{ range: "D20:F24" }, { range: "H20:J24" }],
    },
    { name: "Archive 2018", rows: archiveRows() },
  ],
};

export const buildDemoWorkbook = (): Uint8Array => buildOoxml(DEMO_WORKBOOK);
