import { expect, it } from "vitest";
import { authenticateReference, referenceFromLocal } from "../../../../src/sync/protocol/references.js";
import { encodeBase64Url } from "../../../../src/domain/model/bytes.js";
import { crypto, sealed, hash } from "../../../fixtures/vaults/f05/helpers.js";

it("maps actual SHF1 dimensions and ciphertext hashes, never local plaintext hashes (CA-35)", async () => {
  const object = await sealed();
  const local = { storageId: encodeBase64Url(object.frame.storageId), semanticSha256: await crypto.sha256(new Uint8Array([1, 2, 3])) };
  const input = { local, bytes: object.bytes, scope: "app.checkpoint" as const, payloadKind: "app.checkpoint-manifest" as const, key: object.key, crypto };
  const reference = await referenceFromLocal(input);
  expect(reference).toEqual(object.reference);
  expect(reference.logicalRevision).toBe(7n);
  expect(reference.ciphertextSha256).not.toEqual(local.semanticSha256);
  expect(await authenticateReference(object.bytes, reference, input.payloadKind, object.key, crypto)).toEqual(new Uint8Array([1, 2, 3]));
  await expect(referenceFromLocal({ ...input, local: { ...local, semanticSha256: hash(9) } })).rejects.toThrow(/plaintext digest/);
  await expect(referenceFromLocal({ ...input, scope: "app.records" })).rejects.toThrow(/authentication/);
  await expect(referenceFromLocal({ ...input, payloadKind: "app.record-page" })).rejects.toThrow(/expected kind/);
  await expect(authenticateReference(object.bytes, { ...reference, scope: "app.records" }, input.payloadKind, object.key, crypto)).rejects.toThrow(/authentication/);
  await expect(authenticateReference(object.bytes, reference, "app.record-page", object.key, crypto)).rejects.toThrow(/expected kind/);
});
