/**
 * The demo relationship pair — Jobs and Customers from `fieldwork-q3.xlsx`
 * (S01's `DEMO_WORKBOOK`) — restated per format, so S06 CP4 can prove the
 * relationship survives each one (M58; CAP-27).
 *
 * The rows are S01's, cell for cell. The ODS carries what ODS can declare:
 * the `VLOOKUP` into Customers (OpenFormula), the `E-F` balance, the Status
 * validation list, currency and date data styles, and both declared tables as
 * database ranges. (The Material list validation points at the Materials sheet,
 * which is not part of the pair, so it is not carried.)
 */

import { DEMO_WORKBOOK } from "../ooxml/build-demo.js";
import type { CellInput, CellSpec, RowSpec } from "../build/ooxml-builder.js";
import { buildOds, esc, FORMAT_STYLES, paragraphs, rowXml } from "./build-ods.js";

export type DemoCellV1 =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "number"; readonly value: number; readonly format: "currency" | "date" | null }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "error"; readonly text: string };

export interface DemoRowCellV1 {
  readonly cell: DemoCellV1;
  readonly isHeader: boolean;
  /** The XLSX cell's currency style, kept on an error result too. */
  readonly isCurrency: boolean;
  /** `lookup` = the Customer VLOOKUP, `balance` = Quoted − Paid. */
  readonly formula: "lookup" | "balance" | null;
}

export interface DemoSheetV1 {
  readonly name: "Jobs" | "Customers";
  readonly rows: readonly (readonly DemoRowCellV1[])[];
  readonly tableName: string;
}

const DATE_STYLE = 1;
const CURRENCY_STYLE = 2;
const HEADER_STYLE = 3;

const isCellSpec = (cell: CellSpec | CellInput): cell is CellSpec =>
  typeof cell === "object" && cell !== null && ("value" in cell || "style" in cell || "formula" in cell);

const demoCell = (input: CellInput | undefined, style: number | undefined): DemoCellV1 => {
  if (typeof input === "string") return { kind: "text", text: input };
  if (typeof input === "boolean") return { kind: "boolean", value: input };
  if (typeof input === "number") {
    return { kind: "number", value: input, format: style === CURRENCY_STYLE ? "currency" : style === DATE_STYLE ? "date" : null };
  }
  if (input !== null && input !== undefined && "error" in input) return { kind: "error", text: input.error };
  throw new Error("the demo pair uses only text, numbers, booleans and errors");
};

const sheetOf = (name: "Jobs" | "Customers"): DemoSheetV1 => {
  const spec = DEMO_WORKBOOK.sheets.find((sheet) => sheet.name === name);
  if (spec?.rows === undefined || spec.tables?.[0] === undefined) throw new Error(`no ${name} sheet in the demo workbook`);
  return {
    name,
    tableName: spec.tables[0].name,
    rows: spec.rows.map((row: RowSpec | undefined) =>
      (row ?? []).map((cell, column): DemoRowCellV1 => {
        const spec: CellSpec = cell !== undefined && isCellSpec(cell) ? cell : { value: cell ?? null };
        return {
          cell: demoCell(spec.value, spec.style),
          isHeader: spec.style === HEADER_STYLE,
          isCurrency: spec.style === CURRENCY_STYLE,
          formula: spec.formula === undefined ? null : column === 2 ? "lookup" : "balance",
        };
      }),
    ),
  };
};

export const DEMO_PAIR: readonly DemoSheetV1[] = [sheetOf("Jobs"), sheetOf("Customers")];

/** The ISO date of an Excel 1900-system serial (≥ 61). */
export const isoDateOf = (serial: number): string =>
  new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);

const STATUS_LIST = '"Scheduled";"In progress";"Waiting";"Complete"';

interface OdsCellParts {
  readonly attrs: Readonly<Record<string, string | number>>;
  readonly inner: string;
}

const odsCell = ({ cell, isHeader, isCurrency, formula }: DemoRowCellV1, row: number): OdsCellParts => {
  const attrs: Record<string, string | number> = {};
  if (isHeader) attrs["table:style-name"] = "ce8";
  if (isCurrency) attrs["table:style-name"] = "ce1";
  if (formula === "lookup") attrs["table:formula"] = `of:=VLOOKUP([.B${row}];[$Customers.A:.B];2;FALSE())`;
  if (formula === "balance") attrs["table:formula"] = `of:=[.E${row}]-[.F${row}]`;
  switch (cell.kind) {
    case "text":
      return { attrs: { "office:value-type": "string", "calcext:value-type": "string", ...attrs }, inner: paragraphs(cell.text) };
    case "boolean":
      return {
        attrs: { "office:value-type": "boolean", "office:boolean-value": String(cell.value), ...attrs },
        inner: paragraphs(cell.value ? "TRUE" : "FALSE"),
      };
    case "error":
      return {
        attrs: { "office:value-type": "string", "office:string-value": "", "calcext:value-type": "error", ...attrs },
        inner: paragraphs(cell.text),
      };
    case "number":
      if (cell.format === "date") {
        return {
          attrs: { "office:value-type": "date", "office:date-value": isoDateOf(cell.value), "table:style-name": "ce3", ...attrs },
          inner: paragraphs(isoDateOf(cell.value)),
        };
      }
      if (cell.format === "currency") {
        return {
          attrs: { "office:value-type": "currency", "office:currency": "USD", "office:value": cell.value, "table:style-name": "ce1", ...attrs },
          inner: paragraphs(`$${cell.value.toFixed(2)}`),
        };
      }
      return { attrs: { "office:value-type": "float", "office:value": cell.value, ...attrs }, inner: paragraphs(String(cell.value)) };
  }
};

/** `ods/fieldwork-jobs-customers.ods`. */
export const buildDemoOds = (): Uint8Array => {
  const [jobs, customers] = DEMO_PAIR as [DemoSheetV1, DemoSheetV1];
  const tableRows = (sheet: DemoSheetV1): string[] =>
    sheet.rows.map((cells, index) =>
      rowXml(
        cells.map((cell, column) => {
          const base = odsCell(cell, index + 1);
          // Status (column D) carries the list validation below the header.
          return sheet.name === "Jobs" && column === 3 && index > 0
            ? { ...base, attrs: { ...base.attrs, "table:content-validation-name": "status" } }
            : base;
        }),
      ),
    );
  const width = (sheet: DemoSheetV1): number => sheet.rows[0]?.length ?? 0;
  const address = (sheet: DemoSheetV1): string => {
    const last = String.fromCharCode(64 + width(sheet));
    return `${sheet.name}.A1:${sheet.name}.${last}${sheet.rows.length}`;
  };
  return buildOds({
    content: {
      automaticStyles: FORMAT_STYLES,
      validations: `<table:content-validation table:name="status" table:condition="${esc(`of:cell-content-is-in-list(${STATUS_LIST})`)}" table:allow-empty-cell="true" table:base-cell-address="Jobs.D2"/>`,
      tables: [
        { name: jobs.name, columns: `<table:table-column table:number-columns-repeated="${width(jobs)}"/>`, rows: tableRows(jobs) },
        { name: customers.name, columns: `<table:table-column table:number-columns-repeated="${width(customers)}"/>`, rows: tableRows(customers) },
      ],
      trailer:
        "<table:database-ranges>" +
        [jobs, customers]
          .map((sheet) => `<table:database-range table:name="${sheet.tableName}" table:target-range-address="${address(sheet)}"/>`)
          .join("") +
        "</table:database-ranges>",
    },
  });
};
