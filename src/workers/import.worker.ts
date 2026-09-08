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
  IMPORT_PROTOCOL_VERSION,
  isImportWorkerRequestMessageV1,
  type ImportWorkerEventMessageV1,
  type ImportWorkerEventV1,
} from "./protocol/import-messages.js";
import {
  preflightFile,
  streamFacts,
  type PreflightOutcomeForRunV1,
} from "./import/parse-session.js";
import { isDelimitedSniff } from "../import/preflight/preflight.js";

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

async function startImport(file: Blob, fileName: string): Promise<void> {
  run.cancelled = false;
  const outcome = await preflightFile(file, fileName, emit);
  run.preflight = outcome;

  if (outcome.kind === "refused") {
    // No stage was ever created, so there is nothing to clean up: the refusal
    // is the whole of the answer (FR-2).
    emit({ kind: "refused", refusal: outcome.refusal });
    return;
  }

  emit({
    kind: "preflight",
    detected: outcome.sniff.format,
    declaredExtension: outcome.sniff.declaredExtension,
    contradiction: outcome.sniff.contradiction,
    report: outcome.report,
  });
  emit({
    kind: "progress",
    phase: "waiting-for-stage",
    currentAction: "waiting-for-stage",
    rowsSoFar: 0,
    batchesAcked: 0,
  });
}

async function proceed(): Promise<void> {
  const outcome = run.preflight;
  const port = run.port;

  if (outcome === undefined || outcome.kind !== "proceed" || port === undefined) {
    emit({ kind: "failed", reason: "malformed-request" });
    return;
  }
  if (!isDelimitedSniff(outcome.sniff)) {
    emit({ kind: "failed", reason: "parse-failed" });
    return;
  }
  if (run.streaming) {
    emit({ kind: "failed", reason: "malformed-request" });
    return;
  }

  run.streaming = true;
  const result = await streamFacts({
    source: outcome.source,
    sniff: outcome.sniff,
    port,
    // Read fresh on every check, so a cancel that arrives mid-parse is seen
    // at the next batch boundary rather than at the next run.
    cancellation: {
      get aborted(): boolean {
        return run.cancelled;
      },
    },
    emit,
  });
  run.streaming = false;

  switch (result.outcome) {
    case "completed":
      emit({
        kind: "completed",
        rowCount: result.rowsSoFar,
        batchesSent: result.batchesSent,
      });
      return;
    case "cancelled":
      emit({ kind: "cancelled", batchesSent: result.batchesSent });
      return;
    case "stage-rejected":
      emit({ kind: "failed", reason: "stage-rejected" });
      return;
    default:
      emit({ kind: "failed", reason: "parse-failed" });
  }
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
      void startImport(request.file, request.fileName);
      return;
    }
    case "proceed":
      void proceed();
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
