/**
 * M34's and M35's dependency must-nots, as a test rather than a review note.
 *
 * Commands and queries reach infrastructure only through
 * `src/application/ports/`. The properties below are "this import can never
 * appear", which no runtime assertion can establish — so these read the
 * sources, comments stripped, exactly as the worker and crypto boundary tests
 * do.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = (path: string): string =>
  fileURLToPath(new URL(`../../../${path}`, import.meta.url));

const sourcesIn = (directory: string): readonly string[] =>
  readdirSync(root(directory))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `${directory}${name}`);

/** Comments stripped: a spec citation naming a module is not an import. */
const code = (path: string): string =>
  readFileSync(root(path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const importedModules = (text: string): readonly string[] =>
  [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

const COMMANDS = sourcesIn("src/application/commands/");
const QUERIES = sourcesIn("src/application/queries/");
const PORTS = sourcesIn("src/application/ports/");

const FORBIDDEN = [
  "src/persistence/",
  "/persistence/",
  "src/crypto/",
  "/crypto/",
  "src/workers/",
  "/workers/",
  "src/ui/",
  "/ui/",
  "src/import/",
  "/import/",
  "dexie",
  "react",
  "sqlite",
] as const;

describe("commands and queries", () => {
  it("were actually found — an empty sweep would pass every assertion below", () => {
    expect(COMMANDS.length).toBeGreaterThanOrEqual(2);
    expect(QUERIES.length).toBeGreaterThanOrEqual(2);
    expect(COMMANDS).toContain("src/application/commands/execute-command.ts");
    expect(QUERIES).toContain("src/application/queries/records.ts");
  });

  it("import no infrastructure, no worker, and no UI — only ports and the domain", () => {
    for (const file of [...COMMANDS, ...QUERIES]) {
      for (const specifier of importedModules(code(file))) {
        for (const forbidden of FORBIDDEN) {
          expect({ file, specifier, ok: !specifier.includes(forbidden) }).toEqual({
            file,
            specifier,
            ok: true,
          });
        }
      }
    }
  });

  it("reach the effectful world only through src/application/ports/", () => {
    for (const file of [...COMMANDS, ...QUERIES]) {
      for (const specifier of importedModules(code(file))) {
        const isDomain = specifier.includes("/domain/");
        const isPort =
          specifier.includes("/ports/") || specifier.startsWith("./");
        const isMigration = specifier.includes("/migrations/");
        expect({ file, specifier, ok: isDomain || isPort || isMigration }).toEqual({
          file,
          specifier,
          ok: true,
        });
      }
    }
  });
});

describe("the ports", () => {
  it("declare interfaces over the domain, never over an implementation", () => {
    for (const file of PORTS) {
      for (const specifier of importedModules(code(file))) {
        // A port may name a DB-owned durable format (migrations) and the pure
        // domain. It may not name the module that implements it.
        const allowed =
          specifier.includes("/domain/") ||
          specifier.includes("/migrations/") ||
          specifier.startsWith("./");
        expect({ file, specifier, ok: allowed }).toEqual({
          file,
          specifier,
          ok: true,
        });
      }
    }
  });

  it("name no SQLite, Dexie, or crypto symbol at all", () => {
    for (const file of PORTS) {
      const source = code(file);
      for (const forbidden of ["sqlite", "Dexie", "dexie", "libsodium", "SecretKeyHandle"]) {
        expect({ file, forbidden, ok: !source.includes(forbidden) }).toEqual({
          file,
          forbidden,
          ok: true,
        });
      }
    }
  });
});
