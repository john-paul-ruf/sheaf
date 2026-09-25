import { writeFile } from "node:fs/promises";
import { buildPublicationCandidate, readPublicationCandidate, readPublicationObject } from "../../../../src/sync/protocol/publication.js";
import { publicationFixture } from "./publication.js";

export const FIXTURE_FILES = ["head.cbor", "checkpoint.shf", "manifest.shf", "index.shf"] as const;
export async function generateVaultFixture(): Promise<ReadonlyMap<(typeof FIXTURE_FILES)[number], Uint8Array>> {
  const { input, ports } = await publicationFixture();
  try {
    const candidate = await buildPublicationCandidate(input, ports);
    const value = readPublicationCandidate(candidate);
    const signal = new AbortController().signal;
    return new Map([
      ["head.cbor", value.headBytes],
      ["checkpoint.shf", await readPublicationObject(candidate, value.objects[0]!.id, signal)],
      ["manifest.shf", await readPublicationObject(candidate, value.objects[1]!.id, signal)],
      ["index.shf", await readPublicationObject(candidate, value.objects[2]!.id, signal)],
    ]);
  } finally {
    ports.vaultCrypto.destroy(input.vaultKey);
    ports.crypto.destroyKey(input.appKey);
  }
}
/** No caller-controlled directory or filename: regeneration stays in this corpus. */
export async function writeVaultFixture(): Promise<void> {
  const files = await generateVaultFixture();
  for (const name of FIXTURE_FILES) await writeFile(new URL(name, import.meta.url), files.get(name)!);
}
