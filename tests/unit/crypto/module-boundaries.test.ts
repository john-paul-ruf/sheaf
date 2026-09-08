import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createSecretKey, destroySecretKey } from "../../../src/crypto/keys.js";

const readSources = async (directory: string): Promise<Map<string, string>> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = new Map<string, string>();
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      for (const [nested, source] of await readSources(path)) {
        sources.set(nested, source);
      }
    } else if (entry.name.endsWith(".ts")) {
      sources.set(path, await readFile(path, "utf8"));
    }
  }
  return sources;
};

describe("module boundaries", () => {
  it("keeps persistence and provider types out of crypto and codecs", async () => {
    const sources = new Map([
      ...(await readSources("src/crypto")),
      ...(await readSources("src/persistence/codecs")),
    ]);
    expect(sources.size).toBeGreaterThan(5);

    for (const [path, source] of sources) {
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map(
        (match) => match[1] as string,
      );
      for (const specifier of imports) {
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(/dexie/i);
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(
          /envelope-store/,
        );
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(/\/ui\//);
      }
    }
  });

  it("keeps codecs free of every third-party dependency (D2)", async () => {
    for (const [path, source] of await readSources("src/persistence/codecs")) {
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map(
        (match) => match[1] as string,
      );
      for (const specifier of imports) {
        expect(specifier, `${path} imports ${specifier}`).toMatch(/^\.\.?\//);
      }
    }
  });

  it("names the internal key-byte accessors only inside src/crypto", async () => {
    const outside = [...(await readSources("src"))].filter(
      ([path]) => !path.startsWith("src/crypto/"),
    );
    expect(outside.length).toBeGreaterThan(3);

    for (const [path, source] of outside) {
      expect(source, path).not.toContain("readKeyBytes");
      expect(source, path).not.toContain("hkdfSha256");
    }
  });

  it("exposes no key bytes on a handle", () => {
    const handle = createSecretKey(new Uint8Array(32).fill(7), "envelope");

    expect(Object.keys(handle)).toEqual(["purpose"]);
    expect(Object.getOwnPropertyNames(handle)).toEqual(["purpose"]);
    expect(JSON.stringify(handle)).toBe('{"purpose":"envelope"}');
    expect(structuredClone(handle)).toEqual({ purpose: "envelope" });
    expect(Object.isFrozen(handle)).toBe(true);

    destroySecretKey(handle);
    expect(() => createSecretKey(new Uint8Array(31), "envelope")).toThrow(
      /32 bytes/,
    );
  });
});
