/**
 * Over-budget workbooks, generated at test time rather than committed: a
 * sheet past 250,000 real cells is megabytes of markup nobody could review.
 *
 * - {@link buildOversizedWorkbook}: one sheet over the cell budget on its own,
 *   so no subset fits → route `handoff`.
 * - {@link buildSubsetWorkbook}: two sheets that fit together and one that
 *   does not → route `subset`.
 */

import { buildOoxml, type RowSpec, type SheetSpec } from "./ooxml-builder.js";

const COLUMNS = 5;

const denseSheet = (name: string, rowCount: number): SheetSpec => {
  const rows: RowSpec[] = [["Visit", "Crew", "Hours", "Rate", "Total"]];
  for (let row = 1; row < rowCount; row += 1) {
    rows.push([row, row % 7, (row % 9) + 0.5, 40 + (row % 5), row * 3]);
  }
  return { name, rows };
};

/** Real cells in the oversized sheet: 60,001 rows × 5 columns. */
export const OVERSIZED_CELLS = 60_001 * COLUMNS;

export const buildOversizedWorkbook = (): Uint8Array =>
  buildOoxml({ method: "stored", sheets: [denseSheet("Archive", 60_001)] });

export const buildSubsetWorkbook = (): Uint8Array =>
  buildOoxml({
    method: "stored",
    sheets: [denseSheet("This week", 200), denseSheet("Archive", 60_001), denseSheet("Crew", 50)],
  });
