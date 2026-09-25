import type { EnvelopeCryptoPort } from "../../../application/ports/envelope-crypto.js";
import type { VaultCryptoPort, VaultKeyRefV1 } from "../../../application/ports/vault-crypto.js";
import { constantTimeEquals, encodeBase64Url } from "../../../domain/model/bytes.js";
import { IntegrityError } from "../../../domain/model/errors.js";
import { sha256Chunks } from "../../../crypto/hash.js";
import type { EnvelopePayloadKindV1, EnvelopeReferenceV1 } from "../../../migrations/003_envelope_format_v1.js";
import { assertIndexMatchesHeader, BUNDLE_PREAMBLE_BYTES, BUNDLE_TRAILER_BYTES, decodeAppManifest,
  decodeBundleFooter, decodeBundlePreamble, decodeBundleTrailer, decodeVaultHeader, decodeVaultIndex } from "../../../persistence/codecs/vault.js";
import { authenticateReference } from "../../protocol/references.js";
import { blobChunks, verifyBundle } from "./format.js";

/** A read-only artifact reader. No local root, catalog, or device storage is used. */
export async function openBundle(blob: Blob, secret: { readonly kind: "passphrase" | "recovery"; readonly value: string },
  ports: { readonly crypto: EnvelopeCryptoPort; readonly vaultCrypto: VaultCryptoPort }, signal: AbortSignal) {
  await verifyBundle(blob, await sha256Chunks(blobChunks(blob, signal), signal), signal);
  const bytes = async (start: number, end: number) => {
    signal.throwIfAborted();
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  };
  const size = decodeBundlePreamble(await bytes(0, BUNDLE_PREAMBLE_BYTES));
  const header = decodeVaultHeader(await bytes(BUNDLE_PREAMBLE_BYTES, BUNDLE_PREAMBLE_BYTES + size));
  const footerSize = decodeBundleTrailer(await bytes(blob.size - BUNDLE_TRAILER_BYTES, blob.size));
  const footer = decodeBundleFooter(await bytes(blob.size - BUNDLE_TRAILER_BYTES - Number(footerSize), blob.size - BUNDLE_TRAILER_BYTES));
  const directory = new Map(footer.directory.map((entry) => [encodeBase64Url(entry.storageId), entry]));
  let closed = false;
  const read = async (reference: EnvelopeReferenceV1) => {
    if (closed) throw new IntegrityError("bundle reader is closed");
    const entry = directory.get(encodeBase64Url(reference.storageId));
    if (entry === undefined || !constantTimeEquals(entry.ciphertextSha256, reference.ciphertextSha256)) throw new IntegrityError("bundle reference missing or substituted");
    return bytes(Number(entry.byteOffset), Number(entry.byteOffset + entry.byteLength));
  };
  let key: VaultKeyRefV1 | undefined;
  const appKeys = new Set<Awaited<ReturnType<VaultCryptoPort["openApp"]>>>();
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", close);
    for (const appKey of appKeys) ports.vaultCrypto.destroy(appKey);
    appKeys.clear();
    if (key !== undefined) ports.vaultCrypto.destroy(key);
  };
  try {
    key = secret.kind === "passphrase"
      ? await ports.vaultCrypto.openWithPassphrase(secret.value, header.vaultId, header.passphraseKdf, header.passphraseWrappedVaultKey)
      : await ports.vaultCrypto.openWithRecovery(secret.value, header.vaultId, header.recoveryKdf, header.recoveryWrappedVaultKey);
    signal.throwIfAborted();
    const index = decodeVaultIndex(await authenticateReference(await read(header.currentIndex), header.currentIndex, "vault.index", key, ports.crypto));
    assertIndexMatchesHeader(header, index);
    signal.addEventListener("abort", close, { once: true });
    return {
      header, index, close,
      async openApp(appId: Uint8Array) {
        signal.throwIfAborted();
        if (closed) throw new IntegrityError("bundle reader is closed");
        const entry = index.apps.find((app) => constantTimeEquals(app.appId, appId));
        if (entry === undefined) throw new IntegrityError("app is not in this bundle");
        const appKey = await ports.vaultCrypto.openApp(entry.wrappedAppKey, key!, header.vaultId, appId);
        if (closed || signal.aborted) { ports.vaultCrypto.destroy(appKey); throw new IntegrityError("bundle reader is closed"); }
        appKeys.add(appKey);
        try {
          const manifest = decodeAppManifest(await authenticateReference(await read(entry.manifest), entry.manifest, "vault.app-manifest", appKey, ports.crypto));
          if (!constantTimeEquals(manifest.appId, appId) || manifest.generation > header.generation) throw new IntegrityError("bundle manifest identity mismatch");
          return { manifest, read: async (reference: EnvelopeReferenceV1, kind: EnvelopePayloadKindV1) =>
            authenticateReference(await read(reference), reference, kind, appKey, ports.crypto) };
        } catch (error) { appKeys.delete(appKey); ports.vaultCrypto.destroy(appKey); throw error; }
      },
    };
  } catch (error) { close(); throw error; }
}
