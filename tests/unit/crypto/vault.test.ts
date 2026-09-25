import { describe, expect, it } from "vitest";
import { createSecretKey, destroySecretKey, generateLocalRoot } from "../../../src/crypto/keys.js";
import { createPassphraseKdfDescriptor, deriveWrappingKeyFromPassphrase, deriveVaultPassphraseKey, deriveVaultRecoveryKey } from "../../../src/crypto/kdf.js";
import { createVaultSecrets, openLocalVaultKey, protectVaultKeyLocally, unwrapAppKey, unwrapVaultKey, wrapAppKey } from "../../../src/crypto/vault.js";
import { decryptEnvelope, encryptEnvelope } from "../../../src/crypto/envelope.js";
import { generateRecoveryCode, parseRecoveryCode } from "../../../src/crypto/recovery-code.js";
import { asStorageId16 } from "../../../src/domain/model/bytes.js";
import type { EntropyPort } from "../../../src/application/ports/entropy.js";

const entropy = (): EntropyPort => {
  let offset = 0;
  return { randomBytes: (length) => Uint8Array.from({ length }, () => offset++ % 256) };
};
const id = (n: number) => new Uint8Array(16).fill(n);

describe("independent vault protection (CA-34)", () => {
  it("wraps the existing app handle without changing any scratch ciphertext", async () => {
    const random = entropy();
    const vault = await createVaultSecrets("same human passphrase", id(1), random);
    const local = generateLocalRoot(random);
    const app = createSecretKey(new Uint8Array(32).fill(9), "envelope");
    const frame = await encryptEnvelope({ scope: "app.records", storageId: asStorageId16(id(4)),
      logicalRevision: 7n, payloadKind: "app.record-page", payload: new Uint8Array([1, 2]), compression: "none", key: app });
    const before = frame.ciphertext.slice();
    const wrapped = await wrapAppKey(app, vault.key, id(1), id(2), random);
    const opened = await unwrapAppKey(wrapped, vault.key, id(1), id(2));
    expect((await decryptEnvelope(frame, "app.records", opened, "app.record-page")).payload).toEqual(new Uint8Array([1, 2]));
    expect(frame.ciphertext).toEqual(before);
    expect(Object.keys(vault.key)).toEqual(["purpose"]);
    const protectedKey = await protectVaultKeyLocally(vault.key, local, id(1), random);
    const restored = await openLocalVaultKey(protectedKey, local, id(1));
    await expect(unwrapAppKey(wrapped, restored, id(1), id(2))).resolves.toMatchObject({ purpose: "envelope" });
    await expect(unwrapAppKey(wrapped, vault.key, id(1), id(3))).rejects.toThrow(/authentication/);
    await expect(unwrapAppKey(wrapped, vault.key, id(3), id(2))).rejects.toThrow(/authentication/);
    await expect(openLocalVaultKey(protectedKey, local, id(3))).rejects.toThrow(/authentication/);
    destroySecretKey(restored);
    await expect(unwrapAppKey(wrapped, restored, id(1), id(2))).rejects.toThrow(/destroyed/);
  });

  it("uses independent salts, contexts and recovery secrets; rejects wrong secret and altered KDF", async () => {
    const random = entropy();
    const localKdf = createPassphraseKdfDescriptor(random);
    const localCode = await generateRecoveryCode(random);
    const vault = await createVaultSecrets("passphrase", id(1), random);
    expect(Buffer.from(vault.passphraseWrappedVaultKey.ciphertext).toString("hex")).toMatchInlineSnapshot(`"55a733e7967a59b6af6c353057e262ad193ef41307001a57f017462deb8d18a0ff0ef3895c773fb5a718dd53f45d500c"`);
    expect(vault.passphraseKdf.salt).not.toEqual(new Uint8Array(localKdf.salt));
    expect(vault.passphraseKdf.salt).not.toEqual(vault.recoveryKdf.salt);
    expect(vault.recoveryCode).not.toBe(localCode);
    const passKey = await deriveVaultPassphraseKey("passphrase", vault.passphraseKdf);
    const recKey = await deriveVaultRecoveryKey(await parseRecoveryCode(vault.recoveryCode), vault.recoveryKdf);
    await expect(unwrapVaultKey(vault.passphraseWrappedVaultKey, passKey, id(1), vault.passphraseKdf)).resolves.toMatchObject({ purpose: "vault-root" });
    await expect(unwrapVaultKey(vault.recoveryWrappedVaultKey, recKey, id(1), vault.recoveryKdf)).resolves.toMatchObject({ purpose: "vault-root" });
    await expect(unwrapVaultKey(vault.passphraseWrappedVaultKey, await deriveVaultPassphraseKey("wrong", vault.passphraseKdf), id(1), vault.passphraseKdf)).rejects.toThrow(/authentication/);
    await expect(unwrapVaultKey(vault.recoveryWrappedVaultKey, await deriveVaultRecoveryKey(await parseRecoveryCode(localCode), vault.recoveryKdf), id(1), vault.recoveryKdf)).rejects.toThrow(/authentication/);
    await expect(unwrapVaultKey(vault.passphraseWrappedVaultKey, passKey, id(1), { ...vault.passphraseKdf, iterations: 4 })).rejects.toThrow(/authentication/);
    await expect(unwrapVaultKey(vault.passphraseWrappedVaultKey, await deriveWrappingKeyFromPassphrase("passphrase", localKdf), id(1), vault.passphraseKdf)).rejects.toThrow(/purpose/);
    for (const field of ["wrapId", "nonce", "ciphertext"] as const) {
      const changed = vault.passphraseWrappedVaultKey[field].slice();
      changed[0] = changed[0]! ^ 1;
      await expect(unwrapVaultKey({ ...vault.passphraseWrappedVaultKey, [field]: changed }, passKey, id(1), vault.passphraseKdf)).rejects.toThrow(/authentication/);
    }
  });

  it("rejects local context descriptors and malformed recovery input", async () => {
    const vault = await createVaultSecrets("p", id(1), entropy());
    await expect(deriveVaultPassphraseKey("p", { ...vault.passphraseKdf, context: "sheaf/local/passphrase/v1" as never })).rejects.toThrow(/context/);
    await expect(deriveVaultRecoveryKey(new Uint8Array(31), vault.recoveryKdf)).rejects.toThrow(/suite/);
    await expect(deriveVaultPassphraseKey("p", { ...vault.passphraseKdf, iterations: 2 })).rejects.toThrow(/floor/);
  });
});
