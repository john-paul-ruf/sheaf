import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { envelopeStoreAdapter } from "../../../src/workers/data/import-handlers.js";
import { AppSessionRegistry } from "../../../src/workers/data/app-session.js";
import { ask, createTestHandler, importDemoApp, readClearBootstrapRow, resetLocalDatabase } from "./data-worker.js";

it("opens the imported backup app once for concurrent route readers and preserves it after restart", async () => {
  await resetLocalDatabase();
  const worker = createTestHandler().handler;
  const registered = vi.spyOn(AppSessionRegistry.prototype, "set");
  try {
    await ask(worker, { kind: "setup", passphrase: "device copper heron meadow" });
    const appId = await importDemoApp(worker);
    const before = await readClearBootstrapRow();
    const responses = await Promise.allSettled([
      ask(worker, { kind: "getAppStructure", appId }),
      ask(worker, { kind: "openApp", appId }),
      ask(worker, { kind: "listTables", appId }),
      ask(worker, { kind: "openApp", appId }),
    ]);
    expect(responses.map((result) => result.status)).toEqual(Array(4).fill("fulfilled"));
    expect(registered).toHaveBeenCalledTimes(1);
    const opened = await ask(worker, { kind: "openApp", appId });
    expect(opened.session?.tables.length).toBeGreaterThan(0);
    expect(opened.session?.durability).toMatchObject({ homeId: null, confirmedAtMs: null });
    expect(await readClearBootstrapRow()).toEqual(before);
    worker.dispose();
    const restarted = createTestHandler().handler;
    try {
      await ask(restarted, { kind: "unlock", passphrase: "device copper heron meadow" });
      expect(await ask(restarted, { kind: "openApp", appId })).toEqual(opened);
    } finally { restarted.dispose(); }
  } finally { registered.mockRestore(); worker.dispose(); await resetLocalDatabase(); }
}, 60_000);

it("coalesces overlapping visit notifications without losing the imported app or changing its frontier", async () => {
  await resetLocalDatabase();
  const worker = createTestHandler().handler;
  try {
    await ask(worker, { kind: "setup", passphrase: "device copper heron meadow" });
    const appId = await importDemoApp(worker);
    const before = await readClearBootstrapRow();
    const opened = await ask(worker, { kind: "openApp", appId });
    const visits = await Promise.allSettled([
      ask(worker, { kind: "noteAppOpened", appId }),
      ask(worker, { kind: "noteAppOpened", appId }),
    ]);
    expect(visits.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await readClearBootstrapRow())?.["transactionRevision"]).toBe(Number(before?.["transactionRevision"]) + 1);
    expect((await ask(worker, { kind: "openApp", appId })).session?.durability).toEqual(opened.session?.durability);
  } finally { worker.dispose(); await resetLocalDatabase(); }
}, 60_000);

it.each(["closeApp", "lock"] as const)("%s prevents an in-flight hydration from installing a late session", async (kind) => {
  await resetLocalDatabase();
  const worker = createTestHandler().handler;
  const registered = vi.spyOn(AppSessionRegistry.prototype, "set");
  let reached!: () => void;
  const atRead = new Promise<void>((resolve) => { reached = resolve; });
  let resume!: () => void;
  const resumed = new Promise<void>((resolve) => { resume = resolve; });
  try {
    await ask(worker, { kind: "setup", passphrase: "device copper heron meadow" });
    const appId = await importDemoApp(worker);
    const before = await readClearBootstrapRow();
    const read = envelopeStoreAdapter.getEnvelope.bind(envelopeStoreAdapter);
    const delayed = vi.spyOn(envelopeStoreAdapter, "getEnvelope").mockImplementationOnce(async (id) => {
      reached();
      await resumed;
      return read(id);
    });
    try {
      const opening = Promise.allSettled([ask(worker, { kind: "openApp", appId })]);
      await atRead;
      await worker.handle(kind === "lock" ? { kind } : { kind, appId });
      const next = kind === "closeApp" ? ask(worker, { kind: "openApp", appId }) : null;
      resume();
      expect((await opening)[0]?.status).toBe("rejected");
      if (next !== null) {
        expect((await next).session?.appId).toBe(appId);
        expect(registered).toHaveBeenCalledTimes(1);
      } else {
        expect(registered).not.toHaveBeenCalled();
        await expect(ask(worker, { kind: "openApp", appId })).rejects.toMatchObject({ kind: "locked" });
      }
      expect(await readClearBootstrapRow()).toEqual(before);
    } finally { resume(); delayed.mockRestore(); }
  } finally { registered.mockRestore(); worker.dispose(); await resetLocalDatabase(); }
}, 60_000);

it("rejects a missing authenticated root without writing and permits a later fresh open", async () => {
  await resetLocalDatabase();
  const worker = createTestHandler().handler;
  try {
    await ask(worker, { kind: "setup", passphrase: "device copper heron meadow" });
    const appId = await importDemoApp(worker);
    const before = await readClearBootstrapRow();
    const missing = vi.spyOn(envelopeStoreAdapter, "getEnvelope").mockResolvedValueOnce(undefined);
    try {
      await expect(ask(worker, { kind: "openApp", appId })).rejects.toThrow("not in the store");
    } finally { missing.mockRestore(); }
    expect(await readClearBootstrapRow()).toEqual(before);
    expect((await ask(worker, { kind: "openApp", appId })).session?.appId).toBe(appId);
  } finally { worker.dispose(); await resetLocalDatabase(); }
}, 60_000);
