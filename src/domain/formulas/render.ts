/**
 * IR → D58 formula text, from current names (M03; D58). A rename never breaks
 * a formula: the IR holds IDs, and this prints whatever the IDs are called
 * now. Parentheses are added exactly where precedence needs them, so for any
 * IR the authored grammar can express, `translateAuthored(renderFormula(ir))`
 * reads back the same IR.
 */

import type { FieldId, FormulaId, TableId } from "../model/ids.js";
import type { FormulaIRDocumentV1, FormulaIRV1 } from "./ir.js";

/** Current display names, by stable ID. */
export interface NameLookupV1 {
  fieldName(fieldId: FieldId): string;
  tableName(tableId: TableId): string;
  formulaName(formulaId: FormulaId): string;
}

const COMPARISON = 1;
const CONCATENATION = 2;
const ADDITIVE = 3;
const MULTIPLICATIVE = 4;
const POWER = 5;
const PERCENT = 6;
const PREFIX = 7;
const ATOM = 8;

const PRECEDENCE: Readonly<Record<string, number>> = {
  "=": COMPARISON,
  "<>": COMPARISON,
  "<": COMPARISON,
  "<=": COMPARISON,
  ">": COMPARISON,
  ">=": COMPARISON,
  "&": CONCATENATION,
  "+": ADDITIVE,
  "-": ADDITIVE,
  "*": MULTIPLICATIVE,
  "/": MULTIPLICATIVE,
  "^": POWER,
};

/** A field or formula name inside `[…]`, with `'` escaping the lexer's specials. */
const bracketed = (name: string): string => `[${name.replace(/['[\]#@]/g, "'$&")}]`;

/**
 * How a table's display name is spelled before `[` — an identifier, as a
 * spreadsheet table name is: anything else becomes `_`. An authored resolver
 * matches `Table[…]` against this spelling.
 */
export function formulaTableName(displayName: string): string {
  const identifier = displayName.replace(/[^A-Za-z0-9_.¡-￿]/g, "_");
  return /^[A-Za-z_¡-￿]/.test(identifier) ? identifier : `_${identifier}`;
}

interface Rendered {
  readonly text: string;
  readonly precedence: number;
}

const wrap = (rendered: Rendered, minimum: number): string =>
  rendered.precedence < minimum ? `(${rendered.text})` : rendered.text;

function render(node: FormulaIRV1, names: NameLookupV1): Rendered {
  const next = (child: FormulaIRV1): Rendered => render(child, names);
  switch (node.kind) {
    case "literal": {
      const value = node.value;
      switch (value.kind) {
        case "decimal":
          return { text: value.decimal, precedence: value.decimal.startsWith("-") ? PREFIX : ATOM };
        case "text":
          return { text: `"${value.text.replace(/"/g, '""')}"`, precedence: ATOM };
        case "boolean":
          return { text: value.boolean ? "TRUE" : "FALSE", precedence: ATOM };
        default: {
          const unreachable: never = value;
          return unreachable;
        }
      }
    }
    case "error":
      return { text: node.code, precedence: ATOM };
    case "field":
      return { text: bracketed(names.fieldName(node.fieldId)), precedence: ATOM };
    case "column":
      return {
        text: `${formulaTableName(names.tableName(node.tableId))}${bracketed(names.fieldName(node.fieldId))}`,
        precedence: ATOM,
      };
    case "related":
      return {
        text: `RELATED(${bracketed(names.fieldName(node.referenceFieldId))},${bracketed(names.fieldName(node.fieldId))})`,
        precedence: ATOM,
      };
    case "formula":
      return { text: bracketed(names.formulaName(node.formulaId)), precedence: ATOM };
    case "unary":
      return node.operator === "%"
        ? { text: `${wrap(next(node.operand), PERCENT)}%`, precedence: PERCENT }
        : { text: `${node.operator}${wrap(next(node.operand), PREFIX)}`, precedence: PREFIX };
    case "binary": {
      const precedence = PRECEDENCE[node.operator] ?? COMPARISON;
      return {
        text: `${wrap(next(node.left), precedence)}${node.operator}${wrap(next(node.right), precedence + 1)}`,
        precedence,
      };
    }
    case "call":
      return {
        text: `${node.name}(${node.args.map((argument) => (argument === null ? "" : next(argument).text)).join(",")})`,
        precedence: ATOM,
      };
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

/** The formula as a person reads and edits it, without a leading `=`. */
export function renderFormula(document: FormulaIRDocumentV1, names: NameLookupV1): string {
  return render(document.root, names).text;
}
