import { decodeBase64Url } from "../../domain/model/bytes.js";
import { verifyBundle } from "../../sync/providers/bundle/format.js";
import { ioRecord, isBundleIdentity, type BundleIdentityV1 } from "../protocol/io-messages.js";

/** Receives ciphertext only; no store, record, vault key or app key. */
export function receiveBundle(port: MessagePort,
  offer: (blob: Blob, identity: BundleIdentityV1) => void, signal: AbortSignal): () => void {
  let seq = 0;
  let busy = false;
  let ended = false;
  const parts: Blob[] = [];
  const close = () => { ended = true; parts.length = 0; port.close(); signal.removeEventListener("abort", close); };
  signal.addEventListener("abort", close, { once: true });
  port.onmessage = (event: MessageEvent<unknown>) => { void dispatch(event.data); };
  port.start();
  async function dispatch(value: unknown) {
    let received = -1;
    try {
      signal.throwIfAborted();
      const data = ioRecord(value);
      received = Number(data["seq"]);
      if (ended || busy || data["ioVersion"] !== 1 || received !== seq++) throw new Error("IO sequence mismatch");
      busy = true;
      if (data["kind"] === "chunk" && Object.keys(data).sort().join() === "bytes,ioVersion,kind,seq" && data["bytes"] instanceof Uint8Array) {
        parts.push(new Blob([new Uint8Array(data["bytes"])]));
      } else if (data["kind"] === "finish" && Object.keys(data).sort().join() === "identity,ioVersion,kind,seq" && isBundleIdentity(data["identity"])) {
        const blob = new Blob(parts, { type: "application/octet-stream" });
        await verifyBundle(blob, decodeBase64Url(data["identity"].artifactSha256), signal);
        signal.throwIfAborted();
        if (ended) throw new Error("IO operation ended");
        offer(blob, data["identity"]);
        ended = true;
        parts.length = 0;
      } else throw new Error("invalid IO message");
      port.postMessage({ ioVersion: 1, seq: received, ok: true });
    } catch {
      port.postMessage({ ioVersion: 1, seq: received, ok: false });
      close();
    } finally { busy = false; }
  }
  if (signal.aborted) close();
  return close;
}
