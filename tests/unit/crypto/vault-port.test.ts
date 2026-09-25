import { expect, it } from "vitest";
import { createVaultCrypto } from "../../../src/crypto/vault-port.js";
import { entropy, id } from "../../fixtures/vaults/f05/helpers.js";
import { createSecretKey, generateLocalRoot } from "../../../src/crypto/keys.js";
it("opens both independent secrets through the opaque production port and fails closed after destruction", async () => {
  const random = entropy();
  const port = createVaultCrypto(random);
  const vault = await port.create("passphrase", id(1));
  const local = generateLocalRoot(random);
  const app = createSecretKey(new Uint8Array(32), "envelope");
  const wrappedApp = await port.wrapApp(app, vault.key, id(1), id(2));
  const pass = await port.openWithPassphrase("passphrase", id(1), vault.passphraseKdf, vault.passphraseWrappedVaultKey);
  const recovery = await port.openWithRecovery(vault.recoveryCode, id(1), vault.recoveryKdf, vault.recoveryWrappedVaultKey);
  const localVault = await port.openLocally(await port.protectLocally(vault.key, local, id(1)), local, id(1));
  for (const key of [pass, recovery, localVault]) {
    await expect(port.openApp(wrappedApp, key, id(1), id(2))).resolves.toMatchObject({ purpose: "envelope" });
    port.destroy(key);
    await expect(port.openApp(wrappedApp, key, id(1), id(2))).rejects.toThrow(/destroyed/);
  }
  await expect(port.openWithPassphrase("wrong", id(1), vault.passphraseKdf, vault.passphraseWrappedVaultKey)).rejects.toThrow(/authentication/);
});
