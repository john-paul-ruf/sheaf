import { sha256 } from "../../../../src/crypto/hash.js";
import { expect, it } from "vitest";
import { verifyBackupFrontier } from "../../../../src/sync/protocol/frontier.js";
import { sealEventCommit } from "../../../../src/persistence/codecs/event-commit.js";
import { id, hash } from "../../../fixtures/vaults/f05/helpers.js";
import type { EventSegmentV1 } from "../../../../src/migrations/004_event_format_v1.js";

it("proves checkpoint-to-tail continuity and rejects gaps, overlaps and app substitution", async () => {
  const chain = { deviceId: id(3), commitSequence: 5n, commitSha256: hash(5) };
  const commit = await sealEventCommit({ eventFormatVersion: 1, appId: id(2), commitId: id(4), deviceId: id(3), deviceCommitSequence: 6n,
    previousDeviceCommitSha256: hash(5), basisFrontier: [{ deviceId: id(3), commitSequence: 5n }], hybridTime: { wallTimeMs: 1n, logicalCounter: 0 },
    eventClass: "authored", schemaRevisionBefore: 1n, schemaRevisionAfter: 1n, events: [{ eventId: id(8), eventIndex: 0, kind: "app.renamed", subject: { appId: id(2) }, payload: "name", provenance: { source: "user" } }] }, sha256);
  const segment: EventSegmentV1 = { eventFormatVersion: 1, segmentId: id(6), appId: id(2), commits: [commit], resultingFrontier: [{ deviceId: id(3), commitSequence: 6n }], semanticSha256: hash(7) };
  const result = await verifyBackupFrontier(id(2), [chain], [segment], segment.resultingFrontier, sha256);
  expect(result[0]!.commitSha256).toEqual(commit.commitSha256);
  await expect(verifyBackupFrontier(id(2), [], [segment], segment.resultingFrontier, sha256)).rejects.toThrow(/noncontiguous/);
  await expect(verifyBackupFrontier(id(2), [chain], [segment, segment], segment.resultingFrontier, sha256)).rejects.toThrow(/duplicate/);
  await expect(verifyBackupFrontier(id(9), [chain], [segment], segment.resultingFrontier, sha256)).rejects.toThrow(/another app/);
  await expect(verifyBackupFrontier(id(2), [{ ...chain, commitSha256: hash(8) }], [segment], segment.resultingFrontier, sha256)).rejects.toThrow(/predecessor/);
  await expect(verifyBackupFrontier(id(2), [chain], [segment], [{ deviceId: id(3), commitSequence: 7n }], sha256)).rejects.toThrow(/frontier/);
});
