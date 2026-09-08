import sodium from "libsodium-wrappers-sumo";
import { SMOKE_WORKER_INPUT } from "./smoke-input.js";

const scope = globalThis as unknown as {
  postMessage(message: unknown): void;
};

async function reportDigest(): Promise<void> {
  await sodium.ready;
  scope.postMessage({
    hash: sodium.crypto_generichash(32, SMOKE_WORKER_INPUT, null, "hex"),
  });
}

void reportDigest().catch((cause: unknown) => {
  scope.postMessage({ error: String(cause) });
});
