/**
 * The durable event log of one open app, as the command layer depends on it
 * (M07; CA-08/CA-11 consumer side).
 *
 * M34 builds commits and must not import M09's codec, M08's digest, or M11's
 * store. So a command hands over a {@link CommitPlanV1} — chain fields plus
 * **typed** events — and the implementation seals, encodes, encrypts, and
 * commits. Two consequences are the reason the seam is drawn here rather than
 * one layer out:
 *
 * - **The payload and its typed reading cannot disagree.** One function on the
 *   infrastructure side derives the wire payload from the typed event, so the
 *   agreement S02's replay guards check is held by construction instead of by
 *   two encoders staying in step (CA-13, S02 surprise 2).
 * - **No canonical-CBOR knowledge leaks into the application layer.** A
 *   command names values, not bytes.
 *
 * **Nothing here acknowledges early.** {@link LocalEventRepository.append}
 * resolves only after the transaction that made the commit durable has
 * completed (invariant 1); a caller that awaits it holds a durable fact, not a
 * queued intention.
 *
 * **The chain facts are read, never guessed.** {@link AppChainStateV1} comes
 * from the decrypted head and the segments it names — the same source the
 * replay guards check against — so a command cannot invent a sequence number,
 * a predecessor hash, or a basis frontier.
 */

import type { F02DomainEventV1 } from "../../domain/model/events.js";
import type {
  AppId,
  CommitId,
  DeviceId,
  EventId,
} from "../../domain/model/ids.js";
import type {
  EventClassV1,
  EventCommitV1,
  EventProvenanceV1,
  EventSubjectV1,
  FrontierEntryV1,
  HybridTimeV1,
} from "../../migrations/004_event_format_v1.js";
import type { ProjectionIssueInputV1 } from "./projection.js";

/**
 * What the next commit of this device must continue. `lastHybridTime` is here
 * because canonical commit order is `(wall time, logical counter, …)` and the
 * chain guard verifies commits in that order: a clock that stepped backwards
 * would sort a new commit *before* its own predecessor and be read as a gap.
 * The writer advances the logical counter instead of trusting the wall clock.
 */
export interface AppChainStateV1 {
  readonly appId: AppId;
  readonly deviceId: DeviceId;
  /** This device's highest applied sequence; `0n` before its first commit. */
  readonly deviceCommitSequence: bigint;
  /** That commit's hash, and therefore the next commit's predecessor. */
  readonly lastCommitSha256: Uint8Array | null;
  readonly lastHybridTime: HybridTimeV1 | null;
  /** Every device's applied sequence, sorted by device id. */
  readonly frontier: readonly FrontierEntryV1[];
  readonly schemaRevision: bigint;
}

/** One event, named and typed. The wire payload is derived from `event`. */
export interface PlannedEventV1 {
  readonly eventId: EventId;
  readonly eventIndex: number;
  readonly subject: EventSubjectV1;
  readonly provenance: EventProvenanceV1;
  readonly event: F02DomainEventV1;
}

export interface CommitPlanV1 {
  readonly commitId: CommitId;
  readonly appId: AppId;
  readonly deviceId: DeviceId;
  readonly deviceCommitSequence: bigint;
  readonly previousDeviceCommitSha256: Uint8Array | null;
  readonly basisFrontier: readonly FrontierEntryV1[];
  readonly hybridTime: HybridTimeV1;
  readonly eventClass: EventClassV1;
  readonly schemaRevisionBefore: bigint;
  readonly schemaRevisionAfter: bigint;
  readonly events: readonly PlannedEventV1[];
}

export interface CommitAppendRequestV1 {
  readonly plan: CommitPlanV1;
  /** The one shared validator's verdict for the record each event leaves. */
  readonly issuesByEventIndex?: ReadonlyMap<
    number,
    readonly ProjectionIssueInputV1[]
  >;
  /**
   * The app's live record count after this commit, for the catalog's render
   * cache. It is a cache and never authority — reset and removal recompute
   * from the decrypted head (check 7).
   */
  readonly rowCountAfter: number;
}

export interface CommitReceiptV1 {
  /**
   * The sealed commit, exactly as it was written. The caller needs it to
   * bring the projection forward: `applyEvents` re-verifies the hash and the
   * chain against this value, so replay checks the durable bytes rather than
   * the intention that produced them.
   */
  readonly commit: EventCommitV1;
  readonly headRevision: bigint;
  readonly frontier: readonly FrontierEntryV1[];
  /** The store's transaction revision after the append. */
  readonly transactionRevision: number;
}

export interface LocalEventRepository {
  /** The chain facts as the open app currently holds them; never stale. */
  chainState(): AppChainStateV1;
  /** Durable before it resolves. There is no un-append. */
  append(request: CommitAppendRequestV1): Promise<CommitReceiptV1>;
}
