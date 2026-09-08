/**
 * Test-only page module. It is injected into the built page by
 * `toolchain.smoke.spec.ts` and spawns the smoke worker through Vite's worker
 * pipeline, so the pipeline — not a hand-rolled bundle — is what gets proven.
 */
declare global {
  interface Window {
    __sheafSmokeWorkerResult: Promise<unknown>;
  }
}

const worker = new Worker(new URL("./smoke.worker.ts", import.meta.url), {
  type: "module",
});

window.__sheafSmokeWorkerResult = new Promise<unknown>((resolve, reject) => {
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
