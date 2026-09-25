import type { DeviceChainEvidenceV1 } from "../../application/ports/backup.js";
import type { EventSegmentV1, FrontierEntryV1 } from "../../migrations/004_event_format_v1.js";
import { constantTimeEquals, encodeBase64Url } from "../../domain/model/bytes.js";
import { IntegrityError } from "../../domain/model/errors.js";
import { encodeCommitBody, type Sha256Fn } from "../../persistence/codecs/event-commit.js";
import { compareBytes, readFrontier, vaultValue } from "../../persistence/codecs/vault.js";

/** Checkpoint evidence is supplied by its authenticated reader (S02/S06). */
export async function verifyBackupFrontier(appId: Uint8Array, checkpoint: readonly DeviceChainEvidenceV1[],
  segments: Iterable<EventSegmentV1> | AsyncIterable<EventSegmentV1>, expected: readonly FrontierEntryV1[], sha256: Sha256Fn, signal?: AbortSignal): Promise<readonly DeviceChainEvidenceV1[]> {
  readFrontier(vaultValue(expected));
  const chains = new Map<string, DeviceChainEvidenceV1>();
  for (const chain of checkpoint) {
    const id = encodeBase64Url(chain.deviceId);
    if (chain.deviceId.length !== 16 || chain.commitSha256.length !== 32 || chain.commitSequence < 1n || chains.has(id)) throw new IntegrityError("invalid checkpoint chain evidence");
    chains.set(id, chain);
  }
  const commitIds = new Set<string>();
  for await (const segment of segments) {
    signal?.throwIfAborted();
    if (!constantTimeEquals(appId, segment.appId)) throw new IntegrityError("segment belongs to another app");
    for (const commit of segment.commits) {
      if (!constantTimeEquals(appId, commit.appId) || !constantTimeEquals(await sha256(encodeCommitBody(commit)), commit.commitSha256)) throw new IntegrityError("commit identity or hash mismatch");
      const commitId = encodeBase64Url(commit.commitId);
      if (commitIds.has(commitId)) throw new IntegrityError("duplicate commit identity");
      commitIds.add(commitId);
      const id = encodeBase64Url(commit.deviceId);
      const previous = chains.get(id);
      if (commit.deviceCommitSequence !== (previous?.commitSequence ?? 0n) + 1n) throw new IntegrityError("noncontiguous or overlapping device range");
      if (previous !== undefined && (commit.previousDeviceCommitSha256 === null || !constantTimeEquals(previous.commitSha256, commit.previousDeviceCommitSha256))) throw new IntegrityError("device predecessor mismatch");
      chains.set(id, { deviceId: commit.deviceId, commitSequence: commit.deviceCommitSequence, commitSha256: commit.commitSha256 });
    }
  }
  signal?.throwIfAborted();
  const actual = [...chains.values()].sort((a, b) => compareBytes(a.deviceId, b.deviceId));
  if (actual.length !== expected.length || actual.some((chain, i) => !constantTimeEquals(chain.deviceId, expected[i]!.deviceId) || chain.commitSequence !== expected[i]!.commitSequence)) throw new IntegrityError("replayed frontier does not match manifest");
  return actual;
}
