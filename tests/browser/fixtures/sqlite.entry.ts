/**
 * Test-only page module injected by `sqlite.smoke.spec.ts`. It spawns the
 * sqlite probe through Vite's worker pipeline so the pipeline — not a
 * hand-rolled bundle — is what the gate proves.
 */
declare global {
  interface Window {
    __sheafSqliteProbeResult: Promise<unknown>;
  }
}

const worker = new Worker(new URL("./sqlite.worker.ts", import.meta.url), {
  type: "module",
});

window.__sheafSqliteProbeResult = new Promise<unknown>((resolve, reject) => {
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
