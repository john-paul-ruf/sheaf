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
  ImpactReportWireV1,
  RuleConditionWireV1,
  SchemaApplyOutcomeV1,
  SchemaChangeWireV1,
  SchemaPreviewViewV1,
  SchemaRefusalWireV1,
  StructureFieldViewV1,
  StructureFormulaViewV1,
  StructureRelationshipViewV1,
  StructureRuleViewV1,
  StructureTableViewV1,
} from "../../workers/protocol/messages.js";

/** The wire shapes a structure surface names, by alias: `src/ui/**` never imports the protocol. */
export type SchemaChangeVm = SchemaChangeWireV1;
export type RuleConditionVm = RuleConditionWireV1;
export type FieldTypeKindVm = FieldTypeWireV1["kind"];

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

/** A structured clause as the rule list will say it, for the editor's live sentence. */
export function ruleSentence(structure: AppStructureViewV1, condition: RuleConditionWireV1): string {
  return describeRuleCondition(condition, lookupOf(structure));
}

// --- SCR-035 app structure (schema.html) ------------------------------------

export interface StructureTableRowVm {
  readonly tableId: string;
  readonly name: string;
  /** "12 fields" — the fields a record shows now, removed ones not counted. */
  readonly fieldCountLabel: string;
  readonly isSelected: boolean;
  /** A connection can point here only when the table has a key (D64). */
  readonly hasKey: boolean;
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
      hasKey: candidate.keyFieldId !== null,
    })),
    table,
    field,
    dashboardValues: activeFormulas
      .filter((formula) => formula.target.kind === "dashboard-value")
      .map((formula) => calculationOf(formula, lookup)),
  };
}

// --- editing: the choices an editor offers (CP2) ----------------------------

/** The kinds a field may be changed to here; a connection is made by the connection editor (D64). */
export const CHANGEABLE_TYPES: readonly Exclude<FieldTypeWireV1, { kind: "currency" | "reference" }>[] = Object.freeze([
  { kind: "text" },
  { kind: "number" },
  { kind: "date" },
  { kind: "boolean" },
  { kind: "enum" },
  { kind: "phone" },
  { kind: "email" },
  { kind: "url" },
  { kind: "address" },
]);

export interface TypeChoiceVm {
  readonly value: FieldTypeWireV1["kind"];
  readonly label: string;
}

/** SCR-035's "What kind of information?" list; a money field keeps its own currency as a choice. */
export function typeChoicesFor(current: FieldTypeWireV1): readonly TypeChoiceVm[] {
  const choices = CHANGEABLE_TYPES.map((type) => ({ value: type.kind, label: typeLabel(type) }));
  return current.kind === "currency" || current.kind === "reference"
    ? [{ value: current.kind, label: typeLabel(current) }, ...choices]
    : choices;
}

/** The wire type a choice names, carrying a money field's own currency. */
export function typeForChoice(kind: FieldTypeWireV1["kind"], current: FieldTypeWireV1): FieldTypeWireV1 {
  if (kind === current.kind) return current;
  return CHANGEABLE_TYPES.find((type) => type.kind === kind) ?? { kind: "text" };
}

export interface RuleFieldChoiceVm {
  readonly fieldId: string;
  readonly name: string;
  readonly type: FieldTypeWireV1;
}

/** The fields a rule may compare: the table's active fields with an order (D52: date, decimal, text). */
export function ruleFieldChoices(structure: AppStructureViewV1, tableId: string): readonly RuleFieldChoiceVm[] {
  const table = structure.tables.find((candidate) => candidate.tableId === tableId);
  return byOrdinal(table?.fields ?? [])
    .filter((field) => field.isActive && ["date", "number", "currency", "text"].includes(field.type.kind))
    .map((field) => ({ fieldId: field.fieldId, name: field.displayName, type: field.type }));
}

export interface OperatorChoiceVm {
  readonly value: CompareOp;
  readonly label: string;
}

/** The six comparisons in the words that fit the compared field ("is on or after" for a date). */
export function operatorChoicesFor(type: FieldTypeWireV1 | undefined): readonly OperatorChoiceVm[] {
  const words = COMPARE_WORDS[orderKindOf(type)];
  return (["lt", "le", "gt", "ge", "eq", "ne"] as const).map((op) => ({ value: op, label: words[op] }));
}

/** What the rule editor's value box expects, said beside it. */
export function ruleValueHint(type: FieldTypeWireV1 | undefined): string {
  switch (orderKindOf(type)) {
    case "date":
      return "A day, written YYYY-MM-DD.";
    case "number":
      return "A number, written with a point for decimals.";
    case "text":
      return "Any text.";
  }
}

const CANONICAL_DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

/**
 * The typed value a person entered for a rule's right side, or null when the
 * text is not one of that kind. The worker's validator stays the authority;
 * this only chooses the truthful wire kind (the record form's rule).
 */
export function ruleValueFrom(text: string, type: FieldTypeWireV1 | undefined): CellWireValueV1 | null {
  const trimmed = text.normalize("NFC").trim();
  if (trimmed === "") return null;
  switch (orderKindOf(type)) {
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) return null;
      const parsed = Date.parse(`${trimmed}T00:00:00.000Z`);
      return Number.isNaN(parsed) || isoDay(parsed / MS_PER_DAY) !== trimmed ? null : { kind: "date", epochDay: parsed / MS_PER_DAY };
    }
    case "number":
      return CANONICAL_DECIMAL.test(trimmed) ? { kind: "number", decimal: trimmed } : null;
    case "text":
      return { kind: "text", text: trimmed };
  }
}

/** The text a saved value shows in the editor's value box. */
export function ruleValueText(value: CellWireValueV1): string {
  switch (value.kind) {
    case "text":
      return value.text;
    case "number":
      return value.decimal;
    case "date":
      return isoDay(value.epochDay);
    default:
      return "";
  }
}

// --- MOD-014 schema impact confirmation (dialog-atlas.html#mod-014) ---------

/**
 * What a change is, in the app's current names — MOD-014's title. Every
 * change the editor builds is one of D59's kinds, so each has its sentence.
 */
export function describeChange(change: SchemaChangeWireV1, structure: AppStructureViewV1): string {
  const lookup = lookupOf(structure);
  const tableName = (tableId: string): string =>
    structure.tables.find((table) => table.tableId === tableId)?.displayName ?? "a removed table";
  switch (change.kind) {
    case "rename-app":
      return `Rename the app to “${change.name}”`;
    case "rename-table":
      return `Rename ${tableName(change.tableId)} to “${change.name}”`;
    case "set-table-label":
      return change.labelFieldId === null
        ? `Stop naming ${tableName(change.tableId)} records by a field`
        : `Name ${tableName(change.tableId)} records by ${lookup.name(change.labelFieldId)}`;
    case "set-table-key":
      return change.keyFieldId === null
        ? `Give ${tableName(change.tableId)} no key`
        : `Make ${lookup.name(change.keyFieldId)} the key of ${tableName(change.tableId)}`;
    case "create-field":
      return `Add ${change.displayName} to ${tableName(change.tableId)}`;
    case "rename-field":
      return `Rename ${lookup.name(change.fieldId)} to “${change.name}”`;
    case "change-field-type":
      return `Change ${lookup.name(change.fieldId)} to ${typeLabel(change.type)}`;
    case "set-required":
      return change.isRequired ? `Make ${lookup.name(change.fieldId)} required` : `Make ${lookup.name(change.fieldId)} optional`;
    case "deactivate-field":
      return `Remove ${lookup.name(change.fieldId)}`;
    case "reactivate-field":
      return `Restore ${lookup.name(change.fieldId)}`;
    case "reorder-fields":
      return `Reorder the fields of ${tableName(change.tableId)}`;
    case "set-enum-options":
      return `Change the choices of ${lookup.name(change.fieldId)}`;
    case "set-relationship":
      return change.relationshipId === null
        ? `Connect ${lookup.name(change.fromFieldId)} to ${tableName(change.toTableId)}`
        : change.isActive
          ? `Connect ${lookup.name(change.fromFieldId)} to ${tableName(change.toTableId)}`
          : `Turn off the connection from ${lookup.name(change.fromFieldId)}`;
    case "remove-relationship": {
      const relationship = structure.relationships.find((candidate) => candidate.relationshipId === change.relationshipId);
      return relationship === undefined
        ? "Remove a connection"
        : `Remove the connection from ${lookup.name(relationship.fromFieldId)} to ${relationship.toTableName}`;
    }
    case "save-rule":
      return change.ruleId === null ? `Add the rule “${change.displayName}”` : `Change the rule “${change.displayName}”`;
    case "remove-rule": {
      const rule = structure.tables.flatMap((table) => table.rules).find((candidate) => candidate.ruleId === change.ruleId);
      return `Remove the rule “${rule?.displayName ?? "a removed rule"}”`;
    }
    case "save-formula":
      return change.formulaId === null ? "Add a live calculation" : "Change a live calculation";
    case "remove-formula":
      return "Remove a live calculation";
    default: {
      const unreachable: never = change;
      return unreachable;
    }
  }
}

const INVALID_CHANGE_SENTENCE: Readonly<Record<Extract<SchemaRefusalWireV1, { kind: "invalid-change" }>["reason"], string>> =
  Object.freeze({
    "empty-name": "A name cannot be empty.",
    "not-an-enum": "Only a choice list has choices to change.",
    "not-a-permutation": "The new order must list every field of the table exactly once.",
    "target-has-no-key": "That table has no key for this field to connect to. Choose its key first.",
    "not-a-computed-field": "That field is typed by people, not calculated.",
    "computed-field": "A calculated field's kind comes from its calculation, so it cannot be changed here.",
    "target-mismatch": "This calculation belongs somewhere else, so it cannot be saved here.",
    "no-new-field": "A new calculated column needs a name.",
  });

/** A formula refusal's reason, as the editor says it (M03's closed reasons plus unknown-name). */
const FORMULA_REASON: Readonly<Record<string, (detail: string | null) => string>> = Object.freeze({
  "unknown-name": (detail: string | null) => `Sheaf does not know the name ${detail === null ? "used here" : `“${detail}”`} in this app.`,
  syntax: () => "Sheaf could not read this calculation. Check its brackets, commas and operators.",
  "too-long": () => "This calculation is longer than Sheaf reads.",
  "too-deep": () => "This calculation nests more deeply than Sheaf reads.",
  "unsupported-token": (detail: string | null) => `Sheaf cannot read ${detail === null ? "part of this calculation" : `“${detail}”`}.`,
  "cell-reference": () => "Refer to fields by name in square brackets, like [Quoted]. Cell addresses are not used in an app.",
  "lookup-function": () => "Use RELATED([Connection],[Field]) to read a field through a connection.",
  "unsupported-function": (detail: string | null) => `${detail ?? "This function"} is not one Sheaf calculates.`,
  arity: (detail: string | null) => `${detail ?? "A function"} has the wrong number of inputs.`,
  "unsupported-operator": () => "This calculation uses an operator Sheaf does not calculate.",
  "array-constant": () => "Lists of values in braces are not calculated here.",
  "unsupported-error-literal": () => "This error value is not one Sheaf uses.",
  "number-out-of-range": () => "A number here is larger than Sheaf holds exactly.",
});

/** Why a change cannot be made, in plain words (CA-28's typed refusal; no cell value). */
export function describeSchemaRefusal(refusal: SchemaRefusalWireV1): string {
  switch (refusal.kind) {
    case "unknown-subject":
      return `That ${refusal.subject === "option" ? "choice" : refusal.subject === "relationship" ? "connection" : refusal.subject === "formula" ? "calculation" : refusal.subject} is no longer in this app.`;
    case "invalid-change":
      return INVALID_CHANGE_SENTENCE[refusal.reason];
    case "formula":
      return (FORMULA_REASON[refusal.reason] ?? (() => "Sheaf cannot calculate this."))(refusal.detail);
    case "transition":
      return `This change would leave the app's structure inconsistent (${plural(refusal.refusals.length, "problem", "problems")}), so it cannot be applied.`;
    case "validation":
      return `After this change ${plural(refusal.recordCount, "record", "records")} would fail the app's rules, so it cannot be applied.`;
    default: {
      const unreachable: never = refusal;
      return unreachable;
    }
  }
}

export interface ImpactDialogVm {
  readonly title: string;
  /** The exact counts that matter for this kind of change (CA-28), one sentence each. */
  readonly counts: readonly string[];
  /** D57, said every time. */
  readonly preservation: string;
  readonly applyLabel: string;
  /** Why apply is disabled: a refusal or a change too large for one commit. Null = it may apply. */
  readonly blocker: string | null;
  /** Set when the app moved since the last preview and these are the new counts. */
  readonly staleNote: string | null;
}

function countsFor(change: SchemaChangeWireV1, impact: ImpactReportWireV1, structure: AppStructureViewV1): string[] {
  const lookup = lookupOf(structure);
  const kept = (count: number, noun: string): string =>
    count === 0 ? "" : `${plural(count, noun, `${noun}s`)} ${count === 1 ? "does" : "do"} not fit and ${count === 1 ? "is" : "are"} kept as ${count === 1 ? "it was" : "they were"}, flagged for review.`;
  switch (change.kind) {
    case "change-field-type":
      return [
        `${plural(impact.converted, "value converts", "values convert")} to ${typeLabel(change.type)}.`,
        kept(impact.keptAndFlagged, "value"),
        `${plural(impact.unchanged, "record needs", "records need")} no change.`,
      ];
    case "set-required":
      return change.isRequired
        ? [`${plural(impact.missingNow, "record has", "records have")} no ${lookup.name(change.fieldId)}. ${impact.missingNow === 1 ? "It is" : "They are"} kept and flagged.`]
        : ["Records without a value are no longer flagged for it."];
    case "set-enum-options":
      return [`${plural(impact.onRemovedOptions, "record holds", "records hold")} a removed choice. ${impact.onRemovedOptions === 1 ? "It is" : "They are"} kept and flagged.`];
    case "set-relationship":
      return [
        `${plural(impact.matchedKeys, "value matches", "values match")} a record and ${impact.matchedKeys === 1 ? "becomes a connection" : "become connections"}.`,
        `${plural(impact.unmatchedKeys, "value matches", "values match")} no record and ${impact.unmatchedKeys === 1 ? "is" : "are"} kept as ${impact.unmatchedKeys === 1 ? "it was" : "they were"}, flagged for review.`,
      ];
    case "remove-relationship":
      return [
        `${plural(impact.unlinkedReferences, "connection stops", "connections stop")} linking; ${impact.unlinkedReferences === 1 ? "its value is" : "their values are"} kept.`,
        "Sheaf will not suggest this connection again.",
      ];
    case "save-rule":
      return [`${plural(impact.failingRule, "current record fails", "current records fail")} this rule.`];
    case "save-formula":
      return impact.formulaErrors === 0
        ? ["Every record gets a result from this calculation."]
        : [`${plural(impact.formulaErrors, "record gets", "records get")} an error from this calculation.`];
    case "remove-formula":
      return ["The calculation stops. No calculated value is stored in its place."];
    case "set-table-key":
      return impact.keptAndFlagged === 0
        ? ["Every record has its own key value."]
        : [`${plural(impact.keptAndFlagged, "record shares", "records share")} a key value with another record. ${impact.keptAndFlagged === 1 ? "It is" : "They are"} kept as ${impact.keptAndFlagged === 1 ? "it is" : "they are"}.`];
    case "deactivate-field":
      return [`${plural(impact.total, "record keeps", "records keep")} ${impact.total === 1 ? "its value" : "their values"} for this field; it is no longer shown or asked for.`];
    default:
      return [`${plural(impact.affected, "record is", "records are")} affected.`];
  }
}

/** MOD-014 from one preview: exact counts, preserve and flag, and why apply may not run. */
export function selectImpactVm(input: {
  readonly change: SchemaChangeWireV1;
  readonly preview: SchemaPreviewViewV1;
  readonly structure: AppStructureViewV1;
  readonly wasStale: boolean;
}): ImpactDialogVm {
  const { change, preview, structure, wasStale } = input;
  const { impact } = preview;
  const flags = impact.keptAndFlagged + impact.missingNow + impact.onRemovedOptions + impact.unmatchedKeys;
  return {
    title: describeChange(change, structure),
    counts: countsFor(change, impact, structure).filter((line) => line !== ""),
    preservation: "Sheaf keeps every existing value. Nothing is discarded.",
    applyLabel: flags > 0 && change.kind !== "set-table-key" ? "Apply and flag" : "Apply",
    blocker:
      preview.refusal !== null
        ? describeSchemaRefusal(preview.refusal)
        : preview.isTooLarge
          ? `This change would write ${plural(preview.eventCount, "change", "changes")} at once, more than one save holds on this device, so it cannot be applied.`
          : null,
    staleNote: wasStale ? "This app changed on this device after the last preview. These are the counts now." : null,
  };
}

/** What an apply that did not land says (CA-28's outcomes other than `applied`). */
export function describeApplyFailure(outcome: Exclude<SchemaApplyOutcomeV1, { result: "applied" | "stale-preview" }>): string {
  switch (outcome.result) {
    case "refused":
      return describeSchemaRefusal(outcome.refusal);
    case "too-large":
      return `This change would write ${plural(outcome.eventCount, "change", "changes")} at once, more than the ${String(outcome.maxEvents)} one save holds on this device, so nothing was applied.`;
    case "unknown-app":
      return "This app is no longer on this device, so nothing was applied.";
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}
