/**
 * Command → events → one commit plan (M34; CA-08 consumer).
 *
 * Everything a commit claims about its place in the chain is derived from the
 * repository's {@link AppChainStateV1}, never from a counter this module keeps:
 *
 * - `deviceCommitSequence` is the read sequence plus one, and
 *   `previousDeviceCommitSha256` is that commit's own hash — null exactly at
 *   sequence one, which is the pairing M09's encoder enforces.
 * - `basisFrontier` is the frontier this device has actually applied. A commit
 *   may not claim to have observed a state the app has not.
 * - `eventClass` is `authored` and `schemaRevisionBefore === schemaRevisionAfter`:
 *   F02's CRUD changes rows, never the schema. Import promotion is the other
 *   class and lives on M23's path.
 *
 * **Hybrid time is monotonic by construction.** Canonical commit order is
 * `(wall time, logical counter, device, sequence, commit id)` and the chain
 * guard walks commits in exactly that order — so a wall clock that stepped
 * backwards between two commits would place the newer one *first* and be read
 * as a sequence gap. {@link nextHybridTime} therefore never emits a time below
 * its predecessor: it advances the logical counter instead. The wall reading is
 * still display evidence only; ordering comes from the sequence and frontier.
 */

import { createDomainId, type DomainEntropy } from "../../domain/model/ids.js";
import type {
  AppChainStateV1,
  CommitPlanV1,
  PlannedEventV1,
} from "../ports/event-repository.js";
import type { ClockPort } from "../ports/clock.js";
import type { F02DomainEventV1 } from "../../domain/model/events.js";
import type {
  EventProvenanceV1,
  EventSubjectV1,
  HybridTimeV1,
} from "../../migrations/004_event_format_v1.js";

/** One authored event before its identity and index exist. */
export interface AuthoredEventDraftV1 {
  readonly subject: Omit<EventSubjectV1, "appId">;
  readonly event: F02DomainEventV1;
}

export interface BuildCommitDependenciesV1 {
  readonly clock: ClockPort;
  readonly entropy: DomainEntropy;
}

/**
 * The next hybrid time for this device: never behind the last one it wrote.
 * Equal wall readings advance the logical counter, which is what keeps the
 * canonical order total and strictly increasing per device.
 */
export function nextHybridTime(
  nowEpochMs: number,
  last: HybridTimeV1 | null,
): HybridTimeV1 {
  const wallTimeMs = BigInt(nowEpochMs);
  if (last === null) {
    return { wallTimeMs, logicalCounter: 0 };
  }
  if (wallTimeMs > last.wallTimeMs) {
    return { wallTimeMs, logicalCounter: 0 };
  }
  // The clock did not advance — or went backwards. Keep the predecessor's
  // reading and step the counter, rather than emitting a time that would sort
  // this commit before the one it follows.
  return {
    wallTimeMs: last.wallTimeMs,
    logicalCounter: last.logicalCounter + 1,
  };
}

/**
 * Assembles the commit that carries `drafts`. The provenance of an authored
 * write is `user`: F02's other source, `initial-import`, belongs to promotion.
 */
export function buildAuthoredCommit(
  deps: BuildCommitDependenciesV1,
  chain: AppChainStateV1,
  drafts: readonly AuthoredEventDraftV1[],
): CommitPlanV1 {
  if (drafts.length === 0) {
    throw new Error("an authored commit carries at least one event");
  }

  const provenance: EventProvenanceV1 = { source: "user" };
  const events: readonly PlannedEventV1[] = drafts.map((draft, eventIndex) => ({
    eventId: createDomainId("event", deps.entropy),
    eventIndex,
    subject: { appId: chain.appId, ...draft.subject },
    provenance,
    event: draft.event,
  }));

  return {
    commitId: createDomainId("commit", deps.entropy),
    appId: chain.appId,
    deviceId: chain.deviceId,
    deviceCommitSequence: chain.deviceCommitSequence + 1n,
    previousDeviceCommitSha256: chain.lastCommitSha256,
    basisFrontier: chain.frontier,
    hybridTime: nextHybridTime(deps.clock.nowEpochMs(), chain.lastHybridTime),
    eventClass: "authored",
    // CRUD never moves the schema; the pair being equal is what says so.
    schemaRevisionBefore: chain.schemaRevision,
    schemaRevisionAfter: chain.schemaRevision,
    events,
  };
}
