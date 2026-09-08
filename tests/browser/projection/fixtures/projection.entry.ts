/**
 * Test-only page module injected by `worker-context.spec.ts`. It spawns the
 * projection probe through Vite's worker pipeline, so the pipeline — not a
 * hand-rolled bundle — is what the proof runs on.
 */
declare global {
  interface Window {
    __sheafProjectionWorkerResult: Promise<unknown>;
  }
}

const worker = new Worker(new URL("./projection.worker.ts", import.meta.url), {
  type: "module",
});

window.__sheafProjectionWorkerResult = new Promise<unknown>((resolve, reject) => {
  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    worker.terminate();
    resolve(event.data);
  });
  worker.addEventListener("error", (event) => {
    worker.terminate();
    reject(new Error(event.message));
  });
});

export {};
