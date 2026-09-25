import { openBundle } from "../../../../src/sync/providers/bundle/reader.js";
import { createVaultCrypto } from "../../../../src/crypto/vault-port.js";
import { envelopeCryptoAdapter } from "../../../../src/workers/data/import-handlers.js";
import { recoverBackupGraph } from "../../../../src/workers/data/backup-graph.js";
import { encodeBase64Url } from "../../../../src/domain/model/bytes.js";
import { sha256Chunks } from "../../../../src/crypto/hash.js";
import { decodeCanonical, type CborValue } from "../../../../src/persistence/codecs/canonical-cbor.js";

const ports = { crypto: envelopeCryptoAdapter, vaultCrypto: createVaultCrypto({ randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)) }) };
self.onmessage = async ({ data }: MessageEvent<{ bytes: number[]; secret: { kind: "passphrase" | "recovery"; value: string } }>) => {
  try {
    const bundle = await openBundle(new Blob([new Uint8Array(data.bytes)]), data.secret, ports, new AbortController().signal);
    try {
      const app = await bundle.openApp(bundle.index.apps[0]!.appId);
      const signal = new AbortController().signal;
      const graph = await recoverBackupGraph(ports.crypto, app, signal);
      const chunks = [];
      for await (const chunk of graph.canonicalAuthoredState(signal)) chunks.push(...chunk);
      const authored = decodeCanonical(Uint8Array.from(chunks)) as ReadonlyMap<string, CborValue>;
      const theme = decodeCanonical((authored.get("app") as readonly (readonly CborValue[])[])[0]![4] as Uint8Array);
      const semanticSha256 = encodeBase64Url(await sha256Chunks(graph.canonicalAuthoredState(signal), signal));
      const checkpoint = decodeCanonical(await app.read(app.manifest.checkpoint, "app.checkpoint-manifest"));
      const events = [];
      for (const ref of app.manifest.eventSegments) events.push(decodeCanonical(await app.read(ref, "app.event-segment")));
      const json = JSON.stringify({ authored, theme, semanticSha256, kinds: graph.objects.map((object) => object.payloadKind), checkpoint, events, frontier: app.manifest.confirmedFrontier }, (_, value: unknown): unknown =>
        typeof value === "bigint" ? value.toString() : value instanceof Map ? Object.fromEntries(value) : value instanceof Uint8Array ? Array.from(value) : value);
      self.postMessage({ ok: true, result: json });
    } finally { bundle.close(); }
  } catch { self.postMessage({ ok: false }); }
};
