/**
 * Schema changes and their counted impact (M02; FR-15, D57, D59, CA-28).
 *
 * {@link analyzeSchemaChange} is the one impact computation: MOD-014's
 * preview and the apply command call the same function over the same
 * records, so the counts a person approves are the counts that commit. It
 * never discards a value — a value that does not survive a type change is
 * kept as `invalid-preserved` and flagged (D57) — and the `patches` it returns
 * are exactly the `record.patched` values the change's commit carries.
 *
 * {@link validateSchemaTransition} refuses a before → after schema that would
 * break an invariant migration 005 or the domain holds, restated here so the
 * command refuses it first, with a typed reason.
 *
 * M02 depends on M03 for result types only: formula evaluation arrives
 * through the environment.
 */

import type { EvaluationResultV1, FormulaDefinitionV1 } from "../formulas/index.js";
import { compareDomainIds, encodeDomainId, type FieldId, type FormulaId, type RecordId, type RelationshipId, type RuleId, type TableId } from "../model/ids.js";
import type { EnumOptionDefV1, FieldDefV1, FieldTypeV1, RelationshipDefV1, TableDefV1 } from "../model/schema.js";
import { expectedCellKindForFieldType } from "../model/schema.js";
import {
  booleanValue,
  cellValuesEqual,
  dateValue,
  decimalValue,
  enumValue,
  invalidPreservedValue,
  isAbsentCellValue,
  isCanonicalDecimal,
  MISSING_VALUE,
  referenceValue,
  textValue,
  type CellValueV1,
} from "../model/values.js";
import type { ValidationRuleIR, ValidationRuleIRV2 } from "./rules.js";
import { validateSchema } from "./schema-checks.js";
import { ruleHolds, type RecordUnderValidationV1, type ReferenceResolver } from "./validate-record.js";

/** A whole app schema, as a change sees it before (or after) it applies. */
export interface SchemaSnapshotV1 {
  readonly tables: readonly TableDefV1[];
  readonly enumOptions: readonly EnumOptionDefV1[];
  readonly relationships: readonly RelationshipDefV1[];
  readonly rules: readonly (ValidationRuleIR | ValidationRuleIRV2)[];
  readonly formulas: readonly FormulaDefinitionV1[];
}

/** D59: every schema change a person can make, closed. */
export type SchemaChangeV1 =
  | { readonly kind: "rename-app"; readonly name: string }
  | { readonly kind: "rename-table"; readonly tableId: TableId; readonly name: string }
  | { readonly kind: "set-table-label"; readonly tableId: TableId; readonly labelFieldId: FieldId | null }
  | { readonly kind: "create-field"; readonly field: FieldDefV1; readonly enumOptions: readonly EnumOptionDefV1[] }
  | { readonly kind: "rename-field"; readonly fieldId: FieldId; readonly name: string }
  | { readonly kind: "change-field-type"; readonly fieldId: FieldId; readonly type: FieldTypeV1 }
  | { readonly kind: "set-required"; readonly fieldId: FieldId; readonly isRequired: boolean }
  | { readonly kind: "deactivate-field"; readonly fieldId: FieldId }
  | { readonly kind: "reactivate-field"; readonly fieldId: FieldId }
  | { readonly kind: "reorder-fields"; readonly tableId: TableId; readonly fieldIds: readonly FieldId[] }
  /** The complete option list after the change; a dropped option becomes inactive, never deleted. */
  | { readonly kind: "set-enum-options"; readonly fieldId: FieldId; readonly options: readonly EnumOptionDefV1[] }
  /** Create (converting a text/key field to `reference`), retarget, or re-enable (D64). */
  | { readonly kind: "set-relationship"; readonly relationship: RelationshipDefV1 }
  | {
      readonly kind: "remove-relationship";
      readonly relationshipId: RelationshipId;
      /** The rejection-evidence fingerprint that keeps re-detection suppressed (FR-7), if any. */
      readonly rejectionFingerprint: Uint8Array | null;
    }
  | {
      readonly kind: "save-rule";
      readonly tableId: TableId;
      readonly displayName: string;
      readonly rule: ValidationRuleIR | ValidationRuleIRV2;
    }
  | { readonly kind: "remove-rule"; readonly ruleId: RuleId }
  /** A computed column (with its new field when it creates one), table metric, or dashboard value. */
  | { readonly kind: "save-formula"; readonly formula: FormulaDefinitionV1; readonly field: FieldDefV1 | null }
  | { readonly kind: "remove-formula"; readonly formulaId: FormulaId };

export type SchemaChangeKindV1 = SchemaChangeV1["kind"];

/** One value the change rewrites: a `record.patched` in the same commit (D57). */
export interface ValuePatchV1 {
  readonly recordId: RecordId;
  readonly fieldId: FieldId;
  readonly value: CellValueV1;
}

/**
 * Exact counts over the records the change touches (CA-28). For every change
 * `affected + unchanged = total`; the named counts break `affected` down:
 *
 * - `change-field-type`: `converted + keptAndFlagged = affected`.
 * - `set-required`: `missingNow`. `set-enum-options`: `onRemovedOptions`.
 * - `set-relationship`: `matchedKeys + unmatchedKeys = affected`.
 * - `remove-relationship`: `unlinkedReferences`.
 * - `save-rule` / `remove-rule`: `failingRule` (records the rule flags).
 * - `save-formula` on a computed column: `formulaErrors`.
 */
export interface ImpactReportV1 {
  readonly change: SchemaChangeKindV1;
  readonly total: number;
  readonly affected: number;
  readonly unchanged: number;
  readonly converted: number;
  readonly keptAndFlagged: number;
  readonly missingNow: number;
  readonly onRemovedOptions: number;
  readonly matchedKeys: number;
  readonly unmatchedKeys: number;
  readonly unlinkedReferences: number;
  readonly failingRule: number;
  readonly formulaErrors: number;
  readonly patches: readonly ValuePatchV1[];
}

/** What impact analysis needs from outside the pure domain. */
export interface ImpactEnvV1 {
  /** The live record of `tableId` whose key field reads `keyText`, if any (D57 key matching). */
  resolveKey(tableId: TableId, keyText: string): RecordId | null;
  readonly referenceExists: ReferenceResolver;
  /** The saved formula's result for one record — the evaluator (M03), injected. */
  formulaResult(formula: FormulaDefinitionV1, record: RecordUnderValidationV1): EvaluationResultV1;
}

export type ValueConversionV1 =
  /** Already fits the new type, or holds nothing. */
  | { readonly kind: "unchanged" }
  | { readonly kind: "converted"; readonly value: CellValueV1 }
  /** Kept verbatim as `invalid-preserved{sourceText}` and flagged (D57). */
  | { readonly kind: "kept"; readonly value: CellValueV1 };

const MS_PER_DAY = 86_400_000;

/**
 * `YYYY-MM-DD` → epoch day, exactly as authored date input is read today
 * (`src/ui/records/values.ts` `isoDateToEpochDay`): read at UTC midnight, so no
 * time zone enters; an impossible day is `null`.
 */
const epochDayOfIso = (iso: string): number | null => {
  if (!/^-?\d{4,6}-\d{2}-\d{2}$/u.test(iso)) return null;
  const parsed = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return null;
  const day = parsed / MS_PER_DAY;
  return Number.isInteger(day) ? day : null;
};

const isoOfEpochDay = (epochDay: number): string =>
  new Date(epochDay * MS_PER_DAY).toISOString().split("T")[0] ?? "";

/** The text a value reads as, which a type change re-parses; `null` for a reference. */
function sourceTextOf(value: CellValueV1, enumOptions: readonly EnumOptionDefV1[]): string | null {
  switch (value.kind) {
    case "text":
      return value.text;
    case "decimal":
      return value.decimal;
    case "date":
      return isoOfEpochDay(value.epochDay);
    case "boolean":
      return value.boolean ? "TRUE" : "FALSE";
    case "enum":
      return enumOptions.find((option) => encodeDomainId(option.optionId) === encodeDomainId(value.optionId))?.displayLabel ?? null;
    case "invalid-preserved":
      return value.sourceText;
    case "reference":
    case "missing":
    case "blank":
      return null;
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

/**
 * Re-reads one value under a new field type, with the parsing policy authored
 * input uses today (M44's form → the wire): numbers are canonical decimal text
 * after trimming, dates are ISO `YYYY-MM-DD`, text is NFC. An enum reads an
 * active option by exact label from `enumOptions` (the field's options); a
 * boolean reads `TRUE`/`FALSE`. Anything else is kept verbatim as
 * `invalid-preserved` — never coerced, never dropped (D57). A `reference`
 * type is reached only through `set-relationship`, which matches keys; here a
 * value headed for one is kept.
 */
export function convertValueForType(
  value: CellValueV1,
  newType: FieldTypeV1,
  enumOptions: readonly EnumOptionDefV1[],
): ValueConversionV1 {
  if (isAbsentCellValue(value) || value.kind === expectedCellKindForFieldType(newType)) return { kind: "unchanged" };
  const source = sourceTextOf(value, enumOptions);
  if (source === null) return { kind: "unchanged" };
  const text = source.normalize("NFC");
  const kept = (): ValueConversionV1 => {
    const preserved = invalidPreservedValue(text);
    return cellValuesEqual(preserved, value) ? { kind: "kept", value } : { kind: "kept", value: preserved };
  };
  const trimmed = text.trim();
  switch (newType.kind) {
    case "text":
    case "phone":
    case "email":
    case "url":
    case "address":
      return { kind: "converted", value: textValue(text) };
    case "number":
    case "currency":
      return isCanonicalDecimal(trimmed) ? { kind: "converted", value: decimalValue(trimmed) } : kept();
    case "date": {
      const epochDay = epochDayOfIso(trimmed);
      return epochDay === null ? kept() : { kind: "converted", value: dateValue(epochDay) };
    }
    case "boolean": {
      const upper = trimmed.toUpperCase();
      return upper === "TRUE" || upper === "FALSE" ? { kind: "converted", value: booleanValue(upper === "TRUE") } : kept();
    }
    case "enum": {
      const option = enumOptions.find((candidate) => candidate.isActive && candidate.displayLabel.normalize("NFC") === trimmed);
      return option === undefined ? kept() : { kind: "converted", value: enumValue(option.optionId) };
    }
    case "reference":
      return kept();
    default: {
      const unreachable: never = newType;
      return unreachable;
    }
  }
}

const sameId = (left: Uint8Array, right: Uint8Array): boolean => compareDomainIds(left, right) === 0;

const fieldOf = (schema: SchemaSnapshotV1, fieldId: FieldId): FieldDefV1 | undefined =>
  schema.tables.flatMap((table) => table.fields).find((field) => sameId(field.fieldId, fieldId));

const optionsOf = (schema: SchemaSnapshotV1, fieldId: FieldId): readonly EnumOptionDefV1[] =>
  schema.enumOptions.filter((option) => sameId(option.fieldId, fieldId));

const valueIn = (record: RecordUnderValidationV1, fieldId: FieldId): CellValueV1 =>
  [...record.values].find(([id]) => sameId(id, fieldId))?.[1] ?? MISSING_VALUE;

/**
 * Counts, over `records` (the rows of the table the change touches), exactly
 * what the change converts, keeps and flags, and returns the value patches its
 * commit carries. Pure and total: the same inputs give the same report.
 */
export function analyzeSchemaChange(
  change: SchemaChangeV1,
  schema: SchemaSnapshotV1,
  records: Iterable<RecordUnderValidationV1>,
  env: ImpactEnvV1,
): ImpactReportV1 {
  const counts = {
    total: 0,
    affected: 0,
    converted: 0,
    keptAndFlagged: 0,
    missingNow: 0,
    onRemovedOptions: 0,
    matchedKeys: 0,
    unmatchedKeys: 0,
    unlinkedReferences: 0,
    failingRule: 0,
    formulaErrors: 0,
  };
  const patches: ValuePatchV1[] = [];
  const count = (key: Exclude<keyof typeof counts, "total" | "affected">): void => {
    counts[key] += 1;
    counts.affected += 1;
  };

  const perRecord = ((): ((record: RecordUnderValidationV1) => void) | null => {
    switch (change.kind) {
      case "change-field-type": {
        const options = optionsOf(schema, change.fieldId);
        return (record) => {
          const before = valueIn(record, change.fieldId);
          const conversion = convertValueForType(before, change.type, options);
          if (conversion.kind === "unchanged") return;
          count(conversion.kind === "converted" ? "converted" : "keptAndFlagged");
          if (!cellValuesEqual(conversion.value, before)) {
            patches.push({ recordId: record.recordId, fieldId: change.fieldId, value: conversion.value });
          }
        };
      }
      case "set-required":
        return change.isRequired
          ? (record) => {
              if (isAbsentCellValue(valueIn(record, change.fieldId))) count("missingNow");
            }
          : null;
      case "set-enum-options": {
        const kept = new Set(change.options.filter((option) => option.isActive).map((option) => encodeDomainId(option.optionId)));
        return (record) => {
          const value = valueIn(record, change.fieldId);
          if (value.kind === "enum" && !kept.has(encodeDomainId(value.optionId))) count("onRemovedOptions");
        };
      }
      case "set-relationship": {
        const relationship = change.relationship;
        const source = fieldOf(schema, relationship.fromFieldId);
        const isConversion = source !== undefined && source.type.kind !== "reference";
        const options = optionsOf(schema, relationship.fromFieldId);
        return (record) => {
          const value = valueIn(record, relationship.fromFieldId);
          if (isAbsentCellValue(value)) return;
          if (!isConversion) {
            count(value.kind === "reference" && env.referenceExists(relationship.toTableId, value.recordId) ? "matchedKeys" : "unmatchedKeys");
            return;
          }
          const keyText = sourceTextOf(value, options);
          const matched = keyText === null ? null : env.resolveKey(relationship.toTableId, keyText.normalize("NFC").trim());
          if (matched !== null) {
            count("matchedKeys");
            patches.push({ recordId: record.recordId, fieldId: relationship.fromFieldId, value: referenceValue(matched) });
            return;
          }
          count("unmatchedKeys");
          if (keyText !== null) {
            const preserved = invalidPreservedValue(keyText.normalize("NFC"));
            if (!cellValuesEqual(preserved, value)) {
              patches.push({ recordId: record.recordId, fieldId: relationship.fromFieldId, value: preserved });
            }
          }
        };
      }
      case "remove-relationship": {
        const relationship = schema.relationships.find((candidate) => sameId(candidate.relationshipId, change.relationshipId));
        return relationship === undefined
          ? null
          : (record) => {
              if (valueIn(record, relationship.fromFieldId).kind === "reference") count("unlinkedReferences");
            };
      }
      case "save-rule":
        return (record) => {
          if (!ruleHolds(change.rule, record)) count("failingRule");
        };
      case "remove-rule": {
        const rule = schema.rules.find((candidate) => sameId(candidate.ruleId, change.ruleId));
        return rule === undefined
          ? null
          : (record) => {
              if (!ruleHolds(rule, record)) count("failingRule");
            };
      }
      case "save-formula":
        return change.formula.target.kind === "computed-column"
          ? (record) => {
              const result = env.formulaResult(change.formula, record);
              if (result.kind === "error" || result.kind === "cycle") count("formulaErrors");
            }
          : null;
      case "rename-app":
      case "rename-table":
      case "set-table-label":
      case "create-field":
      case "rename-field":
      case "deactivate-field":
      case "reactivate-field":
      case "reorder-fields":
      case "remove-formula":
        // Values are untouched and nothing new is flagged (CA-28).
        return null;
      default: {
        const unreachable: never = change;
        return unreachable;
      }
    }
  })();

  for (const record of records) {
    counts.total += 1;
    perRecord?.(record);
  }
  return { change: change.kind, ...counts, unchanged: counts.total - counts.affected, patches };
}

// ------------------------------------------------------------------ transition --

export const SCHEMA_TRANSITION_REFUSALS = Object.freeze([
  /** A field disappeared: "delete" deactivates, it never removes (D57). */
  "field-removed",
  /** migration 005: a table's key field is authored and active. */
  "key-field-computed",
  "key-field-inactive",
  /** A reference field is the source of exactly one relationship. */
  "reference-without-relationship",
  "reference-multiple-relationships",
  /** Enum option IDs are stable: an option may become inactive, never vanish or move. */
  "enum-option-removed",
  "enum-option-moved",
  /** A computed field and its formula's computed-column target name each other (`trg_formulas_insert_guard`). */
  "formula-target-mismatch",
  /** The after-schema fails `validateSchema` (relationship endpoints, ownership, ordinals…). */
  "schema-invalid",
] as const);

export type SchemaTransitionRefusalKindV1 = (typeof SCHEMA_TRANSITION_REFUSALS)[number];

export interface SchemaTransitionRefusalV1 {
  readonly kind: SchemaTransitionRefusalKindV1;
  readonly fieldId: FieldId | null;
  /** The `validateSchema` message key for `schema-invalid`; otherwise `null`. */
  readonly messageKey: string | null;
}

export interface SchemaTransitionReportV1 {
  readonly isAllowed: boolean;
  readonly refusals: readonly SchemaTransitionRefusalV1[];
}

/** Refuses a before → after schema that would break a durable invariant. */
export function validateSchemaTransition(before: SchemaSnapshotV1, after: SchemaSnapshotV1): SchemaTransitionReportV1 {
  const refusals: SchemaTransitionRefusalV1[] = [];
  const refuse = (kind: SchemaTransitionRefusalKindV1, fieldId: FieldId | null = null, messageKey: string | null = null): void => {
    refusals.push({ kind, fieldId, messageKey });
  };
  const afterFields = after.tables.flatMap((table) => table.fields);

  for (const field of before.tables.flatMap((table) => table.fields)) {
    if (fieldOf(after, field.fieldId) === undefined) refuse("field-removed", field.fieldId);
  }

  for (const table of after.tables) {
    if (table.keyFieldId === null) continue;
    const key = fieldOf(after, table.keyFieldId);
    if (key?.formulaId !== undefined) refuse("key-field-computed", table.keyFieldId);
    if (key !== undefined && !key.isActive) refuse("key-field-inactive", table.keyFieldId);
  }

  for (const field of afterFields) {
    if (field.type.kind !== "reference") continue;
    const sources = after.relationships.filter((relationship) => sameId(relationship.fromFieldId, field.fieldId)).length;
    if (sources === 0) refuse("reference-without-relationship", field.fieldId);
    if (sources > 1) refuse("reference-multiple-relationships", field.fieldId);
  }

  for (const option of before.enumOptions) {
    const kept = after.enumOptions.find((candidate) => sameId(candidate.optionId, option.optionId));
    if (kept === undefined) refuse("enum-option-removed", option.fieldId);
    else if (!sameId(kept.fieldId, option.fieldId)) refuse("enum-option-moved", option.fieldId);
  }

  const computedTargets = after.formulas.flatMap((formula) =>
    formula.target.kind === "computed-column" ? [{ formula, target: formula.target }] : [],
  );
  for (const field of afterFields) {
    if (field.formulaId === undefined) continue;
    const formulaId = field.formulaId;
    const owner = computedTargets.find(({ formula }) => sameId(formula.formulaId, formulaId));
    if (owner === undefined || !sameId(owner.target.fieldId, field.fieldId) || !sameId(owner.target.tableId, field.tableId)) {
      refuse("formula-target-mismatch", field.fieldId);
    }
  }
  for (const { formula, target } of computedTargets) {
    const field = fieldOf(after, target.fieldId);
    if (field === undefined || field.formulaId === undefined || !sameId(field.formulaId, formula.formulaId)) {
      refuse("formula-target-mismatch", target.fieldId);
    }
  }

  for (const issue of validateSchema(after.tables, after.enumOptions, after.relationships).issues) {
    refuse("schema-invalid", issue.fieldId, issue.messageKey);
  }

  return { isAllowed: refusals.length === 0, refusals };
}
