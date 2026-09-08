/**
 * Evidence-weighted proposal from a completed fact stream (M21; FR-4/FR-6/FR-8;
 * architecture § Import Architecture Stage 3).
 *
 * A proposal is **not** an app. Nothing here allocates a domain ID, writes an
 * event, or decides anything a person cannot undo on one review screen: every
 * finding is a statement with its evidence and the edit that revises it, and
 * only an explicit "Create app" turns any of it into a durable fact.
 *
 * Two bounds keep inference honest on a hostile or merely enormous file:
 *
 * - only the first {@link PROPOSAL_LEADING_ROWS} rows are kept whole, which is
 *   both the review screen's "preserved rows" evidence and the entire range a
 *   header may be moved within;
 * - per column, only tallies and a handful of examples are kept — never the
 *   values — so 250,000 cells cost the same memory as 250.
 *
 * Counts here are **exact**: they come from the stream's terminal summary, not
 * from a sample, which is the difference between this and pre-flight's estimate
 * (D24). Inference refuses to run on a stream that has no summary, because a
 * cancelled parse has no counts to be exact about.
 */

import type {
  ImportDiagnosticV1,
  WorkbookFactStreamItemV1,
} from "../formats/delimited/facts.js";
import {
  EVIDENCE_EXAMPLE_LIMIT,
  inferenceStatement,
  type EvidenceV1,
  type InferenceStatementV1,
  type ValuePatternV1,
} from "./statements.js";
import {
  CURRENCY_SYMBOLS,
  isEmailText,
  isTelephoneText,
  isWebUrlText,
  matchesPattern,
  splitCurrency,
  type ProposedFieldTypeV1,
  type SourceValueFormatV1,
} from "./values.js";

/** Rows kept whole: the review evidence, and the range a header may move in. */
export const PROPOSAL_LEADING_ROWS = 20;

/** The longest discarded-row list a proposal carries; the count is still exact. */
export const PROPOSAL_DISCARDED_ROW_LIMIT = 50;

/** More distinct values than this and a column is not a choice list. */
export const ENUM_OPTION_LIMIT = 12;

/** Below this many values, repetition is not evidence of a choice list. */
export const ENUM_MINIMUM_VALUES = 8;

/** The share of a column's values a type must fit to be proposed. */
export const TYPE_CONFIDENCE = 0.9;

export const DISCARD_REASONS = Object.freeze([
  "above-header",
  "empty-row",
] as const);

export type DiscardReasonV1 = (typeof DISCARD_REASONS)[number];

export interface DiscardedRowV1 {
  readonly rowIndex: number;
  readonly reason: DiscardReasonV1;
  readonly cells: readonly string[];
}

export interface ProposedRowV1 {
  readonly rowIndex: number;
  readonly cells: readonly string[];
}

export interface ProposedEnumOptionV1 {
  readonly label: string;
  readonly occurrences: number;
}

export interface TypeViolationsV1 {
  readonly count: number;
  readonly examples: readonly {
    readonly rowIndex: number;
    readonly sourceText: string;
  }[];
}

export interface ProposedFieldV1 {
  readonly columnIndex: number;
  readonly fieldName: string;
  /** True when no heading supplied the name and Sheaf generated one. */
  readonly isNameGenerated: boolean;
  readonly type: ProposedFieldTypeV1;
  /** How promotion reads this column's source text (`values.ts`). */
  readonly sourceFormat: SourceValueFormatV1;
  readonly enumOptions: readonly ProposedEnumOptionV1[];
  /**
   * Values that will be preserved and flagged rather than stored typed (FR-6),
   * or `null` after the user overrode the type — nothing has measured the new
   * type yet, and promotion is what will find out.
   */
  readonly violations: TypeViolationsV1 | null;
}

export interface ProposedTableV1 {
  readonly tableName: string;
  readonly fields: readonly ProposedFieldV1[];
}

export interface ProposedAppV1 {
  /** The file this came from — review evidence, and what a refusal would name. */
  readonly fileName: string;
  readonly appName: string;
  readonly table: ProposedTableV1;
  /** Null when the file has no headings and every name was generated. */
  readonly headerRowIndex: number | null;
  /** The first rows verbatim: review evidence, and the header's move range. */
  readonly leadingRows: readonly ProposedRowV1[];
  readonly discardedRows: readonly DiscardedRowV1[];
  readonly discardedRowCount: number;
  /** Data rows the app will hold. Exact — see the module note. */
  readonly rowCount: number;
  /** Always `true`: a proposal is built from a completed stream, never a sample. */
  readonly isRowCountExact: true;
  readonly statements: readonly InferenceStatementV1[];
  readonly diagnostics: readonly ImportDiagnosticV1[];
}

export interface InferenceContextV1 {
  readonly fileName: string;
}

interface ColumnStats {
  nonEmpty: number;
  readonly matched: Map<ValuePatternV1, number>;
  readonly currencyMatched: Map<string, number>;
  readonly distinct: Map<string, number>;
  distinctOverflow: boolean;
  readonly examples: Map<ValuePatternV1, string[]>;
  readonly misses: Map<
    ValuePatternV1,
    { readonly rowIndex: number; readonly sourceText: string }[]
  >;
}

const newStats = (): ColumnStats => ({
  nonEmpty: 0,
  matched: new Map(),
  currencyMatched: new Map(),
  distinct: new Map(),
  distinctOverflow: false,
  examples: new Map(),
  misses: new Map(),
});

const bump = <K>(tally: Map<K, number>, key: K): void => {
  tally.set(key, (tally.get(key) ?? 0) + 1);
};

const collect = (
  store: Map<ValuePatternV1, string[]>,
  pattern: ValuePatternV1,
  value: string,
): void => {
  const kept = store.get(pattern) ?? [];
  if (kept.length < EVIDENCE_EXAMPLE_LIMIT) {
    kept.push(value);
    store.set(pattern, kept);
  }
};

const PATTERN_FORMATS: readonly (readonly [
  ValuePatternV1,
  SourceValueFormatV1,
])[] = [
  ["boolean-word", { kind: "boolean" }],
  ["iso-date", { kind: "iso-date" }],
  ["slash-date", { kind: "slash-date", order: "mdy" }],
  ["decimal-number", { kind: "decimal", currencySymbol: null }],
];

const observe = (
  stats: ColumnStats,
  rowIndex: number,
  text: string,
): void => {
  stats.nonEmpty += 1;

  if (stats.distinct.size <= ENUM_OPTION_LIMIT) {
    if (stats.distinct.has(text) || stats.distinct.size < ENUM_OPTION_LIMIT) {
      bump(stats.distinct, text);
    } else {
      stats.distinctOverflow = true;
    }
  }

  const record = (pattern: ValuePatternV1, matched: boolean): void => {
    if (matched) {
      bump(stats.matched, pattern);
      collect(stats.examples, pattern, text);
      return;
    }
    const kept = stats.misses.get(pattern) ?? [];
    if (kept.length < EVIDENCE_EXAMPLE_LIMIT) {
      kept.push({ rowIndex, sourceText: text });
      stats.misses.set(pattern, kept);
    }
  };

  for (const [pattern, format] of PATTERN_FORMATS) {
    record(pattern, matchesPattern(text, format));
  }
  record("email-address", isEmailText(text));
  record("web-url", isWebUrlText(text));
  record("telephone-number", isTelephoneText(text));

  const currency = splitCurrency(text);
  const isCurrency =
    currency !== null &&
    matchesPattern(text, {
      kind: "decimal",
      currencySymbol: currency.symbol,
    });
  record("currency-amount", isCurrency);
  if (isCurrency && currency !== null) {
    bump(stats.currencyMatched, currency.symbol);
  }
};

const dominantSymbol = (stats: ColumnStats): string | null => {
  let best: string | null = null;
  let bestCount = 0;
  for (const [symbol, count] of stats.currencyMatched) {
    if (count > bestCount || (count === bestCount && best !== null && symbol < best)) {
      best = symbol;
      bestCount = count;
    }
  }
  return best;
};

const meets = (matched: number, nonEmpty: number): boolean =>
  nonEmpty > 0 && matched >= Math.ceil(nonEmpty * TYPE_CONFIDENCE);

interface TypeChoice {
  readonly type: ProposedFieldTypeV1;
  readonly sourceFormat: SourceValueFormatV1;
  readonly evidence: readonly EvidenceV1[];
  readonly matched: number;
  readonly pattern: ValuePatternV1 | null;
}

const patternEvidence = (
  stats: ColumnStats,
  pattern: ValuePatternV1,
  detail: string | null,
  matched: number,
): EvidenceV1 => ({
  kind: "value-pattern",
  pattern,
  detail,
  matched,
  sampled: stats.nonEmpty,
  examples: stats.examples.get(pattern) ?? [],
});

/**
 * The order is the whole decision: a column of `1` and `0` is a number, not a
 * boolean vocabulary; a column of digits is a number, not a phone; and a column
 * nothing recognises is a choice list only if it repeats itself enough to be
 * one. Everything else is free text, which is the answer that can never be
 * wrong about the data — only unhelpful.
 */
const chooseType = (stats: ColumnStats): TypeChoice => {
  const text: TypeChoice = {
    type: { kind: "text" },
    sourceFormat: { kind: "text" },
    evidence: [],
    matched: stats.nonEmpty,
    pattern: null,
  };
  if (stats.nonEmpty === 0) {
    return text;
  }

  const ordered: readonly TypeChoice[] = [
    {
      type: { kind: "boolean" },
      sourceFormat: { kind: "boolean" },
      pattern: "boolean-word",
      matched: stats.matched.get("boolean-word") ?? 0,
      evidence: [],
    },
    {
      type: { kind: "date" },
      sourceFormat: { kind: "iso-date" },
      pattern: "iso-date",
      matched: stats.matched.get("iso-date") ?? 0,
      evidence: [],
    },
    {
      type: { kind: "date" },
      sourceFormat: { kind: "slash-date", order: "mdy" },
      pattern: "slash-date",
      matched: stats.matched.get("slash-date") ?? 0,
      evidence: [],
    },
    {
      type: { kind: "number" },
      sourceFormat: { kind: "decimal", currencySymbol: null },
      pattern: "decimal-number",
      matched: stats.matched.get("decimal-number") ?? 0,
      evidence: [],
    },
    {
      type: { kind: "email" },
      sourceFormat: { kind: "text" },
      pattern: "email-address",
      matched: stats.matched.get("email-address") ?? 0,
      evidence: [],
    },
    {
      type: { kind: "url" },
      sourceFormat: { kind: "text" },
      pattern: "web-url",
      matched: stats.matched.get("web-url") ?? 0,
      evidence: [],
    },
    {
      type: { kind: "phone" },
      sourceFormat: { kind: "text" },
      pattern: "telephone-number",
      matched: stats.matched.get("telephone-number") ?? 0,
      evidence: [],
    },
  ];

  const symbol = dominantSymbol(stats);
  const currencyMatched = symbol === null ? 0 : (stats.currencyMatched.get(symbol) ?? 0);
  if (symbol !== null && meets(currencyMatched, stats.nonEmpty)) {
    const currencyCode = CURRENCY_SYMBOLS.get(symbol) ?? "USD";
    return {
      type: { kind: "currency", currencyCode },
      sourceFormat: { kind: "decimal", currencySymbol: symbol },
      pattern: "currency-amount",
      matched: currencyMatched,
      evidence: [
        patternEvidence(stats, "currency-amount", symbol, currencyMatched),
      ],
    };
  }

  for (const candidate of ordered) {
    if (candidate.pattern !== null && meets(candidate.matched, stats.nonEmpty)) {
      return {
        ...candidate,
        evidence: [
          patternEvidence(stats, candidate.pattern, null, candidate.matched),
        ],
      };
    }
  }

  const distinct = stats.distinct.size;
  if (
    !stats.distinctOverflow &&
    stats.nonEmpty >= ENUM_MINIMUM_VALUES &&
    // One value repeated is not a choice: there would be nothing to choose.
    distinct >= 2 &&
    distinct <= ENUM_OPTION_LIMIT &&
    distinct * 2 <= stats.nonEmpty
  ) {
    return {
      type: { kind: "enum" },
      sourceFormat: { kind: "enum" },
      pattern: null,
      matched: stats.nonEmpty,
      evidence: [
        {
          kind: "distinct-values",
          distinct,
          sampled: stats.nonEmpty,
          options: [...stats.distinct.keys()].sort(),
        },
      ],
    };
  }

  return text;
};

const rowShape = (row: ProposedRowV1): EvidenceV1 => ({
  kind: "row-shape",
  rowIndex: row.rowIndex,
  cellCount: row.cells.length,
  valueCount: row.cells.filter((cell) => cell !== "").length,
});

const titleize = (fileName: string): string => {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const words = stem
    .split(/[\s._-]+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length === 0 ? "Imported table" : words.join(" ");
};

const isEmptyRow = (cells: readonly string[]): boolean =>
  cells.every((cell) => cell === "");

const looksLikeHeading = (cell: string): boolean =>
  cell !== "" &&
  !PATTERN_FORMATS.some(([, format]) => matchesPattern(cell, format)) &&
  !isEmailText(cell) &&
  !isWebUrlText(cell) &&
  !isTelephoneText(cell) &&
  splitCurrency(cell) === null;

const modalWidth = (rows: readonly ProposedRowV1[]): number => {
  const tally = new Map<number, number>();
  for (const row of rows) {
    if (!isEmptyRow(row.cells)) {
      bump(tally, row.cells.length);
    }
  }
  let best = 0;
  let bestCount = 0;
  for (const [width, count] of tally) {
    if (count > bestCount || (count === bestCount && width > best)) {
      best = width;
      bestCount = count;
    }
  }
  return best;
};

/**
 * The first row that reads as headings: full width, every cell filled, and not
 * one cell that any value pattern recognises. A title row fails on width, a
 * report-date row fails on the date pattern, and a file that starts straight
 * into data has no header row at all.
 */
export const detectHeaderRow = (
  rows: readonly ProposedRowV1[],
): number | null => {
  const width = modalWidth(rows);
  if (width === 0) {
    return null;
  }
  for (const row of rows) {
    if (
      row.cells.length === width &&
      row.cells.every(looksLikeHeading) &&
      new Set(row.cells).size === row.cells.length
    ) {
      return row.rowIndex;
    }
  }
  return null;
};

export const generatedFieldName = (columnIndex: number): string =>
  `Column ${columnIndex + 1}`;

/** Names from a heading row, filling gaps and disambiguating repeats. */
export const fieldNamesFrom = (
  headerCells: readonly string[] | null,
  fieldCount: number,
): readonly { readonly name: string; readonly isGenerated: boolean }[] => {
  const used = new Set<string>();
  return Array.from({ length: fieldCount }, (_unused, columnIndex) => {
    const heading = headerCells?.[columnIndex]?.trim() ?? "";
    const isGenerated = heading === "";
    let name = isGenerated ? generatedFieldName(columnIndex) : heading;
    for (let suffix = 2; used.has(name); suffix += 1) {
      name = `${isGenerated ? generatedFieldName(columnIndex) : heading} ${suffix}`;
    }
    used.add(name);
    return { name, isGenerated };
  });
};

const enumOptionsOf = (
  stats: ColumnStats,
): readonly ProposedEnumOptionV1[] =>
  [...stats.distinct.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([label, occurrences]) => ({ label, occurrences }));

const violationsOf = (
  stats: ColumnStats,
  choice: TypeChoice,
): TypeViolationsV1 | null => {
  if (choice.type.kind === "enum") {
    return { count: 0, examples: [] };
  }
  if (choice.pattern === null) {
    return { count: 0, examples: [] };
  }
  if (
    choice.type.kind === "email" ||
    choice.type.kind === "url" ||
    choice.type.kind === "phone"
  ) {
    // These store text, so nothing can fail to fit — see `values.ts`.
    return { count: 0, examples: [] };
  }
  return {
    count: stats.nonEmpty - choice.matched,
    examples: stats.misses.get(choice.pattern) ?? [],
  };
};

/**
 * Reads a completed fact stream and proposes one app with one table.
 *
 * @throws when the stream carries no terminal summary — a cancelled parse has
 * nothing exact to propose from, and guessing would be the one thing a review
 * screen must never have to do.
 */
export function inferProposal(
  items: Iterable<WorkbookFactStreamItemV1>,
  context: InferenceContextV1,
): ProposedAppV1 {
  const leading: ProposedRowV1[] = [];
  const buffered: ProposedRowV1[] = [];
  const columns = new Map<number, ColumnStats>();
  const discarded: DiscardedRowV1[] = [];
  let discardedRowCount = 0;
  let dataRowCount = 0;
  let headerRowIndex: number | null = null;
  let headerDecided = false;
  let summary: ImportDiagnosticV1[] | null = null;
  let modalColumnCount = 0;
  let widestRowCellCount = 0;

  let currentIndex: number | null = null;
  let currentCells: string[] = [];

  const takeDataRow = (row: ProposedRowV1): void => {
    if (isEmptyRow(row.cells)) {
      discardedRowCount += 1;
      if (discarded.length < PROPOSAL_DISCARDED_ROW_LIMIT) {
        discarded.push({
          rowIndex: row.rowIndex,
          reason: "empty-row",
          cells: row.cells,
        });
      }
      return;
    }
    dataRowCount += 1;
    for (const [columnIndex, cell] of row.cells.entries()) {
      if (cell === "") {
        continue;
      }
      let stats = columns.get(columnIndex);
      if (stats === undefined) {
        stats = newStats();
        columns.set(columnIndex, stats);
      }
      observe(stats, row.rowIndex, cell);
    }
  };

  const decideHeader = (): void => {
    headerDecided = true;
    headerRowIndex = detectHeaderRow(buffered);
    modalColumnCount = modalWidth(buffered);
    for (const row of buffered) {
      if (headerRowIndex !== null && row.rowIndex <= headerRowIndex) {
        if (row.rowIndex === headerRowIndex) {
          continue;
        }
        discardedRowCount += 1;
        if (discarded.length < PROPOSAL_DISCARDED_ROW_LIMIT) {
          discarded.push({
            rowIndex: row.rowIndex,
            reason: "above-header",
            cells: row.cells,
          });
        }
        continue;
      }
      takeDataRow(row);
    }
    buffered.length = 0;
  };

  const flushRow = (): void => {
    if (currentIndex === null) {
      return;
    }
    const row: ProposedRowV1 = { rowIndex: currentIndex, cells: currentCells };
    if (leading.length < PROPOSAL_LEADING_ROWS) {
      leading.push(row);
    }
    if (headerDecided) {
      takeDataRow(row);
    } else {
      buffered.push(row);
      if (buffered.length >= PROPOSAL_LEADING_ROWS) {
        decideHeader();
      }
    }
    currentIndex = null;
    currentCells = [];
  };

  for (const item of items) {
    if (item.kind === "summary") {
      summary = [...item.diagnostics];
      widestRowCellCount = item.columnCount;
      continue;
    }
    for (const fact of item.facts) {
      if (fact.kind === "row") {
        flushRow();
        currentIndex = fact.rowIndex;
        currentCells = Array.from({ length: fact.cellCount }, () => "");
      } else if (fact.kind === "value" && fact.value.kind === "text") {
        if (currentIndex === fact.rowIndex) {
          currentCells[fact.columnIndex] = fact.value.text;
        }
      }
    }
  }
  flushRow();
  if (!headerDecided) {
    decideHeader();
  }

  if (summary === null) {
    throw new Error("inference needs a completed fact stream with its summary");
  }

  // The table is as wide as the widest row, never as wide as the *typical*
  // row: a ragged row's extra cells are real values, and a narrower table
  // would silently drop them (FR-4/FR-9).
  const columnCount = Math.max(modalColumnCount, widestRowCellCount);

  const headerRow =
    headerRowIndex === null
      ? null
      : (leading.find((row) => row.rowIndex === headerRowIndex)?.cells ?? null);
  const names = fieldNamesFrom(headerRow, columnCount);

  const analysed = names.map(({ name, isGenerated }, columnIndex) => {
    const stats = columns.get(columnIndex) ?? newStats();
    const choice = chooseType(stats);
    const field: ProposedFieldV1 = {
      columnIndex,
      fieldName: name,
      isNameGenerated: isGenerated,
      type: choice.type,
      sourceFormat: choice.sourceFormat,
      enumOptions: choice.type.kind === "enum" ? enumOptionsOf(stats) : [],
      violations: violationsOf(stats, choice),
    };
    return { field, stats, choice };
  });
  const fields = analysed.map(({ field }) => field);

  const name = titleize(context.fileName);
  const fileEvidence: EvidenceV1 = {
    kind: "file-name",
    fileName: context.fileName,
  };

  const statements: InferenceStatementV1[] = [
    inferenceStatement("app-name", null, "rename-app", [fileEvidence]),
    inferenceStatement("table-name", null, "rename-table", [fileEvidence]),
    inferenceStatement(
      "header-row",
      null,
      "set-header-row",
      headerRowIndex === null
        ? leading
            .slice(0, 1)
            .map((row) => rowShape(row))
        : [
            {
              kind: "header-text",
              rowIndex: headerRowIndex,
              text: (headerRow ?? []).join(" · "),
            },
          ],
    ),
  ];

  if (discardedRowCount > 0) {
    statements.push(
      inferenceStatement(
        "discarded-rows",
        null,
        "set-header-row",
        discarded.slice(0, EVIDENCE_EXAMPLE_LIMIT).map(({ rowIndex, cells }) =>
          rowShape({ rowIndex, cells }),
        ),
      ),
    );
  }

  for (const { field, stats, choice } of analysed) {
    statements.push(
      inferenceStatement("field-name", field.columnIndex, "rename-field", [
        headerRowIndex === null || field.isNameGenerated
          ? { kind: "file-name", fileName: context.fileName }
          : {
              kind: "header-text",
              rowIndex: headerRowIndex,
              text: field.fieldName,
            },
      ]),
    );

    const typeEvidence: EvidenceV1[] = [...choice.evidence];
    const violations = field.violations;
    if (violations !== null && violations.count > 0) {
      typeEvidence.push({
        kind: "value-conflict",
        count: violations.count,
        examples: violations.examples,
      });
    }
    statements.push(
      inferenceStatement(
        "field-type",
        field.columnIndex,
        "override-type",
        typeEvidence,
      ),
    );

    if (field.type.kind === "enum") {
      statements.push(
        inferenceStatement(
          "enum-options",
          field.columnIndex,
          "edit-enum-options",
          [
            {
              kind: "distinct-values",
              distinct: field.enumOptions.length,
              sampled: stats.nonEmpty,
              options: field.enumOptions.map((option) => option.label),
            },
          ],
        ),
      );
    }
  }

  return {
    fileName: context.fileName,
    appName: name,
    table: { tableName: name, fields },
    headerRowIndex,
    leadingRows: leading,
    discardedRows: discarded,
    discardedRowCount,
    rowCount: dataRowCount,
    isRowCountExact: true,
    statements,
    diagnostics: summary,
  };
}

