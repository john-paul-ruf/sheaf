/**
 * The pinned fact counts of `fieldwork-q3.xlsx`, per sheet and per kind, with
 * every sheet selected. The node test and the real-browser proof both assert
 * these, so the two environments cannot drift apart unnoticed. Any change to
 * the demo workbook or the adapter that moves a number here is a CA-17 change
 * S02/S06/S08 must hear about.
 */

export const DEMO_SHEET_NAMES = [
  "Jobs",
  "Customers",
  "Crew",
  "Visits",
  "Materials",
  "Overview",
  "Archive 2018",
] as const;

export const DEMO_FACT_COUNTS: Readonly<Record<(typeof DEMO_SHEET_NAMES)[number], Readonly<Record<string, number>>>> = {
  Jobs: {
    sheet: 1,
    "defined-name": 1,
    "declared-table": 1,
    row: 61,
    value: 610,
    formula: 120,
    "cell-format": 8,
    diagnostic: 1,
    validation: 2,
    "preserved-part": 1,
  },
  Customers: { sheet: 1, "declared-table": 1, row: 13, value: 52, "preserved-part": 1 },
  Crew: { sheet: 1, row: 39, value: 148, "cell-format": 2, merge: 1, "preserved-part": 1 },
  Visits: { sheet: 1, "declared-table": 1, row: 41, value: 164, "cell-format": 1, "preserved-part": 1 },
  Materials: { sheet: 1, row: 9, value: 9, "preserved-part": 1 },
  Overview: { sheet: 1, "preserved-part": 4, row: 5, value: 9, formula: 4, "cell-format": 1 },
  "Archive 2018": { sheet: 1, row: 2001, value: 8004, "cell-format": 2, "preserved-part": 1 },
};

/** Preserved parts per sheet, by part kind. */
export const DEMO_PRESERVED_PARTS: Readonly<Record<(typeof DEMO_SHEET_NAMES)[number], Readonly<Record<string, number>>>> = {
  Jobs: { "cell-styling": 1 },
  Customers: { "cell-styling": 1 },
  Crew: { "cell-styling": 1 },
  Visits: { "cell-styling": 1 },
  Materials: { "cell-styling": 1 },
  Overview: { drawing: 2, chart: 1, "cell-styling": 1 },
  "Archive 2018": { "cell-styling": 1 },
};

/** The whole-workbook summary with every sheet selected. */
export const DEMO_SUMMARY = {
  rowCount: 2169,
  columnCount: 10,
  valueCount: 8996,
} as const;

/**
 * F04 (S07): the statements of the live structure the demo imports — its six
 * formulas and its rebuilt chart. A consumer whose premise is the F03-shaped
 * app (no imported formula or chart) declines exactly these at review
 * (`reject-statement`), which is a person's own choice on SCR-023.
 */
export const DEMO_LIVE_STRUCTURE_STATEMENTS = [
  "formula:s0.t0.c2",
  "formula:s0.t0.c6",
  "formula:s5.R3C2",
  "formula:s5.R4C2",
  "formula:s5.R5C2",
  "formula:s5.R6C2",
  "chart:s5.chart0",
] as const;
