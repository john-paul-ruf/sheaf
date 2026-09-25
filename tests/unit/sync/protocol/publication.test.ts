import { describe, expect, it } from "vitest";
import { buildPublicationCandidate, readPublicationCandidate, readPublicationObject, publishCandidate } from "../../../../src/sync/protocol/publication.js";
import { encodeVaultHeader, encodeVaultIndex, decodeVaultIndex, decodeAppManifest } from "../../../../src/persistence/codecs/vault.js";
import { authenticateReference } from "../../../../src/sync/protocol/references.js";
import { DurableHomeDouble } from "../../../provider-contract/shared/double.js";
import { publicationFixture } from "../../../fixtures/vaults/f05/publication.js";
import { crypto, id, hash, ref, wrapped } from "../../../fixtures/vaults/f05/helpers.js";
import { encodeBase64Url, asStorageId16 } from "../../../../src/domain/model/bytes.js";
import { serializeEnvelopeTransport } from "../../../../src/persistence/codecs/envelope-frame.js";
const signal = new AbortController().signal;

describe("authenticated publication candidates (CA-34/35/38)", () => {
  it("creates once, authenticates manifest/index, binds exact bytes and increments once on replace", async () => {
    const { input, ports, object } = await publicationFixture();
    const candidate = await buildPublicationCandidate(input, ports);
    const value = readPublicationCandidate(candidate);
    expect(value.header.generation).toBe(1n);
    expect(value.expectedRevision).toBeNull();
    expect(value.header.previousHeadSha256).toBeNull();
    expect(await readPublicationObject(candidate, value.objects[0]!.id, signal)).toEqual(object.bytes);
    expect(value.manifest.totalPaddedBytes).toBe(4096n);
    expect(value.manifest.semanticSha256).toEqual(await ports.hashChunks(input.graph.canonicalAuthoredState(signal), signal));
    expect(value.manifest.semanticSha256).not.toEqual(await crypto.sha256(object.bytes));
    const home = new DurableHomeDouble();
    const confirmed = await publishCandidate(candidate, home, signal, crypto);
    expect(confirmed.snapshot).toEqual(value.snapshot);
    expect(confirmed.receipt.candidateSha256).toEqual(await crypto.sha256(value.headBytes));
    const indexBytes = (await home.readObject(encodeBase64Url(value.header.currentIndex.storageId), signal))!;
    const decodedIndex = decodeVaultIndex(await authenticateReference(indexBytes, value.header.currentIndex, "vault.index", input.vaultKey, crypto));
    expect(decodedIndex).toEqual(value.index);
    const app = decodedIndex.apps[0]!;
    const appKey = await ports.vaultCrypto.openApp(app.wrappedAppKey, input.vaultKey, input.vaultId, app.appId);
    const manifestBytes = (await home.readObject(encodeBase64Url(app.manifest.storageId), signal))!;
    expect(decodeAppManifest(await authenticateReference(manifestBytes, app.manifest, "vault.app-manifest", appKey, crypto))).toEqual(value.manifest);
    const head = (await home.readHead(signal))!;
    const replacement = await buildPublicationCandidate({ ...input, base: { kind: "replace", head, indexBytes }, committedAtMs: 2000n }, ports);
    const next = readPublicationCandidate(replacement);
    expect(next.header.generation).toBe(2n);
    expect(next.header.previousHeadSha256).toEqual(await crypto.sha256(head.bytes));
    expect(next.expectedRevision).toBe(head.revision);
    expect(next.index.previousIndexSha256).toEqual(value.header.currentIndex.ciphertextSha256);
    expect(next.manifest.previousManifestSha256).toEqual(app.manifest.ciphertextSha256);
    await publishCandidate(replacement, home, signal, crypto);
    expect((await home.readHead(signal))!.bytes).toEqual(next.headBytes);
    await expect(publishCandidate(replacement, home, signal, crypto)).rejects.toThrow(/stale/);
  });

  it("preserves other apps, permanent markers and only current-index retention roots", async () => {
    const { input, ports } = await publicationFixture();
    const first = readPublicationCandidate(await buildPublicationCandidate(input, ports));
    const other = { ...first.index.apps[0]!, appId: id(9), displayName: "Other app", wrappedAppKey: wrapped };
    const marker = { markerId: id(10), appId: id(11), deletedAtMs: 900n, deletingDeviceId: id(12), deletionGeneration: 1n, finalManifestSha256: hash(2), finalFrontier: [], retention: "permanent" as const };
    const retained = { generation: 1n, index: first.header.currentIndex, headSha256: await crypto.sha256(first.headBytes) };
    const oldIndex = { ...first.index, generation: 2n, previousIndexSha256: first.header.currentIndex.ciphertextSha256,
      apps: [...first.index.apps, other], deletionMarkers: [marker], retainedGenerationRoots: [retained] };
    const frame = await ports.crypto.seal({ scope: "vault.index", payloadKind: "vault.index", storageId: asStorageId16(id(20)), logicalRevision: 2n,
      payload: encodeVaultIndex(oldIndex), compression: "none", key: input.vaultKey });
    const reference = { ...ref("vault.index", 20, 2n), paddedBytes: frame.paddedBytes, ciphertextSha256: await crypto.sha256(frame.ciphertext) };
    const head = { bytes: encodeVaultHeader({ ...first.header, generation: 2n, currentIndex: reference, previousHeadSha256: retained.headSha256 }), revision: "provider-etag" };
    const base = { kind: "replace" as const, head, indexBytes: serializeEnvelopeTransport(frame) };
    const next = readPublicationCandidate(await buildPublicationCandidate({ ...input, base, committedAtMs: 3000n }, ports));
    expect(next.index.apps[1]).toEqual(other);
    expect(next.index.deletionMarkers).toEqual([marker]);
    expect(next.index.retainedGenerationRoots).toEqual([retained]);
    expect(next.index.createdAtMs).toBe(oldIndex.createdAtMs);
    await expect(buildPublicationCandidate({ ...input, base, graph: { ...input.graph, manifest: { ...input.graph.manifest, appId: marker.appId } } }, ports)).rejects.toThrow(/resurrection/);
  });

  it("rejects missing/extra objects, scope/kind changes and same ciphertext assigned to another app", async () => {
    const { input, ports } = await publicationFixture();
    await expect(buildPublicationCandidate({ ...input, graph: { ...input.graph, objects: [] } }, ports)).rejects.toThrow(/missing/);
    await expect(buildPublicationCandidate({ ...input, graph: { ...input.graph, manifest: { ...input.graph.manifest, appId: id(9) } } }, ports)).rejects.toThrow(/another app/);
    const object = input.graph.objects[0]!;
    await expect(buildPublicationCandidate({ ...input, graph: { ...input.graph, objects: [{ ...object, payloadKind: "app.record-page" }] } }, ports)).rejects.toThrow(/expected kind/);
    await expect(buildPublicationCandidate({ ...input, graph: { ...input.graph, objects: [object, { ...object, reference: { ...object.reference, storageId: id(9) } }] } }, ports)).rejects.toThrow(/extra/);
  });

  it("holds immutable candidate bytes; refuses a forged receipt and interrupted uploads", async () => {
    const { input, ports } = await publicationFixture();
    const candidate = await buildPublicationCandidate(input, ports);
    const copied = readPublicationCandidate(candidate);
    copied.headBytes.fill(0); (await readPublicationObject(candidate, copied.objects[0]!.id, signal)).fill(0);
    expect(readPublicationCandidate(candidate).headBytes).not.toEqual(copied.headBytes);
    const home = new DurableHomeDouble();
    const abort = new AbortController();
    home.beforeUpload = () => { abort.abort(); return Promise.resolve(); };
    await expect(publishCandidate(candidate, home, abort.signal, crypto)).rejects.toThrow();
    expect(await home.readHead(signal)).toBeNull();
    home.beforeUpload = undefined;
    home.compareAndSwapHead = () => Promise.resolve({ candidateSha256: hash(0), revision: "forged" });
    await expect(publishCandidate(candidate, home, signal, crypto)).rejects.toThrow(/receipt/);
    expect(await home.readHead(signal)).toBeNull();
    home.compareAndSwapHead = () => Promise.resolve({ candidateSha256: readPublicationCandidate(candidate).snapshot.candidateSha256, revision: "forged-exact-hash" });
    await expect(publishCandidate(candidate, home, signal, crypto)).rejects.toThrow(/no matching published head/);
    expect(await home.readHead(signal)).toBeNull();
    await expect(publishCandidate({ kind: "vault-publication" }, home, signal, crypto)).rejects.toThrow(/unknown/);
  });

  it("rejects stale or mismatched predecessor before changing the prior head", async () => {
    const { input, ports } = await publicationFixture();
    const candidate = await buildPublicationCandidate(input, ports);
    const value = readPublicationCandidate(candidate);
    const home = new DurableHomeDouble();
    await publishCandidate(candidate, home, signal, crypto);
    const head = (await home.readHead(signal))!;
    const indexBytes = (await home.readObject(encodeBase64Url(value.header.currentIndex.storageId), signal))!;
    await expect(buildPublicationCandidate({ ...input, vaultId: id(9), base: { kind: "replace", head, indexBytes } }, ports)).rejects.toThrow(/another vault/);
    const replacement = await buildPublicationCandidate({ ...input, base: { kind: "replace", head, indexBytes } }, ports);
    await home.compareAndSwapHead(head.revision, new Uint8Array([99]), signal);
    const changed = await home.readHead(signal);
    await expect(publishCandidate(replacement, home, signal, crypto)).rejects.toThrow(/stale/);
    expect(await home.readHead(signal)).toEqual(changed);
  });
});

it("does not return a confirmation when cancellation arrives during head readback", async () => {
  const { input, ports } = await publicationFixture();
  const candidate = await buildPublicationCandidate(input, ports);
  const home = new DurableHomeDouble();
  const abort = new AbortController();
  const readHead = home.readHead.bind(home);
  let reads = 0;
  home.readHead = (signal) => readHead(signal).then((head) => {
    if (++reads === 2) abort.abort();
    return head;
  });
  await expect(publishCandidate(candidate, home, abort.signal, crypto)).rejects.toThrow();
  // CAS already happened; cancellation suppresses confirmation, not remote bytes.
  expect((await readHead(signal))!.bytes).toEqual(readPublicationCandidate(candidate).headBytes);
});

it("processes many batches without retaining loader buffers and rejects changed pinned bytes", async () => {
  const { input, ports, object } = await publicationFixture();
  const originals = new Map([[encodeBase64Url(input.graph.objects[0]!.reference.storageId), object.bytes]]);
  const objects = [...input.graph.objects];
  for (let i = 30; i < 62; i++) {
    const frame = await ports.crypto.seal({ scope: "app.source-chunk", payloadKind: "app.source-chunk", storageId: asStorageId16(id(i)),
      logicalRevision: 1n, payload: new Uint8Array(1024).fill(i), compression: "none", key: input.appKey });
    const reference = { ...ref("app.source-chunk", i), paddedBytes: frame.paddedBytes, ciphertextSha256: await crypto.sha256(frame.ciphertext) };
    objects.push({ reference, payloadKind: "app.source-chunk", children: [] });
    originals.set(encodeBase64Url(frame.storageId), serializeEnvelopeTransport(frame));
  }
  objects[0] = { ...objects[0]!, children: objects.slice(1).map((object) => object.reference) };
  let previous: Uint8Array | undefined;
  let reads = 0;
  const graph = { ...input.graph, objects, readObject: (storageId: Uint8Array) => {
    previous?.fill(0);
    previous = originals.get(encodeBase64Url(storageId))!.slice();
    reads++;
    return Promise.resolve(previous);
  } };
  const candidate = await buildPublicationCandidate({ ...input, graph }, ports, signal);
  expect(reads).toBeGreaterThan(32);
  const value = readPublicationCandidate(candidate);
  expect(value.objects).toHaveLength(35);
  for (const object of objects) {
    const id = encodeBase64Url(object.reference.storageId);
    expect(await readPublicationObject(candidate, id, signal)).toEqual(originals.get(id));
  }
  // Negative control: collecting this producer before consuming its batches
  // loses every buffer except the final one.
  const collected = [];
  for (const object of objects) collected.push(await graph.readObject(object.reference.storageId));
  expect(collected[0]).not.toEqual(originals.get(encodeBase64Url(objects[0].reference.storageId)));
  originals.get(encodeBase64Url(objects[1]!.reference.storageId))!.fill(0);
  await expect(readPublicationObject(candidate, encodeBase64Url(objects[1]!.reference.storageId), signal)).rejects.toThrow(/changed/);
  const abort = new AbortController();
  abort.abort(new Error("cancelled"));
  await expect(buildPublicationCandidate({ ...input, graph }, ports, abort.signal)).rejects.toThrow("cancelled");
});
