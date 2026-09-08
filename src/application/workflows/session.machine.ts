/**
 * Unlocked-session lifetime (CAP-03, SCR-005, FR-22, decision D13/AD-7).
 *
 * `active → locking → locked`, where `active` runs two independent regions:
 * the settings writer and the idle timer. They are parallel on purpose — a
 * settings write must not disturb a countdown that is already running, and a
 * *refused* write must leave that countdown exactly as it was.
 *
 * **Persist, then arm.** `SET_IDLE_TIMEOUT` does not touch the timer. It
 * enters `savingIdleTimeout`, sends `updateSettings`, and adopts the value
 * **from the worker's response** — never the optimistic local one. Only then
 * does the timer region re-decide whether to arm. A rejected write changes
 * neither the stored value nor the running timer, and a surface that renders
 * `idleTimeoutMinutes` therefore never shows a setting that did not persist.
 * `revision-conflict` is a retryable refusal, not a crash
 * ({@link isRetryableSettingsError}).
 *
 * **Locking is one-way.** `locked` is final: the worker is terminated by the
 * bootstrap runtime and the keys are gone with it, so there is no transition
 * back. A failed `lock` command still locks — termination is what makes it
 * real (M53).
 */

import { assign, fromCallback, fromPromise, setup } from "xstate";
import type { LockReason } from "../../bootstrap/app-bootstrap.js";
import type {
  IdleTimeoutMinutesV1,
  UnlockedSessionViewV1,
} from "../../workers/protocol/messages.js";
import {
  toSecurityError,
  type SecurityError,
  type SecurityServices,
} from "./services.js";

export type { LockReason };

/** The approved choices, in the order SCR-005's select shows them. */
export const IDLE_TIMEOUT_OPTIONS = Object.freeze([
  0, 5, 15, 60,
] as const satisfies readonly IdleTimeoutMinutesV1[]);

export const MINUTE_MS = 60_000;

/** A conflicted revision is another writer, not a fault: offer the retry. */
export function isRetryableSettingsError(error: SecurityError): boolean {
  return error.kind === "revision-conflict";
}

export interface SessionInput {
  readonly services: SecurityServices;
  /** The settings the unlock response carried; the machine adopts no other. */
  readonly session: UnlockedSessionViewV1;
}

export interface SessionContext {
  readonly services: SecurityServices;
  readonly session: UnlockedSessionViewV1;
  /** The persisted value. Only a worker response ever changes it. */
  readonly idleTimeoutMinutes: IdleTimeoutMinutesV1;
  readonly settingsError: SecurityError | undefined;
  readonly lockReason: LockReason | undefined;
}

export type SessionEvent =
  | {
      readonly type: "SET_IDLE_TIMEOUT";
      readonly minutes: IdleTimeoutMinutesV1;
    }
  | { readonly type: "DISMISS_SETTINGS_ERROR" }
  | { readonly type: "ACTIVITY" }
  | { readonly type: "IDLE_ELAPSED" }
  | { readonly type: "LOCK_NOW" }
  | { readonly type: "PAGEHIDE" };

export const sessionMachine = setup({
  types: {
    context: {} as SessionContext,
    events: {} as SessionEvent,
    input: {} as SessionInput,
  },
  actors: {
    persistIdleTimeout: fromPromise(
      async ({
        input,
      }: {
        input: { services: SecurityServices; minutes: IdleTimeoutMinutesV1 };
      }) => input.services.updateSettings({ idleTimeoutMinutes: input.minutes }),
    ),
    runLock: fromPromise(
      async ({ input }: { input: { services: SecurityServices } }) =>
        input.services.lock(),
    ),
    /** Armed only with a duration the worker confirmed it stored. */
    idleCountdown: fromCallback<SessionEvent, { minutes: number }>(
      ({ input, sendBack }) => {
        const timer = setTimeout(() => {
          sendBack({ type: "IDLE_ELAPSED" });
        }, input.minutes * MINUTE_MS);
        return () => {
          clearTimeout(timer);
        };
      },
    ),
  },
  guards: {
    isTimeoutEnabled: ({ context }) => context.idleTimeoutMinutes > 0,
  },
}).createMachine({
  id: "session",
  initial: "active",
  context: ({ input }) => ({
    services: input.services,
    session: input.session,
    idleTimeoutMinutes: input.session.settings.idleTimeoutMinutes,
    settingsError: undefined,
    lockReason: undefined,
  }),
  states: {
    active: {
      type: "parallel",
      states: {
        settings: {
          initial: "idle",
          states: {
            idle: {
              on: {
                SET_IDLE_TIMEOUT: { target: "savingIdleTimeout" },
                DISMISS_SETTINGS_ERROR: {
                  actions: assign({ settingsError: undefined }),
                },
              },
            },
            savingIdleTimeout: {
              invoke: {
                src: "persistIdleTimeout",
                input: ({ context, event }) => ({
                  services: context.services,
                  minutes:
                    event.type === "SET_IDLE_TIMEOUT"
                      ? event.minutes
                      : context.idleTimeoutMinutes,
                }),
                onDone: {
                  // Two regions: settle the writer and re-decide the timer.
                  target: ["#session.active.settings.idle", "#session.active.idleTimer.deciding"],
                  actions: assign({
                    idleTimeoutMinutes: ({ event }) =>
                      event.output.settings.idleTimeoutMinutes,
                    session: ({ event }) => event.output.session,
                    settingsError: undefined,
                  }),
                },
                onError: {
                  // The timer region is deliberately untouched here.
                  target: "idle",
                  actions: assign({
                    settingsError: ({ event }) => toSecurityError(event.error),
                  }),
                },
              },
            },
          },
        },
        idleTimer: {
          initial: "deciding",
          states: {
            deciding: {
              always: [
                { guard: "isTimeoutEnabled", target: "armed" },
                { target: "disarmed" },
              ],
            },
            /** Off is off: activity does not start a timer that is not set. */
            disarmed: {},
            armed: {
              invoke: {
                src: "idleCountdown",
                input: ({ context }) => ({
                  minutes: context.idleTimeoutMinutes,
                }),
              },
              on: {
                ACTIVITY: { target: "armed", reenter: true },
              },
            },
          },
        },
      },
      on: {
        LOCK_NOW: {
          target: "locking",
          actions: assign({ lockReason: "user" }),
        },
        PAGEHIDE: {
          target: "locking",
          actions: assign({ lockReason: "pagehide" }),
        },
        IDLE_ELAPSED: {
          target: "locking",
          actions: assign({ lockReason: "idle-timeout" }),
        },
      },
    },
    locking: {
      invoke: {
        src: "runLock",
        input: ({ context }) => ({ services: context.services }),
        // An unanswered lock is still a lock: termination is the real one.
        onDone: { target: "locked" },
        onError: { target: "locked" },
      },
    },
    locked: { type: "final" },
  },
});
