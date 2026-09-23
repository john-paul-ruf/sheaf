/**
 * Column typing (M21; FR-6): per-column tallies, F02's value typing, and the
 * workbook's declared typing that runs ahead of it.
 *
 * **Declared structure beats values.** A column covered by a validation rule
 * is typed by the rule (a list is an enum with the list's options; whole and
 * decimal are numbers; a date rule is a date). Otherwise a column most of
 * whose values carry a non-General number format is typed by that format
 * (currency, number, percent, date). Only a column the workbook declares
 * nothing about falls through to F02's value typing — which is all a
 * delimited stream ever gets.
 *
 * **Bounded.** A column keeps counters, at most
 * {@link EVIDENCE_EXAMPLE_LIMIT} examples and misses per pattern, at most
 * {@link COLUMN_FORMAT_LIMIT} distinct number formats, and one distinct-value
 * sketch of at most `distinctLimit` entries (F02: {@link ENUM_OPTION_LIMIT};
 * workbook: {@link KEY_SKETCH_LIMIT}, which keys and relationships measure
 * containment on). Never the column's values.
 *
 * Violations are counted with the same predicate the converter uses
 * (`values.ts`), so "two values do not fit" names exactly the two promotion
 * will preserve and flag.
 */

import type { LookupV1 } from "../../domain/formulas/index.js";
import type { DateSystemV1, FormatClassV1, ValidationListSourceV1, WorkbookStructureFactV1 } from "../facts/index.js";
import {
  EVIDENCE_EXAMPLE_LIMIT,
  type EvidenceV1,
  type ValuePatternV1,
  type WorkbookEvidenceV1,
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
  type WorkbookSourceValueFormatV1,
} from "./values.js";

/** More distinct values than this and a column is not a choice list. */
export const ENUM_OPTION_LIMIT = 12;

/** Below this many values, repetition is not evidence of a choice list. */
export const ENUM_MINIMUM_VALUES = 8;

/** The share of a column's values a type must fit to be proposed. */
export const TYPE_CONFIDENCE = 0.9;

/** Distinct values kept per workbook column for keys and containment. */
export const KEY_SKETCH_LIMIT = 10_000;

/** The most options a validation list may carry and still become an enum. */
export const VALIDATION_ENUM_OPTION_LIMIT = 64;

/** A number format types a column when more than this share of its values carry it. */
export const DECLARED_FORMAT_SHARE = 0.5;

/** Distinct number formats counted per column; more are not tallied. */
export const COLUMN_FORMAT_LIMIT = 8;

/** Lookups remembered per formula column (one per master formula, first seen). */
export const COLUMN_LOOKUP_LIMIT = 8;

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

/** The number format a cell carries (from the column's last `cell-format` fact). */
export interface CellFormatV1 {
  readonly numberFormat: string;
  readonly formatClass: FormatClassV1;
  readonly currencySymbol: string | null;
}

type TallyKey = ValuePatternV1 | "serial-date";

interface DistinctEntry {
  count: number;
  readonly firstRowIndex: number;
}

export interface ColumnStats {
  nonEmpty: number;
  readonly matched: Map<TallyKey, number>;
  readonly currencyMatched: Map<string, number>;
  readonly distinct: Map<string, DistinctEntry>;
  readonly distinctLimit: number;
  distinctOverflow: boolean;
  readonly examples: Map<TallyKey, string[]>;
  readonly misses: Map<TallyKey, { readonly rowIndex: number; readonly sourceText: string }[]>;
  readonly formats: Map<string, CellFormatV1 & { count: number }>;
  /** When set, `serial-date` fit is tallied in this epoch. */
  readonly dateSystem: DateSystemV1 | null;
  formulaCount: number;
  firstFormula: { readonly text: string; readonly isArray: boolean; readonly isExternal: boolean } | null;
  /** Lookups in this column's master formulas, with the formula that carried each. */
  readonly lookups: { readonly lookup: LookupV1; readonly formulaText: string }[];
}

export const newStats = (distinctLimit: number, dateSystem: DateSystemV1 | null): ColumnStats => ({
  nonEmpty: 0,
  matched: new Map(),
  currencyMatched: new Map(),
  distinct: new Map(),
  distinctLimit,
  distinctOverflow: false,
  examples: new Map(),
  misses: new Map(),
  formats: new Map(),
  dateSystem,
  formulaCount: 0,
  firstFormula: null,
  lookups: [],
});

const bump = <K>(tally: Map<K, number>, key: K, by = 1): void => {
  tally.set(key, (tally.get(key) ?? 0) + by);
};

const PATTERN_FORMATS: readonly (readonly [ValuePatternV1, SourceValueFormatV1])[] = [
  ["boolean-word", { kind: "boolean" }],
  ["iso-date", { kind: "iso-date" }],
  ["slash-date", { kind: "slash-date", order: "mdy" }],
  ["decimal-number", { kind: "decimal", currencySymbol: null }],
];

/** True when no value pattern claims the cell: what a heading looks like. */
export const looksLikeHeading = (cell: string): boolean =>
  cell !== "" &&
  !PATTERN_FORMATS.some(([, format]) => matchesPattern(cell, format)) &&
  !isEmailText(cell) &&
  !isWebUrlText(cell) &&
  !isTelephoneText(cell) &&
  splitCurrency(cell) === null;

/** Records one non-empty cell's text (and, for a workbook, its number format). */
export const observe = (stats: ColumnStats, rowIndex: number, text: string, format: CellFormatV1 | null = null): void => {
  stats.nonEmpty += 1;

  const entry = stats.distinct.get(text);
  if (entry !== undefined) {
    entry.count += 1;
  } else if (stats.distinct.size < stats.distinctLimit) {
    stats.distinct.set(text, { count: 1, firstRowIndex: rowIndex });
  } else {
    stats.distinctOverflow = true;
  }

  const record = (pattern: TallyKey, isMatch: boolean): void => {
    if (isMatch) {
      bump(stats.matched, pattern);
      const kept = stats.examples.get(pattern) ?? [];
      if (kept.length < EVIDENCE_EXAMPLE_LIMIT) {
        kept.push(text);
        stats.examples.set(pattern, kept);
      }
      return;
    }
    const kept = stats.misses.get(pattern) ?? [];
    if (kept.length < EVIDENCE_EXAMPLE_LIMIT) {
      kept.push({ rowIndex, sourceText: text });
      stats.misses.set(pattern, kept);
    }
  };

  for (const [pattern, patternFormat] of PATTERN_FORMATS) {
    record(pattern, matchesPattern(text, patternFormat));
  }
  record("email-address", isEmailText(text));
  record("web-url", isWebUrlText(text));
  record("telephone-number", isTelephoneText(text));

  const currency = splitCurrency(text);
  const isCurrency = currency !== null && matchesPattern(text, { kind: "decimal", currencySymbol: currency.symbol });
  record("currency-amount", isCurrency);
  if (isCurrency && currency !== null) {
    bump(stats.currencyMatched, currency.symbol);
  }

  if (stats.dateSystem !== null) {
    record("serial-date", matchesPattern(text, { kind: "serial-date", system: stats.dateSystem }));
  }
  if (format !== null && format.formatClass !== "general" && format.formatClass !== "text") {
    const tally = stats.formats.get(format.numberFormat);
    if (tally !== undefined) tally.count += 1;
    else if (stats.formats.size < COLUMN_FORMAT_LIMIT) stats.formats.set(format.numberFormat, { ...format, count: 1 });
  }
};

/** Folds `from` into a copy of `into`: the tallies of two regions read as one. */
export const mergeStats = (into: ColumnStats, from: ColumnStats): ColumnStats => {
  const merged = newStats(into.distinctLimit, into.dateSystem);
  for (const source of [into, from]) {
    merged.nonEmpty += source.nonEmpty;
    for (const [key, count] of source.matched) bump(merged.matched, key, count);
    for (const [key, count] of source.currencyMatched) bump(merged.currencyMatched, key, count);
    for (const [text, entry] of source.distinct) {
      const existing = merged.distinct.get(text);
      if (existing !== undefined) existing.count += entry.count;
      else if (merged.distinct.size < merged.distinctLimit) merged.distinct.set(text, { ...entry });
      else merged.distinctOverflow = true;
    }
    merged.distinctOverflow ||= source.distinctOverflow;
    for (const [key, kept] of source.examples) {
      merged.examples.set(key, [...(merged.examples.get(key) ?? []), ...kept].slice(0, EVIDENCE_EXAMPLE_LIMIT));
    }
    for (const [key, kept] of source.misses) {
      merged.misses.set(key, [...(merged.misses.get(key) ?? []), ...kept].slice(0, EVIDENCE_EXAMPLE_LIMIT));
    }
    for (const [code, tally] of source.formats) {
      const existing = merged.formats.get(code);
      if (existing !== undefined) existing.count += tally.count;
      else if (merged.formats.size < COLUMN_FORMAT_LIMIT) merged.formats.set(code, { ...tally });
    }
    merged.formulaCount += source.formulaCount;
    merged.firstFormula ??= source.firstFormula;
    merged.lookups.push(...source.lookups.slice(0, COLUMN_LOOKUP_LIMIT - merged.lookups.length));
  }
  return merged;
};

/** The value-inferred choice, F02's shape. */
export interface TypeChoice {
  readonly type: ProposedFieldTypeV1;
  readonly sourceFormat: SourceValueFormatV1;
  readonly evidence: readonly EvidenceV1[];
  readonly matched: number;
  readonly pattern: ValuePatternV1 | null;
}

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

const patternEvidence = (stats: ColumnStats, pattern: ValuePatternV1, detail: string | null, matched: number): EvidenceV1 => ({
  kind: "value-pattern",
  pattern,
  detail,
  matched,
  sampled: stats.nonEmpty,
  examples: stats.examples.get(pattern) ?? [],
});

/** Option labels in code-unit order with their counts. */
export const enumOptionsOf = (stats: ColumnStats): readonly ProposedEnumOptionV1[] =>
  [...stats.distinct.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([label, entry]) => ({ label, occurrences: entry.count }));

/**
 * The order is the whole decision: a column of `1` and `0` is a number, not a
 * boolean vocabulary; a column of digits is a number, not a phone; and a column
 * nothing recognises is a choice list only if it repeats itself enough to be
 * one. Everything else is free text, which is the answer that can never be
 * wrong about the data — only unhelpful.
 */
export const chooseType = (stats: ColumnStats): TypeChoice => {
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

  const candidate = (
    type: ProposedFieldTypeV1,
    sourceFormat: SourceValueFormatV1,
    pattern: ValuePatternV1,
  ): TypeChoice => ({ type, sourceFormat, pattern, matched: stats.matched.get(pattern) ?? 0, evidence: [] });

  const ordered: readonly TypeChoice[] = [
    candidate({ kind: "boolean" }, { kind: "boolean" }, "boolean-word"),
    candidate({ kind: "date" }, { kind: "iso-date" }, "iso-date"),
    candidate({ kind: "date" }, { kind: "slash-date", order: "mdy" }, "slash-date"),
    candidate({ kind: "number" }, { kind: "decimal", currencySymbol: null }, "decimal-number"),
    candidate({ kind: "email" }, { kind: "text" }, "email-address"),
    candidate({ kind: "url" }, { kind: "text" }, "web-url"),
    candidate({ kind: "phone" }, { kind: "text" }, "telephone-number"),
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
      evidence: [patternEvidence(stats, "currency-amount", symbol, currencyMatched)],
    };
  }

  for (const choice of ordered) {
    if (choice.pattern !== null && meets(choice.matched, stats.nonEmpty)) {
      return { ...choice, evidence: [patternEvidence(stats, choice.pattern, null, choice.matched)] };
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

/** The values a value-inferred type preserves and flags (F02). */
export const violationsOf = (stats: ColumnStats, choice: TypeChoice): TypeViolationsV1 => {
  if (
    choice.pattern === null ||
    choice.type.kind === "enum" ||
    choice.type.kind === "email" ||
    choice.type.kind === "url" ||
    choice.type.kind === "phone"
  ) {
    // Enums take every observed value as an option; the others store text,
    // so nothing can fail to fit — see `values.ts`.
    return { count: 0, examples: [] };
  }
  return {
    count: stats.nonEmpty - choice.matched,
    examples: stats.misses.get(choice.pattern) ?? [],
  };
};

/** A workbook column's typing: what the field becomes and why. */
export interface WorkbookTypeChoice {
  readonly type: ProposedFieldTypeV1;
  readonly sourceFormat: WorkbookSourceValueFormatV1;
  readonly enumOptions: readonly ProposedEnumOptionV1[];
  /** `null` when the column's values outgrew the sketch and nothing exact can be said. */
  readonly violations: TypeViolationsV1 | null;
  /** Type evidence, violations included. */
  readonly evidence: readonly WorkbookEvidenceV1[];
  /** The enum-options statement's evidence, for an enum. */
  readonly optionsEvidence: readonly WorkbookEvidenceV1[];
}

type ValidationFact = Extract<WorkbookStructureFactV1, { kind: "validation" }>;

const conflict = (violations: TypeViolationsV1 | null): readonly WorkbookEvidenceV1[] =>
  violations === null || violations.count === 0 ? [] : [{ kind: "value-conflict", count: violations.count, examples: violations.examples }];

const patternViolations = (stats: ColumnStats, key: TallyKey): TypeViolationsV1 => ({
  count: stats.nonEmpty - (stats.matched.get(key) ?? 0),
  examples: stats.misses.get(key) ?? [],
});

const dateFormat = (stats: ColumnStats): { format: WorkbookSourceValueFormatV1; key: TallyKey } =>
  stats.dateSystem === null
    ? { format: { kind: "iso-date" }, key: "iso-date" }
    : { format: { kind: "serial-date", system: stats.dateSystem }, key: "serial-date" };

const typed = (
  type: ProposedFieldTypeV1,
  sourceFormat: WorkbookSourceValueFormatV1,
  declared: WorkbookEvidenceV1,
  violations: TypeViolationsV1 | null,
): WorkbookTypeChoice => ({
  type,
  sourceFormat,
  enumOptions: [],
  violations,
  evidence: [declared, ...conflict(violations)],
  optionsEvidence: [],
});

export const validationEvidence = (
  validation: ValidationFact,
  listOptions: readonly string[] | null,
): WorkbookEvidenceV1 => ({
  kind: "validation-rule",
  rule: validation.rule,
  operator: validation.operator,
  listSource: validation.listSource,
  formula1: validation.formula1,
  formula2: validation.formula2,
  listOptions,
});

/** A list validation's options when it states them inline. */
export const inlineOptionsOf = (source: ValidationListSourceV1 | null): readonly string[] | null =>
  source?.kind === "inline" ? source.values : null;

const uniqueNonEmpty = (labels: readonly string[]): readonly string[] =>
  [...new Set(labels.map((label) => label.trim()).filter((label) => label !== ""))];

/**
 * Declared typing, or `null` when the workbook declares nothing about the
 * column. `listOptions` is a list rule's options (inline, or read from its
 * source range); `null` means they could not be read, and the options come
 * from the column's own values.
 */
export function chooseDeclaredType(
  stats: ColumnStats,
  validation: ValidationFact | null,
  listOptions: readonly string[] | null,
): WorkbookTypeChoice | null {
  if (validation !== null) {
    switch (validation.rule) {
      case "list": {
        const declared = listOptions === null ? null : uniqueNonEmpty(listOptions);
        const labels = declared ?? (stats.distinctOverflow ? null : enumOptionsOf(stats).map((option) => option.label));
        if (labels === null || labels.length === 0 || labels.length > VALIDATION_ENUM_OPTION_LIMIT) break;
        const allowed = new Set(labels);
        const misses = [...stats.distinct.entries()]
          .filter(([text]) => !allowed.has(text))
          .sort(([, left], [, right]) => left.firstRowIndex - right.firstRowIndex);
        const violations: TypeViolationsV1 | null = stats.distinctOverflow
          ? null
          : {
              count: misses.reduce((sum, [, entry]) => sum + entry.count, 0),
              examples: misses.slice(0, EVIDENCE_EXAMPLE_LIMIT).map(([sourceText, entry]) => ({
                rowIndex: entry.firstRowIndex,
                sourceText,
              })),
            };
        const evidence = validationEvidence(validation, declared);
        return {
          type: { kind: "enum" },
          sourceFormat: { kind: "enum" },
          enumOptions: labels.map((label) => ({ label, occurrences: stats.distinct.get(label)?.count ?? 0 })),
          violations,
          evidence: [evidence, ...conflict(violations)],
          optionsEvidence: [evidence],
        };
      }
      case "whole":
      case "decimal":
        return typed(
          { kind: "number" },
          { kind: "decimal", currencySymbol: null },
          validationEvidence(validation, null),
          patternViolations(stats, "decimal-number"),
        );
      case "date": {
        const { format, key } = dateFormat(stats);
        return typed({ kind: "date" }, format, validationEvidence(validation, null), patternViolations(stats, key));
      }
      case "time":
      case "text-length":
      case "custom":
        break;
      default: {
        const unreachable: never = validation.rule;
        return unreachable;
      }
    }
  }

  let dominant: (CellFormatV1 & { count: number }) | null = null;
  const byClass = new Map<FormatClassV1, number>();
  for (const tally of stats.formats.values()) {
    bump(byClass, tally.formatClass, tally.count);
  }
  let bestClass: FormatClassV1 | null = null;
  for (const [formatClass, count] of byClass) {
    if (bestClass === null || count > (byClass.get(bestClass) ?? 0)) bestClass = formatClass;
  }
  if (bestClass === null || (byClass.get(bestClass) ?? 0) <= stats.nonEmpty * DECLARED_FORMAT_SHARE) {
    return null;
  }
  for (const tally of stats.formats.values()) {
    if (tally.formatClass === bestClass && (dominant === null || tally.count > dominant.count)) dominant = tally;
  }
  if (dominant === null) return null;
  const evidence: WorkbookEvidenceV1 = {
    kind: "number-format",
    numberFormat: dominant.numberFormat,
    formatClass: dominant.formatClass,
    currencySymbol: dominant.currencySymbol,
    matched: byClass.get(bestClass) ?? 0,
    sampled: stats.nonEmpty,
  };
  const decimal: WorkbookSourceValueFormatV1 = { kind: "decimal", currencySymbol: null };
  switch (bestClass) {
    case "currency": {
      const code = dominant.currencySymbol === null ? undefined : CURRENCY_SYMBOLS.get(dominant.currencySymbol);
      return code === undefined
        ? typed({ kind: "number" }, decimal, evidence, patternViolations(stats, "decimal-number"))
        : typed({ kind: "currency", currencyCode: code }, decimal, evidence, patternViolations(stats, "decimal-number"));
    }
    case "number":
    case "percent":
    case "time":
      // A time of day is a fraction of a day; F03 has no time type, so it
      // stays the number it is rather than a date that would drop it.
      return typed({ kind: "number" }, decimal, evidence, patternViolations(stats, "decimal-number"));
    case "date":
    case "datetime": {
      const { format, key } = dateFormat(stats);
      return typed({ kind: "date" }, format, evidence, patternViolations(stats, key));
    }
    case "general":
    case "text":
    case "other":
      return null;
    default: {
      const unreachable: never = bestClass;
      return unreachable;
    }
  }
}

/** A value-inferred choice carries F02 evidence only. */
export interface ValueTypeChoice extends WorkbookTypeChoice {
  readonly sourceFormat: SourceValueFormatV1;
  readonly evidence: readonly EvidenceV1[];
  readonly optionsEvidence: readonly EvidenceV1[];
}

const f02Conflict = (violations: TypeViolationsV1): readonly EvidenceV1[] =>
  violations.count === 0 ? [] : [{ kind: "value-conflict", count: violations.count, examples: violations.examples }];

/** F02's value typing in the workbook shape: the fall-through when nothing is declared. */
export function chooseValueType(stats: ColumnStats): ValueTypeChoice {
  const choice = chooseType(stats);
  const violations = violationsOf(stats, choice);
  const enumOptions = choice.type.kind === "enum" ? enumOptionsOf(stats) : [];
  return {
    type: choice.type,
    sourceFormat: choice.sourceFormat,
    enumOptions,
    violations,
    evidence: [...choice.evidence, ...f02Conflict(violations)],
    optionsEvidence:
      choice.type.kind === "enum"
        ? [
            {
              kind: "distinct-values",
              distinct: enumOptions.length,
              sampled: stats.nonEmpty,
              options: enumOptions.map((option) => option.label),
            },
          ]
        : [],
  };
}
