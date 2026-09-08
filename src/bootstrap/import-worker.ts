/**
 * Spawning the import worker (M53).
 *
 * The `new Worker(new URL(…, import.meta.url), { type: "module" })` form is
 * written out literally because that is what Vite statically analyses to emit
 * the worker chunk. A computed specifier would build, and would then fail at
 * runtime in production with an unbundled path — so the literal is load-
 * bearing, not a style choice.
 *
 * The page holds the channel: it creates the `MessageChannel`, hands `port1`
 * here and `port2` to the data worker, and never touches a fact itself (D17).
 */

import { ImportWorkerClient } from "../workers/protocol/import-client.js";

export function spawnImportWorker(): Worker {
  return new Worker(new URL("../workers/import.worker.ts", import.meta.url), {
    type: "module",
  });
}

/** A client over the real worker; browser suites and M36 need no other. */
export function createImportWorkerClient(): ImportWorkerClient {
  return new ImportWorkerClient({ spawn: spawnImportWorker });
}
