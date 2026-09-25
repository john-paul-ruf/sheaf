import { receiveBundle } from "./io/bundle.js";

const scope = globalThis as unknown as {
  postMessage(value: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
};
let close: (() => void) | undefined;
scope.addEventListener("message", (event) => {
  if (event.data !== "bundle-v1" || event.ports.length !== 1 || close !== undefined) return;
  close = receiveBundle(event.ports[0]!, (blob, identity) => {
    scope.postMessage({ kind: "artifact", blob, identity });
  }, new AbortController().signal);
});
