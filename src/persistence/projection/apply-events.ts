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
 */

import { IntegrityError } from "../../domain/model/errors.js";
import { asDomainId, compareDomainIds } from "../../domain/model/ids.js";
import type {
  AuthoredRecordV1,
  F02DomainEventV1,
  FieldChangeV1,
} from "../../domain/model/events.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import type { CommitId, FieldId } from "../../domain/model/ids.js";
import type { EnumOptionDefV1 } from "../../domain/model/schema.js";
import { compareCommits, verifyCommitChain } from "../codecs/event-commit.js";
import type {
  DomainEventV1,
  EventCommitV1,
} from "../../migrations/004_event_format_v1.js";
import {
  decodeAuthoredRecord,
  decodeChangeSummary,
  encodeAppTheme,
  encodeAuthoredRecord,
  encodeChangeSummary,
  encodeFrontier,
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
import { cacheEnumOption, insertEnumOption } from "./hydrate.js";
import {
  idKey,
  insertRecord,
  replaceRecord,
  searchableTextFor,
} from "./record-rows.js";
import {
  DELETE_ENUM_OPTIONS_FOR_FIELD,
  DELETE_RECORD,
  DELETE_SEARCH_ROW,
  INSERT_CHANGE_HISTORY,
  INSERT_SEARCH_ROW,
  SELECT_DELETE_EVENT_FOR_RECORD,
  SELECT_PROJECTION_APP_ID,
  SELECT_RECORDS_FOR_TABLE,
  SELECT_RECORD_STATE_BY_ID,
  SELECT_SCHEMA_REVISION,
  UPDATE_APP_STATE_SCHEMA_REVISION,
  UPDATE_APP_STATE_THEME,
  UPDATE_PROJECTION_FRONTIER,
} from "./statements.js";
import type {
  ChangeSubjectKindV1,
  ProjectionChangeSummaryV1,
  ProjectionCommitV1,
} from "./types.js";

interface RecordState {
  readonly recordPk: number;
  readonly tableId: Uint8Array;
  readonly recordRevision: bigint;
  readonly createdCommitId: CommitId;
  readonly authored: AuthoredRecordV1;
}

const EMPTY_SUMMARY: ProjectionChangeSummaryV1 = Object.freeze({
  fieldChanges: [],
  recordRevision: null,
  createdCommitId: null,
});

/**
 * Applies commits in canonical order. Either every event lands or the
 * projection is gone; there is no third outcome.
 */
export async function applyEvents(
  handle: ProjectionHandleV1,
  commits: readonly ProjectionCommitV1[],
): Promise<void> {
  assertUsable(handle);
  if (!handle.hydrated) {
    throw new IntegrityError("projection holds no app to replay onto");
  }
  if (commits.length === 0) {
    return;
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

  await withTransaction(handle, () => {
    let schemaRevision = readSchemaRevision(handle);
    for (const entry of ordered) {
      const { commit } = entry;
      for (const [index, event] of entry.events.entries()) {
        applyEvent(handle, entry, index, event);
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
  events: readonly F02DomainEventV1[],
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
  event: F02DomainEventV1,
): void {
  const wire = entry.commit.events[index] as DomainEventV1;
  const issues = entry.issuesByEventIndex?.get(index) ?? [];
  const commitId: CommitId = asDomainId("commit", entry.commit.commitId);
  let summary: ProjectionChangeSummaryV1 = EMPTY_SUMMARY;
  let restoration: Uint8Array | null = null;

  switch (event.kind) {
    case "app.created":
    case "table.created":
    case "field.created":
      // The schema and the app's identity arrive with the checkpoint promotion
      // wrote (CA-11/D29). Replaying the commit that created them may not
      // duplicate those rows — but it may not silently ignore a subject this
      // projection does not hold either, because that would be a missing table.
      assertSubjectExists(handle, event, wire);
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
      summary = {
        fieldChanges: [],
        recordRevision: 0n,
        createdCommitId: commitId,
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
      summary = {
        fieldChanges: event.payload.changes,
        recordRevision: event.payload.recordRevision,
        createdCommitId: state.createdCommitId,
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
      summary = {
        fieldChanges: [],
        recordRevision: state.recordRevision,
        createdCommitId: state.createdCommitId,
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
      summary = {
        fieldChanges: [],
        recordRevision: restoredRevision,
        createdCommitId: deleted.createdCommitId ?? commitId,
      };
      break;
    }

    case "enum.changed": {
      applyEnumChange(handle, event.payload.fieldId, event.payload.options);
      break;
    }

    case "theme.changed":
      run(handle, UPDATE_APP_STATE_THEME, [encodeAppTheme(event.payload.after)]);
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

const SUBJECT_KINDS: Readonly<Record<string, ChangeSubjectKindV1>> = {
  "app.created": "app",
  "table.created": "table",
  "field.created": "field",
  "enum.changed": "field",
  "record.created": "record",
  "record.patched": "record",
  "record.deleted": "record",
  "record.restored": "record",
  "theme.changed": "app",
  "import.accepted": "app",
  "inference-decision.recorded": "app",
};

function writeHistory(
  handle: ProjectionHandleV1,
  commit: EventCommitV1,
  wire: DomainEventV1,
  event: F02DomainEventV1,
  summary: ProjectionChangeSummaryV1,
  restoration: Uint8Array | null,
): void {
  const subjectKind = SUBJECT_KINDS[event.kind] as ChangeSubjectKindV1;
  run(handle, INSERT_CHANGE_HISTORY, [
    wire.eventId,
    commit.commitId,
    wire.eventIndex,
    event.kind,
    commit.eventClass,
    subjectKind,
    subjectIdOf(wire, subjectKind),
    toSqlInteger(commit.hybridTime.wallTimeMs),
    commit.hybridTime.logicalCounter,
    commit.deviceId,
    encodeChangeSummary(summary),
    restoration,
  ]);
}

function subjectIdOf(
  wire: DomainEventV1,
  subjectKind: ChangeSubjectKindV1,
): Uint8Array {
  const subject =
    subjectKind === "table"
      ? wire.subject.tableId
      : subjectKind === "field"
        ? wire.subject.fieldId
        : subjectKind === "record"
          ? wire.subject.recordId
          : wire.subject.appId;
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

/** The subject of a checkpoint-owned schema event must already be loaded. */
function assertSubjectExists(
  handle: ProjectionHandleV1,
  event: F02DomainEventV1,
  wire: DomainEventV1,
): void {
  if (event.kind === "table.created") {
    const tableId = wire.subject.tableId;
    if (tableId === undefined || !handle.schema.tables.has(idKey(tableId))) {
      throw new IntegrityError("event names a table this projection lacks");
    }
  }
  if (event.kind === "field.created") {
    const fieldId = wire.subject.fieldId;
    if (fieldId === undefined || !handle.schema.fields.has(idKey(fieldId))) {
      throw new IntegrityError("event names a field this projection lacks");
    }
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
