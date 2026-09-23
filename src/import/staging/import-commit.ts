/**
 * The one import-class commit builder (M23; CA-11, CA-23, D27, D38).
 *
 * Promotion writes an app's first commit and an append writes a later one;
 * both go through this function so there is exactly one way an import commit
 * is sealed: M09's `sealEventCommit` over the body, one segment per commit
 * (D27), and the chain verified over every commit the app now has — the
 * accumulated-set rule, never the new commit alone. The caller supplies the
 * device chain it continues (the data worker's event store for an append, the
 * empty chain for promotion); nothing here reads a store or holds a key.
 */

import type { AppId, CommitId, DeviceId } from "../../domain/model/ids.js";
import { createDomainId } from "../../domain/model/ids.js";
import type { EntropyPort } from "../../application/ports/entropy.js";
import type {
  DomainEventV1,
  EventCommitV1,
  FrontierEntryV1,
  HybridTimeV1,
} from "../../migrations/004_event_format_v1.js";
import {
  encodeEventSegment,
  sealEventCommit,
  sortFrontier,
  verifyCommitChain,
} from "../../persistence/codecs/event-commit.js";

/** Where this device's chain stands before the commit: the empty chain for a new app. */
export interface ImportChainV1 {
  readonly deviceCommitSequence: bigint;
  readonly lastCommitSha256: Uint8Array | null;
  readonly lastHybridTime: HybridTimeV1 | null;
  readonly frontier: readonly FrontierEntryV1[];
  /** Every commit the app already has, for the accumulated-set chain check. */
  readonly commits: readonly EventCommitV1[];
}

export const EMPTY_IMPORT_CHAIN: ImportChainV1 = Object.freeze({
  deviceCommitSequence: 0n,
  lastCommitSha256: null,
  lastHybridTime: null,
  frontier: [],
  commits: [],
});

export interface SealedImportCommitV1 {
  readonly commit: EventCommitV1;
  /** The encoded one-commit segment, ready to seal under the app key. */
  readonly segmentPayload: Uint8Array;
  readonly frontier: readonly FrontierEntryV1[];
}

/** A hybrid time after `last`: wall time when it moved on, else one logical tick. */
const nextHybridTime = (nowMs: number, last: HybridTimeV1 | null): HybridTimeV1 => {
  const wallTimeMs = BigInt(nowMs);
  return last === null || wallTimeMs > last.wallTimeMs
    ? { wallTimeMs, logicalCounter: 0 }
    : { wallTimeMs: last.wallTimeMs, logicalCounter: last.logicalCounter + 1 };
};

export async function sealImportCommit(input: {
  readonly entropy: EntropyPort;
  readonly sha256: (bytes: Uint8Array) => Promise<Uint8Array>;
  readonly appId: AppId;
  readonly commitId: CommitId;
  readonly deviceId: DeviceId;
  readonly chain: ImportChainV1;
  readonly nowMs: number;
  readonly schemaRevisionBefore: bigint;
  readonly schemaRevisionAfter: bigint;
  readonly events: readonly DomainEventV1[];
}): Promise<SealedImportCommitV1> {
  const { chain } = input;
  const sequence = chain.deviceCommitSequence + 1n;
  const commit = await sealEventCommit(
    {
      eventFormatVersion: 1,
      commitId: input.commitId,
      appId: input.appId,
      deviceId: input.deviceId,
      deviceCommitSequence: sequence,
      previousDeviceCommitSha256: chain.lastCommitSha256,
      basisFrontier: sortFrontier(chain.frontier),
      hybridTime: nextHybridTime(input.nowMs, chain.lastHybridTime),
      eventClass: "import",
      schemaRevisionBefore: input.schemaRevisionBefore,
      schemaRevisionAfter: input.schemaRevisionAfter,
      events: input.events,
    },
    input.sha256,
  );
  const frontier = sortFrontier([
    ...chain.frontier.filter((entry) => entry.deviceId.some((byte, index) => byte !== input.deviceId[index])),
    { deviceId: input.deviceId, commitSequence: sequence },
  ]);
  // D27's accumulated-set rule: the chain over every commit this app now has.
  await verifyCommitChain([...chain.commits, commit], input.sha256);
  const segmentPayload = encodeEventSegment({
    eventFormatVersion: 1,
    segmentId: createDomainId("segment", input.entropy),
    appId: input.appId,
    commits: [commit],
    resultingFrontier: frontier,
    semanticSha256: await input.sha256(commit.commitSha256),
  });
  return { commit, segmentPayload, frontier };
}
