import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { asDomainId } from "../../../src/domain/model/ids.js";
import { encodeBase64Url } from "../../../src/domain/model/bytes.js";
import { decodeCanonical, encodeCanonical, type CborValue } from "../../../src/persistence/codecs/canonical-cbor.js";
import { decodeAppHead, encodeAppHead, decodeRecordPage, encodeRecordPage, decodeAuditPage, encodeAuditPage,
  decodeConflictPage, encodeConflictPage, type AppHeadV2, type CommitEvidenceRefV1, type StoredRecordV2 } from "../../../src/import/staging/roots.js";

const id = (n: number) => new Uint8Array(16).fill(n);
const digest = new Uint8Array(32).fill(10);
const ref = (n: number) => ({ storageId: encodeBase64Url(id(n)), semanticSha256: digest });
const commit: CommitEvidenceRefV1 = { segment: { ...ref(9), scope: "app.events", payloadKind: "app.event-segment" }, commitId: id(5), commitSha256: digest };
const row: StoredRecordV2 = { recordId: asDomainId("record", id(1)), tableId: asDomainId("table", id(2)), values: [], issues: [],
  recordRevision: 4n, createdCommitId: asDomainId("commit", id(3)), updatedCommitId: asDomainId("commit", id(4)), provenance: [] };
const head: AppHeadV2 = { headVersion: 2, appId: asDomainId("app", id(1)), headRevision: 2n, schemaRevision: 1n,
  checkpoint: ref(2), eventSegments: [], frontier: [], baselinePages: [], conflictPages: [], auditPages: [], sourceManifests: [],
  snapshotManifests: [], retainedRoots: [{ ...ref(3), scope: "app.checkpoint", payloadKind: "app.checkpoint-manifest" }], semanticSha256: digest };
const map = (bytes: Uint8Array) => decodeCanonical(bytes) as Map<string, CborValue>;

describe("compaction payload contracts", () => {
  it("round-trips supported row revisions, full uint64 head revisions and arbitrary canonical evidence without inventing optional fields", () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: BigInt(Number.MAX_SAFE_INTEGER) }), fc.bigInt({ min: 0n, max: 0xffff_ffff_ffff_ffffn }), fc.uint8Array({ maxLength: 256 }), (revision, headRevision, bytes) => {
      const provenance = [
        { fieldId: asDomainId("field", id(1)), value: { source: "user" as const } },
        { fieldId: asDomainId("field", id(2)), value: { source: "remote-device" as const, sourceId: id(8), sourceTimestampMs: 1n,
          evidence: new Map<string, CborValue>([["bytes", bytes], ["nested", [null, true, new Map([["key", 7n]])]]]) } },
      ];
      const encoded = encodeRecordPage({ pageVersion: 2, records: [{ ...row, recordRevision: revision, provenance }] });
      expect(encodeRecordPage(decodeRecordPage(encoded))).toEqual(encoded);
      const decoded = decodeRecordPage(encoded);
      if (decoded.pageVersion !== 2) throw new Error("lost record version");
      expect(decoded.records[0]!.provenance[0]!.value).toEqual({ source: "user" });
      expect(decoded.records[0]!.recordRevision).toBe(revision);
      const headBytes = encodeAppHead({ ...head, headRevision, schemaRevision: revision });
      expect(encodeAppHead(decodeAppHead(headBytes))).toEqual(headBytes);
    }), { numRuns: 100 });
  });

  it("refuses schema revisions outside the SQL range without narrowing head revisions", () => {
    for (const schemaRevision of [BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1n << 63n]) {
      expect(() => encodeAppHead({ ...head, schemaRevision })).toThrow();
      const bytes = map(encodeAppHead(head));
      bytes.set("schemaRevision", schemaRevision);
      expect(() => decodeAppHead(encodeCanonical(bytes))).toThrow();
    }
  });

  it("rejects reversed or duplicate typed roots and illegal scope/kind pairs", () => {
    const second = { ...ref(4), scope: "app.head" as const, payloadKind: "app.head" as const };
    expect(() => encodeAppHead({ ...head, retainedRoots: [second, head.retainedRoots[0]!] })).toThrow(/sorted/);
    expect(() => encodeAppHead({ ...head, retainedRoots: [second, second] })).toThrow(/unique/);
    const encoded = map(encodeAppHead(head));
    const roots = encoded.get("retainedRoots") as Map<string, CborValue>[];
    roots[0]!.set("scope", "local.catalog");
    expect(() => decodeAppHead(encodeCanonical(encoded))).toThrow(/scope/);
  });

  it("enforces exact keys, versions, record metadata bounds and provenance ordering", () => {
    const bytes = encodeRecordPage({ pageVersion: 2, records: [row] });
    for (const key of ["recordRevision", "createdCommitId", "updatedCommitId", "provenance"]) {
      const altered = map(bytes);
      (altered.get("records") as Map<string, CborValue>[])[0]!.delete(key);
      expect(() => decodeRecordPage(encodeCanonical(altered))).toThrow();
    }
    for (const revision of [-1n, 0x1_0000_0000_0000_0000n]) expect(() => encodeRecordPage({ pageVersion: 2, records: [{ ...row, recordRevision: revision }] })).toThrow();
    const entry = { fieldId: asDomainId("field", id(1)), value: { source: "user" as const } };
    expect(() => encodeRecordPage({ pageVersion: 2, records: [{ ...row, provenance: [entry, entry] }] })).toThrow(/unique/);
    for (const [payload, decode, version] of [[encodeAppHead(head), decodeAppHead, "headVersion"], [bytes, decodeRecordPage, "pageVersion"]] as const) {
      const value = map(payload);
      value.set(version, 3n);
      expect(() => decode(encodeCanonical(value))).toThrow(/version/);
      value.set(version, 2n); value.set("unknown", null);
      expect(() => decode(encodeCanonical(value))).toThrow();
    }
  });

  it("bounds complete record/evidence payloads and refuses duplicate evidence identities", () => {
    expect(() => encodeRecordPage({ pageVersion: 2, records: [{ ...row, provenance: [{ fieldId: asDomainId("field", id(1)),
      value: { source: "user", evidence: new Uint8Array(524_288) } }] }] })).toThrow(/512 KiB/);
    const audit = { pageVersion: 1 as const, appId: head.appId, entries: [commit] };
    expect(decodeAuditPage(encodeAuditPage(audit))).toEqual(audit);
    expect(() => encodeAuditPage({ ...audit, entries: [] })).toThrow(/1,024/);
    expect(() => encodeAuditPage({ ...audit, entries: [commit, commit] })).toThrow(/duplicate/);
    expect(() => encodeAuditPage({ ...audit, entries: Array.from({ length: 1025 }, () => commit) })).toThrow(/1,024/);
    const detected = { commit, eventId: id(6) };
    const conflict = { pageVersion: 1 as const, appId: head.appId, entries: [{ conflictId: id(7), detected, resolved: null }] };
    expect(decodeConflictPage(encodeConflictPage(conflict))).toEqual(conflict);
    expect(() => encodeConflictPage({ ...conflict, entries: [...conflict.entries, ...conflict.entries] })).toThrow(/unique/);
  });
});
