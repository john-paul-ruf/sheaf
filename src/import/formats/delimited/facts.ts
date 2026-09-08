/**
 * The shared workbook-fact vocabulary (architecture § Import Architecture
 * Stage 2).
 *
 * Delimited text is only the first producer. F03's OOXML, XLSB, BIFF, ODS, and
 * HTML-table adapters emit **this** stream, so nothing here may know it came
 * from a CSV: there is no delimiter, no encoding, and no byte offset in a fact.
 * The vocabulary lives beside the first adapter that emits it; when the second
 * adapter lands it moves to a shared `src/import/formats/` home unchanged.
 *
 * **Sparsity is the contract.** A value fact exists only where a cell has a
 * value. Given a row fact's `cellCount`, a consumer reads absence exactly:
 *
 * - a column below `cellCount` with no value fact is `blank` — the cell was
 *   there and was empty;
 * - a column at or above `cellCount` is `missing` — the row was short and the
 *   cell never existed.
 *
 * Those are two different facts about the world (`values.ts`), and a dense
 * stream that emitted an explicit empty for both would have destroyed the
 * distinction before the domain ever saw it. It also means a hostile declared
 * width cannot make an adapter emit a dense grid.
 *
 * **Everything here encodes canonically.** S04 stages these facts as CBOR
 * (CA-10), so the shapes carry no functions, no prototypes, no floats, and no
 * optional-vs-absent ambiguity. {@link factStreamItemToCanonicalValue} is the
 * mapping S04 encodes, kept here with the types it mirrors; it is stated
 * structurally so this module keeps importing nothing from `src/persistence/`.
 */

import type { CellValueV1 } from "../../../domain/model/values.js";

export const IMPORT_DIAGNOSTIC_CODES = Object.freeze([
  /** Source text was not NFC and was normalized at the entry boundary (D28). */
  "text-normalized-nfc",
  /** A quoted field ran to the end of the file without a closing quote. */
  "unterminated-quote",
  /** A quote appeared where the field was not quoted; kept as literal text. */
  "quote-inside-unquoted-field",
  /** A row had a different cell count than the row before it. */
  "ragged-row",
  /** Bytes did not decode in the detected encoding; U+FFFD stands in. */
  "replacement-character",
  /** One logical row hit the row-length bound and was split to stay bounded. */
  "row-length-bound-reached",
] as const);

export type ImportDiagnosticCodeV1 = (typeof IMPORT_DIAGNOSTIC_CODES)[number];

/**
 * One class of thing the parser noticed, aggregated. A diagnostic is never one
 * object per occurrence: a hostile file would otherwise turn a bounded parse
 * into an unbounded diagnostic list.
 *
 * The parser emits a diagnostic fact at the **first** occurrence of each code
 * (with `occurrences: 1`, since that is what it has seen so far) and repeats
 * every code in the terminal summary with its true total.
 */
export interface ImportDiagnosticV1 {
  readonly code: ImportDiagnosticCodeV1;
  readonly severity: "info" | "warning";
  readonly firstRowIndex: number | null;
  readonly firstColumnIndex: number | null;
  readonly occurrences: number;
}

export type WorkbookFactV1 =
  | {
      readonly kind: "row";
      /** Zero-based, counted over the whole source including junk rows. */
      readonly rowIndex: number;
      /** How wide the row actually was; the frontier between blank and missing. */
      readonly cellCount: number;
    }
  | {
      readonly kind: "value";
      readonly rowIndex: number;
      readonly columnIndex: number;
      readonly value: CellValueV1;
    }
  | { readonly kind: "diagnostic"; readonly diagnostic: ImportDiagnosticV1 };

export interface WorkbookFactBatchV1 {
  readonly kind: "batch";
  /** Zero-based and contiguous, so a consumer can detect a lost batch. */
  readonly batchSeq: number;
  readonly facts: readonly WorkbookFactV1[];
}

/**
 * The terminal item. Its presence is the only "the parse completed" signal a
 * consumer gets: a cancelled stream ends without one, which is what lets S04
 * distinguish a finished import from an abandoned one without a side channel.
 */
export interface WorkbookSummaryV1 {
  readonly kind: "summary";
  readonly rowCount: number;
  /** The widest row seen; exact, unlike pre-flight's estimate (D24). */
  readonly columnCount: number;
  readonly valueCount: number;
  readonly batchCount: number;
  readonly diagnostics: readonly ImportDiagnosticV1[];
}

export type WorkbookFactStreamItemV1 = WorkbookFactBatchV1 | WorkbookSummaryV1;

/**
 * Cooperative cancellation, checked between batches (never mid-row, so a
 * partially emitted row can never reach staging). Structural on purpose: the
 * caller may satisfy it with an `AbortSignal`.
 */
export interface CancellationTokenV1 {
  readonly aborted: boolean;
}

/**
 * The canonical-CBOR value domain, restated structurally so the import modules
 * import nothing from `src/persistence/`. It is deliberately narrower than the
 * codec's own input type: integers are always `bigint`, because the codec
 * decodes every integer as `bigint` and a fact must survive an encode/decode
 * round trip unchanged.
 */
export type CanonicalFactValueV1 =
  | boolean
  | null
  | bigint
  | string
  | Uint8Array
  | readonly CanonicalFactValueV1[]
  | ReadonlyMap<string, CanonicalFactValueV1>;

const map = (
  entries: readonly (readonly [string, CanonicalFactValueV1])[],
): CanonicalFactValueV1 => new Map(entries);

const cellValueToCanonicalValue = (
  value: CellValueV1,
): CanonicalFactValueV1 => {
  switch (value.kind) {
    case "text":
      return map([
        ["kind", "text"],
        ["text", value.text],
      ]);
    case "decimal":
      return map([
        ["kind", "decimal"],
        ["decimal", value.decimal],
      ]);
    case "date":
      return map([
        ["kind", "date"],
        ["epochDay", BigInt(value.epochDay)],
      ]);
    case "boolean":
      return map([
        ["kind", "boolean"],
        ["boolean", value.boolean],
      ]);
    case "enum":
      return map([
        ["kind", "enum"],
        ["optionId", value.optionId],
      ]);
    case "reference":
      return map([
        ["kind", "reference"],
        ["recordId", value.recordId],
      ]);
    case "missing":
      return map([["kind", "missing"]]);
    case "blank":
      return map([["kind", "blank"]]);
    case "invalid-preserved":
      return map([
        ["kind", "invalid-preserved"],
        ["sourceText", value.sourceText],
      ]);
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
};

const integerOrNull = (value: number | null): CanonicalFactValueV1 =>
  value === null ? null : BigInt(value);

const diagnosticToCanonicalValue = (
  diagnostic: ImportDiagnosticV1,
): CanonicalFactValueV1 =>
  map([
    ["code", diagnostic.code],
    ["severity", diagnostic.severity],
    ["firstRowIndex", integerOrNull(diagnostic.firstRowIndex)],
    ["firstColumnIndex", integerOrNull(diagnostic.firstColumnIndex)],
    ["occurrences", BigInt(diagnostic.occurrences)],
  ]);

const factToCanonicalValue = (fact: WorkbookFactV1): CanonicalFactValueV1 => {
  switch (fact.kind) {
    case "row":
      return map([
        ["kind", "row"],
        ["rowIndex", BigInt(fact.rowIndex)],
        ["cellCount", BigInt(fact.cellCount)],
      ]);
    case "value":
      return map([
        ["kind", "value"],
        ["rowIndex", BigInt(fact.rowIndex)],
        ["columnIndex", BigInt(fact.columnIndex)],
        ["value", cellValueToCanonicalValue(fact.value)],
      ]);
    case "diagnostic":
      return map([
        ["kind", "diagnostic"],
        ["diagnostic", diagnosticToCanonicalValue(fact.diagnostic)],
      ]);
    default: {
      const unreachable: never = fact;
      return unreachable;
    }
  }
};

/**
 * The exact value S04 hands to the canonical CBOR encoder when it stages a
 * batch (CA-10). Living here — beside the fact types rather than inside the
 * staging session — is what makes "the fact shape is canonically encodable" a
 * property this session can prove rather than one S04 discovers.
 */
export function factStreamItemToCanonicalValue(
  item: WorkbookFactStreamItemV1,
): CanonicalFactValueV1 {
  if (item.kind === "batch") {
    return map([
      ["kind", "batch"],
      ["batchSeq", BigInt(item.batchSeq)],
      ["facts", item.facts.map(factToCanonicalValue)],
    ]);
  }
  return map([
    ["kind", "summary"],
    ["rowCount", BigInt(item.rowCount)],
    ["columnCount", BigInt(item.columnCount)],
    ["valueCount", BigInt(item.valueCount)],
    ["batchCount", BigInt(item.batchCount)],
    ["diagnostics", item.diagnostics.map(diagnosticToCanonicalValue)],
  ]);
}
