/**
 * The bounded formula interpreter (M03; architecture § Formula IR, CA-26,
 * invariant 8).
 *
 * It walks an IR document node by node. Nothing is compiled, `eval`'d or
 * turned into code; every node visit costs one step of a budget (default
 * {@link DEFAULT_EVALUATION_BUDGET}), and a document that would exceed it —
 * or nest deeper than {@link MAX_EVALUATION_DEPTH} — yields `#BUDGET`.
 *
 * Results stay distinct (CA-26): `ok(value)`, `empty`, `error(code)`,
 * `cycle`, `unsupported`. Numbers are canonical decimal strings computed
 * exactly, dates are epoch days, and the clock is read only through the
 * injected `env.clock` — so the same document, inputs and clock always give
 * the same result. `RAND`/`RANDBETWEEN` are never evaluated here: a formula
 * that uses them is frozen (D51), and the command that freezes it evaluates
 * it exactly once through {@link evaluateNondeterministicOnce}.
 */

import type { DomainEntropy, FieldId, FormulaId, OptionId, RecordId, RelationshipId, TableId } from "../model/ids.js";
import { isCanonicalDecimal, type CellValueV1 } from "../model/values.js";
import { callBuiltin, power, type CallContextV1 } from "./builtins.js";
import { catalogEntryOf } from "./catalog.js";
import {
  addDecimals,
  divideDecimals,
  formatDecimal,
  isIntegral,
  integerPart,
  multiplyDecimals,
  negateDecimal,
  parseDecimal,
  subtractDecimals,
  type DecimalV1,
} from "./decimal.js";
import { FORMULA_ERROR_CODES, type FormulaErrorCodeV1, type FormulaIRDocumentV1, type FormulaIRV1 } from "./ir.js";
import {
  bool,
  compareScalars,
  dateOrOverflow,
  EMPTY,
  err,
  num,
  numOrOverflow,
  text,
  toNumber,
  toText,
  UnsupportedEvaluation,
  type ScalarV1,
} from "./scalars.js";

export const DEFAULT_EVALUATION_BUDGET = 10_000;
export const MAX_EVALUATION_DEPTH = 256;

/** migration 005's `scalar_formula_results.status` CHECK, verbatim. */
export const EVALUATION_RESULT_KINDS = Object.freeze(["ok", "empty", "unsupported", "cycle", "error"] as const);

/** A value a formula can produce: never an absent state or preserved text. */
export type FormulaResultValueV1 = Extract<
  CellValueV1,
  { readonly kind: "text" | "decimal" | "date" | "boolean" | "enum" | "reference" }
>;

export type EvaluationResultV1 =
  | { readonly kind: "ok"; readonly value: FormulaResultValueV1 }
  | { readonly kind: "empty" }
  | { readonly kind: "error"; readonly code: FormulaErrorCodeV1 }
  /** A cycle member, or downstream of one: never evaluated. */
  | { readonly kind: "cycle" }
  | { readonly kind: "unsupported" };

/** A field's value as the evaluator reads it; an upstream computed field may hold an error. */
export type FieldReadV1 = CellValueV1 | { readonly kind: "error"; readonly code: FormulaErrorCodeV1 };

export interface RowAccessV1 {
  readonly recordId: RecordId;
  valueOf(fieldId: FieldId): FieldReadV1;
}

export interface ColumnAccessV1 {
  /** Every live record's value of one field; the columns of one table share one record order. */
  valuesOf(tableId: TableId, fieldId: FieldId): Iterable<FieldReadV1>;
}

export interface EvaluationClockReadingV1 {
  readonly epochDay: number;
  readonly epochMs: number;
}

export interface EvaluationEnvV1 {
  /** The session clock — the only source of `TODAY()`/`NOW()`. */
  readonly clock: () => EvaluationClockReadingV1;
  readonly columns: ColumnAccessV1;
  /** Another formula's current result (dashboard values, table metrics). */
  readonly formulaResults: (formulaId: FormulaId) => EvaluationResultV1;
  /** The parent row this record reaches through a relationship, or `null` when it reaches none. */
  readonly relatedRow: (relationshipId: RelationshipId, recordId: RecordId) => RowAccessV1 | null;
  /** An enum option's current label, so it compares as the text a person sees. */
  readonly optionLabel: (optionId: OptionId) => string | null;
  /** Maximum node visits for one evaluation. */
  readonly budget?: number;
}

type ValueV1 = ScalarV1 | { readonly t: "array"; readonly items: readonly ScalarV1[] };

class BudgetExceeded extends Error {}
class CycleReached extends Error {}

const ERROR_CODES = new Set<string>(FORMULA_ERROR_CODES);
const ONE_HUNDRED: DecimalV1 = { coefficient: 100n, scale: 0 };

function fromCell(value: FieldReadV1, env: EvaluationEnvV1): ScalarV1 {
  switch (value.kind) {
    case "text":
      return text(value.text);
    case "decimal":
      return isCanonicalDecimal(value.decimal) ? num(parseDecimal(value.decimal)) : err("#VALUE!");
    case "date":
      return dateOrOverflow(value.epochDay);
    case "boolean":
      return bool(value.boolean);
    case "enum":
      return { t: "enum", optionId: value.optionId, label: env.optionLabel(value.optionId) };
    case "reference":
      return { t: "ref", recordId: value.recordId };
    case "missing":
    case "blank":
      return EMPTY;
    case "invalid-preserved":
      // The source text the import kept is what the spreadsheet held there.
      return text(value.sourceText);
    case "error":
      return ERROR_CODES.has(value.code) ? err(value.code) : err("#VALUE!");
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

function toResult(value: ValueV1): EvaluationResultV1 {
  switch (value.t) {
    case "array":
      return { kind: "error", code: "#VALUE!" };
    case "num":
      return { kind: "ok", value: { kind: "decimal", decimal: formatDecimal(value.d) } };
    case "date":
      return { kind: "ok", value: { kind: "date", epochDay: value.day } };
    case "text":
      return { kind: "ok", value: { kind: "text", text: value.s.normalize("NFC") } };
    case "bool":
      return { kind: "ok", value: { kind: "boolean", boolean: value.b } };
    case "empty":
      return { kind: "empty" };
    case "err":
      return { kind: "error", code: value.code };
    case "enum":
      return { kind: "ok", value: { kind: "enum", optionId: value.optionId } };
    case "ref":
      return { kind: "ok", value: { kind: "reference", recordId: value.recordId } };
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

const REFERENCE_KINDS = new Set<FormulaIRV1["kind"]>(["field", "column", "related", "formula"]);

class Interpreter implements CallContextV1 {
  private steps = 0;
  private depth = 0;
  readonly clock: CallContextV1["clock"];

  constructor(
    private readonly env: EvaluationEnvV1,
    private readonly row: RowAccessV1 | null,
    readonly entropy: DomainEntropy | null,
  ) {
    this.clock = env.clock;
  }

  scalar(node: FormulaIRV1 | null): ScalarV1 {
    if (node === null) return EMPTY;
    const value = this.value(node);
    return value.t === "array" ? err("#VALUE!") : value;
  }

  items(node: FormulaIRV1 | null): readonly ScalarV1[] {
    if (node === null) return [EMPTY];
    const value = this.value(node);
    return value.t === "array" ? value.items : [value];
  }

  isReference(node: FormulaIRV1 | null): boolean {
    return node !== null && REFERENCE_KINDS.has(node.kind);
  }

  value(node: FormulaIRV1): ValueV1 {
    this.steps += 1;
    this.depth += 1;
    try {
      if (this.steps > (this.env.budget ?? DEFAULT_EVALUATION_BUDGET) || this.depth > MAX_EVALUATION_DEPTH) {
        throw new BudgetExceeded();
      }
      return this.visit(node);
    } finally {
      this.depth -= 1;
    }
  }

  private visit(node: FormulaIRV1): ValueV1 {
    switch (node.kind) {
      case "literal": {
        const literal = node.value;
        if (literal.kind === "decimal") {
          return isCanonicalDecimal(literal.decimal) ? num(parseDecimal(literal.decimal)) : err("#VALUE!");
        }
        return literal.kind === "text" ? text(literal.text) : bool(literal.boolean);
      }
      case "error":
        return ERROR_CODES.has(node.code) ? err(node.code) : err("#VALUE!");
      case "field":
        return this.row === null ? err("#REF!") : fromCell(this.row.valueOf(node.fieldId), this.env);
      case "column":
        return {
          t: "array",
          items: Array.from(this.env.columns.valuesOf(node.tableId, node.fieldId), (value) => fromCell(value, this.env)),
        };
      case "related": {
        if (this.row === null) return err("#REF!");
        const parent = this.env.relatedRow(node.relationshipId, this.row.recordId);
        return parent === null ? err("#N/A") : fromCell(parent.valueOf(node.fieldId), this.env);
      }
      case "formula": {
        const result = this.env.formulaResults(node.formulaId);
        switch (result.kind) {
          case "ok":
            return fromCell(result.value, this.env);
          case "empty":
            return EMPTY;
          case "error":
            return err(result.code);
          case "cycle":
            throw new CycleReached();
          case "unsupported":
            throw new UnsupportedEvaluation();
          default: {
            const unreachable: never = result;
            return unreachable;
          }
        }
      }
      case "unary":
        return this.unary(node.operator, this.scalar(node.operand));
      case "binary":
        return this.binary(node.operator, this.scalar(node.left), this.scalar(node.right));
      case "call": {
        const entry = catalogEntryOf(node.name);
        if (entry === undefined || entry.version !== node.version || entry.cost === "lookup") {
          throw new UnsupportedEvaluation();
        }
        if (entry.determinism === "nondeterministic" && this.entropy === null) throw new UnsupportedEvaluation();
        if (node.args.length < entry.minArgs || node.args.length > entry.maxArgs) return err("#VALUE!");
        return callBuiltin(entry.name, node.args, this);
      }
      default: {
        const unreachable: never = node;
        return unreachable;
      }
    }
  }

  private unary(operator: "+" | "-" | "%", operand: ScalarV1): ScalarV1 {
    if (operator === "+") return operand;
    const coerced = toNumber(operand);
    if (!coerced.ok) return coerced.error;
    return operator === "-" ? num(negateDecimal(coerced.value)) : numOrOverflow(divideDecimals(coerced.value, ONE_HUNDRED));
  }

  private binary(operator: Extract<FormulaIRV1, { kind: "binary" }>["operator"], left: ScalarV1, right: ScalarV1): ScalarV1 {
    switch (operator) {
      case "&": {
        const a = toText(left);
        if (!a.ok) return a.error;
        const b = toText(right);
        return b.ok ? text(`${a.value}${b.value}`) : b.error;
      }
      case "=":
      case "<>":
      case "<":
      case "<=":
      case ">":
      case ">=": {
        const compared = compareScalars(left, right);
        if (typeof compared !== "number") return compared;
        const holds = {
          "=": compared === 0,
          "<>": compared !== 0,
          "<": compared < 0,
          "<=": compared <= 0,
          ">": compared > 0,
          ">=": compared >= 0,
        }[operator];
        return bool(holds);
      }
      default:
        return this.arithmetic(operator, left, right);
    }
  }

  private arithmetic(operator: "+" | "-" | "*" | "/" | "^", left: ScalarV1, right: ScalarV1): ScalarV1 {
    if (left.t === "err") return left;
    if (right.t === "err") return right;
    const a = toNumber(left);
    if (!a.ok) return a.error;
    const b = toNumber(right);
    if (!b.ok) return b.error;
    // Date arithmetic: a date moved by whole days stays a date; two dates differ by days.
    const isDateShift = (date: ScalarV1, days: ScalarV1, amount: DecimalV1): boolean =>
      date.t === "date" && days.t !== "date" && isIntegral(amount);
    switch (operator) {
      case "+": {
        const total = addDecimals(a.value, b.value);
        if (total !== null && (isDateShift(left, right, b.value) || isDateShift(right, left, a.value))) {
          return dateOrOverflow(Number(integerPart(total)));
        }
        return numOrOverflow(total);
      }
      case "-": {
        const difference = subtractDecimals(a.value, b.value);
        if (difference !== null && isDateShift(left, right, b.value)) return dateOrOverflow(Number(integerPart(difference)));
        return numOrOverflow(difference);
      }
      case "*":
        return numOrOverflow(multiplyDecimals(a.value, b.value));
      case "/":
        return b.value.coefficient === 0n ? err("#DIV/0!") : numOrOverflow(divideDecimals(a.value, b.value));
      case "^":
        return power(a.value, b.value);
      default: {
        const unreachable: never = operator;
        return unreachable;
      }
    }
  }
}

function evaluateDocument(
  document: FormulaIRDocumentV1,
  row: RowAccessV1 | null,
  env: EvaluationEnvV1,
  entropy: DomainEntropy | null,
): EvaluationResultV1 {
  if ((document.irVersion as number) !== 1) return { kind: "unsupported" };
  try {
    return toResult(new Interpreter(env, row, entropy).value(document.root));
  } catch (caught) {
    if (caught instanceof BudgetExceeded) return { kind: "error", code: "#BUDGET" };
    if (caught instanceof CycleReached) return { kind: "cycle" };
    if (caught instanceof UnsupportedEvaluation) return { kind: "unsupported" };
    throw caught;
  }
}

/** A computed column's value for one record. */
export function evaluateRow(document: FormulaIRDocumentV1, row: RowAccessV1, env: EvaluationEnvV1): EvaluationResultV1 {
  return evaluateDocument(document, row, env, null);
}

/** A table metric: whole-column aggregates, no row. A `field` read is `#REF!`. */
export function evaluateAggregate(document: FormulaIRDocumentV1, env: EvaluationEnvV1): EvaluationResultV1 {
  return evaluateDocument(document, null, env, null);
}

/** A dashboard value: formulas, metrics and column aggregates, no row. */
export function evaluateScalar(document: FormulaIRDocumentV1, env: EvaluationEnvV1): EvaluationResultV1 {
  return evaluateDocument(document, null, env, null);
}

/**
 * The one evaluation a frozen (`RAND`-family) formula ever gets: S03's command
 * calls it with `EntropyPort` for a record created after import, and stores
 * the result as an authored literal with provenance (D51). Pass `row` for a
 * computed column.
 */
export function evaluateNondeterministicOnce(
  document: FormulaIRDocumentV1,
  entropy: DomainEntropy,
  env: EvaluationEnvV1,
  row: RowAccessV1 | null = null,
): EvaluationResultV1 {
  return evaluateDocument(document, row, env, entropy);
}
