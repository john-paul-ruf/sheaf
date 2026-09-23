/**
 * The spreadsheet-level declarations of an ODS `content.xml` (M18).
 *
 * ODS states some of a sheet's structure outside the sheet: content
 * validations are declared once before the tables and referenced by name from
 * cells; database ranges (Excel's declared tables) and named ranges follow
 * the last table; automatic styles precede the body. A fact stream is scoped
 * positionally (a `sheet` fact opens a sheet), so the adapter reads these in
 * one pass over the part before it streams the selected sheets — a parse-time
 * read of `content.xml`, never pre-flight's.
 */

import type {
  DefinedNameSummaryV1,
  RangeV1,
  ValidationListSourceV1,
  ValidationOperatorV1,
  ValidationRuleV1,
} from "../../facts/index.js";
import { BoundExceededError, CONTAINER_BOUNDS_V1 } from "../../source/bounds.js";
import { tokenizeXml } from "../../source/xml.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import { convertOpenFormula } from "./formula.js";
import type { createStyleCollector, OdsStyleSheetV1 } from "./styles.js";
import {
  attr,
  CONTENT_PART,
  OFFICE_NS,
  odfAddressToExcel,
  odfAddressToRange,
  SCRIPT_NS,
  TABLE_NS,
} from "./vocabulary.js";

export type ValidationDeclarationV1 =
  | {
      readonly kind: "rule";
      readonly rule: ValidationRuleV1;
      readonly operator: ValidationOperatorV1 | null;
      readonly listSource: ValidationListSourceV1 | null;
      readonly formula1: string | null;
      readonly formula2: string | null;
    }
  | { readonly kind: "unsupported" };

export interface DatabaseRangeV1 {
  readonly name: string;
  readonly sheetName: string;
  readonly range: RangeV1;
  readonly headerRowCount: number;
}

export interface OdsTableV1 {
  readonly name: string;
  readonly isHidden: boolean;
}

export interface OdsDeclarationsV1 {
  /** Content order: index = the sheet's workbook index. */
  readonly tables: readonly OdsTableV1[];
  readonly validations: ReadonlyMap<string, ValidationDeclarationV1>;
  readonly definedNames: readonly DefinedNameSummaryV1[];
  readonly databaseRanges: readonly DatabaseRangeV1[];
  readonly styles: OdsStyleSheetV1;
  /** Script event listeners bound outside any sheet. */
  readonly documentScripts: number;
  /** DDE links: live connections to other applications. */
  readonly documentConnections: number;
}

const UNSUPPORTED: ValidationDeclarationV1 = Object.freeze({ kind: "unsupported" });

const OPERATORS: ReadonlyMap<string, ValidationOperatorV1> = new Map([
  ["<=", "less-than-or-equal"],
  [">=", "greater-than-or-equal"],
  ["!=", "not-equal"],
  ["<>", "not-equal"],
  ["<", "less-than"],
  [">", "greater-than"],
  ["=", "equal"],
]);

const TYPE_RULES: ReadonlyMap<string, ValidationRuleV1> = new Map([
  ["whole-number", "whole"],
  ["decimal-number", "decimal"],
  ["date", "date"],
  ["time", "time"],
]);

/** Splits OpenFormula arguments on `;` outside strings and references. */
const splitArguments = (text: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;
  for (const character of text) {
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
    } else if (character === ";" && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current.trim());
  return parts;
};

const expressionOf = (text: string): string | null => convertOpenFormula(`of:=${text}`).text;

const constraintOf = (
  subject: string,
  constraint: string,
): { operator: ValidationOperatorV1; formula1: string; formula2: string | null } | null => {
  const between = new RegExp(`^${subject}-is-(not-)?between\\((.*)\\)$`, "s").exec(constraint);
  if (between !== null) {
    const [low, high, extra] = splitArguments(between[2] as string);
    const formula1 = low === undefined ? null : expressionOf(low);
    const formula2 = high === undefined ? null : expressionOf(high);
    if (formula1 === null || formula2 === null || extra !== undefined) return null;
    return { operator: between[1] === undefined ? "between" : "not-between", formula1, formula2 };
  }
  const compare = new RegExp(`^${subject}\\(\\)\\s*(<=|>=|!=|<>|<|>|=)\\s*(.+)$`, "s").exec(constraint);
  const operator = compare === null ? undefined : OPERATORS.get(compare[1] as string);
  const formula1 = compare === null ? null : expressionOf(compare[2] as string);
  return operator === undefined || formula1 === null ? null : { operator, formula1, formula2: null };
};

/** An inline list's members: quoted strings (`""` escapes a quote) or numbers. */
const inlineMembers = (args: string): string[] | null => {
  const members: string[] = [];
  for (const argument of splitArguments(args)) {
    const quoted = /^"((?:[^"]|"")*)"$/s.exec(argument);
    if (quoted !== null) members.push((quoted[1] as string).replace(/""/g, '"').normalize("NFC"));
    else if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(argument)) members.push(argument);
    else return null;
  }
  return members;
};

/**
 * An ODF `table:condition` as a validation rule, or `unsupported` when it is
 * not one of the forms Excel's rule model states (the cell then keeps an
 * `unsupported-validation` preserved part instead).
 */
export function parseValidationCondition(condition: string): ValidationDeclarationV1 {
  const body = condition.trim().replace(/^[A-Za-z][\w-]*:(?!=)/, "");
  const list = /^cell-content-is-in-list\((.*)\)$/s.exec(body);
  if (list !== null) {
    const args = (list[1] as string).trim();
    if (args.startsWith("[")) {
      const ref = expressionOf(args);
      return ref === null
        ? UNSUPPORTED
        : { kind: "rule", rule: "list", operator: null, listSource: { kind: "range", ref }, formula1: ref, formula2: null };
    }
    const members = inlineMembers(args);
    return members === null
      ? UNSUPPORTED
      : {
          kind: "rule",
          rule: "list",
          operator: null,
          listSource: { kind: "inline", values: members },
          formula1: `"${members.map((member) => member.replace(/"/g, '""')).join(",")}"`,
          formula2: null,
        };
  }
  const typed = /^cell-content-is-([a-z-]+)\(\)\s+and\s+(.+)$/s.exec(body);
  const rule = typed === null ? undefined : TYPE_RULES.get(typed[1] as string);
  if (typed !== null && rule !== undefined) {
    const constraint = constraintOf("cell-content", (typed[2] as string).trim());
    return constraint === null ? UNSUPPORTED : { kind: "rule", rule, listSource: null, ...constraint };
  }
  if (body.startsWith("cell-content-text-length")) {
    const constraint = constraintOf("cell-content-text-length", body);
    return constraint === null ? UNSUPPORTED : { kind: "rule", rule: "text-length", listSource: null, ...constraint };
  }
  const custom = /^is-true-formula\((.*)\)$/s.exec(body);
  const formula1 = custom === null ? null : expressionOf(custom[1] as string);
  return formula1 === null
    ? UNSUPPORTED
    : { kind: "rule", rule: "custom", operator: null, listSource: null, formula1, formula2: null };
}

/** Database ranges LibreOffice creates for an unnamed autofilter. */
const ANONYMOUS_RANGE = /^__Anonymous_Sheet_DB__\d+$/;

/**
 * Reads the declarations. `collector` already holds `styles.xml`'s styles;
 * `content.xml`'s automatic styles are added to it.
 */
export async function readDeclarations(
  zip: ZipContainerHandleV1,
  collector: ReturnType<typeof createStyleCollector>,
): Promise<OdsDeclarationsV1> {
  const tables: { name: string; styleName: string | null }[] = [];
  const validations = new Map<string, ValidationDeclarationV1>();
  const definedNames: DefinedNameSummaryV1[] = [];
  const databaseRanges: DatabaseRangeV1[] = [];
  let isInBody = false;
  let depth = 0;
  let spreadsheetDepth: number | null = null;
  let tableDepth: number | null = null;
  let documentScripts = 0;
  let documentConnections = 0;

  const bounded = <T>(list: T[], item: T): void => {
    if (list.length >= CONTAINER_BOUNDS_V1.maxZipEntries) throw new BoundExceededError("expansion-limit");
    list.push(item);
  };

  for await (const event of tokenizeXml(zip.streamEntry(CONTENT_PART))) {
    if (event.kind === "start") depth += 1;
    if (!isInBody) {
      if (event.kind === "start" && event.uri === OFFICE_NS && event.local === "body") isInBody = true;
      else collector.accept(event);
      if (event.kind === "end") depth -= 1;
      continue;
    }
    if (event.kind === "end") {
      if (depth === tableDepth) tableDepth = null;
      depth -= 1;
      continue;
    }
    if (event.kind !== "start") continue;
    if (event.uri === OFFICE_NS && event.local === "spreadsheet") spreadsheetDepth ??= depth;
    if (event.uri === SCRIPT_NS && event.local === "event-listener" && tableDepth === null) documentScripts += 1;
    if (event.uri !== TABLE_NS) continue;
    switch (event.local) {
      case "table":
        if (tableDepth === null && spreadsheetDepth !== null && depth === spreadsheetDepth + 1) {
          tableDepth = depth;
          bounded(tables, {
            name: (attr(event, TABLE_NS, "name") ?? "").normalize("NFC"),
            styleName: attr(event, TABLE_NS, "style-name"),
          });
        }
        break;
      case "content-validation": {
        const name = attr(event, TABLE_NS, "name");
        const condition = attr(event, TABLE_NS, "condition");
        if (name !== null && validations.size < CONTAINER_BOUNDS_V1.maxZipEntries) {
          validations.set(name, condition === null ? UNSUPPORTED : parseValidationCondition(condition));
        }
        break;
      }
      case "named-range":
      case "named-expression": {
        const name = attr(event, TABLE_NS, "name");
        const raw =
          event.local === "named-range" ? attr(event, TABLE_NS, "cell-range-address") : attr(event, TABLE_NS, "expression");
        if (name === null || raw === null) break;
        const ref = event.local === "named-range" ? odfAddressToExcel(raw)?.text : convertOpenFormula(raw).text;
        bounded(definedNames, {
          name: name.normalize("NFC"),
          ref: (ref ?? raw).normalize("NFC"),
          sheetIndex: tableDepth === null ? null : tables.length - 1,
        });
        break;
      }
      case "database-range": {
        const name = attr(event, TABLE_NS, "name") ?? "";
        const target = odfAddressToRange(attr(event, TABLE_NS, "target-range-address") ?? "");
        if (ANONYMOUS_RANGE.test(name) || target === null || target.sheet === null) break;
        bounded(databaseRanges, {
          name: name.normalize("NFC"),
          sheetName: target.sheet.normalize("NFC"),
          range: target.range,
          headerRowCount: attr(event, TABLE_NS, "contains-header") === "false" ? 0 : 1,
        });
        break;
      }
      case "dde-link":
        documentConnections += 1;
        break;
    }
  }

  const styles = collector.sheet();
  return {
    tables: tables.map(({ name, styleName }) => ({
      name,
      isHidden: styleName !== null && styles.hiddenTableStyles.has(styleName),
    })),
    validations,
    definedNames,
    databaseRanges,
    styles,
    documentScripts,
    documentConnections,
  };
}
