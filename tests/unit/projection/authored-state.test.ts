import { expect, it } from "vitest";
import { authoredState, disposeProjection, hydrateApp, openProjection } from "../../../src/persistence/projection/index.js";
import { sha256, sha256Chunks } from "../../../src/crypto/hash.js";
import { queryCheckpoint } from "./query-fixture.js";
import { textValue } from "../../../src/domain/model/values.js";

it("hashes authored values and complete field definitions independently of derived/local state", async () => {
  const checkpoint = queryCheckpoint();
  async function digest(value: typeof checkpoint) {
    const handle = await openProjection({ sha256, clock: () => ({ epochMs: 0, epochDay: 0 }) });
    try {
      await hydrateApp(handle, value);
      return await sha256Chunks(authoredState(handle, new AbortController().signal));
    } finally { disposeProjection(handle); }
  }
  const first = await digest(checkpoint);
  expect(await digest({ ...checkpoint, appState: { ...checkpoint.appState, lastOpenedAtMs: 1000, deviceOnlyChangeCount: 42, lastSuccessfulBackupMs: 500 } })).toEqual(first);
  const pages = checkpoint.recordPages.map((page) => ({ records: page.records.map((entry, i) => i !== 0 ? entry : {
    ...entry, record: { ...entry.record, values: new Map([...entry.record.values].map(([field, value]) => [field, value.kind === "text" ? textValue("Different") : value])) },
  }) }));
  expect(await digest({ ...checkpoint, recordPages: pages })).not.toEqual(first);
  const tables = checkpoint.tables.map((table) => ({ ...table, fields: table.fields.map((field) => field.type.kind === "currency" ? { ...field, type: { kind: "currency" as const, currencyCode: "EUR" } } : field) }));
  expect(await digest({ ...checkpoint, tables })).not.toEqual(first);
});

it("iterates through the port and closes SQLite statements on abort, return and projection disposal", async () => {
  const handle = await openProjection({ sha256, clock: () => ({ epochMs: 0, epochDay: 0 }) });
  try {
    await hydrateApp(handle, queryCheckpoint());
    const port: import("../../../src/application/ports/projection.js").ProjectionAuthoredStatePort = {
      authoredState: (signal) => authoredState(handle, signal),
    };
    const before = new AbortController();
    before.abort(new Error("before cursor"));
    await expect(sha256Chunks(port.authoredState(before.signal))).rejects.toThrow("before cursor");
    const abort = new AbortController();
    const cursor = port.authoredState(abort.signal)[Symbol.asyncIterator]();
    // Cross metadata and enter real SQL row iteration before cancellation.
    for (let i = 0; i < 30; i++) expect((await cursor.next()).done).toBe(false);
    abort.abort(new Error("within cursor"));
    await expect(cursor.next()).rejects.toThrow("within cursor");
    expect(await sha256Chunks(port.authoredState(new AbortController().signal))).toHaveLength(32);
    const returned = port.authoredState(new AbortController().signal)[Symbol.asyncIterator]();
    for (let i = 0; i < 30; i++) await returned.next();
    await returned.return?.();
    await returned.return?.();
    const stale = port.authoredState(new AbortController().signal)[Symbol.asyncIterator]();
    for (let i = 0; i < 30; i++) await stale.next();
    disposeProjection(handle);
    disposeProjection(handle);
    await expect(stale.next()).rejects.toThrow(/disposed/);
  } finally { disposeProjection(handle); }
});

it("propagates lazy producer failure and disposes a partial hydration", async () => {
  const handle = await openProjection({ sha256, clock: () => ({ epochMs: 0, epochDay: 0 }) });
  const failure = new Error("page producer failed");
  const checkpoint = queryCheckpoint();
  function* pages() { yield checkpoint.recordPages[0]!; throw failure; }
  await expect(hydrateApp(handle, { ...checkpoint, recordPages: [] }, [], pages())).rejects.toBe(failure);
  expect(handle.disposed).toBe(true);
  await expect(sha256Chunks(authoredState(handle, new AbortController().signal))).rejects.toThrow(/disposed/);
  disposeProjection(handle);
});
