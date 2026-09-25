import { describe, expect, it } from "vitest";
import { sha256 } from "../../../src/crypto/hash.js";
import { asDomainId } from "../../../src/domain/model/ids.js";
import type { AuthoredRecordV1 } from "../../../src/domain/model/events.js";
import { textValue } from "../../../src/domain/model/values.js";
import { decodeCanonical, encodeCanonical, type CborValue } from "../../../src/persistence/codecs/canonical-cbor.js";
import { sealEventCommit } from "../../../src/persistence/codecs/event-commit.js";
import type { EventCommitV1, DomainEventV1 as WireEvent } from "../../../src/migrations/004_event_format_v1.js";
import { applyEvents, authoredRecords, checkpointMetadata, copyCheckpointHistory, disposeProjection, executeQuery, hydrateApp, openProjection } from "../../../src/persistence/projection/index.js";
import { hydrateBaselines } from "../../../src/persistence/projection/checkpoint-history.js";
import { evidenceRecordBytes } from "../../../src/persistence/projection/evidence-events.js";
import { selectRows } from "../../../src/persistence/projection/engine.js";
import { engineAdapter, toProjectionCommit } from "../../../src/workers/data/app-session.js";
import { encodeAuthoredRecordBytes, encodeRecordEventPayload } from "../../../src/workers/data/record-event-payloads.js";
import { F, JOB, JOBS, queryCheckpoint } from "./query-fixture.js";

const id = (n: number) => new Uint8Array(16).fill(n);
const map = (entries: readonly (readonly [string, CborValue])[]) => new Map<string, CborValue>(entries);
const decoded = (value: CborValue) => decodeCanonical(encodeCanonical(value));
const state = (record: AuthoredRecordV1) => map([["state", "present"], ["value", decodeCanonical(evidenceRecordBytes(record))]]);
const report = map([["isValid", true], ["issues", []]]);
const signal = new AbortController().signal;

async function fixture(withBaseline = true) {
  const base = queryCheckpoint();
  const table = { ...base.tables.find((t) => t.tableId.every((byte, i) => byte === JOBS[i]))!, fields: [F.name] };
  const local: AuthoredRecordV1 = { recordId: JOB.j1, tableId: JOBS, values: new Map([[F.name.fieldId, textValue("Local")]]), provenance: new Map() };
  const checkpoint = { ...base, tables: [table], relationships: [], enumOptions: [], formulas: [], recordPages: [{ records: [{ record: local,
    recordRevision: 0n, createdCommitId: asDomainId("commit", id(4)), updatedCommitId: asDomainId("commit", id(4)), issues: [] }] }] };
  const handle = await openProjection({ sha256, clock: () => ({ epochMs: 1000, epochDay: 0 }) });
  await hydrateApp(handle, checkpoint);
  const values = (decodeCanonical(evidenceRecordBytes(local)) as Map<string, CborValue>).get("values")!;
  const baseline = map([["scopeId", id(70)], ["state", "present"], ["values", values], ["absentReason", null], ["frontier", []]]);
  if (withBaseline) {
    async function* pages() { yield await Promise.resolve({ scope: { scopeId: id(70), scopeKind: "durable-home" as const, importLineageId: null,
      durableHomeId: id(71), counterpartId: id(72), establishedGeneration: 1n, establishedFrontier: [], establishedAtMs: 0 },
      entries: [{ tableId: JOBS, recordId: JOB.j1, state: "present" as const, values: encodeCanonical(values), absentReason: null, sourceFrontier: [] }] }); }
    await hydrateBaselines(handle, pages(), signal);
  }
  const source = (record: AuthoredRecordV1) => map([["source", "this-device"], ["timestampMs", 100n], ["commitId", id(4)], ["frontier", []], ["state", state(record)]]);
  const incoming = { ...local, values: new Map([[F.name.fieldId, textValue("Incoming")]]), provenance: new Map([[F.name.fieldId, { source: "conflict-resolution" as const }]]) };
  const detection = map([["payloadVersion", 1n], ["conflictId", id(80)], ["tableId", JOBS], ["targetKind", "record"], ["targetId", JOB.j1],
    ["conflictKind", "field"], ["schemaRevision", 1n], ["baseline", baseline], ["local", source(local)], ["incoming", source(incoming)],
    ["conflictingFields", [F.name.fieldId]], ["validationReport", null]]);
  const wire = (kind: WireEvent["kind"], payload: CborValue, eventId: number): WireEvent => ({ eventId: id(eventId), eventIndex: 0, kind,
    subject: { appId: checkpoint.appId, tableId: JOBS, recordId: JOB.j1, ...(kind.startsWith("conflict.") ? { objectId: id(80) } : kind === "merge.applied" ? { objectId: id(90) } : {}) },
    provenance: { source: "conflict-resolution" }, payload: decoded(payload) });
  let previous: EventCommitV1 | null = null;
  async function commit(events: readonly WireEvent[]) {
    const value = await sealEventCommit({ eventFormatVersion: 1, commitId: id(100 + Number(previous?.deviceCommitSequence ?? 0n)), appId: checkpoint.appId,
      deviceId: id(99), deviceCommitSequence: (previous?.deviceCommitSequence ?? 0n) + 1n, previousDeviceCommitSha256: previous?.commitSha256 ?? null,
      basisFrontier: [...handle.frontier.values()], hybridTime: { wallTimeMs: 1000n + (previous?.deviceCommitSequence ?? 0n), logicalCounter: 0 }, eventClass: "reconciliation",
      schemaRevisionBefore: 1n, schemaRevisionAfter: 1n, events: events.map((event, eventIndex) => ({ ...event, eventIndex })) }, sha256);
    previous = value;
    return value;
  }
  const replay = async (events: readonly WireEvent[]) => { const c = await commit(events); await applyEvents(handle, [toProjectionCommit(engineAdapter(handle), c, () => checkpointMetadata(handle, checkpoint))]); return c; };
  const patch = async (before: AuthoredRecordV1, after: AuthoredRecordV1, revision: bigint, eventId: number) => wire("record.patched", encodeRecordEventPayload({ kind: "record.patched", payload: {
    tableId: JOBS, recordId: JOB.j1, recordRevision: revision, changes: [{ fieldId: F.name.fieldId, before: [...before.values.values()][0]!, after: [...after.values.values()][0]!, provenance: { source: "conflict-resolution" } }],
    resultingRecordSha256: await sha256(encodeAuthoredRecordBytes(after)),
  } }), eventId);
  const resolution = map([["payloadVersion", 1n], ["conflictId", id(80)], ["detectedEventId", id(81)], ["decision", "use-incoming"],
    ["result", state(incoming)], ["schemaRevision", 1n], ["validationReport", report], ["effectEventIds", [id(82)]]]);
  return { handle, checkpoint, local, incoming, source, baseline, detection, resolution, wire, commit, replay, patch };
}

describe("original evidence replay", () => {
  it("reconstructs pending, resolved and merge SQL through real mutations and shared validation, then copies without applying effects twice", async () => {
    const f = await fixture(); const { handle } = f;
    const target = await openProjection({ sha256, clock: () => ({ epochMs: 1000, epochDay: 0 }) });
    try {
      const before = [...authoredRecords(handle, signal)];
      await f.replay([f.wire("conflict.detected", f.detection, 81)]);
      expect([...authoredRecords(handle, signal)]).toEqual(before);
      expect(selectRows(handle, "SELECT conflict_id, status, detected_event_id, resolved_event_id FROM pending_conflicts")).toEqual([[id(80), "pending", id(81), null]]);
      await f.replay([await f.patch(f.local, f.incoming, 1n, 82), f.wire("conflict.resolved", f.resolution, 83)]);
      expect([...authoredRecords(handle, signal)][0]!.recordRevision).toBe(1n);
      expect(selectRows(handle, "SELECT status, resolved_event_id FROM pending_conflicts")).toEqual([["resolved", id(83)]]);
      const merged = map([["payloadVersion", 1n], ["mergeId", id(90)], ["tableId", JOBS], ["recordId", JOB.j1], ["schemaRevision", 1n],
        ["baseline", f.baseline], ["local", f.source(f.incoming)], ["incoming", f.source(f.incoming)], ["localChangedFields", [F.name.fieldId]],
        ["incomingChangedFields", [F.name.fieldId]], ["result", decodeCanonical(evidenceRecordBytes(f.incoming))], ["resultCommitId", id(102)], ["validationReport", report],
        ["explanation", map([["messageKey", "merge.equal"], ["messageParameters", map([])]])], ["effectEventIds", []]]);
      await f.replay([f.wire("merge.applied", merged, 91)]);
      expect(selectRows(handle, "SELECT merge_id, record_id, result_commit_id FROM applied_merges")).toEqual([[id(90), JOB.j1, id(102)]]);
      const rows = [...authoredRecords(handle, signal)];
      expect(rows[0]!.recordRevision).toBe(1n);
      const history = executeQuery(handle, { kind: "page-change-history", after: null, limit: 50 }).events;
      expect(history).toHaveLength(4);
      expect(history.find((event) => event.eventKind === "conflict.detected")?.summary.evidence).toEqual(encodeCanonical(f.detection));
      expect(history.filter((event) => event.eventKind.startsWith("conflict.")).every((event) => event.subjectKind === "conflict" && event.subjectId.every((byte) => byte === 80))).toBe(true);
      await hydrateApp(target, { ...f.checkpoint, frontier: [...handle.frontier.values()], recordPages: [{ records: rows }] });
      await copyCheckpointHistory(handle, target, signal);
      for (const [table, order] of [["pending_conflicts", "conflict_id"], ["applied_merges", "merge_id"], ["change_history", "event_id"]]) {
        expect(selectRows(target, `SELECT * FROM ${table} ORDER BY ${order}`)).toEqual(selectRows(handle, `SELECT * FROM ${table} ORDER BY ${order}`));
      }
      expect([...authoredRecords(target, signal)]).toEqual(rows);
    } finally { disposeProjection(handle); disposeProjection(target); }
  });

  it.each(["wrong-subject", "missing-baseline", "invalid-report"])("rejects detection with %s", async (fault) => {
    const f = await fixture(fault !== "missing-baseline");
    try {
      const payload = new Map(f.detection);
      if (fault === "wrong-subject") payload.set("targetId", JOB.j2);
      if (fault === "invalid-report") payload.set("validationReport", map([["isValid", false], ["issues", [map([["fieldId", F.name.fieldId], ["ruleId", null],
        ["kind", "required"], ["severity", "blocking"], ["messageKey", "false-rejection"], ["messageParameters", map([])]])]]]));
      await expect(f.replay([f.wire("conflict.detected", payload, 81)])).rejects.toThrow(/subject|baseline|report/);
      expect(f.handle.disposed).toBe(true);
    } finally { disposeProjection(f.handle); }
  });

  it.each(["missing-effects", "unlisted-effect", "wrong-result", "wrong-report", "wrong-detection"])("rejects resolution with %s and disposes its rolled-back projection", async (fault) => {
    const f = await fixture();
    try {
      await f.replay([f.wire("conflict.detected", f.detection, 81)]);
      const payload = new Map(f.resolution);
      if (fault === "unlisted-effect") payload.set("effectEventIds", []);
      if (fault === "wrong-result") payload.set("decision", "edited").set("result", state(f.local));
      if (fault === "wrong-detection") payload.set("detectedEventId", id(77));
      if (fault === "wrong-report") payload.set("validationReport", map([["isValid", true], ["issues", [map([["fieldId", F.name.fieldId], ["ruleId", null],
        ["kind", "required"], ["severity", "warning"], ["messageKey", "false-warning"], ["messageParameters", map([])]])]]]));
      await expect(f.replay([...(fault === "missing-effects" ? [] : [await f.patch(f.local, f.incoming, 1n, 82)]), f.wire("conflict.resolved", payload, 83)]))
        .rejects.toThrow(/effects|result|report|subject/);
      expect(f.handle.disposed).toBe(true);
    } finally { disposeProjection(f.handle); }
  });
});


it.each(["schema", "identity"] as const)("preserves original %s alternatives and resolves an unchanged valid local state without invented mutations", async (targetKind) => {
  const f = await fixture();
  try {
    const provisional = await f.commit([f.wire("conflict.detected", f.detection, 81)]);
    const localState = targetKind === "schema"
      ? decodeCanonical(toProjectionCommit(engineAdapter(f.handle), provisional, () => checkpointMetadata(f.handle, f.checkpoint)).schemaEvidence!())
      : map([["state", "present"], ["value", map([["matchFieldId", F.name.fieldId], ["candidates", [decodeCanonical(evidenceRecordBytes(f.local))]]])]]);
    const source = new Map(f.source(f.local)).set("state", localState);
    const rejection = map([["isValid", false], ["issues", [map([["fieldId", F.name.fieldId], ["ruleId", null], ["kind", "required"],
      ["severity", "blocking"], ["messageKey", "original.schema.rejection"], ["messageParameters", map([])]])]]]);
    const detection = new Map(f.detection).set("targetKind", targetKind).set("targetId", JOBS).set("conflictKind", targetKind).set("baseline", null)
      .set("local", source).set("incoming", source).set("validationReport", targetKind === "schema" ? rejection : null);
    const resolution = new Map(f.resolution).set("decision", "keep-local").set("result", localState).set("effectEventIds", []);
    const subject = { appId: f.checkpoint.appId, tableId: JOBS, objectId: id(80) };
    const detectWire = { ...f.wire("conflict.detected", detection, 81), subject };
    // This fixture needs no preliminary durable event: the schema encoder reads the current projection.
    const detectionCommit = await sealEventCommit({ ...provisional, events: [detectWire] }, sha256);
    await applyEvents(f.handle, [toProjectionCommit(engineAdapter(f.handle), detectionCommit, () => checkpointMetadata(f.handle, f.checkpoint))]);
    const resolvedWire = { ...f.wire("conflict.resolved", resolution, 83), subject };
    const resolvedCommit = await sealEventCommit({ ...detectionCommit, commitId: id(101), deviceCommitSequence: 2n, previousDeviceCommitSha256: detectionCommit.commitSha256,
      basisFrontier: [...f.handle.frontier.values()], hybridTime: { wallTimeMs: 1001n, logicalCounter: 0 }, events: [resolvedWire] }, sha256);
    await applyEvents(f.handle, [toProjectionCommit(engineAdapter(f.handle), resolvedCommit, () => checkpointMetadata(f.handle, f.checkpoint))]);
    expect(selectRows(f.handle, "SELECT conflict_kind, baseline_scope_id, baseline_cbor, record_id, status, resolved_event_id FROM pending_conflicts"))
      .toEqual([[targetKind, null, null, JOBS, "resolved", id(83)]]);
    expect([...authoredRecords(f.handle, signal)][0]!.recordRevision).toBe(0n);
  } finally { disposeProjection(f.handle); }
});

it.each(["valid", "missing-effect", "wrong-changed-fields", "overlapping-edit"])("checks a changed automatic merge (%s) against baseline, ordinary effects and shared validation", async (fault) => {
  const f = await fixture();
  try {
    let local = f.local;
    let revision = 1n;
    let resultCommitId = id(100);
    if (fault === "overlapping-edit") {
      local = { ...f.local, values: new Map([[F.name.fieldId, textValue("Other local edit")]]), provenance: f.incoming.provenance };
      await f.replay([await f.patch(f.local, local, 1n, 84)]);
      revision = 2n; resultCommitId = id(101);
    }
    const payload = map([["payloadVersion", 1n], ["mergeId", id(90)], ["tableId", JOBS], ["recordId", JOB.j1], ["schemaRevision", 1n],
      ["baseline", f.baseline], ["local", f.source(local)], ["incoming", f.source(f.incoming)],
      ["localChangedFields", fault === "overlapping-edit" ? [F.name.fieldId] : []],
      ["incomingChangedFields", fault === "wrong-changed-fields" ? [] : [F.name.fieldId]],
      ["result", decodeCanonical(evidenceRecordBytes(f.incoming))], ["resultCommitId", resultCommitId], ["validationReport", report],
      ["explanation", map([["messageKey", "merge.one-side"], ["messageParameters", map([])]])], ["effectEventIds", fault === "missing-effect" ? [] : [id(82)]]]);
    const events = [...(fault === "missing-effect" ? [] : [await f.patch(local, f.incoming, revision, 82)]), f.wire("merge.applied", payload, 91)];
    if (fault === "valid") {
      await f.replay(events);
      expect([...authoredRecords(f.handle, signal)][0]!.recordRevision).toBe(1n);
      expect(selectRows(f.handle, "SELECT merge_id, record_id, result_commit_id FROM applied_merges")).toEqual([[id(90), JOB.j1, id(100)]]);
      expect(selectRows(f.handle, "SELECT count(*) FROM pending_conflicts")).toEqual([[0]]);
    } else {
      await expect(f.replay(events)).rejects.toThrow(/effects|changed-field|conflicting/);
      expect(f.handle.disposed).toBe(true);
    }
  } finally { disposeProjection(f.handle); }
});
