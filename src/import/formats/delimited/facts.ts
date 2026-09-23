/**
 * The F02 (V1) subset of the workbook fact vocabulary, re-exported from its
 * home in M65 (`src/import/facts/workbook-facts.ts`, D32).
 *
 * This file is the one sanctioned duplicate path while F03 migrates: the seven
 * F02 consumers keep importing from here and compile unchanged; S06 moves them
 * to M65 and deletes this file. `IMPORT_DIAGNOSTIC_CODES` here is the V1 list,
 * so every exhaustive map an F02 consumer keeps over it stays exhaustive.
 */

export {
  IMPORT_DIAGNOSTIC_CODES_V1 as IMPORT_DIAGNOSTIC_CODES,
  factStreamItemToCanonicalValue,
  type CancellationTokenV1,
  type CanonicalFactValueV1,
  type ImportDiagnosticCodeV1,
  type ImportDiagnosticV1,
  type WorkbookFactBatchV1,
  type WorkbookFactStreamItemV1,
  type WorkbookFactV1,
  type WorkbookSummaryV1,
} from "../../facts/workbook-facts.js";
