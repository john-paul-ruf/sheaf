/**
 * Reset (CAP-07, SCR-008/SCR-009, MOD-032/MOD-033, FR-23).
 *
 * Two entries, one gate sequence:
 *
 * - `locked` (SCR-008/MOD-033): the store cannot be read, so nothing is
 *   enumerated. Stage 1 states what is known *and* why the rest cannot be
 *   shown — the inability is the encryption working.
 * - `readable` (SCR-009/MOD-032): the worker enumerates first, and stage 1
 *   reviews that inventory. In F01 the list is always empty, and the surface
 *   must say "none" rather than "unknown" — a truthful enumeration of nothing
 *   is not the same claim as an unreadable store.
 *
 * **Three gates, each a distinct state, none skippable:** `stage 1 (read) →
 * acknowledge → typePhrase`. The destructive command is invoked from
 * `purging`, which is reachable only from `typePhrase` with an exactly matching
 * phrase. `CONFIRM` sent from any earlier state does nothing at all.
 *
 * **The confirm token is opaque.** It is whatever the worker issued with the
 * inventory, passed back byte-for-byte. A `stale-confirmation` refusal means
 * storage changed between enumeration and confirmation: nothing was purged,
 * and the only way forward is a fresh enumeration with a fresh token
 * (database.md check 7).
 */

import { assign, fromPromise, setup } from "xstate";
import type { ResetInventoryViewV1 } from "../../workers/protocol/messages.js";
import {
  toSecurityError,
  type SecurityError,
  type SecurityServices,
} from "./services.js";

/** reset.html: the exact phrase stage 3 requires, typed, not tapped. */
export const RESET_CONFIRMATION_PHRASE = "RESET THIS DEVICE";

export type ResetEntry = "locked" | "readable";

export interface ResetInput {
  readonly services: SecurityServices;
  readonly entry: ResetEntry;
}

export interface ResetContext {
  readonly services: SecurityServices;
  readonly entry: ResetEntry;
  /** Only a readable reset has one; `undefined` is not "empty". */
  readonly inventory: ResetInventoryViewV1 | undefined;
  /** Opaque: issued by the worker, returned unchanged. */
  readonly confirmToken: string | undefined;
  readonly acknowledged: boolean;
  readonly typedPhrase: string;
  readonly error: SecurityError | undefined;
}

export type ResetEvent =
  | { readonly type: "CONTINUE" }
  | { readonly type: "ACKNOWLEDGE"; readonly acknowledged: boolean }
  | { readonly type: "TYPE_PHRASE"; readonly text: string }
  | { readonly type: "CONFIRM" }
  | { readonly type: "RETRY" };

/** Same rule as CTL-029's field: trimmed, but never case-folded. */
export function isResetPhraseMatched(text: string): boolean {
  return text.trim() === RESET_CONFIRMATION_PHRASE;
}

export const resetMachine = setup({
  types: {
    context: {} as ResetContext,
    events: {} as ResetEvent,
    input: {} as ResetInput,
  },
  actors: {
    enumerate: fromPromise(
      async ({ input }: { input: { services: SecurityServices } }) =>
        input.services.resetReadable({}),
    ),
    purge: fromPromise(
      async ({
        input,
      }: {
        input: {
          services: SecurityServices;
          entry: ResetEntry;
          confirmToken: string | undefined;
        };
      }) => {
        if (input.entry === "locked") {
          await input.services.resetLocked();
          return;
        }
        await input.services.resetReadable(
          input.confirmToken === undefined
            ? {}
            : { confirmToken: input.confirmToken },
        );
      },
    ),
  },
  guards: {
    isReadableEntry: ({ context }) => context.entry === "readable",
    hasAcknowledged: ({ context }) => context.acknowledged,
    isPhraseMatched: ({ context }) => isResetPhraseMatched(context.typedPhrase),
  },
}).createMachine({
  id: "reset",
  initial: "entering",
  context: ({ input }) => ({
    services: input.services,
    entry: input.entry,
    inventory: undefined,
    confirmToken: undefined,
    acknowledged: false,
    typedPhrase: "",
    error: undefined,
  }),
  states: {
    entering: {
      always: [
        { guard: "isReadableEntry", target: "loadingInventory" },
        { target: "readLoss" },
      ],
    },
    /** Enumeration is a read: it purges nothing and issues the token. */
    loadingInventory: {
      invoke: {
        src: "enumerate",
        input: ({ context }) => ({ services: context.services }),
        onDone: [
          {
            guard: ({ event }) => event.output.phase === "inventory",
            target: "reviewInventory",
            actions: assign(({ event }) =>
              event.output.phase === "inventory"
                ? {
                    inventory: event.output.inventory,
                    confirmToken: event.output.confirmToken,
                    error: undefined,
                  }
                : {},
            ),
          },
          {
            // A purge answered an enumeration: refuse rather than guess.
            target: "failed",
            actions: assign({ error: { kind: "internal" } }),
          },
        ],
        onError: {
          target: "failed",
          actions: assign({
            error: ({ event }) => toSecurityError(event.error),
          }),
        },
      },
    },
    /** Gate 1, locked entry: generic loss, and why it cannot be itemised. */
    readLoss: {
      on: { CONTINUE: { target: "acknowledge" } },
    },
    /** Gate 1, readable entry: the enumerated inventory. */
    reviewInventory: {
      on: { CONTINUE: { target: "acknowledge" } },
    },
    /** Gate 2. */
    acknowledge: {
      on: {
        ACKNOWLEDGE: {
          actions: assign({
            acknowledged: ({ event }) => event.acknowledged,
          }),
        },
        CONTINUE: { guard: "hasAcknowledged", target: "typePhrase" },
      },
    },
    /** Gate 3. The only state from which the destructive call is reachable. */
    typePhrase: {
      on: {
        TYPE_PHRASE: {
          actions: assign({ typedPhrase: ({ event }) => event.text }),
        },
        CONFIRM: { guard: "isPhraseMatched", target: "purging" },
      },
    },
    purging: {
      invoke: {
        src: "purge",
        input: ({ context }) => ({
          services: context.services,
          entry: context.entry,
          confirmToken: context.confirmToken,
        }),
        onDone: { target: "purged" },
        onError: [
          {
            guard: ({ event }) =>
              toSecurityError(event.error).kind === "stale-confirmation",
            target: "staleConfirmation",
            actions: assign({
              error: ({ event }) => toSecurityError(event.error),
              confirmToken: undefined,
            }),
          },
          {
            target: "failed",
            actions: assign({
              error: ({ event }) => toSecurityError(event.error),
            }),
          },
        ],
      },
    },
    /**
     * Recoverable, and nothing was destroyed: storage moved under the token.
     * Recovery is a fresh enumeration, which re-opens all three gates.
     */
    staleConfirmation: {
      on: {
        RETRY: {
          target: "loadingInventory",
          actions: assign({ acknowledged: false, typedPhrase: "" }),
        },
      },
    },
    failed: {
      on: {
        RETRY: {
          target: "entering",
          actions: assign({
            acknowledged: false,
            typedPhrase: "",
            error: undefined,
            confirmToken: undefined,
          }),
        },
      },
    },
    purged: { type: "final" },
  },
});
