import { expect, it } from "vitest";
import { DurableHomeDouble } from "../../../provider-contract/shared/double.js";
import { encodeBase64Url } from "../../../../src/domain/model/bytes.js";
import { sha256 } from "../../../../src/crypto/hash.js";
import { sealed } from "../../../fixtures/vaults/f05/helpers.js";
const signal = new AbortController().signal;

it("has exactly one CAS winner; stale/create-if-absent failures change nothing (CA-38)", async () => {
  const home = new DurableHomeDouble();
  const results = await Promise.allSettled([home.compareAndSwapHead(null, new Uint8Array([1]), signal), home.compareAndSwapHead(null, new Uint8Array([2]), signal)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const before = await home.readHead(signal);
  await expect(home.compareAndSwapHead("stale", new Uint8Array([3]), signal)).rejects.toThrow(/CAS conflict/);
  expect(await home.readHead(signal)).toEqual(before);
  const receipt = await home.compareAndSwapHead(before!.revision, new Uint8Array([4]), signal);
  expect(receipt.candidateSha256).toEqual(await sha256(new Uint8Array([4])));
  expect(await new DurableHomeDouble().readHead(signal)).toBeNull();
});
it("interrupted and conflicting immutable uploads never change the head", async () => {
  const home = new DurableHomeDouble();
  await home.compareAndSwapHead(null, new Uint8Array([1]), signal);
  const before = await home.readHead(signal);
  const object = await sealed();
  const id = encodeBase64Url(object.frame.storageId);
  const abort = new AbortController();
  home.beforeUpload = () => { abort.abort(); return Promise.resolve(); };
  await expect(home.createObject(id, object.bytes, abort.signal)).rejects.toThrow();
  expect(await home.readObject(id, signal)).toBeNull();
  home.beforeUpload = undefined;
  await home.createObject(id, object.bytes, signal);
  await home.createObject(id, object.bytes, signal);
  const corrupt = object.bytes.slice(); corrupt[100] = corrupt[100]! ^ 1;
  await expect(home.createObject(id, corrupt, signal)).rejects.toThrow(/immutable/);
  expect(await home.readObject(id, signal)).toEqual(object.bytes);
  expect(await home.readHead(signal)).toEqual(before);
});
