/**
 * Schema well-formedness, checked before a schema becomes durable.
 *
 * Promotion writes a schema that migration 005 will later have to accept: its
 * primary keys, unique ordinals, and enum-option ownership triggers are not
 * negotiable, and a projection that refuses to load is discovered at open
 * time, long after the import that caused it. These checks are that contract
 * stated once, in the domain, where promotion can consult it before writing.
 *
 * Only what F02 proves lives here. `validateSchemaTransition` and
 * `analyzeImpact` — the before/after comparison the schema editors need —
 * arrive with those editors in F04.
 */

import { encodeDomainId, type FieldId } from "../model/ids.js";
import type { EnumOptionDefV1, TableDefV1 } from "../model/schema.js";
import {
  buildReport,
  type ValidationIssueV1,
  type ValidationReport,
} from "./rules.js";

const schemaIssue = (
  messageKey: string,
  messageParameters: ValidationIssueV1["messageParameters"] = {},
  fieldId: FieldId | null = null,
): ValidationIssueV1 => ({
  fieldId,
  ruleId: null,
  kind: "schema",
  severity: "blocking",
  messageKey,
  messageParameters,
});

const isOrdinal = (value: number): boolean =>
  Number.isInteger(value) && value >= 0;

/**
 * Checks a complete schema: the tables, their fields, and every enum option
 * that belongs to them.
 */
export function validateSchema(
  tables: readonly TableDefV1[],
  enumOptions: readonly EnumOptionDefV1[],
): ValidationReport {
  const issues: ValidationIssueV1[] = [];

  const tableIds = new Set<string>();
  const tableOrdinals = new Set<number>();
  const fieldsById = new Map<string, { table: TableDefV1; type: string }>();

  for (const table of tables) {
    const tableKey = encodeDomainId(table.tableId);
    if (tableIds.has(tableKey)) {
      issues.push(schemaIssue("schema.duplicate-table-id"));
    }
    tableIds.add(tableKey);

    if (!isOrdinal(table.tableOrdinal)) {
      issues.push(schemaIssue("schema.invalid-table-ordinal"));
    } else if (tableOrdinals.has(table.tableOrdinal)) {
      issues.push(
        schemaIssue("schema.duplicate-table-ordinal", {
          tableOrdinal: table.tableOrdinal,
        }),
      );
    }
    tableOrdinals.add(table.tableOrdinal);

    if (table.displayName.length === 0) {
      issues.push(schemaIssue("schema.missing-table-label"));
    }
    if (table.fields.length === 0) {
      issues.push(
        schemaIssue("schema.table-has-no-fields", {
          tableLabel: table.displayName,
        }),
      );
    }

    const fieldOrdinals = new Set<number>();
    for (const field of table.fields) {
      const fieldKey = encodeDomainId(field.fieldId);
      if (fieldsById.has(fieldKey)) {
        issues.push(schemaIssue("schema.duplicate-field-id", {}, field.fieldId));
      }
      fieldsById.set(fieldKey, { table, type: field.type.kind });

      if (encodeDomainId(field.tableId) !== tableKey) {
        issues.push(schemaIssue("schema.field-in-wrong-table", {}, field.fieldId));
      }
      if (!isOrdinal(field.fieldOrdinal)) {
        issues.push(
          schemaIssue("schema.invalid-field-ordinal", {}, field.fieldId),
        );
      } else if (fieldOrdinals.has(field.fieldOrdinal)) {
        issues.push(
          schemaIssue(
            "schema.duplicate-field-ordinal",
            { fieldOrdinal: field.fieldOrdinal },
            field.fieldId,
          ),
        );
      }
      fieldOrdinals.add(field.fieldOrdinal);

      if (field.displayName.length === 0) {
        issues.push(schemaIssue("schema.missing-field-label", {}, field.fieldId));
      }
    }

    for (const named of [
      { role: "key", fieldId: table.keyFieldId },
      { role: "label", fieldId: table.labelFieldId },
    ]) {
      if (named.fieldId === null) {
        continue;
      }
      const owns = table.fields.some(
        (field) =>
          encodeDomainId(field.fieldId) === encodeDomainId(named.fieldId as FieldId),
      );
      if (!owns) {
        issues.push(
          schemaIssue(
            "schema.named-field-not-in-table",
            { role: named.role },
            named.fieldId,
          ),
        );
      }
    }
  }

  const optionIds = new Set<string>();
  const ordinalsByField = new Map<string, Set<number>>();
  const optionCountByField = new Map<string, number>();

  for (const option of enumOptions) {
    const optionKey = encodeDomainId(option.optionId);
    const fieldKey = encodeDomainId(option.fieldId);

    if (optionIds.has(optionKey)) {
      issues.push(schemaIssue("schema.duplicate-option-id", {}, option.fieldId));
    }
    optionIds.add(optionKey);

    const owner = fieldsById.get(fieldKey);
    if (owner === undefined) {
      issues.push(schemaIssue("schema.option-without-field", {}, option.fieldId));
    } else if (owner.type !== "enum") {
      // Migration 005's trigger rejects this outright; catching it here means
      // promotion never writes a schema the projection cannot load.
      issues.push(
        schemaIssue(
          "schema.option-on-non-enum-field",
          { fieldType: owner.type },
          option.fieldId,
        ),
      );
    }

    const ordinals = ordinalsByField.get(fieldKey) ?? new Set<number>();
    if (!isOrdinal(option.optionOrdinal)) {
      issues.push(
        schemaIssue("schema.invalid-option-ordinal", {}, option.fieldId),
      );
    } else if (ordinals.has(option.optionOrdinal)) {
      issues.push(
        schemaIssue(
          "schema.duplicate-option-ordinal",
          { optionOrdinal: option.optionOrdinal },
          option.fieldId,
        ),
      );
    }
    ordinals.add(option.optionOrdinal);
    ordinalsByField.set(fieldKey, ordinals);

    if (option.displayLabel.length === 0) {
      issues.push(schemaIssue("schema.missing-option-label", {}, option.fieldId));
    }
    if (option.isActive) {
      optionCountByField.set(
        fieldKey,
        (optionCountByField.get(fieldKey) ?? 0) + 1,
      );
    }
  }

  for (const [fieldKey, field] of fieldsById) {
    if (field.type === "enum" && (optionCountByField.get(fieldKey) ?? 0) === 0) {
      issues.push(schemaIssue("schema.enum-field-without-options"));
    }
  }

  return buildReport(issues);
}
