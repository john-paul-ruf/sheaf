/**
 * Architecture compliance for M11 (FORGE-CONFIG § Architecture, arch/M11).
 *
 * The store is the only module allowed to know Dexie, and it may know nothing
 * about plaintext: no UI, no application layer, no crypto internals, and no
 * exported signature that accepts a decoded domain object.
 */

import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const DIRECTORY = "src/persistence/envelope-store";

const readSources = async (): Promise<Map<string, string>> => {
  const sources = new Map<string, string>();
  for (const entry of await readdir(DIRECTORY, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      sources.set(entry.name, await readFile(`${DIRECTORY}/${entry.name}`, "utf8"));
    }
  }
  return sources;
};

const importsOf = (source: string): string[] =>
  [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] as string);

describe("envelope store boundaries", () => {
  it("imports only Dexie, migrations, codecs, and domain model", async () => {
    const sources = await readSources();
    expect(sources.size).toBeGreaterThan(6);

    for (const [name, source] of sources) {
      for (const specifier of importsOf(source)) {
        expect(specifier, `${name} imports ${specifier}`).toMatch(
          /^(dexie|\.\.?\/.*)$/,
        );
        expect(specifier, `${name} imports ${specifier}`).not.toMatch(
          /\/(ui|application|workers|routes|import|sync|export)\//,
        );
        expect(specifier, `${name} imports ${specifier}`).not.toMatch(
          /crypto\/(keys|kdf|sodium|recovery-code)/,
        );
      }
    }
  });

  it("keeps Dexie inside the module's own files", async () => {
    const dexieImporters = [...(await readSources())]
      .filter(([, source]) => importsOf(source).includes("dexie"))
      .map(([name]) => name);

    expect(dexieImporters.sort()).toEqual(["db.ts", "read.ts", "reset.ts"]);
  });

  it("names no plaintext type in an exported signature", async () => {
    for (const [name, source] of await readSources()) {
      const exported = source.match(/export (?:async )?function [^{]+/g) ?? [];
      expect(exported.length, name).toBeGreaterThan(0);
      for (const signature of exported) {
        expect(signature, `${name}: ${signature}`).not.toMatch(
          /LocalCatalog|DecryptedEnvelope|EnvelopePlaintext|SecretKey|payload/i,
        );
      }
    }
  });
});
