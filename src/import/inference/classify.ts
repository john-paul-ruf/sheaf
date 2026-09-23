/**
 * What each selected sheet is for (M21; FR-5, D45; CAP-22/CAP-25).
 *
 * - `table` — it yields at least one table;
 * - `lookup` — a validation list elsewhere draws its options from it, and its
 *   tables are single-column lists or code + label pairs (FR-5: "lookup lists
 *   are classified as enum sources");
 * - `summary` — no table, at most {@link SUMMARY_MAX_USED_CELLS} used cells,
 *   at least half its numbers are formula results, and some formula reads
 *   another sheet;
 * - `chart` — a chartsheet, or a sheet with no table whose content is charts or
 *   pivots;
 * - `snapshot` — whatever plays none of those roles.
 *
 * Every selected sheet is also snapshot-retained whatever its roles (FR-5);
 * `snapshot` as a *role* only says it becomes nothing else. Classification
 * preserves and states — rebuilding charts and metrics live is F04's (D45).
 */

import type { SheetKindV1 } from "../facts/index.js";
import { SHEET_ROLES, type SheetRoleV1 } from "./workbook-proposal.js";

/** A sheet with more used cells than this is not a summary tab. */
export const SUMMARY_MAX_USED_CELLS = 500;

export interface SheetShapeV1 {
  readonly sheetKind: SheetKindV1;
  /** Column counts of its standalone tables. */
  readonly tableWidths: readonly number[];
  readonly isListSource: boolean;
  /** Chart and pivot-table parts on it. */
  readonly chartPartCount: number;
  readonly usedCellCount: number;
  readonly numericCellCount: number;
  readonly formulaNumericCount: number;
  /** Master formulas that reference another sheet. */
  readonly crossSheetFormulaCount: number;
}

/** The sheet's roles in canonical order; never empty. */
export function classifySheet(shape: SheetShapeV1): readonly SheetRoleV1[] {
  const hasTables = shape.tableWidths.length > 0;
  const roles = new Set<SheetRoleV1>();
  if (hasTables) roles.add("table");
  if (hasTables && shape.isListSource && shape.tableWidths.every((width) => width <= 2)) roles.add("lookup");
  if (
    !hasTables &&
    shape.usedCellCount <= SUMMARY_MAX_USED_CELLS &&
    shape.crossSheetFormulaCount > 0 &&
    shape.numericCellCount > 0 &&
    shape.formulaNumericCount * 2 >= shape.numericCellCount
  ) {
    roles.add("summary");
  }
  if (shape.sheetKind === "chartsheet" || (!hasTables && shape.chartPartCount > 0)) roles.add("chart");
  if (roles.size === 0) roles.add("snapshot");
  return SHEET_ROLES.filter((role) => roles.has(role));
}
