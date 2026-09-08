/**
 * Shared setup for the data-worker handler suites.
 *
 * `fake-indexeddb/auto` installs the shim before Dexie is evaluated (D8); the
 * real-IndexedDB authority stays `tests/browser/worker/`. Argon2id is real in
 * these tests — it is the thing under test at the unlock boundary — so
 * calibration is pinned to the v1 floor and every case that derives a key
 * carries a longer timeout.
 */

import "fake-indexeddb/auto";
import { ARGON2ID_FLOOR } from "../../../src/crypto/kdf.js";
import type { ClockPort } from "../../../src/application/ports/clock.js";
import type { EntropyPort } from "../../../src/application/ports/entropy.js";
import {
  closeLocalDatabase,
  openLocalDatabase,
} from "../../../src/persistence/envelope-store/db.js";
import {
  createDataWorkerHandler,
  type DataWorkerCommandHandler,
} from "../../../src/workers/data/handlers.js";

/** A derivation plus a commit; generous, and still far under a hang. */
export const CRYPTO_TIMEOUT_MS = 60_000;

export class FakeClock implements ClockPort {
  #epochMs: number;

  constructor(epochMs = 1_700_000_000_000) {
    this.#epochMs = epochMs;
  }

  nowEpochMs(): number {
    return this.#epochMs;
  }

  advance(ms: number): void {
    this.#epochMs += ms;
  }
}

export const realEntropy: EntropyPort = {
  randomBytes: (byteLength: number) =>
    crypto.getRandomValues(new Uint8Array(byteLength)),
};

/** Calibration that cannot climb: the floor is both the start and the ceiling. */
const PINNED_CALIBRATION = {
  probe: (): Promise<void> => Promise.resolve(),
  maxMemoryKiB: ARGON2ID_FLOOR.memoryKiB,
  maxIterations: ARGON2ID_FLOOR.iterations,
};

export interface TestHandler {
  readonly handler: DataWorkerCommandHandler;
  readonly clock: FakeClock;
}

/** A worker's worth of state. A second call models a fresh worker. */
export function createTestHandler(clock: FakeClock = new FakeClock()): TestHandler {
  return {
    clock,
    handler: createDataWorkerHandler({
      clock,
      entropy: realEntropy,
      calibration: PINNED_CALIBRATION,
    }),
  };
}

export async function resetLocalDatabase(): Promise<void> {
  const database = await openLocalDatabase();
  await database.delete({ disableAutoOpen: true });
  closeLocalDatabase();
}

/** Reads the clear bootstrap row straight from IndexedDB, bypassing the store. */
export async function readClearBootstrapRow(): Promise<
  Record<string, unknown> | undefined
> {
  const database = await openLocalDatabase();
  const row: unknown = await database.table("bootstrap").get("root");
  return row as Record<string, unknown> | undefined;
}

export async function countEnvelopeRows(): Promise<number> {
  const database = await openLocalDatabase();
  return database.table("envelopes").count();
}
