/**
 * The format-neutral workbook fact vocabulary (M65; architecture § Import
 * Architecture Stage 2, D32).
 *
 * Every import adapter — delimited, OOXML, XLSB, BIFF, ODS, HTML-table — emits
 * **this** stream, so nothing here may know which format produced it: there is
 * no delimiter, no encoding, no part name of a cell, and no byte offset in a
 * fact.
 *
 * **V2 is additive (D32).** The F02 vocabulary (`row`, `value`, `diagnostic`,
 * batch, summary — {@link WorkbookFactV1}) moved here unchanged from
 * `formats/delimited/facts.ts`, which re-exports it until S06 migrates the
 * F02 consumers. V2 adds the declared structure a workbook carries: sheets,
 * number formats, formulas, declared tables, validations, merges, defined names
 * and preserved parts.
 *
 * **Positional sheet scoping.** A `sheet` fact opens a sheet; every following
 * fact belongs to it until the next `sheet` fact or the terminal summary. A
 * stream with no `sheet` fact is exactly one implicit sheet — which is what
 * every F02 delimited stream is, so V1 streams are valid V2 streams.
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
 * **`cell-format` emission rule.** Per sheet, each column starts in the
 * `General` format. A `cell-format` fact is emitted immediately before the
 * value fact of a cell whose number format differs from the format of the
 * previous value cell in the same column; it states the format of that column
 * from that row down, until the next `cell-format` fact for the column. Only
 * value cells move the run, so an all-General column emits none.
 *
 * **Formula rule.** A `formula` fact carries the formula text as authored;
 * `text: null` with a `sharedGroup` is a shared-formula child (its text is the
 * group master's, shifted); `text: null` without one means undecodable. The
 * cached result, when present, is a separate ordinary `value` fact: formulas
 * are preserved, never evaluated (D33, invariant 7).
 *
 * **Everything here encodes canonically.** Staging encodes these facts as CBOR
 * (CA-10), so the shapes carry no functions, no prototypes, no floats, and no
 * optional-vs-absent ambiguity. {@link factStreamItemToCanonicalValue} is the
 * mapping staging encodes, stated structurally so this module imports nothing
 * from `src/persistence/`.
 */

import type { CellValueV1 } from "../../domain/model/values.js";

/** The F02 codes, in their F02 positions. */
export const IMPORT_DIAGNOSTIC_CODES_V1 = Object.freeze([
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

/** Every diagnostic code. Append only: the F02 codes keep their positions. */
export const IMPORT_DIAGNOSTIC_CODES = Object.freeze([
  ...IMPORT_DIAGNOSTIC_CODES_V1,
  /** A cell held a spreadsheet error (`#N/A`, `#REF!` …); kept as its text. */
  "error-value",
  /** A cell's stored value did not fit its declared type; kept as its text. */
  "malformed-value",
] as const);

export type ImportDiagnosticCodeV1 = (typeof IMPORT_DIAGNOSTIC_CODES_V1)[number];
export type ImportDiagnosticCodeV2 = (typeof IMPORT_DIAGNOSTIC_CODES)[number];

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

/** {@link ImportDiagnosticV1} over every V2 code; the shape is unchanged. */
export interface ImportDiagnosticV2 {
  readonly code: ImportDiagnosticCodeV2;
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

/** Zero-based and inclusive on both ends, within Excel's grid. */
export interface RangeV1 {
  readonly firstRow: number;
  readonly firstColumn: number;
  readonly lastRow: number;
  readonly lastColumn: number;
}

export const SHEET_KINDS = Object.freeze(["worksheet", "chartsheet", "dialogsheet"] as const);
export type SheetKindV1 = (typeof SHEET_KINDS)[number];

export const SHEET_VISIBILITIES = Object.freeze(["visible", "hidden", "very-hidden"] as const);
export type SheetVisibilityV1 = (typeof SHEET_VISIBILITIES)[number];

/** Which epoch a date serial counts from; a workbook-wide setting. */
export type DateSystemV1 = "1900" | "1904";

export const FORMAT_CLASSES = Object.freeze([
  "general",
  "number",
  "currency",
  "percent",
  "date",
  "time",
  "datetime",
  "text",
  "other",
] as const);
export type FormatClassV1 = (typeof FORMAT_CLASSES)[number];

export const VALIDATION_RULES = Object.freeze([
  "list",
  "whole",
  "decimal",
  "date",
  "time",
  "text-length",
  "custom",
] as const);
export type ValidationRuleV1 = (typeof VALIDATION_RULES)[number];

export const VALIDATION_OPERATORS = Object.freeze([
  "between",
  "not-between",
  "equal",
  "not-equal",
  "less-than",
  "less-than-or-equal",
  "greater-than",
  "greater-than-or-equal",
] as const);
export type ValidationOperatorV1 = (typeof VALIDATION_OPERATORS)[number];

export type ValidationListSourceV1 =
  | { readonly kind: "inline"; readonly values: readonly string[] }
  | { readonly kind: "range"; readonly ref: string };

/** D40's closed list of inert content kinds. */
export const PRESERVED_PART_KINDS = Object.freeze([
  "formula",
  "chart",
  "pivot-table",
  "drawing",
  "image",
  "comment",
  "external-link",
  "hyperlink",
  "embedded-object",
  "form-control",
  "data-connection",
  "conditional-formatting",
  "cell-styling",
  "sparkline",
  "script",
  "unsupported-validation",
] as const);
export type PreservedPartKindV1 = (typeof PRESERVED_PART_KINDS)[number];

/** Why a part is kept rather than made interactive; closed (D40). */
export const PRESERVED_REASON_KEYS = Object.freeze([
  "formula-not-live-yet",
  "chart-not-live-yet",
  "pivot-not-live-yet",
  "visual-only",
  "note-kept-as-text",
  "link-not-followed",
  "external-source-not-fetched",
  "object-not-opened",
  "control-not-run",
  "connection-not-refreshed",
  "formatting-not-reproduced",
  "script-not-run",
  "validation-not-expressible",
] as const);
export type PreservedReasonKeyV1 = (typeof PRESERVED_REASON_KEYS)[number];

/** The reason every adapter gives for each kind, so one kind reads one way. */
export const PRESERVED_REASON_BY_KIND: Readonly<Record<PreservedPartKindV1, PreservedReasonKeyV1>> =
  Object.freeze({
    formula: "formula-not-live-yet",
    chart: "chart-not-live-yet",
    "pivot-table": "pivot-not-live-yet",
    drawing: "visual-only",
    image: "visual-only",
    comment: "note-kept-as-text",
    "external-link": "external-source-not-fetched",
    hyperlink: "link-not-followed",
    "embedded-object": "object-not-opened",
    "form-control": "control-not-run",
    "data-connection": "connection-not-refreshed",
    "conditional-formatting": "formatting-not-reproduced",
    "cell-styling": "formatting-not-reproduced",
    sparkline: "chart-not-live-yet",
    script: "script-not-run",
    "unsupported-validation": "validation-not-expressible",
  });

/** V2's new fact kinds (D32). */
export type WorkbookStructureFactV1 =
  | {
      readonly kind: "sheet";
      /** Position in the workbook's own sheet order, zero-based. */
      readonly sheetIndex: number;
      readonly name: string;
      readonly sheetKind: SheetKindV1;
      readonly visibility: SheetVisibilityV1;
      readonly declaredRange: RangeV1 | null;
      readonly dateSystem: DateSystemV1;
    }
  | {
      readonly kind: "cell-format";
      readonly rowIndex: number;
      readonly columnIndex: number;
      /** The format code as authored (`"$"#,##0.00`, `yyyy-mm-dd`, `General`). */
      readonly numberFormat: string;
      readonly formatClass: FormatClassV1;
      readonly currencySymbol: string | null;
    }
  | {
      readonly kind: "formula";
      readonly rowIndex: number;
      readonly columnIndex: number;
      readonly text: string | null;
      readonly sharedGroup: number | null;
      readonly isArray: boolean;
      readonly isExternal: boolean;
    }
  | {
      readonly kind: "declared-table";
      readonly name: string;
      readonly range: RangeV1;
      readonly headerRowCount: number;
      readonly totalsRowCount: number;
      readonly columns: readonly string[];
    }
  | {
      readonly kind: "validation";
      readonly range: RangeV1;
      readonly rule: ValidationRuleV1;
      readonly operator: ValidationOperatorV1 | null;
      readonly listSource: ValidationListSourceV1 | null;
      readonly formula1: string | null;
      readonly formula2: string | null;
    }
  | { readonly kind: "merge"; readonly range: RangeV1 }
  | {
      readonly kind: "defined-name";
      readonly name: string;
      /** The reference or formula as authored, e.g. `Jobs!$A$2:$A$61`. */
      readonly ref: string;
      /** The sheet it is scoped to; `null` for a workbook-wide name. */
      readonly sheetIndex: number | null;
    }
  | {
      readonly kind: "preserved-part";
      readonly partKind: PreservedPartKindV1;
      /** A place a person can find: `Overview!B2:H18`, or the sheet name. */
      readonly location: string;
      readonly reasonKey: PreservedReasonKeyV1;
      readonly anchor: RangeV1 | null;
      readonly partPath: string | null;
    };

export type WorkbookFactV2 =
  | Exclude<WorkbookFactV1, { kind: "diagnostic" }>
  | { readonly kind: "diagnostic"; readonly diagnostic: ImportDiagnosticV2 }
  | WorkbookStructureFactV1;

export type WorkbookFactKindV2 = WorkbookFactV2["kind"];

export interface WorkbookFactBatchV1 {
  readonly kind: "batch";
  /** Zero-based and contiguous, so a consumer can detect a lost batch. */
  readonly batchSeq: number;
  readonly facts: readonly WorkbookFactV1[];
}

export interface WorkbookFactBatchV2 {
  readonly kind: "batch";
  readonly batchSeq: number;
  readonly facts: readonly WorkbookFactV2[];
}

/**
 * The terminal item. Its presence is the only "the parse completed" signal a
 * consumer gets: a cancelled stream ends without one, which is what lets
 * staging distinguish a finished import from an abandoned one without a side
 * channel. Across a multi-sheet stream the counts are totals over every sheet.
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

export interface WorkbookSummaryV2 {
  readonly kind: "summary";
  readonly rowCount: number;
  readonly columnCount: number;
  readonly valueCount: number;
  readonly batchCount: number;
  readonly diagnostics: readonly ImportDiagnosticV2[];
}

export type WorkbookFactStreamItemV1 = WorkbookFactBatchV1 | WorkbookSummaryV1;
export type WorkbookFactStreamItemV2 = WorkbookFactBatchV2 | WorkbookSummaryV2;

/** The F02 batch bound every adapter keeps: at most 1024 facts per batch. */
export const WORKBOOK_FACTS_PER_BATCH = 1024;

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
  diagnostic: ImportDiagnosticV2,
): CanonicalFactValueV1 =>
  map([
    ["code", diagnostic.code],
    ["severity", diagnostic.severity],
    ["firstRowIndex", integerOrNull(diagnostic.firstRowIndex)],
    ["firstColumnIndex", integerOrNull(diagnostic.firstColumnIndex)],
    ["occurrences", BigInt(diagnostic.occurrences)],
  ]);

const rangeToCanonicalValue = (range: RangeV1): CanonicalFactValueV1 =>
  map([
    ["firstRow", BigInt(range.firstRow)],
    ["firstColumn", BigInt(range.firstColumn)],
    ["lastRow", BigInt(range.lastRow)],
    ["lastColumn", BigInt(range.lastColumn)],
  ]);

const rangeOrNull = (range: RangeV1 | null): CanonicalFactValueV1 =>
  range === null ? null : rangeToCanonicalValue(range);

const listSourceToCanonicalValue = (
  source: ValidationListSourceV1 | null,
): CanonicalFactValueV1 => {
  if (source === null) {
    return null;
  }
  return source.kind === "inline"
    ? map([
        ["kind", "inline"],
        ["values", [...source.values]],
      ])
    : map([
        ["kind", "range"],
        ["ref", source.ref],
      ]);
};

const factToCanonicalValue = (fact: WorkbookFactV2): CanonicalFactValueV1 => {
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
    case "sheet":
      return map([
        ["kind", "sheet"],
        ["sheetIndex", BigInt(fact.sheetIndex)],
        ["name", fact.name],
        ["sheetKind", fact.sheetKind],
        ["visibility", fact.visibility],
        ["declaredRange", rangeOrNull(fact.declaredRange)],
        ["dateSystem", fact.dateSystem],
      ]);
    case "cell-format":
      return map([
        ["kind", "cell-format"],
        ["rowIndex", BigInt(fact.rowIndex)],
        ["columnIndex", BigInt(fact.columnIndex)],
        ["numberFormat", fact.numberFormat],
        ["formatClass", fact.formatClass],
        ["currencySymbol", fact.currencySymbol],
      ]);
    case "formula":
      return map([
        ["kind", "formula"],
        ["rowIndex", BigInt(fact.rowIndex)],
        ["columnIndex", BigInt(fact.columnIndex)],
        ["text", fact.text],
        ["sharedGroup", integerOrNull(fact.sharedGroup)],
        ["isArray", fact.isArray],
        ["isExternal", fact.isExternal],
      ]);
    case "declared-table":
      return map([
        ["kind", "declared-table"],
        ["name", fact.name],
        ["range", rangeToCanonicalValue(fact.range)],
        ["headerRowCount", BigInt(fact.headerRowCount)],
        ["totalsRowCount", BigInt(fact.totalsRowCount)],
        ["columns", [...fact.columns]],
      ]);
    case "validation":
      return map([
        ["kind", "validation"],
        ["range", rangeToCanonicalValue(fact.range)],
        ["rule", fact.rule],
        ["operator", fact.operator],
        ["listSource", listSourceToCanonicalValue(fact.listSource)],
        ["formula1", fact.formula1],
        ["formula2", fact.formula2],
      ]);
    case "merge":
      return map([
        ["kind", "merge"],
        ["range", rangeToCanonicalValue(fact.range)],
      ]);
    case "defined-name":
      return map([
        ["kind", "defined-name"],
        ["name", fact.name],
        ["ref", fact.ref],
        ["sheetIndex", integerOrNull(fact.sheetIndex)],
      ]);
    case "preserved-part":
      return map([
        ["kind", "preserved-part"],
        ["partKind", fact.partKind],
        ["location", fact.location],
        ["reasonKey", fact.reasonKey],
        ["anchor", rangeOrNull(fact.anchor)],
        ["partPath", fact.partPath],
      ]);
    default: {
      const unreachable: never = fact;
      return unreachable;
    }
  }
};

/**
 * The exact value staging hands to the canonical CBOR encoder (CA-10), total
 * over V2. A V1 item maps to exactly the value it mapped to in F02, which is
 * what keeps the F02 staged-fact known answers unchanged.
 */
export function factStreamItemToCanonicalValue(
  item: WorkbookFactStreamItemV2,
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
