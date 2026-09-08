/**
 * M23/M22's dependency must-nots, as a test rather than a review note
 * (FORGE-CONFIG § Conventions, added after F01).
 *
 * Staging composes crypto and the encrypted store **through injected ports**.
 * That is not a preference: a module that imports M08 pulls libsodium's WASM
 * into every unit run of the cancellation order, and a module that imports M11
 * can open a transaction where database.md § Transaction rule forbids one. The
 * property is "this import can never appear", which no runtime assertion can
 * establish — so it is read off the source.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = (path: string): string =>
  fileURLToPath(new URL(`../../../${path}`, import.meta.url));

const sourcesUnder = (directory: string): readonly string[] => {
  const base = root(directory);
  let entries: readonly string[];
  try {
    entries = readdirSync(base);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".ts") && statSync(`${base}/${name}`).isFile())
    .map((name) => `${directory}/${name}`);
};

const STAGING_SOURCES = [
  ...sourcesUnder("src/import/staging"),
  ...sourcesUnder("src/import/snapshots"),
];

const importedModules = (path: string): readonly string[] =>
  [...readFileSync(root(path), "utf8").matchAll(/from\s+"([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );

describe("staging and snapshots", () => {
  it("has sources to check", () => {
    // A zero-file sweep would pass every assertion below vacuously.
    expect(STAGING_SOURCES.length).toBeGreaterThan(0);
  });

  it("reaches crypto and the store only through src/application/ports", () => {
    for (const file of STAGING_SOURCES) {
      const imports = importedModules(file);
      expect({ file, imports: imports.filter((name) => name.includes("/crypto/")) })
        .toEqual({ file, imports: [] });
      // The *module*, not the port of the same name: reaching
      // `src/application/ports/envelope-store.js` is the approved path.
      expect({
        file,
        imports: imports.filter((name) =>
          name.includes("persistence/envelope-store"),
        ),
      }).toEqual({ file, imports: [] });
      expect({ file, imports: imports.filter((name) => name === "dexie") }).toEqual(
        { file, imports: [] },
      );
    }
  });

  it("imports nothing from the UI or the workers", () => {
    for (const file of STAGING_SOURCES) {
      const imports = importedModules(file);
      expect({ file, imports: imports.filter((name) => name.includes("/ui/")) })
        .toEqual({ file, imports: [] });
      expect({ file, imports: imports.filter((name) => name.includes("/workers/")) })
        .toEqual({ file, imports: [] });
    }
  });
});

describe("the application ports", () => {
  it("declare contracts only: no adapter, no browser, no provider", () => {
    for (const file of sourcesUnder("src/application/ports")) {
      const imports = importedModules(file);
      for (const forbidden of ["/crypto/", "/persistence/", "dexie", "/ui/", "/workers/"]) {
        expect({ file, imports: imports.filter((name) => name.includes(forbidden)) })
          .toEqual({ file, imports: [] });
      }
      // Domain types, DB-phase-owned durable formats (imported rather than
      // restated, Custom Rule 6), and sibling ports.
      // Nothing else: a port that imported an adapter would stop being one.
      expect({
        file,
        outside: imports.filter(
          (name) =>
            !name.startsWith("../../domain/") &&
            !name.startsWith("../../migrations/") &&
            !name.startsWith("./"),
        ),
      }).toEqual({ file, outside: [] });
    }
  });
});
