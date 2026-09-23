/**
 * The import lifecycle (CAP-09–CAP-13, CAP-19–CAP-22, CAP-26; SCR-016–023,
 * MOD-004–008; FR-1/2/3/4).
 *
 * Import is the one long-running flow, and the architecture calls it an
 * explicit resumable machine: a file becomes an app across two workers, a
 * `MessageChannel`, a durable stage, and one human review, and every one of
 * those steps can end the run truthfully. A workbook and a delimited file are
 * two branches of this one machine, not two machines: they share the stage,
 * the progress, the review, the accept and every terminal state.
 *
 * **Detection and sizing are one round trip.** The parser sniffs *and* sizes
 * before it says anything (`import.worker.ts`), so `detecting` covers both of
 * its `sniffing` and `sizing` phases and the answer is a refusal, a delimited
 * pre-flight, or a workbook pre-flight (CA-24). There is no state between them
 * for a separate size check to live in: `fits` is the user's confirmation of a
 * measurement, not a second measurement (D20).
 *
 * **A workbook is routed before a cell is read (D31, D47).** The report's
 * route decides `workbookSizing.fits`, `.subset` or `.handoff`; the selection
 * starts at the report's default and is edited sheet by sheet with the budget
 * recomputed from the report's own per-sheet estimates, so a selection that
 * would not fit cannot `START`. The handoff offers nothing to start at all.
 *
 * **Every terminal state carries its receipt.** `cancelled` and `failed` do not
 * merely stop: they run the stage's four-step cleanup and wait for the
 * `ImportCleanupReceiptViewV1` before they claim anything (MOD-007, CA-10). A
 * cleanup that could not be confirmed becomes `cleanup-unconfirmed` rather than
 * a cancelled state that asserts nothing remains.
 *
 * **Every mutating stage call is gated on `getImportStage` first.** A stage can
 * vanish between review and "Create app" — an ordinary reload mid-import plus
 * the unlock sweep is enough — and the gate turns that into `stage-missing`,
 * which is what actually happened (Roshi D-04).
 *
 * **The file is not retained.** A `Blob` is the source bytes; the machine keeps
 * its name and its measurements and nothing else, so a snapshot holds no file
 * content and no cell value. "Retry same file" is the page re-sending
 * `CHOOSE_FILE` with the handle its picker still owns.
 */

import { assign, fromCallback, fromPromise, setup } from "xstate";
import type {
  ImportFailureDetailV1,
  ImportWorkerEventV1,
} from "../../workers/protocol/import-messages.js";
import type {
  ImportCleanupReceiptViewV1,
  LibraryAppV1,
  ProposedWorkbookWireV1,
  WorkbookReviewEditWireV1,
} from "../../workers/protocol/messages.js";
import { toSecurityError, type SecurityError } from "./services.js";
import type { ImportServices } from "./import-services.js";

type PreflightEventV1 = Extract<ImportWorkerEventV1, { readonly kind: "preflight" }>;
type WorkbookPreflightEventV1 = Extract<
  ImportWorkerEventV1,
  { readonly kind: "workbook-preflight" }
>;

/** What detection and sizing found for a delimited file, as the parser reported it. */
export type ImportDetectedFactsV1 = Omit<PreflightEventV1, "kind">;

/** What detection and sizing found for a workbook, as the parser reported it (CA-18). */
export type ImportWorkbookFactsV1 = Omit<WorkbookPreflightEventV1, "kind">;

export type WorkbookPreflightReportFactsV1 = ImportWorkbookFactsV1["report"];

export type ImportRefusalFactsV1 = Extract<
  ImportWorkerEventV1,
  { readonly kind: "refused" }
>["refusal"];

/**
 * Where the import lands. A delimited file may become a new table in an app
 * already on this device (D38); a workbook always becomes a new app.
 */
export type ImportDestinationV1 =
  | { readonly kind: "new-app" }
  | { readonly kind: "existing-app"; readonly appId: string };

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

/** The sheet being read, while a workbook's sheets stream (CA-24). */
export interface ImportSheetProgressV1 {
  /** One-based among the selected sheets: "Sheet k of n". */
  readonly ordinal: number;
  readonly count: number;
  readonly name: string;
}

export interface ImportProgressFactsV1 {
  readonly phase: ImportPhaseV1;
  readonly rowsSoFar: number;
  readonly batchesAcked: number;
  readonly sheet: ImportSheetProgressV1 | null;
}

export interface ImportPromotionFactsV1 {
  readonly appId: string;
  readonly rowCount: number;
  readonly tableCount: number;
  readonly flaggedRecordCount: number;
  /**
   * The table an append created, found by reading the app's tables either
   * side of the commit; `null` for a new app, whose landing is its home.
   */
  readonly appendedTableId: string | null;
}

export type PromotionRejectionV1 = Extract<
  Awaited<ReturnType<ImportServices["promoteImport"]>>,
  { readonly outcome: "rejected" }
>;

/** The outcome of SCR-019's "Copy handoff instructions", as the platform answered. */
export type HandoffCopyResultV1 = "copied" | "unavailable";

/**
 * The apps an append could land in: listed, still being listed, or not
 * listable. `unlisted` is not "no apps" — the read failed, and the surface
 * must not claim the library is empty.
 */
export type LibraryListingV1 =
  | { readonly kind: "listing" }
  | { readonly kind: "listed"; readonly apps: readonly LibraryAppV1[] }
  | { readonly kind: "unlisted" };

export interface ImportInput {
  readonly services: ImportServices;
}

export interface ImportContext {
  readonly services: ImportServices;
  readonly fileName: string;
  readonly detection: ImportDetectedFactsV1 | undefined;
  readonly workbook: ImportWorkbookFactsV1 | undefined;
  /** Workbook sheet indexes to import (D39, D47). Empty for a delimited file. */
  readonly selectedSheets: readonly number[];
  readonly handoffCopy: HandoffCopyResultV1 | undefined;
  readonly refusal: ImportRefusalFactsV1 | undefined;
  readonly destination: ImportDestinationV1;
  readonly library: LibraryListingV1;
  /** What the user typed on the target screen; empty means "not chosen yet". */
  readonly appName: string;
  readonly tableName: string;
  readonly stageId: string | undefined;
  readonly progress: ImportProgressFactsV1;
  /** Exact, from the parser's terminal summary — never an estimate (D24). */
  readonly parsedRowCount: number | undefined;
  /** The worker's proposal (CA-19), exactly as it sent it. */
  readonly proposal: ProposedWorkbookWireV1 | undefined;
  /** Edits waiting to be applied, oldest first. */
  readonly pendingEdits: readonly WorkbookReviewEditWireV1[];
  /** The closed reason the stage gave for the last refused edit (CA-16). */
  readonly editRejection: string | undefined;
  readonly promotionRejection: PromotionRejectionV1 | undefined;
  readonly promoted: ImportPromotionFactsV1 | undefined;
  readonly cleanupReceipt: ImportCleanupReceiptViewV1 | undefined;
  readonly failure: ImportFailureReasonV1 | undefined;
  /** Where a streamed parse failed: stage, sheet, closed diagnostic (CA-24). */
  readonly failureDetail: ImportFailureDetailV1 | undefined;
  readonly error: SecurityError | undefined;
}

export type ImportEvent =
  | { readonly type: "CHOOSE_FILE"; readonly file: Blob; readonly fileName: string }
  | { readonly type: "IMPORT_EVENT"; readonly event: ImportWorkerEventV1 }
  | { readonly type: "SET_APP_NAME"; readonly text: string }
  | { readonly type: "SET_TABLE_NAME"; readonly text: string }
  | { readonly type: "SET_DESTINATION"; readonly destination: ImportDestinationV1 }
  | { readonly type: "TOGGLE_SHEET"; readonly sheetIndex: number }
  | { readonly type: "SELECT_ALL" }
  | { readonly type: "CLEAR_ALL" }
  | { readonly type: "COPY_HANDOFF"; readonly result: HandoffCopyResultV1 }
  | { readonly type: "CONTINUE" }
  | { readonly type: "BACK" }
  | { readonly type: "START" }
  | { readonly type: "CANCEL" }
  | { readonly type: "APPLY_EDIT"; readonly edit: WorkbookReviewEditWireV1 }
  | { readonly type: "CREATE_APP" };

const EMPTY_PROGRESS: ImportProgressFactsV1 = Object.freeze({
  phase: "sniffing",
  rowsSoFar: 0,
  batchesAcked: 0,
  sheet: null,
});

const NEW_APP: ImportDestinationV1 = Object.freeze({ kind: "new-app" });

/**
 * How long a cancel waits for the parser to report that it has stopped before
 * cleaning up anyway.
 *
 * The parser checks for a cancel at each batch boundary, and S06 measured the
 * real xlsx cancel through the import worker at 13.5–17.9 ms from instruction
 * to terminal event. Five seconds is some 280 times that, so it is kept: the
 * bound exists for the parser that never answers at all, not to hurry one that
 * does, and the cleanup's own result is truthful either way.
 */
export const PARSER_STOP_TIMEOUT_MS = 5_000;

/**
 * The event cap of one segment (database.md § event segments), restated so the
 * machine imports nothing from staging. An append is one commit and a commit is
 * never split, so an append that cannot fit one segment cannot happen (D38).
 * `tests/unit/workflows/import.machine.test.ts` pins it to M23's constant.
 */
export const APPEND_EVENT_CAP = 10_000;

/**
 * D38's pre-flight estimate of an append's events: a record per row, a field
 * event per column, and the table and decision events around them. An estimate
 * — promotion re-checks exactly and refuses `append-too-large` when it is off.
 */
export function appendEventEstimate(facts: ImportDetectedFactsV1): number {
  return facts.report.estimatedRowCount + facts.report.columnCount + 2;
}

export function canAppendEstimate(facts: ImportDetectedFactsV1): boolean {
  return appendEventEstimate(facts) <= APPEND_EVENT_CAP;
}

/**
 * The selection's estimated cells, summed from the report's per-sheet
 * estimates. A sheet that declares nothing weighs zero, exactly as pre-flight
 * routed it (`routeOf`), so the page and the worker agree on what fits.
 */
export function selectionCellEstimate(
  report: WorkbookPreflightReportFactsV1,
  selection: readonly number[],
): number {
  return report.sheets
    .filter((sheet) => selection.includes(sheet.sheetIndex))
    .reduce((sum, sheet) => sum + (sheet.estimatedCellCount ?? 0), 0);
}

/** A selection the worker will accept: not empty, and inside the cell budget. */
export function selectionFits(
  report: WorkbookPreflightReportFactsV1,
  selection: readonly number[],
): boolean {
  return (
    selection.length > 0 &&
    selectionCellEstimate(report, selection) <= report.budgets.maxEstimatedCells
  );
}

/**
 * A name the user actually chose. The RPC refuses an empty accepted name, and
 * whitespace is not a choice, so the same trim decides both.
 */
export function isChosenName(text: string): boolean {
  return text.trim().length > 0;
}

type BeginStageRequest = Parameters<ImportServices["beginStage"]>[0];

/**
 * The wire request `beginImportStage` takes for a delimited file, built from
 * what the parser reported. Returns `null` for a non-delimited detection: the
 * parser only emits `preflight` for delimited input, so this fails closed
 * rather than staging a format it did not size.
 */
export function beginStageInput(
  fileName: string,
  facts: ImportDetectedFactsV1,
  destination: ImportDestinationV1 = NEW_APP,
): BeginStageRequest | null {
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
    ...(destination.kind === "existing-app" ? { destination } : {}),
  };
}

/**
 * The wire request for a workbook: every inventoried sheet (review lists the
 * unselected ones as excluded, D39) and the selection that will be streamed.
 */
export function workbookStageInput(
  fileName: string,
  facts: ImportWorkbookFactsV1,
  selectedSheets: readonly number[],
): BeginStageRequest {
  const { report } = facts;
  return {
    fileName,
    detected: { kind: "workbook", format: report.format },
    preflight: {
      kind: "workbook",
      sheets: report.sheets.map((sheet) => ({
        sheetIndex: sheet.sheetIndex,
        name: sheet.name,
        sheetKind: sheet.kind,
        visibility: sheet.visibility,
        estimatedRowCount: sheet.estimatedRowCount,
        estimatedCellCount: sheet.estimatedCellCount,
      })),
      selectedSheets: [...selectedSheets].sort((a, b) => a - b),
      sourceByteLength: report.sourceByteLength,
      isEstimate: true,
    },
  };
}

function stageRequestOf(context: ImportContext): BeginStageRequest | null {
  if (context.workbook !== undefined) {
    return workbookStageInput(context.fileName, context.workbook, context.selectedSheets);
  }
  return context.detection === undefined
    ? null
    : beginStageInput(context.fileName, context.detection, context.destination);
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

/** Table ids of an app, or none when the app is not on this device. */
async function tableIdsOf(services: ImportServices, appId: string): Promise<readonly string[]> {
  const { tables } = await services.listTables({ appId });
  return (tables ?? []).map((table) => table.tableId);
}

interface StageInput {
  readonly services: ImportServices;
  readonly stageId: string;
}

const progressOf = (
  event: Extract<ImportWorkerEventV1, { readonly kind: "progress" }>,
): ImportProgressFactsV1 => ({
  phase: event.phase,
  rowsSoFar: event.rowsSoFar,
  batchesAcked: event.batchesAcked,
  sheet:
    event.sheetOrdinal === undefined ||
    event.sheetCount === undefined ||
    event.sheetName === undefined
      ? null
      : { ordinal: event.sheetOrdinal, count: event.sheetCount, name: event.sheetName },
});

const failedFacts = (event: ImportWorkerEventV1) =>
  event.kind === "failed"
    ? { failure: event.reason, failureDetail: event.detail }
    : { failure: "service-error" as const };

const RESET = {
  detection: undefined,
  workbook: undefined,
  selectedSheets: [],
  handoffCopy: undefined,
  refusal: undefined,
  destination: NEW_APP,
  library: { kind: "listing" },
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
  failureDetail: undefined,
  error: undefined,
} as const satisfies Omit<ImportContext, "services" | "fileName">;

/** Whether an append into this app can be chosen (D38): listed, and small enough. */
function isDestinationAllowed(context: ImportContext, destination: ImportDestinationV1): boolean {
  if (destination.kind === "new-app") return true;
  return (
    context.library.kind === "listed" &&
    context.library.apps.some((app) => app.appId === destination.appId) &&
    context.detection !== undefined &&
    canAppendEstimate(context.detection)
  );
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
    listLibrary: fromPromise(
      async ({ input }: { input: { services: ImportServices } }) =>
        input.services.listLibrary(),
    ),
    beginStage: fromPromise(
      async ({
        input,
      }: {
        input: { services: ImportServices; request: BeginStageRequest | null };
      }) => {
        if (input.request === null) {
          throw new Error("pre-flight reported a format the stage cannot take");
        }
        return input.services.beginStage(input.request);
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
        input: StageInput & { edit: WorkbookReviewEditWireV1 };
      }) =>
        gated(input.services, input.stageId, () =>
          input.services.applyReviewEdit({
            stageId: input.stageId,
            edit: input.edit,
          }),
        ),
    ),
    /**
     * The one accept. An append reads the target app's tables either side of
     * its commit: the table that was not there before is the one to land on,
     * which no name comparison could promise (a colliding name is suffixed).
     */
    promoteImport: fromPromise(
      async ({
        input,
      }: {
        input: StageInput & {
          acceptedName: string;
          destination: ImportDestinationV1;
        };
      }) =>
        gated(input.services, input.stageId, async () => {
          const { destination } = input;
          const before =
            destination.kind === "existing-app"
              ? await tableIdsOf(input.services, destination.appId)
              : [];
          const response = await input.services.promoteImport({
            stageId: input.stageId,
            acceptedName: input.acceptedName,
          });
          if (response.outcome !== "promoted" || destination.kind !== "existing-app") {
            return { response, appendedTableId: null };
          }
          const after = await tableIdsOf(input.services, destination.appId);
          return {
            response,
            appendedTableId: after.find((tableId) => !before.includes(tableId)) ?? null,
          };
        }),
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
    canBeginStage: ({ context }) =>
      isChosenName(context.tableName) &&
      (context.destination.kind === "existing-app" || isChosenName(context.appName)),
    isInventoriedSheet: ({ context, event }) =>
      event.type === "TOGGLE_SHEET" &&
      context.workbook?.report.sheets.some((sheet) => sheet.sheetIndex === event.sheetIndex) === true,
    selectionFits: ({ context }) =>
      context.workbook !== undefined &&
      selectionFits(context.workbook.report, context.selectedSheets),
  },
  actions: {
    /** The parser is ended on every terminal state; a run owns one worker. */
    terminateWorker: ({ context }) => {
      context.services.terminate();
    },
    stopParsing: ({ context }) => {
      context.services.cancelParse();
    },
    toggleSheet: assign({
      selectedSheets: ({ context, event }) => {
        if (event.type !== "TOGGLE_SHEET") return context.selectedSheets;
        return context.selectedSheets.includes(event.sheetIndex)
          ? context.selectedSheets.filter((index) => index !== event.sheetIndex)
          : [...context.selectedSheets, event.sheetIndex].sort((a, b) => a - b);
      },
    }),
    selectAll: assign({
      selectedSheets: ({ context }) =>
        (context.workbook?.report.sheets ?? []).map((sheet) => sheet.sheetIndex),
    }),
    clearAll: assign({ selectedSheets: [] }),
    recordHandoffCopy: assign({
      handoffCopy: ({ context, event }) =>
        event.type === "COPY_HANDOFF" ? event.result : context.handoffCopy,
    }),
  },
}).createMachine({
  id: "import",
  initial: "choosingFile",
  context: ({ input }) => ({
    services: input.services,
    fileName: "",
    ...RESET,
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
          return { fileName: event.fileName, ...RESET };
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
              event.event.kind === "progress" ? { progress: progressOf(event.event) } : {},
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
            // D48/D42: this page accepts workbooks, so the worker has no reason
            // to refuse one as a later release. If it does, the run ends
            // rather than rendering a promise the page no longer makes.
            guard: ({ event }) =>
              event.event.kind === "refused" &&
              event.event.refusal.kind === "workbook-format-later-release",
            target: "failing",
            actions: assign({ failure: "service-error" as const }),
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
            guard: ({ event }) => event.event.kind === "workbook-preflight",
            target: "workbookSizing",
            actions: assign(({ event }) => {
              if (event.event.kind !== "workbook-preflight") {
                return {};
              }
              const { detected, declaredExtension, contradiction, report } =
                event.event;
              return {
                workbook: { detected, declaredExtension, contradiction, report },
                // D47: every sheet on fits, the fitting prefix on subset, none
                // on handoff — the worker already decided which.
                selectedSheets: [...report.defaultSelection],
              };
            }),
          },
          {
            guard: ({ event }) => event.event.kind === "failed",
            target: "failing",
            actions: assign(({ event }) => failedFacts(event.event)),
          },
        ],
      },
    },

    /**
     * SCR-017 (delimited-import.html). The facts are already measured; what is
     * chosen here is the destination and the names. An existing app is a
     * destination only when one is on this device and the estimate can fit
     * one commit (D38) — `SET_DESTINATION` refuses anything else.
     */
    delimitedTarget: {
      invoke: {
        src: "listLibrary",
        input: ({ context }) => ({ services: context.services }),
        onDone: {
          actions: assign({
            library: ({ event }) => ({ kind: "listed" as const, apps: event.output.apps }),
          }),
        },
        onError: {
          actions: assign({ library: { kind: "unlisted" as const } }),
        },
      },
      on: {
        SET_APP_NAME: {
          actions: assign({ appName: ({ event }) => event.text }),
        },
        SET_TABLE_NAME: {
          actions: assign({ tableName: ({ event }) => event.text }),
        },
        SET_DESTINATION: {
          guard: ({ context, event }) => isDestinationAllowed(context, event.destination),
          actions: assign({ destination: ({ event }) => event.destination }),
        },
        CONTINUE: { guard: "canBeginStage", target: "fits" },
      },
    },

    /**
     * SCR-018 (import.html), delimited variant. D20's fits variant: a
     * confirmation of the measurement pre-flight already made.
     */
    fits: {
      on: {
        BACK: { target: "delimitedTarget" },
        START: { target: "beginningStage" },
      },
    },

    /**
     * SCR-018 / SCR-019 for a workbook (import.html, import-large.html). The
     * report's route decides which; the selection is the user's to edit.
     * Nothing is staged yet, so leaving is free and the parser just ends.
     */
    workbookSizing: {
      initial: "routing",
      on: {
        CANCEL: { target: "choosingFile", actions: "terminateWorker" },
      },
      states: {
        routing: {
          always: [
            {
              guard: ({ context }) => context.workbook?.report.route === "fits",
              target: "fits",
            },
            {
              guard: ({ context }) => context.workbook?.report.route === "subset",
              target: "subset",
            },
            { target: "handoff" },
          ],
        },
        /** SCR-018: every sheet fits; the user may still leave some out. */
        fits: {
          on: {
            TOGGLE_SHEET: { guard: "isInventoriedSheet", actions: "toggleSheet" },
            SELECT_ALL: { actions: "selectAll" },
            CLEAR_ALL: { actions: "clearAll" },
            START: { guard: "selectionFits", target: "#import.beginningStage" },
          },
        },
        /** SCR-019: a smaller scope fits, and the handoff is offered beside it. */
        subset: {
          on: {
            TOGGLE_SHEET: { guard: "isInventoriedSheet", actions: "toggleSheet" },
            SELECT_ALL: { actions: "selectAll" },
            CLEAR_ALL: { actions: "clearAll" },
            COPY_HANDOFF: { actions: "recordHandoffCopy" },
            START: { guard: "selectionFits", target: "#import.beginningStage" },
          },
        },
        /** SCR-019: no sheet fits alone. There is nothing here to start. */
        handoff: {
          on: {
            COPY_HANDOFF: { actions: "recordHandoffCopy" },
          },
        },
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
          request: stageRequestOf(context),
        }),
        onDone: {
          target: "parsing",
          actions: [
            assign({ stageId: ({ event }) => event.output.stageId }),
            ({ context, event }) => {
              context.services.proceed({
                stageId: event.output.stageId,
                ...(context.workbook === undefined
                  ? {}
                  : { selectedSheets: context.selectedSheets }),
              });
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
              event.event.kind === "progress" ? { progress: progressOf(event.event) } : {},
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
            // This *is* the parser's terminal report, so there is nothing left
            // to wait for and the cleanup starts at once.
            guard: ({ event }) => event.event.kind === "cancelled",
            target: "cancelling.cleaning",
          },
          {
            guard: ({ event }) => event.event.kind === "failed",
            target: "failing",
            actions: assign(({ event }) => failedFacts(event.event)),
          },
        ],
      },
    },

    /** Inference runs in the data worker over the staged facts (D17). */
    inferring: {
      // Reachable only through the parser's `completed`, so nothing is still
      // in flight and the cleanup needs no wait.
      on: { CANCEL: { target: "cancelling.cleaning" } },
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
              // The names typed on SCR-017 are the user's decision, so they
              // enter the proposal as the review edits they are — never as a
              // silent overwrite the review screen cannot show or undo. A
              // workbook has no target screen, so it has none; an append names
              // a table, not an app.
              const pending: WorkbookReviewEditWireV1[] = [];
              const [table] = proposal.tables;
              if (
                context.destination.kind === "new-app" &&
                isChosenName(context.appName) &&
                context.appName.trim() !== proposal.appName
              ) {
                pending.push({ kind: "rename-app", appName: context.appName.trim() });
              }
              if (
                table !== undefined &&
                isChosenName(context.tableName) &&
                context.tableName.trim() !== table.tableName
              ) {
                pending.push({
                  kind: "rename-table",
                  tableKey: table.tableKey,
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
      // Reachable only after `inferring`, so the parser is long finished.
      on: { CANCEL: { target: "cancelling.cleaning" } },
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
              edit: context.pendingEdits[0] as WorkbookReviewEditWireV1,
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
                        promotionRejection: undefined,
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
     * review screen can act on (D23) — `append-too-large` included — so it
     * returns to review with its issues rather than destroying the stage the
     * user just reviewed.
     */
    promoting: {
      invoke: {
        src: "promoteImport",
        input: ({ context }) => ({
          services: context.services,
          stageId: context.stageId as string,
          // The proposal's name is the reviewed one: every rename, the one
          // typed on SCR-017 included, reached it as an edit.
          acceptedName: context.proposal?.appName ?? "",
          destination: context.destination,
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
              event.output.value.response.outcome === "promoted",
            target: "done",
            actions: assign(({ event }) => {
              if (
                event.output.kind !== "ok" ||
                event.output.value.response.outcome !== "promoted"
              ) {
                return {};
              }
              const { appId, rowCount, tableCount, flaggedRecordCount } =
                event.output.value.response;
              return {
                promoted: {
                  appId,
                  rowCount,
                  tableCount,
                  flaggedRecordCount,
                  appendedTableId: event.output.value.appendedTableId,
                },
              };
            }),
          },
          {
            target: "reviewing",
            actions: assign(({ event }) =>
              event.output.kind === "ok" &&
              event.output.value.response.outcome === "rejected"
                ? { promotionRejection: event.output.value.response }
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
     *
     * **Telling the parser to stop is not the same as it having stopped.**
     * `cancelParse` crosses a worker boundary, and the batches the parser had
     * already sent are still travelling down the channel to the data worker.
     * Cleaning up while they land races them, and the store answers that race
     * with `revision-conflict` (F02 SESSION-07 CP4, reproduced 3/3). So the
     * cleanup follows the parser's *terminal event*, not the stop instruction.
     * The states that already know the parser has finished — its own
     * `cancelled` report, and a cancel from `inferring` or `reviewing`, both of
     * which are only reachable after `completed` — enter {@link cleaning}
     * directly and wait for nothing.
     */
    cancelling: {
      entry: "stopParsing",
      initial: "stopping",
      states: {
        /**
         * Bounded, because a parser that never answers must not strand the
         * cancel: after {@link PARSER_STOP_TIMEOUT_MS} the cleanup runs anyway
         * and its own result — receipt or `cleanup-unconfirmed` — is still
         * what the surface reports.
         */
        stopping: {
          on: {
            IMPORT_EVENT: {
              guard: ({ event }) =>
                event.event.kind === "cancelled" ||
                event.event.kind === "completed" ||
                event.event.kind === "failed",
              target: "cleaning",
            },
          },
          after: { [PARSER_STOP_TIMEOUT_MS]: { target: "cleaning" } },
        },
        cleaning: {
          invoke: {
            src: "cleanUpStage",
            input: ({ context }) => ({
              services: context.services,
              stageId: context.stageId as string,
            }),
            onDone: {
              target: "#import.cancelled",
              actions: assign({
                cleanupReceipt: ({ event }) => event.output.receipt,
              }),
            },
            onError: {
              target: "#import.failed",
              actions: assign({
                failure: "cleanup-unconfirmed",
                error: ({ event }) => toSecurityError(event.error),
              }),
            },
          },
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
