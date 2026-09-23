/**
 * Schema, rule and formula edits (M34; CAP-35, CAP-36; CA-25, CA-27, CA-28;
 * D57, D59, D64).
 *
 * One preparation serves both halves of MOD-014: {@link previewSchemaChange}
 * and {@link executeSchemaChange} resolve the request against the app as the
 * projection holds it, count its impact with M02's one `analyzeSchemaChange`,
 * refuse a transition migration 005 or the domain would refuse, and draft
 * exactly the events CA-28 maps it to. So the counts a person approves are
 * the counts that commit (asserted), and an apply names the schema revision
 * its preview saw: a mismatch is `stale-preview`, with no commit.
 *
 * Everything commits through the command layer's one path (`commitEvents`):
 * encrypted and durable first, projection second (recalculated and
 * re-judged in the same transaction), acknowledgement last (invariant 1).
 * No value is ever discarded (D57): a conversion rewrites a value as a
 * `record.patched` in the same commit, a value that does not convert is kept
 * `invalid-preserved` and flagged, and every patched record passes the
 * shared validator first (invariant 5). A commit never splits across
 * segments (D38), so a change past the segment cap is refused `too-large`
 * before anything is written.
 */

import {
  CATALOG_VERSION,
  classifyFormula,
  formulaTableName,
  irNodesOf,
  translateAuthored,
  type AuthoredResolverV1,
  type FormulaDefinitionV1,
  type FormulaTargetV1,
} from "../../domain/formulas/index.js";
import type {
  AuthoredRecordV1,
  FieldChangeV1,
  FormulaMetadataV1,
  TableDefinitionV1,
} from "../../domain/model/events.js";
import {
  createDomainId,
  encodeDomainId,
  type FieldId,
  type FormulaId,
  type OptionId,
  type RecordId,
  type RelationshipId,
  type RuleId,
  type TableId,
} from "../../domain/model/ids.js";
import type { ValueProvenanceV1 } from "../../domain/model/provenance.js";
import {
  isComputedField,
  type EnumOptionDefV1,
  type FieldDefV1,
  type FieldTypeV1,
  type RelationshipDefV1,
  type TableDefV1,
} from "../../domain/model/schema.js";
import { cellValuesEqual, MISSING_VALUE, type CellValueV1 } from "../../domain/model/values.js";
import {
  RULE_V2_MESSAGE_KEYS,
  type RuleConditionV2,
  type ValidationRuleIRV2,
  type ValidationSeverityV1,
} from "../../domain/validation/rules.js";
import {
  analyzeSchemaChange,
  validateSchemaTransition,
  type ImpactReportV1,
  type SchemaChangeV1,
  type SchemaSnapshotV1,
  type SchemaTransitionRefusalV1,
} from "../../domain/validation/schema-impact.js";
import { validateRecord, type RecordUnderValidationV1 } from "../../domain/validation/validate-record.js";
import type { DomainEventV1, RecordRuleIRV1, SchemaImpactCountsV1 } from "../ports/event-repository.js";
import type { ProjectionEnginePort, ProjectionFormulaV1 } from "../ports/projection.js";
import type { AuthoredEventDraftV1 } from "./build-commit.js";
import {
  commitEvents,
  formulaClockOf,
  liveRecordCount,
  projectionReferenceResolver,
  type CommandDependenciesV1,
  type CommittedV1,
} from "./execute-command.js";
import { formulaRowOf, frozenLiteral, liveResult, ProjectionRows, projectionFormulaEnv, type FormulaRowV1 } from "./formula-env.js";

// ------------------------------------------------------------------ requests --

/** Where a saved formula's result lives; a new computed column brings its field. */
export type FormulaTargetRequestV1 =
  | {
      readonly kind: "computed-column";
      readonly tableId: TableId;
      /** The computed field being re-saved, or null for a new column. */
      readonly fieldId: FieldId | null;
      readonly newField: { readonly displayName: string; readonly type: FieldTypeV1 } | null;
    }
  | { readonly kind: "table-metric"; readonly tableId: TableId }
  | { readonly kind: "dashboard-value"; readonly tableId: TableId | null };

/**
 * D59's closed change union as a person expresses it: names and structured
 * clauses, never IDs a command must invent. The command allocates every new
 * ID from `EntropyPort` and translates formula text itself (D58).
 */
export type SchemaChangeRequestV1 =
  | { readonly kind: "rename-app"; readonly name: string }
  | { readonly kind: "rename-table"; readonly tableId: TableId; readonly name: string }
  | { readonly kind: "set-table-label"; readonly tableId: TableId; readonly labelFieldId: FieldId | null }
  | { readonly kind: "set-table-key"; readonly tableId: TableId; readonly keyFieldId: FieldId | null }
  | {
      readonly kind: "create-field";
      readonly tableId: TableId;
      readonly displayName: string;
      readonly type: FieldTypeV1;
      readonly isRequired: boolean;
      /** An enum field's option labels, in order; empty otherwise. */
      readonly optionLabels: readonly string[];
    }
  | { readonly kind: "rename-field"; readonly fieldId: FieldId; readonly name: string }
  | { readonly kind: "change-field-type"; readonly fieldId: FieldId; readonly type: FieldTypeV1 }
  | { readonly kind: "set-required"; readonly fieldId: FieldId; readonly isRequired: boolean }
  | { readonly kind: "deactivate-field"; readonly fieldId: FieldId }
  | { readonly kind: "reactivate-field"; readonly fieldId: FieldId }
  | { readonly kind: "reorder-fields"; readonly tableId: TableId; readonly fieldIds: readonly FieldId[] }
  | {
      readonly kind: "set-enum-options";
      readonly fieldId: FieldId;
      /** The options a person keeps, in order; a new one has no ID yet. Dropped ones turn inactive. */
      readonly options: readonly { readonly optionId: OptionId | null; readonly label: string; readonly isActive: boolean }[];
    }
  | {
      readonly kind: "set-relationship";
      /** Null creates one (converting the field to a reference, D64). */
      readonly relationshipId: RelationshipId | null;
      readonly fromFieldId: FieldId;
      readonly toTableId: TableId;
      readonly isActive: boolean;
    }
  | { readonly kind: "remove-relationship"; readonly relationshipId: RelationshipId }
  | {
      readonly kind: "save-rule";
      readonly ruleId: RuleId | null;
      readonly tableId: TableId;
      readonly displayName: string;
      readonly condition: RuleConditionV2;
      readonly severity: ValidationSeverityV1;
    }
  | { readonly kind: "remove-rule"; readonly ruleId: RuleId }
  | {
      readonly kind: "save-formula";
      /** The formula being edited, or null for a new one. */
      readonly formulaId: FormulaId | null;
      readonly target: FormulaTargetRequestV1;
      /** A metric's or dashboard value's label; null for a computed column. */
      readonly displayName: string | null;
      /** D58 syntax, with or without its leading `=`. */
      readonly text: string;
    }
  | { readonly kind: "remove-formula"; readonly formulaId: FormulaId };

// ------------------------------------------------------------------ results --

export const SCHEMA_INVALID_CHANGE_REASONS = Object.freeze([
  "empty-name",
  "not-an-enum",
  "not-a-permutation",
  "target-has-no-key",
  "not-a-computed-field",
  "computed-field",
  "target-mismatch",
  "no-new-field",
] as const);

/** Why a change cannot be made; typed, and never carrying a cell value (CA-12). */
export type SchemaRefusalV1 =
  | {
      readonly kind: "unknown-subject";
      readonly subject: "table" | "field" | "relationship" | "rule" | "formula" | "option";
    }
  | { readonly kind: "invalid-change"; readonly reason: (typeof SCHEMA_INVALID_CHANGE_REASONS)[number] }
  /** The formula editor's refusal, with where in the text it points when that is knowable. */
  | {
      readonly kind: "formula";
      readonly reason: string;
      readonly detail: string | null;
      /** A 0-based UTF-16 offset into the submitted text, or null. */
      readonly position: number | null;
    }
  | { readonly kind: "transition"; readonly refusals: readonly SchemaTransitionRefusalV1[] }
  /** A converted value would make a record fail the shared validator (invariant 5). */
  | { readonly kind: "validation"; readonly recordCount: number };

/** D38: one commit never splits across segments of 10,000 events / 16 MiB. */
export interface SchemaCommitLimitsV1 {
  readonly maxEvents: number;
  readonly maxBytes: number;
}

export const SEGMENT_LIMITS: SchemaCommitLimitsV1 = Object.freeze({ maxEvents: 10_000, maxBytes: 16 * 1024 * 1024 });

export interface SchemaPreviewV1 {
  readonly schemaRevision: bigint;
  readonly impact: SchemaImpactCountsV1;
  /** The events the change would commit, counted exactly. */
  readonly eventCount: number;
  readonly refusal: SchemaRefusalV1 | null;
  /** Past the segment cap: the apply is refused and the preview says so first. */
  readonly isTooLarge: boolean;
}

export type SchemaApplyResultV1 =
  | ({ readonly result: "applied"; readonly impact: SchemaImpactCountsV1; readonly schemaRevision: bigint } & CommittedV1)
  | { readonly result: "stale-preview"; readonly schemaRevision: bigint }
  | { readonly result: "refused"; readonly refusal: SchemaRefusalV1 }
  | { readonly result: "too-large"; readonly eventCount: number; readonly byteLength: number; readonly limits: SchemaCommitLimitsV1 };

/** A definition a prior-hash names, digested over its canonical bytes by the worker. */
export type DefinitionDigestSubjectV1 =
  | { readonly kind: "app-name"; readonly name: string }
  | { readonly kind: "table"; readonly table: TableDefinitionV1 }
  | { readonly kind: "options"; readonly options: readonly EnumOptionDefV1[] }
  | { readonly kind: "relationship"; readonly relationship: RelationshipDefV1 }
  | { readonly kind: "rule"; readonly rule: RecordRuleIRV1 }
  | { readonly kind: "formula"; readonly formula: FormulaDefinitionV1 };

export interface SchemaCommandDependenciesV1
  extends Pick<CommandDependenciesV1, "clock" | "entropy" | "projection" | "repository" | "recordDigest" | "formulaClock"> {
  /** SHA-256 of a definition's canonical bytes (M09 + M08, in the worker). */
  readonly definitionDigest: (subject: DefinitionDigestSubjectV1) => Promise<Uint8Array>;
  /** The inference rejection fingerprint of a removed relationship (FR-7; F03's function). */
  readonly rejectionFingerprint: (relationship: RelationshipDefV1) => Promise<Uint8Array>;
  /** The encoded size of one event's payload, for the segment cap. */
  readonly payloadByteLength: (event: DomainEventV1) => number;
  readonly limits?: SchemaCommitLimitsV1;
}

/** Fixed per-event framing beyond the payload, a deliberately generous bound. */
const EVENT_OVERHEAD_BYTES = 256;

// ------------------------------------------------------------------ entrances --

export async function previewSchemaChange(
  deps: SchemaCommandDependenciesV1,
  request: SchemaChangeRequestV1,
): Promise<SchemaPreviewV1> {
  const schemaRevision = currentSchemaRevision(deps.projection);
  const prepared = prepare(deps, request);
  if ("refusal" in prepared) {
    return { schemaRevision, impact: emptyImpact(request.kind), eventCount: 0, refusal: prepared.refusal, isTooLarge: false };
  }
  const drafts = await draftEvents(deps, prepared);
  const size = sizeOf(deps, drafts);
  return {
    schemaRevision,
    impact: countsOf(prepared.impact),
    eventCount: drafts.length,
    refusal: null,
    isTooLarge: size.isTooLarge,
  };
}

/**
 * Applies a previewed change. The preview's revision must still be the app's
 * (`stale-preview` otherwise); the impact is recomputed at that same revision,
 * so it equals the preview's.
 */
export async function executeSchemaChange(
  deps: SchemaCommandDependenciesV1,
  request: SchemaChangeRequestV1,
  previewedSchemaRevision: bigint,
): Promise<SchemaApplyResultV1> {
  const schemaRevision = currentSchemaRevision(deps.projection);
  if (schemaRevision !== previewedSchemaRevision) {
    return { result: "stale-preview", schemaRevision };
  }
  const prepared = prepare(deps, request);
  if ("refusal" in prepared) {
    return { result: "refused", refusal: prepared.refusal };
  }
  const drafts = await draftEvents(deps, prepared);
  const size = sizeOf(deps, drafts);
  if (size.isTooLarge) {
    return { result: "too-large", eventCount: drafts.length, byteLength: size.byteLength, limits: size.limits };
  }
  const committed = await commitEvents(deps, drafts, {
    rowCountAfter: liveRecordCount(deps.projection),
    isSchemaChange: true,
  });
  return {
    result: "applied",
    impact: countsOf(prepared.impact),
    schemaRevision: currentSchemaRevision(deps.projection),
    ...committed,
  };
}

// ------------------------------------------------------------------ snapshot --

interface RuleEntryV1 {
  readonly tableId: TableId;
  readonly displayName: string;
  readonly rule: RecordRuleIRV1;
}

/** The app's schema as the projection holds it, plus what a change needs to name. */
interface AppSchemaV1 {
  readonly snapshot: SchemaSnapshotV1;
  readonly rules: readonly RuleEntryV1[];
  readonly formulas: readonly ProjectionFormulaV1[];
  readonly revision: bigint;
}

const key = (id: Uint8Array): string => encodeDomainId(id as FieldId);
const same = (left: Uint8Array | null, right: Uint8Array | null): boolean =>
  left !== null && right !== null && key(left) === key(right);

function readSchema(projection: ProjectionEnginePort): AppSchemaV1 {
  const tables: TableDefV1[] = projection
    .execute({ kind: "list-tables" })
    .map((table) => ({ ...table, fields: projection.execute({ kind: "list-fields", tableId: table.tableId }) }));
  const enumOptions = tables.flatMap((table) =>
    table.fields
      .filter((field) => field.type.kind === "enum")
      .flatMap((field) => projection.execute({ kind: "list-enum-options", fieldId: field.fieldId })),
  );
  const rules = tables.flatMap((table) =>
    projection
      .execute({ kind: "list-validation-rules", tableId: table.tableId })
      .map((entry) => ({ tableId: table.tableId, displayName: entry.displayName, rule: entry.rule })),
  );
  const formulas = projection.execute({ kind: "list-formulas", tableId: null });
  return {
    snapshot: {
      tables,
      enumOptions,
      relationships: projection.execute({ kind: "list-relationships", tableId: null }).map((entry) => entry.relationship),
      rules: rules.map((entry) => entry.rule),
      formulas: formulas.map((entry) => entry.formula),
    },
    rules,
    formulas,
    revision: currentSchemaRevision(projection),
  };
}

function currentSchemaRevision(projection: ProjectionEnginePort): bigint {
  return projection.execute({ kind: "app-state" }).schemaRevision;
}

const allFields = (schema: SchemaSnapshotV1): readonly FieldDefV1[] => schema.tables.flatMap((table) => table.fields);
const fieldById = (schema: SchemaSnapshotV1, fieldId: FieldId): FieldDefV1 | undefined =>
  allFields(schema).find((field) => same(field.fieldId, fieldId));
const tableById = (schema: SchemaSnapshotV1, tableId: TableId | null): TableDefV1 | undefined =>
  tableId === null ? undefined : schema.tables.find((table) => same(table.tableId, tableId));

/** A schema with one table's definition or one field replaced. */
const withTable = (schema: SchemaSnapshotV1, tableId: TableId, change: (table: TableDefV1) => TableDefV1): SchemaSnapshotV1 => ({
  ...schema,
  tables: schema.tables.map((table) => (same(table.tableId, tableId) ? change(table) : table)),
});
const withField = (schema: SchemaSnapshotV1, field: FieldDefV1): SchemaSnapshotV1 =>
  withTable(schema, field.tableId, (table) => ({
    ...table,
    fields: table.fields.some((candidate) => same(candidate.fieldId, field.fieldId))
      ? table.fields.map((candidate) => (same(candidate.fieldId, field.fieldId) ? field : candidate))
      : [...table.fields, field],
  }));

// ------------------------------------------------------------------- prepare --

interface PreparedV1 {
  readonly request: SchemaChangeRequestV1;
  readonly app: AppSchemaV1;
  readonly change: SchemaChangeV1;
  readonly after: SchemaSnapshotV1;
  readonly impact: ImpactReportV1;
  /** The records the change reads, as validated and as formulas read them. */
  readonly rows: ReadonlyMap<string, FormulaRowV1>;
  readonly revisions: ReadonlyMap<string, bigint>;
  /** Value patches beyond the impact's own: a frozen column's once-evaluated literals. */
  readonly literalPatches: readonly { readonly recordId: RecordId; readonly fieldId: FieldId; readonly value: CellValueV1 }[];
  readonly formula: { readonly definition: FormulaDefinitionV1; readonly metadata: FormulaMetadataV1; readonly newField: FieldDefV1 | null } | null;
}

type PreparedOrRefusalV1 = PreparedV1 | { readonly refusal: SchemaRefusalV1 };

const refuse = (refusal: SchemaRefusalV1): { readonly refusal: SchemaRefusalV1 } => ({ refusal });

function prepare(deps: SchemaCommandDependenciesV1, request: SchemaChangeRequestV1): PreparedOrRefusalV1 {
  const app = readSchema(deps.projection);
  const next = app.revision + 1n;
  const resolved = resolve(deps, app, request, next);
  if ("refusal" in resolved) return resolved;
  const { change, after } = resolved;

  const projectionRows = new ProjectionRows(deps.projection);
  const tableId = affectedTable(app, change);
  const summaries = tableId === null ? [] : projectionRows.summaries(tableId);
  const rows = new Map(summaries.map((summary) => [key(summary.recordId), formulaRowOf(summary)]));
  const revisions = new Map(summaries.map((summary) => [key(summary.recordId), summary.recordRevision]));
  const records: RecordUnderValidationV1[] = summaries.map((summary) => ({
    recordId: summary.recordId,
    tableId: summary.tableId,
    values: summary.authoredValues,
  }));
  const env = projectionFormulaEnv(deps.projection, projectionRows, formulaClockOf(deps));

  const impact = analyzeSchemaChange(change, app.snapshot, records, {
    resolveKey: (targetTableId, keyText) => resolveKey(app.snapshot, projectionRows, targetTableId, keyText),
    referenceExists: projectionReferenceResolver(deps.projection),
    formulaResult: (formula, record) => {
      const row = rows.get(key(record.recordId));
      return row === undefined ? { kind: "empty" } : liveResult(formula, row, env);
    },
  });

  if (change.kind !== "rename-app") {
    // A change is refused for what it would break, not for what already is:
    // a condition the schema holds before the change (a reference left
    // unlinked by an earlier removal) is not this change's to answer for.
    const standing = new Set(validateSchemaTransition(app.snapshot, app.snapshot).refusals.map(refusalKey));
    const refusals = validateSchemaTransition(app.snapshot, after).refusals.filter(
      (refusal) =>
        !standing.has(refusalKey(refusal)) &&
        // A removed relationship leaves its reference field and values in
        // place, unlinked (CA-28): that one field is not a refusal.
        !(
          change.kind === "remove-relationship" &&
          refusal.kind === "reference-without-relationship" &&
          refusal.fieldId !== null &&
          app.snapshot.relationships.some(
            (relationship) => same(relationship.relationshipId, change.relationshipId) && same(relationship.fromFieldId, refusal.fieldId),
          )
        ),
    );
    if (refusals.length > 0) return refuse({ kind: "transition", refusals });
  }

  const literalPatches =
    resolved.formula?.definition.disposition === "frozen" && resolved.formula.definition.target.kind === "computed-column"
      ? frozenPatches(deps, resolved.formula.definition, [...rows.values()], env)
      : [];

  const invalid = patchedRecordsFailing(deps, after, change, impact, literalPatches, rows);
  if (invalid > 0) return refuse({ kind: "validation", recordCount: invalid });

  return { request, app, change, after, impact, rows, revisions, literalPatches, formula: resolved.formula };
}

const refusalKey = (refusal: SchemaTransitionRefusalV1): string =>
  `${refusal.kind}|${refusal.fieldId === null ? "" : key(refusal.fieldId)}|${refusal.messageKey ?? ""}`;

function affectedTable(app: AppSchemaV1, change: SchemaChangeV1): TableId | null {
  switch (change.kind) {
    case "rename-app":
      return null;
    case "rename-table":
    case "set-table-label":
    case "set-table-key":
    case "reorder-fields":
    case "save-rule":
      return change.tableId;
    case "create-field":
      return change.field.tableId;
    case "rename-field":
    case "change-field-type":
    case "set-required":
    case "deactivate-field":
    case "reactivate-field":
    case "set-enum-options":
      return fieldById(app.snapshot, change.fieldId)?.tableId ?? null;
    case "set-relationship":
      return change.relationship.fromTableId;
    case "remove-relationship":
      return app.snapshot.relationships.find((relationship) => same(relationship.relationshipId, change.relationshipId))?.fromTableId ?? null;
    case "remove-rule":
      return app.rules.find((entry) => same(entry.rule.ruleId, change.ruleId))?.tableId ?? null;
    case "save-formula":
      return change.formula.target.tableId;
    case "remove-formula":
      return app.formulas.find((entry) => same(entry.formula.formulaId, change.formulaId))?.formula.target.tableId ?? null;
    default: {
      const unreachable: never = change;
      return unreachable;
    }
  }
}

/** The live record of a table whose key reads `keyText` (D57 key matching). */
function resolveKey(schema: SchemaSnapshotV1, rows: ProjectionRows, tableId: TableId, keyText: string): RecordId | null {
  const table = tableById(schema, tableId);
  if (table === undefined || table.keyFieldId === null) return null;
  const keyField = table.keyFieldId;
  const match = rows.of(tableId).find((row) => {
    const value = row.values.get(key(keyField));
    const text = value === undefined ? null : textOf(value);
    return text !== null && text.normalize("NFC").trim() === keyText;
  });
  return match?.recordId ?? null;
}

const textOf = (value: CellValueV1): string | null => {
  switch (value.kind) {
    case "text":
      return value.text;
    case "decimal":
      return value.decimal;
    case "invalid-preserved":
      return value.sourceText;
    default:
      return null;
  }
};

/** A frozen column's literal for every existing record, evaluated once each (D51). */
function frozenPatches(
  deps: SchemaCommandDependenciesV1,
  formula: FormulaDefinitionV1,
  rows: readonly FormulaRowV1[],
  env: ReturnType<typeof projectionFormulaEnv>,
): PreparedV1["literalPatches"] {
  if (formula.target.kind !== "computed-column") return [];
  const fieldId = formula.target.fieldId;
  return rows.flatMap((row) => {
    const value = frozenLiteral(formula, row, deps.entropy, env);
    return value === null ? [] : [{ recordId: row.recordId, fieldId, value }];
  });
}

/**
 * Invariant 5 for a conversion: every record a patch rewrites is validated
 * against the schema as it will stand. A value kept `invalid-preserved` is a
 * warning, never a refusal; only a blocking verdict refuses the change.
 */
function patchedRecordsFailing(
  deps: SchemaCommandDependenciesV1,
  after: SchemaSnapshotV1,
  change: SchemaChangeV1,
  impact: ImpactReportV1,
  literals: PreparedV1["literalPatches"],
  rows: ReadonlyMap<string, FormulaRowV1>,
): number {
  const patches = [...impact.patches, ...literals];
  if (patches.length === 0) return 0;
  const byRecord = new Map<string, (typeof patches)[number][]>();
  for (const patch of patches) {
    byRecord.set(key(patch.recordId), [...(byRecord.get(key(patch.recordId)) ?? []), patch]);
  }
  let failing = 0;
  for (const [recordKey, recordPatches] of byRecord) {
    const row = rows.get(recordKey);
    const tableId = affectedTableOfPatch(after, recordPatches[0]?.fieldId ?? null);
    const table = tableById(after, tableId);
    if (row === undefined || table === undefined) continue;
    const values = new Map<FieldId, CellValueV1>(
      table.fields.flatMap((field) => {
        const value = row.values.get(key(field.fieldId));
        return value === undefined ? [] : [[field.fieldId, value] as const];
      }),
    );
    const provenance = new Map<FieldId, ValueProvenanceV1>();
    for (const patch of recordPatches) {
      const field = table.fields.find((candidate) => same(candidate.fieldId, patch.fieldId));
      if (field === undefined) continue;
      values.set(field.fieldId, patch.value);
      provenance.set(field.fieldId, provenanceOfPatch(change, patch.fieldId, after));
    }
    const report = validateRecord(
      {
        table,
        enumOptions: new Map(
          table.fields
            .filter((field) => field.type.kind === "enum")
            .map((field) => [field.fieldId, after.enumOptions.filter((option) => same(option.fieldId, field.fieldId))] as const),
        ),
        rules: after.rules,
        referenceExists: projectionReferenceResolver(deps.projection),
        referenceTargets: after.relationships
          .filter((relationship) => relationship.isActive && same(relationship.fromTableId, table.tableId))
          .map((relationship) => ({
            fieldId: table.fields.find((field) => same(field.fieldId, relationship.fromFieldId))?.fieldId ?? relationship.fromFieldId,
            tableId: relationship.toTableId,
            tableLabel: tableById(after, relationship.toTableId)?.displayName ?? "",
          })),
      },
      { recordId: row.recordId, tableId: table.tableId, values, provenance },
    );
    if (!report.isValid) failing += 1;
  }
  return failing;
}

const affectedTableOfPatch = (schema: SchemaSnapshotV1, fieldId: FieldId | null): TableId | null =>
  fieldId === null ? null : (fieldById(schema, fieldId)?.tableId ?? null);

/** D57: a converted value is the user's; a frozen literal carries its formula text. */
function provenanceOfPatch(change: SchemaChangeV1, fieldId: FieldId, schema: SchemaSnapshotV1): ValueProvenanceV1 {
  if (change.kind === "save-formula" && change.formula.disposition === "frozen") {
    const field = fieldById(schema, fieldId);
    if (field !== undefined && isComputedField(field)) {
      return { source: "user", evidence: { frozen: change.formula.originalText } };
    }
  }
  return { source: "user" };
}

// ------------------------------------------------------------------- resolve --

type ResolvedV1 =
  | {
      readonly change: SchemaChangeV1;
      readonly after: SchemaSnapshotV1;
      readonly formula: PreparedV1["formula"];
    }
  | { readonly refusal: SchemaRefusalV1 };

const nameOf = (name: string): string | null => {
  const normalized = name.normalize("NFC").trim();
  return normalized.length === 0 ? null : normalized;
};

function resolve(
  deps: SchemaCommandDependenciesV1,
  app: AppSchemaV1,
  request: SchemaChangeRequestV1,
  next: bigint,
): ResolvedV1 {
  const before = app.snapshot;
  const plain = (change: SchemaChangeV1, after: SchemaSnapshotV1): ResolvedV1 => ({ change, after, formula: null });
  const fieldEdit = (fieldId: FieldId, edit: (field: FieldDefV1) => FieldDefV1, change: SchemaChangeV1): ResolvedV1 => {
    const field = fieldById(before, fieldId);
    if (field === undefined) return refuse({ kind: "unknown-subject", subject: "field" });
    return plain(change, withField(before, { ...edit(field), schemaRevision: next }));
  };
  const tableEdit = (tableId: TableId, edit: (table: TableDefV1) => TableDefV1, change: SchemaChangeV1): ResolvedV1 => {
    if (tableById(before, tableId) === undefined) return refuse({ kind: "unknown-subject", subject: "table" });
    return plain(change, withTable(before, tableId, (table) => ({ ...edit(table), schemaRevision: next })));
  };

  switch (request.kind) {
    case "rename-app": {
      const name = nameOf(request.name);
      return name === null ? refuse({ kind: "invalid-change", reason: "empty-name" }) : plain({ kind: "rename-app", name }, before);
    }
    case "rename-table": {
      const name = nameOf(request.name);
      if (name === null) return refuse({ kind: "invalid-change", reason: "empty-name" });
      return tableEdit(request.tableId, (table) => ({ ...table, displayName: name }), { kind: "rename-table", tableId: request.tableId, name });
    }
    case "set-table-label":
      return tableEdit(request.tableId, (table) => ({ ...table, labelFieldId: request.labelFieldId }), request);
    case "set-table-key":
      return tableEdit(request.tableId, (table) => ({ ...table, keyFieldId: request.keyFieldId }), request);
    case "create-field": {
      const table = tableById(before, request.tableId);
      if (table === undefined) return refuse({ kind: "unknown-subject", subject: "table" });
      const name = nameOf(request.displayName);
      if (name === null) return refuse({ kind: "invalid-change", reason: "empty-name" });
      const field: FieldDefV1 = {
        fieldId: createDomainId("field", deps.entropy),
        tableId: table.tableId,
        displayName: name,
        fieldOrdinal: nextOrdinal(table),
        type: request.type,
        isRequired: request.isRequired,
        isActive: true,
        schemaRevision: next,
      };
      const labels = request.type.kind === "enum" ? request.optionLabels.map(nameOf).filter((label): label is string => label !== null) : [];
      const enumOptions: EnumOptionDefV1[] = labels.map((displayLabel, optionOrdinal) => ({
        optionId: createDomainId("option", deps.entropy),
        fieldId: field.fieldId,
        displayLabel,
        optionOrdinal,
        isActive: true,
        schemaRevision: next,
      }));
      return plain(
        { kind: "create-field", field, enumOptions },
        { ...withField(before, field), enumOptions: [...before.enumOptions, ...enumOptions] },
      );
    }
    case "rename-field": {
      const name = nameOf(request.name);
      if (name === null) return refuse({ kind: "invalid-change", reason: "empty-name" });
      return fieldEdit(request.fieldId, (field) => ({ ...field, displayName: name }), { kind: "rename-field", fieldId: request.fieldId, name });
    }
    case "change-field-type": {
      const field = fieldById(before, request.fieldId);
      if (field !== undefined && isComputedField(field)) return refuse({ kind: "invalid-change", reason: "computed-field" });
      return fieldEdit(request.fieldId, (current) => ({ ...current, type: request.type }), request);
    }
    case "set-required":
      return fieldEdit(request.fieldId, (field) => ({ ...field, isRequired: request.isRequired }), request);
    case "deactivate-field":
      return fieldEdit(request.fieldId, (field) => ({ ...field, isActive: false }), request);
    case "reactivate-field":
      return fieldEdit(request.fieldId, (field) => ({ ...field, isActive: true }), request);
    case "reorder-fields": {
      const table = tableById(before, request.tableId);
      if (table === undefined) return refuse({ kind: "unknown-subject", subject: "table" });
      const ordered = request.fieldIds.map((fieldId) => table.fields.find((field) => same(field.fieldId, fieldId)));
      if (
        ordered.length !== table.fields.length ||
        ordered.some((field) => field === undefined) ||
        new Set(request.fieldIds.map(key)).size !== table.fields.length
      ) {
        return refuse({ kind: "invalid-change", reason: "not-a-permutation" });
      }
      const fields = (ordered as FieldDefV1[]).map((field, fieldOrdinal) =>
        field.fieldOrdinal === fieldOrdinal ? field : { ...field, fieldOrdinal, schemaRevision: next },
      );
      return plain(
        { kind: "reorder-fields", tableId: table.tableId, fieldIds: fields.map((field) => field.fieldId) },
        withTable(before, table.tableId, (current) => ({ ...current, fields })),
      );
    }
    case "set-enum-options": {
      const field = fieldById(before, request.fieldId);
      if (field === undefined) return refuse({ kind: "unknown-subject", subject: "field" });
      if (field.type.kind !== "enum") return refuse({ kind: "invalid-change", reason: "not-an-enum" });
      const existing = before.enumOptions.filter((option) => same(option.fieldId, field.fieldId));
      const kept: EnumOptionDefV1[] = [];
      for (const entry of request.options) {
        const label = nameOf(entry.label);
        if (label === null) return refuse({ kind: "invalid-change", reason: "empty-name" });
        const prior = entry.optionId === null ? undefined : existing.find((option) => same(option.optionId, entry.optionId));
        if (entry.optionId !== null && prior === undefined) return refuse({ kind: "unknown-subject", subject: "option" });
        kept.push({
          optionId: prior?.optionId ?? createDomainId("option", deps.entropy),
          fieldId: field.fieldId,
          displayLabel: label,
          optionOrdinal: kept.length,
          isActive: entry.isActive,
          schemaRevision: next,
        });
      }
      // A dropped option is never deleted: it stays, inactive, after the rest.
      const dropped = existing
        .filter((option) => !kept.some((candidate) => same(candidate.optionId, option.optionId)))
        .map((option, index) => ({ ...option, isActive: false, optionOrdinal: kept.length + index, schemaRevision: next }));
      const options = [...kept, ...dropped];
      return plain(
        { kind: "set-enum-options", fieldId: field.fieldId, options },
        { ...before, enumOptions: [...before.enumOptions.filter((option) => !same(option.fieldId, field.fieldId)), ...options] },
      );
    }
    case "set-relationship": {
      const source = fieldById(before, request.fromFieldId);
      if (source === undefined) return refuse({ kind: "unknown-subject", subject: "field" });
      const target = tableById(before, request.toTableId);
      if (target === undefined) return refuse({ kind: "unknown-subject", subject: "table" });
      if (target.keyFieldId === null) return refuse({ kind: "invalid-change", reason: "target-has-no-key" });
      const existing =
        request.relationshipId === null
          ? undefined
          : before.relationships.find((relationship) => same(relationship.relationshipId, request.relationshipId));
      if (request.relationshipId !== null && existing === undefined) return refuse({ kind: "unknown-subject", subject: "relationship" });
      const relationship: RelationshipDefV1 = {
        relationshipId: existing?.relationshipId ?? createDomainId("relationship", deps.entropy),
        fromTableId: source.tableId,
        fromFieldId: source.fieldId,
        toTableId: target.tableId,
        toKeyFieldId: target.keyFieldId,
        detectionSource: existing?.detectionSource ?? "user",
        isActive: request.isActive,
        schemaRevision: next,
      };
      const converted = source.type.kind === "reference" ? before : withField(before, { ...source, type: { kind: "reference" }, schemaRevision: next });
      return plain(
        { kind: "set-relationship", relationship },
        {
          ...converted,
          relationships: [
            ...converted.relationships.filter((candidate) => !same(candidate.relationshipId, relationship.relationshipId)),
            relationship,
          ],
        },
      );
    }
    case "remove-relationship": {
      const existing = before.relationships.find((relationship) => same(relationship.relationshipId, request.relationshipId));
      if (existing === undefined) return refuse({ kind: "unknown-subject", subject: "relationship" });
      return plain(
        { kind: "remove-relationship", relationshipId: existing.relationshipId, rejectionFingerprint: null },
        { ...before, relationships: before.relationships.filter((relationship) => relationship !== existing) },
      );
    }
    case "save-rule": {
      if (tableById(before, request.tableId) === undefined) return refuse({ kind: "unknown-subject", subject: "table" });
      const name = nameOf(request.displayName);
      if (name === null) return refuse({ kind: "invalid-change", reason: "empty-name" });
      if (request.ruleId !== null && !app.rules.some((entry) => same(entry.rule.ruleId, request.ruleId))) {
        return refuse({ kind: "unknown-subject", subject: "rule" });
      }
      const rule = ruleOf(before, request, request.ruleId ?? createDomainId("rule", deps.entropy), name);
      return plain(
        { kind: "save-rule", tableId: request.tableId, displayName: name, rule },
        { ...before, rules: [...before.rules.filter((candidate) => !same(candidate.ruleId, rule.ruleId)), rule] },
      );
    }
    case "remove-rule": {
      const existing = app.rules.find((entry) => same(entry.rule.ruleId, request.ruleId));
      if (existing === undefined) return refuse({ kind: "unknown-subject", subject: "rule" });
      return plain(request, { ...before, rules: before.rules.filter((rule) => !same(rule.ruleId, request.ruleId)) });
    }
    case "save-formula":
      return resolveFormula(deps, app, request, next);
    case "remove-formula": {
      const existing = app.formulas.find((entry) => entry.isActive && same(entry.formula.formulaId, request.formulaId));
      if (existing === undefined) return refuse({ kind: "unknown-subject", subject: "formula" });
      const target = existing.formula.target;
      const after =
        target.kind === "computed-column"
          ? (() => {
              const field = fieldById(before, target.fieldId);
              return field === undefined ? before : withField(before, { ...field, isActive: false, schemaRevision: next });
            })()
          : before;
      return plain(request, after);
    }
    default: {
      const unreachable: never = request;
      return unreachable;
    }
  }
}

const nextOrdinal = (table: TableDefV1): number => table.fields.reduce((highest, field) => Math.max(highest, field.fieldOrdinal + 1), 0);

/**
 * A structured clause becomes rule IR v2 (D52): message key and parameters
 * from the clause's shape, with field labels and never a value (CA-12).
 */
function ruleOf(
  schema: SchemaSnapshotV1,
  request: Extract<SchemaChangeRequestV1, { kind: "save-rule" }>,
  ruleId: RuleId,
  displayName: string,
): ValidationRuleIRV2 {
  const labelOf = (fieldId: FieldId): string => fieldById(schema, fieldId)?.displayName ?? "";
  const condition = request.condition;
  const [messageKey, messageParameters] =
    condition.kind === "compare"
      ? [
          RULE_V2_MESSAGE_KEYS[0],
          {
            ruleLabel: displayName,
            leftLabel: labelOf(condition.left),
            operator: condition.op,
            ...("field" in condition.right ? { rightLabel: labelOf(condition.right.field) } : { valueType: condition.right.value.kind }),
          },
        ]
      : condition.kind === "between" || condition.kind === "not-between"
        ? [RULE_V2_MESSAGE_KEYS[1], { ruleLabel: displayName, fieldLabel: labelOf(condition.fieldId), valueType: condition.low.kind }]
        : ["validation.rule", { ruleLabel: displayName }];
  return { irVersion: 2, ruleId, condition, severity: request.severity, messageKey, messageParameters };
}

/**
 * D58 text → IR, through M03's authored translator over the app's current
 * names; classification decides live/frozen/unsupported (D49). An
 * unparseable text or an unknown name is the editor's refusal, pointing at
 * where it can.
 */
function resolveFormula(
  deps: SchemaCommandDependenciesV1,
  app: AppSchemaV1,
  request: Extract<SchemaChangeRequestV1, { kind: "save-formula" }>,
  next: bigint,
): ResolvedV1 {
  const before = app.snapshot;
  const existing =
    request.formulaId === null ? undefined : app.formulas.find((entry) => same(entry.formula.formulaId, request.formulaId));
  if (request.formulaId !== null && existing === undefined) return refuse({ kind: "unknown-subject", subject: "formula" });
  const formulaId = existing?.formula.formulaId ?? createDomainId("formula", deps.entropy);
  const requested = request.target;

  let target: FormulaTargetV1;
  let newField: FieldDefV1 | null = null;
  let rowTable: TableDefV1 | undefined;
  switch (requested.kind) {
    case "computed-column": {
      rowTable = tableById(before, requested.tableId);
      if (rowTable === undefined) return refuse({ kind: "unknown-subject", subject: "table" });
      if (requested.fieldId === null) {
        if (requested.newField === null) return refuse({ kind: "invalid-change", reason: "no-new-field" });
        const name = nameOf(requested.newField.displayName);
        if (name === null) return refuse({ kind: "invalid-change", reason: "empty-name" });
        newField = {
          fieldId: createDomainId("field", deps.entropy),
          tableId: rowTable.tableId,
          displayName: name,
          fieldOrdinal: nextOrdinal(rowTable),
          type: requested.newField.type,
          isRequired: false,
          isActive: true,
          schemaRevision: next,
          formulaId,
        };
        target = { kind: "computed-column", tableId: rowTable.tableId, fieldId: newField.fieldId };
      } else {
        const field = fieldById(before, requested.fieldId);
        if (field === undefined) return refuse({ kind: "unknown-subject", subject: "field" });
        if (field.formulaId === undefined || !same(field.formulaId, formulaId)) {
          return refuse({ kind: "invalid-change", reason: field.formulaId === undefined ? "not-a-computed-field" : "target-mismatch" });
        }
        target = { kind: "computed-column", tableId: field.tableId, fieldId: field.fieldId };
      }
      break;
    }
    case "table-metric":
      if (tableById(before, requested.tableId) === undefined) return refuse({ kind: "unknown-subject", subject: "table" });
      target = { kind: "table-metric", tableId: requested.tableId };
      break;
    case "dashboard-value":
      if (requested.tableId !== null && tableById(before, requested.tableId) === undefined) {
        return refuse({ kind: "unknown-subject", subject: "table" });
      }
      target = { kind: "dashboard-value", tableId: requested.tableId };
      break;
    default: {
      const unreachable: never = requested;
      return unreachable;
    }
  }
  if (existing !== undefined && existing.formula.target.kind !== target.kind) {
    return refuse({ kind: "invalid-change", reason: "target-mismatch" });
  }

  const text = request.text.normalize("NFC").trim().replace(/^=/, "");
  const translation = translateAuthored(text, authoredResolver(before, app.formulas, rowTable ?? null, formulaId));
  if (translation.kind !== "translated") {
    const detail = translation.kind === "unknown-name" ? translation.name : translation.detail;
    const at = detail === null ? -1 : text.indexOf(detail.replace(/^\[|\]$/g, ""));
    return refuse({
      kind: "formula",
      reason: translation.kind === "unknown-name" ? "unknown-name" : translation.reason,
      detail,
      position: at < 0 ? null : at,
    });
  }
  const classification = classifyFormula(translation.document);
  const definition: FormulaDefinitionV1 = {
    formulaId,
    target,
    displayName: target.kind === "computed-column" ? null : nameOf(request.displayName ?? ""),
    originalText: text,
    document: translation.document,
    disposition: classification.disposition,
    determinism: classification.determinism,
    dependencies: translation.dependencies,
  };
  const metadata: FormulaMetadataV1 = {
    catalogVersion: CATALOG_VERSION,
    functionVersions: functionVersionsOf(definition),
    source: "authored",
    importedValuePolicy: "none",
  };
  const withNew = newField === null ? before : withField(before, newField);
  return {
    change: { kind: "save-formula", formula: definition, field: newField },
    after: {
      ...withNew,
      formulas: [...withNew.formulas.filter((formula) => !same(formula.formulaId, formulaId)), definition],
    },
    formula: { definition, metadata, newField },
  };
}

function functionVersionsOf(formula: FormulaDefinitionV1): FormulaMetadataV1["functionVersions"] {
  if (formula.document === null) return [];
  const versions = new Map<string, number>();
  for (const node of irNodesOf(formula.document.root)) {
    if (node.kind === "call") versions.set(node.name, node.version);
  }
  return [...versions].sort(([left], [right]) => (left < right ? -1 : 1)).map(([name, version]) => ({ name, version }));
}

/** The current-name questions D58 text asks, answered from the app's schema. */
function authoredResolver(
  schema: SchemaSnapshotV1,
  formulas: readonly ProjectionFormulaV1[],
  rowTable: TableDefV1 | null,
  self: FormulaId,
): AuthoredResolverV1 {
  const named = (candidates: readonly FieldDefV1[], name: string): FieldDefV1 | undefined =>
    candidates.find((field) => field.isActive && field.displayName.normalize("NFC") === name.normalize("NFC"));
  const tableNamed = (name: string): TableDefV1 | undefined =>
    schema.tables.find((table) => table.isActive && (formulaTableName(table.displayName) === name || table.displayName === name));
  return {
    thisRowField: (name) => (rowTable === null ? null : (named(rowTable.fields, name)?.fieldId ?? null)),
    tableColumn: (tableName, column) => {
      const table = tableNamed(tableName);
      const field = table === undefined ? undefined : named(table.fields, column);
      return table === undefined || field === undefined ? null : { tableId: table.tableId, fieldId: field.fieldId };
    },
    relatedField: (referenceName, fieldName) => {
      if (rowTable === null) return null;
      const reference = named(rowTable.fields, referenceName);
      const relationship =
        reference === undefined
          ? undefined
          : schema.relationships.find((candidate) => candidate.isActive && same(candidate.fromFieldId, reference.fieldId));
      const target = relationship === undefined ? undefined : tableById(schema, relationship.toTableId);
      const field = target === undefined ? undefined : named(target.fields, fieldName);
      return relationship === undefined || reference === undefined || field === undefined
        ? null
        : { relationshipId: relationship.relationshipId, referenceFieldId: reference.fieldId, fieldId: field.fieldId };
    },
    formulaNamed: (name) =>
      formulas.find(
        (entry) =>
          entry.isActive &&
          !same(entry.formula.formulaId, self) &&
          entry.formula.target.kind !== "computed-column" &&
          entry.formula.displayName?.normalize("NFC") === name.normalize("NFC"),
      )?.formula.formulaId ?? null,
  };
}

// -------------------------------------------------------------------- events --

/** CA-28's mapping: exactly the database.md event kinds, in trigger-safe order. */
async function draftEvents(deps: SchemaCommandDependenciesV1, prepared: PreparedV1): Promise<AuthoredEventDraftV1[]> {
  const { app, change, after } = prepared;
  const before = app.snapshot;
  const impact = countsOf(prepared.impact);
  const drafts: AuthoredEventDraftV1[] = [];
  const fieldChanged = (fieldId: FieldId): void => {
    const was = fieldById(before, fieldId);
    const now = fieldById(after, fieldId);
    if (was === undefined || now === undefined) return;
    drafts.push({
      subject: { tableId: now.tableId, fieldId: now.fieldId },
      event: { kind: "field.changed", payload: { before: was, after: now, impact } },
    });
  };

  switch (change.kind) {
    case "rename-app":
      drafts.push({
        subject: {},
        event: {
          kind: "app.renamed",
          payload: {
            priorNameSha256: await deps.definitionDigest({ kind: "app-name", name: deps.projection.execute({ kind: "app-state" }).displayName }),
            displayName: change.name,
          },
        },
      });
      break;
    case "rename-table":
    case "set-table-label":
    case "set-table-key": {
      const was = tableById(before, change.tableId) as TableDefV1;
      const now = tableById(after, change.tableId) as TableDefV1;
      drafts.push({
        subject: { tableId: now.tableId },
        event: {
          kind: "table.changed",
          payload: {
            priorSha256: await deps.definitionDigest({ kind: "table", table: definitionOf(was) }),
            before: definitionOf(was),
            after: definitionOf(now),
            impact,
          },
        },
      });
      break;
    }
    case "create-field":
      drafts.push({
        subject: { tableId: change.field.tableId, fieldId: change.field.fieldId },
        event: { kind: "field.created", payload: { field: change.field, evidence: null } },
      });
      if (change.enumOptions.length > 0) {
        drafts.push({
          subject: { tableId: change.field.tableId, fieldId: change.field.fieldId },
          event: { kind: "enum.changed", payload: { fieldId: change.field.fieldId, priorOptionSetSha256: null, options: change.enumOptions } },
        });
      }
      break;
    case "rename-field":
    case "set-required":
    case "deactivate-field":
    case "reactivate-field":
    case "change-field-type":
      fieldChanged(change.fieldId);
      break;
    case "reorder-fields":
      for (const field of tableById(after, change.tableId)?.fields ?? []) {
        const was = fieldById(before, field.fieldId);
        if (was !== undefined && was.fieldOrdinal !== field.fieldOrdinal) fieldChanged(field.fieldId);
      }
      break;
    case "set-enum-options": {
      const prior = before.enumOptions.filter((option) => same(option.fieldId, change.fieldId));
      const field = fieldById(after, change.fieldId) as FieldDefV1;
      drafts.push({
        subject: { tableId: field.tableId, fieldId: field.fieldId },
        event: {
          kind: "enum.changed",
          payload: {
            fieldId: change.fieldId,
            priorOptionSetSha256: prior.length === 0 ? null : await deps.definitionDigest({ kind: "options", options: prior }),
            options: change.options,
          },
        },
      });
      break;
    }
    case "set-relationship": {
      const relationship = change.relationship;
      const was = fieldById(before, relationship.fromFieldId);
      if (was !== undefined && was.type.kind !== "reference") fieldChanged(relationship.fromFieldId);
      const prior = before.relationships.find((candidate) => same(candidate.relationshipId, relationship.relationshipId));
      drafts.push({
        subject: { tableId: relationship.fromTableId, fieldId: relationship.fromFieldId, objectId: relationship.relationshipId },
        event: {
          kind: "relationship.changed",
          payload: {
            relationship,
            priorSha256: prior === undefined ? null : await deps.definitionDigest({ kind: "relationship", relationship: prior }),
          },
        },
      });
      break;
    }
    case "remove-relationship": {
      const relationship = before.relationships.find((candidate) => same(candidate.relationshipId, change.relationshipId)) as RelationshipDefV1;
      drafts.push({
        subject: { tableId: relationship.fromTableId, fieldId: relationship.fromFieldId, objectId: relationship.relationshipId },
        event: {
          kind: "relationship.removed",
          payload: { relationship, rejectionFingerprint: await deps.rejectionFingerprint(relationship) },
        },
      });
      break;
    }
    case "save-rule": {
      const prior = app.rules.find((entry) => same(entry.rule.ruleId, change.rule.ruleId));
      drafts.push({
        subject: { tableId: change.tableId, objectId: change.rule.ruleId },
        event: {
          kind: "rule.changed",
          payload: {
            tableId: change.tableId,
            displayName: change.displayName,
            rule: change.rule,
            priorSha256: prior === undefined ? null : await deps.definitionDigest({ kind: "rule", rule: prior.rule }),
          },
        },
      });
      break;
    }
    case "remove-rule": {
      const prior = app.rules.find((entry) => same(entry.rule.ruleId, change.ruleId)) as RuleEntryV1;
      drafts.push({
        subject: { tableId: prior.tableId, objectId: prior.rule.ruleId },
        event: { kind: "rule.removed", payload: { tableId: prior.tableId, displayName: prior.displayName, rule: prior.rule, impact } },
      });
      break;
    }
    case "save-formula": {
      const formula = prepared.formula as NonNullable<PreparedV1["formula"]>;
      const target = formula.definition.target;
      const fieldId = target.kind === "computed-column" ? target.fieldId : undefined;
      // The field names the formula before the formula names the field:
      // migration 005's deferred reference closes by commit.
      if (formula.newField !== null) {
        drafts.push({
          subject: { tableId: formula.newField.tableId, fieldId: formula.newField.fieldId },
          event: { kind: "field.created", payload: { field: formula.newField, evidence: null } },
        });
      }
      const prior = app.formulas.find((entry) => same(entry.formula.formulaId, formula.definition.formulaId));
      drafts.push({
        subject: {
          ...(target.tableId === null ? {} : { tableId: target.tableId }),
          ...(fieldId === undefined ? {} : { fieldId }),
          objectId: formula.definition.formulaId,
        },
        event: {
          kind: "formula.changed",
          payload: {
            formula: formula.definition,
            metadata: formula.metadata,
            priorSha256: prior === undefined ? null : await deps.definitionDigest({ kind: "formula", formula: prior.formula }),
          },
        },
      });
      break;
    }
    case "remove-formula": {
      const prior = app.formulas.find((entry) => same(entry.formula.formulaId, change.formulaId)) as ProjectionFormulaV1;
      const target = prior.formula.target;
      drafts.push({
        subject: {
          ...(target.tableId === null ? {} : { tableId: target.tableId }),
          ...(target.kind === "computed-column" ? { fieldId: target.fieldId } : {}),
          objectId: prior.formula.formulaId,
        },
        event: { kind: "formula.removed", payload: { formula: prior.formula, metadata: prior.metadata, impact } },
      });
      // A removed computed column is deactivated; its literals stay authored.
      if (target.kind === "computed-column") fieldChanged(target.fieldId);
      break;
    }
    default: {
      const unreachable: never = change;
      return unreachable;
    }
  }

  drafts.push(...(await patchDrafts(deps, prepared)));
  return drafts;
}

const definitionOf = (table: TableDefV1): TableDefinitionV1 => {
  const { fields, ...definition } = table;
  void fields;
  return definition;
};

/** One `record.patched` per rewritten record, both ends of every value (D57). */
async function patchDrafts(deps: SchemaCommandDependenciesV1, prepared: PreparedV1): Promise<AuthoredEventDraftV1[]> {
  const patches = [...prepared.impact.patches, ...prepared.literalPatches];
  const byRecord = new Map<string, (typeof patches)[number][]>();
  for (const patch of patches) {
    byRecord.set(key(patch.recordId), [...(byRecord.get(key(patch.recordId)) ?? []), patch]);
  }
  const drafts: AuthoredEventDraftV1[] = [];
  for (const [recordKey, recordPatches] of byRecord) {
    const recordId = recordPatches[0]?.recordId as RecordId;
    const detail = deps.projection.execute({ kind: "record-by-id", recordId });
    const revision = prepared.revisions.get(recordKey);
    if (detail === null || revision === undefined) continue;
    const values = new Map(detail.authoredValues);
    const provenance = new Map(detail.provenance);
    const changes: FieldChangeV1[] = [];
    for (const patch of recordPatches) {
      const fieldId = [...values.keys()].find((candidate) => same(candidate, patch.fieldId)) ?? patch.fieldId;
      const before = values.get(fieldId) ?? MISSING_VALUE;
      if (cellValuesEqual(before, patch.value)) continue;
      const patchProvenance = provenanceOfPatch(prepared.change, patch.fieldId, prepared.after);
      changes.push({ fieldId, before, after: patch.value, provenance: patchProvenance });
      values.set(fieldId, patch.value);
      provenance.set(fieldId, patchProvenance);
    }
    if (changes.length === 0) continue;
    const resulting: AuthoredRecordV1 = { recordId: detail.recordId, tableId: detail.tableId, values, provenance };
    drafts.push({
      subject: { tableId: detail.tableId, recordId: detail.recordId },
      event: {
        kind: "record.patched",
        payload: {
          recordId: detail.recordId,
          tableId: detail.tableId,
          recordRevision: revision + 1n,
          changes,
          resultingRecordSha256: await deps.recordDigest(resulting),
        },
      },
    });
  }
  return drafts;
}

// ------------------------------------------------------------------ helpers --

function sizeOf(
  deps: SchemaCommandDependenciesV1,
  drafts: readonly AuthoredEventDraftV1[],
): { readonly isTooLarge: boolean; readonly byteLength: number; readonly limits: SchemaCommitLimitsV1 } {
  const limits = deps.limits ?? SEGMENT_LIMITS;
  const byteLength = drafts.reduce((total, draft) => total + deps.payloadByteLength(draft.event) + EVENT_OVERHEAD_BYTES, 0);
  return { isTooLarge: drafts.length > limits.maxEvents || byteLength > limits.maxBytes, byteLength, limits };
}

const countsOf = (report: ImpactReportV1): SchemaImpactCountsV1 => {
  const { patches, ...counts } = report;
  void patches;
  return counts;
};

/** A refused change counted nothing. */
function emptyImpact(change: SchemaImpactCountsV1["change"]): SchemaImpactCountsV1 {
  return {
    change,
    total: 0,
    affected: 0,
    unchanged: 0,
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
}

