/**
 * Workbook pre-flight (M14; CA-18, D31, D35, D47, invariant 8, FR-2/FR-3).
 *
 * Pre-flight answers "can this device import this, and how?" from metadata
 * alone, before any stage exists:
 *
 * 1. it opens the container the bytes are (never the one the name claims) and
 *    identifies the workbook format from the container's own declarations —
 *    `[Content_Types].xml`, `mimetype`, the CFB directory;
 * 2. it asks the format's {@link InventoryReaderV1} — composed by the import
 *    worker, never imported here (D35) — for the sheet inventory;
 * 3. it routes: **fits** (every sheet within budget), **subset** (over budget
 *    but some sheet fits alone), or **handoff** (no sheet fits alone), with
 *    the default selection D47 prescribes.
 *
 * Macro content, unsafe containers and unreadable files end here as refusals,
 * so no refusal ever leaves a partial app. A format with no registered reader
 * keeps F02's truthful `workbook-format-later-release` refusal: that is how the
 * worker composes only the adapters that exist.
 */

import type {
  ContainerHandleV1,
  InventoryReaderV1,
  PreservedPartCountsV1,
  SheetInventoryItemV1,
  WorkbookFormatV1,
  DateSystemV1,
} from "../facts/index.js";
import { PRESERVED_PART_KINDS } from "../facts/index.js";
import { BoundExceededError, isBoundExceeded } from "../source/bounds.js";
import { openCfbContainer, requireUnencrypted, type CfbHandleV1 } from "../source/cfb.js";
import { CONTENT_TYPES_PART, readContentTypes } from "../source/opc.js";
import type { SniffResultV1 } from "../source/sniff.js";
import type { RandomAccessSource } from "../source/source.js";
import { openZipContainer, type ZipContainerHandleV1 } from "../source/zip.js";
import { IMPORT_BUDGET_V1, type ImportBudgetV1 } from "./budgets.js";
import {
  iworkRefusal,
  laterRelease,
  unreadable,
  type LaterReleaseFormatV1,
  type RefusalV1,
} from "./refusal.js";

export type WorkbookRouteV1 = "fits" | "subset" | "handoff";

export interface WorkbookFormatContradictionV1 {
  /** Lowercased, without the dot. */
  readonly declaredExtension: string;
  readonly detectedFormat: WorkbookFormatV1;
}

export interface WorkbookTotalsV1 {
  readonly sheetCount: number;
  /** Sum over the sheets that declare one; `null` when none does. */
  readonly estimatedRowCount: number | null;
  /** Sum over the sheets that declare one; `null` when none does. */
  readonly estimatedCellCount: number | null;
  /** Workbook-level parts plus every sheet's. */
  readonly preservedPartCounts: PreservedPartCountsV1;
}

export interface WorkbookPreflightReportV1 {
  readonly fileName: string;
  readonly sourceByteLength: number;
  readonly format: WorkbookFormatV1;
  readonly formatContradiction: WorkbookFormatContradictionV1 | null;
  /** Workbook order, every sheet — none is dropped from review (FR-5). */
  readonly sheets: readonly SheetInventoryItemV1[];
  readonly sheetListKnown: boolean;
  readonly dateSystem: DateSystemV1;
  readonly totals: WorkbookTotalsV1;
  readonly route: WorkbookRouteV1;
  /** Sheet indexes preselected for import (D47). */
  readonly defaultSelection: readonly number[];
  readonly budgets: ImportBudgetV1;
  /** Always `true`: every count here comes from metadata, not cells (D24). */
  readonly isEstimate: true;
}

export type WorkbookPreflightOutcomeV1 =
  | { readonly kind: "proceed"; readonly report: WorkbookPreflightReportV1 }
  | { readonly kind: "refused"; readonly refusal: RefusalV1 };

const MAIN_WORKBOOK_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
  "application/vnd.ms-excel.sheet.macroenabled.main+xml",
  "application/vnd.ms-excel.template.macroenabled.main+xml",
  "application/vnd.ms-excel.addin.macroenabled.main+xml",
]);
const BINARY_WORKBOOK_TYPE = "application/vnd.ms-excel.sheet.binary.macroenabled.main";
const ODS_MIMETYPE = "application/vnd.oasis.opendocument.spreadsheet";

const FORMAT_BY_EXTENSION = new Map<string, WorkbookFormatV1 | "delimited">([
  ["xlsx", "xlsx"],
  ["xlsm", "xlsx"],
  ["xltx", "xlsx"],
  ["xltm", "xlsx"],
  ["xlsb", "xlsb"],
  ["xls", "xls"],
  ["ods", "ods"],
  ["html", "html-table"],
  ["htm", "html-table"],
  ["csv", "delimited"],
  ["tsv", "delimited"],
  ["txt", "delimited"],
]);

const LATER_RELEASE_NAME: Readonly<Record<WorkbookFormatV1, LaterReleaseFormatV1>> = {
  xlsx: "ooxml",
  xlsb: "xlsb",
  xls: "xls",
  ods: "ods",
  "html-table": "html",
};

type Identified =
  | { readonly kind: "workbook"; readonly format: WorkbookFormatV1; readonly container: ContainerHandleV1 }
  | { readonly kind: "iwork" };

const identifyZip = async (zip: ZipContainerHandleV1): Promise<Identified> => {
  const container = { kind: "zip", zip } as const;
  if (zip.has(CONTENT_TYPES_PART)) {
    const types = (await readContentTypes(zip)).declared.map((each) => each.contentType.toLowerCase());
    if (types.includes(BINARY_WORKBOOK_TYPE)) return { kind: "workbook", format: "xlsb", container };
    if (types.some((type) => MAIN_WORKBOOK_TYPES.has(type))) return { kind: "workbook", format: "xlsx", container };
    throw new BoundExceededError("unrecognized-content");
  }
  if (zip.entries.some(({ name }) => name.startsWith("Index/") || name.endsWith(".iwa"))) {
    return { kind: "iwork" };
  }
  if (zip.has("mimetype")) {
    const mimetype = new TextDecoder().decode(await zip.readEntry("mimetype", { maxBytes: 256 })).trim();
    if (mimetype === ODS_MIMETYPE) return { kind: "workbook", format: "ods", container };
  }
  throw new BoundExceededError("unrecognized-content");
};

const identifyCfb = (cfb: CfbHandleV1): Identified => {
  requireUnencrypted(cfb);
  if (cfb.has("Workbook") || cfb.has("Book")) {
    return { kind: "workbook", format: "xls", container: { kind: "cfb", cfb } };
  }
  throw new BoundExceededError("unrecognized-content");
};

const sumOrNull = (values: readonly (number | null)[]): number | null =>
  values.every((value) => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);

const cellsOf = (sheet: SheetInventoryItemV1): number => sheet.estimatedCellCount ?? 0;

/**
 * D31 routes and D47 default selection. Chart sheets and sheets that declare
 * nothing weigh zero. More sheets than the inventory budget is a handoff:
 * the device will not size them one by one.
 */
export function routeOf(
  sheets: readonly SheetInventoryItemV1[],
  sheetListKnown: boolean,
  budget: ImportBudgetV1 = IMPORT_BUDGET_V1,
): { readonly route: WorkbookRouteV1; readonly defaultSelection: readonly number[] } {
  const all = sheets.map((sheet) => sheet.sheetIndex);
  if (sheets.length > budget.maxInventoriedSheets) {
    return { route: "handoff", defaultSelection: [] };
  }
  const total = sheets.reduce((sum, sheet) => sum + cellsOf(sheet), 0);
  if (total <= budget.maxEstimatedCells) {
    return { route: "fits", defaultSelection: all };
  }
  if (!sheetListKnown || !sheets.some((sheet) => cellsOf(sheet) <= budget.maxEstimatedCells)) {
    return { route: "handoff", defaultSelection: [] };
  }
  const selection: number[] = [];
  let running = 0;
  for (const sheet of sheets) {
    if (running + cellsOf(sheet) > budget.maxEstimatedCells) break;
    running += cellsOf(sheet);
    selection.push(sheet.sheetIndex);
  }
  return { route: "subset", defaultSelection: selection };
}

const contradictionOf = (
  declaredExtension: string | null,
  detectedFormat: WorkbookFormatV1,
): WorkbookFormatContradictionV1 | null => {
  if (declaredExtension === null) return null;
  const expected = FORMAT_BY_EXTENSION.get(declaredExtension);
  return expected === undefined || expected === detectedFormat
    ? null
    : { declaredExtension, detectedFormat };
};

const totalsOf = (
  sheets: readonly SheetInventoryItemV1[],
  workbookCounts: PreservedPartCountsV1,
): WorkbookTotalsV1 => ({
  sheetCount: sheets.length,
  estimatedRowCount: sumOrNull(sheets.map((sheet) => sheet.estimatedRowCount)),
  estimatedCellCount: sumOrNull(sheets.map((sheet) => sheet.estimatedCellCount)),
  preservedPartCounts: Object.fromEntries(
    PRESERVED_PART_KINDS.map((kind) => [
      kind,
      workbookCounts[kind] + sheets.reduce((sum, sheet) => sum + sheet.preservedPartCounts[kind], 0),
    ]),
  ) as PreservedPartCountsV1,
});

/**
 * Sizes and routes a workbook from metadata. `readers` is the worker's
 * registry (D35); a format missing from it is refused as a later release.
 * Throws only for a delimited source, which has its own pre-flight.
 */
export async function preflightWorkbook(
  source: RandomAccessSource,
  sniff: SniffResultV1,
  readers: ReadonlyMap<WorkbookFormatV1, InventoryReaderV1>,
): Promise<WorkbookPreflightOutcomeV1> {
  const fileName = sniff.declaredName;
  const refused = (refusal: RefusalV1): WorkbookPreflightOutcomeV1 => ({ kind: "refused", refusal });

  let identified: Identified;
  try {
    switch (sniff.format.kind) {
      case "delimited":
        throw new RangeError("a delimited source is sized by preflightDelimited");
      case "pdf":
        return refused({ kind: "pdf-file", fileName, remedy: "pdf-export-from-source" });
      case "binary":
        return refused(unreadable(fileName, "unrecognized-content"));
      case "html-table":
        identified = { kind: "workbook", format: "html-table", container: { kind: "text", source } };
        break;
      case "cfb":
        identified = identifyCfb(await openCfbContainer(source));
        break;
      case "zip-container":
        identified = await identifyZip(await openZipContainer(source));
        break;
      default: {
        const unreachable: never = sniff.format;
        return unreachable;
      }
    }
  } catch (cause) {
    if (isBoundExceeded(cause)) return refused(unreadable(fileName, cause.detail));
    throw cause;
  }

  if (identified.kind === "iwork") {
    return refused(iworkRefusal(fileName, sniff.declaredExtension));
  }
  const reader = readers.get(identified.format);
  if (reader === undefined) {
    return refused(laterRelease(fileName, LATER_RELEASE_NAME[identified.format]));
  }

  let outcome;
  try {
    outcome = await reader.readInventory(identified.container);
  } catch (cause) {
    if (isBoundExceeded(cause)) return refused(unreadable(fileName, cause.detail));
    throw cause;
  }
  if (outcome.kind === "macro") {
    return refused({ kind: "macro-content", fileName, remedy: "reupload-macro-free-copy" });
  }
  if (outcome.kind === "unreadable") {
    return refused(unreadable(fileName, outcome.detail));
  }

  const inventory = outcome.inventory;
  const totals = totalsOf(inventory.sheets, inventory.preservedPartCounts);
  if (source.byteLength > IMPORT_BUDGET_V1.maxSourceBytes) {
    return refused({
      kind: "over-import-budget",
      fileName,
      remedy: "use-larger-device",
      exceeded: "source-bytes",
      sourceByteLength: source.byteLength,
      maxSourceByteLength: IMPORT_BUDGET_V1.maxSourceBytes,
      estimatedCellCount: totals.estimatedCellCount ?? 0,
      maxEstimatedCellCount: IMPORT_BUDGET_V1.maxEstimatedCells,
    });
  }

  const { route, defaultSelection } = routeOf(inventory.sheets, inventory.sheetListKnown);
  return {
    kind: "proceed",
    report: {
      fileName,
      sourceByteLength: source.byteLength,
      format: identified.format,
      formatContradiction: contradictionOf(sniff.declaredExtension, identified.format),
      sheets: inventory.sheets,
      sheetListKnown: inventory.sheetListKnown,
      dateSystem: inventory.dateSystem,
      totals,
      route,
      defaultSelection,
      budgets: IMPORT_BUDGET_V1,
      isEstimate: true,
    },
  };
}
