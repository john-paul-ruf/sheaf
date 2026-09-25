import { writeFile } from "node:fs/promises";
import { buildPublicationCandidate, readPublicationCandidate } from "../../../../src/sync/protocol/publication.js";
import { publicationFixture } from "./publication.js";

export const FIXTURE_FILES = ["head.cbor", "checkpoint.shf", "manifest.shf", "index.shf"] as const;
export async function generateVaultFixture(): Promise<ReadonlyMap<(typeof FIXTURE_FILES)[number], Uint8Array>> {
  const { input, ports } = await publicationFixture();
  try {
    const value = readPublicationCandidate(await buildPublicationCandidate(input, ports));
    return new Map([
      ["head.cbor", value.headBytes],
      ["checkpoint.shf", value.objects[0]!.bytes],
      ["manifest.shf", value.objects[1]!.bytes],
      ["index.shf", value.objects[2]!.bytes],
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
