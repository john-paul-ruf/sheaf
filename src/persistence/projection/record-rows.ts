/**
 * How one record becomes projection rows: its authored blob, its typed cells,
 * its issues, and its searchable text.
 *
 * The rules here are CA-13(b) and CA-13(c), and both are about *not* losing
 * information:
 *
 * - **Exactly one typed lane per value, or none at all.** A value whose kind
 *   does not fit its field gets no cell — it is not coerced into the nearest
 *   lane, and the trigger in migration 005 would refuse it anyway. Missing,
 *   blank, and invalid-preserved values are three different states and none of
 *   them becomes an empty string or a zero.
 * - **The authored blob is the truth.** `cells` is an index over the record;
 *   `records.authored_cbor` is the record. Anything without a lane is still
 *   completely readable there, which is what makes a preserved invalid value
 *   visible to the person who has to fix it (FR-4).
 *
 * The engine adds exactly one issue of its own, and only one: a decimal outside
 * the v1 order-key domain gets no decimal lane, so it must say why. Every other
 * issue arrives from the one shared validator (invariant 5) — this module never
 * re-decides whether a record is valid.
 */

import { encodeBase64Url } from "../../domain/model/bytes.js";
import {
  expectedCellKindForFieldType,
  isComputedField,
  type FieldDefV1,
  type StorageKindV1,
} from "../../domain/model/schema.js";
import type { AuthoredRecordV1 } from "../../domain/model/events.js";
import { isAbsentCellValue, type CellValueV1 } from "../../domain/model/values.js";
import { encodeAuthoredRecord, encodeMessageParameters } from "./cbor-values.js";
import {
  run,
  selectRow,
  toSqlInteger,
  type ProjectionHandleV1,
  type SqlParam,
} from "./engine.js";
import {
  DELETE_AUTHORED_CELLS_FOR_RECORD,
  DELETE_SEARCH_ROW,
  DELETE_VALIDATOR_ISSUES_FOR_RECORD,
  INSERT_CELL,
  INSERT_RECORD,
  INSERT_RECORD_ISSUE,
  INSERT_SEARCH_ROW,
  SELECT_LAST_INSERT_ROWID,
  UPDATE_RECORD,
} from "./statements.js";
import type {
  ProjectionRecordV1,
  ProjectionSchemaCacheV1,
  ValidationIssueV1Input,
} from "./types.js";
import { decimalOrderKeyV1, textSortKeyV1 } from "./sort-keys.js";

/**
 * The key every internal map uses. A `Map` keyed by a domain ID matches on
 * object identity, so two equal IDs from different decodes would miss each
 * other; the 22-character text spelling is the lookup key instead. It is
 * non-durable by contract and never leaves the projection.
 */
export function idKey(id: Uint8Array): string {
  return encodeBase64Url(id);
}

export interface CellLaneV1 {
  readonly valueKind: StorageKindV1;
  readonly textValue: string | null;
  readonly textSortKey: Uint8Array | null;
  readonly decimalValue: string | null;
  readonly decimalOrderKey: Uint8Array | null;
  readonly integerValue: number | null;
  readonly idValue: Uint8Array | null;
}

export interface CellProjectionV1 {
  /** Null when this value has no typed lane; its state stays authored-only. */
  readonly lane: CellLaneV1 | null;
  /** The projection's own issue, when the lane is absent because of one. */
  readonly issue: ValidationIssueV1Input | null;
}

const NO_LANE: CellProjectionV1 = Object.freeze({ lane: null, issue: null });

const lane = (
  valueKind: StorageKindV1,
  parts: Partial<Omit<CellLaneV1, "valueKind">>,
): CellProjectionV1 => ({
  lane: {
    valueKind,
    textValue: parts.textValue ?? null,
    textSortKey: parts.textSortKey ?? null,
    decimalValue: parts.decimalValue ?? null,
    decimalOrderKey: parts.decimalOrderKey ?? null,
    integerValue: parts.integerValue ?? null,
    idValue: parts.idValue ?? null,
  },
  issue: null,
});

/**
 * The one issue this module authors. The value itself is fine — it is a
 * canonical decimal and it stays exactly as written — but it cannot be indexed
 * by the v1 order key, so it gets no decimal cell and says so. Parameters carry
 * the field label and the domain, never the value.
 */
const outOfDomainDecimal = (field: FieldDefV1): ValidationIssueV1Input => ({
  fieldId: field.fieldId,
  ruleId: null,
  kind: "type",
  severity: "warning",
  messageKey: "validation.decimal-out-of-domain",
  messageParameters: { fieldLabel: field.displayName },
});

/** Maps one authored value onto its typed lane, or explains its absence. */
export function projectCellValue(
  field: FieldDefV1,
  value: CellValueV1,
): CellProjectionV1 {
  // Missing and blank hold no value to index; invalid-preserved holds a value
  // that does not fit the lane. All three stay in the authored blob, and the
  // shared validator has already said what it thinks of them.
  if (isAbsentCellValue(value) || value.kind === "invalid-preserved") {
    return NO_LANE;
  }
  if (value.kind !== expectedCellKindForFieldType(field.type)) {
    return NO_LANE;
  }

  switch (value.kind) {
    case "text":
      return lane("text", {
        textValue: value.text,
        textSortKey: textSortKeyV1(value.text),
      });
    case "decimal": {
      const orderKey = decimalOrderKeyV1(value.decimal);
      if (orderKey === null) {
        return { lane: null, issue: outOfDomainDecimal(field) };
      }
      return lane("decimal", {
        decimalValue: value.decimal,
        decimalOrderKey: orderKey,
      });
    }
    case "date":
      return lane("integer", { integerValue: value.epochDay });
    case "boolean":
      return lane("integer", { integerValue: value.boolean ? 1 : 0 });
    case "enum":
      return lane("id", { idValue: value.optionId });
    case "reference":
      return lane("id", { idValue: value.recordId });
    default:
      return NO_LANE;
  }
}

/**
 * The text FTS indexes: what a person can actually read on the record, in
 * schema order — values of active authored fields plus the labels of the enum
 * options they name. Provenance, issue text, and the IDs themselves are not
 * searchable text and are left out.
 */
export function searchableTextFor(
  schema: ProjectionSchemaCacheV1,
  record: AuthoredRecordV1,
): string {
  const values = new Map(
    [...record.values].map(([fieldId, value]) => [idKey(fieldId), value]),
  );
  const parts: string[] = [];

  for (const field of schema.fieldsByTable.get(idKey(record.tableId)) ?? []) {
    // A computed column is not searchable text, even where a frozen or
    // unsupported literal backs it (database.md § `record_search`).
    if (!field.isActive || isComputedField(field)) {
      continue;
    }
    const value = values.get(idKey(field.fieldId));
    if (value === undefined) {
      continue;
    }
    switch (value.kind) {
      case "text":
        parts.push(value.text);
        break;
      case "decimal":
        parts.push(value.decimal);
        break;
      case "invalid-preserved":
        parts.push(value.sourceText);
        break;
      case "enum": {
        const label = schema.optionLabels.get(idKey(value.optionId));
        if (label !== undefined) {
          parts.push(label);
        }
        break;
      }
      default:
        break;
    }
  }

  return parts.join("\n");
}

/**
 * `record_issues.issue_id` is "a stable derived issue identity for the current
 * replay" — derived, because a projection has no entropy and an invented random
 * ID would make two replays of the same state differ. The row key and the
 * issue's position in its record are unique together and are as ephemeral as
 * the issue itself.
 */
export function deriveIssueId(recordPk: number, ordinal: number): Uint8Array {
  const id = new Uint8Array(16);
  const view = new DataView(id.buffer);
  view.setBigUint64(0, BigInt(recordPk));
  view.setUint32(8, ordinal);
  return id;
}

const cellParameters = (
  recordPk: number,
  field: FieldDefV1,
  cell: CellLaneV1,
): readonly SqlParam[] => [
  recordPk,
  field.fieldId,
  // Only an authored field gets a lane here; a computed field's lane is
  // recalculation's, with `origin = 'computed'` (D51, invariant 7).
  "authored",
  cell.valueKind,
  cell.textValue,
  cell.textSortKey,
  cell.decimalValue,
  cell.decimalOrderKey,
  cell.integerValue,
  cell.idValue,
];

const issueParameters = (
  recordPk: number,
  issue: ValidationIssueV1Input,
  ordinal: number,
): readonly SqlParam[] => [
  deriveIssueId(recordPk, ordinal),
  recordPk,
  issue.fieldId,
  issue.ruleId,
  issue.kind,
  issue.severity,
  issue.messageKey,
  encodeMessageParameters(issue.messageParameters),
];

/**
 * Writes a record's authored lanes and returns the projection's own issues
 * for the values that could not take one.
 */
function writeLanes(
  handle: ProjectionHandleV1,
  recordPk: number,
  record: AuthoredRecordV1,
): readonly ValidationIssueV1Input[] {
  const fields = handle.schema.fieldsByTable.get(idKey(record.tableId));
  if (fields === undefined) {
    throw new Error("record names a table this projection does not hold");
  }

  const issues: ValidationIssueV1Input[] = [];
  const values = new Map(
    [...record.values].map(([fieldId, value]) => [idKey(fieldId), value]),
  );

  for (const field of fields) {
    const value = values.get(idKey(field.fieldId));
    // A frozen or unsupported column's literal is authored but projected into
    // the computed lane by recalculation, never here: migration 005's cells
    // trigger ties the origin to the field (D51).
    if (value === undefined || isComputedField(field)) {
      continue;
    }
    const projected = projectCellValue(field, value);
    if (projected.lane !== null) {
      run(handle, INSERT_CELL, cellParameters(recordPk, field, projected.lane));
    }
    if (projected.issue !== null) {
      issues.push(projected.issue);
    }
  }
  return issues;
}

/** The validator's verdict, in the order it gave it; ordinals start at zero. */
function writeIssues(
  handle: ProjectionHandleV1,
  recordPk: number,
  issues: readonly ValidationIssueV1Input[],
): void {
  issues.forEach((issue, ordinal) => {
    run(handle, INSERT_RECORD_ISSUE, issueParameters(recordPk, issue, ordinal));
  });
}

/** Writes the cells, issues, and search row of an already-written record. */
function writeRecordContents(
  handle: ProjectionHandleV1,
  recordPk: number,
  record: ProjectionRecordV1,
): void {
  const laneIssues = writeLanes(handle, recordPk, record.record);
  writeIssues(handle, recordPk, [...record.issues, ...laneIssues]);
  run(handle, INSERT_SEARCH_ROW, [
    recordPk,
    searchableTextFor(handle.schema, record.record),
  ]);
}

/**
 * Rebuilds a live record's authored lanes and search text after its schema
 * moved (a type change sends a field to another lane). `issues` is the
 * validator's fresh verdict, or null to keep the one the record has.
 */
export function reindexRecord(
  handle: ProjectionHandleV1,
  recordPk: number,
  record: AuthoredRecordV1,
  issues: readonly ValidationIssueV1Input[] | null,
): void {
  run(handle, DELETE_AUTHORED_CELLS_FOR_RECORD, [recordPk]);
  run(handle, DELETE_SEARCH_ROW, [recordPk]);
  const laneIssues = writeLanes(handle, recordPk, record);
  if (issues !== null) {
    run(handle, DELETE_VALIDATOR_ISSUES_FOR_RECORD, [recordPk]);
    writeIssues(handle, recordPk, [...issues, ...laneIssues]);
  }
  run(handle, INSERT_SEARCH_ROW, [recordPk, searchableTextFor(handle.schema, record)]);
}

/** Inserts a live record with everything that hangs off it; returns its key. */
export function insertRecord(
  handle: ProjectionHandleV1,
  record: ProjectionRecordV1,
): number {
  run(handle, INSERT_RECORD, [
    record.record.recordId,
    record.record.tableId,
    toSqlInteger(record.recordRevision),
    record.createdCommitId,
    record.updatedCommitId,
    encodeAuthoredRecord(record.record),
  ]);

  const row = selectRow(handle, SELECT_LAST_INSERT_ROWID);
  const recordPk = Number(row?.[0]);
  if (!Number.isSafeInteger(recordPk) || recordPk <= 0) {
    throw new Error("projection did not assign a record key");
  }

  writeRecordContents(handle, recordPk, record);
  return recordPk;
}

/**
 * Replaces a live record's values in place. The row keeps its key — cursors,
 * FTS rowids, and issue identities all hang off it — while its authored
 * cells, the validator's issues, and its searchable text are rewritten from
 * the new authored state. Computed lanes and their issues are left to
 * recalculation, which recomputes only what the change reaches (D60).
 */
export function replaceRecord(
  handle: ProjectionHandleV1,
  recordPk: number,
  record: ProjectionRecordV1,
): void {
  run(handle, UPDATE_RECORD, [
    toSqlInteger(record.recordRevision),
    record.updatedCommitId,
    encodeAuthoredRecord(record.record),
    recordPk,
  ]);
  run(handle, DELETE_AUTHORED_CELLS_FOR_RECORD, [recordPk]);
  run(handle, DELETE_VALIDATOR_ISSUES_FOR_RECORD, [recordPk]);
  run(handle, DELETE_SEARCH_ROW, [recordPk]);
  writeRecordContents(handle, recordPk, record);
}
