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
 * - **The workbook roots map straight through (D37).** Sheet classifications
 *   and revisions, relationships, rules, inert items, lineages, and decisions
 *   come from the decoded manifest as written; an F02 manifest decodes to its
 *   F02-true defaults in `roots.ts`, never here. The one filter: a decision
 *   with no decision kind is durable evidence but not a projection row.
 * - **References on a checkpoint page resolve against the checkpoint's own
 *   records** — the same {@link ReferenceResolver} predicate promotion answers
 *   from its key map, over the rows promotion actually wrote.
 *
 * **The tail is replayed one commit at a time**, and the validator decides each
 * one against the state the projection actually holds at that moment — the same
 * decision `executeCommand` made when the commit was written, through the same
 * context builder, resolver, and provenance rule. Replaying without it would
 * bring a record back after a restart with its warnings silently gone. A tail
 * may create a table (an appended CSV, D38); its records are then validated
 * against that table, because the context comes from the projection.
 * `hydrateApp(checkpoint, [])` followed by `applyEvents` performs exactly the
 * writes of `hydrateApp(checkpoint, tail)` by S02's construction, so CA-13's
 * equivalence is preserved rather than worked around.
 *
 * **Lock is the scrub.** {@link AppSessionRegistry.disposeAll} destroys every
 * projection and every app key; after it, no query can be answered without a
 * fresh `openApp`.
 */

import { decodeStorageId16, type StorageId16 } from "../../domain/model/bytes.js";
import { IntegrityError } from "../../domain/model/errors.js";
import {
  asDomainId,
  compareDomainIds,
  encodeDomainId,
  type AppId,
  type CommitId,
  type DeviceId,
  type FieldId,
} from "../../domain/model/ids.js";
import type { AuthoredRecordV1 } from "../../domain/model/events.js";
import type { DomainEventV1 } from "../../application/ports/event-repository.js";
import type { ValueProvenanceV1 } from "../../domain/model/provenance.js";
import type { EnumOptionDefV1, TableDefV1 } from "../../domain/model/schema.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import {
  validateRecord,
  type ReferenceResolver,
  type ValidationContext,
} from "../../domain/validation/validate-record.js";
import {
  changeProvenance,
  validateAgainstProjection,
} from "../../application/commands/execute-command.js";
import type { EnvelopeKeyRefV1 } from "../../application/ports/envelope-crypto.js";
import type {
  ProjectionEnginePort,
  ProjectionQueryKindV1,
  ProjectionQueryResultsV1,
  ProjectionQueryV1 as PortQueryV1,
} from "../../application/ports/projection.js";
import { sha256 } from "../../crypto/hash.js";
import {
  resolveCheckpointManifest,
  type ResolvedCheckpointManifestV1,
  type StoredRecordV1,
} from "../../import/staging/roots.js";
import type { EventCommitV1 } from "../../migrations/004_event_format_v1.js";
import type { SnapshotChunkLoader } from "../../import/snapshots/sheet-snapshot.js";
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
import { decodeTailEventPayload, isTailEventKind } from "./record-event-payloads.js";

/** Everything `validateRecord` needs for one table, on one set of instances. */
interface TableContextV1 {
  readonly table: TableDefV1;
  readonly context: ValidationContext;
}

/** One snapshot, opened: its manifest bytes and a verifying chunk loader. */
export interface OpenedSnapshotV1 {
  readonly manifest: Uint8Array;
  readonly loadChunk: SnapshotChunkLoader;
}

export interface AppSessionV1 {
  readonly appId: AppId;
  readonly appKey: EnvelopeKeyRefV1;
  readonly projection: ProjectionEnginePort;
  readonly repository: AppEventStoreV1;
  readonly deviceOnlyChangeCount: () => number;
  /**
   * Decrypts a snapshot manifest this app's head names, checked against the
   * head's digest, and hands back a loader that decrypts one chunk at a time
   * and checks each against the manifest's digest. Nothing is decrypted until
   * a page asks for it.
   */
  openSnapshot(manifestStorageId: StorageId16): Promise<OpenedSnapshotV1>;
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
  const checkpoint = resolveCheckpointManifest(loaded.checkpoint);
  const contexts = tableContexts(checkpoint, checkpointResolver(loaded));

  const handle = await openProjection({ sha256 });
  try {
    await hydrateApp(
      handle,
      toProjectionCheckpoint(loaded, checkpoint, contexts, input.hydratedAtMs),
    );
    await replayTail(handle, loaded);
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
    openSnapshot: (manifestStorageId) =>
      openSnapshot(input.ports, input.appKey, repository.loaded().head, manifestStorageId),
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

// ---------------------------------------------------------------- snapshots --

/** Reads one envelope under the app key and checks it against `sha256`. */
async function openVerified(
  ports: AppStoragePortsV1,
  appKey: EnvelopeKeyRefV1,
  storageId: StorageId16,
  kind: "app.snapshot-manifest" | "app.snapshot-chunk",
  sha256Expected: Uint8Array,
): Promise<Uint8Array> {
  const frame = await ports.store.getEnvelope(storageId);
  if (frame === undefined) {
    throw new IntegrityError("a snapshot root this app names is not in the store");
  }
  const { payload } = await ports.crypto.open(frame, kind, appKey, kind);
  const digest = await ports.crypto.sha256(payload);
  if (compareDomainIds(digest, sha256Expected) !== 0) {
    throw new IntegrityError("a snapshot root does not match its recorded digest");
  }
  return payload;
}

async function openSnapshot(
  ports: AppStoragePortsV1,
  appKey: EnvelopeKeyRefV1,
  head: LoadedAppV1["head"],
  manifestStorageId: StorageId16,
): Promise<OpenedSnapshotV1> {
  // A snapshot the head does not name is not this app's (database.md §
  // `AppHeadV1`: every reachable snapshot is listed).
  const ref = head.snapshotManifests.find(
    (candidate) =>
      compareDomainIds(decodeStorageId16(candidate.storageId), manifestStorageId) === 0,
  );
  if (ref === undefined) {
    throw new IntegrityError("a sheet names a snapshot its app head does not list");
  }
  const manifest = await openVerified(
    ports,
    appKey,
    manifestStorageId,
    "app.snapshot-manifest",
    ref.semanticSha256,
  );
  return {
    manifest,
    loadChunk: (chunk) =>
      openVerified(
        ports,
        appKey,
        decodeStorageId16(chunk.storageId),
        "app.snapshot-chunk",
        chunk.sha256,
      ),
  };
}

// ------------------------------------------------------- checkpoint mapping --

function tableContexts(
  checkpoint: Omit<ResolvedCheckpointManifestV1, "semanticSha256">,
  referenceExists: ReferenceResolver,
): ReadonlyMap<string, TableContextV1> {
  const contexts = new Map<string, TableContextV1>();
  for (const table of checkpoint.tables) {
    const optionsByField = new Map<FieldId, readonly EnumOptionDefV1[]>();
    for (const field of table.fields) {
      if (field.type.kind === "enum") {
        optionsByField.set(
          field.fieldId,
          checkpoint.enumOptions.filter(
            (option) =>
              encodeDomainId(option.fieldId) === encodeDomainId(field.fieldId),
          ),
        );
      }
    }
    const tableKey = encodeDomainId(table.tableId);
    contexts.set(tableKey, {
      table,
      context: {
        table,
        enumOptions: optionsByField,
        rules: checkpoint.validationRules
          .filter(
            (rule) => rule.isActive && encodeDomainId(rule.tableId) === tableKey,
          )
          .map((rule) => rule.rule),
        referenceExists,
        referenceTargets: checkpoint.relationships
          .filter(
            (relationship) =>
              relationship.isActive &&
              encodeDomainId(relationship.fromTableId) === tableKey,
          )
          .map((relationship) => ({
            fieldId: canonicalField(table, relationship.fromFieldId),
            tableId: relationship.toTableId,
            tableLabel:
              checkpoint.tables.find(
                (target) =>
                  encodeDomainId(target.tableId) ===
                  encodeDomainId(relationship.toTableId),
              )?.displayName ?? "",
          })),
      },
    });
  }
  return contexts;
}

/** Live means present on one of this checkpoint's record pages, in that table. */
function checkpointResolver(loaded: LoadedAppV1): ReferenceResolver {
  const live = new Set(
    loaded.recordPages.flatMap((page) =>
      page.records.map(
        (record) => `${encodeDomainId(record.tableId)}:${encodeDomainId(record.recordId)}`,
      ),
    ),
  );
  return (tableId, recordId) =>
    live.has(`${encodeDomainId(tableId)}:${encodeDomainId(recordId)}`);
}

export function toProjectionCheckpoint(
  loaded: LoadedAppV1,
  checkpoint: Omit<ResolvedCheckpointManifestV1, "semanticSha256">,
  contexts: ReadonlyMap<string, TableContextV1>,
  hydratedAtMs: number,
): ProjectionCheckpointV1 {
  const commitId = checkpointCommitId(loaded);

  return {
    appId: checkpoint.appId,
    checkpointStorageId: decodeStorageId16(loaded.head.checkpoint.storageId),
    checkpointSemanticSha256: loaded.head.checkpoint.semanticSha256,
    frontier: checkpoint.frontier,
    hydratedAtMs,
    appState: checkpoint.appState,
    sheetSnapshots: checkpoint.sheetSnapshots.map((sheet) => ({
      ...sheet,
      snapshotManifestStorageId: decodeStorageId16(sheet.snapshotManifestStorageId),
    })),
    tables: checkpoint.tables,
    enumOptions: checkpoint.enumOptions,
    relationships: checkpoint.relationships,
    validationRules: checkpoint.validationRules,
    formulas: checkpoint.formulas,
    inertItems: checkpoint.inertItems.map((item) => ({
      ...item,
      preservedManifestStorageId:
        item.preservedManifestStorageId === null
          ? null
          : decodeStorageId16(item.preservedManifestStorageId),
    })),
    importLineages: checkpoint.importLineages,
    inferenceDecisions: checkpoint.inferenceDecisions.flatMap((decision) =>
      decision.decisionKind === null
        ? []
        : [
            {
              decisionId: decision.decisionId,
              decisionKind: decision.decisionKind,
              evidenceFingerprint: decision.evidenceFingerprint,
              disposition: decision.disposition,
              statement: decision.statement,
              evidence: decision.evidence,
              recordedEventId: decision.recordedEventId,
            },
          ],
    ),
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
): Promise<void> {
  const covered = new Map(
    loaded.checkpoint.frontier.map((entry) => [
      encodeDomainId(asDomainId("device", entry.deviceId)),
      entry.commitSequence,
    ]),
  );
  const projection = engineAdapter(handle);

  for (const commit of loaded.commits) {
    const seen = covered.get(encodeDomainId(asDomainId("device", commit.deviceId))) ?? 0n;
    if (commit.deviceCommitSequence <= seen) {
      continue;
    }
    // One at a time: each event's issues are decided against the state the
    // projection holds *now*, which is the state the command decided against.
    await applyEvents(handle, [toProjectionCommit(projection, commit)]);
  }
}

function toProjectionCommit(
  projection: ProjectionEnginePort,
  commit: EventCommitV1,
): ProjectionCommitV1 {
  const events: DomainEventV1[] = [];
  const issuesByEventIndex = new Map<number, readonly ValidationIssueV1Input[]>();

  commit.events.forEach((wire, index) => {
    if (!isTailEventKind(wire.kind)) {
      // A tail is CRUD, or an appended table's one import commit (D38). Any
      // other kind is a commit this build cannot replay, and guessing would
      // be worse.
      throw new IntegrityError("a tail commit carries an event this build cannot replay");
    }
    const typed = decodeTailEventPayload(wire.kind, wire.payload as never);
    events.push(typed);
    const issues = issuesForEvent(projection, typed);
    if (issues.length > 0) {
      issuesByEventIndex.set(index, issues);
    }
  });

  return {
    commit,
    events,
    ...(issuesByEventIndex.size === 0 ? {} : { issuesByEventIndex }),
    revalidate: projectionRevalidator(projection),
  };
}

/**
 * The validator a schema commit's re-shaped tables are re-judged through,
 * against the projection as the commit left it. Nothing is authored by a
 * re-judgement, so no provenance is claimed — exactly as a command would
 * see a record it did not touch (D36).
 */
export function projectionRevalidator(
  projection: ProjectionEnginePort,
): (record: AuthoredRecordV1) => readonly ValidationIssueV1Input[] {
  return (record) =>
    validateAgainstProjection(projection, {
      recordId: record.recordId,
      tableId: record.tableId,
      values: record.values,
      provenance: new Map(),
    })?.issues.map(toIssueInput) ?? [];
}

/** The one shared validator, re-deciding exactly what it decided at write time. */
function issuesForEvent(
  projection: ProjectionEnginePort,
  event: DomainEventV1,
): readonly ValidationIssueV1Input[] {
  switch (event.kind) {
    case "record.created":
    case "record.restored":
      return validated(projection, event.payload.record, event.payload.record.provenance);
    case "record.patched": {
      const current = projection.execute({
        kind: "record-by-id",
        recordId: event.payload.recordId,
      });
      if (current === null) {
        // The replay guards will refuse this commit for the same reason; let
        // them, with their message, rather than inventing a verdict here.
        return [];
      }
      const values = new Map<string, readonly [FieldId, CellValueV1]>(
        [...current.authoredValues].map(([fieldId, value]) => [
          encodeDomainId(fieldId),
          [fieldId, value] as const,
        ]),
      );
      for (const change of event.payload.changes) {
        values.set(encodeDomainId(change.fieldId), [change.fieldId, change.after]);
      }
      return validated(
        projection,
        {
          recordId: event.payload.recordId,
          tableId: event.payload.tableId,
          values: new Map(values.values()),
        },
        changeProvenance(event.payload.changes),
      );
    }
    default:
      return [];
  }
}

function validated(
  projection: ProjectionEnginePort,
  record: Pick<AuthoredRecordV1, "recordId" | "tableId" | "values">,
  provenance: ReadonlyMap<FieldId, ValueProvenanceV1>,
): readonly ValidationIssueV1Input[] {
  return (
    validateAgainstProjection(projection, { ...record, provenance })?.issues.map(
      toIssueInput,
    ) ?? []
  );
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
