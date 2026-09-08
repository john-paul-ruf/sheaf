import sodium from "libsodium-wrappers-sumo";

/**
 * S01-owned worker. It exists so the harness worker path is provable from
 * built output before any `src/workers/` module exists.
 */
const PROBE_INPUT = "sheaf-harness-probe";

const scope = globalThis as unknown as {
  postMessage(message: unknown): void;
};

async function reportDigest(): Promise<void> {
  await sodium.ready;
  scope.postMessage({
    input: PROBE_INPUT,
    hash: sodium.crypto_generichash(32, PROBE_INPUT, null, "hex"),
  });
}

void reportDigest().catch((cause: unknown) => {
  scope.postMessage({ error: String(cause) });
});
