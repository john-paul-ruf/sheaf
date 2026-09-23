/**
 * The contracts between the import worker and each workbook format (M65;
 * D35, CA-18).
 *
 * A format contributes two things and nothing else:
 *
 * - an {@link InventoryReaderV1}, which reads **metadata only** — part lists,
 *   directories, declared dimensions — and never a cell part or record. Macro
 *   and unsafe content surface here, as outcomes, so a refusal happens before
 *   any stage exists (invariant 8);
 * - a {@link WorkbookAdapterV1}, which streams the V2 facts of the selected
 *   sheets only (D39).
 *
 * Pre-flight (M14) consumes readers through this interface and never imports
 * an adapter; the import worker composes the registry (D35). The container
 * handles come from M13 as types only: this module imports no behavior from
 * anywhere but `domain/model/values`.
 */

import type { UnreadableDetailV1 } from "../source/bounds.js";
import type { CfbHandleV1 } from "../source/cfb.js";
import type { RandomAccessSource } from "../source/source.js";
import type { ZipContainerHandleV1 } from "../source/zip.js";
import type {
  CancellationTokenV1,
  DateSystemV1,
  PreservedPartKindV1,
  RangeV1,
  SheetKindV1,
  SheetVisibilityV1,
  WorkbookFactStreamItemV2,
} from "./workbook-facts.js";

export const WORKBOOK_FORMATS = Object.freeze(["xlsx", "xlsb", "xls", "ods", "html-table"] as const);
export type WorkbookFormatV1 = (typeof WORKBOOK_FORMATS)[number];

export type ContainerHandleV1 =
  | { readonly kind: "zip"; readonly zip: ZipContainerHandleV1 }
  | { readonly kind: "cfb"; readonly cfb: CfbHandleV1 }
  | { readonly kind: "text"; readonly source: RandomAccessSource };

export const MACRO_SIGNAL_KINDS = Object.freeze([
  "vba-project",
  "xlm-macro-sheet",
  "macro-content-type",
  "script-part",
] as const);
export type MacroSignalKindV1 = (typeof MACRO_SIGNAL_KINDS)[number];

/** Why a workbook is refused as macro content, and which part said so. */
export interface MacroSignalV1 {
  readonly kind: MacroSignalKindV1;
  readonly partPath: string;
}

/** One count per kind; zero is an exact count, not an unknown. */
export type PreservedPartCountsV1 = Readonly<Record<PreservedPartKindV1, number>>;

export interface DeclaredTableSummaryV1 {
  readonly name: string;
  readonly range: RangeV1;
}

export interface SheetInventoryItemV1 {
  readonly sheetIndex: number;
  readonly name: string;
  readonly kind: SheetKindV1;
  readonly visibility: SheetVisibilityV1;
  readonly declaredRange: RangeV1 | null;
  readonly declaredTables: readonly DeclaredTableSummaryV1[];
  /** `null` when nothing declares it — never 0 standing in for unknown. */
  readonly estimatedRowCount: number | null;
  /** `null` when nothing declares it — never 0 standing in for unknown. */
  readonly estimatedCellCount: number | null;
  readonly preservedPartCounts: PreservedPartCountsV1;
}

export interface DefinedNameSummaryV1 {
  readonly name: string;
  readonly ref: string;
  readonly sheetIndex: number | null;
}

export interface WorkbookInventoryV1 {
  readonly format: WorkbookFormatV1;
  /** Workbook order. */
  readonly sheets: readonly SheetInventoryItemV1[];
  /**
   * `false` only when a format's metadata cannot name its sheets without
   * reading cell data (ODS without `settings.xml`); pre-flight then offers
   * *fits* or *handoff*, never *subset*.
   */
  readonly sheetListKnown: boolean;
  readonly definedNames: readonly DefinedNameSummaryV1[];
  readonly dateSystem: DateSystemV1;
  /** Workbook-level parts: external links, data connections. */
  readonly preservedPartCounts: PreservedPartCountsV1;
}

export type InventoryOutcomeV1 =
  | { readonly kind: "inventory"; readonly inventory: WorkbookInventoryV1 }
  | { readonly kind: "macro"; readonly signal: MacroSignalV1 }
  | { readonly kind: "unreadable"; readonly detail: UnreadableDetailV1 };

export interface InventoryReaderV1 {
  readonly format: WorkbookFormatV1;
  /** Metadata only. Never reads a cell part/record. May return a macro/unsafe outcome. */
  readInventory(container: ContainerHandleV1): Promise<InventoryOutcomeV1>;
}

export interface ParseSheetsOptionsV1 {
  readonly cancellation: CancellationTokenV1;
  /** At most this many facts per batch; defaults to `WORKBOOK_FACTS_PER_BATCH`. */
  readonly factsPerBatch?: number;
}

export interface WorkbookAdapterV1 {
  readonly format: WorkbookFormatV1;
  /**
   * Streams the selected sheets (workbook indexes) in workbook order. Ends
   * with a summary when complete; a cancelled stream ends without one.
   */
  parseSheets(
    container: ContainerHandleV1,
    selection: readonly number[],
    options: ParseSheetsOptionsV1,
  ): AsyncGenerator<WorkbookFactStreamItemV2>;
}
