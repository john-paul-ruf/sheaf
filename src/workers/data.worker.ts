/**
 * The data worker: sole owner of the local database and of every unlocked key
 * (M33, architecture § Runtime Topology).
 *
 * This file is only the composition root. It supplies the two F01 ports (D9),
 * warms the sodium WASM bootstrap, and moves messages between the boundary and
 * the handlers — every command lives in `./data/handlers.ts`, which is
 * therefore unit-testable without a worker.
 *
 * Nothing leaves here unredacted: a handler either produces a view-safe
 * response or throws, and `redactError` turns the throw into a kind. There is
 * no DOM import, no network call, and no path by which a key handle can be
 * postMessage'd — key bytes live in a module-private WeakMap in `src/crypto`
 * and are not serializable.
 */

import type { ClockPort } from "../application/ports/clock.js";
import type { EntropyPort } from "../application/ports/entropy.js";
import { loadSodium } from "../crypto/sodium.js";
import { createDataWorkerHandler } from "./data/handlers.js";
import {
  PROTOCOL_VERSION,
  isDataWorkerRequestMessageV1,
  type DataWorkerResponseMessageV1,
  type DataWorkerResultV1,
} from "./protocol/messages.js";
import { redactError } from "./protocol/redact.js";

/**
 * The worker global, narrowed to what this file uses. The pinned lib set is
 * `DOM`, which has no `DedicatedWorkerGlobalScope`, and adding `WebWorker`
 * would collide with it — the two describe the same names differently. This
 * is the whole surface the boundary needs.
 */
interface DataWorkerScope {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
}

const scope = globalThis as unknown as DataWorkerScope;

const clock: ClockPort = { nowEpochMs: () => Date.now() };

const entropy: EntropyPort = {
  randomBytes: (byteLength: number) =>
    crypto.getRandomValues(new Uint8Array(byteLength)),
};

const handler = createDataWorkerHandler({ clock, entropy });

// The first command would otherwise pay for the WASM bootstrap; every crypto
// entry point awaits the same promise, so starting it early costs nothing.
void loadSodium();

function reply(id: number, result: DataWorkerResultV1): void {
  const message: DataWorkerResponseMessageV1 = {
    protocolVersion: PROTOCOL_VERSION,
    id,
    result,
  };
  scope.postMessage(message);
}

async function dispatch(
  data: unknown,
  ports: readonly MessagePort[],
): Promise<void> {
  const envelope =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : undefined;
  const id = envelope?.["id"];
  if (typeof id !== "number" || !Number.isSafeInteger(id)) {
    // Nothing to correlate a reply to: an unaddressed message is dropped
    // rather than answered into the void.
    return;
  }

  if (envelope?.["protocolVersion"] !== PROTOCOL_VERSION) {
    reply(id, { ok: false, error: { kind: "protocol-version-mismatch" } });
    return;
  }
  if (!isDataWorkerRequestMessageV1(data)) {
    reply(id, { ok: false, error: { kind: "malformed-request" } });
    return;
  }

  try {
    reply(id, {
      ok: true,
      response: await handler.handle(data.request, ports),
    });
  } catch (cause) {
    reply(id, { ok: false, error: redactError(cause) });
  }
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  // A transferred `MessagePort` arrives here, never in the request body: the
  // wire union names no port type at all (D17, and the byte-grep on
  // `messages.ts` that pins it).
  void dispatch(event.data, event.ports);
});
