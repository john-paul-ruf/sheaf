/**
 * The F02 (V1) subset of the workbook fact vocabulary, re-exported from its
 * home in M65 (`src/import/facts/workbook-facts.ts`, D32).
 *
 * The seven F02 consumers now import from M65 (S06); nothing in `src/`
 * imports this file. It remains only while S01's re-export assertion
 * (`tests/unit/import/facts/workbook-facts.test.ts`) still pins it, and is
 * deleted together with that assertion. `IMPORT_DIAGNOSTIC_CODES` here is the
 * V1 list.
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
