import type { FileSaveOutcomeV1 } from "../../application/ports/file-save.js";
import type { DataWorkerClient } from "./client.js";
import { ioRecord, isBundleIdentity, sameBundleIdentity, type BundleIdentityV1 } from "./io-messages.js";

export interface PreparedBundleV1 {
  readonly blob: Blob;
  complete(outcome: FileSaveOutcomeV1): Promise<void>;
}

/** Page receives only a verified encrypted Blob and opaque operation identity. */
export function prepareBundle(client: DataWorkerClient, worker: Worker, appId: string,
  signal: AbortSignal): { ready: Promise<PreparedBundleV1>; dispose: () => void } {
  const bytes = new MessageChannel();
  const control = new MessageChannel();
  let identity: BundleIdentityV1 | undefined;
  let artifact: { blob: Blob; identity: BundleIdentityV1 } | undefined;
  let resolveReady: (value: PreparedBundleV1) => void;
  let rejectReady: (error: Error) => void;
  let completion: { resolve: () => void; reject: (error: Error) => void } | undefined;
  let completed = false;
  let expectedOutcome: FileSaveOutcomeV1 | undefined;
  let disposed = false;
  const ready = new Promise<PreparedBundleV1>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const fail = () => {
    const error = new Error("bundle operation ended");
    rejectReady(error);
    completion?.reject(error);
    dispose();
  };
  const timer = setTimeout(fail, 300_000);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const error = new Error("bundle operation ended");
    rejectReady(error);
    completion?.reject(error);
    completion = undefined;
    artifact = undefined;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    control.port1.onmessage = null;
    clearTimeout(timer);
    signal.removeEventListener("abort", fail);
    control.port1.postMessage({ kind: "cancel" });
    control.port1.close();
    control.port2.close();
    bytes.port1.close();
    bytes.port2.close();
    worker.terminate();
  };
  const checkReady = () => {
    if (identity === undefined || artifact === undefined) return;
    if (!sameBundleIdentity(identity, artifact.identity) || identity.appId !== appId) { fail(); return; }
    resolveReady({ blob: artifact.blob, complete(outcome) {
      if (disposed || completed) return Promise.reject(new Error("stale bundle completion"));
      completed = true;
      expectedOutcome = outcome;
      return new Promise<void>((resolve, reject) => {
        completion = { resolve, reject };
        control.port1.postMessage({ kind: "complete", identity, outcome });
      });
    } });
  };
  worker.onmessage = (event: MessageEvent<unknown>) => {
    try {
      const message = ioRecord(event.data);
      if (Object.keys(message).sort().join() !== "blob,identity,kind" || artifact !== undefined || message["kind"] !== "artifact" || !(message["blob"] instanceof Blob) || !isBundleIdentity(message["identity"])) throw new Error("invalid artifact");
      artifact = { blob: message["blob"], identity: message["identity"] };
      checkReady();
    } catch { fail(); }
  };
  worker.onerror = fail;
  worker.onmessageerror = fail;
  control.port1.onmessage = (event: MessageEvent<unknown>) => {
    try {
      const message = ioRecord(event.data);
      if (!isBundleIdentity(message["identity"])) throw new Error("invalid completion");
      if (message["kind"] === "ready" && Object.keys(message).sort().join() === "identity,kind" && identity === undefined) {
        identity = message["identity"];
        checkReady();
      } else if (message["kind"] === "completed" && message["outcome"] === expectedOutcome && Object.keys(message).sort().join() === "identity,kind,outcome" && completion !== undefined && identity !== undefined && sameBundleIdentity(identity, message["identity"])) {
        completion.resolve();
        completion = undefined;
        dispose();
      } else throw new Error("stale completion");
    } catch { fail(); }
  };
  control.port1.onmessageerror = fail;
  control.port1.start();
  signal.addEventListener("abort", fail, { once: true });
  try {
    signal.throwIfAborted();
    worker.postMessage("bundle-v1", [bytes.port1]);
    client.prepareBundle(appId, bytes.port2, control.port2);
  } catch { fail(); }
  return { ready, dispose };
}
