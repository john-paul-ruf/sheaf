/**
 * CA-05, pinned by AD-5: five free failures, the first 2s delay at the sixth
 * attempt, doubling, one-hour cap, reset on success and on termination.
 *
 * The vector is asserted literally, because three incompatible statements of
 * this schedule existed before it was pinned. The one real observation of the
 * 2s wait in a browser is in `tests/browser/worker/security.spec.ts`.
 */

import { describe, expect, it } from "vitest";
import { createSecretKey, wrapRoot, type LocalRootKeyHandle } from "../../../src/crypto/keys.js";
import {
  ATTEMPT_DELAY_CAP_MS,
  ATTEMPT_FIRST_DELAY_MS,
  ATTEMPT_FREE_FAILURES,
  AttemptDelay,
  WorkerSession,
  attemptDelayMs,
} from "../../../src/workers/data/session.js";
import { buildLocalCatalog } from "../../../src/workers/data/catalog.js";

const START = 1_700_000_000_000;

function rootKey(seed: number): LocalRootKeyHandle {
  return createSecretKey(
    Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256),
    "local-root",
  ) as LocalRootKeyHandle;
}

describe("attemptDelayMs", () => {
  it("is 0,0,0,0,0,2s,4s,8s,16s,32s for the first ten failures", () => {
    const vector = Array.from({ length: 10 }, (_, index) =>
      attemptDelayMs(index + 1),
    );

    expect(vector).toEqual([
      0, 0, 0, 0, 0, 2_000, 4_000, 8_000, 16_000, 32_000,
    ]);
    expect(ATTEMPT_FREE_FAILURES).toBe(5);
    expect(ATTEMPT_FIRST_DELAY_MS).toBe(2_000);
  });

  it("imposes the first delay at the sixth attempt, not the fifth", () => {
    expect(attemptDelayMs(5)).toBe(0);
    expect(attemptDelayMs(6)).toBe(2_000);
  });

  it("doubles until it reaches the one-hour cap, then stays there", () => {
    expect(attemptDelayMs(16)).toBe(2_048_000);
    expect(attemptDelayMs(17)).toBe(ATTEMPT_DELAY_CAP_MS);
    expect(attemptDelayMs(50)).toBe(ATTEMPT_DELAY_CAP_MS);
    expect(ATTEMPT_DELAY_CAP_MS).toBe(3_600_000);
  });
});

describe("AttemptDelay", () => {
  it("reports the same schedule and holds the caller until it elapses", () => {
    const delay = new AttemptDelay();
    const imposed = Array.from({ length: 6 }, () => delay.recordFailure(START));

    expect(imposed).toEqual([0, 0, 0, 0, 0, 2_000]);
    expect(delay.remainingMs(START)).toBe(2_000);
    expect(delay.remainingMs(START + 1_999)).toBe(1);
    expect(delay.remainingMs(START + 2_000)).toBe(0);
    expect(delay.remainingMs(START + 10_000)).toBe(0);
  });

  it("a success resets the counter, so the next five failures are free again", () => {
    const delay = new AttemptDelay();
    for (let attempt = 0; attempt < 7; attempt += 1) {
      delay.recordFailure(START);
    }
    expect(delay.consecutiveFailures).toBe(7);

    delay.recordSuccess();

    expect(delay.consecutiveFailures).toBe(0);
    expect(delay.remainingMs(START)).toBe(0);
    expect(
      Array.from({ length: 5 }, () => delay.recordFailure(START)),
    ).toEqual([0, 0, 0, 0, 0]);
  });

  it("dies with the worker: a new session starts free", () => {
    const first = new AttemptDelay();
    for (let attempt = 0; attempt < 9; attempt += 1) {
      first.recordFailure(START);
    }
    expect(first.remainingMs(START)).toBe(16_000);

    // Termination is not a reset call: the state was only ever in memory, so
    // the next worker simply has none (D4 — nothing is persisted).
    const afterTermination = new AttemptDelay();
    expect(afterTermination.consecutiveFailures).toBe(0);
    expect(afterTermination.remainingMs(START)).toBe(0);
  });
});

describe("WorkerSession", () => {
  const catalog = buildLocalCatalog({
    deviceId: "kZ8n0Qc1TfKq2mHrb3VtZw",
    recoveryCodeView: new Uint8Array(16),
  });

  function unlockedWith(root: LocalRootKeyHandle): WorkerSession {
    const session = new WorkerSession();
    session.unlock({
      root,
      unlockedVia: "passphrase",
      catalog,
      catalogStorageId: "kZ8n0Qc1TfKq2mHrb3VtZw",
      transactionRevision: 1,
      writerEpoch: 0,
    });
    return session;
  }

  it("locking zeroizes the root, so the handle can never be used again", async () => {
    const root = rootKey(1);
    const session = unlockedWith(root);
    expect(session.isUnlocked).toBe(true);

    session.lock();

    expect(session.isUnlocked).toBe(false);
    expect(session.state).toEqual({ kind: "locked" });
    await expect(wrapRoot(root, rootKey(2))).rejects.toThrow(
      /unknown or already destroyed/,
    );
  });

  it("locking twice is harmless, and updating a locked session is a bug", () => {
    const session = unlockedWith(rootKey(3));
    session.lock();
    session.lock();

    expect(() => session.update({ transactionRevision: 2 })).toThrow(
      /cannot update a locked session/,
    );
  });

  it("unlocking again zeroizes the root it replaces", async () => {
    const first = rootKey(4);
    const session = unlockedWith(first);
    session.unlock({
      root: rootKey(5),
      unlockedVia: "recovery-code",
      catalog,
      catalogStorageId: "kZ8n0Qc1TfKq2mHrb3VtZw",
      transactionRevision: 1,
      writerEpoch: 0,
    });

    await expect(wrapRoot(first, rootKey(6))).rejects.toThrow(
      /unknown or already destroyed/,
    );
    expect(session.state).toMatchObject({ unlockedVia: "recovery-code" });
  });
});
