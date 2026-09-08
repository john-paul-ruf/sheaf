/**
 * CAP-07, and with it database.md § `LocalCatalogV1` **check 7**:
 *
 * > cached counts and times never authorize a destructive action; removal and
 * > reset recompute from the decrypted head/frontier before confirmation.
 *
 * Check 7 is not a catalog predicate — no validator can observe it — so this
 * is its assertion owner on the worker leg (AD-8 / replan finding F-10). Two
 * ways a stale value could authorize a purge are refused here: a confirm token
 * that no longer describes storage, and a session whose own cached counts have
 * drifted from storage even though the token is current. S07's e2e reset leg
 * owns the surface half.
 */

// First import: the shim must be installed before `dexie` is evaluated (D8).
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBootstrap } from "../../../src/persistence/envelope-store/bootstrap.js";
import { closeLocalDatabase } from "../../../src/persistence/envelope-store/db.js";
import {
  CRYPTO_TIMEOUT_MS,
  createTestHandler,
  resetLocalDatabase,
  type TestHandler,
} from "./data-worker.js";

const PASSPHRASE = "correct horse battery staple";

let worker: TestHandler;

async function setup(worker: TestHandler): Promise<void> {
  await worker.handler.handle({ kind: "setup", passphrase: PASSPHRASE });
}

async function unlock(worker: TestHandler): Promise<void> {
  await worker.handler.handle({ kind: "unlock", passphrase: PASSPHRASE });
}

async function enumerateReset(
  worker: TestHandler,
): Promise<{ readonly token: string; readonly appCount: number }> {
  const response = await worker.handler.handle({ kind: "resetReadable" });
  if (response.kind !== "resetReadable" || response.phase !== "inventory") {
    throw new Error("expected an inventory phase");
  }
  return { token: response.confirmToken, appCount: response.inventory.appCount };
}

async function storeExists(): Promise<boolean> {
  closeLocalDatabase();
  return (await readBootstrap()) !== undefined;
}

beforeEach(async () => {
  await resetLocalDatabase();
  worker = createTestHandler();
});

afterEach(() => {
  worker.handler.dispose();
});

describe("resetLocked", () => {
  it(
    "purges without unlocking and without enumerating anything",
    async () => {
      await setup(worker);
      await worker.handler.handle({ kind: "lock" });

      await expect(
        worker.handler.handle({ kind: "resetLocked" }),
      ).resolves.toEqual({ kind: "resetLocked", purged: true });

      expect(await storeExists()).toBe(false);
      await expect(worker.handler.handle({ kind: "getStatus" })).resolves.toEqual({
        kind: "getStatus",
        status: { state: "uninitialized" },
      });
    },
    CRYPTO_TIMEOUT_MS,
  );
});

describe("resetReadable", () => {
  it(
    "enumerates truthfully — F01 has no apps, and says so",
    async () => {
      await setup(worker);
      const response = await worker.handler.handle({ kind: "resetReadable" });
      if (response.kind !== "resetReadable" || response.phase !== "inventory") {
        throw new Error("expected an inventory phase");
      }

      expect(response.inventory).toEqual({ apps: [], appCount: 0, homeCount: 0 });
      expect(response.confirmToken.length).toBeGreaterThan(0);
      expect(await storeExists()).toBe(true);
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "purges when the token still describes what storage says",
    async () => {
      await setup(worker);
      const { token } = await enumerateReset(worker);

      await expect(
        worker.handler.handle({ kind: "resetReadable", confirmToken: token }),
      ).resolves.toEqual({
        kind: "resetReadable",
        phase: "purged",
        purged: true,
      });
      expect(await storeExists()).toBe(false);
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "check 7: a token issued before the state moved cannot purge",
    async () => {
      await setup(worker);
      const { token } = await enumerateReset(worker);

      // The durable state moves between enumerate and confirm.
      await worker.handler.handle({
        kind: "updateSettings",
        idleTimeoutMinutes: 15,
      });

      await expect(
        worker.handler.handle({ kind: "resetReadable", confirmToken: token }),
      ).rejects.toMatchObject({ kind: "stale-confirmation" });
      expect(await storeExists()).toBe(true);
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "check 7: a session whose cached counts drifted cannot purge, even with a current token",
    async () => {
      // Two workers on one store, which is how a cached count goes stale in
      // practice. `stale` enumerated at revision 1 and has cached that;
      // `mover` then commits, so storage is at revision 2.
      await setup(worker);
      const stale = worker;
      await enumerateReset(stale);

      const mover = createTestHandler();
      await unlock(mover);
      await mover.handler.handle({
        kind: "updateSettings",
        idleTimeoutMinutes: 15,
      });

      // A token that *is* current, taken from the worker that moved the state.
      const current = await enumerateReset(mover);

      // `stale` recomputes from storage and finds the token matches — but its
      // own cached view is a revision behind, and a cached count may not
      // authorize a purge.
      await expect(
        stale.handler.handle({
          kind: "resetReadable",
          confirmToken: current.token,
        }),
      ).rejects.toMatchObject({ kind: "stale-confirmation" });
      expect(await storeExists()).toBe(true);

      // The worker whose view is current may purge with the same token.
      await expect(
        mover.handler.handle({
          kind: "resetReadable",
          confirmToken: current.token,
        }),
      ).resolves.toMatchObject({ phase: "purged" });
      expect(await storeExists()).toBe(false);
      mover.handler.dispose();
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "refuses a forged token outright",
    async () => {
      await setup(worker);

      await expect(
        worker.handler.handle({
          kind: "resetReadable",
          confirmToken: "not-a-token",
        }),
      ).rejects.toMatchObject({ kind: "stale-confirmation" });
      expect(await storeExists()).toBe(true);
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "refuses to enumerate at all while locked",
    async () => {
      await setup(worker);
      await worker.handler.handle({ kind: "lock" });

      await expect(
        worker.handler.handle({ kind: "resetReadable" }),
      ).rejects.toMatchObject({ kind: "locked" });
      expect(await storeExists()).toBe(true);
    },
    CRYPTO_TIMEOUT_MS,
  );
});
