/**
 * The BIFF (`.xls`) adapter (M17; CA-17, D39, FR-3): selected sheets, in
 * workbook order, as one V2 fact stream.
 *
 * The globals are read once — the SST indexed across its `CONTINUE` records,
 * formats, cell formats, names and the 3-D reference context — then each
 * selected sheet is reached by its `BOUNDSHEET8` offset and streamed record by
 * record (`sheet.ts`). The first selected sheet also carries the
 * workbook-wide facts: defined names, external links, data connections.
 *
 * Unselected sheets are never parsed (D39). Batches never exceed
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
import { definedNamesOf, readBiffGlobals, SHEET_TYPE } from "./globals.js";
import { readSheetPrefix, visibilityOf } from "./inventory.js";
import { openRecordStream } from "./records.js";
import { preservedPart, streamBiffSheet, type FactSinkV1 } from "./sheet.js";

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
  if (container.kind !== "cfb") {
    throw new BoundExceededError("unrecognized-content");
  }
  const cfb = container.cfb;
  const factsPerBatch = Math.max(1, Math.floor(options.factsPerBatch ?? WORKBOOK_FACTS_PER_BATCH));
  const cancellation = options.cancellation;

  const opened = await readBiffGlobals(cfb, { withCellData: true });
  const globals = opened.globals;
  let stream = opened.stream;
  try {
    if (globals.isEncrypted) throw new BoundExceededError("encrypted-workbook");
    const chosen = new Set(selection);
    const selected = globals.sheets.filter((sheet) => chosen.has(sheet.sheetIndex));

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
      if (sheet.offset < stream.position) {
        await stream.close();
        stream = openRecordStream(cfb.streamStream(globals.streamPath));
      }
      const prefix = await readSheetPrefix(stream, sheet, globals.version);
      sink.push({
        kind: "sheet",
        sheetIndex: sheet.sheetIndex,
        name: sheet.name,
        sheetKind: prefix.sheetKind,
        visibility: visibilityOf(sheet.hiddenState),
        declaredRange: prefix.dimension.kind === "range" ? prefix.dimension.range : null,
        dateSystem: globals.is1904 ? "1904" : "1900",
      });
      if (position === 0) {
        for (const name of definedNamesOf(globals)) sink.push({ kind: "defined-name", ...name });
        for (const book of globals.supbooks) {
          if (book.kind === "external") sink.push(preservedPart("external-link", WORKBOOK_LOCATION, null));
        }
        for (let index = 0; index < globals.dataConnectionCount; index += 1) {
          sink.push(preservedPart("data-connection", WORKBOOK_LOCATION, null));
        }
      }
      if (sheet.sheetType === SHEET_TYPE.CHART) {
        sink.push(preservedPart("chart", sheet.name, null));
      } else {
        const rows = streamBiffSheet(stream, globals, sheet, sink);
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
  } finally {
    await stream.close();
  }
}

/** The BIFF (`.xls`) adapter the import worker registers (D35). */
export const biffAdapter: WorkbookAdapterV1 = Object.freeze({
  format: "xls",
  parseSheets,
});
