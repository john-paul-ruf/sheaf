/** CAP-07 purge: erases the store, works locked, and repeats harmlessly. */

// First import: the shim must be installed before `dexie` is evaluated (D8).
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBootstrap, readBootstrap } from "../../../src/persistence/envelope-store/bootstrap.js";
import { getEnvelope } from "../../../src/persistence/envelope-store/read.js";
import { purgeLocalStore } from "../../../src/persistence/envelope-store/reset.js";
import { estimateUsage } from "../../../src/persistence/envelope-store/quota.js";
import {
  bootstrapRow,
  opaqueFrame,
  resetLocalDatabase,
  storageId,
} from "./local-store.js";

beforeEach(resetLocalDatabase);

describe("purgeLocalStore", () => {
  it("removes the bootstrap row and every envelope", async () => {
    await createBootstrap(bootstrapRow(), [opaqueFrame(11, 1n)]);
    await purgeLocalStore();

    expect(await readBootstrap()).toBeUndefined();
    expect(await getEnvelope(storageId(11))).toBeUndefined();
  });

  it("succeeds on a store that was never created, and repeats", async () => {
    await purgeLocalStore();
    await purgeLocalStore();

    await createBootstrap(bootstrapRow());
    await purgeLocalStore();
    await purgeLocalStore();
    expect(await readBootstrap()).toBeUndefined();
  });

  it("leaves the store usable again afterwards", async () => {
    await createBootstrap(bootstrapRow());
    await purgeLocalStore();

    await createBootstrap(bootstrapRow({ writerEpoch: 1 }));
    expect((await readBootstrap())?.writerEpoch).toBe(1);
  });
});

describe("estimateUsage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports unknown rather than a fabricated number when unsupported", async () => {
    expect(await estimateUsage()).toEqual({ kind: "unknown" });
  });

  it("reports unknown when the browser answers with partial numbers", async () => {
    vi.stubGlobal("navigator", {
      storage: { estimate: () => Promise.resolve({ usage: 1_024 }) },
    });
    expect(await estimateUsage()).toEqual({ kind: "unknown" });
  });

  it("passes a complete estimate through", async () => {
    vi.stubGlobal("navigator", {
      storage: { estimate: () => Promise.resolve({ usage: 1_024, quota: 8_192 }) },
    });
    expect(await estimateUsage()).toEqual({
      kind: "estimated",
      usageBytes: 1_024,
      quotaBytes: 8_192,
    });
  });
});
