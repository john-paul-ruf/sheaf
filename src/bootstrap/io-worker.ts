export function spawnIoWorker(): Worker {
  return new Worker(new URL("../workers/io.worker.ts", import.meta.url), { type: "module" });
}
