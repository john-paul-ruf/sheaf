/**
 * Passphrase change (CAP-04, SCR-006, MOD-037, FR-23).
 *
 * `form → confirm → rewrapping → done`. The current passphrase is what
 * authorizes the change, and `confirm` is MOD-037: the user is told, before
 * anything is re-wrapped, that this re-wraps keys and loses no data.
 *
 * The machine asserts nothing about data loss — the worker re-wraps the root
 * key and touches no envelope (CA-01, proven by S04/S05). What this machine
 * owns is that the claim is shown before the command runs, and that a refused
 * change leaves the user back on the form with a typed reason.
 */

import { assign, fromPromise, setup } from "xstate";
import type { UnlockedSessionViewV1 } from "../../workers/protocol/messages.js";
import {
  toSecurityError,
  type PassphraseMatch,
  type PassphrasePolicyPort,
  type PassphraseStrength,
  type SecurityError,
  type SecurityServices,
} from "./services.js";

export interface PassphraseChangeInput {
  readonly services: SecurityServices;
  readonly policy: PassphrasePolicyPort;
}

interface PassphraseChangeDraft {
  readonly currentPassphrase: string;
  readonly nextPassphrase: string;
}

export interface PassphraseChangeContext {
  readonly services: SecurityServices;
  readonly policy: PassphrasePolicyPort;
  /** Held from submit until the re-wrap settles; cleared on that transition. */
  readonly draft: PassphraseChangeDraft | undefined;
  readonly session: UnlockedSessionViewV1 | undefined;
  readonly strength: PassphraseStrength | undefined;
  readonly match: PassphraseMatch | undefined;
  readonly error: SecurityError | undefined;
}

export type PassphraseChangeEvent =
  | {
      readonly type: "EVALUATE";
      readonly nextPassphrase: string;
      readonly confirmation: string;
    }
  | {
      readonly type: "SUBMIT";
      readonly currentPassphrase: string;
      readonly nextPassphrase: string;
      readonly confirmation: string;
    }
  | { readonly type: "CONFIRM" }
  | { readonly type: "CANCEL" };

export const passphraseChangeMachine = setup({
  types: {
    context: {} as PassphraseChangeContext,
    events: {} as PassphraseChangeEvent,
    input: {} as PassphraseChangeInput,
  },
  actors: {
    rewrap: fromPromise(
      async ({
        input,
      }: {
        input: { services: SecurityServices; draft: PassphraseChangeDraft };
      }) =>
        input.services.changePassphrase({
          authorization: {
            via: "current-passphrase",
            currentPassphrase: input.draft.currentPassphrase,
          },
          nextPassphrase: input.draft.nextPassphrase,
        }),
    ),
  },
  actions: {
    /** The consuming transition: both entries are gone. */
    clearDraft: assign({ draft: undefined }),
  },
  guards: {
    isAcceptable: ({ context, event }) =>
      event.type === "SUBMIT" &&
      event.currentPassphrase.length > 0 &&
      context.policy.evaluate(event.nextPassphrase) === "sufficient" &&
      event.nextPassphrase === event.confirmation,
  },
}).createMachine({
  id: "passphraseChange",
  initial: "form",
  context: ({ input }) => ({
    services: input.services,
    policy: input.policy,
    draft: undefined,
    session: undefined,
    strength: undefined,
    match: undefined,
    error: undefined,
  }),
  states: {
    form: {
      on: {
        EVALUATE: {
          actions: assign({
            strength: ({ context, event }) =>
              context.policy.evaluate(event.nextPassphrase),
            match: ({ event }) =>
              event.nextPassphrase === event.confirmation
                ? "matched"
                : "mismatch",
          }),
        },
        SUBMIT: [
          {
            guard: "isAcceptable",
            target: "confirm",
            actions: assign({
              draft: ({ event }) => ({
                currentPassphrase: event.currentPassphrase,
                nextPassphrase: event.nextPassphrase,
              }),
              strength: "sufficient",
              match: "matched",
              error: undefined,
            }),
          },
          {
            actions: assign({
              strength: ({ context, event }) =>
                context.policy.evaluate(event.nextPassphrase),
              match: ({ event }) =>
                event.nextPassphrase === event.confirmation
                  ? "matched"
                  : "mismatch",
            }),
          },
        ],
      },
    },
    /** MOD-037. Nothing has been sent yet; cancelling here changes nothing. */
    confirm: {
      on: {
        CONFIRM: { target: "rewrapping" },
        CANCEL: { target: "form", actions: "clearDraft" },
      },
    },
    rewrapping: {
      invoke: {
        src: "rewrap",
        input: ({ context }) => ({
          services: context.services,
          draft: context.draft ?? {
            currentPassphrase: "",
            nextPassphrase: "",
          },
        }),
        onDone: {
          target: "done",
          actions: [
            assign({ session: ({ event }) => event.output.session }),
            "clearDraft",
          ],
        },
        onError: {
          target: "form",
          actions: [
            assign({ error: ({ event }) => toSecurityError(event.error) }),
            "clearDraft",
          ],
        },
      },
    },
    done: { type: "final" },
  },
});
