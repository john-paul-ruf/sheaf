/**
 * The OOXML adapter (M15; CA-17, D39, FR-3): selected sheets, in workbook
 * order, as one V2 fact stream.
 *
 * Per selected sheet it emits the `sheet` fact (with the declared dimension
 * and the workbook's date system), then the facts the sheet's relationships
 * declare (tables, drawings, charts, images, comments, pivots, embedded
 * objects, controls), then the streamed rows and the structure that follows
 * them (merges, validations, hyperlinks, sparklines, one conditional-formatting
 * and one cell-styling part per sheet). The first selected sheet also carries
 * the workbook-wide facts: defined names, external links, data connections.
 *
 * Unselected sheets are never opened (D39). Batches never exceed
 * `factsPerBatch`; cancellation is observed between batches, and a cancelled
 * stream ends without a summary.
 */

import {
  WORKBOOK_FACTS_PER_BATCH,
  type ContainerHandleV1,
  type ImportDiagnosticCodeV2,
  type ParseSheetsOptionsV1,
  type WorkbookAdapterV1,
  type WorkbookFactBatchV2,
  type WorkbookFactStreamItemV2,
  type WorkbookFactV2,
} from "../../facts/index.js";
import { BoundExceededError } from "../../source/bounds.js";
import { relationshipKind } from "../../source/opc.js";
import { readDeclaredDimension, readWorkbookPart, sheetPartsOf } from "./inventory.js";
import { readSharedStrings } from "./shared-strings.js";
import { preservedPart, sheetPartFacts, streamWorksheet, type FactSinkV1 } from "./sheet.js";
import { readCellStyles } from "./styles.js";

const SEVERITY: Readonly<Record<ImportDiagnosticCodeV2, "info" | "warning">> = Object.freeze({
  "text-normalized-nfc": "info",
  "unterminated-quote": "warning",
  "quote-inside-unquoted-field": "warning",
  "ragged-row": "warning",
  "replacement-character": "warning",
  "row-length-bound-reached": "warning",
  "error-value": "warning",
  "malformed-value": "warning",
});

const WORKBOOK_LOCATION = "Workbook";

async function* parseSheets(
  container: ContainerHandleV1,
  selection: readonly number[],
  options: ParseSheetsOptionsV1,
): AsyncGenerator<WorkbookFactStreamItemV2, void, undefined> {
  if (container.kind !== "zip") {
    throw new BoundExceededError("unrecognized-content");
  }
  const zip = container.zip;
  const factsPerBatch = Math.max(1, Math.floor(options.factsPerBatch ?? WORKBOOK_FACTS_PER_BATCH));
  const cancellation = options.cancellation;

  const workbook = await readWorkbookPart(zip);
  const chosen = new Set(selection);
  const selected = sheetPartsOf(zip, workbook).filter((sheet) => chosen.has(sheet.sheetIndex));
  const targetOf = (kind: string): string | null =>
    workbook.relationships.find((relationship) => relationshipKind(relationship.type) === kind && !relationship.isExternal)
      ?.target ?? null;
  const styles = await readCellStyles(zip, targetOf("styles"));
  const strings = selected.some((sheet) => sheet.kind !== "chartsheet")
    ? await readSharedStrings(zip, targetOf("sharedstrings"))
    : [];

  const ready: WorkbookFactBatchV2[] = [];
  let facts: WorkbookFactV2[] = [];
  let batchSeq = 0;
  let rowCount = 0;
  let columnCount = 0;
  let valueCount = 0;
  const diagnostics = new Map<
    ImportDiagnosticCodeV2,
    { firstRowIndex: number | null; firstColumnIndex: number | null; occurrences: number }
  >();

  const cut = (): void => {
    if (facts.length > 0) {
      ready.push({ kind: "batch", batchSeq, facts });
      batchSeq += 1;
      facts = [];
    }
  };
  const sink: FactSinkV1 = {
    push(fact) {
      if (fact.kind === "row") {
        rowCount += 1;
        columnCount = Math.max(columnCount, fact.cellCount);
      } else if (fact.kind === "value") {
        valueCount += 1;
      }
      facts.push(fact);
      if (facts.length >= factsPerBatch) cut();
    },
    note(code, rowIndex, columnIndex) {
      const existing = diagnostics.get(code);
      if (existing !== undefined) {
        existing.occurrences += 1;
        return;
      }
      diagnostics.set(code, { firstRowIndex: rowIndex, firstColumnIndex: columnIndex, occurrences: 1 });
      this.push({
        kind: "diagnostic",
        diagnostic: { code, severity: SEVERITY[code], firstRowIndex: rowIndex, firstColumnIndex: columnIndex, occurrences: 1 },
      });
    },
  };

  /** Yields every full batch; `false` means cancellation was observed. */
  function* drain(): Generator<WorkbookFactStreamItemV2, boolean, undefined> {
    while (ready.length > 0) {
      yield ready.shift() as WorkbookFactBatchV2;
      if (cancellation.aborted) return false;
    }
    return true;
  }

  for (const [position, sheet] of selected.entries()) {
    sink.push({
      kind: "sheet",
      sheetIndex: sheet.sheetIndex,
      name: sheet.name,
      sheetKind: sheet.kind,
      visibility: sheet.visibility,
      declaredRange: sheet.kind === "chartsheet" ? null : await readDeclaredDimension(zip, sheet.partName),
      dateSystem: workbook.dateSystem,
    });
    if (position === 0) {
      for (const name of workbook.definedNames) {
        sink.push({ kind: "defined-name", ...name });
      }
      for (const relationship of workbook.relationships) {
        const kind = relationshipKind(relationship.type);
        if (kind === "externallink") {
          sink.push(preservedPart("external-link", WORKBOOK_LOCATION, null, relationship.target));
        } else if (kind === "connections") {
          sink.push(preservedPart("data-connection", WORKBOOK_LOCATION, null, relationship.target));
        }
      }
    }
    for (const fact of await sheetPartFacts(zip, sheet)) {
      sink.push(fact);
    }
    if (sheet.kind !== "chartsheet") {
      const rows = streamWorksheet({ zip, strings, styles }, sheet, sink);
      for (let step = await rows.next(); step.done !== true; step = await rows.next()) {
        if (!(yield* drain())) {
          await rows.return();
          return;
        }
      }
    }
    if (!(yield* drain())) return;
  }
  cut();
  if (!(yield* drain())) return;

  yield {
    kind: "summary",
    rowCount,
    columnCount,
    valueCount,
    batchCount: batchSeq,
    diagnostics: [...diagnostics].map(([code, tally]) => ({ code, severity: SEVERITY[code], ...tally })),
  };
}

/** The OOXML (`.xlsx`) adapter the import worker registers (D35). */
export const ooxmlAdapter: WorkbookAdapterV1 = Object.freeze({
  format: "xlsx",
  parseSheets,
});
