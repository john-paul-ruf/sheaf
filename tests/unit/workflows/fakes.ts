/**
 * Test doubles for the machine services. Not a test file — the vitest include
 * globs are extension-qualified, so this is never collected as a suite.
 *
 * The fake records every call, which is how the suites prove a *negative*: a
 * locally-rejected recovery code must never reach the worker, and a refused
 * settings write must never arm a timer.
 */

import { DataWorkerRequestError } from "../../../src/workers/protocol/client.js";
import type {
  DataWorkerErrorKindV1,
  IdleTimeoutMinutesV1,
  ResetInventoryViewV1,
  UnlockedSessionViewV1,
} from "../../../src/workers/protocol/messages.js";
import type { SecurityServices } from "../../../src/application/workflows/services.js";
import type { ClockPort } from "../../../src/application/ports/clock.js";

export const SETUP_RECOVERY_CODE =
  "7G4KN8R-D2QPMV6-TX3H9WY-B5C0EFJ-K1MNPQR-STVWXYZ-2468ACD-GHJ57TQ";

export function unlockedSession(
  overrides: Partial<UnlockedSessionViewV1> = {},
): UnlockedSessionViewV1 {
  return {
    state: "unlocked",
    unlockedVia: "passphrase",
    settings: { idleTimeoutMinutes: 0 },
    catalogRevision: 1,
    transactionRevision: 1,
    appCount: 0,
    homeCount: 0,
    ...overrides,
  };
}

export function emptyInventory(): ResetInventoryViewV1 {
  return { apps: [], appCount: 0, homeCount: 0 };
}

/** A refusal shaped exactly like the worker's, so machines see production. */
export function workerError(
  kind: DataWorkerErrorKindV1,
  retryAfterMs?: number,
): DataWorkerRequestError {
  return new DataWorkerRequestError(
    retryAfterMs === undefined ? { kind } : { kind, retryAfterMs },
  );
}

/** Wiring helpers: a service that answers, and one that refuses. */
export function resolves<T>(value: T): () => Promise<T> {
  return () => Promise.resolve(value);
}

export function rejects(error: DataWorkerRequestError): () => Promise<never> {
  return () => Promise.reject(error);
}

export interface ServiceCall {
  readonly name: keyof SecurityServices;
  readonly input: unknown;
}

export interface FakeServices {
  readonly services: SecurityServices;
  readonly calls: ServiceCall[];
  /** Names only, for order assertions that do not care about arguments. */
  names(): string[];
}

type ServiceOverrides = {
  [K in keyof SecurityServices]?: SecurityServices[K];
};

const notWired = (name: string) => (): never => {
  throw new Error(`fake service '${name}' was called but not wired`);
};

/**
 * Every service is unwired by default and throws if called: a machine that
 * reaches the worker when it should not fails loudly rather than quietly
 * resolving.
 */
export function fakeServices(overrides: ServiceOverrides = {}): FakeServices {
  const calls: ServiceCall[] = [];

  const wrap = <K extends keyof SecurityServices>(
    name: K,
  ): SecurityServices[K] => {
    const implementation = overrides[name] ?? notWired(name);
    return ((input: unknown) => {
      calls.push({ name, input });
      return (implementation as (value: unknown) => unknown)(input);
    }) as SecurityServices[K];
  };

  return {
    services: {
      setup: wrap("setup"),
      unlock: wrap("unlock"),
      unlockWithRecoveryCode: wrap("unlockWithRecoveryCode"),
      changePassphrase: wrap("changePassphrase"),
      revealRecoveryCode: wrap("revealRecoveryCode"),
      lock: wrap("lock"),
      updateSettings: wrap("updateSettings"),
      resetLocked: wrap("resetLocked"),
      resetReadable: wrap("resetReadable"),
      getStatus: wrap("getStatus"),
    },
    calls,
    names(): string[] {
      return calls.map((call) => call.name);
    },
  };
}

/** A clock the test advances by hand; nothing here reads wall time. */
export function fakeClock(start = 1_700_000_000_000): ClockPort & {
  advance(ms: number): void;
} {
  let now = start;
  return {
    nowEpochMs: () => now,
    advance(ms: number): void {
      now += ms;
    },
  };
}

export const IDLE_TIMEOUT_CHOICES: readonly IdleTimeoutMinutesV1[] = [
  0, 5, 15, 60,
];
