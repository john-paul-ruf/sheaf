/**
 * Replaying committed events onto a hydrated projection.
 *
 * Every guard here exists because the alternative is worse than failing. A
 * commit whose hash does not match its body, whose device sequence skips a
 * number, whose `schemaRevisionBefore` disagrees with the schema it is about to
 * change, or whose subject is not the app this projection holds, is not a
 * commit this projection can apply *partially*. So none of them is skipped and
 * none is patched around: the batch rolls back and the whole projection is
 * disposed (database.md § Replay guards, CA-13(e)). A person then sees a
 * recoverable corruption state rather than an app quietly missing a change.
 *
 * The chain guard is fed the **accumulated** commit set, never one segment: F02
 * puts one commit in each segment (D27), and a per-device hash chain cannot be
 * verified across a gap the verifier was never shown.
 *
 * Two things this module refuses to do:
 *
 * - **It does not validate.** Issues come from the one shared validator, which
 *   ran when the command was accepted (invariant 5). A caller that has a report
 *   hands it over with the commit; the projection never re-decides a verdict.
 * - **It does not interpret an opaque payload.** `EventCommitV1.payload` is
 *   `unknown` by contract, so the caller supplies typed events alongside the raw
 *   commit and the guards prove the two agree index for index.
 *
 * A tail may create a table (an appended CSV, CA-23/D38): `table.created` for a
 * table the checkpoint does not hold builds it — its sheet, the table, its
 * fields, its key/label references — inside the same transaction, and the
 * `field.created`/`enum.changed`/`record.created` events after it land on it.
 * A `field.created` for a table the projection does not hold is still an
 * integrity failure and disposes the projection.
 *
 * **Schema, rule and formula events (F04) land in the same transaction** as
 * everything else in their commit: `schema_tables`/`schema_fields`/
 * `relationships`/`validation_rules`/`formulas`/`formula_dependencies` rows
 * change, and migration 005's triggers judge each write — the deferred
 * computed-field ↔ formula cycle must close by commit, and a formula's
 * target must name it back. Once a commit's events have landed, every table
 * it re-shaped has its lanes and search text rebuilt from the authored
 * values (a type change moves a field to another lane), and — when the
 * caller hands over its validator — its records re-judged (invariant 5).
 */

import { IntegrityError } from "../../domain/model/errors.js";
import { asDomainId, compareDomainIds, type TableId } from "../../domain/model/ids.js";
import { F04_SCHEMA_EVENT_KINDS } from "../../domain/model/events.js";
import { recalculate } from "./recalc.js";
import type {
  AuthoredRecordV1,
  ChartSavedPayloadV1,
  FieldChangeV1,
  FormulaChangedPayloadV1,
  TableCreatedPayloadV1,
  TableDefinitionV1,
} from "../../domain/model/events.js";
import type { FormulaDefinitionV1 } from "../../domain/formulas/ir.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import type { CommitId, FieldId } from "../../domain/model/ids.js";
import {
  storageKindForFieldType,
  type EnumOptionDefV1,
  type FieldDefV1,
  type RelationshipDefV1,
} from "../../domain/model/schema.js";
import { compareCommits, verifyCommitChain } from "../codecs/event-commit.js";
import type {
  DomainEventV1 as WireEventV1,
  EventCommitV1,
} from "../../migrations/004_event_format_v1.js";
import {
  decodeAuthoredRecord,
  decodeChangeSummary,
  encodeAppTheme,
  encodeAuthoredRecord,
  encodeChangeSummary,
  encodeFrontier,
  encodeMessageParameters,
  encodeRuleIR,
} from "./cbor-values.js";
import {
  assertUsable,
  disposeProjection,
  run,
  selectRow,
  selectRows,
  toSqlInteger,
  withTransaction,
  type ProjectionHandleV1,
} from "./engine.js";
import {
  cacheEnumOption,
  cacheSchema,
  upsertChartRow,
  insertEnumOption,
  insertField,
  insertFormulaDependencies,
  insertRelationship,
  insertSheetSnapshot,
  insertTables,
  upsertFormulaRow,
} from "./hydrate.js";
import {
  idKey,
  insertRecord,
  reindexRecord,
  replaceRecord,
  searchableTextFor,
} from "./record-rows.js";
import {
  DELETE_CHART,
  DEACTIVATE_FORMULA,
  DEACTIVATE_VALIDATION_RULE,
  DELETE_COMPUTED_CELLS_FOR_FIELD,
  DELETE_ENUM_OPTIONS_FOR_FIELD,
  DELETE_FORMULA_DEPENDENCIES,
  DELETE_RECALCULATED_ISSUES_FOR_FIELD,
  DELETE_RECORD,
  DELETE_RELATIONSHIP,
  DELETE_SCALAR_RESULT,
  DELETE_SEARCH_ROW,
  INSERT_CHANGE_HISTORY,
  INSERT_SEARCH_ROW,
  SELECT_DELETE_EVENT_FOR_RECORD,
  SELECT_PROJECTION_APP_ID,
  SELECT_RECORDS_FOR_TABLE,
  SELECT_RECORD_STATE_BY_ID,
  SELECT_SCHEMA_REVISION,
  UPDATE_APP_STATE_NAME,
  UPDATE_APP_STATE_SCHEMA_REVISION,
  UPDATE_APP_STATE_THEME,
  UPDATE_PROJECTION_FRONTIER,
  UPDATE_RELATIONSHIP,
  UPDATE_SCHEMA_FIELD,
  UPDATE_SCHEMA_FIELD_ORDINAL,
  UPDATE_SCHEMA_TABLE,
  UPSERT_VALIDATION_RULE,
} from "./statements.js";
import type {
  ChangeSubjectKindV1,
  DomainEventV1,
  ProjectionApplyReceiptV1,
  ProjectionChangeSummaryV1,
  ProjectionCommitV1,
  ProjectionTableSummaryV1,
  RecordRevalidatorV1,
} from "./types.js";

interface RecordState {
  readonly recordPk: number;
  readonly tableId: Uint8Array;
  readonly recordRevision: bigint;
  readonly createdCommitId: CommitId;
  readonly authored: AuthoredRecordV1;
}

/** What one commit's events did to the tables, collected while they land. */
interface CommitShapeV1 {
  /** Tables whose lanes, search text, or verdicts a schema event moved. */
  readonly reshaped: Set<string>;
  /** Tables this commit itself created (an append, D38). */
  readonly created: Set<string>;
  /** Any schema, rule, formula or option edit: every formula recalculates. */
  isSchema: boolean;
  /** Fields whose values a record event moved (all of a table's on insert/delete). */
  readonly changedFields: Map<string, FieldId>;
  /** Records a record event left live. */
  readonly recordKeys: Set<string>;
  readonly insertedTables: Map<string, TableId>;
}

const SCHEMA_KINDS: ReadonlySet<DomainEventV1["kind"]> = new Set([
  "table.created",
  "field.created",
  "enum.changed",
  ...F04_SCHEMA_EVENT_KINDS,
]);

/** Every field of a table moved, as far as an aggregate can tell. */
function touchTable(handle: ProjectionHandleV1, shape: CommitShapeV1, tableId: TableId, inserted: boolean): void {
  for (const field of handle.schema.fieldsByTable.get(idKey(tableId)) ?? []) {
    shape.changedFields.set(idKey(field.fieldId), field.fieldId);
  }
  if (inserted) {
    shape.insertedTables.set(idKey(tableId), tableId);
  }
}

const EMPTY_SUMMARY: ProjectionChangeSummaryV1 = Object.freeze({
  fieldChanges: [],
  recordRevision: null,
  createdCommitId: null,
  tableId: null,
});

/**
 * Applies commits in canonical order. Either every event lands or the
 * projection is gone; there is no third outcome.
 */
export async function applyEvents(
  handle: ProjectionHandleV1,
  commits: readonly ProjectionCommitV1[],
): Promise<ProjectionApplyReceiptV1> {
  assertUsable(handle);
  if (!handle.hydrated) {
    throw new IntegrityError("projection holds no app to replay onto");
  }
  if (commits.length === 0) {
    return { recalculatedFieldIds: [] };
  }

  // Canonical presentation order, M09's comparator — the same order replay
  // presents commits in, so both hydration paths write in the same sequence.
  const ordered = [...commits].sort((left, right) =>
    compareCommits(left.commit, right.commit),
  );

  try {
    await verifyReplay(handle, ordered);
  } catch (cause) {
    // A guard failure is not a state the projection may keep serving from.
    disposeProjection(handle);
    throw cause;
  }

  return withTransaction(handle, () => {
    let schemaRevision = readSchemaRevision(handle);
    const recalculated = new Map<string, FieldId>();
    for (const entry of ordered) {
      const { commit } = entry;
      const shape: CommitShapeV1 = {
        reshaped: new Set(),
        created: new Set(),
        isSchema: false,
        changedFields: new Map(),
        recordKeys: new Set(),
        insertedTables: new Map(),
      };
      parkReorderedFields(handle, entry.events);
      for (const [index, event] of entry.events.entries()) {
        applyEvent(handle, entry, index, event, shape);
      }
      // A table this commit created is built whole by its own events (D38);
      // only a table that predates the commit can have been re-shaped.
      for (const tableKey of shape.reshaped) {
        if (!shape.created.has(tableKey)) {
          reindexTable(handle, tableKey, entry.revalidate);
        }
      }
      // Recalculation in the same transaction as the write (D60): every
      // formula after a schema change, only what the moved fields reach after
      // a record write. No event is written for it (invariant 7).
      const outcome = shape.isSchema
        ? recalculate(handle, { kind: "all" })
        : shape.changedFields.size > 0
          ? recalculate(handle, {
              kind: "records",
              changedFieldIds: [...shape.changedFields.values()],
              recordKeys: [...shape.recordKeys],
              insertedTableIds: [...shape.insertedTables.values()],
            })
          : null;
      for (const fieldId of outcome?.recalculatedFieldIds ?? []) {
        recalculated.set(idKey(fieldId), fieldId);
      }
      handle.frontier.set(idKey(commit.deviceId), {
        deviceId: commit.deviceId,
        commitSequence: commit.deviceCommitSequence,
      });
      handle.appliedCommits.push(commit);
      schemaRevision = commit.schemaRevisionAfter;
    }

    run(handle, UPDATE_APP_STATE_SCHEMA_REVISION, [
      toSqlInteger(schemaRevision),
    ]);
    run(handle, UPDATE_PROJECTION_FRONTIER, [
      encodeFrontier([...handle.frontier.values()]),
    ]);
    return { recalculatedFieldIds: [...recalculated.values()] };
  });
}

// ------------------------------------------------------------------ guards --

async function verifyReplay(
  handle: ProjectionHandleV1,
  ordered: readonly ProjectionCommitV1[],
): Promise<void> {
  const appId = projectionAppId(handle);
  const frontier = new Map(handle.frontier);
  let schemaRevision = readSchemaRevision(handle);

  for (const entry of ordered) {
    const { commit } = entry;

    if (!equalBytes(commit.appId, appId)) {
      throw new IntegrityError("commit belongs to another app");
    }
    assertEventsMatchCommit(commit, entry.events);
    for (const event of commit.events) {
      if (!equalBytes(event.subject.appId, appId)) {
        throw new IntegrityError("event subject belongs to another app");
      }
    }

    // Frontier monotonicity: a device's commits arrive contiguously, and no
    // commit may claim to have observed a sequence that has not been applied.
    const device = idKey(commit.deviceId);
    const applied = frontier.get(device)?.commitSequence ?? 0n;
    if (commit.deviceCommitSequence !== applied + 1n) {
      throw new IntegrityError("commit sequence does not continue the frontier");
    }
    for (const basis of commit.basisFrontier) {
      const observed = frontier.get(idKey(basis.deviceId))?.commitSequence ?? 0n;
      if (observed < basis.commitSequence) {
        throw new IntegrityError("commit observed a state this app has not");
      }
    }
    frontier.set(device, {
      deviceId: commit.deviceId,
      commitSequence: commit.deviceCommitSequence,
    });

    if (commit.schemaRevisionBefore !== schemaRevision) {
      throw new IntegrityError("commit was authored against another schema");
    }
    schemaRevision = commit.schemaRevisionAfter;
  }

  // The whole chain, not one segment: verifying a segment in isolation would
  // check nothing across the gap between it and its predecessor (D27, S01).
  await verifyCommitChain(
    [...handle.appliedCommits, ...ordered.map((entry) => entry.commit)],
    handle.sha256,
  );
}

/**
 * The typed events must be the commit's own events: same count, same order,
 * same kinds, indexes contiguous from zero. Without this a caller could attach
 * any payload to any commit and the hash guard would still pass.
 */
function assertEventsMatchCommit(
  commit: EventCommitV1,
  events: readonly DomainEventV1[],
): void {
  if (commit.events.length !== events.length) {
    throw new IntegrityError("typed events do not cover the commit's events");
  }
  for (const [index, wire] of commit.events.entries()) {
    if (wire.eventIndex !== index) {
      throw new IntegrityError("event indexes are not contiguous from zero");
    }
    if (wire.kind !== events[index]?.kind) {
      throw new IntegrityError("typed event does not match the commit's kind");
    }
  }
}

// ------------------------------------------------------------------- apply --

function applyEvent(
  handle: ProjectionHandleV1,
  entry: ProjectionCommitV1,
  index: number,
  event: DomainEventV1,
  shape: CommitShapeV1,
): void {
  const { reshaped } = shape;
  if (SCHEMA_KINDS.has(event.kind)) {
    shape.isSchema = true;
  }
  const wire = entry.commit.events[index] as WireEventV1;
  const issues = entry.issuesByEventIndex?.get(index) ?? [];
  const commitId: CommitId = asDomainId("commit", entry.commit.commitId);
  let summary: ProjectionChangeSummaryV1 = EMPTY_SUMMARY;
  let restoration: Uint8Array | null = null;

  switch (event.kind) {
    case "app.created":
      // The app's identity arrives with the checkpoint promotion wrote
      // (CA-11/D29); replaying the commit that created it writes history only.
      break;

    case "table.created":
      applyTableCreated(handle, event.payload, wire);
      shape.created.add(idKey(event.payload.table.tableId));
      summary = { ...EMPTY_SUMMARY, tableId: event.payload.table.tableId };
      break;

    case "field.created":
      if (applyFieldCreated(handle, event.payload.field, wire)) {
        reshaped.add(idKey(event.payload.field.tableId));
      }
      summary = { ...EMPTY_SUMMARY, tableId: event.payload.field.tableId };
      break;

    case "durable-home.assigned": {
      const row = selectRow(handle, "SELECT durable_home_id FROM app_state WHERE singleton = 1");
      if (row?.[0] !== null) throw new IntegrityError("only a scratch app may receive a home");
      run(handle, "UPDATE app_state SET durable_home_id = ? WHERE singleton = 1", [event.payload.homeId]);
      break;
    }

    case "app.renamed":
      run(handle, UPDATE_APP_STATE_NAME, [event.payload.displayName]);
      break;

    case "table.changed":
      applyTableChanged(handle, event.payload.before, event.payload.after, wire);
      reshaped.add(idKey(event.payload.after.tableId));
      summary = { ...EMPTY_SUMMARY, tableId: event.payload.after.tableId };
      break;

    case "field.changed":
      applyFieldChanged(handle, event.payload.before, event.payload.after, wire);
      reshaped.add(idKey(event.payload.after.tableId));
      summary = { ...EMPTY_SUMMARY, tableId: event.payload.after.tableId };
      break;

    case "relationship.changed":
      applyRelationshipChanged(handle, event.payload.relationship, schemaRevisionOf(entry));
      reshaped.add(idKey(event.payload.relationship.fromTableId));
      summary = { ...EMPTY_SUMMARY, tableId: event.payload.relationship.fromTableId };
      break;

    case "relationship.removed":
      applyRelationshipRemoved(handle, event.payload.relationship);
      reshaped.add(idKey(event.payload.relationship.fromTableId));
      summary = { ...EMPTY_SUMMARY, tableId: event.payload.relationship.fromTableId };
      break;

    case "rule.changed":
      requireTable(handle, event.payload.tableId);
      run(handle, UPSERT_VALIDATION_RULE, [
        event.payload.rule.ruleId,
        event.payload.tableId,
        event.payload.displayName,
        encodeRuleIR(event.payload.rule),
        event.payload.rule.messageKey,
        encodeMessageParameters(event.payload.rule.messageParameters),
        toSqlInteger(schemaRevisionOf(entry)),
      ]);
      reshaped.add(idKey(event.payload.tableId));
      summary = { ...EMPTY_SUMMARY, tableId: event.payload.tableId };
      break;

    case "rule.removed":
      run(handle, DEACTIVATE_VALIDATION_RULE, [
        toSqlInteger(schemaRevisionOf(entry)),
        event.payload.rule.ruleId,
      ]);
      reshaped.add(idKey(event.payload.tableId));
      summary = { ...EMPTY_SUMMARY, tableId: event.payload.tableId };
      break;

    case "formula.changed":
      applyFormulaChanged(handle, event.payload, schemaRevisionOf(entry));
      summary = { ...EMPTY_SUMMARY, tableId: event.payload.formula.target.tableId };
      break;

    case "formula.removed":
      applyFormulaRemoved(handle, event.payload.formula.formulaId, schemaRevisionOf(entry));
      summary = { ...EMPTY_SUMMARY, tableId: event.payload.formula.target.tableId };
      break;

    case "record.created": {
      const created = event.payload.record;
      assertNoRecord(handle, created.recordId);
      insertRecord(handle, {
        record: created,
        recordRevision: 0n,
        createdCommitId: commitId,
        updatedCommitId: commitId,
        issues,
      });
      touchTable(handle, shape, created.tableId, true);
      shape.recordKeys.add(idKey(created.recordId));
      summary = {
        fieldChanges: [],
        recordRevision: 0n,
        createdCommitId: commitId,
        tableId: created.tableId,
      };
      break;
    }

    case "record.patched": {
      const state = requireRecord(handle, event.payload.recordId);
      assertSameTable(state, event.payload.tableId);
      if (event.payload.recordRevision !== state.recordRevision + 1n) {
        throw new IntegrityError("patch does not continue the record revision");
      }
      const patched = applyChanges(state.authored, event.payload.changes);
      replaceRecord(handle, state.recordPk, {
        record: patched,
        recordRevision: event.payload.recordRevision,
        createdCommitId: state.createdCommitId,
        updatedCommitId: commitId,
        issues,
      });
      for (const change of event.payload.changes) {
        shape.changedFields.set(idKey(change.fieldId), change.fieldId);
      }
      shape.recordKeys.add(idKey(event.payload.recordId));
      summary = {
        fieldChanges: event.payload.changes,
        recordRevision: event.payload.recordRevision,
        createdCommitId: state.createdCommitId,
        tableId: event.payload.tableId,
      };
      break;
    }

    case "record.deleted": {
      const state = requireRecord(handle, event.payload.recordId);
      assertSameTable(state, event.payload.tableId);
      if (event.payload.priorRecordRevision !== state.recordRevision) {
        throw new IntegrityError("delete names another record revision");
      }
      // Cells and issues cascade; the FTS row is not a foreign key, so it goes
      // explicitly — a search hit for a deleted record would be a lie.
      run(handle, DELETE_SEARCH_ROW, [state.recordPk]);
      run(handle, DELETE_RECORD, [state.recordPk]);
      touchTable(handle, shape, event.payload.tableId, false);
      shape.recordKeys.delete(idKey(event.payload.recordId));
      summary = {
        fieldChanges: [],
        recordRevision: state.recordRevision,
        createdCommitId: state.createdCommitId,
        tableId: event.payload.tableId,
      };
      // The complete payload is what makes the delete recoverable (FR-12).
      restoration = encodeAuthoredRecord(event.payload.restoration);
      break;
    }

    case "record.restored": {
      const restored = event.payload.record;
      assertNoRecord(handle, restored.recordId);
      const deleted = requireDeleteEvent(
        handle,
        event.payload.deletedEventId,
        restored.recordId,
      );
      const restoredRevision = (deleted.recordRevision ?? 0n) + 1n;
      insertRecord(handle, {
        record: restored,
        recordRevision: restoredRevision,
        // Provenance survives the round trip: the record was created by the
        // commit that first created it, not by the one that brought it back.
        createdCommitId: deleted.createdCommitId ?? commitId,
        updatedCommitId: commitId,
        issues,
      });
      touchTable(handle, shape, restored.tableId, true);
      shape.recordKeys.add(idKey(restored.recordId));
      summary = {
        fieldChanges: [],
        recordRevision: restoredRevision,
        createdCommitId: deleted.createdCommitId ?? commitId,
        tableId: restored.tableId,
      };
      break;
    }

    case "enum.changed": {
      applyEnumChange(handle, event.payload.fieldId, event.payload.options);
      const tableId = handle.schema.fields.get(idKey(event.payload.fieldId))?.tableId ?? null;
      if (tableId !== null) {
        reshaped.add(idKey(tableId));
      }
      summary = { ...EMPTY_SUMMARY, tableId };
      break;
    }

    case "theme.changed":
      run(handle, UPDATE_APP_STATE_THEME, [encodeAppTheme(event.payload.after)]);
      break;

    case "chart.saved":
      applyChartSaved(handle, event.payload);
      summary = { ...EMPTY_SUMMARY, tableId: event.payload.definition.tableId };
      break;

    case "chart.deleted":
      applyChartDeleted(handle, event.payload.chartId);
      summary = { ...EMPTY_SUMMARY, tableId: event.payload.prior.definition.tableId };
      break;

    case "import.accepted":
    case "inference-decision.recorded":
      // Recorded as history. The `import_lineages` and `inference_decisions`
      // rows migration 005 defines need facts these payloads do not carry —
      // see this session's handoff; the projection invents none of them.
      break;

    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }

  writeHistory(handle, entry.commit, wire, event, summary, restoration);
}

const applyChanges = (
  current: AuthoredRecordV1,
  changes: readonly FieldChangeV1[],
): AuthoredRecordV1 => {
  const values = new Map<string, [FieldId, CellValueV1]>(
    [...current.values].map(([fieldId, value]) => [
      idKey(fieldId),
      [fieldId, value],
    ]),
  );
  const provenance = new Map(
    [...current.provenance].map(([fieldId, value]) => [
      idKey(fieldId),
      [fieldId, value] as const,
    ]),
  );

  for (const change of changes) {
    values.set(idKey(change.fieldId), [change.fieldId, change.after]);
    provenance.set(idKey(change.fieldId), [change.fieldId, change.provenance]);
  }

  return {
    recordId: current.recordId,
    tableId: current.tableId,
    values: new Map([...values.values()]),
    provenance: new Map([...provenance.values()]),
  };
};

/**
 * Replaces a field's option set with the complete one the event carries, then
 * rewrites the searchable text of that table's records: an option's label is
 * indexed text, so a rename that left the index alone would make search answer
 * for a label nobody can see any more.
 */
function applyEnumChange(
  handle: ProjectionHandleV1,
  fieldId: FieldId,
  options: readonly EnumOptionDefV1[],
): void {
  const field = handle.schema.fields.get(idKey(fieldId));
  if (field === undefined || field.type.kind !== "enum") {
    throw new IntegrityError("enum change names a field this app does not hold");
  }

  run(handle, DELETE_ENUM_OPTIONS_FOR_FIELD, [fieldId]);
  handle.schema.enumOptions.delete(idKey(fieldId));
  for (const option of options) {
    if (compareDomainIds(option.fieldId, fieldId) !== 0) {
      throw new IntegrityError("enum option belongs to another field");
    }
    insertEnumOption(handle, option);
    cacheEnumOption(handle.schema, option);
  }

  for (const row of selectRows(handle, SELECT_RECORDS_FOR_TABLE, [
    field.tableId,
  ])) {
    const recordPk = Number(row[0]);
    const authored = decodeAuthoredRecord(row[1] as Uint8Array);
    run(handle, DELETE_SEARCH_ROW, [recordPk]);
    run(handle, INSERT_SEARCH_ROW, [
      recordPk,
      searchableTextFor(handle.schema, authored),
    ]);
  }
}

/**
 * `change_history.subject_kind` per event (migration 005's closed set). A
 * relationship is filed under its reference field; a rule or a formula under
 * its own ID, which its event carries as the subject's `objectId`.
 */
const SUBJECT_KINDS: Readonly<Record<DomainEventV1["kind"], ChangeSubjectKindV1>> = {
  "app.created": "app",
  "durable-home.assigned": "app",
  "app.renamed": "app",
  "table.created": "table",
  "table.changed": "table",
  "field.created": "field",
  "field.changed": "field",
  "enum.changed": "field",
  "relationship.changed": "field",
  "relationship.removed": "field",
  "rule.changed": "rule",
  "rule.removed": "rule",
  "formula.changed": "formula",
  "formula.removed": "formula",
  "record.created": "record",
  "record.patched": "record",
  "record.deleted": "record",
  "record.restored": "record",
  "theme.changed": "app",
  "chart.saved": "chart",
  "chart.deleted": "chart",
  "import.accepted": "app",
  "inference-decision.recorded": "app",
};

function writeHistory(
  handle: ProjectionHandleV1,
  commit: EventCommitV1,
  wire: WireEventV1,
  event: DomainEventV1,
  summary: ProjectionChangeSummaryV1,
  restoration: Uint8Array | null,
): void {
  const subjectKind = SUBJECT_KINDS[event.kind];
  run(handle, INSERT_CHANGE_HISTORY, [
    wire.eventId,
    commit.commitId,
    wire.eventIndex,
    event.kind,
    commit.eventClass,
    subjectKind,
    requireSubjectId(wire, subjectKind),
    toSqlInteger(commit.hybridTime.wallTimeMs),
    commit.hybridTime.logicalCounter,
    commit.deviceId,
    encodeChangeSummary(summary),
    restoration,
  ]);
}

function subjectIdOf(
  wire: WireEventV1,
  subjectKind: ChangeSubjectKindV1,
): Uint8Array | undefined {
  switch (subjectKind) {
    case "table":
      return wire.subject.tableId;
    case "field":
      return wire.subject.fieldId;
    case "record":
      return wire.subject.recordId;
    case "rule":
    case "formula":
    case "chart":
      return wire.subject.objectId;
    default:
      return wire.subject.appId;
  }
}

function requireSubjectId(
  wire: WireEventV1,
  subjectKind: ChangeSubjectKindV1,
): Uint8Array {
  const subject = subjectIdOf(wire, subjectKind);
  if (subject === undefined) {
    throw new IntegrityError("event does not name the subject its kind needs");
  }
  return subject;
}

// ------------------------------------------------------------------ reading --

function projectionAppId(handle: ProjectionHandleV1): Uint8Array {
  const row = selectRow(handle, SELECT_PROJECTION_APP_ID);
  const appId = row?.[0];
  if (!(appId instanceof Uint8Array)) {
    throw new IntegrityError("projection holds no app identity");
  }
  return appId;
}

function readSchemaRevision(handle: ProjectionHandleV1): bigint {
  const row = selectRow(handle, SELECT_SCHEMA_REVISION);
  return BigInt(Number(row?.[0] ?? 0));
}

function readRecord(
  handle: ProjectionHandleV1,
  recordId: Uint8Array,
): RecordState | null {
  const row = selectRow(handle, SELECT_RECORD_STATE_BY_ID, [recordId]);
  if (row === null) {
    return null;
  }
  return {
    recordPk: Number(row[0]),
    tableId: row[1] as Uint8Array,
    recordRevision: BigInt(Number(row[2])),
    createdCommitId: asDomainId("commit", row[3] as Uint8Array),
    authored: decodeAuthoredRecord(row[4] as Uint8Array),
  };
}

function requireRecord(
  handle: ProjectionHandleV1,
  recordId: Uint8Array,
): RecordState {
  const state = readRecord(handle, recordId);
  if (state === null) {
    throw new IntegrityError("event names a record this app does not hold");
  }
  return state;
}

function assertNoRecord(
  handle: ProjectionHandleV1,
  recordId: Uint8Array,
): void {
  if (readRecord(handle, recordId) !== null) {
    throw new IntegrityError("event creates a record that already exists");
  }
}

function assertSameTable(state: RecordState, tableId: Uint8Array): void {
  if (!equalBytes(state.tableId, tableId)) {
    throw new IntegrityError("event names another table for this record");
  }
}

/**
 * A table the checkpoint already holds is the initial import's, and replaying
 * its creation writes history only. A table the projection does not hold is
 * one a later commit appended (CA-23, D38): it is built here — its source sheet
 * first, then the table, its fields, and its key/label references — inside
 * the tail's one transaction, so a trigger that refuses any part of it disposes
 * the projection exactly as a refused checkpoint would.
 */
function applyTableCreated(
  handle: ProjectionHandleV1,
  payload: TableCreatedPayloadV1,
  wire: WireEventV1,
): void {
  const tableId = wire.subject.tableId;
  if (tableId === undefined || !equalBytes(tableId, payload.table.tableId)) {
    throw new IntegrityError("table.created names another table than its subject");
  }
  if (handle.schema.tables.has(idKey(tableId))) {
    return;
  }
  if (payload.sourceSheet !== null) {
    insertSheetSnapshot(handle, payload.sourceSheet);
  }
  insertTables(handle, [payload.table]);
  cacheSchema(handle.schema, [payload.table], []);
}

/**
 * A field the projection holds already arrived with its table. A new field of
 * a table it holds is built; a field of a table it does not hold is an
 * integrity failure, never a table conjured to receive it.
 */
function applyFieldCreated(
  handle: ProjectionHandleV1,
  field: FieldDefV1,
  wire: WireEventV1,
): boolean {
  const fieldId = wire.subject.fieldId;
  if (fieldId === undefined || !equalBytes(fieldId, field.fieldId)) {
    throw new IntegrityError("field.created names another field than its subject");
  }
  if (handle.schema.fields.has(idKey(fieldId))) {
    return false;
  }
  const table = requireTable(handle, field.tableId);
  insertField(handle, { ...table, fields: [] }, field);
  cacheField(handle, field);
  return true;
}

// ------------------------------------------------------- schema edits (F04) --

/** The revision a commit's schema rows are stamped with. */
const schemaRevisionOf = (entry: ProjectionCommitV1): bigint =>
  entry.commit.schemaRevisionAfter;

/** Above every ordinal a person can reach; the reorder's own events land on top. */
const PARKED_ORDINAL_BASE = 2 ** 30;

/**
 * A reorder is one `field.changed` per moved field, and `(table_id,
 * field_ordinal)` is unique — so two fields trading places would collide on
 * the first update. Every field a commit re-orders is parked first, then each
 * event writes its final ordinal.
 */
function parkReorderedFields(
  handle: ProjectionHandleV1,
  events: readonly DomainEventV1[],
): void {
  let parked = 0;
  for (const event of events) {
    if (
      event.kind === "field.changed" &&
      event.payload.before.fieldOrdinal !== event.payload.after.fieldOrdinal
    ) {
      run(handle, UPDATE_SCHEMA_FIELD_ORDINAL, [
        PARKED_ORDINAL_BASE + parked,
        event.payload.after.fieldId,
      ]);
      parked += 1;
    }
  }
}

function requireTable(
  handle: ProjectionHandleV1,
  tableId: Uint8Array,
): ProjectionTableSummaryV1 {
  const table = handle.schema.tables.get(idKey(tableId));
  if (table === undefined) {
    throw new IntegrityError("event names a table this projection lacks");
  }
  return table;
}

/** The field's definition in every cache that answers for it. */
function cacheField(handle: ProjectionHandleV1, field: FieldDefV1): void {
  const fields = (handle.schema.fieldsByTable.get(idKey(field.tableId)) ?? []).filter(
    (candidate) => !equalBytes(candidate.fieldId, field.fieldId),
  );
  handle.schema.fieldsByTable.set(
    idKey(field.tableId),
    [...fields, field].sort((left, right) => left.fieldOrdinal - right.fieldOrdinal),
  );
  handle.schema.fields.set(idKey(field.fieldId), field);
}

function applyTableChanged(
  handle: ProjectionHandleV1,
  before: TableDefinitionV1,
  after: TableDefinitionV1,
  wire: WireEventV1,
): void {
  const tableId = wire.subject.tableId;
  if (
    tableId === undefined ||
    !equalBytes(tableId, after.tableId) ||
    !equalBytes(before.tableId, after.tableId)
  ) {
    throw new IntegrityError("table.changed names another table than its subject");
  }
  requireTable(handle, after.tableId);
  run(handle, UPDATE_SCHEMA_TABLE, [
    after.displayName,
    after.tableOrdinal,
    after.keyFieldId,
    after.labelFieldId,
    after.isActive ? 1 : 0,
    toSqlInteger(after.schemaRevision),
    after.tableId,
  ]);
  handle.schema.tables.set(idKey(after.tableId), after);
}

/**
 * The field keeps its ID and its table (D57); everything else may move. The
 * per-session definition cache is refreshed with the complete `after`
 * definition — that cache, not a column, is where a currency's code lives,
 * so a type change to currency keeps its code across reads and restarts.
 */
function applyFieldChanged(
  handle: ProjectionHandleV1,
  before: FieldDefV1,
  after: FieldDefV1,
  wire: WireEventV1,
): void {
  const fieldId = wire.subject.fieldId;
  const current = handle.schema.fields.get(idKey(after.fieldId));
  if (
    fieldId === undefined ||
    current === undefined ||
    !equalBytes(fieldId, after.fieldId) ||
    !equalBytes(before.fieldId, after.fieldId) ||
    !equalBytes(before.tableId, after.tableId) ||
    !equalBytes(current.tableId, after.tableId)
  ) {
    throw new IntegrityError("field.changed does not name a field of its own table");
  }
  run(handle, UPDATE_SCHEMA_FIELD, [
    after.displayName,
    after.fieldOrdinal,
    after.type.kind,
    storageKindForFieldType(after.type),
    after.isRequired ? 1 : 0,
    after.formulaId === undefined ? 0 : 1,
    after.isActive ? 1 : 0,
    after.formulaId ?? null,
    toSqlInteger(after.schemaRevision),
    after.fieldId,
  ]);
  cacheField(handle, after);
  if (!after.isActive && after.formulaId !== undefined) {
    clearResults(handle, after.formulaId, after.fieldId);
  }
}

function applyRelationshipChanged(
  handle: ProjectionHandleV1,
  relationship: RelationshipDefV1,
  schemaRevision: bigint,
): void {
  const existing = relationshipById(handle, relationship.relationshipId);
  const stamped = { ...relationship, schemaRevision };
  if (existing === undefined) {
    insertRelationship(handle, stamped);
  } else {
    run(handle, UPDATE_RELATIONSHIP, [
      stamped.fromTableId,
      stamped.fromFieldId,
      stamped.toTableId,
      stamped.toKeyFieldId,
      stamped.detectionSource,
      stamped.isActive ? 1 : 0,
      toSqlInteger(stamped.schemaRevision),
      stamped.relationshipId,
    ]);
    handle.schema.relationships.delete(idKey(existing.fromFieldId));
  }
  handle.schema.relationships.set(idKey(stamped.fromFieldId), stamped);
}

/**
 * The row goes; the reference field keeps its type and its values, which
 * the validator now reports as unlinked (CA-28: "reference values kept").
 */
function applyRelationshipRemoved(
  handle: ProjectionHandleV1,
  relationship: RelationshipDefV1,
): void {
  const existing = relationshipById(handle, relationship.relationshipId);
  if (existing === undefined) {
    throw new IntegrityError("relationship.removed names a relationship this app lacks");
  }
  run(handle, DELETE_RELATIONSHIP, [existing.relationshipId]);
  handle.schema.relationships.delete(idKey(existing.fromFieldId));
}

function relationshipById(
  handle: ProjectionHandleV1,
  relationshipId: Uint8Array,
): RelationshipDefV1 | undefined {
  return [...handle.schema.relationships.values()].find((candidate) =>
    equalBytes(candidate.relationshipId, relationshipId),
  );
}

/**
 * The definition, its dependency edges, and the cache. A computed column's
 * field must already name the formula — the event before it in the same
 * commit, or an earlier one — which is exactly what migration 005's trigger
 * checks; nothing here restates it.
 */
/**
 * `chart.saved`: a new chart starts at revision 0, and every later save is
 * exactly one past the chart as the projection holds it — the stale-builder
 * guard's durable half. Anything else is a commit this app did not author.
 */
function applyChartSaved(handle: ProjectionHandleV1, payload: ChartSavedPayloadV1): void {
  const { definition } = payload;
  if (
    compareDomainIds(payload.chartId, definition.chartId) !== 0 ||
    payload.displayName !== definition.name ||
    payload.pinned !== definition.pinned
  ) {
    throw new IntegrityError("chart.saved disagrees with its own definition");
  }
  const existing = handle.schema.charts.get(idKey(payload.chartId));
  const expected = existing === undefined ? 0n : existing.chartRevision + 1n;
  if (payload.chartRevision !== expected) {
    throw new IntegrityError("chart.saved does not follow the chart's revision");
  }
  upsertChartRow(handle, {
    definition,
    displayName: payload.displayName,
    pinned: payload.pinned,
    ordinal: payload.ordinal,
    provenance: payload.provenance,
    chartRevision: payload.chartRevision,
  });
}

function applyChartDeleted(handle: ProjectionHandleV1, chartId: Uint8Array): void {
  if (!handle.schema.charts.delete(idKey(chartId))) {
    throw new IntegrityError("chart.deleted names a chart this app does not hold");
  }
  run(handle, DELETE_CHART, [chartId]);
}

function applyFormulaChanged(
  handle: ProjectionHandleV1,
  payload: FormulaChangedPayloadV1<FormulaDefinitionV1>,
  schemaRevision: bigint,
): void {
  const entry = {
    formula: payload.formula,
    metadata: payload.metadata,
    isActive: true,
    schemaRevision,
  };
  run(handle, DELETE_FORMULA_DEPENDENCIES, [payload.formula.formulaId]);
  upsertFormulaRow(handle, entry);
  insertFormulaDependencies(handle, entry);
  handle.schema.formulas.set(idKey(payload.formula.formulaId), entry);
}

function applyFormulaRemoved(
  handle: ProjectionHandleV1,
  formulaId: Uint8Array,
  schemaRevision: bigint,
): void {
  const existing = handle.schema.formulas.get(idKey(formulaId));
  if (existing === undefined) {
    throw new IntegrityError("formula.removed names a formula this app lacks");
  }
  run(handle, DEACTIVATE_FORMULA, [toSqlInteger(schemaRevision), formulaId]);
  handle.schema.formulas.set(idKey(formulaId), { ...existing, isActive: false, schemaRevision });
  clearResults(handle, existing.formula.formulaId, targetFieldOf(existing.formula));
}

/**
 * A removed formula, or a deactivated computed column, keeps no lane, no
 * recalculated flag and no scalar result: "no result is silently
 * materialized" (database.md § `formula.removed`). Authored literals stay.
 */
function clearResults(
  handle: ProjectionHandleV1,
  formulaId: Uint8Array,
  fieldId: Uint8Array | null,
): void {
  run(handle, DELETE_SCALAR_RESULT, [formulaId]);
  if (fieldId !== null) {
    run(handle, DELETE_COMPUTED_CELLS_FOR_FIELD, [fieldId]);
    run(handle, DELETE_RECALCULATED_ISSUES_FOR_FIELD, [fieldId]);
  }
}

const targetFieldOf = (formula: FormulaDefinitionV1): Uint8Array | null =>
  formula.target.kind === "computed-column" ? formula.target.fieldId : null;

/**
 * Rebuilds a re-shaped table's lanes and search text from its authored
 * values, and — when the caller handed over the shared validator — its
 * records' verdicts. A value the new schema cannot index loses its lane and
 * keeps its authored state; nothing is rewritten in `authored_cbor`.
 */
function reindexTable(
  handle: ProjectionHandleV1,
  tableKey: string,
  revalidate: RecordRevalidatorV1 | undefined,
): void {
  const table = handle.schema.tables.get(tableKey);
  if (table === undefined) {
    return;
  }
  for (const row of selectRows(handle, SELECT_RECORDS_FOR_TABLE, [table.tableId])) {
    const authored = decodeAuthoredRecord(row[1] as Uint8Array);
    reindexRecord(
      handle,
      Number(row[0]),
      authored,
      revalidate === undefined ? null : revalidate(authored),
    );
  }
}

/** A restore may only undo a delete of the same record, recorded in history. */
function requireDeleteEvent(
  handle: ProjectionHandleV1,
  deletedEventId: Uint8Array,
  recordId: Uint8Array,
): ProjectionChangeSummaryV1 {
  const row = selectRow(handle, SELECT_DELETE_EVENT_FOR_RECORD, [
    deletedEventId,
  ]);
  if (row === null) {
    throw new IntegrityError("restore names no delete this app recorded");
  }
  if (!equalBytes(row[0] as Uint8Array, recordId)) {
    throw new IntegrityError("restore names a delete of another record");
  }
  return decodeChangeSummary(row[1] as Uint8Array);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return compareDomainIds(left, right) === 0;
}
