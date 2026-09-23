/**
 * Where every staged row goes on promotion (M23; CA-19, FR-4).
 *
 * A reviewed proposal names its tables by key and states their columns and
 * header rows; S02's `tableRowExtents` supplies the one thing a proposal leaves
 * out — the source rows each table's builder was fed. With both, this module
 * walks the staged facts once and places each row exactly as inference did:
 *
 * - a **declared table** takes its declared range; its header row is the
 *   reviewed one, rows above it are `above-header`, its declared totals rows
 *   are `totals-row`;
 * - a **region table** takes the rows of its extent that hold a *loose* cell
 *   (one inside no declared table) in its columns; rows up to the reviewed
 *   header are `above-header`;
 * - a **delimited** file is its one table, every row, as F02 read it.
 *
 * Any fed row with no text in the table's columns is `empty-row`; every other
 * fed row past the header is a data row.
 *
 * **Placement is in stream order, as inference's is.** A declared table takes
 * rows only once its `declared-table` fact has streamed, and a cell is loose
 * when no declared table streamed *so far* covers it. An adapter that states a
 * sheet's tables after its rows therefore gets the same placement here that
 * inference gave it at review — never a second reading. The number of data rows a table gets
 * must equal the count the review showed (`ProposedTableV2.rowCount`, exact):
 * a disagreement means this plan and the proposal read the rows differently,
 * and promotion refuses rather than creating an app the user did not review.
 *
 * Only one row's cells are held at a time; nothing here buffers a sheet.
 */

import type { CellValueV1 } from "../../domain/model/values.js";
import type { DateSystemV1, RangeV1, WorkbookFactStreamItemV2 } from "../facts/index.js";
import type { TableRowExtentV1 } from "../inference/workbook.js";
import type { ProposedTableV2, ProposedWorkbookV1 } from "../inference/workbook-proposal.js";
import { sourceTextOfCellValue } from "../inference/values.js";

/** One source cell of the row being visited. */
export interface PlannedCellV1 {
  readonly value: CellValueV1 | null;
  readonly numberFormat: string | null;
  readonly isFormula: boolean;
}

/** One source row, as the walk hands it to a visitor. */
export interface PlannedRowV1 {
  readonly sheetIndex: number;
  readonly rowIndex: number;
  readonly cellCount: number;
  readonly cells: ReadonlyMap<number, PlannedCellV1>;
}

export type RowPlacementV1 =
  | { readonly kind: "data"; readonly table: ProposedTableV2 }
  | { readonly kind: "discarded"; readonly reason: "above-header" | "empty-row" | "totals-row" }
  | { readonly kind: "header" | "unplaced" };

/** Every sheet-level fact a snapshot needs beside the rows. */
export interface SheetStartV1 {
  readonly sheetIndex: number;
  readonly name: string;
  readonly dateSystem: DateSystemV1;
}

export interface RowWalkVisitorV1 {
  sheet?(sheet: SheetStartV1): void;
  /** A `declared-table` fact, in stream order, for the sheet being walked. */
  declaredTable?(sheetIndex: number): void;
  merge?(sheetIndex: number, range: RangeV1): void;
  row(row: PlannedRowV1): void | Promise<void>;
}

interface GeometryV1 {
  readonly table: ProposedTableV2;
  readonly sheetIndex: number;
  readonly firstColumn: number;
  readonly lastColumn: number;
  readonly firstRow: number;
  readonly lastRow: number;
  readonly declared: { readonly firstHeaderRow: number; readonly lastDataRow: number } | null;
  readonly isDelimited: boolean;
}

const sheetIndexOf = (sheetKey: string): number => Number(sheetKey.slice(1));

const isFilled = (cell: PlannedCellV1 | undefined): boolean =>
  cell !== undefined && ((cell.value !== null && sourceTextOfCellValue(cell.value) !== "") || cell.isFormula);

const hasText = (cell: PlannedCellV1 | undefined): boolean =>
  cell?.value !== undefined && cell.value !== null && sourceTextOfCellValue(cell.value) !== "";

const inRange = (range: RangeV1, rowIndex: number, columnIndex: number): boolean =>
  rowIndex >= range.firstRow && rowIndex <= range.lastRow && columnIndex >= range.firstColumn && columnIndex <= range.lastColumn;

/**
 * The text of one cell as promotion converts it (S02's `sourceTextOfCellValue`),
 * `undefined` at or past the row's width — the cell never existed, `missing`
 * rather than `blank` (M65's sparsity contract).
 */
export function sourceTextAt(row: PlannedRowV1, columnIndex: number): string | undefined {
  if (columnIndex >= row.cellCount) return undefined;
  const value = row.cells.get(columnIndex)?.value ?? null;
  return value === null ? "" : sourceTextOfCellValue(value);
}

export class RowPlan {
  readonly #geometries: readonly GeometryV1[];
  readonly #declaredTables: readonly ProposedTableV2[];
  /** Declared tables whose fact has streamed, by table key. */
  readonly #active = new Set<string>();
  readonly #declaredSeen = new Map<number, number>();
  readonly #counts = new Map<string, number>();

  constructor(proposal: ProposedWorkbookV1, extents: ReadonlyMap<string, TableRowExtentV1>) {
    this.#declaredTables = proposal.tables.filter((table) => table.source.kind === "declared-table");
    this.#geometries = proposal.tables.flatMap((table): GeometryV1[] => {
      const sheetIndex = sheetIndexOf(table.sheetKey);
      if (table.source.kind === "declared-table") {
        const { range, totalsRowCount } = table.source;
        return [
          {
            table,
            sheetIndex,
            firstColumn: range.firstColumn,
            lastColumn: range.lastColumn,
            firstRow: range.firstRow,
            lastRow: range.lastRow,
            declared: { firstHeaderRow: range.firstRow, lastDataRow: range.lastRow - totalsRowCount },
            isDelimited: false,
          },
        ];
      }
      const extent = extents.get(table.tableKey);
      if (extent === undefined) return [];
      return [
        {
          table,
          sheetIndex,
          firstColumn: proposal.isDelimited ? 0 : table.firstColumn,
          lastColumn: proposal.isDelimited ? Number.MAX_SAFE_INTEGER : table.lastColumn,
          firstRow: extent.firstRowIndex,
          lastRow: extent.lastRowIndex,
          declared: null,
          isDelimited: proposal.isDelimited,
        },
      ];
    });
  }

  /** A sheet's next declared table has streamed: `s<sheet>.t<n>` by its ordinal, as inference keys it. */
  declare(sheetIndex: number): void {
    const ordinal = this.#declaredSeen.get(sheetIndex) ?? 0;
    this.#declaredSeen.set(sheetIndex, ordinal + 1);
    this.#active.add(`s${String(sheetIndex)}.t${String(ordinal)}`);
  }

  #declaredRangesOf(sheetIndex: number): readonly RangeV1[] {
    return this.#declaredTables.flatMap((table) =>
      table.source.kind === "declared-table" && sheetIndexOf(table.sheetKey) === sheetIndex && this.#active.has(table.tableKey)
        ? [table.source.range]
        : [],
    );
  }

  /** The tables a row belongs to, and how: at most one placement per table that was fed it. */
  place(row: PlannedRowV1): readonly RowPlacementV1[] {
    const placements: RowPlacementV1[] = [];
    for (const geometry of this.#geometries) {
      if (geometry.sheetIndex !== row.sheetIndex) continue;
      if (geometry.declared !== null && !this.#active.has(geometry.table.tableKey)) continue;
      if (row.rowIndex < geometry.firstRow || row.rowIndex > geometry.lastRow) continue;
      const columns = this.#columnsOf(geometry, row);
      if (!geometry.isDelimited && !columns.some(([, cell]) => isFilled(cell))) continue;

      const header = geometry.table.headerRowIndex;
      const declared = geometry.declared;
      let placement: RowPlacementV1;
      if (declared !== null && row.rowIndex === header) {
        placement = { kind: "header" };
      } else if (declared !== null && (row.rowIndex < declared.firstHeaderRow || (header !== null && row.rowIndex < header))) {
        placement = { kind: "discarded", reason: "above-header" };
      } else if (declared !== null && row.rowIndex > declared.lastDataRow) {
        placement = { kind: "discarded", reason: "totals-row" };
      } else if (declared === null && header !== null && row.rowIndex <= header) {
        placement = row.rowIndex === header ? { kind: "header" } : { kind: "discarded", reason: "above-header" };
      } else if (!columns.some(([, cell]) => hasText(cell))) {
        placement = { kind: "discarded", reason: "empty-row" };
      } else {
        placement = { kind: "data", table: geometry.table };
        this.#counts.set(geometry.table.tableKey, (this.#counts.get(geometry.table.tableKey) ?? 0) + 1);
      }
      placements.push(placement);
    }
    return placements;
  }

  /** The cells a table reads from a row: loose ones only, unless it is declared or delimited. */
  #columnsOf(geometry: GeometryV1, row: PlannedRowV1): [number, PlannedCellV1][] {
    const declaredRanges = geometry.declared === null && !geometry.isDelimited ? this.#declaredRangesOf(row.sheetIndex) : [];
    return [...row.cells.entries()].filter(
      ([column]) =>
        column >= geometry.firstColumn &&
        column <= geometry.lastColumn &&
        !declaredRanges.some((range) => inRange(range, row.rowIndex, column)),
    );
  }

  /** Whether a cell is one a region table may read (not inside a declared table). */
  isReadableBy(table: ProposedTableV2, row: PlannedRowV1, columnIndex: number): boolean {
    if (table.source.kind === "declared-table") return true;
    return !this.#declaredRangesOf(row.sheetIndex).some((range) => inRange(range, row.rowIndex, columnIndex));
  }

  /**
   * Refuses a plan whose data-row counts differ from the reviewed proposal's
   * exact counts. Call after one complete walk.
   */
  assertMatches(proposal: ProposedWorkbookV1): void {
    for (const table of proposal.tables) {
      const planned = this.#counts.get(table.tableKey) ?? 0;
      if (planned !== table.rowCount) {
        throw new Error("promotion's row plan disagrees with the reviewed proposal's row count");
      }
    }
  }
}

/**
 * Walks a staged fact stream row by row, in stream order. A stream with no
 * `sheet` fact is one implicit sheet (index 0), as M65 states.
 */
export async function walkRows(items: Iterable<WorkbookFactStreamItemV2>, visitor: RowWalkVisitorV1): Promise<void> {
  let sheetIndex = 0;
  let current: { rowIndex: number; cellCount: number; cells: Map<number, PlannedCellV1> } | null = null;
  const formats = new Map<number, string>();

  const flush = async (): Promise<void> => {
    if (current === null) return;
    const row = current;
    current = null;
    await visitor.row({ sheetIndex, rowIndex: row.rowIndex, cellCount: row.cellCount, cells: row.cells });
  };
  const cellAt = (columnIndex: number): PlannedCellV1 =>
    current?.cells.get(columnIndex) ?? { value: null, numberFormat: formats.get(columnIndex) ?? null, isFormula: false };

  for (const item of items) {
    if (item.kind !== "batch") continue;
    for (const fact of item.facts) {
      switch (fact.kind) {
        case "sheet":
          await flush();
          sheetIndex = fact.sheetIndex;
          formats.clear();
          visitor.sheet?.({ sheetIndex: fact.sheetIndex, name: fact.name, dateSystem: fact.dateSystem });
          break;
        case "row":
          await flush();
          current = { rowIndex: fact.rowIndex, cellCount: fact.cellCount, cells: new Map() };
          break;
        case "cell-format":
          formats.set(fact.columnIndex, fact.numberFormat);
          break;
        case "value":
          if (current?.rowIndex === fact.rowIndex) {
            current.cells.set(fact.columnIndex, {
              ...cellAt(fact.columnIndex),
              value: fact.value,
              numberFormat: formats.get(fact.columnIndex) ?? null,
            });
          }
          break;
        case "formula":
          if (current?.rowIndex === fact.rowIndex) {
            current.cells.set(fact.columnIndex, { ...cellAt(fact.columnIndex), isFormula: true });
          }
          break;
        case "merge":
          visitor.merge?.(sheetIndex, fact.range);
          break;
        case "declared-table":
          // Inference sees the table from here on — the row still being
          // assembled included, since it is placed only when it is flushed.
          visitor.declaredTable?.(sheetIndex);
          break;
        case "diagnostic":
        case "validation":
        case "defined-name":
        case "preserved-part":
          break;
        default: {
          const unreachable: never = fact;
          void unreachable;
        }
      }
    }
  }
  await flush();
}
