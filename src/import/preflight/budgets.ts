/**
 * The fixed workbook import budgets (D31), the architecture's reference floor
 * on every device until F07's calibrated M04 budgets replace them.
 *
 * Because the budget is device-independent until then, a larger device does
 * not yet receive a larger budget; the handoff route's copy is conditional for
 * exactly that reason. Nothing outside M14 reads these numbers except through
 * the pre-flight report, which carries them so surfaces state real limits.
 */

export const IMPORT_BUDGET_V1 = Object.freeze({
  maxSourceBytes: 52_428_800,
  /** Across the SELECTED sheets. */
  maxEstimatedCells: 250_000,
  maxInventoriedSheets: 50,
} as const);

export type ImportBudgetV1 = {
  readonly [K in keyof typeof IMPORT_BUDGET_V1]: number;
};
