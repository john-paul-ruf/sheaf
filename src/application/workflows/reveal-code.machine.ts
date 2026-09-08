/**
 * Re-view the local recovery code (CAP-06, SCR-007, MOD-022, FR-23).
 *
 * `request → revealing → revealed → dismissed`. The current passphrase is
 * required every time: MOD-022 is a gate, and an unlocked session is not by
 * itself authority to re-display the code.
 *
 * "Once per reveal" is literal. The code is in context only while `revealed`
 * is active, and `dismissed` is final — a second look needs a second actor and
 * therefore a second passphrase entry.
 */

import { assign, fromPromise, setup } from "xstate";
import {
  toSecurityError,
  type SecurityError,
  type SecurityServices,
} from "./services.js";

export interface RevealCodeInput {
  readonly services: SecurityServices;
}

export interface RevealCodeContext {
  readonly services: SecurityServices;
  /** In flight only: set on submit, cleared when the reveal settles. */
  readonly draft: { readonly currentPassphrase: string } | undefined;
  /** Present only while `revealed` is active. */
  readonly recoveryCode: string | undefined;
  readonly error: SecurityError | undefined;
}

export type RevealCodeEvent =
  | { readonly type: "SUBMIT"; readonly currentPassphrase: string }
  | { readonly type: "DISMISS" };

export const revealCodeMachine = setup({
  types: {
    context: {} as RevealCodeContext,
    events: {} as RevealCodeEvent,
    input: {} as RevealCodeInput,
  },
  actors: {
    reveal: fromPromise(
      async ({
        input,
      }: {
        input: { services: SecurityServices; currentPassphrase: string };
      }) =>
        input.services.revealRecoveryCode({
          currentPassphrase: input.currentPassphrase,
        }),
    ),
  },
  actions: {
    clearDraft: assign({ draft: undefined }),
  },
}).createMachine({
  id: "revealCode",
  initial: "request",
  context: ({ input }) => ({
    services: input.services,
    draft: undefined,
    recoveryCode: undefined,
    error: undefined,
  }),
  states: {
    request: {
      on: {
        SUBMIT: {
          target: "revealing",
          actions: assign({
            draft: ({ event }) => ({
              currentPassphrase: event.currentPassphrase,
            }),
            error: undefined,
          }),
        },
      },
    },
    revealing: {
      invoke: {
        src: "reveal",
        input: ({ context }) => ({
          services: context.services,
          currentPassphrase: context.draft?.currentPassphrase ?? "",
        }),
        onDone: {
          target: "revealed",
          actions: [
            assign({ recoveryCode: ({ event }) => event.output.recoveryCode }),
            "clearDraft",
          ],
        },
        onError: {
          target: "request",
          actions: [
            assign({ error: ({ event }) => toSecurityError(event.error) }),
            "clearDraft",
          ],
        },
      },
    },
    revealed: {
      on: { DISMISS: { target: "dismissed" } },
    },
    dismissed: {
      type: "final",
      entry: assign({ recoveryCode: undefined }),
    },
  },
});
