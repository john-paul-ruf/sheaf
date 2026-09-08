/**
 * Initial setup (CAP-01, SCR-002, FR-22/FR-23).
 *
 * `welcome → definePassphrase → deriving → codeIssued → codeConfirm →
 * unlocked`. The recovery code is issued once, and the machine will not reach
 * `unlocked` until the user has explicitly said they saved it — setup.html's
 * "I saved the local recovery code" is a gate, not a courtesy.
 *
 * **Atomicity is the worker's, verified by contract.** Abandoning before
 * `deriving` completes leaves nothing behind because nothing was written: the
 * single `setup` command creates the bootstrap row and the catalog in one
 * transaction (CA-01). This machine therefore has no compensating action and
 * must never grow one — a rollback here would be a second, non-atomic writer.
 *
 * **Secret hygiene.** The passphrase lives in `draft` only while the derive it
 * feeds is in flight, and is cleared on the transition that consumes it. The
 * recovery code lives in context only while a display state is active. After
 * `unlocked`, the snapshot holds neither.
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

export interface SetupInput {
  readonly services: SecurityServices;
  readonly policy: PassphrasePolicyPort;
}

interface SetupDraft {
  readonly passphrase: string;
}

export interface SetupContext {
  readonly services: SecurityServices;
  readonly policy: PassphrasePolicyPort;
  /** In flight only: set on submit, cleared when the derive settles. */
  readonly draft: SetupDraft | undefined;
  /** Held only while a display state is active; cleared entering `unlocked`. */
  readonly recoveryCode: string | undefined;
  readonly session: UnlockedSessionViewV1 | undefined;
  readonly strength: PassphraseStrength | undefined;
  readonly match: PassphraseMatch | undefined;
  readonly acknowledgedSaved: boolean;
  readonly error: SecurityError | undefined;
}

export type SetupEvent =
  | { readonly type: "BEGIN" }
  /** Live verdicts while typing. The entry itself is never retained. */
  | {
      readonly type: "EVALUATE";
      readonly passphrase: string;
      readonly confirmation: string;
    }
  | {
      readonly type: "SUBMIT";
      readonly passphrase: string;
      readonly confirmation: string;
    }
  | { readonly type: "CONTINUE" }
  | { readonly type: "ACKNOWLEDGE_SAVED"; readonly acknowledged: boolean }
  | { readonly type: "FINISH" }
  | { readonly type: "RETRY" };

function verdicts(
  policy: PassphrasePolicyPort,
  passphrase: string,
  confirmation: string,
): { strength: PassphraseStrength; match: PassphraseMatch } {
  return {
    strength: policy.evaluate(passphrase),
    match: passphrase === confirmation ? "matched" : "mismatch",
  };
}

export const setupMachine = setup({
  types: {
    context: {} as SetupContext,
    events: {} as SetupEvent,
    input: {} as SetupInput,
  },
  actors: {
    runSetup: fromPromise(
      async ({
        input,
      }: {
        input: { services: SecurityServices; passphrase: string };
      }) => input.services.setup({ passphrase: input.passphrase }),
    ),
  },
  actions: {
    recordVerdicts: assign(({ context, event }) => {
      if (event.type !== "EVALUATE" && event.type !== "SUBMIT") {
        return {};
      }
      return verdicts(context.policy, event.passphrase, event.confirmation);
    }),
    /** The consuming transition: the derive is over, the entry is gone. */
    clearDraft: assign({ draft: undefined }),
  },
  guards: {
    isAcceptable: ({ context, event }) => {
      if (event.type !== "SUBMIT") {
        return false;
      }
      const verdict = verdicts(
        context.policy,
        event.passphrase,
        event.confirmation,
      );
      return verdict.strength === "sufficient" && verdict.match === "matched";
    },
    hasAcknowledgedSaved: ({ context }) => context.acknowledgedSaved,
  },
}).createMachine({
  id: "setup",
  initial: "welcome",
  context: ({ input }) => ({
    services: input.services,
    policy: input.policy,
    draft: undefined,
    recoveryCode: undefined,
    session: undefined,
    strength: undefined,
    match: undefined,
    acknowledgedSaved: false,
    error: undefined,
  }),
  states: {
    welcome: {
      on: { BEGIN: { target: "definePassphrase" } },
    },
    definePassphrase: {
      on: {
        EVALUATE: { actions: "recordVerdicts" },
        SUBMIT: [
          {
            guard: "isAcceptable",
            target: "deriving",
            actions: [
              "recordVerdicts",
              assign({
                draft: ({ event }) =>
                  event.type === "SUBMIT"
                    ? { passphrase: event.passphrase }
                    : undefined,
                error: undefined,
              }),
            ],
          },
          { actions: "recordVerdicts" },
        ],
      },
    },
    deriving: {
      invoke: {
        src: "runSetup",
        input: ({ context }) => ({
          services: context.services,
          passphrase: context.draft?.passphrase ?? "",
        }),
        onDone: {
          target: "codeIssued",
          actions: [
            assign({
              recoveryCode: ({ event }) => event.output.recoveryCode,
              session: ({ event }) => event.output.session,
            }),
            "clearDraft",
          ],
        },
        onError: {
          target: "failed",
          actions: [
            assign({ error: ({ event }) => toSecurityError(event.error) }),
            "clearDraft",
          ],
        },
      },
    },
    codeIssued: {
      on: { CONTINUE: { target: "codeConfirm" } },
    },
    codeConfirm: {
      on: {
        ACKNOWLEDGE_SAVED: {
          actions: assign({
            acknowledgedSaved: ({ event }) =>
              event.type === "ACKNOWLEDGE_SAVED" ? event.acknowledged : false,
          }),
        },
        FINISH: { guard: "hasAcknowledgedSaved", target: "unlocked" },
      },
    },
    failed: {
      on: {
        RETRY: {
          target: "definePassphrase",
          actions: assign({ error: undefined }),
        },
      },
    },
    unlocked: {
      type: "final",
      entry: assign({ recoveryCode: undefined }),
    },
  },
});
