/**
 * CAP-01/02/03 at handler level, plus the `updateSettings` writer (D13/AD-7).
 *
 * Real crypto, real codecs, real store — only IndexedDB is the fake-indexeddb
 * shim (D8). The real-browser proof of the same journey is
 * `tests/browser/worker/journey.spec.ts`; this suite exists for the cases a
 * browser run cannot state as sharply, such as "a locked session may not read
 * or change the catalog".
 */

// First import: the shim must be installed before `dexie` is evaluated (D8).
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCAL_STORE_V1 } from "../../../src/migrations/001_local_store_v1.js";
import { DataWorkerCommandError } from "../../../src/workers/protocol/redact.js";
import type { UnlockedSessionViewV1 } from "../../../src/workers/protocol/messages.js";
import {
  CRYPTO_TIMEOUT_MS,
  countEnvelopeRows,
  createTestHandler,
  readClearBootstrapRow,
  resetLocalDatabase,
  type TestHandler,
} from "./data-worker.js";

const PASSPHRASE = "correct horse battery staple";

let worker: TestHandler;

async function setup(handler = worker.handler): Promise<string> {
  const response = await handler.handle({ kind: "setup", passphrase: PASSPHRASE });
  if (response.kind !== "setup") {
    throw new Error("expected a setup response");
  }
  return response.recoveryCode;
}

async function unlock(handler = worker.handler): Promise<UnlockedSessionViewV1> {
  const response = await handler.handle({ kind: "unlock", passphrase: PASSPHRASE });
  if (response.kind !== "unlock") {
    throw new Error("expected an unlock response");
  }
  return response.session;
}

beforeEach(async () => {
  await resetLocalDatabase();
  worker = createTestHandler();
});

afterEach(() => {
  worker.handler.dispose();
});

describe("CAP-01 setup", () => {
  it(
    "returns the recovery code once and an unlocked, empty session",
    async () => {
      const response = await worker.handler.handle({
        kind: "setup",
        passphrase: PASSPHRASE,
      });
      if (response.kind !== "setup") {
        throw new Error("expected a setup response");
      }

      // 8 groups of 7 Crockford characters, joined by "-" (S02's format).
      expect(response.recoveryCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{7}(-[0-9A-HJKMNP-TV-Z]{7}){7}$/);
      expect(response.session).toEqual({
        state: "unlocked",
        unlockedVia: "passphrase",
        settings: { idleTimeoutMinutes: 0 },
        catalogRevision: 1,
        transactionRevision: 1,
        appCount: 0,
        homeCount: 0,
      });
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "writes the bootstrap and its catalog in one revision, in clear only what migration 001 declares",
    async () => {
      await setup();

      const row = await readClearBootstrapRow();
      expect(row).toBeDefined();
      expect(row?.["transactionRevision"]).toBe(1);
      expect(row?.["writerEpoch"]).toBe(0);
      expect(await countEnvelopeRows()).toBe(1);

      // The stored keys are exactly migration 001's declared fields: the
      // catalog's contents are nowhere in the clear.
      expect(Object.keys(row ?? {}).sort()).toEqual(
        [
          "slot",
          "databaseFormatVersion",
          "minimumReaderVersion",
          "codecVersion",
          "envelopeFormatVersion",
          "cipherSuiteVersion",
          "paddingProfileVersion",
          "transactionRevision",
          "writerEpoch",
          "passphraseKdf",
          "recoveryKdf",
          "passphraseWrappedRoot",
          "recoveryWrappedRoot",
          "catalogStorageId",
          "migrationStorageId",
        ].sort(),
      );
      expect(LOCAL_STORE_V1.bootstrap).toBe("slot");
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "refuses a second setup rather than overwriting a store that has data",
    async () => {
      await setup();
      const second = createTestHandler();

      await expect(
        second.handler.handle({ kind: "setup", passphrase: "another one" }),
      ).rejects.toMatchObject({ kind: "already-initialized" });
      second.handler.dispose();
    },
    CRYPTO_TIMEOUT_MS,
  );
});

describe("CAP-02 unlock", () => {
  it(
    "rejects a wrong passphrase with a typed error and a delay figure",
    async () => {
      await setup();
      const fresh = createTestHandler();

      await expect(
        fresh.handler.handle({ kind: "unlock", passphrase: "not it" }),
      ).rejects.toMatchObject({ kind: "wrong-passphrase", retryAfterMs: 0 });

      // The failed attempt changed nothing durable.
      expect((await readClearBootstrapRow())?.["transactionRevision"]).toBe(1);
      fresh.handler.dispose();
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "reads the catalog back in a new worker after the first one is gone",
    async () => {
      await setup();
      worker.handler.dispose();

      const restarted = createTestHandler();
      const session = await unlock(restarted.handler);

      expect(session).toMatchObject({
        state: "unlocked",
        unlockedVia: "passphrase",
        catalogRevision: 1,
        transactionRevision: 1,
        appCount: 0,
      });
      restarted.handler.dispose();
    },
    CRYPTO_TIMEOUT_MS,
  );

  it("refuses to unlock a store that was never set up", async () => {
    await expect(
      worker.handler.handle({ kind: "unlock", passphrase: PASSPHRASE }),
    ).rejects.toMatchObject({ kind: "not-initialized" });
  });
});

describe("CAP-03 lock and updateSettings", () => {
  it(
    "acks the lock and then answers nothing that needs the catalog",
    async () => {
      await setup();

      await expect(worker.handler.handle({ kind: "lock" })).resolves.toEqual({
        kind: "lock",
        status: { state: "locked" },
      });

      await expect(
        worker.handler.handle({ kind: "updateSettings", idleTimeoutMinutes: 15 }),
      ).rejects.toMatchObject({ kind: "locked" });
      await expect(
        worker.handler.handle({ kind: "resetReadable" }),
      ).rejects.toMatchObject({ kind: "locked" });
      await expect(
        worker.handler.handle({
          kind: "revealRecoveryCode",
          currentPassphrase: PASSPHRASE,
        }),
      ).rejects.toMatchObject({ kind: "locked" });

      const status = await worker.handler.handle({ kind: "getStatus" });
      expect(status).toEqual({ kind: "getStatus", status: { state: "locked" } });
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "commits a new catalog envelope at the next revision and moves the pointer",
    async () => {
      await setup();
      const before = await readClearBootstrapRow();

      const response = await worker.handler.handle({
        kind: "updateSettings",
        idleTimeoutMinutes: 15,
      });
      if (response.kind !== "updateSettings") {
        throw new Error("expected an updateSettings response");
      }

      expect(response.settings).toEqual({ idleTimeoutMinutes: 15 });
      expect(response.session).toMatchObject({
        catalogRevision: 2,
        transactionRevision: 2,
      });

      const after = await readClearBootstrapRow();
      expect(after?.["transactionRevision"]).toBe(2);
      expect(after?.["catalogStorageId"]).not.toBe(before?.["catalogStorageId"]);
      // The old envelope is immutable and stays; the pointer is what moved.
      expect(await countEnvelopeRows()).toBe(2);
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "keeps the setting across a restart, read back through unlock",
    async () => {
      await setup();
      await worker.handler.handle({
        kind: "updateSettings",
        idleTimeoutMinutes: 60,
      });
      worker.handler.dispose();

      const restarted = createTestHandler();
      const session = await unlock(restarted.handler);

      expect(session.settings.idleTimeoutMinutes).toBe(60);
      expect(session.catalogRevision).toBe(2);
      expect(session.transactionRevision).toBe(2);
      restarted.handler.dispose();
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "accepts only 0, 5, 15 and 60 — never a free-form number",
    async () => {
      await setup();

      for (const minutes of [0, 5, 15, 60] as const) {
        const response = await worker.handler.handle({
          kind: "updateSettings",
          idleTimeoutMinutes: minutes,
        });
        expect(response).toMatchObject({ settings: { idleTimeoutMinutes: minutes } });
      }

      for (const rejected of [30, -1, 1.5, 3_600, null, "15", undefined]) {
        await expect(
          worker.handler.handle({
            kind: "updateSettings",
            idleTimeoutMinutes: rejected as 0 | 5 | 15 | 60,
          }),
        ).rejects.toMatchObject({ kind: "invalid-setting" });
      }
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "surfaces a stale commit as a typed conflict rather than overwriting",
    async () => {
      await setup();
      const stale = worker.handler;

      // A second worker unlocks the same store and commits first, so the
      // session held by `stale` is now behind.
      const other = createTestHandler();
      await unlock(other.handler);
      await other.handler.handle({ kind: "updateSettings", idleTimeoutMinutes: 5 });

      await expect(
        stale.handle({ kind: "updateSettings", idleTimeoutMinutes: 60 }),
      ).rejects.toBeInstanceOf(Error);
      expect((await readClearBootstrapRow())?.["transactionRevision"]).toBe(2);
      other.handler.dispose();
    },
    CRYPTO_TIMEOUT_MS,
  );
});

describe("the protocol surface", () => {
  it("refuses an unknown command kind", async () => {
    await expect(
      worker.handler.handle({ kind: "nonsense" } as never),
    ).rejects.toBeInstanceOf(DataWorkerCommandError);
  });

  it("reports an uninitialized store before anything is set up", async () => {
    await expect(worker.handler.handle({ kind: "getStatus" })).resolves.toEqual({
      kind: "getStatus",
      status: { state: "uninitialized" },
    });
  });
});
