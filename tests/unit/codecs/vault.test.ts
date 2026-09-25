import { describe, expect, it } from "vitest";
import { encodeCanonical } from "../../../src/persistence/codecs/canonical-cbor.js";
import { encodeVaultHeader, decodeVaultHeader, encodeVaultIndex, decodeVaultIndex, encodeAppManifest, decodeAppManifest,
  encodeBundleFooter, decodeBundleFooter, vaultValue, encodeBundlePreamble, decodeBundlePreamble, encodeBundleTrailer,
  decodeBundleTrailer, assertBundleDirectoryBounds, assertIndexMatchesHeader, assertManifestMatchesEntry } from "../../../src/persistence/codecs/vault.js";
import { header, index, manifest, id, hash, ref, wrapped } from "../../fixtures/vaults/f05/helpers.js";

describe("migration 006 canonical contracts", () => {
  it("round trips exact canonical bytes without losing unknown count vs zero", () => {
    const app = { appId: id(2), displayName: "Private", wrappedAppKey: wrapped, manifest: ref("vault.app-manifest"), lastSuccessfulBackupMs: 10n, totalPaddedBytes: 4096n, appSchemaRevision: 1n, confirmedFrontier: [] };
    for (const entry of [app, { ...app, recordCount: 0n }]) {
      const source = { ...index(), apps: [entry] };
      const encoded = encodeVaultIndex(source);
      expect(decodeVaultIndex(encoded)).toEqual(source);
      expect(encodeVaultIndex(decodeVaultIndex(encoded))).toEqual(encoded);
    }
    expect(encodeVaultHeader(decodeVaultHeader(encodeVaultHeader(header())))).toEqual(encodeVaultHeader(header()));
    expect(encodeAppManifest(decodeAppManifest(encodeAppManifest(manifest())))).toEqual(encodeAppManifest(manifest()));
  });
  it("rejects duplicate/unknown fields, future versions, invalid dimensions and predecessor", () => {
    expect(() => decodeVaultHeader(new Uint8Array([0xa2, 0x61, 0x61, 0x01, 0x61, 0x61, 0x02]))).toThrow(/duplicate/);
    for (const value of [{ ...header(), critical: true }, { ...header(), minimumReaderVersion: 2 },
      { ...header(), vaultId: id(1).slice(1) }, { ...header(), generation: 2n },
      { ...header(), passphraseKdf: { ...header().passphraseKdf, memoryKiB: 1 } },
      { ...header(), currentIndex: { ...header().currentIndex, paddedBytes: 4097 } }]) {
      expect(() => decodeVaultHeader(encodeCanonical(vaultValue(value)))).toThrow();
    }
  });
  it("rejects scope substitutions, unordered/duplicate frontiers and references", () => {
    for (const value of [{ ...manifest(), checkpoint: ref("app.events") },
      { ...manifest(), eventSegments: [ref("app.events"), ref("app.events")] },
      { ...manifest(), confirmedFrontier: [{ deviceId: id(2), commitSequence: 1n }, { deviceId: id(1), commitSequence: 1n }] },
      { ...manifest(), confirmedFrontier: [{ deviceId: id(1), commitSequence: 0n }] }]) {
      expect(() => decodeAppManifest(encodeCanonical(vaultValue(value)))).toThrow();
    }
  });
  it("checks vault/app/generation identity and permanent deletion markers", () => {
    expect(() => assertIndexMatchesHeader(header(), { ...index(), vaultId: id(9) })).toThrow(/identity/);
    expect(() => assertIndexMatchesHeader(header(), { ...index(), generation: 2n })).toThrow(/identity/);
    const app = { appId: id(2), displayName: "Private", wrappedAppKey: wrapped, manifest: ref("vault.app-manifest"), lastSuccessfulBackupMs: 10n, totalPaddedBytes: 4096n, appSchemaRevision: 1n, confirmedFrontier: [] };
    expect(() => assertManifestMatchesEntry(app, { ...manifest(), appId: id(8) })).toThrow(/identity/);
    expect(() => encodeVaultIndex({ ...index(), apps: [app], deletionMarkers: [{ markerId: id(5), appId: id(2), deletingDeviceId: id(6), deletedAtMs: 1n, deletionGeneration: 1n, finalManifestSha256: hash(7), finalFrontier: [], retention: "permanent" }] })).toThrow(/resurrection/);
  });
  it("bounds bundle framing and rejects gaps, overlaps, trailing and duplicate entries", () => {
    expect(decodeBundlePreamble(encodeBundlePreamble(400))).toBe(400);
    expect(decodeBundleTrailer(encodeBundleTrailer(500n))).toBe(500n);
    expect(() => decodeBundleTrailer(new Uint8Array(17))).toThrow();
    const entry = { storageId: id(1), byteOffset: 100n, byteLength: 4158n, ciphertextSha256: hash(1) };
    const footer = { vaultFormatVersion: 1 as const, complete: true as const, directorySha256: hash(2), directory: [entry] };
    expect(decodeBundleFooter(encodeBundleFooter(footer))).toEqual(footer);
    expect(() => assertBundleDirectoryBounds(footer, 100n, 4258n)).not.toThrow();
    for (const byteOffset of [99n, 101n, 5000n]) expect(() => assertBundleDirectoryBounds({ ...footer, directory: [{ ...entry, byteOffset }] }, 100n, 4258n)).toThrow();
    expect(() => assertBundleDirectoryBounds(footer, 100n, 4259n)).toThrow();
    expect(() => encodeBundleFooter({ ...footer, directory: [entry, entry] })).toThrow(/duplicate/);
  });
});
