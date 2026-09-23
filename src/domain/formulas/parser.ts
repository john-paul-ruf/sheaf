/**
 * `parseFormula` — formula text → {@link FormulaAstV1}, total (M03; D34).
 *
 * Precedence, lowest first: union `,` (inside parentheses only), comparisons,
 * `&`, `+ -`, `* /`, `^`, postfix `%`, unary `+ -`, space intersection, `:`
 * range. Binary operators associate left, as Excel's do (`2^3^2` is 64).
 * Excel places union above negation; Sheaf parses it lowest because it only
 * ever appears inside parentheses, where nothing else competes with it.
 *
 * Bounded by construction: text over {@link FORMULA_MAX_LENGTH} characters is
 * `too-long`, nesting (groups, calls, arrays, unary chains) over
 * {@link FORMULA_MAX_DEPTH} is `too-deep`, and neither is ever partially
 * parsed.
 */

import {
  FORMULA_MAX_DEPTH,
  FORMULA_MAX_LENGTH,
  type BinaryOperatorV1,
  type FormulaAstV1,
  type FormulaParseResultV1,
} from "./ast.js";
import { FormulaRefusal, tokenize, type FormulaTokenV1 } from "./lexer.js";

const COMPARISONS = new Set(["=", "<>", "<", "<=", ">", ">="]);
const FUTURE_PREFIX = /^((?:_xlfn\.|_xlws\.|_xludf\.)+)(.+)$/i;

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: readonly FormulaTokenV1[]) {}

  parse(): FormulaAstV1 {
    const ast = this.comparison();
    this.skipSpace();
    if (this.index < this.tokens.length) this.fail();
    return ast;
  }

  private fail(): never {
    throw new FormulaRefusal("syntax");
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > FORMULA_MAX_DEPTH) throw new FormulaRefusal("too-deep");
  }

  private leave(): void {
    this.depth -= 1;
  }

  private skipSpace(): void {
    while (this.tokens[this.index]?.kind === "space") this.index += 1;
  }

  private peek(): FormulaTokenV1 | undefined {
    this.skipSpace();
    return this.tokens[this.index];
  }

  private isOperator(token: FormulaTokenV1 | undefined, ...texts: string[]): boolean {
    return token?.kind === "operator" && texts.includes(token.text);
  }

  private isPunctuation(token: FormulaTokenV1 | undefined, text: string): boolean {
    return token?.kind === "punctuation" && token.text === text;
  }

  private binaryLevel(next: () => FormulaAstV1, accepts: (token: FormulaTokenV1 | undefined) => boolean): FormulaAstV1 {
    let left = next();
    for (let token = this.peek(); accepts(token); token = this.peek()) {
      this.index += 1;
      const operator = (token as { readonly text: string }).text as BinaryOperatorV1;
      left = { kind: "binary", operator, left, right: next() };
    }
    return left;
  }

  private union(): FormulaAstV1 {
    return this.binaryLevel(
      () => this.comparison(),
      (token) => this.isPunctuation(token, ","),
    );
  }

  private comparison(): FormulaAstV1 {
    return this.binaryLevel(
      () => this.concatenation(),
      (token) => token?.kind === "operator" && COMPARISONS.has(token.text),
    );
  }

  private concatenation(): FormulaAstV1 {
    return this.binaryLevel(() => this.additive(), (token) => this.isOperator(token, "&"));
  }

  private additive(): FormulaAstV1 {
    return this.binaryLevel(() => this.multiplicative(), (token) => this.isOperator(token, "+", "-"));
  }

  private multiplicative(): FormulaAstV1 {
    return this.binaryLevel(() => this.power(), (token) => this.isOperator(token, "*", "/"));
  }

  private power(): FormulaAstV1 {
    return this.binaryLevel(() => this.percent(), (token) => this.isOperator(token, "^"));
  }

  private percent(): FormulaAstV1 {
    let operand = this.unary();
    while (this.isOperator(this.peek(), "%")) {
      this.index += 1;
      operand = { kind: "percent", operand };
    }
    return operand;
  }

  private unary(): FormulaAstV1 {
    const token = this.peek();
    if (this.isOperator(token, "+", "-")) {
      this.index += 1;
      this.enter();
      const operand = this.unary();
      this.leave();
      return { kind: "unary", operator: (token as { readonly text: "+" | "-" }).text, operand };
    }
    return this.intersection();
  }

  /** A space is an operator only between two operands. */
  private intersection(): FormulaAstV1 {
    let left = this.range();
    for (;;) {
      if (this.tokens[this.index]?.kind !== "space") return left;
      let after = this.index;
      while (this.tokens[after]?.kind === "space") after += 1;
      const next = this.tokens[after];
      const startsOperand =
        next?.kind === "reference" || next?.kind === "identifier" || this.isPunctuation(next, "(");
      if (!startsOperand) return left;
      this.index = after;
      left = { kind: "binary", operator: " ", left, right: this.range() };
    }
  }

  private range(): FormulaAstV1 {
    let left = this.primary();
    while (this.isOperator(this.tokens[this.index], ":")) {
      this.index += 1;
      left = { kind: "binary", operator: ":", left, right: this.primary() };
    }
    return left;
  }

  private primary(): FormulaAstV1 {
    const token = this.peek();
    if (token === undefined) return this.fail();
    this.index += 1;
    switch (token.kind) {
      case "number":
        return { kind: "number", text: token.text };
      case "string":
        return { kind: "string", value: token.value };
      case "error":
        return { kind: "error", code: token.code };
      case "reference":
        return { kind: "reference", reference: token.reference };
      case "identifier":
        return this.identifier(token.text);
      case "punctuation":
        if (token.text === "(") return this.group();
        if (token.text === "{") return this.array();
        return this.fail();
      case "operator":
      case "space":
        return this.fail();
      default: {
        const unreachable: never = token;
        return unreachable;
      }
    }
  }

  private identifier(text: string): FormulaAstV1 {
    if (this.isPunctuation(this.tokens[this.index], "(")) {
      this.index += 1;
      return this.call(text);
    }
    const upper = text.toUpperCase();
    if (upper === "TRUE" || upper === "FALSE") return { kind: "boolean", value: upper === "TRUE" };
    return { kind: "reference", reference: { kind: "name", scope: null, name: text } };
  }

  private group(): FormulaAstV1 {
    this.enter();
    const expression = this.union();
    if (!this.isPunctuation(this.peek(), ")")) this.fail();
    this.index += 1;
    this.leave();
    return { kind: "group", expression };
  }

  private call(text: string): FormulaAstV1 {
    this.enter();
    const future = FUTURE_PREFIX.exec(text);
    const prefix = future === null ? null : (future[1] as string);
    const name = (future === null ? text : (future[2] as string)).toUpperCase();
    const args: (FormulaAstV1 | null)[] = [];
    if (this.isPunctuation(this.peek(), ")")) {
      this.index += 1;
    } else {
      for (;;) {
        const next = this.peek();
        args.push(this.isPunctuation(next, ",") || this.isPunctuation(next, ")") ? null : this.comparison());
        const separator = this.peek();
        this.index += 1;
        if (this.isPunctuation(separator, ")")) break;
        if (!this.isPunctuation(separator, ",")) this.fail();
      }
    }
    this.leave();
    return { kind: "call", name, prefix, args };
  }

  private constant(): FormulaAstV1 {
    const token = this.peek();
    if (this.isOperator(token, "+", "-")) {
      this.index += 1;
      const number = this.peek();
      if (number?.kind !== "number") return this.fail();
      this.index += 1;
      return {
        kind: "unary",
        operator: (token as { readonly text: "+" | "-" }).text,
        operand: { kind: "number", text: number.text },
      };
    }
    if (token?.kind === "number" || token?.kind === "string" || token?.kind === "error") {
      return this.primary();
    }
    if (token?.kind === "identifier" && /^(TRUE|FALSE)$/i.test(token.text)) {
      this.index += 1;
      return { kind: "boolean", value: token.text.toUpperCase() === "TRUE" };
    }
    return this.fail();
  }

  private array(): FormulaAstV1 {
    this.enter();
    const rows: FormulaAstV1[][] = [[]];
    for (;;) {
      (rows.at(-1) as FormulaAstV1[]).push(this.constant());
      const separator = this.peek();
      this.index += 1;
      if (this.isPunctuation(separator, "}")) break;
      if (this.isPunctuation(separator, ";")) rows.push([]);
      else if (!this.isPunctuation(separator, ",")) this.fail();
    }
    this.leave();
    return { kind: "array", rows };
  }
}

/**
 * Parses one formula, with or without its leading `=`. Never throws, never
 * returns a partial tree.
 */
export function parseFormula(text: string): FormulaParseResultV1 {
  if (text.length > FORMULA_MAX_LENGTH) return { kind: "unparsed", reason: "too-long" };
  const body = text.startsWith("=") ? text.slice(1) : text;
  try {
    const tokens = tokenize(body);
    if (tokens.every((token) => token.kind === "space")) return { kind: "unparsed", reason: "syntax" };
    return { kind: "parsed", ast: new Parser(tokens).parse() };
  } catch (error) {
    return { kind: "unparsed", reason: error instanceof FormulaRefusal ? error.reason : "syntax" };
  }
}
