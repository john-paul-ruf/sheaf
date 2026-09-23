/**
 * Where a table is on a sheet (M21; FR-4): header rows, discarded rows, and
 * the one bounded builder every proposed table is measured with.
 *
 * A {@link TableBuilder} keeps, per table:
 *
 * - the first {@link PROPOSAL_LEADING_ROWS} rows whole — the review evidence
 *   and the whole range a header row may be moved within;
 * - at most {@link PROPOSAL_DISCARDED_ROW_LIMIT} discarded rows (the count
 *   stays exact);
 * - one {@link ColumnStats} per column (`types.ts` states its bound).
 *
 * Three modes share it. `delimited` is F02 exactly: one table for the whole
 * stream, empty rows discarded as `empty-row`, a headerless file allowed.
 * `region` is a workbook region's column group, whose rows arrive non-empty.
 * `declared` is a workbook-declared table: its header row and totals rows are
 * the declaration's, never inferred (declared structure wins).
 */

import { columnLettersOf, parseFormula, type FormulaAstV1, type LookupV1 } from "../../domain/formulas/index.js";
import type { DateSystemV1 } from "../facts/index.js";
import {
  COLUMN_LOOKUP_LIMIT,
  KEY_SKETCH_LIMIT,
  ENUM_OPTION_LIMIT,
  looksLikeHeading,
  newStats,
  observe,
  observeFormulaShape,
  type CellFormatV1,
  type ColumnStats,
} from "./types.js";

/** Rows kept whole: the review evidence, and the range a header may move in. */
export const PROPOSAL_LEADING_ROWS = 20;

/** The longest discarded-row list a proposal carries; the count is still exact. */
export const PROPOSAL_DISCARDED_ROW_LIMIT = 50;

export const DISCARD_REASONS = Object.freeze(["above-header", "empty-row"] as const);

export type DiscardReasonV1 = (typeof DISCARD_REASONS)[number];

/** F02's reasons plus a declared table's totals rows (additive). */
export const WORKBOOK_DISCARD_REASONS = Object.freeze([...DISCARD_REASONS, "totals-row"] as const);

export type WorkbookDiscardReasonV1 = (typeof WORKBOOK_DISCARD_REASONS)[number];

export interface ProposedRowV1 {
  readonly rowIndex: number;
  readonly cells: readonly string[];
}

export interface DiscardedRowV1 {
  readonly rowIndex: number;
  readonly reason: DiscardReasonV1;
  readonly cells: readonly string[];
}

export interface WorkbookDiscardedRowV1 {
  readonly rowIndex: number;
  readonly reason: WorkbookDiscardReasonV1;
  readonly cells: readonly string[];
}

export const isEmptyRow = (cells: readonly string[]): boolean => cells.every((cell) => cell === "");

const bump = (tally: Map<number, number>, key: number): void => {
  tally.set(key, (tally.get(key) ?? 0) + 1);
};

export const modalWidth = (rows: readonly ProposedRowV1[]): number => {
  const tally = new Map<number, number>();
  for (const row of rows) {
    if (!isEmptyRow(row.cells)) {
      bump(tally, row.cells.length);
    }
  }
  let best = 0;
  let bestCount = 0;
  for (const [width, count] of tally) {
    if (count > bestCount || (count === bestCount && width > best)) {
      best = width;
      bestCount = count;
    }
  }
  return best;
};

/**
 * The first row that reads as headings: full width, every cell filled, and not
 * one cell that any value pattern recognises. A title row fails on width, a
 * report-date row fails on the date pattern, and a file that starts straight
 * into data has no header row at all.
 */
export const detectHeaderRow = (rows: readonly ProposedRowV1[]): number | null => {
  const width = modalWidth(rows);
  if (width === 0) {
    return null;
  }
  for (const row of rows) {
    if (row.cells.length === width && row.cells.every(looksLikeHeading) && new Set(row.cells).size === row.cells.length) {
      return row.rowIndex;
    }
  }
  return null;
};

export const generatedFieldName = (columnIndex: number): string => `Column ${columnIndex + 1}`;

/** Names from a heading row, filling gaps and disambiguating repeats. */
export const fieldNamesFrom = (
  headerCells: readonly string[] | null,
  fieldCount: number,
): readonly { readonly name: string; readonly isGenerated: boolean }[] => {
  const used = new Set<string>();
  return Array.from({ length: fieldCount }, (_unused, columnIndex) => {
    const heading = headerCells?.[columnIndex]?.trim() ?? "";
    const isGenerated = heading === "";
    let name = isGenerated ? generatedFieldName(columnIndex) : heading;
    for (let suffix = 2; used.has(name); suffix += 1) {
      name = `${isGenerated ? generatedFieldName(columnIndex) : heading} ${suffix}`;
    }
    used.add(name);
    return { name, isGenerated };
  });
};

/** `Field Log Messy` from `field-log-messy.csv`. */
export const titleize = (fileName: string): string => {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const words = stem
    .split(/[\s._-]+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length === 0 ? "Imported table" : words.join(" ");
};

/** `Jobs!C2:C61` — Excel's own spelling of a place. */
export const locationText = (
  sheetName: string,
  firstRow: number,
  firstColumn: number,
  lastRow: number,
  lastColumn: number,
): string => {
  const sheet = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`;
  const from = `${columnLettersOf(firstColumn)}${firstRow + 1}`;
  const to = `${columnLettersOf(lastColumn)}${lastRow + 1}`;
  return from === to ? `${sheet}!${from}` : `${sheet}!${from}:${to}`;
};

/** One non-empty cell as inference sees it. */
export interface CellInputV1 {
  readonly column: number;
  readonly text: string;
  readonly format: CellFormatV1 | null;
  readonly formula: {
    readonly text: string | null;
    readonly isArray: boolean;
    readonly isExternal: boolean;
    /** The lookups its text names (M03); empty for a shared child or an unparsed text. */
    readonly lookups: readonly LookupV1[];
    /**
     * Its relative shape (M03's `relativeShapeKey`): a shared child's is its
     * master's. `null` when neither its text nor its group's could be read.
     */
    readonly shapeKey: string | null;
  } | null;
}

/** A formula cell in a table's totals row, or in the footer row directly under a region table. */
export interface FooterFormulaV1 {
  readonly rowIndex: number;
  /** The sheet column. */
  readonly columnIndex: number;
  readonly text: string;
  readonly isArray: boolean;
  /** The row's first text cell left of it (`Total`), if any. */
  readonly label: string | null;
}

/** The aggregates a footer cell may apply to the column above it. */
const FOOTER_AGGREGATES: ReadonlySet<string> = new Set(["SUM", "AVERAGE", "COUNT", "COUNTA", "MIN", "MAX"]);

const unwrap = (ast: FormulaAstV1): FormulaAstV1 => (ast.kind === "group" ? unwrap(ast.expression) : ast);

/**
 * True when `text` aggregates exactly the column above it: one catalog
 * aggregate over one area in `column`, from at most `firstDataRow` down to
 * the row directly above `rowIndex`.
 */
export function aggregatesColumnAbove(text: string, rowIndex: number, column: number, firstDataRow: number): boolean {
  const parsed = parseFormula(text);
  if (parsed.kind !== "parsed") return false;
  const call = unwrap(parsed.ast);
  if (call.kind !== "call" || !FOOTER_AGGREGATES.has(call.name) || call.args.length !== 1) return false;
  const argument = call.args[0];
  const area = argument === null || argument === undefined ? null : unwrap(argument);
  if (area?.kind !== "reference" || area.reference.kind !== "area" || area.reference.scope !== null) return false;
  const { first, last } = area.reference;
  return (
    first.column === column &&
    last.column === column &&
    Math.min(first.row, last.row) <= firstDataRow &&
    Math.max(first.row, last.row) === rowIndex - 1
  );
}

const footerOf = (rowIndex: number, cells: readonly CellInputV1[]): FooterFormulaV1[] =>
  cells.flatMap((cell) => {
    const text = cell.formula?.text ?? null;
    if (text === null || cell.formula === null) return [];
    const label = [...cells].reverse().find((other) => other.column < cell.column && other.formula === null && other.text !== "")?.text ?? null;
    return [{ rowIndex, columnIndex: cell.column, text, isArray: cell.formula.isArray, label }];
  });

export type TableBuilderMode =
  | { readonly kind: "delimited" }
  | { readonly kind: "region" }
  | {
      readonly kind: "declared";
      /** The declared header row, or null for a table declared without one. */
      readonly headerRowIndex: number | null;
      readonly firstHeaderRow: number;
      /** Rows after this one are the declaration's totals rows. */
      readonly lastDataRow: number;
    };

/** What a finished builder measured. */
export interface MeasuredTableV1 {
  readonly firstColumn: number;
  /** Relative width: column `firstColumn + k` is field `k`. */
  readonly columnCount: number;
  readonly headerRowIndex: number | null;
  readonly headerCells: readonly string[] | null;
  readonly leadingRows: readonly ProposedRowV1[];
  readonly discardedRows: readonly WorkbookDiscardedRowV1[];
  readonly discardedRowCount: number;
  readonly dataRowCount: number;
  readonly firstRowIndex: number;
  readonly lastRowIndex: number;
  /** Stats by relative column; a column no data row filled has fresh stats. */
  readonly columns: readonly ColumnStats[];
  /** Formula cells of a declared totals row, or of a region's footer row (discarded `totals-row`). */
  readonly footer: readonly FooterFormulaV1[];
}

/**
 * Measures one table from rows fed in order. Rows are relative-text arrays
 * (cell `k` is column `firstColumn + k`) plus the non-empty cells behind them.
 */
export class TableBuilder {
  private readonly leading: ProposedRowV1[] = [];
  private readonly buffered: { readonly row: ProposedRowV1; readonly cells: readonly CellInputV1[] }[] = [];
  private readonly discarded: WorkbookDiscardedRowV1[] = [];
  private readonly columns = new Map<number, ColumnStats>();
  private discardedRowCount = 0;
  private dataRowCount = 0;
  private firstDataRowIndex = -1;
  private readonly footer: FooterFormulaV1[] = [];
  /** A region's latest data row, held back until a later row shows it is not the footer. */
  private pending: { readonly row: ProposedRowV1; readonly cells: readonly CellInputV1[] } | null = null;
  private headerRowIndex: number | null = null;
  private isDecided: boolean;
  private modal = 0;
  private widest = 0;
  private firstRowIndex = -1;
  private lastRowIndex = -1;

  constructor(
    readonly firstColumn: number,
    private readonly mode: TableBuilderMode,
    private readonly dateSystem: DateSystemV1 | null,
    private readonly fixedWidth: number | null = null,
  ) {
    this.isDecided = mode.kind === "declared";
    if (mode.kind === "declared") this.headerRowIndex = mode.headerRowIndex;
  }

  private discard(row: ProposedRowV1, reason: WorkbookDiscardReasonV1): void {
    this.discardedRowCount += 1;
    if (this.discarded.length < PROPOSAL_DISCARDED_ROW_LIMIT) {
      this.discarded.push({ rowIndex: row.rowIndex, reason, cells: row.cells });
    }
  }

  /**
   * A region's rows are held back one row: the last one may turn out to be
   * a footer of column aggregates (`=SUM(C2:C9)` under C), which is a table
   * metric and never a record (FR-14b).
   */
  private takeDataRow(row: ProposedRowV1, cells: readonly CellInputV1[]): void {
    if (this.mode.kind !== "region") {
      this.commitDataRow(row, cells);
      return;
    }
    if (this.pending !== null) this.commitDataRow(this.pending.row, this.pending.cells);
    this.pending = { row, cells };
  }

  private settlePending(): void {
    const pending = this.pending;
    if (pending === null) return;
    this.pending = null;
    const formulas = pending.cells.filter((cell) => cell.formula !== null);
    const isFooter =
      this.dataRowCount >= 2 &&
      formulas.length > 0 &&
      formulas.every(
        (cell) => cell.formula?.text != null && aggregatesColumnAbove(cell.formula.text, pending.row.rowIndex, cell.column, this.firstDataRowIndex),
      );
    if (!isFooter) {
      this.commitDataRow(pending.row, pending.cells);
      return;
    }
    this.discard(pending.row, "totals-row");
    this.footer.push(...footerOf(pending.row.rowIndex, pending.cells));
    this.lastRowIndex = pending.row.rowIndex - 1;
  }

  private commitDataRow(row: ProposedRowV1, cells: readonly CellInputV1[]): void {
    if (isEmptyRow(row.cells)) {
      this.discard(row, "empty-row");
      return;
    }
    if (this.firstDataRowIndex < 0) this.firstDataRowIndex = row.rowIndex;
    this.dataRowCount += 1;
    for (const cell of cells) {
      if (cell.text === "" && cell.formula === null) continue;
      const relative = cell.column - this.firstColumn;
      let stats = this.columns.get(relative);
      if (stats === undefined) {
        stats = newStats(this.mode.kind === "delimited" ? ENUM_OPTION_LIMIT : KEY_SKETCH_LIMIT, this.dateSystem);
        this.columns.set(relative, stats);
      }
      if (cell.text !== "") observe(stats, row.rowIndex, cell.text, cell.format);
      if (cell.formula !== null) {
        stats.formulaCount += 1;
        observeFormulaShape(stats, row.rowIndex, cell.formula);
        if (stats.firstFormula === null && cell.formula.text !== null) {
          stats.firstFormula = { text: cell.formula.text, isArray: cell.formula.isArray, isExternal: cell.formula.isExternal };
        }
        for (const lookup of cell.formula.lookups) {
          if (stats.lookups.length < COLUMN_LOOKUP_LIMIT && cell.formula.text !== null) {
            stats.lookups.push({ lookup, formulaText: cell.formula.text });
          }
        }
      }
    }
  }

  private route(row: ProposedRowV1, cells: readonly CellInputV1[]): void {
    const mode = this.mode;
    if (mode.kind === "declared") {
      if (row.rowIndex === mode.headerRowIndex) return;
      if (row.rowIndex < mode.firstHeaderRow || (mode.headerRowIndex !== null && row.rowIndex < mode.headerRowIndex)) {
        this.discard(row, "above-header");
      } else if (row.rowIndex > mode.lastDataRow) {
        this.discard(row, "totals-row");
        this.footer.push(...footerOf(row.rowIndex, cells));
      } else {
        this.takeDataRow(row, cells);
      }
      return;
    }
    if (this.headerRowIndex !== null && row.rowIndex <= this.headerRowIndex) {
      if (row.rowIndex !== this.headerRowIndex) this.discard(row, "above-header");
      return;
    }
    this.takeDataRow(row, cells);
  }

  /** Decides the header over the rows buffered so far; later rows stream. */
  decide(): void {
    if (this.isDecided) return;
    this.isDecided = true;
    const rows = this.buffered.map((entry) => entry.row);
    this.headerRowIndex = detectHeaderRow(rows);
    this.modal = modalWidth(rows);
    for (const { row, cells } of this.buffered) this.route(row, cells);
    this.buffered.length = 0;
  }

  add(row: ProposedRowV1, cells: readonly CellInputV1[]): void {
    if (this.firstRowIndex < 0) this.firstRowIndex = row.rowIndex;
    this.lastRowIndex = row.rowIndex;
    this.widest = Math.max(this.widest, row.cells.length);
    if (this.leading.length < PROPOSAL_LEADING_ROWS) this.leading.push(row);
    if (this.isDecided) {
      this.route(row, cells);
      return;
    }
    this.buffered.push({ row, cells });
    if (this.buffered.length >= PROPOSAL_LEADING_ROWS) this.decide();
  }

  finish(): MeasuredTableV1 {
    this.decide();
    this.settlePending();
    // As wide as the widest row, never the *typical* row: a ragged row's
    // extra cells are real values, and a narrower table would drop them.
    const columnCount = this.fixedWidth ?? Math.max(this.modal, this.widest);
    const headerCells =
      this.headerRowIndex === null
        ? null
        : (this.leading.find((row) => row.rowIndex === this.headerRowIndex)?.cells ?? null);
    return {
      firstColumn: this.firstColumn,
      columnCount,
      headerRowIndex: this.headerRowIndex,
      headerCells,
      leadingRows: this.leading,
      discardedRows: this.discarded,
      discardedRowCount: this.discardedRowCount,
      dataRowCount: this.dataRowCount,
      firstRowIndex: this.firstRowIndex,
      lastRowIndex: this.lastRowIndex,
      columns: Array.from(
        { length: columnCount },
        (_unused, index) =>
          this.columns.get(index) ??
          newStats(this.mode.kind === "delimited" ? ENUM_OPTION_LIMIT : KEY_SKETCH_LIMIT, this.dateSystem),
      ),
      footer: this.footer,
    };
  }
}
