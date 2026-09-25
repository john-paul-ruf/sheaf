import { afterAll, beforeAll, expect, it } from "vitest";
import { publicationFixture } from "../../../fixtures/vaults/f05/publication.js";
import { buildPublicationCandidate, readPublicationCandidate, readPublicationObject } from "../../../../src/sync/protocol/publication.js";
import { blobChunks, bundleChunks, verifyBundle } from "../../../../src/sync/providers/bundle/format.js";
import { sha256Chunks } from "../../../../src/crypto/hash.js";
import { BUNDLE_TRAILER_BYTES, decodeBundleFooter, decodeBundleTrailer, encodeBundleFooter, encodeBundleTrailer } from "../../../../src/persistence/codecs/vault.js";

const signal = new AbortController().signal;
let fixture: Awaited<ReturnType<typeof publicationFixture>>;
let blob: Blob;
let hash: Uint8Array;
beforeAll(async () => {
  fixture = await publicationFixture();
  const candidate = await buildPublicationCandidate(fixture.input, fixture.ports);
  const parts: Blob[] = [];
  for await (const chunk of bundleChunks({ ...readPublicationCandidate(candidate), read: (id, signal) => readPublicationObject(candidate, id, signal) }, signal)) parts.push(new Blob([new Uint8Array(chunk)]));
  blob = new Blob(parts);
  hash = await sha256Chunks(blobChunks(blob, signal));
});
afterAll(() => { fixture.ports.vaultCrypto.destroy(fixture.input.vaultKey); fixture.ports.vaultCrypto.destroy(fixture.input.appKey); });

it("verifies complete second-pass bytes, sorted offsets and hashes", async () => {
  await expect(verifyBundle(blob, hash, signal)).resolves.toBeUndefined();
  expect(blob.size).toBeGreaterThan(1000);
});
it("rejects truncated, trailing, corrupted and substituted artifact bytes", async () => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const corrupted = bytes.slice(); corrupted[2000] = corrupted[2000]! ^ 1;
  for (const bad of [blob.slice(0, -1), new Blob([blob, "extra"]), new Blob([corrupted])]) {
    await expect(verifyBundle(bad, hash, signal)).rejects.toThrow();
  }
  await expect(verifyBundle(blob, new Uint8Array(32), signal)).rejects.toThrow("authenticated publication");
});
it("rejects directory offset and object-hash counterexamples even with a matching whole-file hash", async () => {
  const length = Number(decodeBundleTrailer(new Uint8Array(await blob.slice(-BUNDLE_TRAILER_BYTES).arrayBuffer())));
  const start = blob.size - BUNDLE_TRAILER_BYTES - length;
  const footer = decodeBundleFooter(new Uint8Array(await blob.slice(start, blob.size - BUNDLE_TRAILER_BYTES).arrayBuffer()));
  for (const entry of [ { ...footer.directory[0]!, byteOffset: 0n }, { ...footer.directory[0]!, ciphertextSha256: new Uint8Array(32) } ]) {
    const changed = encodeBundleFooter({ ...footer, directory: [entry, ...footer.directory.slice(1)] });
    const bad = new Blob([blob.slice(0, start), new Uint8Array(changed), new Uint8Array(encodeBundleTrailer(BigInt(changed.length)))]);
    await expect(verifyBundle(bad, await sha256Chunks(blobChunks(bad, signal)), signal)).rejects.toThrow();
  }
});
it("cancellation fails instead of offering a partial artifact", async () => {
  const aborted = AbortSignal.abort();
  await expect(verifyBundle(blob, hash, aborted)).rejects.toThrow();
});
