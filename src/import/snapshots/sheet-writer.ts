/**
 * Writes one imported sheet's normalized snapshot, format v2 (M22; CA-22,
 * D39, D41).
 *
 * The writer is fed a sheet's facts in stream order, one row at a time, and
 * turns each value into S03's rendered text through the one bounded format
 * subset (`formatForSnapshot`), carrying the column's current number format
 * the way M65's `cell-format` rule states it. A cell that also carried a
 * formula is marked `formula-result`: its text is the imported cached value,
 * a literal, never a recalculation (invariant 7, D33). Nothing else of the
 * workbook — no markup, no link, no script — has anywhere to go (invariant 8).
 *
 * **Bounded.** The writer holds one chunk's rows; a chunk is sealed through
 * the caller's `sealChunk` the moment the next row would take it past
 * {@link SNAPSHOT_CHUNK_TARGET_BYTES}, well under the 1 MiB decoded cap. The
 * manifest it finishes with names every chunk with its first and last row, so
 * a page read opens only the chunks it needs (CA-22).
 */

import type { InertItemId, SheetId } from "../../domain/model/ids.js";
import type { CellRangeV1, SheetClassificationV1 } from "../../domain/model/snapshots.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import type { DateSystemV1 } from "../facts/index.js";
import {
  SNAPSHOT_CHUNK_MAX_DECODED_BYTES,
  encodeSheetSnapshotChunk,
  formatForSnapshot,
  type ManifestChunkRefV1,
  type SheetSnapshotChunkRefV2,
  type SheetSnapshotManifestV2,
  type SnapshotCellV2,
  type SnapshotDiscardReasonV1,
  type SnapshotRowV2,
} from "./sheet-snapshot.js";

/** Where a chunk is cut: a quarter of the cap leaves room for any one row's overshoot. */
export const SNAPSHOT_CHUNK_TARGET_BYTES = SNAPSHOT_CHUNK_MAX_DECODED_BYTES / 4;

/** Seals one encoded chunk and returns its reference; the writer never holds a key. */
export type SealSnapshotChunkV1 = (payload: Uint8Array, sequence: number) => Promise<ManifestChunkRefV1>;

export interface SheetSnapshotPlanV1 {
  readonly sheetId: SheetId;
  readonly sheetOrdinal: number;
  readonly displayName: string;
  readonly classification: readonly SheetClassificationV1[];
  readonly dateSystem: DateSystemV1;
  readonly inertAnchors: readonly { readonly inertItemId: InertItemId; readonly range: CellRangeV1 }[];
}

/** One source cell as the writer receives it. */
export interface SnapshotSourceCellV1 {
  readonly columnIndex: number;
  readonly value: CellValueV1;
  readonly numberFormat: string | null;
  readonly isFormula: boolean;
}

/** An estimate of a row's encoded size, generous so a chunk never meets the cap. */
const rowBytes = (row: SnapshotRowV2): number =>
  16 + row.cells.reduce((sum, cell) => sum + 24 + new TextEncoder().encode(cell.text).byteLength, 0);

export class SheetSnapshotWriter {
  readonly #plan: SheetSnapshotPlanV1;
  readonly #seal: SealSnapshotChunkV1;
  readonly #chunks: SheetSnapshotChunkRefV2[] = [];
  readonly #merges: CellRangeV1[] = [];
  readonly #discarded: { readonly rowIndex: number; readonly reason: SnapshotDiscardReasonV1 }[] = [];
  #rows: SnapshotRowV2[] = [];
  #bytes = 0;
  #rowCount = 0;
  #columnCount = 0;

  constructor(plan: SheetSnapshotPlanV1, seal: SealSnapshotChunkV1) {
    this.#plan = plan;
    this.#seal = seal;
  }

  merge(range: CellRangeV1): void {
    this.#merges.push(range);
  }

  /** A row no table took (D36/FR-4): kept in the snapshot, marked why. */
  discard(rowIndex: number, reason: SnapshotDiscardReasonV1): void {
    const last = this.#discarded.at(-1);
    if (last === undefined || last.rowIndex < rowIndex) this.#discarded.push({ rowIndex, reason });
  }

  /** One source row, in ascending row order. A row with no value still counts toward the grid. */
  async row(rowIndex: number, cellCount: number, cells: readonly SnapshotSourceCellV1[]): Promise<void> {
    this.#rowCount = Math.max(this.#rowCount, rowIndex + 1);
    this.#columnCount = Math.max(this.#columnCount, cellCount);
    const rendered: SnapshotCellV2[] = [];
    for (const cell of [...cells].sort((left, right) => left.columnIndex - right.columnIndex)) {
      const shown = formatForSnapshot(cell.value, cell.numberFormat, this.#plan.dateSystem);
      if (shown.text === "") continue;
      rendered.push({
        columnIndex: cell.columnIndex,
        text: shown.text.normalize("NFC"),
        kind: cell.isFormula ? "formula-result" : shown.kind,
      });
      this.#columnCount = Math.max(this.#columnCount, cell.columnIndex + 1);
    }
    if (rendered.length === 0) return;
    const row = { rowIndex, cells: rendered };
    const size = rowBytes(row);
    if (this.#rows.length > 0 && this.#bytes + size > SNAPSHOT_CHUNK_TARGET_BYTES) {
      await this.#flush();
    }
    this.#rows.push(row);
    this.#bytes += size;
  }

  async #flush(): Promise<void> {
    const first = this.#rows[0];
    const last = this.#rows.at(-1);
    if (first === undefined || last === undefined) return;
    const payload = encodeSheetSnapshotChunk({ chunkVersion: 2, firstRow: first.rowIndex, rows: this.#rows });
    const ref = await this.#seal(payload, this.#chunks.length);
    this.#chunks.push({ ...ref, firstRow: first.rowIndex, lastRow: last.rowIndex });
    this.#rows = [];
    this.#bytes = 0;
  }

  /** Seals the last chunk and returns the manifest that names them all. */
  async finish(): Promise<SheetSnapshotManifestV2> {
    await this.#flush();
    return {
      manifestVersion: 2,
      sheetId: this.#plan.sheetId,
      sheetOrdinal: this.#plan.sheetOrdinal,
      displayName: this.#plan.displayName.normalize("NFC"),
      classification: this.#plan.classification,
      rowCount: this.#rowCount,
      columnCount: this.#columnCount,
      chunks: this.#chunks,
      merges: this.#merges,
      inertAnchors: this.#plan.inertAnchors,
      discardedRows: this.#discarded,
    };
  }
}
