/**
 * The page side of the data-worker boundary (M32).
 *
 * One dedicated worker, one correlation id per request, one pending entry per
 * id. The worker is spawned on the first request rather than at construction,
 * so a page that never unlocks never pays for a worker or for libsodium's
 * WASM; {@link DataWorkerClient.terminate} is the lock/relock hook and fails
 * every in-flight request rather than leaving a promise that can never settle.
 *
 * This file runs in the page. It imports no crypto and holds no key: the only
 * thing it can do with the worker is send a typed request and read a
 * view-safe response.
 */

import {
  PROTOCOL_VERSION,
  isDataWorkerResponseMessageV1,
  type DataWorkerErrorV1,
  type DataWorkerRequestMessageV1,
  type DataWorkerRequestV1,
  type ResponseForV1,
} from "./messages.js";

/** Long enough for an Argon2id derive on a slow phone, short enough to fail. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/** A typed refusal from the worker, or a boundary failure the client detected. */
export class DataWorkerRequestError extends Error {
  constructor(readonly error: DataWorkerErrorV1) {
    super(`data worker request failed: ${error.kind}`);
    this.name = "DataWorkerRequestError";
  }
}

export interface DataWorkerClientOptions {
  /** Constructs the worker. Called at most once per client. */
  readonly spawn: () => Worker;
  readonly requestTimeoutMs?: number;
}

interface PendingRequest {
  readonly kind: string;
  readonly resolve: (response: never) => void;
  readonly reject: (cause: DataWorkerRequestError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class DataWorkerClient {
  readonly #spawn: () => Worker;
  readonly #requestTimeoutMs: number;
  readonly #pending = new Map<number, PendingRequest>();
  #worker: Worker | undefined;
  #nextId = 1;
  #terminated = false;

  constructor(options: DataWorkerClientOptions) {
    this.#spawn = options.spawn;
    this.#requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** True once a worker exists; a terminated client never spawns another. */
  get isRunning(): boolean {
    return this.#worker !== undefined && !this.#terminated;
  }

  /**
   * `transfer` moves ownership of the listed buffers to the worker instead of
   * copying them. F01 sends no binary request payload; the parameter is the
   * boundary's transfer contract for the import and export commands that
   * follow it.
   */
  async send<R extends DataWorkerRequestV1>(
    request: R,
    transfer: readonly Transferable[] = [],
  ): Promise<ResponseForV1<R["kind"]>> {
    if (this.#terminated) {
      throw new DataWorkerRequestError({ kind: "worker-terminated" });
    }

    const worker = this.#ensureWorker();
    const id = this.#nextId++;
    const message: DataWorkerRequestMessageV1 = {
      protocolVersion: PROTOCOL_VERSION,
      id,
      request,
    };

    return new Promise<ResponseForV1<R["kind"]>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#settle(id, (pending) =>
          pending.reject(new DataWorkerRequestError({ kind: "timeout" })),
        );
      }, this.#requestTimeoutMs);

      this.#pending.set(id, {
        kind: request.kind,
        resolve,
        reject,
        timer,
      });

      try {
        worker.postMessage(message, [...transfer]);
      } catch (cause) {
        this.#settle(id, (pending) =>
          pending.reject(new DataWorkerRequestError({ kind: "internal" })),
        );
        throw cause;
      }
    });
  }

  /**
   * Ends the worker and fails everything still in flight. Called on lock, on
   * pagehide, and on idle timeout — the page's half of "termination re-locks".
   */
  terminate(): void {
    this.#terminated = true;
    const worker = this.#worker;
    this.#worker = undefined;
    worker?.terminate();
    this.#rejectAll({ kind: "worker-terminated" });
  }

  #ensureWorker(): Worker {
    if (this.#worker !== undefined) {
      return this.#worker;
    }
    const worker = this.#spawn();
    worker.onmessage = (event: MessageEvent<unknown>) => {
      this.#receive(event.data);
    };
    // A message that cannot be deserialised, or a worker that died, must not
    // leave callers waiting for the timeout: both fail every pending request.
    worker.onmessageerror = () => {
      this.#rejectAll({ kind: "internal" });
    };
    worker.onerror = () => {
      this.#rejectAll({ kind: "internal" });
    };
    this.#worker = worker;
    return worker;
  }

  #receive(data: unknown): void {
    if (!isDataWorkerResponseMessageV1(data)) {
      return;
    }
    this.#settle(data.id, (pending) => {
      if (!data.result.ok) {
        pending.reject(new DataWorkerRequestError(data.result.error));
        return;
      }
      if (data.result.response.kind !== pending.kind) {
        pending.reject(new DataWorkerRequestError({ kind: "internal" }));
        return;
      }
      pending.resolve(data.result.response as never);
    });
  }

  #settle(id: number, apply: (pending: PendingRequest) => void): void {
    const pending = this.#pending.get(id);
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    apply(pending);
  }

  #rejectAll(error: DataWorkerErrorV1): void {
    for (const id of [...this.#pending.keys()]) {
      this.#settle(id, (pending) =>
        pending.reject(new DataWorkerRequestError(error)),
      );
    }
  }
}
