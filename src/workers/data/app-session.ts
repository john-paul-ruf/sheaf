/**
 * One open app inside the data worker: hydrate, answer, and disappear (M33;
 * CA-13 consumer and prover, CAP-15, CAP-13's restart leg).
 *
 * **The mapping from durable roots to the projection is this file's, and it is
 * where the two formats meet.** S04's checkpoint manifest and record pages
 * carry `StoredRecordV1`; S02's engine takes `ProjectionRecordV1`. Three of the
 * differences are decisions rather than field renames, so each is stated here
 * and asserted in `tests/unit/workers/app-session.test.ts`:
 *
 * - **Issues come back through the one shared validator.** A record page stores
 *   each issue's field, kind, severity, and message key, but not its message
 *   parameters — and a projection row needs them, because "Amount" is what a
 *   person reads, not `type/warning`. So hydration re-runs `validateRecord`
 *   over the checkpoint's own schema and **requires the recomputed verdict to
 *   agree with the stored one**, field for field. The durable page stays the
 *   authority on what was decided; the validator supplies the words. A
 *   disagreement is an integrity condition, not something to paper over
 *   (invariant 5).
 * - **Per-field provenance is empty, because the record page holds none.** An
 *   imported record's page carries values and issues only. Reporting an empty
 *   map is the truthful reading of that; synthesising `initial-import` for
 *   every field would be inventing evidence the bytes do not state. Patches
 *   fill provenance in as they land, so the map grows where a fact exists.
 * - **The creating commit is the checkpoint's own.** `app.created` pairs with
 *   an initial checkpoint (CA-11), and the checkpoint's frontier names exactly
 *   the commits it covers — so the canonically last covered commit is the one
 *   that produced these rows.
 *
 * **`validationRules` is `[]` and that is not a missing producer.** F02 authors
 * no rule events and S04's checkpoint manifest carries no rules by design; the
 * editors arrive in F04. `list-validation-rules` is therefore truthfully empty.
 *
 * **The tail is replayed one commit at a time**, and the validator decides each
 * one against the state the projection actually holds at that moment — the same
 * decision `executeCommand` made when the commit was written. Replaying without
 * it would bring a record back after a restart with its warnings silently gone.
 * `hydrateApp(checkpoint, [])` followed by `applyEvents` performs exactly the
 * writes of `hydrateApp(checkpoint, tail)` by S02's construction, so CA-13's
 * equivalence is preserved rather than worked around.
 *
 * **Lock is the scrub.** {@link AppSessionRegistry.disposeAll} destroys every
 * projection and every app key; after it, no query can be answered without a
 * fresh `openApp`.
 */

import { decodeStorageId16 } from "../../domain/model/bytes.js";
import { IntegrityError } from "../../domain/model/errors.js";
import {
  asDomainId,
  compareDomainIds,
  encodeDomainId,
  type AppId,
  type CommitId,
  type DeviceId,
  type FieldId,
  type TableId,
} from "../../domain/model/ids.js";
import type { AuthoredRecordV1, F02DomainEventV1 } from "../../domain/model/events.js";
import type { EnumOptionDefV1, TableDefV1 } from "../../domain/model/schema.js";
import { MISSING_VALUE, type CellValueV1 } from "../../domain/model/values.js";
import {
  validateRecord,
  type ValidationContext,
} from "../../domain/validation/validate-record.js";
import type { EnvelopeKeyRefV1 } from "../../application/ports/envelope-crypto.js";
import type {
  ProjectionEnginePort,
  ProjectionQueryKindV1,
  ProjectionQueryResultsV1,
  ProjectionQueryV1 as PortQueryV1,
} from "../../application/ports/projection.js";
import { sha256 } from "../../crypto/hash.js";
import type { StoredRecordV1 } from "../../import/staging/roots.js";
import type { EventCommitV1 } from "../../migrations/004_event_format_v1.js";
import {
  applyEvents,
  disposeProjection,
  executeQuery,
  hydrateApp,
  openProjection,
  type ProjectionCheckpointV1,
  type ProjectionCommitV1,
  type ProjectionHandleV1,
  type ProjectionRecordV1,
  type ValidationIssueV1Input,
} from "../../persistence/projection/index.js";
import {
  createEventStore,
  deviceOnlyChangeCount,
  loadApp,
  type AppEventStoreV1,
  type AppStoragePortsV1,
  type LoadedAppV1,
  type WorkerSessionContextV1,
} from "./event-store.js";
import {
  decodeRecordEventPayload,
  isRecordEventKind,
} from "./record-event-payloads.js";

/** Everything `validateRecord` needs for one table, on one set of instances. */
interface TableContextV1 {
  readonly table: TableDefV1;
  readonly context: ValidationContext;
}

export interface AppSessionV1 {
  readonly appId: AppId;
  readonly appKey: EnvelopeKeyRefV1;
  readonly projection: ProjectionEnginePort;
  readonly repository: AppEventStoreV1;
  readonly deviceOnlyChangeCount: () => number;
  dispose(): void;
}

export interface OpenAppSessionInputV1 {
  readonly ports: AppStoragePortsV1;
  readonly session: () => WorkerSessionContextV1;
  readonly deviceId: DeviceId;
  readonly appKey: EnvelopeKeyRefV1;
  readonly appHeadStorageId: string;
  readonly hydratedAtMs: number;
}

export async function openAppSession(
  input: OpenAppSessionInputV1,
): Promise<AppSessionV1> {
  const loaded = await loadApp(input.ports, input.appKey, input.appHeadStorageId);
  const contexts = tableContexts(loaded.checkpoint.tables, loaded.checkpoint.enumOptions);

  const handle = await openProjection({ sha256 });
  try {
    await hydrateApp(handle, toProjectionCheckpoint(loaded, contexts, input.hydratedAtMs));
    await replayTail(handle, loaded, contexts);
  } catch (cause) {
    // `openProjection`/`hydrateApp` dispose on their own failure paths; this
    // covers the tail, and disposing twice is safe.
    disposeProjection(handle);
    input.ports.crypto.destroyKey(input.appKey);
    throw cause;
  }

  const repository = createEventStore(
    { ports: input.ports, session: input.session, deviceId: input.deviceId },
    input.appKey,
    loaded,
  );

  let disposed = false;
  return {
    appId: loaded.appId,
    appKey: input.appKey,
    projection: engineAdapter(handle),
    repository,
    deviceOnlyChangeCount: (): number =>
      deviceOnlyChangeCount(repository.loaded().head.frontier, input.deviceId),
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      disposeProjection(handle);
      input.ports.crypto.destroyKey(input.appKey);
    },
  };
}

/** M12 behind M07's port. The two vocabularies are structurally identical. */
function engineAdapter(handle: ProjectionHandleV1): ProjectionEnginePort {
  return {
    execute<K extends ProjectionQueryKindV1>(
      query: Extract<PortQueryV1, { readonly kind: K }>,
    ): ProjectionQueryResultsV1[K] {
      // The port restates M12's vocabulary structurally, so the two are the
      // same type to the compiler; `tests/unit/workers/projection-port.test.ts`
      // is what keeps them that way.
      return executeQuery(handle, query);
    },
    applyEvents(commits): Promise<void> {
      return applyEvents(handle, commits);
    },
  };
}

// ------------------------------------------------------- checkpoint mapping --

function tableContexts(
  tables: readonly TableDefV1[],
  enumOptions: readonly EnumOptionDefV1[],
): ReadonlyMap<string, TableContextV1> {
  const contexts = new Map<string, TableContextV1>();
  for (const table of tables) {
    const optionsByField = new Map<FieldId, readonly EnumOptionDefV1[]>();
    for (const field of table.fields) {
      if (field.type.kind === "enum") {
        optionsByField.set(
          field.fieldId,
          enumOptions.filter(
            (option) =>
              encodeDomainId(option.fieldId) === encodeDomainId(field.fieldId),
          ),
        );
      }
    }
    contexts.set(encodeDomainId(table.tableId), {
      table,
      context: {
        table,
        enumOptions: optionsByField,
        // Roshi Seam A: the checkpoint manifest carries no rules by design.
        rules: [],
        referenceExists: (): boolean => false,
      },
    });
  }
  return contexts;
}

export function toProjectionCheckpoint(
  loaded: LoadedAppV1,
  contexts: ReadonlyMap<string, TableContextV1>,
  hydratedAtMs: number,
): ProjectionCheckpointV1 {
  const { checkpoint } = loaded;
  const commitId = checkpointCommitId(loaded);

  return {
    appId: checkpoint.appId,
    checkpointStorageId: decodeStorageId16(loaded.head.checkpoint.storageId),
    checkpointSemanticSha256: loaded.head.checkpoint.semanticSha256,
    frontier: checkpoint.frontier,
    hydratedAtMs,
    appState: checkpoint.appState,
    sheetSnapshots: checkpoint.sheetSnapshots.map((sheet) => ({
      sheetId: sheet.sheetId,
      displayName: sheet.displayName,
      sheetOrdinal: sheet.sheetOrdinal,
      // A delimited import produces exactly one table sheet; nothing about a
      // CSV can classify it as a lookup, a summary, or a chart.
      classification: ["table" as const],
      snapshotManifestStorageId: decodeStorageId16(sheet.snapshotManifestStorageId),
      declaredRowCount: sheet.declaredRowCount,
      declaredColumnCount: sheet.declaredColumnCount,
      // The manifest records no revision of its own; the snapshot was written
      // with this schema and moves only when the schema does.
      snapshotRevision: checkpoint.schemaRevision,
    })),
    tables: checkpoint.tables,
    enumOptions: checkpoint.enumOptions,
    validationRules: [],
    recordPages: loaded.recordPages.map((page) => ({
      records: page.records.map((record) =>
        toProjectionRecord(record, contexts, commitId),
      ),
    })),
  };
}

/**
 * The commit that produced the checkpoint's rows: the canonically last one the
 * checkpoint's frontier covers. A checkpoint that covers nothing has no author
 * to name, and hydration refuses rather than attributing the rows to a commit
 * it picked.
 */
function checkpointCommitId(loaded: LoadedAppV1): CommitId {
  const covered = new Map(
    loaded.checkpoint.frontier.map((entry) => [
      encodeDomainId(asDomainId("device", entry.deviceId)),
      entry.commitSequence,
    ]),
  );
  const last = loaded.commits
    .filter(
      (commit) =>
        commit.deviceCommitSequence <=
        (covered.get(encodeDomainId(asDomainId("device", commit.deviceId))) ?? 0n),
    )
    .at(-1);
  if (last === undefined) {
    throw new IntegrityError("the checkpoint names no commit that produced it");
  }
  return asDomainId("commit", last.commitId);
}

export function toProjectionRecord(
  stored: StoredRecordV1,
  contexts: ReadonlyMap<string, TableContextV1>,
  commitId: CommitId,
): ProjectionRecordV1 {
  const entry = contexts.get(encodeDomainId(stored.tableId));
  if (entry === undefined) {
    throw new IntegrityError("a record page names a table the checkpoint lacks");
  }

  const values = new Map<FieldId, CellValueV1>(
    stored.values.map(({ fieldId, value }) => [
      canonicalField(entry.table, fieldId),
      value,
    ]),
  );
  const record: AuthoredRecordV1 = {
    recordId: stored.recordId,
    tableId: entry.table.tableId,
    values,
    // The record page stores no per-field provenance. Empty says exactly that.
    provenance: new Map(),
  };

  const report = validateRecord(entry.context, {
    recordId: stored.recordId,
    tableId: entry.table.tableId,
    values,
  });
  assertIssuesAgree(stored, report.issues);

  return {
    record,
    // Imported rows enter at revision zero; every later change is an event.
    recordRevision: 0n,
    createdCommitId: commitId,
    updatedCommitId: commitId,
    issues: report.issues.map(toIssueInput),
  };
}

const issueKey = (issue: {
  readonly fieldId: FieldId | null;
  readonly kind: string;
  readonly severity: string;
  readonly messageKey: string;
}): string =>
  [
    issue.fieldId === null ? "" : encodeDomainId(issue.fieldId),
    issue.kind,
    issue.severity,
    issue.messageKey,
  ].join("|");

/**
 * The stored verdict and the recomputed one must be the same verdict. The page
 * is the authority on what was decided at import; the validator is the only
 * thing allowed to decide it. If they disagree, something changed that this
 * session cannot see, and answering from either would be a guess.
 */
function assertIssuesAgree(
  stored: StoredRecordV1,
  recomputed: readonly { readonly fieldId: FieldId | null; readonly kind: string; readonly severity: string; readonly messageKey: string }[],
): void {
  const left = stored.issues.map(issueKey).sort();
  const right = recomputed.map(issueKey).sort();
  if (left.length !== right.length || left.some((key, index) => key !== right[index])) {
    throw new IntegrityError(
      "the validator disagrees with the issues this record page recorded",
    );
  }
}

const toIssueInput = (issue: {
  readonly fieldId: FieldId | null;
  readonly ruleId: ValidationIssueV1Input["ruleId"];
  readonly kind: ValidationIssueV1Input["kind"];
  readonly severity: ValidationIssueV1Input["severity"];
  readonly messageKey: string;
  readonly messageParameters: ValidationIssueV1Input["messageParameters"];
}): ValidationIssueV1Input => ({
  fieldId: issue.fieldId,
  ruleId: issue.ruleId,
  kind: issue.kind,
  severity: issue.severity,
  messageKey: issue.messageKey,
  messageParameters: issue.messageParameters,
});

function canonicalField(table: TableDefV1, fieldId: FieldId): FieldId {
  return (
    table.fields.find(
      (field) => encodeDomainId(field.fieldId) === encodeDomainId(fieldId),
    )?.fieldId ?? fieldId
  );
}

// --------------------------------------------------------------- tail replay --

async function replayTail(
  handle: ProjectionHandleV1,
  loaded: LoadedAppV1,
  contexts: ReadonlyMap<string, TableContextV1>,
): Promise<void> {
  const covered = new Map(
    loaded.checkpoint.frontier.map((entry) => [
      encodeDomainId(asDomainId("device", entry.deviceId)),
      entry.commitSequence,
    ]),
  );

  for (const commit of loaded.commits) {
    const seen = covered.get(encodeDomainId(asDomainId("device", commit.deviceId))) ?? 0n;
    if (commit.deviceCommitSequence <= seen) {
      continue;
    }
    // One at a time: each event's issues are decided against the state the
    // projection holds *now*, which is the state the command decided against.
    await applyEvents(handle, [toProjectionCommit(handle, commit, contexts)]);
  }
}

function toProjectionCommit(
  handle: ProjectionHandleV1,
  commit: EventCommitV1,
  contexts: ReadonlyMap<string, TableContextV1>,
): ProjectionCommitV1 {
  const events: F02DomainEventV1[] = [];
  const issuesByEventIndex = new Map<number, readonly ValidationIssueV1Input[]>();

  commit.events.forEach((wire, index) => {
    if (!isRecordEventKind(wire.kind)) {
      // F02's tail is CRUD only. A kind that is not one of the four is a
      // commit this build cannot replay, and guessing would be worse.
      throw new IntegrityError("a tail commit carries an event this build cannot replay");
    }
    const typed = decodeRecordEventPayload(wire.kind, wire.payload as never);
    events.push(typed);
    const issues = issuesForEvent(handle, contexts, typed);
    if (issues.length > 0) {
      issuesByEventIndex.set(index, issues);
    }
  });

  return issuesByEventIndex.size === 0
    ? { commit, events }
    : { commit, events, issuesByEventIndex };
}

/** The one shared validator, re-deciding exactly what it decided at write time. */
function issuesForEvent(
  handle: ProjectionHandleV1,
  contexts: ReadonlyMap<string, TableContextV1>,
  event: F02DomainEventV1,
): readonly ValidationIssueV1Input[] {
  switch (event.kind) {
    case "record.created":
      return validateAgainst(contexts, event.payload.record);
    case "record.restored":
      return validateAgainst(contexts, event.payload.record);
    case "record.patched": {
      const current = executeQuery(handle, {
        kind: "record-by-id",
        recordId: event.payload.recordId,
      });
      if (current === null) {
        // The replay guards will refuse this commit for the same reason; let
        // them, with their message, rather than inventing a verdict here.
        return [];
      }
      const values = new Map(current.authoredValues);
      for (const change of event.payload.changes) {
        values.set(canonicalOf(contexts, event.payload.tableId, change.fieldId), change.after);
      }
      return validateAgainst(contexts, {
        recordId: event.payload.recordId,
        tableId: event.payload.tableId,
        values,
        provenance: new Map(),
      });
    }
    case "record.deleted":
      return [];
    default:
      return [];
  }
}

function validateAgainst(
  contexts: ReadonlyMap<string, TableContextV1>,
  record: AuthoredRecordV1,
): readonly ValidationIssueV1Input[] {
  const entry = contexts.get(encodeDomainId(record.tableId));
  if (entry === undefined) {
    return [];
  }
  const values = new Map<FieldId, CellValueV1>();
  for (const field of entry.table.fields) {
    const value = [...record.values].find(
      ([fieldId]) => encodeDomainId(fieldId) === encodeDomainId(field.fieldId),
    )?.[1];
    values.set(field.fieldId, value ?? MISSING_VALUE);
  }
  for (const [fieldId, value] of record.values) {
    if (
      !entry.table.fields.some(
        (field) => encodeDomainId(field.fieldId) === encodeDomainId(fieldId),
      )
    ) {
      values.set(fieldId, value);
    }
  }
  return validateRecord(entry.context, {
    recordId: record.recordId,
    tableId: entry.table.tableId,
    values,
  }).issues.map(toIssueInput);
}

function canonicalOf(
  contexts: ReadonlyMap<string, TableContextV1>,
  tableId: TableId,
  fieldId: FieldId,
): FieldId {
  const entry = contexts.get(encodeDomainId(tableId));
  return entry === undefined ? fieldId : canonicalField(entry.table, fieldId);
}

// ------------------------------------------------------------------ registry --

/** Every app this worker currently holds unlocked. Lock empties it. */
export class AppSessionRegistry {
  #open = new Map<string, AppSessionV1>();

  get(appId: string): AppSessionV1 | undefined {
    return this.#open.get(appId);
  }

  set(appId: string, session: AppSessionV1): void {
    this.close(appId);
    this.#open.set(appId, session);
  }

  close(appId: string): void {
    const session = this.#open.get(appId);
    if (session !== undefined) {
      session.dispose();
      this.#open.delete(appId);
    }
  }

  /** The scrub: after this, no query can be answered without a fresh open. */
  disposeAll(): void {
    for (const session of this.#open.values()) {
      session.dispose();
    }
    this.#open.clear();
  }
}

export { compareDomainIds };
