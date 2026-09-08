/**
 * The machine-facing edge of the import column (M36 → M32; D17).
 *
 * Two workers, one run. The **page** owns the `MessageChannel` between them,
 * which is why it is created here rather than in either worker: `port1` rides
 * `startImport` to the parser, `port2` rides `beginImportStage` to the data
 * worker, and neither end can hand a port back (a response never carries one).
 * Facts therefore travel parser → data worker and are never seen by the page.
 *
 * **Spawn and terminate are this layer's job.** The import worker is spawned at
 * {@link ImportServices.startImport} — a session that never imports never pays
 * for a second worker — and terminated on every terminal state of the machine.
 * The spawn function is *injected*: application code may not import
 * `src/bootstrap/`, so S07 supplies the constructor.
 *
 * Parse events are a **stream**, not a response: {@link ImportServices.subscribe}
 * is what the machine's event-source actor attaches to.
 */

import {
  ImportWorkerClient,
  type ImportEventListener,
} from "../../workers/protocol/import-client.js";
import type {
  ImportWorkerEventV1,
} from "../../workers/protocol/import-messages.js";
import type {
  BeginImportStageResponseV1,
  CancelImportStageResponseV1,
  DataWorkerRequestV1,
  DetectedDelimitedV1,
  GetImportStageResponseV1,
  ImportPreflightFactsV1,
  PromoteImportResponseV1,
  ResponseForV1,
  ReviewEditWireV1,
  ApplyReviewEditResponseV1,
} from "../../workers/protocol/messages.js";

/**
 * The part of the data-worker client the import flow uses. It is wider than
 * {@link import("./services.js").SecurityWorkerPort} by exactly one parameter:
 * `beginImportStage` must transfer a port, and a port cannot be cloned.
 */
export interface ImportWorkerPort {
  send<R extends DataWorkerRequestV1>(
    request: R,
    transfer?: readonly Transferable[],
  ): Promise<ResponseForV1<R["kind"]>>;
}

export interface ImportServicesOptions {
  readonly dataWorker: ImportWorkerPort;
  /** Constructs the import worker. Injected — never imported from bootstrap. */
  readonly spawnImportWorker: () => Worker;
}

/**
 * Everything the {@link import("./import.machine.js").importMachine} may do.
 * Each member is one named RPC or one worker-lifetime step; no member decides
 * anything, so the machine holds the whole of the flow's logic.
 */
export interface ImportServices {
  /** Attaches to the parse event stream. Survives across runs. */
  readonly subscribe: (listener: ImportEventListener) => () => void;
  /**
   * Spawns the parser, creates the run's channel, and sends the file with
   * `port1` transferred. The parser sniffs and sizes, then stops.
   */
  readonly startImport: (input: {
    readonly file: Blob;
    readonly fileName: string;
  }) => void;
  /**
   * Creates the durable stage and hands the data worker `port2` in the
   * request's transfer list (D17). Answers with the stage id and nothing else.
   */
  readonly beginStage: (input: {
    readonly fileName: string;
    readonly detected: DetectedDelimitedV1;
    readonly preflight: ImportPreflightFactsV1;
  }) => Promise<BeginImportStageResponseV1>;
  /** "The stage exists, start streaming." */
  readonly proceed: (input: { readonly stageId: string }) => void;
  /** Cooperative: the parser stops at the next batch boundary. */
  readonly cancelParse: () => void;
  readonly getStage: (input: {
    readonly stageId: string;
  }) => Promise<GetImportStageResponseV1>;
  readonly runInference: (input: {
    readonly stageId: string;
  }) => Promise<ResponseForV1<"runInference">>;
  readonly applyReviewEdit: (input: {
    readonly stageId: string;
    readonly edit: ReviewEditWireV1;
  }) => Promise<ApplyReviewEditResponseV1>;
  readonly promoteImport: (input: {
    readonly stageId: string;
    readonly acceptedName: string;
  }) => Promise<PromoteImportResponseV1>;
  /** The four-step cleanup. Idempotent: a receipt comes back either way. */
  readonly cancelStage: (input: {
    readonly stageId: string;
  }) => Promise<CancelImportStageResponseV1>;
  /** Ends the parser and releases an unsent port. Safe to call twice. */
  readonly terminate: () => void;
}

export function createImportServices(
  options: ImportServicesOptions,
): ImportServices {
  const listeners = new Set<ImportEventListener>();
  let client: ImportWorkerClient | undefined;
  /** Held between `startImport` and `beginStage`; transferred, then dropped. */
  let stagePort: MessagePort | undefined;

  const emit = (event: ImportWorkerEventV1): void => {
    for (const listener of [...listeners]) {
      listener(event);
    }
  };

  const releasePort = (): void => {
    stagePort?.close();
    stagePort = undefined;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    startImport({ file, fileName }) {
      // A terminated client never spawns another, so every run gets its own.
      client?.dispose();
      releasePort();

      const fresh = new ImportWorkerClient({
        spawn: options.spawnImportWorker,
      });
      fresh.on(emit);
      client = fresh;

      const channel = new MessageChannel();
      stagePort = channel.port2;
      fresh.send({ kind: "startImport", file, fileName }, [channel.port1]);
    },

    beginStage({ fileName, detected, preflight }) {
      const port = stagePort;
      stagePort = undefined;
      return options.dataWorker.send(
        { kind: "beginImportStage", fileName, detected, preflight },
        port === undefined ? [] : [port],
      );
    },

    proceed({ stageId }) {
      client?.send({ kind: "proceed", stageId });
    },

    cancelParse() {
      client?.send({ kind: "cancelImport" });
    },

    getStage({ stageId }) {
      return options.dataWorker.send({ kind: "getImportStage", stageId });
    },

    runInference({ stageId }) {
      return options.dataWorker.send({ kind: "runInference", stageId });
    },

    applyReviewEdit({ stageId, edit }) {
      return options.dataWorker.send({
        kind: "applyReviewEdit",
        stageId,
        edit,
      });
    },

    promoteImport({ stageId, acceptedName }) {
      return options.dataWorker.send({
        kind: "promoteImport",
        stageId,
        acceptedName,
      });
    },

    cancelStage({ stageId }) {
      return options.dataWorker.send({ kind: "cancelImportStage", stageId });
    },

    terminate() {
      client?.dispose();
      client = undefined;
      releasePort();
    },
  };
}
