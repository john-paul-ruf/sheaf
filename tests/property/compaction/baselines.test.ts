import { expect, it } from "vitest";
import { asDomainId } from "../../../src/domain/model/ids.js";
import { decodeBaselinePage, encodeBaselinePage, decodeRecordPage, encodeRecordPage, type BaselinePageV2 } from "../../../src/import/staging/roots.js";
import { decodeCanonical, encodeCanonical, type CborValue } from "../../../src/persistence/codecs/canonical-cbor.js";

const id = (n: number) => new Uint8Array(16).fill(n);
const frontier = [{ deviceId: id(1), commitSequence: 0xffff_ffff_ffff_ffffn }];
const page: BaselinePageV2 = {
  pageVersion: 2, appId: asDomainId("app", id(2)),
  scope: { scopeId: id(3), scopeKind: "durable-home", importLineageId: null, durableHomeId: id(4), counterpartId: id(5),
    establishedGeneration: BigInt(Number.MAX_SAFE_INTEGER), establishedFrontier: frontier, establishedAtMs: Number.MAX_SAFE_INTEGER },
  entries: [{ tableId: asDomainId("table", id(6)), recordId: asDomainId("record", id(7)),
    state: "present", values: [], absentReason: null, sourceFrontier: frontier }],
};

it("keeps legacy reasonless absent/deleted bytes unchanged and distinguishes all V2 states", () => {
  for (const state of ["present", "deleted", "absent"] as const) {
    const legacy = { pageVersion: 1 as const, scopeId: id(3), entries: [{ tableId: page.entries[0]!.tableId,
      recordId: page.entries[0]!.recordId, state, values: [{ fieldId: asDomainId("field", id(8)), value: { kind: "text" as const, text: "original" } }] }] };
    const bytes = encodeBaselinePage(legacy);
    expect(encodeBaselinePage(decodeBaselinePage(bytes))).toEqual(bytes);
    const extended = { ...page, entries: [{ ...page.entries[0]!, state, values: state === "present" ? [] : null,
      absentReason: state === "absent" ? "never-shared" : null }] };
    expect(decodeBaselinePage(encodeBaselinePage(extended))).toEqual(extended);
  }
});

it("admits safe SQL maxima while preserving uint64 frontier BLOBs and refuses unsupported numeric facts", () => {
  const bytes = encodeBaselinePage(page);
  expect(decodeBaselinePage(bytes)).toEqual(page);
  for (const unsupported of [BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1n << 63n]) {
    const raw = decodeCanonical(bytes) as Map<string, CborValue>;
    (raw.get("scope") as Map<string, CborValue>).set("establishedGeneration", unsupported);
    const original = encodeCanonical(raw);
    expect(() => decodeBaselinePage(original)).toThrow();
    expect(encodeCanonical(raw)).toEqual(original);
  }
  const record = { tableId: page.entries[0]!.tableId, recordId: page.entries[0]!.recordId,
    values: [], issues: [], provenance: [], createdCommitId: asDomainId("commit", id(9)), updatedCommitId: asDomainId("commit", id(9)),
    recordRevision: BigInt(Number.MAX_SAFE_INTEGER) };
  expect(decodeRecordPage(encodeRecordPage({ pageVersion: 2, records: [record] }))).toEqual({ pageVersion: 2, records: [record] });
  for (const unsupported of [BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1n << 63n]) {
    expect(() => encodeRecordPage({ pageVersion: 2, records: [{ ...record, recordRevision: unsupported }] })).toThrow();
  }
});

it("rejects malformed baseline authority, row states, order, bounds and uncovered frontiers", () => {
  for (const scope of [{ ...page.scope, importLineageId: id(9) }, { ...page.scope, counterpartId: null },
    { ...page.scope, establishedGeneration: 0n }, { ...page.scope, scopeKind: "import" as const }]) {
    expect(() => encodeBaselinePage({ ...page, scope })).toThrow();
  }
  for (const entry of [{ ...page.entries[0]!, absentReason: "not-absent" }, { ...page.entries[0]!, values: null },
    { ...page.entries[0]!, state: "absent" as const, values: null, absentReason: "" },
    { ...page.entries[0]!, sourceFrontier: [{ deviceId: id(9), commitSequence: 1n }] }]) {
    expect(() => encodeBaselinePage({ ...page, entries: [entry] })).toThrow();
  }
  for (const entries of [[], [page.entries[0]!, page.entries[0]!], Array.from({ length: 1025 }, () => page.entries[0]!)]) {
    expect(() => encodeBaselinePage({ ...page, entries })).toThrow();
  }
  expect(() => encodeBaselinePage({ ...page, entries: [{ ...page.entries[0]!, state: "absent", values: null, absentReason: "a".repeat(524_288) }] })).toThrow(/512 KiB/);
  const raw = decodeCanonical(encodeBaselinePage(page)) as Map<string, CborValue>;
  raw.set("extra", null);
  expect(() => decodeBaselinePage(encodeCanonical(raw))).toThrow();
});
