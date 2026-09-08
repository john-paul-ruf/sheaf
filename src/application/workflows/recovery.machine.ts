/**
 * Local recovery (CAP-05, SCR-004, FR-23).
 *
 * `enterCode → checkingFormat → unlocking → definePassphrase → installing →
 * done`. Two properties matter more than the happy path:
 *
 * 1. **A misspelled code never reaches the worker.** The spelling is checked
 *    locally first (M08's parse, injected — workflows may not import crypto),
 *    so a typing mistake costs no derive and no attempt-delay step.
 * 2. **Recovery installs a replacement passphrase.** FR-23 does not offer
 *    "unlock and carry on": there is no transition from `unlocking` to `done`,
 *    so a session opened with the code cannot be used until a new passphrase
 *    is committed through `changePassphrase{via:'recovery'}`.
 */

import { assign, fromPromise, setup } from "xstate";
import type { UnlockedSessionViewV1 } from "../../workers/protocol/messages.js";
import {
  toSecurityError,
  type PassphraseMatch,
  type PassphrasePolicyPort,
  type PassphraseStrength,
  type RecoveryCodeFormatPort,
  type SecurityError,
  type SecurityServices,
} from "./services.js";

export interface RecoveryInput {
  readonly services: SecurityServices;
  readonly policy: PassphrasePolicyPort;
  readonly codeFormat: RecoveryCodeFormatPort;
}

export interface RecoveryContext {
  readonly services: SecurityServices;
  readonly policy: PassphrasePolicyPort;
  readonly codeFormat: RecoveryCodeFormatPort;
  /** In flight only: the code, then the replacement passphrase. */
  readonly draft:
    | { readonly recoveryCode: string }
    | { readonly passphrase: string }
    | undefined;
  /** True when the entry is not a well-formed code, before any derive. */
  readonly codeMisspelled: boolean;
  readonly session: UnlockedSessionViewV1 | undefined;
  readonly strength: PassphraseStrength | undefined;
  readonly match: PassphraseMatch | undefined;
  readonly error: SecurityError | undefined;
}

export type RecoveryEvent =
  | { readonly type: "SUBMIT_CODE"; readonly recoveryCode: string }
  | {
      readonly type: "SUBMIT_PASSPHRASE";
      readonly passphrase: string;
      readonly confirmation: string;
    }
  | { readonly type: "RETRY" };

export const recoveryMachine = setup({
  types: {
    context: {} as RecoveryContext,
    events: {} as RecoveryEvent,
    input: {} as RecoveryInput,
  },
  actors: {
    checkFormat: fromPromise(
      async ({
        input,
      }: {
        input: { codeFormat: RecoveryCodeFormatPort; recoveryCode: string };
      }) => input.codeFormat.isWellFormed(input.recoveryCode),
    ),
    runRecoveryUnlock: fromPromise(
      async ({
        input,
      }: {
        input: { services: SecurityServices; recoveryCode: string };
      }) =>
        input.services.unlockWithRecoveryCode({
          recoveryCode: input.recoveryCode,
        }),
    ),
    installPassphrase: fromPromise(
      async ({
        input,
      }: {
        input: { services: SecurityServices; passphrase: string };
      }) =>
        input.services.changePassphrase({
          authorization: { via: "recovery" },
          nextPassphrase: input.passphrase,
        }),
    ),
  },
  actions: {
    /** The consuming transition: whichever secret was in flight is gone. */
    clearDraft: assign({ draft: undefined }),
  },
  guards: {
    isAcceptablePassphrase: ({ context, event }) =>
      event.type === "SUBMIT_PASSPHRASE" &&
      context.policy.evaluate(event.passphrase) === "sufficient" &&
      event.passphrase === event.confirmation,
  },
}).createMachine({
  id: "recovery",
  initial: "enterCode",
  context: ({ input }) => ({
    services: input.services,
    policy: input.policy,
    codeFormat: input.codeFormat,
    draft: undefined,
    codeMisspelled: false,
    session: undefined,
    strength: undefined,
    match: undefined,
    error: undefined,
  }),
  states: {
    enterCode: {
      on: {
        SUBMIT_CODE: {
          target: "checkingFormat",
          actions: assign({
            draft: ({ event }) => ({ recoveryCode: event.recoveryCode }),
            codeMisspelled: false,
            error: undefined,
          }),
        },
      },
    },
    /** Local, pre-KDF. A refusal here calls nothing and costs nothing. */
    checkingFormat: {
      invoke: {
        src: "checkFormat",
        input: ({ context }) => ({
          codeFormat: context.codeFormat,
          recoveryCode:
            context.draft !== undefined && "recoveryCode" in context.draft
              ? context.draft.recoveryCode
              : "",
        }),
        onDone: [
          { guard: ({ event }) => event.output, target: "unlocking" },
          {
            target: "enterCode",
            actions: [assign({ codeMisspelled: true }), "clearDraft"],
          },
        ],
        onError: {
          target: "enterCode",
          actions: [assign({ codeMisspelled: true }), "clearDraft"],
        },
      },
    },
    unlocking: {
      invoke: {
        src: "runRecoveryUnlock",
        input: ({ context }) => ({
          services: context.services,
          recoveryCode:
            context.draft !== undefined && "recoveryCode" in context.draft
              ? context.draft.recoveryCode
              : "",
        }),
        onDone: {
          target: "definePassphrase",
          actions: [
            assign({ session: ({ event }) => event.output.session }),
            "clearDraft",
          ],
        },
        onError: {
          target: "enterCode",
          actions: [
            assign({ error: ({ event }) => toSecurityError(event.error) }),
            "clearDraft",
          ],
        },
      },
    },
    /** FR-23: the only way out of a recovered session is a new passphrase. */
    definePassphrase: {
      on: {
        SUBMIT_PASSPHRASE: [
          {
            guard: "isAcceptablePassphrase",
            target: "installing",
            actions: assign({
              draft: ({ event }) => ({ passphrase: event.passphrase }),
              strength: "sufficient",
              match: "matched",
              error: undefined,
            }),
          },
          {
            actions: assign({
              strength: ({ context, event }) =>
                context.policy.evaluate(event.passphrase),
              match: ({ event }) =>
                event.passphrase === event.confirmation
                  ? "matched"
                  : "mismatch",
            }),
          },
        ],
      },
    },
    installing: {
      invoke: {
        src: "installPassphrase",
        input: ({ context }) => ({
          services: context.services,
          passphrase:
            context.draft !== undefined && "passphrase" in context.draft
              ? context.draft.passphrase
              : "",
        }),
        onDone: {
          target: "done",
          actions: [
            assign({ session: ({ event }) => event.output.session }),
            "clearDraft",
          ],
        },
        onError: {
          target: "definePassphrase",
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
