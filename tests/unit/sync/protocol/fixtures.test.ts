import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { expect, it } from "vitest";
import { FIXTURE_FILES, generateVaultFixture, writeVaultFixture } from "../../../fixtures/vaults/f05/generate.js";
import { createVaultCrypto } from "../../../../src/crypto/vault-port.js";
import { decodeVaultHeader, decodeVaultIndex, decodeAppManifest } from "../../../../src/persistence/codecs/vault.js";
import { decodeCheckpointManifest } from "../../../../src/import/staging/roots.js";
import { authenticateReference } from "../../../../src/sync/protocol/references.js";
import { crypto, entropy } from "../../../fixtures/vaults/f05/helpers.js";

const read = async (name: (typeof FIXTURE_FILES)[number]): Promise<Uint8Array> =>
  new Uint8Array(await readFile(new URL(`../../../fixtures/vaults/f05/${name}`, import.meta.url)));

it("regenerates byte-identical fixtures and detects a changed known answer", async () => {
  if (process.env["SHEAF_WRITE_F05_FIXTURES"] === "1") await writeVaultFixture();
  const regenerated = await generateVaultFixture();
  expect(regenerated.size).toBe(4);
  for (const name of FIXTURE_FILES) assert.deepEqual(regenerated.get(name), await read(name));
  const corrupted = (await read("index.shf")).slice();
  corrupted[100] = corrupted[100]! ^ 1;
  expect(() => assert.deepEqual(regenerated.get("index.shf"), corrupted)).toThrow();
});

it("opens the fixture from the vault secret alone through the actual crypto and graph codecs", async () => {
  const header = decodeVaultHeader(await read("head.cbor"));
  const port = createVaultCrypto(entropy());
  const vault = await port.openWithPassphrase("F05 fixture passphrase", header.vaultId, header.passphraseKdf, header.passphraseWrappedVaultKey);
  const index = decodeVaultIndex(await authenticateReference(await read("index.shf"), header.currentIndex, "vault.index", vault, crypto));
  const entry = index.apps[0]!;
  const app = await port.openApp(entry.wrappedAppKey, vault, header.vaultId, entry.appId);
  const manifest = decodeAppManifest(await authenticateReference(await read("manifest.shf"), entry.manifest, "vault.app-manifest", app, crypto));
  const checkpoint = decodeCheckpointManifest(await authenticateReference(await read("checkpoint.shf"), manifest.checkpoint, "app.checkpoint-manifest", app, crypto));
  expect(checkpoint.appState.displayName).toBe("PRIVATE-F05-SENTINEL");
  const recovery = await port.openWithRecovery(index.recoveryCodeForReview, header.vaultId, header.recoveryKdf, header.recoveryWrappedVaultKey);
  await expect(port.openApp(entry.wrappedAppKey, recovery, header.vaultId, entry.appId)).resolves.toMatchObject({ purpose: "envelope" });
  await expect(port.openWithPassphrase("F05 fixture passphrase", header.vaultId, { ...header.passphraseKdf, iterations: 4 }, header.passphraseWrappedVaultKey)).rejects.toThrow(/authentication/);
  for (const name of FIXTURE_FILES) expect(new TextDecoder().decode(await read(name))).not.toContain("PRIVATE-F05-SENTINEL");
  port.destroy(app); port.destroy(vault); port.destroy(recovery);
});
