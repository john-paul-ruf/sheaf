/**
 * The import lifecycle (CAP-09–CAP-13; SCR-016–023, MOD-004–008; FR-1/2/3/4).
 *
 * Import is the one long-running flow F02 adds, and the architecture calls it
 * an explicit resumable machine: a file becomes an app across two workers, a
 * `MessageChannel`, a durable stage, and one human review, and every one of
 * those steps can end the run truthfully.
 *
 * **Detection and sizing are one round trip.** The parser sniffs *and* sizes
 * before it says anything (`import.worker.ts`), so `detecting` covers both of
 * its `sniffing` and `sizing` phases and the answer is either a refusal — an
 * over-budget refusal included — or a pre-flight report. There is no state
 * between them for a separate size check to live in: by the time the target
 * screen can be drawn, the size is already known. `fits` is therefore the
 * user's confirmation of a measurement, not a second measurement (D20).
 *
 * **Every terminal state carries its receipt.** `cancelled` and `failed` do not
 * merely stop: they run the stage's four-step cleanup and wait for the
 * `ImportCleanupReceiptViewV1` before they claim anything (MOD-007, CA-10). A
 * cleanup that could not be confirmed becomes `cleanup-unconfirmed` rather than
 * a cancelled state that asserts nothing remains — the promise the surface
 * renders has to be one the machine actually holds.
 *
 * **Every mutating stage call is gated on `getImportStage` first.** A stage can
 * vanish between review and "Create app" — an ordinary reload mid-import plus
 * the unlock sweep is enough — and the data worker answers an absent stage with
 * the `integrity` error kind, whose copy ("the local store did not pass its
 * integrity check") would be false. The gate turns that into `stage-missing`,
 * which is what actually happened: the import did not finish and nothing
 * partial remains (Roshi D-04).
 *
 * **The file is not retained.** A `Blob` is the source bytes; the machine keeps
 * its name and its measurements and nothing else, so a snapshot holds no file
 * content and no cell value. "Retry same file" is the page re-sending
 * `CHOOSE_FILE` with the handle its picker still owns.
 */

import { assign, fromCallback, fromPromise, setup } from "xstate";
import type { ImportWorkerEventV1 } from "../../workers/protocol/import-messages.js";
import type {
  ImportCleanupReceiptViewV1,
  ProposedAppWireV1,
  ReviewEditWireV1,
} from "../../workers/protocol/messages.js";
import { toSecurityError, type SecurityError } from "./services.js";
import type { ImportServices } from "./import-services.js";

type PreflightEventV1 = Extract<ImportWorkerEventV1, { readonly kind: "preflight" }>;

/** What detection and sizing found, exactly as the parser reported it. */
export type ImportDetectedFactsV1 = Omit<PreflightEventV1, "kind">;

export type ImportRefusalFactsV1 = Extract<
  ImportWorkerEventV1,
  { readonly kind: "refused" }
>["refusal"];

/**
 * D18: F02 imports into a new app and nowhere else. "Add a table to an existing
 * app" is offered disabled with a reason, so there is no event that could
 * select it and no second member this type could take.
 */
export type ImportDestinationV1 = "new-app";

/** Why a run ended without an app. Tokens; the sentence is the view model's. */
export type ImportFailureReasonV1 =
  /** The parser could not read the file. */
  | "parse-failed"
  /** The stage refused a batch; streaming stopped. */
  | "stage-rejected"
  | "malformed-request"
  /** The stage is gone — swept, cancelled, or never (Roshi D-04). */
  | "stage-missing"
  /** Cleanup was attempted and did not answer; nothing may be promised. */
  | "cleanup-unconfirmed"
  /** The worker refused the request itself. */
  | "service-error";

export type ImportPhaseV1 = Extract<
  ImportWorkerEventV1,
  { readonly kind: "progress" }
>["phase"];

export interface ImportProgressFactsV1 {
  readonly phase: ImportPhaseV1;
  readonly rowsSoFar: number;
  readonly batchesAcked: number;
}

export interface ImportPromotionFactsV1 {
  readonly appId: string;
  readonly rowCount: number;
  readonly tableCount: number;
  readonly flaggedRecordCount: number;
}

export type PromotionRejectionV1 = Extract<
  Awaited<ReturnType<ImportServices["promoteImport"]>>,
  { readonly outcome: "rejected" }
>;

export interface ImportInput {
  readonly services: ImportServices;
}

export interface ImportContext {
  readonly services: ImportServices;
  readonly fileName: string;
  readonly detection: ImportDetectedFactsV1 | undefined;
  readonly refusal: ImportRefusalFactsV1 | undefined;
  readonly destination: ImportDestinationV1;
  /** What the user typed on the target screen; empty means "not chosen yet". */
  readonly appName: string;
  readonly tableName: string;
  readonly stageId: string | undefined;
  readonly progress: ImportProgressFactsV1;
  /** Exact, from the parser's terminal summary — never an estimate (D24). */
  readonly parsedRowCount: number | undefined;
  readonly proposal: ProposedAppWireV1 | undefined;
  /** Edits waiting to be applied, oldest first. */
  readonly pendingEdits: readonly ReviewEditWireV1[];
  /** The closed reason S03 gave for the last refused edit (CA-16). */
  readonly editRejection: string | undefined;
  readonly promotionRejection: PromotionRejectionV1 | undefined;
  readonly promoted: ImportPromotionFactsV1 | undefined;
  readonly cleanupReceipt: ImportCleanupReceiptViewV1 | undefined;
  readonly failure: ImportFailureReasonV1 | undefined;
  readonly error: SecurityError | undefined;
}

export type ImportEvent =
  | { readonly type: "CHOOSE_FILE"; readonly file: Blob; readonly fileName: string }
  | { readonly type: "IMPORT_EVENT"; readonly event: ImportWorkerEventV1 }
  | { readonly type: "SET_APP_NAME"; readonly text: string }
  | { readonly type: "SET_TABLE_NAME"; readonly text: string }
  | { readonly type: "CONTINUE" }
  | { readonly type: "BACK" }
  | { readonly type: "START" }
  | { readonly type: "CANCEL" }
  | { readonly type: "APPLY_EDIT"; readonly edit: ReviewEditWireV1 }
  | { readonly type: "CREATE_APP" };

const EMPTY_PROGRESS: ImportProgressFactsV1 = Object.freeze({
  phase: "sniffing",
  rowsSoFar: 0,
  batchesAcked: 0,
});

/**
 * A name the user actually chose. The RPC refuses an empty accepted name, and
 * whitespace is not a choice, so the same trim decides both.
 */
export function isChosenName(text: string): boolean {
  return text.trim().length > 0;
}

/**
 * The wire request `beginImportStage` takes, built from what the parser
 * reported. Returns `null` for a non-delimited detection: the parser only
 * emits `preflight` for delimited input, so this fails closed rather than
 * staging a format F02 cannot read.
 */
export function beginStageInput(
  fileName: string,
  facts: ImportDetectedFactsV1,
):
  | Parameters<ImportServices["beginStage"]>[0]
  | null {
  const { detected, report } = facts;
  if (detected.kind !== "delimited") {
    return null;
  }
  return {
    fileName,
    detected: {
      kind: "delimited",
      delimiter: detected.delimiter,
      encoding: detected.encoding,
      bomByteLength: detected.bomByteLength,
      newline: detected.newline,
    },
    preflight: {
      columnCount: report.columnCount,
      estimatedRowCount: report.estimatedRowCount,
      estimatedCellCount: report.estimatedCellCount,
      isEstimate: true,
      sampleRows: report.sampleRows,
      bytesSampled: report.bytesSampled,
      sourceByteLength: report.sourceByteLength,
    },
  };
}

/** The result of a stage call that first checked the stage is still there. */
type Gated<T> =
  | { readonly kind: "stage-missing" }
  | { readonly kind: "ok"; readonly value: T };

async function gated<T>(
  services: ImportServices,
  stageId: string,
  call: () => Promise<T>,
): Promise<Gated<T>> {
  const { stage } = await services.getStage({ stageId });
  if (stage === null) {
    return { kind: "stage-missing" };
  }
  return { kind: "ok", value: await call() };
}

interface StageInput {
  readonly services: ImportServices;
  readonly stageId: string;
}

export const importMachine = setup({
  types: {
    context: {} as ImportContext,
    events: {} as ImportEvent,
    input: {} as ImportInput,
  },
  actors: {
    /**
     * The parse event stream. Invoked at the root so a run's events reach the
     * machine in whichever state it is standing.
     */
    importEvents: fromCallback<ImportEvent, { services: ImportServices }>(
      ({ sendBack, input }) =>
        input.services.subscribe((event) => {
          sendBack({ type: "IMPORT_EVENT", event });
        }),
    ),
    beginStage: fromPromise(
      async ({
        input,
      }: {
        input: { services: ImportServices; fileName: string; facts: ImportDetectedFactsV1 };
      }) => {
        const request = beginStageInput(input.fileName, input.facts);
        if (request === null) {
          throw new Error("pre-flight reported a format the stage cannot take");
        }
        return input.services.beginStage(request);
      },
    ),
    runInference: fromPromise(async ({ input }: { input: StageInput }) =>
      gated(input.services, input.stageId, () =>
        input.services.runInference({ stageId: input.stageId }),
      ),
    ),
    applyReviewEdit: fromPromise(
      async ({
        input,
      }: {
        input: StageInput & { edit: ReviewEditWireV1 };
      }) =>
        gated(input.services, input.stageId, () =>
          input.services.applyReviewEdit({
            stageId: input.stageId,
            edit: input.edit,
          }),
        ),
    ),
    promoteImport: fromPromise(
      async ({
        input,
      }: {
        input: StageInput & { acceptedName: string };
      }) =>
        gated(input.services, input.stageId, () =>
          input.services.promoteImport({
            stageId: input.stageId,
            acceptedName: input.acceptedName,
          }),
        ),
    ),
    /**
     * Cleanup is *not* gated: `cancelImportStage` is idempotent, and a stage
     * that is already gone answers with a truthful receipt (deletedCount 0,
     * completed true) rather than an error.
     */
    cleanUpStage: fromPromise(async ({ input }: { input: StageInput }) =>
      input.services.cancelStage({ stageId: input.stageId }),
    ),
  },
  guards: {
    hasPendingEdit: ({ context }) => context.pendingEdits.length > 0,
    hasStage: ({ context }) => context.stageId !== undefined,
    canBeginStage: ({ context }) =>
      isChosenName(context.appName) && isChosenName(context.tableName),
  },
  actions: {
    /** The parser is ended on every terminal state; a run owns one worker. */
    terminateWorker: ({ context }) => {
      context.services.terminate();
    },
    stopParsing: ({ context }) => {
      context.services.cancelParse();
    },
  },
}).createMachine({
  id: "import",
  initial: "choosingFile",
  context: ({ input }) => ({
    services: input.services,
    fileName: "",
    detection: undefined,
    refusal: undefined,
    destination: "new-app",
    appName: "",
    tableName: "",
    stageId: undefined,
    progress: EMPTY_PROGRESS,
    parsedRowCount: undefined,
    proposal: undefined,
    pendingEdits: [],
    editRejection: undefined,
    promotionRejection: undefined,
    promoted: undefined,
    cleanupReceipt: undefined,
    failure: undefined,
    error: undefined,
  }),
  invoke: {
    src: "importEvents",
    input: ({ context }) => ({ services: context.services }),
  },
  on: {
    /**
     * Choosing a file is how every ended run restarts ("Choose another file",
     * "Retry same file"), so it is accepted wherever a run is not in flight.
     * The guard is the state, not this handler: states that are mid-run
     * override it with their own, narrower handling.
     */
    CHOOSE_FILE: {
      target: ".detecting",
      actions: [
        "terminateWorker",
        assign(({ context, event }) => {
          context.services.startImport({
            file: event.file,
            fileName: event.fileName,
          });
          return {
            fileName: event.fileName,
            detection: undefined,
            refusal: undefined,
            appName: "",
            tableName: "",
            stageId: undefined,
            progress: EMPTY_PROGRESS,
            parsedRowCount: undefined,
            proposal: undefined,
            pendingEdits: [],
            editRejection: undefined,
            promotionRejection: undefined,
            promoted: undefined,
            cleanupReceipt: undefined,
            failure: undefined,
            error: undefined,
          };
        }),
      ],
    },
  },
  states: {
    /** SCR-016. Nothing has been read; nothing has been spawned. */
    choosingFile: {},

    /** SCR-016 → the parser's `sniffing` and `sizing` phases. */
    detecting: {
      on: {
        IMPORT_EVENT: [
          {
            guard: ({ event }) => event.event.kind === "progress",
            actions: assign(({ event }) =>
              event.event.kind === "progress"
                ? {
                    progress: {
                      phase: event.event.phase,
                      rowsSoFar: event.event.rowsSoFar,
                      batchesAcked: event.event.batchesAcked,
                    },
                  }
                : {},
            ),
          },
          {
            guard: ({ event }) =>
              event.event.kind === "refused" &&
              event.event.refusal.kind === "over-import-budget",
            target: "overBudget",
            actions: assign(({ event }) =>
              event.event.kind === "refused"
                ? { refusal: event.event.refusal }
                : {},
            ),
          },
          {
            guard: ({ event }) => event.event.kind === "refused",
            target: "refused",
            actions: assign(({ event }) =>
              event.event.kind === "refused"
                ? { refusal: event.event.refusal }
                : {},
            ),
          },
          {
            guard: ({ event }) => event.event.kind === "preflight",
            target: "delimitedTarget",
            actions: assign(({ event }) => {
              if (event.event.kind !== "preflight") {
                return {};
              }
              const { detected, declaredExtension, contradiction, report } =
                event.event;
              return {
                detection: {
                  detected,
                  declaredExtension,
                  contradiction,
                  report,
                },
                // The proposal renames it at review; this is the opening offer.
                appName: report.fileName,
                tableName: report.fileName,
              };
            }),
          },
          {
            guard: ({ event }) => event.event.kind === "failed",
            target: "failing",
            actions: assign(({ event }) => ({
              failure:
                event.event.kind === "failed"
                  ? event.event.reason
                  : ("service-error" as const),
            })),
          },
        ],
      },
    },

    /**
     * SCR-017 (delimited-import.html). The facts are already measured; what is
     * chosen here is the destination and the names. `destination` has one
     * member, so "add to an existing app" is unreachable rather than refused
     * at runtime (D18).
     */
    delimitedTarget: {
      on: {
        SET_APP_NAME: {
          actions: assign({ appName: ({ event }) => event.text }),
        },
        SET_TABLE_NAME: {
          actions: assign({ tableName: ({ event }) => event.text }),
        },
        CONTINUE: { guard: "canBeginStage", target: "fits" },
      },
    },

    /**
     * SCR-018 (import.html). D20's fits variant: a confirmation of the
     * measurement pre-flight already made, never a second measurement.
     */
    fits: {
      on: {
        BACK: { target: "delimitedTarget" },
        START: { target: "beginningStage" },
      },
    },

    /** SCR-019 delimited variant (import-large.html); nothing was staged. */
    overBudget: {
      entry: "terminateWorker",
    },

    /** SCR-021 (import-refused.html); no stage ever existed (FR-2). */
    refused: {
      entry: "terminateWorker",
    },

    /**
     * The page hands the data worker `port2` and gets a stage id back; only
     * then is the parser told to stream, because facts sent before the stage
     * existed would have nowhere durable to land.
     */
    beginningStage: {
      invoke: {
        src: "beginStage",
        input: ({ context }) => ({
          services: context.services,
          fileName: context.fileName,
          // `fits` is reachable only through `delimitedTarget`, which is
          // reachable only with these facts assigned.
          facts: context.detection as ImportDetectedFactsV1,
        }),
        onDone: {
          target: "parsing",
          actions: [
            assign({ stageId: ({ event }) => event.output.stageId }),
            ({ context, event }) => {
              context.services.proceed({ stageId: event.output.stageId });
            },
          ],
        },
        onError: {
          target: "failing",
          actions: assign({
            failure: "service-error",
            error: ({ event }) => toSecurityError(event.error),
          }),
        },
      },
    },

    /** SCR-020 (import-progress.html). Cancellable; MOD-007's promise. */
    parsing: {
      on: {
        CANCEL: { target: "cancelling" },
        IMPORT_EVENT: [
          {
            guard: ({ event }) => event.event.kind === "progress",
            actions: assign(({ event }) =>
              event.event.kind === "progress"
                ? {
                    progress: {
                      phase: event.event.phase,
                      rowsSoFar: event.event.rowsSoFar,
                      batchesAcked: event.event.batchesAcked,
                    },
                  }
                : {},
            ),
          },
          {
            guard: ({ event }) => event.event.kind === "completed",
            target: "inferring",
            actions: assign(({ event }) =>
              event.event.kind === "completed"
                ? { parsedRowCount: event.event.rowCount }
                : {},
            ),
          },
          {
            // A cancelled parse with no CANCEL of ours: the run ended without
            // a terminal summary, so there is nothing exact to infer from.
            guard: ({ event }) => event.event.kind === "cancelled",
            target: "cancelling",
          },
          {
            guard: ({ event }) => event.event.kind === "failed",
            target: "failing",
            actions: assign(({ event }) => ({
              failure:
                event.event.kind === "failed"
                  ? event.event.reason
                  : ("service-error" as const),
            })),
          },
        ],
      },
    },

    /** Inference runs in the data worker over the staged facts (D17). */
    inferring: {
      on: { CANCEL: { target: "cancelling" } },
      invoke: {
        src: "runInference",
        input: ({ context }) => ({
          services: context.services,
          stageId: context.stageId as string,
        }),
        onDone: [
          {
            guard: ({ event }) => event.output.kind === "stage-missing",
            target: "failing",
            actions: assign({ failure: "stage-missing" }),
          },
          {
            target: "reviewing",
            actions: assign(({ context, event }) => {
              if (event.output.kind !== "ok") {
                return {};
              }
              const { proposal } = event.output.value;
              // The names the user typed are the user's decision, so they
              // enter the proposal as the review edits they are — never as a
              // silent overwrite the review screen cannot show or undo.
              const pending: ReviewEditWireV1[] = [];
              if (
                isChosenName(context.appName) &&
                context.appName.trim() !== proposal.appName
              ) {
                pending.push({
                  kind: "rename-app",
                  appName: context.appName.trim(),
                });
              }
              if (
                isChosenName(context.tableName) &&
                context.tableName.trim() !== proposal.table.tableName
              ) {
                pending.push({
                  kind: "rename-table",
                  tableName: context.tableName.trim(),
                });
              }
              return { proposal, pendingEdits: pending };
            }),
          },
        ],
        onError: {
          target: "failing",
          actions: assign({
            failure: "service-error",
            error: ({ event }) => toSecurityError(event.error),
          }),
        },
      },
    },

    /** SCR-023 (review.html). Nothing is accepted until "Create app". */
    reviewing: {
      initial: "deciding",
      on: { CANCEL: { target: "cancelling" } },
      states: {
        deciding: {
          always: { guard: "hasPendingEdit", target: "applyingEdit" },
          on: {
            APPLY_EDIT: {
              target: "applyingEdit",
              actions: assign({
                pendingEdits: ({ context, event }) => [
                  ...context.pendingEdits,
                  event.edit,
                ],
                editRejection: undefined,
              }),
            },
            CREATE_APP: { target: "#import.promoting" },
          },
        },
        applyingEdit: {
          invoke: {
            src: "applyReviewEdit",
            input: ({ context }) => ({
              services: context.services,
              stageId: context.stageId as string,
              edit: context.pendingEdits[0] as ReviewEditWireV1,
            }),
            onDone: [
              {
                guard: ({ event }) => event.output.kind === "stage-missing",
                target: "#import.failing",
                actions: assign({ failure: "stage-missing" }),
              },
              {
                target: "deciding",
                actions: assign(({ context, event }) => {
                  const rest = context.pendingEdits.slice(1);
                  if (event.output.kind !== "ok") {
                    return { pendingEdits: rest };
                  }
                  const result = event.output.value;
                  return result.outcome === "applied"
                    ? {
                        proposal: result.proposal,
                        pendingEdits: rest,
                        editRejection: undefined,
                      }
                    : {
                        pendingEdits: rest,
                        editRejection: result.reason,
                      };
                }),
              },
            ],
            onError: {
              target: "#import.failing",
              actions: assign({
                failure: "service-error",
                error: ({ event }) => toSecurityError(event.error),
              }),
            },
          },
        },
      },
    },

    /**
     * The one accept. A typed rejection wrote nothing and is a *result* the
     * review screen can act on (D23), so it returns to review with its issues
     * rather than destroying the stage the user just reviewed.
     */
    promoting: {
      invoke: {
        src: "promoteImport",
        input: ({ context }) => ({
          services: context.services,
          stageId: context.stageId as string,
          acceptedName: isChosenName(context.appName)
            ? context.appName.trim()
            : (context.proposal?.appName ?? ""),
        }),
        onDone: [
          {
            guard: ({ event }) => event.output.kind === "stage-missing",
            target: "failing",
            actions: assign({ failure: "stage-missing" }),
          },
          {
            guard: ({ event }) =>
              event.output.kind === "ok" &&
              event.output.value.outcome === "promoted",
            target: "done",
            actions: assign(({ event }) => {
              if (
                event.output.kind !== "ok" ||
                event.output.value.outcome !== "promoted"
              ) {
                return {};
              }
              const { appId, rowCount, tableCount, flaggedRecordCount } =
                event.output.value;
              return {
                promoted: { appId, rowCount, tableCount, flaggedRecordCount },
              };
            }),
          },
          {
            target: "reviewing",
            actions: assign(({ event }) =>
              event.output.kind === "ok" &&
              event.output.value.outcome === "rejected"
                ? { promotionRejection: event.output.value }
                : {},
            ),
          },
        ],
        onError: {
          target: "failing",
          actions: assign({
            failure: "service-error",
            error: ({ event }) => toSecurityError(event.error),
          }),
        },
      },
    },

    /**
     * The user asked to stop. The parser is told first so no further row is
     * staged, and the machine then *waits* for the cleanup receipt: an
     * optimistic "cancelled" would claim a guarantee it has not yet been given.
     */
    cancelling: {
      entry: "stopParsing",
      invoke: {
        src: "cleanUpStage",
        input: ({ context }) => ({
          services: context.services,
          stageId: context.stageId as string,
        }),
        onDone: {
          target: "cancelled",
          actions: assign({
            cleanupReceipt: ({ event }) => event.output.receipt,
          }),
        },
        onError: {
          target: "failed",
          actions: assign({
            failure: "cleanup-unconfirmed",
            error: ({ event }) => toSecurityError(event.error),
          }),
        },
      },
    },

    /**
     * Something ended the run. If a stage exists it is cleaned up first, so
     * "no partial app remains" is a receipt rather than a hope; with no stage
     * there was never anything to remove.
     */
    failing: {
      always: { guard: ({ context }) => context.stageId === undefined, target: "failed" },
      invoke: {
        src: "cleanUpStage",
        input: ({ context }) => ({
          services: context.services,
          stageId: context.stageId as string,
        }),
        onDone: {
          target: "failed",
          actions: assign({
            cleanupReceipt: ({ event }) => event.output.receipt,
          }),
        },
        // The failure that brought us here is kept; only the receipt is lost,
        // and its absence is what the surface must say.
        onError: { target: "failed" },
      },
    },

    /** SCR-022 cancelled variant (import-failed.html). */
    cancelled: {
      entry: "terminateWorker",
    },

    /** SCR-022 (import-failed.html). */
    failed: {
      entry: "terminateWorker",
    },

    /** The app exists and is durable. The route changes; the run is over. */
    done: {
      entry: "terminateWorker",
      type: "final",
    },
  },
});
