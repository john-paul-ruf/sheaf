import { expect, it } from "vitest";
import { asDomainId } from "../../../src/domain/model/ids.js";
import { decodeAuthoredRecord, encodeAuthoredRecord } from "../../../src/persistence/projection/cbor-values.js";
import type { CborValue } from "../../../src/persistence/codecs/canonical-cbor.js";

it("preserves canonical provenance evidence through the projection cache", () => {
  const fieldId = asDomainId("field", new Uint8Array(16).fill(1));
  for (const evidence of [new Uint8Array([3, 8]), [null, true, new Uint8Array([2])], new Map<string, CborValue>([["nested", [new Uint8Array([9]), null]]]), null]) {
    const record = { recordId: asDomainId("record", new Uint8Array(16).fill(2)), tableId: asDomainId("table", new Uint8Array(16).fill(3)),
      values: new Map([[fieldId, { kind: "text" as const, text: "value" }]]),
      provenance: new Map([[fieldId, { source: "user" as const, evidence }]]) };
    const restored = decodeAuthoredRecord(encodeAuthoredRecord(record));
    expect([...restored.provenance.values()][0]).toEqual({ source: "user", evidence });
  }
});

it("streams original SQL record metadata, excludes computed values and closes on cancellation", async () => {
  const { authoredRecords, hydrateApp, openProjection, disposeProjection } = await import("../../../src/persistence/projection/index.js");
  const { queryCheckpoint, F } = await import("./query-fixture.js");
  const { sha256 } = await import("../../../src/crypto/hash.js");
  const checkpoint = queryCheckpoint();
  const handle = await openProjection({ sha256, clock: () => ({ epochMs: 0, epochDay: 0 }) });
  try {
    await hydrateApp(handle, checkpoint);
    const records = [...authoredRecords(handle, new AbortController().signal)];
    expect(records).toHaveLength(checkpoint.recordPages.reduce((count, page) => count + page.records.length, 0));
    for (const actual of records) {
      const expected = checkpoint.recordPages.flatMap((page) => page.records).find((row) => row.record.recordId.every((byte, index) => byte === actual.record.recordId[index]))!;
      expect(actual.recordRevision).toBe(expected.recordRevision);
      expect(actual.createdCommitId).toEqual(expected.createdCommitId);
      expect(actual.updatedCommitId).toEqual(expected.updatedCommitId);
      expect([...actual.record.values.keys()].some((id) => id.every((byte, index) => byte === F.balance.fieldId[index]))).toBe(false);
    }
    const abort = new AbortController();
    const iterator = authoredRecords(handle, abort.signal)[Symbol.iterator]();
    expect(iterator.next().done).toBe(false);
    abort.abort(new Error("record export cancelled"));
    expect(() => iterator.next()).toThrow("record export cancelled");
    expect([...authoredRecords(handle, new AbortController().signal)]).toHaveLength(records.length);
    const changed = authoredRecords(handle, new AbortController().signal)[Symbol.iterator]();
    changed.next();
    handle.frontier.set("changed", { deviceId: new Uint8Array(16), commitSequence: 1n });
    expect(() => changed.next()).toThrow("record export changed");
  } finally { disposeProjection(handle); }
});

it("copies original deletion history at the checkpoint frontier without replaying row mutations", async () => {
  const { authoredRecords, applyEvents, copyCheckpointHistory, executeQuery, hydrateApp, openProjection, disposeProjection } = await import("../../../src/persistence/projection/index.js");
  const { queryCheckpoint, JOB } = await import("./query-fixture.js");
  const { sha256 } = await import("../../../src/crypto/hash.js");
  const { sealEventCommit } = await import("../../../src/persistence/codecs/event-commit.js");
  const { encodeRecordEventPayload } = await import("../../../src/workers/data/record-event-payloads.js");
  const checkpoint = queryCheckpoint();
  const open = () => openProjection({ sha256, clock: () => ({ epochMs: 0, epochDay: 0 }) });
  const source = await open();
  const target = await open();
  const wrongFrontier = await open();
  const signal = new AbortController().signal;
  try {
    await hydrateApp(source, checkpoint);
    const original = checkpoint.recordPages.flatMap((page) => page.records).find((row) => row.record.recordId.every((byte, i) => byte === JOB.j1[i]))!;
    const event = { kind: "record.deleted" as const, payload: { recordId: original.record.recordId, tableId: original.record.tableId,
      priorRecordRevision: original.recordRevision, restoration: original.record, source: "user" as const } };
    const deletedEventId = asDomainId("event", new Uint8Array(16).fill(90));
    const commit = await sealEventCommit({ eventFormatVersion: 1, commitId: new Uint8Array(16).fill(91), appId: checkpoint.appId,
      deviceId: new Uint8Array(16).fill(92), deviceCommitSequence: 1n, previousDeviceCommitSha256: null,
      basisFrontier: checkpoint.frontier, hybridTime: { wallTimeMs: 1000n, logicalCounter: 0 }, eventClass: "authored",
      schemaRevisionBefore: 1n, schemaRevisionAfter: 1n, events: [{ eventId: deletedEventId, eventIndex: 0, kind: event.kind,
        subject: { appId: checkpoint.appId, tableId: original.record.tableId, recordId: original.record.recordId },
        provenance: { source: "user" }, payload: encodeRecordEventPayload(event) }] }, sha256);
    await applyEvents(source, [{ commit, events: [event] }]);
    const frontier = [...source.frontier.values()];
    const rows = [...authoredRecords(source, signal)];
    await hydrateApp(target, { ...checkpoint, frontier, recordPages: [{ records: rows }] });
    await hydrateApp(wrongFrontier, checkpoint);
    await expect(copyCheckpointHistory(source, wrongFrontier, signal)).rejects.toThrow("history frontier mismatch");
    expect(executeQuery(wrongFrontier, { kind: "page-change-history", after: null, limit: 50 }).events).toHaveLength(0);
    await copyCheckpointHistory(source, target, signal);
    expect(executeQuery(target, { kind: "record-by-id", recordId: JOB.j1 })).toBeNull();
    expect(executeQuery(target, { kind: "deleted-record", recordId: JOB.j1 })).toEqual(executeQuery(source, { kind: "deleted-record", recordId: JOB.j1 }));
    expect(executeQuery(target, { kind: "page-change-history", after: null, limit: 50 })).toEqual(executeQuery(source, { kind: "page-change-history", after: null, limit: 50 }));
    await expect(copyCheckpointHistory(source, target, signal)).rejects.toThrow("empty target");
  } finally { disposeProjection(source); disposeProjection(target); disposeProjection(wrongFrontier); }
});

it("copies complete baseline, pending/resolved conflict and applied-merge rows without changing authored records", async () => {
  const { copyCheckpointHistory, hydrateApp, openProjection, disposeProjection, authoredRecords } = await import("../../../src/persistence/projection/index.js");
  const { run, selectRows } = await import("../../../src/persistence/projection/engine.js");
  const { encodeCanonical } = await import("../../../src/persistence/codecs/canonical-cbor.js");
  const { queryCheckpoint } = await import("./query-fixture.js");
  const { sha256 } = await import("../../../src/crypto/hash.js");
  const checkpoint = queryCheckpoint();
  const source = await openProjection({ sha256, clock: () => ({ epochMs: 0, epochDay: 0 }) });
  const target = await openProjection({ sha256, clock: () => ({ epochMs: 0, epochDay: 0 }) });
  const id = (byte: number) => new Uint8Array(16).fill(byte);
  const bytes = encodeCanonical(new Map<string, CborValue>([["original", [id(9), null, "evidence"]]]));
  const signal = new AbortController().signal;
  try {
    await hydrateApp(source, checkpoint);
    await hydrateApp(target, checkpoint);
    const before = [...authoredRecords(target, signal)];
    const row = before[0]!.record;
    run(source, "INSERT INTO baseline_scopes VALUES (?, 'durable-home', NULL, ?, ?, 1, ?, 10)", [id(70), id(71), id(72), bytes]);
    for (const [index, state] of ["present", "deleted", "absent"].entries()) {
      run(source, "INSERT INTO baseline_records VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id(70), row.tableId, index === 0 ? row.recordId : id(73 + index), state, state === "present" ? bytes : null,
          state === "absent" ? "never-observed" : null, bytes]);
    }
    for (const [index, status] of ["pending", "resolved"].entries()) {
      run(source, "INSERT INTO pending_conflicts VALUES (?, ?, ?, ?, 'field', ?, ?, ?, ?, ?, 'this-device', 'another-device', 10, 20, 30, ?, ?, ?)",
        [id(80 + index), row.tableId, row.recordId, id(70), bytes, bytes, bytes, bytes, bytes, status, id(82 + index), status === "pending" ? null : id(84)]);
    }
    run(source, "INSERT INTO applied_merges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 40)",
      [id(85), row.tableId, row.recordId, id(70), id(86), id(87), id(88), bytes, bytes]);
    await copyCheckpointHistory(source, target, signal);
    for (const [table, order] of [["baseline_scopes", "baseline_scope_id"], ["baseline_records", "baseline_scope_id, table_id, record_id"],
      ["pending_conflicts", "conflict_id"], ["applied_merges", "merge_id"]]) {
      expect(selectRows(target, `SELECT * FROM ${table} ORDER BY ${order}`), table).toEqual(selectRows(source, `SELECT * FROM ${table} ORDER BY ${order}`));
    }
    expect(selectRows(target, "SELECT status, resolved_event_id FROM pending_conflicts ORDER BY conflict_id")).toEqual([["pending", null], ["resolved", id(84)]]);
    expect(selectRows(target, "SELECT baseline_state, absent_reason FROM baseline_records ORDER BY baseline_state")).toEqual([["absent", "never-observed"], ["deleted", null], ["present", null]]);
    expect([...authoredRecords(target, signal)]).toEqual(before);
    await expect(copyCheckpointHistory(source, target, signal)).rejects.toThrow("empty evidence tables");
  } finally { disposeProjection(source); disposeProjection(target); }
});

it("hydrates authenticated baseline facts at the SQL maximum and copies frontier uint64 bytes exactly", async () => {
  const { hydrateBaselines, copyCheckpointHistory } = await import("../../../src/persistence/projection/checkpoint-history.js");
  const { hydrateApp, openProjection, disposeProjection } = await import("../../../src/persistence/projection/index.js");
  const { selectRows } = await import("../../../src/persistence/projection/engine.js");
  const { encodeFrontier } = await import("../../../src/persistence/projection/cbor-values.js");
  const { encodeCanonical } = await import("../../../src/persistence/codecs/canonical-cbor.js");
  const { queryCheckpoint } = await import("./query-fixture.js");
  const { sha256 } = await import("../../../src/crypto/hash.js");
  const checkpoint = queryCheckpoint();
  const source = await openProjection({ sha256, clock: () => ({ epochMs: 0, epochDay: 0 }) });
  const target = await openProjection({ sha256, clock: () => ({ epochMs: 0, epochDay: 0 }) });
  const signal = new AbortController().signal;
  const id = (n: number) => new Uint8Array(16).fill(n);
  const frontier = [{ deviceId: id(90), commitSequence: (1n << 64n) - 1n }];
  const row = checkpoint.recordPages[0]!.records[0]!.record;
  const scope = { scopeId: id(80), scopeKind: "durable-home" as const, importLineageId: null, durableHomeId: id(81), counterpartId: id(82),
    establishedGeneration: BigInt(Number.MAX_SAFE_INTEGER), establishedFrontier: frontier, establishedAtMs: Number.MAX_SAFE_INTEGER };
  const entries = ["present", "deleted", "absent"].map((state, index) => ({ tableId: row.tableId, recordId: id(83 + index),
    state: state as "present" | "deleted" | "absent", values: state === "present" ? encodeCanonical([]) : null,
    absentReason: state === "absent" ? "legacy-reason-not-recorded" : null, sourceFrontier: frontier }));
  try {
    await hydrateApp(source, checkpoint);
    await hydrateApp(target, checkpoint);
    async function* pages() { yield await Promise.resolve({ scope, entries: entries.slice(0, 2) }); yield { scope, entries: entries.slice(2) }; }
    await hydrateBaselines(source, pages(), signal);
    expect(selectRows(source, "SELECT established_generation, established_frontier_cbor, established_at_ms FROM baseline_scopes"))
      .toEqual([[Number.MAX_SAFE_INTEGER, encodeFrontier(frontier), Number.MAX_SAFE_INTEGER]]);
    await copyCheckpointHistory(source, target, signal);
    expect(selectRows(target, "SELECT * FROM baseline_scopes")).toEqual(selectRows(source, "SELECT * FROM baseline_scopes"));
    expect(selectRows(target, "SELECT * FROM baseline_records ORDER BY record_id")).toEqual(selectRows(source, "SELECT * FROM baseline_records ORDER BY record_id"));
  } finally { disposeProjection(source); disposeProjection(target); }
});
