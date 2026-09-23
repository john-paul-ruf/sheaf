/**
 * The structure column's view models (M37; SCR-035, SHT-014, MOD-014,
 * MOD-015, SCR-037 — CAP-35, CAP-36, CA-27, CA-28).
 *
 * Everything here is built from what S03's `getAppStructure` answers, and
 * nothing is said that the read does not carry: the read holds no count of
 * records per choice, no inference evidence for a field's type, and no
 * failing count for a rule already saved, so none of those is drawn. The one
 * "Why Sheaf chose this" the read does support is a connection's detection
 * source, and that is said.
 *
 * A formula is shown as the worker rendered it in the app's current names
 * (D58); a rule as a sentence from its structured clause (D52). Neither is
 * evaluated or parsed here.
 */

import type {
  AppStructureViewV1,
  CellWireValueV1,
  FieldTypeWireV1,
  RuleConditionWireV1,
  StructureFieldViewV1,
  StructureFormulaViewV1,
  StructureRelationshipViewV1,
  StructureRuleViewV1,
  StructureTableViewV1,
} from "../../workers/protocol/messages.js";

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}

// --- field types in user words (schema.html) --------------------------------

/** schema.html's "What kind of information?" choices, in a person's words. */
const TYPE_LABEL: Readonly<Record<FieldTypeWireV1["kind"], string>> = Object.freeze({
  text: "Text",
  number: "Number",
  currency: "Money",
  date: "Date",
  boolean: "Yes or no",
  enum: "Choice list",
  phone: "Phone number",
  email: "Email address",
  url: "Web address",
  address: "Address",
  reference: "Connection to another table",
});

/** The field list's short tag (schema.html: "Text", "Choice", "Connection", "Live"). */
const TYPE_SHORT: Readonly<Record<FieldTypeWireV1["kind"], string>> = Object.freeze({
  text: "Text",
  number: "Number",
  currency: "Money",
  date: "Date",
  boolean: "Yes or no",
  enum: "Choice",
  phone: "Phone",
  email: "Email",
  url: "Web address",
  address: "Address",
  reference: "Connection",
});

export function typeLabel(type: FieldTypeWireV1): string {
  return type.kind === "currency" ? `${TYPE_LABEL.currency} (${type.currencyCode})` : TYPE_LABEL[type.kind];
}

/** A calculation's kind of result, as its badge says it (CA-26's badges). */
const DISPOSITION_BADGE: Readonly<Record<StructureFormulaViewV1["disposition"], string>> = Object.freeze({
  live: "Computed · not typed",
  frozen: "Frozen at import",
  unsupported: "Unsupported formula",
});

const DISPOSITION_SHORT: Readonly<Record<StructureFormulaViewV1["disposition"], string>> = Object.freeze({
  live: "Live",
  frozen: "Frozen",
  unsupported: "Unsupported",
});

// --- rules as sentences (D52) -----------------------------------------------

type CompareOp = Extract<RuleConditionWireV1, { kind: "compare" }>["op"];

/** Operator words by the kind of value compared: a date is before, a number less than. */
const COMPARE_WORDS: Readonly<Record<"date" | "number" | "text", Readonly<Record<CompareOp, string>>>> = Object.freeze({
  date: { lt: "is before", le: "is on or before", gt: "is after", ge: "is on or after", eq: "is", ne: "is not" },
  number: { lt: "is less than", le: "is at most", gt: "is greater than", ge: "is at least", eq: "is", ne: "is not" },
  text: { lt: "comes before", le: "is or comes before", gt: "comes after", ge: "is or comes after", eq: "is", ne: "is not" },
});

const MS_PER_DAY = 86_400_000;

/** A date crosses as an epoch day and is said as its ISO day: no locale here (M37). */
function isoDay(epochDay: number): string {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

function orderKindOf(type: FieldTypeWireV1 | undefined): "date" | "number" | "text" {
  if (type?.kind === "date") return "date";
  if (type?.kind === "number" || type?.kind === "currency") return "number";
  return "text";
}

/** Names and types the sentences need: every field of the app, by id. */
interface FieldLookup {
  readonly name: (fieldId: string) => string;
  readonly field: (fieldId: string) => StructureFieldViewV1 | undefined;
}

function lookupOf(structure: AppStructureViewV1): FieldLookup {
  const fields = new Map(structure.tables.flatMap((table) => table.fields.map((field) => [field.fieldId, field] as const)));
  return {
    name: (fieldId) => fields.get(fieldId)?.displayName ?? "a removed field",
    field: (fieldId) => fields.get(fieldId),
  };
}

function describeRuleValue(value: CellWireValueV1, field: StructureFieldViewV1 | undefined): string {
  switch (value.kind) {
    case "text":
      return `“${value.text}”`;
    case "number":
      return value.decimal;
    case "boolean":
      return value.boolean ? "yes" : "no";
    case "option":
      return `“${field?.enumOptions.find((option) => option.optionId === value.optionId)?.label ?? "a removed choice"}”`;
    case "date":
      return isoDay(value.epochDay);
    case "blank":
    case "missing":
      return "empty";
    case "invalid":
      return `“${value.sourceText}”`;
    case "reference":
      return "a related record";
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

/** One structured clause, said in the app's current names. */
export function describeRuleCondition(condition: RuleConditionWireV1, lookup: FieldLookup): string {
  switch (condition.kind) {
    case "field-present":
      return `${lookup.name(condition.fieldId)} has a value`;
    case "field-absent":
      return `${lookup.name(condition.fieldId)} is empty`;
    case "field-equals":
      return `${lookup.name(condition.fieldId)} is ${describeRuleValue(condition.value, lookup.field(condition.fieldId))}`;
    case "all":
    case "any":
      return condition.conditions
        .map((inner) => describeRuleCondition(inner, lookup))
        .join(condition.kind === "all" ? " and " : " or ");
    case "not":
      return `it is not true that ${describeRuleCondition(condition.condition, lookup)}`;
    case "compare": {
      const left = lookup.field(condition.left);
      const subject =
        condition.measure === "text-length" ? `The length of ${lookup.name(condition.left)}` : lookup.name(condition.left);
      const words = COMPARE_WORDS[condition.measure === "text-length" ? "number" : orderKindOf(left?.type)][condition.op];
      const right =
        "field" in condition.right
          ? lookup.name(condition.right.field)
          : describeRuleValue(condition.right.value, left);
      return `${subject} ${words} ${right}`;
    }
    case "between":
    case "not-between": {
      const field = lookup.field(condition.fieldId);
      const subject =
        condition.measure === "text-length" ? `The length of ${lookup.name(condition.fieldId)}` : lookup.name(condition.fieldId);
      return `${subject} ${condition.kind === "between" ? "is" : "is not"} between ${describeRuleValue(condition.low, field)} and ${describeRuleValue(condition.high, field)}`;
    }
    default: {
      const unreachable: never = condition;
      return unreachable;
    }
  }
}

// --- SCR-035 app structure (schema.html) ------------------------------------

export interface StructureTableRowVm {
  readonly tableId: string;
  readonly name: string;
  /** "12 fields" — the fields a record shows now, removed ones not counted. */
  readonly fieldCountLabel: string;
  readonly isSelected: boolean;
}

export interface StructureFieldRowVm {
  readonly fieldId: string;
  readonly name: string;
  /** schema.html's tag: "Text", "Choice", "Connection", "Live"… */
  readonly tag: string;
  /** A removed field keeps its values (D57) and says so. */
  readonly isActive: boolean;
  readonly isSelected: boolean;
}

export interface StructureOptionVm {
  readonly optionId: string;
  readonly label: string;
  readonly isActive: boolean;
}

export interface StructureConnectionVm {
  readonly relationshipId: string;
  readonly toTableId: string;
  readonly toTableName: string;
  readonly isActive: boolean;
  /** "Why Sheaf chose this": null when the person made the connection. */
  readonly evidence: string | null;
}

export interface StructureCalculationVm {
  readonly formulaId: string;
  readonly target: StructureFormulaViewV1["target"]["kind"];
  /** A computed column's field name, or a metric's own name. */
  readonly name: string;
  /** The expression in the app's current names (D58). */
  readonly text: string;
  readonly disposition: StructureFormulaViewV1["disposition"];
  readonly badge: string;
  readonly tableId: string | null;
  readonly fieldId: string | null;
}

export interface StructureFieldVm {
  readonly fieldId: string;
  readonly tableId: string;
  readonly name: string;
  /** schema.html's eyebrow: "Jobs · Field 2 of 12". */
  readonly position: string;
  readonly type: FieldTypeWireV1;
  readonly typeLabel: string;
  readonly isRequired: boolean;
  readonly isActive: boolean;
  readonly isKey: boolean;
  readonly isLabel: boolean;
  /** Present for a computed field: its calculation, rendered (D51). */
  readonly calculation: StructureCalculationVm | null;
  readonly options: readonly StructureOptionVm[];
  /** The connection this field is the source of, if any. */
  readonly connection: StructureConnectionVm | null;
}

export interface StructureRuleVm {
  readonly ruleId: string;
  readonly name: string;
  readonly sentence: string;
  readonly severity: StructureRuleViewV1["severity"];
  readonly severityNote: string;
  /** The editor builds one field-to-field-or-value clause (D52); other shapes can only be removed. */
  readonly isEditable: boolean;
  readonly condition: RuleConditionWireV1;
}

export interface StructureTableVm {
  readonly tableId: string;
  readonly name: string;
  readonly recordCount: number;
  readonly keyFieldId: string | null;
  readonly labelFieldId: string | null;
  readonly fields: readonly StructureFieldRowVm[];
  readonly rules: readonly StructureRuleVm[];
  readonly metrics: readonly StructureCalculationVm[];
}

export interface StructureVm {
  readonly appId: string;
  readonly appName: string;
  readonly schemaRevision: number;
  readonly tables: readonly StructureTableRowVm[];
  readonly table: StructureTableVm | null;
  readonly field: StructureFieldVm | null;
  readonly dashboardValues: readonly StructureCalculationVm[];
}

export interface StructureSelection {
  readonly tableId: string | null;
  readonly fieldId: string | null;
}

const EVIDENCE: Readonly<Record<StructureRelationshipViewV1["detectionSource"], ((toTable: string) => string) | null>> =
  Object.freeze({
    declared: (toTable: string) => `The workbook declared this connection to ${toTable}.`,
    "lookup-formula": (toTable: string) => `A lookup formula in the workbook read ${toTable} through this field.`,
    "key-match": (toTable: string) => `This field's values match the key of ${toTable}.`,
    user: null,
  });

const SEVERITY_NOTE: Readonly<Record<StructureRuleViewV1["severity"], string>> = Object.freeze({
  blocking: "A save that breaks this rule is refused.",
  warning: "A record that breaks this rule is flagged.",
});

function byOrdinal<T extends { readonly tableOrdinal: number } | { readonly fieldOrdinal: number }>(items: readonly T[]): T[] {
  const ordinal = (item: T): number => ("tableOrdinal" in item ? item.tableOrdinal : item.fieldOrdinal);
  return [...items].sort((left, right) => ordinal(left) - ordinal(right));
}

function calculationOf(formula: StructureFormulaViewV1, lookup: FieldLookup): StructureCalculationVm {
  const target = formula.target;
  return {
    formulaId: formula.formulaId,
    target: target.kind,
    name: target.kind === "computed-column" ? lookup.name(target.fieldId) : (formula.displayName ?? formula.text),
    text: formula.text,
    disposition: formula.disposition,
    badge: DISPOSITION_BADGE[formula.disposition],
    tableId: target.tableId,
    fieldId: target.kind === "computed-column" ? target.fieldId : null,
  };
}

function ruleOf(rule: StructureRuleViewV1, lookup: FieldLookup): StructureRuleVm {
  return {
    ruleId: rule.ruleId,
    name: rule.displayName,
    sentence: describeRuleCondition(rule.condition, lookup),
    severity: rule.severity,
    severityNote: SEVERITY_NOTE[rule.severity],
    isEditable: rule.condition.kind === "compare" && rule.condition.measure === undefined,
    condition: rule.condition,
  };
}

function connectionOf(relationship: StructureRelationshipViewV1): StructureConnectionVm {
  return {
    relationshipId: relationship.relationshipId,
    toTableId: relationship.toTableId,
    toTableName: relationship.toTableName,
    isActive: relationship.isActive,
    evidence: EVIDENCE[relationship.detectionSource]?.(relationship.toTableName) ?? null,
  };
}

function fieldTag(field: StructureFieldViewV1, calculation: StructureCalculationVm | undefined): string {
  if (calculation !== undefined) return DISPOSITION_SHORT[calculation.disposition];
  return TYPE_SHORT[field.type.kind];
}

/**
 * SCR-035 over one read. The selection is the person's; where it names
 * nothing the app holds (a table renamed away, a first visit), the first table
 * and its first field are shown rather than an empty pane.
 */
export function selectStructureVm(structure: AppStructureViewV1, selection: StructureSelection): StructureVm {
  const lookup = lookupOf(structure);
  const tables = byOrdinal(structure.tables);
  const current: StructureTableViewV1 | undefined =
    tables.find((table) => table.tableId === selection.tableId) ?? tables[0];
  const activeFormulas = structure.formulas.filter((formula) => formula.isActive);
  const calculations = new Map(
    activeFormulas.flatMap((formula) =>
      formula.target.kind === "computed-column" ? [[formula.target.fieldId, calculationOf(formula, lookup)] as const] : [],
    ),
  );

  const fields = current === undefined ? [] : byOrdinal(current.fields);
  const activeFields = fields.filter((field) => field.isActive);
  const selectedField =
    fields.find((field) => field.fieldId === selection.fieldId) ?? activeFields[0] ?? fields[0];

  const table: StructureTableVm | null =
    current === undefined
      ? null
      : {
          tableId: current.tableId,
          name: current.displayName,
          recordCount: current.recordCount,
          keyFieldId: current.keyFieldId,
          labelFieldId: current.labelFieldId,
          fields: fields.map((field) => ({
            fieldId: field.fieldId,
            name: field.displayName,
            tag: fieldTag(field, calculations.get(field.fieldId)),
            isActive: field.isActive,
            isSelected: field.fieldId === selectedField?.fieldId,
          })),
          rules: current.rules.map((rule) => ruleOf(rule, lookup)),
          metrics: activeFormulas
            .filter((formula) => formula.target.kind === "table-metric" && formula.target.tableId === current.tableId)
            .map((formula) => calculationOf(formula, lookup)),
        };

  const field: StructureFieldVm | null =
    current === undefined || selectedField === undefined
      ? null
      : {
          fieldId: selectedField.fieldId,
          tableId: current.tableId,
          name: selectedField.displayName,
          position: selectedField.isActive
            ? `${current.displayName} · Field ${String(activeFields.indexOf(selectedField) + 1)} of ${String(activeFields.length)}`
            : `${current.displayName} · Removed field`,
          type: selectedField.type,
          typeLabel: typeLabel(selectedField.type),
          isRequired: selectedField.isRequired,
          isActive: selectedField.isActive,
          isKey: current.keyFieldId === selectedField.fieldId,
          isLabel: current.labelFieldId === selectedField.fieldId,
          calculation: calculations.get(selectedField.fieldId) ?? null,
          options: [...selectedField.enumOptions]
            .sort((left, right) => left.optionOrdinal - right.optionOrdinal)
            .map((option) => ({ optionId: option.optionId, label: option.label, isActive: option.isActive })),
          connection: (() => {
            const relationship = structure.relationships.find((candidate) => candidate.fromFieldId === selectedField.fieldId);
            return relationship === undefined ? null : connectionOf(relationship);
          })(),
        };

  return {
    appId: structure.appId,
    appName: structure.displayName,
    schemaRevision: structure.schemaRevision,
    tables: tables.map((candidate) => ({
      tableId: candidate.tableId,
      name: candidate.displayName,
      fieldCountLabel: plural(candidate.fields.filter((entry) => entry.isActive).length, "field", "fields"),
      isSelected: candidate.tableId === current?.tableId,
    })),
    table,
    field,
    dashboardValues: activeFormulas
      .filter((formula) => formula.target.kind === "dashboard-value")
      .map((formula) => calculationOf(formula, lookup)),
  };
}
