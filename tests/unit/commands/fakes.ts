/**
 * In-memory doubles for the two ports `executeCommand` writes through.
 *
 * The point of these is to let the *command* logic be exercised without
 * SQLite, IndexedDB, or crypto — the real engine and the real store are the
 * authority and they are proven in `tests/browser/worker/`. Two behaviours are
 * reproduced deliberately rather than simplified away, because a command that
 * got them wrong would still pass a friendlier fake:
 *
 * - **Fresh ID instances per query.** `list-fields` hands back newly decoded
 *   `FieldId` byte arrays every call, while `record-by-id` keys its values by
 *   the schema's own instances — exactly what S02's engine does. A `Map` keyed
 *   by a domain ID matches on object identity, so a command that failed to
 *   re-key would read every value as `missing` here, just as it would in the
 *   browser.
 * - **Append-then-apply ordering.** {@link FakeEventRepository} records the
 *   order its two collaborators were called in, so "acknowledge only after the
 *   durable commit" is something a test can assert rather than read.
 */

import {
  asDomainId,
  createDomainId,
  encodeDomainId,
  type AppId,
  type CommitId,
  type DeviceId,
  type EventId,
  type FieldId,
  type RecordId,
} from "../../../src/domain/model/ids.js";
import type {
  AuthoredRecordV1,
  F02DomainEventV1,
} from "../../../src/domain/model/events.js";
import type {
  EnumOptionDefV1,
  TableDefV1,
} from "../../../src/domain/model/schema.js";
import type { CellValueV1 } from "../../../src/domain/model/values.js";
import type {
  AppChainStateV1,
  CommitAppendRequestV1,
  CommitReceiptV1,
  LocalEventRepository,
} from "../../../src/application/ports/event-repository.js";
import type {
  ProjectionChangeEventV1,
  ProjectionEnginePort,
  ProjectionIssueInputV1,
  ProjectionQueryKindV1,
  ProjectionQueryResultsV1,
  ProjectionQueryV1,
  ProjectionRecordDetailV1,
  ProjectionRecordPageResultV1,
  ProjectionRecordSummaryV1,
} from "../../../src/application/ports/projection.js";
import type { ClockPort } from "../../../src/application/ports/clock.js";
import type { EventCommitV1 } from "../../../src/migrations/004_event_format_v1.js";

export const entropy = {
  randomBytes: (byteLength: number): Uint8Array =>
    crypto.getRandomValues(new Uint8Array(byteLength)),
};

export class FakeClock implements ClockPort {
  #epochMs: number;

  constructor(epochMs = 1_760_000_000_000) {
    this.#epochMs = epochMs;
  }

  nowEpochMs(): number {
    return this.#epochMs;
  }

  set(epochMs: number): void {
    this.#epochMs = epochMs;
  }
}

/** A 32-byte digest that depends on the record; enough to be compared. */
export function fakeRecordDigest(record: AuthoredRecordV1): Promise<Uint8Array> {
  const text = [...record.values]
    .map(([fieldId, value]) => `${encodeDomainId(fieldId)}:${JSON.stringify(value)}`)
    .sort()
    .join("|");
  const digest = new Uint8Array(32);
  for (let index = 0; index < text.length; index += 1) {
    const slot = index % 32;
    digest[slot] = ((digest[slot] as number) + text.charCodeAt(index)) % 256;
  }
  return Promise.resolve(digest);
}

// ------------------------------------------------------------------ engine --

interface FakeRecordV1 {
  readonly recordPk: number;
  record: AuthoredRecordV1;
  recordRevision: bigint;
  readonly createdCommitId: CommitId;
  updatedCommitId: CommitId;
  issues: readonly ProjectionIssueInputV1[];
}

export interface FakeProjectionSeedV1 {
  readonly table: TableDefV1;
  readonly enumOptions?: readonly EnumOptionDefV1[];
  readonly records?: readonly AuthoredRecordV1[];
  /**
   * Shared with {@link FakeEventRepository}. Both push their own name as they
   * run, so a test can read the order the two were called in.
   */
  readonly trace?: string[];
}

/** Re-decodes an ID so the caller gets a distinct instance of the same bytes. */
const freshId = <K extends "field" | "table">(kind: K, id: Uint8Array) =>
  asDomainId(kind, Uint8Array.from(id));

export class FakeProjection implements ProjectionEnginePort {
  readonly table: TableDefV1;
  readonly enumOptions: readonly EnumOptionDefV1[];
  readonly history: ProjectionChangeEventV1[] = [];
  readonly applied: EventCommitV1[] = [];
  readonly trace: string[];
  #records = new Map<string, FakeRecordV1>();
  #nextPk = 1;

  constructor(seed: FakeProjectionSeedV1) {
    this.table = seed.table;
    this.enumOptions = seed.enumOptions ?? [];
    this.trace = seed.trace ?? [];
    const origin = createDomainId("commit", entropy);
    for (const record of seed.records ?? []) {
      this.#insert(record, 0n, origin, []);
    }
  }

  execute<K extends ProjectionQueryKindV1>(
    query: Extract<ProjectionQueryV1, { readonly kind: K }>,
  ): ProjectionQueryResultsV1[K] {
    // Same shape as the engine's: the public signature pairs kind with result,
    // the body is written against the plain union where narrowing works, and
    // this is the one place the pairing is asserted.
    return this.#run(query) as ProjectionQueryResultsV1[K];
  }

  #run(query: ProjectionQueryV1): unknown {
    const answer = (value: unknown): unknown => value;

    switch (query.kind) {
      case "list-tables": {
        const summary = { ...this.table, tableId: freshId("table", this.table.tableId) };
        delete (summary as { fields?: unknown }).fields;
        return answer([summary]);
      }
      case "list-fields":
        // Fresh instances every call — the identity hazard, reproduced.
        return answer(
          this.table.fields.map((field) => ({
            ...field,
            fieldId: freshId("field", field.fieldId),
            tableId: freshId("table", field.tableId),
          })),
        );
      case "list-enum-options":
        return answer(
          this.enumOptions.filter(
            (option) =>
              encodeDomainId(option.fieldId) === encodeDomainId(query.fieldId),
          ),
        );
      case "list-validation-rules":
        return answer([]);
      case "count-records":
        return answer(this.#live().length);
      case "page-records":
        return answer(this.#page(this.#live(), query.afterRecordPk, query.limit));
      case "search-records":
        return answer(
          this.#page(
            this.#live().filter((entry) =>
              searchText(entry.record).toLowerCase().includes(query.text.toLowerCase()),
            ),
            query.afterRecordPk,
            query.limit,
          ),
        );
      case "record-by-id":
        return answer(this.#detail(query.recordId));
      case "record-change-history":
        return answer(
          this.history
            .filter(
              (entry) =>
                entry.subjectKind === "record" &&
                encodeDomainId(asDomainId("record", entry.subjectId)) ===
                  encodeDomainId(query.recordId),
            )
            .slice()
            .reverse()
            .slice(0, query.limit),
        );
      case "page-change-history": {
        const ordered = this.history.slice().reverse();
        const page = ordered.slice(0, query.limit);
        return answer({
          events: page,
          hasMore: ordered.length > query.limit,
          nextCursor: null,
        });
      }
      case "app-state":
        throw new Error("the fake projection holds no app state");
      default: {
        const unreachable: never = query;
        return unreachable;
      }
    }
  }

  applyEvents(
    commits: readonly {
      readonly commit: EventCommitV1;
      readonly events: readonly F02DomainEventV1[];
      readonly issuesByEventIndex?: ReadonlyMap<
        number,
        readonly ProjectionIssueInputV1[]
      >;
    }[],
  ): Promise<void> {
    this.trace.push("apply");
    for (const entry of commits) {
      if (entry.commit.events.length !== entry.events.length) {
        throw new Error("typed events do not cover the commit's events");
      }
      this.applied.push(entry.commit);
      const commitId = asDomainId("commit", entry.commit.commitId);
      entry.events.forEach((event, index) => {
        this.#apply(
          event,
          commitId,
          asDomainId("event", entry.commit.events[index]?.eventId as Uint8Array),
          entry.issuesByEventIndex?.get(index) ?? [],
        );
      });
    }
    return Promise.resolve();
  }

  liveRecordIds(): readonly string[] {
    return this.#live().map((entry) => encodeDomainId(entry.record.recordId));
  }

  #apply(
    event: F02DomainEventV1,
    commitId: CommitId,
    eventId: EventId,
    issues: readonly ProjectionIssueInputV1[],
  ): void {
    switch (event.kind) {
      case "record.created":
        this.#insert(event.payload.record, 0n, commitId, issues);
        this.#log(eventId, commitId, "record.created", event.payload.record.recordId, 0n, null);
        break;
      case "record.patched": {
        const entry = this.#require(event.payload.recordId);
        const values = new Map(entry.record.values);
        for (const change of event.payload.changes) {
          values.set(this.#canonicalField(change.fieldId), change.after);
        }
        entry.record = { ...entry.record, values };
        entry.recordRevision = event.payload.recordRevision;
        entry.updatedCommitId = commitId;
        entry.issues = issues;
        this.#log(
          eventId,
          commitId,
          "record.patched",
          event.payload.recordId,
          event.payload.recordRevision,
          null,
        );
        break;
      }
      case "record.deleted": {
        const entry = this.#require(event.payload.recordId);
        this.#records.delete(encodeDomainId(event.payload.recordId));
        this.#log(
          eventId,
          commitId,
          "record.deleted",
          event.payload.recordId,
          entry.recordRevision,
          event.payload.restoration,
        );
        break;
      }
      case "record.restored": {
        const deleted = this.history.find(
          (candidate) =>
            encodeDomainId(candidate.eventId) ===
            encodeDomainId(event.payload.deletedEventId),
        );
        const revision = (deleted?.summary.recordRevision ?? 0n) + 1n;
        this.#insert(event.payload.record, revision, commitId, issues);
        this.#log(
          eventId,
          commitId,
          "record.restored",
          event.payload.record.recordId,
          revision,
          null,
        );
        break;
      }
      default:
        throw new Error(`the fake projection does not apply ${event.kind}`);
    }
  }

  #insert(
    record: AuthoredRecordV1,
    recordRevision: bigint,
    commitId: CommitId,
    issues: readonly ProjectionIssueInputV1[],
  ): void {
    const key = encodeDomainId(record.recordId);
    if (this.#records.has(key)) {
      throw new Error("event creates a record that already exists");
    }
    // Values are re-keyed onto the schema's own field instances, exactly as
    // the engine's `canonicalFieldId` does.
    this.#records.set(key, {
      recordPk: this.#nextPk++,
      record: {
        ...record,
        values: new Map(
          [...record.values].map(([fieldId, value]) => [
            this.#canonicalField(fieldId),
            value,
          ]),
        ),
        provenance: new Map(
          [...record.provenance].map(([fieldId, value]) => [
            this.#canonicalField(fieldId),
            value,
          ]),
        ),
      },
      recordRevision,
      createdCommitId: commitId,
      updatedCommitId: commitId,
      issues,
    });
  }

  #canonicalField(fieldId: FieldId): FieldId {
    return (
      this.table.fields.find(
        (field) => encodeDomainId(field.fieldId) === encodeDomainId(fieldId),
      )?.fieldId ?? fieldId
    );
  }

  #log(
    eventId: EventId,
    commitId: CommitId,
    eventKind: string,
    subject: RecordId,
    recordRevision: bigint,
    restoration: AuthoredRecordV1 | null,
  ): void {
    this.history.push({
      eventId,
      commitId,
      eventIndex: 0,
      eventKind,
      eventClass: "authored",
      subjectKind: "record",
      subjectId: subject,
      wallTimeMs: this.history.length,
      logicalCounter: 0,
      deviceId: createDomainId("device", entropy),
      summary: { fieldChanges: [], recordRevision, createdCommitId: commitId },
      restoration,
    });
  }

  #live(): readonly FakeRecordV1[] {
    return [...this.#records.values()].sort(
      (left, right) => left.recordPk - right.recordPk,
    );
  }

  #require(recordId: RecordId): FakeRecordV1 {
    const entry = this.#records.get(encodeDomainId(recordId));
    if (entry === undefined) {
      throw new Error("event names a record this app does not hold");
    }
    return entry;
  }

  #page(
    source: readonly FakeRecordV1[],
    afterRecordPk: number | null,
    limit: number,
  ): ProjectionRecordPageResultV1 {
    const rest = source.filter(
      (entry) => afterRecordPk === null || entry.recordPk > afterRecordPk,
    );
    const page = rest.slice(0, limit).map((entry) => this.#summary(entry));
    return {
      records: page,
      hasMore: rest.length > limit,
      nextRecordPk: page.at(-1)?.recordPk ?? null,
    };
  }

  #summary(entry: FakeRecordV1): ProjectionRecordSummaryV1 {
    return {
      recordPk: entry.recordPk,
      recordId: entry.record.recordId,
      tableId: entry.record.tableId,
      recordRevision: entry.recordRevision,
      authoredValues: entry.record.values,
      blockingIssueCount: entry.issues.filter(
        (issue) => issue.severity === "blocking",
      ).length,
      warningIssueCount: entry.issues.filter(
        (issue) => issue.severity === "warning",
      ).length,
    };
  }

  #detail(recordId: RecordId): ProjectionRecordDetailV1 | null {
    const entry = this.#records.get(encodeDomainId(recordId));
    if (entry === undefined) {
      return null;
    }
    return {
      ...this.#summary(entry),
      createdCommitId: entry.createdCommitId,
      updatedCommitId: entry.updatedCommitId,
      provenance: entry.record.provenance,
      cells: [],
      issues: entry.issues.map((issue, ordinal) => ({
        issueId: new Uint8Array([ordinal]),
        fieldId: issue.fieldId,
        ruleId: issue.ruleId,
        issueKind: issue.kind,
        severity: issue.severity,
        messageKey: issue.messageKey,
        messageParameters: {},
      })),
    };
  }
}

const searchText = (record: AuthoredRecordV1): string =>
  [...record.values.values()]
    .map((value: CellValueV1) =>
      value.kind === "text"
        ? value.text
        : value.kind === "decimal"
          ? value.decimal
          : value.kind === "invalid-preserved"
            ? value.sourceText
            : "",
    )
    .join("\n");

// -------------------------------------------------------------- repository --

/** Records the call order so "durable before acknowledged" can be asserted. */
export class FakeEventRepository implements LocalEventRepository {
  readonly appends: CommitAppendRequestV1[] = [];
  readonly trace: string[];
  #chain: AppChainStateV1;

  constructor(
    appId: AppId,
    projection: FakeProjection,
    deviceId: DeviceId = createDomainId("device", entropy),
  ) {
    this.trace = projection.trace;
    this.#chain = {
      appId,
      deviceId,
      deviceCommitSequence: 0n,
      lastCommitSha256: null,
      lastHybridTime: null,
      frontier: [],
      schemaRevision: 1n,
    };
  }

  chainState(): AppChainStateV1 {
    return this.#chain;
  }

  append(request: CommitAppendRequestV1): Promise<CommitReceiptV1> {
    this.appends.push(request);
    this.trace.push("append");
    const commitSha256 = new Uint8Array(32).fill(
      Number(request.plan.deviceCommitSequence % 251n),
    );
    const commit: EventCommitV1 = {
      eventFormatVersion: 1,
      commitId: request.plan.commitId,
      appId: request.plan.appId,
      deviceId: request.plan.deviceId,
      deviceCommitSequence: request.plan.deviceCommitSequence,
      previousDeviceCommitSha256: request.plan.previousDeviceCommitSha256,
      basisFrontier: request.plan.basisFrontier,
      hybridTime: request.plan.hybridTime,
      eventClass: request.plan.eventClass,
      schemaRevisionBefore: request.plan.schemaRevisionBefore,
      schemaRevisionAfter: request.plan.schemaRevisionAfter,
      events: request.plan.events.map((planned) => ({
        eventId: planned.eventId,
        eventIndex: planned.eventIndex,
        kind: planned.event.kind,
        subject: planned.subject,
        payload: null,
        provenance: planned.provenance,
      })),
      commitSha256,
    };

    const frontier = [
      { deviceId: this.#chain.deviceId, commitSequence: request.plan.deviceCommitSequence },
    ];
    this.#chain = {
      ...this.#chain,
      deviceCommitSequence: request.plan.deviceCommitSequence,
      lastCommitSha256: commitSha256,
      lastHybridTime: request.plan.hybridTime,
      frontier,
    };

    return Promise.resolve({
      commit,
      headRevision: request.plan.deviceCommitSequence + 1n,
      frontier,
      transactionRevision: Number(request.plan.deviceCommitSequence) + 1,
    });
  }
}
