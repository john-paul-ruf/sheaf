/**
 * The import worker: it parses, and that is all it does (M33; D17).
 *
 * It never opens IndexedDB, never imports crypto, and never holds a key. Its
 * bundle contains neither dexie nor libsodium — asserted from source by
 * `tests/unit/workers/module-boundaries.test.ts` and from the built chunk by
 * `tests/browser/worker/staging.spec.ts` — which is what makes "the parser
 * cannot leak plaintext into durable storage" a property of the build rather
 * than a promise about the code.
 *
 * Facts leave over the `MessageChannel` the page created, straight to the data
 * worker. Nothing but progress counts and pre-flight facts goes back to the
 * page.
 *
 * Like `data.worker.ts`, this file is a composition root only: the run itself
 * lives in `./import/parse-session.ts`, so it is testable without a worker.
 */

import {
  IMPORT_FLOWS_V1,
  IMPORT_PROTOCOL_VERSION,
  isImportWorkerRequestMessageV1,
  type ImportFlowV1,
  type ImportWorkerEventMessageV1,
  type ImportWorkerEventV1,
} from "./protocol/import-messages.js";
import {
  acceptedSelection,
  preflightFile,
  streamFacts,
  streamSource,
  streamWorkbookFacts,
  type PreflightOutcomeForRunV1,
  type StreamFactsResultV1,
} from "./import/parse-session.js";

/**
 * The worker global, narrowed to what this file uses — the same reason
 * `data.worker.ts` narrows it: the pinned lib set is `DOM`, which has no
 * `DedicatedWorkerGlobalScope`, and adding `WebWorker` would collide with it.
 */
interface ImportWorkerScope {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
}

const scope = globalThis as unknown as ImportWorkerScope;

/** One run at a time; a second `startImport` replaces the first. */
interface RunState {
  port: MessagePort | undefined;
  preflight: PreflightOutcomeForRunV1 | undefined;
  cancelled: boolean;
  streaming: boolean;
}

const run: RunState = {
  port: undefined,
  preflight: undefined,
  cancelled: false,
  streaming: false,
};

function emit(event: ImportWorkerEventV1): void {
  const message: ImportWorkerEventMessageV1 = {
    protocolVersion: IMPORT_PROTOCOL_VERSION,
    event,
  };
  scope.postMessage(message);
}

/**
 * The flows a request declares, read defensively: structured clone delivers
 * `unknown`, and anything that is not a list of known flows is F02's default.
 */
const flowsOf = (value: unknown): readonly ImportFlowV1[] =>
  Array.isArray(value) && value.every((flow) => (IMPORT_FLOWS_V1 as readonly unknown[]).includes(flow))
    ? (value as readonly ImportFlowV1[])
    : ["delimited"];

async function startImport(
  file: Blob,
  fileName: string,
  acceptedFlows: readonly ImportFlowV1[],
): Promise<void> {
  run.cancelled = false;
  const outcome = await preflightFile(file, fileName, emit, acceptedFlows);
  run.preflight = outcome;

  if (outcome.kind === "refused") {
    // No stage was ever created, so there is nothing to clean up: the refusal
    // is the whole of the answer (FR-2).
    emit({ kind: "refused", refusal: outcome.refusal });
    return;
  }

  emit(
    outcome.kind === "workbook"
      ? {
          kind: "workbook-preflight",
          detected: outcome.sniff.format,
          declaredExtension: outcome.sniff.declaredExtension,
          contradiction: outcome.sniff.contradiction,
          report: outcome.report,
        }
      : {
          kind: "preflight",
          detected: outcome.sniff.format,
          declaredExtension: outcome.sniff.declaredExtension,
          contradiction: outcome.sniff.contradiction,
          report: outcome.report,
        },
  );
  emit({
    kind: "progress",
    phase: "waiting-for-stage",
    currentAction: "waiting-for-stage",
    rowsSoFar: 0,
    batchesAcked: 0,
  });
}

async function proceed(selectedSheets: unknown): Promise<void> {
  const outcome = run.preflight;
  const port = run.port;

  if (
    outcome === undefined ||
    outcome.kind === "refused" ||
    port === undefined ||
    run.streaming
  ) {
    emit({ kind: "failed", reason: "malformed-request" });
    return;
  }
  // Read fresh on every check, so a cancel that arrives mid-parse is seen at
  // the next batch boundary rather than at the next run.
  const cancellation = {
    get aborted(): boolean {
      return run.cancelled;
    },
  };

  let result: StreamFactsResultV1;
  if (outcome.kind === "workbook") {
    // Validated before a sheet is read: only inventoried sheets, none twice,
    // within the budget. Anything else ends the run with nothing sent.
    const selection = acceptedSelection(
      outcome.report,
      Array.isArray(selectedSheets) && selectedSheets.every(Number.isSafeInteger)
        ? (selectedSheets as readonly number[])
        : undefined,
    );
    if (selection === null) {
      emit({ kind: "failed", reason: "malformed-request" });
      return;
    }
    run.streaming = true;
    result = await streamWorkbookFacts({
      source: outcome.source,
      report: outcome.report,
      selection,
      port,
      cancellation,
      emit,
    });
  } else {
    if (selectedSheets !== undefined) {
      emit({ kind: "failed", reason: "malformed-request" });
      return;
    }
    run.streaming = true;
    result = await streamFacts({ source: outcome.source, sniff: outcome.sniff, port, cancellation, emit });
  }
  run.streaming = false;

  switch (result.outcome) {
    case "completed": {
      // The facts are staged; now the bytes they came from, so the accepted
      // import can be re-exported and re-compared against its source (D21).
      const retained = await streamSource({
        source: outcome.source,
        port,
        startSeq: result.batchesSent,
        cancellation,
      });
      if (!retained.ok) {
        emit({
          kind: "failed",
          reason: "stage-rejected",
          detail: { stage: "stage", sheetOrdinal: null, diagnostic: "parse-failed" },
        });
        return;
      }
      emit({
        kind: "completed",
        rowCount: result.rowsSoFar,
        batchesSent: result.batchesSent,
      });
      return;
    }
    case "cancelled":
      emit({ kind: "cancelled", batchesSent: result.batchesSent });
      return;
    case "stage-rejected":
      emit(withDetail("stage-rejected", result));
      return;
    default:
      emit(withDetail("parse-failed", result));
  }
}

function withDetail(
  reason: "stage-rejected" | "parse-failed",
  result: StreamFactsResultV1,
): ImportWorkerEventV1 {
  return result.detail === null
    ? { kind: "failed", reason }
    : { kind: "failed", reason, detail: result.detail };
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isImportWorkerRequestMessageV1(event.data)) {
    emit({ kind: "failed", reason: "malformed-request" });
    return;
  }
  const request = event.data.request;

  switch (request.kind) {
    case "startImport": {
      // The channel port rides the transfer list, never the request body.
      const [port] = event.ports;
      run.port = port;
      void startImport(request.file, request.fileName, flowsOf(request.acceptedFlows));
      return;
    }
    case "proceed":
      void proceed(request.selectedSheets);
      return;
    case "cancelImport":
      // Cooperative: the parser notices at the next batch boundary, so a row
      // is never half-emitted into the stage.
      run.cancelled = true;
      return;
    default: {
      const unreachable: never = request;
      void unreachable;
      emit({ kind: "failed", reason: "malformed-request" });
    }
  }
});
