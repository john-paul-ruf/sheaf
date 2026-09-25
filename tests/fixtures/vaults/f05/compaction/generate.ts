import { writeFile } from "node:fs/promises";
import { asDomainId } from "../../../../../src/domain/model/ids.js";
import { encodeBase64Url } from "../../../../../src/domain/model/bytes.js";
import { encodeAppHead, encodeAuditPage, encodeBaselinePage, encodeConflictPage, encodeRecordPage,
  type AppHeadV2, type CommitEvidenceRefV1 } from "../../../../../src/import/staging/roots.js";

/** Deterministic version/ordering corpus; full encrypted journeys use the worker fixture. */
export function generateCompactionCorpus(): ReadonlyMap<string, Uint8Array> {
  const id = (value: number) => new Uint8Array(16).fill(value);
  const digest = new Uint8Array(32).fill(9);
  const ref = (value: number) => ({ storageId: encodeBase64Url(id(value)), semanticSha256: digest });
  const appId = asDomainId("app", id(1));
  const first: CommitEvidenceRefV1 = { commitId: id(2), commitSha256: digest, segment: { ...ref(20), scope: "app.events", payloadKind: "app.event-segment" } };
  const second: CommitEvidenceRefV1 = { commitId: id(3), commitSha256: digest, segment: { ...ref(19), scope: "app.events", payloadKind: "app.event-segment" } };
  const head: AppHeadV2 = { headVersion: 2, appId, headRevision: 2n, schemaRevision: 1n, checkpoint: ref(4), frontier: [{ deviceId: id(5), commitSequence: 2n }],
    eventSegments: [], baselinePages: [ref(12), ref(11)], auditPages: [ref(16), ref(15)], conflictPages: [ref(14), ref(13)],
    sourceManifests: [], snapshotManifests: [], retainedRoots: [{ ...ref(6), scope: "app.checkpoint", payloadKind: "app.checkpoint-manifest" }], semanticSha256: digest };
  return new Map([
    ["head-v2.cbor", encodeAppHead(head)],
    ["records-v2.cbor", encodeRecordPage({ pageVersion: 2, records: [{ recordId: asDomainId("record", id(7)), tableId: asDomainId("table", id(8)),
      recordRevision: BigInt(Number.MAX_SAFE_INTEGER), createdCommitId: asDomainId("commit", id(2)), updatedCommitId: asDomainId("commit", id(3)), values: [], issues: [],
      provenance: [{ fieldId: asDomainId("field", id(10)), value: { source: "remote-device", evidence: new Map([["opaque", [null, id(11), 0xffff_ffff_ffff_ffffn]]]) } }] }] })],
    ["baseline-v2.cbor", encodeBaselinePage({ pageVersion: 2, appId, scope: { scopeId: id(12), scopeKind: "durable-home", importLineageId: null,
      durableHomeId: id(13), counterpartId: id(14), establishedGeneration: BigInt(Number.MAX_SAFE_INTEGER), establishedAtMs: Number.MAX_SAFE_INTEGER,
      establishedFrontier: [{ deviceId: id(5), commitSequence: 2n }] }, entries: [{ tableId: asDomainId("table", id(8)), recordId: asDomainId("record", id(7)),
        state: "absent", values: null, absentReason: "legacy-reason-not-recorded", sourceFrontier: [{ deviceId: id(5), commitSequence: 1n }] }] })],
    ["audit-first.cbor", encodeAuditPage({ pageVersion: 1, appId, entries: [first] })],
    ["audit-second.cbor", encodeAuditPage({ pageVersion: 1, appId, entries: [second] })],
    ["conflict-first.cbor", encodeConflictPage({ pageVersion: 1, appId, entries: [{ conflictId: id(17), detected: { commit: first, eventId: id(18) }, resolved: null }] })],
    ["conflict-second.cbor", encodeConflictPage({ pageVersion: 1, appId, entries: [{ conflictId: id(18), detected: { commit: first, eventId: id(19) }, resolved: { commit: second, eventId: id(20) } }] })],
  ]);
}

export async function writeCompactionCorpus(): Promise<void> {
  for (const [name, bytes] of generateCompactionCorpus()) await writeFile(new URL(name, import.meta.url), bytes);
}
