/**
 * The page side of the import-worker boundary (M32).
 *
 * Modelled on `client.ts`, and different in one way that matters: the import
 * worker is a **stream**, not a request/response pair. There is no correlation
 * id because there is nothing to correlate — one run at a time, and every
 * answer is an event the page renders as it arrives.
 *
 * Like the data-worker client, the worker is spawned on the first request
 * rather than at construction, so a page that never imports never pays for a
 * second worker; and a terminated client never spawns another, so cancelling
 * is final.
 */

import {
  IMPORT_PROTOCOL_VERSION,
  isImportWorkerEventMessageV1,
  type ImportWorkerEventV1,
  type ImportWorkerRequestMessageV1,
  type ImportWorkerRequestV1,
} from "./import-messages.js";

export type ImportEventListener = (event: ImportWorkerEventV1) => void;

export interface ImportWorkerClientOptions {
  /** Constructs the worker. Called at most once per client. */
  readonly spawn: () => Worker;
}

export class ImportWorkerClient {
  readonly #spawn: () => Worker;
  readonly #listeners = new Set<ImportEventListener>();
  #worker: Worker | undefined;
  #terminated = false;

  constructor(options: ImportWorkerClientOptions) {
    this.#spawn = options.spawn;
  }

  get isRunning(): boolean {
    return this.#worker !== undefined && !this.#terminated;
  }

  on(listener: ImportEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * `transfer` moves the channel port to the worker instead of copying it —
   * a port cannot be cloned, so this is the only way it can travel.
   */
  send(
    request: ImportWorkerRequestV1,
    transfer: readonly Transferable[] = [],
  ): void {
    if (this.#terminated) {
      this.#emit({ kind: "failed", reason: "malformed-request" });
      return;
    }
    const message: ImportWorkerRequestMessageV1 = {
      protocolVersion: IMPORT_PROTOCOL_VERSION,
      request,
    };
    this.#ensureWorker().postMessage(message, [...transfer]);
  }

  /**
   * Ends the worker. The parse stops where it is; the data worker learns the
   * import is over from the channel closing or from its own cancel command,
   * never from a message this client is still able to send.
   */
  terminate(): void {
    this.#terminated = true;
    const worker = this.#worker;
    this.#worker = undefined;
    worker?.terminate();
  }

  dispose(): void {
    this.terminate();
    this.#listeners.clear();
  }

  #ensureWorker(): Worker {
    if (this.#worker !== undefined) {
      return this.#worker;
    }
    const worker = this.#spawn();
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (isImportWorkerEventMessageV1(event.data)) {
        this.#emit(event.data.event);
      }
    };
    // A worker that dies mid-parse must not leave the surface showing
    // progress forever; it becomes a failure the machine can act on.
    worker.onerror = () => {
      this.#emit({ kind: "failed", reason: "parse-failed" });
    };
    worker.onmessageerror = () => {
      this.#emit({ kind: "failed", reason: "malformed-request" });
    };
    this.#worker = worker;
    return worker;
  }

  #emit(event: ImportWorkerEventV1): void {
    for (const listener of [...this.#listeners]) {
      listener(event);
    }
  }
}
