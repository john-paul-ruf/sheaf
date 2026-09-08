/**
 * Cold unlock (CAP-02, SCR-003, FR-22).
 *
 * `locked → deriving → unlocked | failed`. `failed` splits on one fact only:
 * whether the worker sent a `retryAfterMs`. If it did, a countdown runs and
 * retry is refused until it reaches zero; if it did not, retry is available at
 * once.
 *
 * **The schedule is not this machine's.** It never counts attempts and never
 * derives a delay — the worker decides, and this renders the number it sent
 * (CA-05/AD-5: five free failures, the first delay at the sixth). The counter
 * lives in worker memory and dies with the worker (D4), which is why the
 * countdown is driven by an injected clock and not by anything durable.
 *
 * **Route order is a requirement, not a layout choice.** FR-22 requires the
 * recovery-code route to be offered *before* reset; {@link
 * UNLOCK_ROUTES_IN_ORDER} is that ordering as data, so a surface cannot
 * reorder it by accident.
 */

import { assign, fromCallback, fromPromise, setup } from "xstate";
import type { ClockPort } from "../ports/clock.js";
import type { UnlockedSessionViewV1 } from "../../workers/protocol/messages.js";
import {
  toSecurityError,
  type SecurityError,
  type SecurityServices,
} from "./services.js";

/**
 * FR-22: the lossless route is offered first. A user with a recovery code must
 * meet it before they meet the destructive path.
 */
export const UNLOCK_ROUTES_IN_ORDER = Object.freeze([
  "recovery-code",
  "reset",
] as const);

export type UnlockRoute = (typeof UNLOCK_ROUTES_IN_ORDER)[number];

/** How often the countdown re-reads the clock. One second, as displayed. */
export const COUNTDOWN_TICK_MS = 1_000;

export interface UnlockInput {
  readonly services: SecurityServices;
  readonly clock: ClockPort;
  readonly tickMs?: number;
}

export interface UnlockContext {
  readonly services: SecurityServices;
  readonly clock: ClockPort;
  readonly tickMs: number;
  /** In flight only: set on submit, cleared when the derive settles. */
  readonly draft: { readonly passphrase: string } | undefined;
  /** Exactly what the worker sent. Never recomputed, never accumulated. */
  readonly retryAfterMs: number;
  readonly remainingMs: number;
  readonly session: UnlockedSessionViewV1 | undefined;
  readonly error: SecurityError | undefined;
}

export type UnlockEvent =
  | { readonly type: "SUBMIT"; readonly passphrase: string }
  | { readonly type: "RETRY" }
  | { readonly type: "TICK"; readonly remainingMs: number }
  | { readonly type: "DELAY_ELAPSED" };

export const unlockMachine = setup({
  types: {
    context: {} as UnlockContext,
    events: {} as UnlockEvent,
    input: {} as UnlockInput,
  },
  actors: {
    runUnlock: fromPromise(
      async ({
        input,
      }: {
        input: { services: SecurityServices; passphrase: string };
      }) => input.services.unlock({ passphrase: input.passphrase }),
    ),
    /**
     * Renders the wait the worker imposed. The deadline is computed once from
     * the injected clock; each tick reports what is left, so a suspended tab
     * resumes with the truth rather than with an accumulated count.
     */
    countdown: fromCallback<
      UnlockEvent,
      { clock: ClockPort; retryAfterMs: number; tickMs: number }
    >(({ input, sendBack }) => {
      const deadline = input.clock.nowEpochMs() + input.retryAfterMs;
      const timer = setInterval(() => {
        const remainingMs = Math.max(0, deadline - input.clock.nowEpochMs());
        sendBack({ type: "TICK", remainingMs });
        if (remainingMs === 0) {
          sendBack({ type: "DELAY_ELAPSED" });
        }
      }, input.tickMs);
      return () => {
        clearInterval(timer);
      };
    }),
  },
  actions: {
    holdDraft: assign({
      draft: ({ event }) =>
        event.type === "SUBMIT"
          ? { passphrase: event.passphrase }
          : undefined,
      error: undefined,
    }),
    /** The consuming transition: the derive is over, the entry is gone. */
    clearDraft: assign({ draft: undefined }),
  },
  guards: {
    isDelayed: ({ context }) => context.retryAfterMs > 0,
  },
}).createMachine({
  id: "unlock",
  initial: "locked",
  context: ({ input }) => ({
    services: input.services,
    clock: input.clock,
    tickMs: input.tickMs ?? COUNTDOWN_TICK_MS,
    draft: undefined,
    retryAfterMs: 0,
    remainingMs: 0,
    session: undefined,
    error: undefined,
  }),
  states: {
    locked: {
      on: {
        SUBMIT: { target: "deriving", actions: "holdDraft" },
      },
    },
    deriving: {
      invoke: {
        src: "runUnlock",
        input: ({ context }) => ({
          services: context.services,
          passphrase: context.draft?.passphrase ?? "",
        }),
        onDone: {
          target: "unlocked",
          actions: [
            assign({ session: ({ event }) => event.output.session }),
            "clearDraft",
          ],
        },
        onError: {
          target: "failed",
          actions: [
            assign(({ event }) => {
              const error = toSecurityError(event.error);
              const retryAfterMs = error.retryAfterMs ?? 0;
              return { error, retryAfterMs, remainingMs: retryAfterMs };
            }),
            "clearDraft",
          ],
        },
      },
    },
    failed: {
      initial: "deciding",
      states: {
        deciding: {
          always: [
            { guard: "isDelayed", target: "waiting" },
            { target: "ready" },
          ],
        },
        /** Retry is refused here; the countdown is the only way out. */
        waiting: {
          invoke: {
            src: "countdown",
            input: ({ context }) => ({
              clock: context.clock,
              retryAfterMs: context.retryAfterMs,
              tickMs: context.tickMs,
            }),
          },
          on: {
            TICK: {
              actions: assign({
                remainingMs: ({ event }) => event.remainingMs,
              }),
            },
            DELAY_ELAPSED: {
              target: "ready",
              actions: assign({ retryAfterMs: 0, remainingMs: 0 }),
            },
          },
        },
        ready: {
          on: {
            RETRY: {
              target: "#unlock.locked",
              actions: assign({ error: undefined }),
            },
            SUBMIT: { target: "#unlock.deriving", actions: "holdDraft" },
          },
        },
      },
    },
    unlocked: { type: "final" },
  },
});
