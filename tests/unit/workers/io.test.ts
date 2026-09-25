import { expect, it } from "vitest";
import { createIoChannel } from "../../../src/workers/protocol/io-channel.js";
import { receiveBundle } from "../../../src/workers/io/bundle.js";
import { isBundleIdentity, isPrepareBundle } from "../../../src/workers/protocol/io-messages.js";

it("propagates an IO negative acknowledgement through a real MessageChannel", async () => {
  const channel = new MessageChannel();
  const abort = new AbortController();
  let offered = false;
  const close = receiveBundle(channel.port2, () => { offered = true; }, abort.signal);
  try {
    const send = createIoChannel(channel.port1, abort.signal);
    await expect(send({ kind: "finish", identity: { operationId: "x", appId: "y", homeId: "z", artifactSha256: "bad" } })).rejects.toThrow("refused");
    expect(offered).toBe(false);
  } finally { abort.abort(); close(); channel.port1.close(); }
});
it("aborts a stalled peer instead of leaving the transport pending", async () => {
  const channel = new MessageChannel();
  const abort = new AbortController();
  try {
    const pending = createIoChannel(channel.port1, abort.signal)({ kind: "chunk", bytes: new Uint8Array() });
    abort.abort();
    await expect(pending).rejects.toThrow("cancelled");
  } finally { channel.port1.close(); channel.port2.close(); }
});
it("rejects extra key/receipt fields at the dedicated control boundary", () => {
  const identity = { operationId: "op", appId: "app", homeId: "home", artifactSha256: "hash" };
  expect(isBundleIdentity(identity)).toBe(true);
  expect(isBundleIdentity({ ...identity, appKey: new Uint8Array(32) })).toBe(false);
  expect(isPrepareBundle({ ioVersion: 1, kind: "prepareBundle", appId: "app" })).toBe(true);
  expect(isPrepareBundle({ ioVersion: 1, kind: "prepareBundle", appId: "app", confirmedFrontier: [] })).toBe(false);
});

it("disposal rejects a pending page transfer instead of abandoning its promise", async () => {
  const { prepareBundle } = await import("../../../src/workers/protocol/io-client.js");
  const { DataWorkerClient } = await import("../../../src/workers/protocol/client.js");
  const held: MessagePort[] = [];
  const worker = { postMessage(_value: unknown, ports: Transferable[]) { held.push(...ports as MessagePort[]); }, terminate() {} };
  const client = new DataWorkerClient({ spawn: () => worker as unknown as Worker });
  const transfer = prepareBundle(client, worker as unknown as Worker, "app", new AbortController().signal);
  try {
    transfer.dispose();
    await expect(transfer.ready).rejects.toThrow("ended");
    transfer.dispose();
  } finally { client.terminate(); for (const port of held) port.close(); }
});
