/**
 * The chunked delimited parser (M19; architecture § Import Architecture
 * Stage 2).
 *
 * Three properties make this parser safe rather than merely correct, and each
 * is a bound rather than a promise:
 *
 * - **Nothing whole is ever held.** Bytes arrive one
 *   {@link DELIMITED_READ_CHUNK_BYTES} window at a time through
 *   `RandomAccessSource`, and facts leave in batches of at most
 *   {@link DELIMITED_FACTS_PER_BATCH}, so peak memory is a constant regardless
 *   of file size (FR-3).
 * - **A single row cannot grow without limit.** An unterminated quote would
 *   otherwise make the rest of the file one field;
 *   {@link DELIMITED_MAX_ROW_CHARACTERS} ends the row instead, with a
 *   diagnostic. Nothing is dropped — the bound changes where a row ends, never
 *   what the file contained.
 * - **Malformed input degrades, never throws.** Every deviation a text file
 *   can contain becomes an `ImportDiagnosticV1` beside preserved text.
 *
 * All text is NFC-normalized here, at the entry boundary, and the
 * normalization is announced with a diagnostic (D28) so it is visible at
 * review rather than silent. The raw bytes stay byte-faithful in the encrypted
 * source chunks S04 writes; this stream carries only the normalized form the
 * domain accepts.
 */

import { textValue } from "../../../domain/model/values.js";
import type { DelimitedFormatV1 } from "../../source/sniff.js";
import {
  MAX_SLICE_BYTES,
  type RandomAccessSource,
} from "../../source/source.js";
import type {
  CancellationTokenV1,
  ImportDiagnosticCodeV1,
  WorkbookFactBatchV1,
  WorkbookFactStreamItemV1,
  WorkbookFactV1,
} from "./facts.js";

/** One read window: 64 KiB. */
export const DELIMITED_READ_CHUNK_BYTES = 65_536;

/** The documented batch bound — a batch never carries more facts than this. */
export const DELIMITED_FACTS_PER_BATCH = 1024;

/** The point at which one logical row is ended to stay bounded: 4 Mi chars. */
export const DELIMITED_MAX_ROW_CHARACTERS = 4_194_304;

export interface DelimitedParseOptionsV1 {
  readonly chunkBytes?: number;
  readonly factsPerBatch?: number;
  readonly maxRowCharacters?: number;
  readonly cancellation?: CancellationTokenV1;
}

const SEVERITY: Readonly<Record<ImportDiagnosticCodeV1, "info" | "warning">> =
  Object.freeze({
    "text-normalized-nfc": "info",
    "unterminated-quote": "warning",
    "quote-inside-unquoted-field": "warning",
    "ragged-row": "warning",
    "replacement-character": "warning",
    "row-length-bound-reached": "warning",
  });

const REPLACEMENT_CHARACTER = "�";

const isNewline = (character: string): boolean =>
  character === "\n" || character === "\r";

const positive = (value: number | undefined, fallback: number): number =>
  value === undefined ? fallback : Math.max(1, Math.floor(value));

interface DiagnosticTally {
  readonly firstRowIndex: number | null;
  readonly firstColumnIndex: number | null;
  occurrences: number;
}

/**
 * Turns a delimited source into workbook facts. The returned iterable is
 * single-use and ends either with a `WorkbookSummaryV1` — the parse ran to the
 * end — or, when cancellation was observed between two batches, with no
 * summary at all. A consumer that stops iterating cancels just as effectively:
 * the generator unwinds and no read is left outstanding.
 */
export async function* parseDelimited(
  source: RandomAccessSource,
  format: DelimitedFormatV1,
  options: DelimitedParseOptionsV1 = {},
): AsyncGenerator<WorkbookFactStreamItemV1, void, undefined> {
  const chunkBytes = Math.min(
    positive(options.chunkBytes, DELIMITED_READ_CHUNK_BYTES),
    MAX_SLICE_BYTES,
  );
  const factsPerBatch = positive(
    options.factsPerBatch,
    DELIMITED_FACTS_PER_BATCH,
  );
  const maxRowCharacters = positive(
    options.maxRowCharacters,
    DELIMITED_MAX_ROW_CHARACTERS,
  );
  const cancellation = options.cancellation;

  const diagnostics = new Map<ImportDiagnosticCodeV1, DiagnosticTally>();
  const ready: WorkbookFactBatchV1[] = [];
  let facts: WorkbookFactV1[] = [];
  let batchSeq = 0;

  let rowCount = 0;
  let columnCount = 0;
  let valueCount = 0;

  let rowIndex = 0;
  let cells: string[] = [];
  let field = "";
  let rowCharacters = 0;
  let inQuotes = false;
  let afterQuote = false;
  let skipLineFeed = false;
  let previousCellCount: number | null = null;

  /**
   * Facts are appended one at a time and a batch is cut the moment it is full,
   * so the bound holds exactly. A row's facts may therefore span two batches;
   * every fact names its own row, so no consumer needs them together.
   */
  const push = (fact: WorkbookFactV1): void => {
    facts.push(fact);
    if (facts.length >= factsPerBatch) {
      ready.push({ kind: "batch", batchSeq, facts });
      batchSeq += 1;
      facts = [];
    }
  };

  /** Records one occurrence; the first of each code is also emitted as a fact. */
  const note = (
    code: ImportDiagnosticCodeV1,
    atRow: number | null,
    atColumn: number | null,
  ): void => {
    const existing = diagnostics.get(code);
    if (existing !== undefined) {
      existing.occurrences += 1;
      return;
    }
    const tally: DiagnosticTally = {
      firstRowIndex: atRow,
      firstColumnIndex: atColumn,
      occurrences: 1,
    };
    diagnostics.set(code, tally);
    push({
      kind: "diagnostic",
      diagnostic: {
        code,
        severity: SEVERITY[code],
        firstRowIndex: atRow,
        firstColumnIndex: atColumn,
        occurrences: 1,
      },
    });
  };

  const endRow = (): void => {
    cells.push(field);
    field = "";
    const cellCount = cells.length;

    push({ kind: "row", rowIndex, cellCount });
    for (let columnIndex = 0; columnIndex < cellCount; columnIndex += 1) {
      const raw = cells[columnIndex] as string;
      if (raw === "") {
        continue;
      }
      const text = raw.normalize("NFC");
      if (text !== raw) {
        note("text-normalized-nfc", rowIndex, columnIndex);
      }
      if (text.includes(REPLACEMENT_CHARACTER)) {
        note("replacement-character", rowIndex, columnIndex);
      }
      push({ kind: "value", rowIndex, columnIndex, value: textValue(text) });
      valueCount += 1;
    }

    if (previousCellCount !== null && previousCellCount !== cellCount) {
      note("ragged-row", rowIndex, null);
    }
    previousCellCount = cellCount;
    columnCount = Math.max(columnCount, cellCount);
    rowCount += 1;
    rowIndex += 1;
    cells = [];
    rowCharacters = 0;
  };

  const consume = (text: string): void => {
    for (const character of text) {
      if (skipLineFeed) {
        skipLineFeed = false;
        if (character === "\n") {
          continue;
        }
      }

      if (afterQuote) {
        afterQuote = false;
        if (character === '"') {
          field += '"';
          rowCharacters += 1;
          inQuotes = true;
          continue;
        }
        // The quote closed the field. A delimiter or newline now ends it
        // normally; anything else is text glued to a quoted run, which is
        // preserved verbatim and flagged rather than discarded.
        inQuotes = false;
        if (character !== format.delimiter && !isNewline(character)) {
          note("quote-inside-unquoted-field", rowIndex, null);
          field += character;
          rowCharacters += 1;
          continue;
        }
      }

      if (inQuotes) {
        if (character === '"') {
          afterQuote = true;
        } else {
          field += character;
          rowCharacters += 1;
        }
      } else if (character === '"') {
        if (field === "") {
          inQuotes = true;
        } else {
          note("quote-inside-unquoted-field", rowIndex, null);
          field += character;
          rowCharacters += 1;
        }
      } else if (character === format.delimiter) {
        cells.push(field);
        field = "";
      } else if (character === "\r") {
        skipLineFeed = true;
        endRow();
      } else if (character === "\n") {
        endRow();
      } else {
        field += character;
        rowCharacters += 1;
      }

      if (rowCharacters > maxRowCharacters) {
        note("row-length-bound-reached", rowIndex, null);
        inQuotes = false;
        afterQuote = false;
        endRow();
      }
    }
  };

  const decoder = new TextDecoder(format.encoding, { ignoreBOM: true });
  let offset = format.bomByteLength;

  while (offset < source.byteLength) {
    const chunk = await source.slice(offset, chunkBytes);
    if (chunk.byteLength === 0) {
      break;
    }
    offset += chunk.byteLength;
    consume(decoder.decode(chunk, { stream: true }));

    while (ready.length > 0) {
      yield ready.shift() as WorkbookFactBatchV1;
      if (cancellation?.aborted === true) {
        return;
      }
    }
  }

  consume(decoder.decode());
  if (afterQuote) {
    inQuotes = false;
  }
  if (inQuotes) {
    note("unterminated-quote", rowIndex, null);
  }
  if (cells.length > 0 || field !== "") {
    endRow();
  }
  if (facts.length > 0) {
    ready.push({ kind: "batch", batchSeq, facts });
    batchSeq += 1;
  }

  while (ready.length > 0) {
    yield ready.shift() as WorkbookFactBatchV1;
    if (cancellation?.aborted === true) {
      return;
    }
  }

  yield {
    kind: "summary",
    rowCount,
    columnCount,
    valueCount,
    batchCount: batchSeq,
    diagnostics: [...diagnostics].map(([code, tally]) => ({
      code,
      severity: SEVERITY[code],
      firstRowIndex: tally.firstRowIndex,
      firstColumnIndex: tally.firstColumnIndex,
      occurrences: tally.occurrences,
    })),
  };
}
