/**
 * In-worker session state: what is unlocked, and how long the next attempt
 * must wait (CA-05).
 *
 * **Nothing here is persisted, ever.** database.md v1 keeps no failed-attempt
 * counter (decision D4): a useful pre-unlock counter would either exceed the
 * cleartext budget or need a browser-held bypass key beside it. Argon2id is
 * the offline-attack boundary; this delay is defense in depth against someone
 * typing at the device, and it dies with the worker.
 *
 * **The schedule, pinned by AD-5.** Five consecutive failures are free. The
 * first delay is 2s and it applies *at the sixth* attempt, doubling per
 * further failure, capped at one hour. A successful unlock resets it, and so
 * does worker termination — because the state lives only in this object.
 * The vector is therefore `0, 0, 0, 0, 0, 2s, 4s, 8s, …`.
 */

import { destroySecretKey, type LocalRootKeyHandle } from "../../crypto/keys.js";
import type { UnlockMethodV1 } from "../protocol/messages.js";
import type { LocalCatalogV1 } from "./catalog.js";

export const ATTEMPT_FREE_FAILURES = 5;
export const ATTEMPT_FIRST_DELAY_MS = 2_000;
export const ATTEMPT_DELAY_CAP_MS = 3_600_000;

/**
 * Added delay after `consecutiveFailures` consecutive failures. Failures one
 * through five add nothing; the sixth adds 2s.
 */
export function attemptDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= ATTEMPT_FREE_FAILURES) {
    return 0;
  }
  const doublings = consecutiveFailures - ATTEMPT_FREE_FAILURES - 1;
  // 2^30 ms is already far past the cap; bounding the exponent keeps the
  // arithmetic finite no matter how long someone keeps typing.
  const scaled =
    ATTEMPT_FIRST_DELAY_MS * 2 ** Math.min(doublings, 30);
  return Math.min(scaled, ATTEMPT_DELAY_CAP_MS);
}

/** Session-memory attempt bookkeeping. One instance per worker lifetime. */
export class AttemptDelay {
  #consecutiveFailures = 0;
  #availableAtEpochMs = 0;

  get consecutiveFailures(): number {
    return this.#consecutiveFailures;
  }

  /** Returns the delay this failure imposes, in milliseconds. */
  recordFailure(nowEpochMs: number): number {
    this.#consecutiveFailures += 1;
    const delayMs = attemptDelayMs(this.#consecutiveFailures);
    this.#availableAtEpochMs = nowEpochMs + delayMs;
    return delayMs;
  }

  recordSuccess(): void {
    this.#consecutiveFailures = 0;
    this.#availableAtEpochMs = 0;
  }

  /** Milliseconds still to wait; `0` means the attempt may proceed. */
  remainingMs(nowEpochMs: number): number {
    return Math.max(0, this.#availableAtEpochMs - nowEpochMs);
  }
}

export interface UnlockedState {
  readonly kind: "unlocked";
  readonly root: LocalRootKeyHandle;
  readonly unlockedVia: UnlockMethodV1;
  readonly catalog: LocalCatalogV1;
  readonly catalogStorageId: string;
  readonly transactionRevision: number;
  readonly writerEpoch: number;
}

export type SessionState = { readonly kind: "locked" } | UnlockedState;

const LOCKED: SessionState = { kind: "locked" };

/**
 * Holds the root key handle for exactly as long as the session is unlocked.
 * {@link WorkerSession.lock} zeroizes it through M08's `destroySecretKey`,
 * which is what makes lock and termination real rather than cosmetic.
 */
export class WorkerSession {
  #state: SessionState = LOCKED;
  readonly attempts = new AttemptDelay();

  get state(): SessionState {
    return this.#state;
  }

  get isUnlocked(): boolean {
    return this.#state.kind === "unlocked";
  }

  unlock(state: Omit<UnlockedState, "kind">): UnlockedState {
    this.lock();
    const unlocked: UnlockedState = { kind: "unlocked", ...state };
    this.#state = unlocked;
    return unlocked;
  }

  /** Replaces the unlocked state, keeping the same root handle alive. */
  update(
    change: Partial<Omit<UnlockedState, "kind" | "root" | "unlockedVia">>,
  ): UnlockedState {
    const current = this.#state;
    if (current.kind !== "unlocked") {
      throw new Error("cannot update a locked session");
    }
    const next: UnlockedState = { ...current, ...change };
    this.#state = next;
    return next;
  }

  /** Zeroizes the root and drops every decrypted value. Idempotent. */
  lock(): void {
    const current = this.#state;
    this.#state = LOCKED;
    if (current.kind === "unlocked") {
      destroySecretKey(current.root);
    }
  }
}
