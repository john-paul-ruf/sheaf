import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * M12's dependency must-nots, as a test rather than as a review note.
 *
 * Two rules the arch fragment states, both mechanical:
 *
 * - **The projection never reaches storage.** It holds plaintext for one
 *   unlocked app and is handed decoded pages and commits; an import of Dexie,
 *   the envelope store, the UI, the import pipeline, or libsodium would mean it
 *   had started doing someone else's job — and, for the first two, that
 *   plaintext had met the encrypted store inside one module.
 * - **The schema is Genesis-owned.** The only DDL in this program is
 *   `src/migrations/005_projection_v1.sql`, which arrives as a build asset
 *   (CA-06). A `CREATE TABLE` anywhere in this tree would be a second,
 *   divergent schema that no migration governs.
 */

const moduleDirectory = fileURLToPath(
  new URL("../../../src/persistence/projection/", import.meta.url),
);

/** Everything M12 is allowed to depend on, and nothing else. */
const ALLOWED_IMPORTS = [
  "@sqlite.org/sqlite-wasm",
  "../../domain/model/",
  "../../domain/validation/",
  "../codecs/",
  "../../migrations/",
  "./",
];

const FORBIDDEN = [
  { pattern: /(^|[/"'])dexie/i, why: "the projection never opens IndexedDB" },
  { pattern: /envelope-store/, why: "the projection never reads ciphertext" },
  { pattern: /src\/ui\/|\.\.\/ui\//, why: "infrastructure never imports the UI" },
  { pattern: /\/import\//, why: "the projection is not part of the import pipeline" },
  { pattern: /\/sync\//, why: "the projection is not part of sync" },
  { pattern: /libsodium/, why: "SHA-256 is injected, not imported" },
];

const DDL = /\bCREATE\s+(TABLE|INDEX|TRIGGER|VIEW|VIRTUAL\s+TABLE)\b/i;

/**
 * The rules below are about code, so comments are removed first: a doc comment
 * that names `CREATE TABLE` to explain why there is none must not fail the very
 * check it describes.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const importSpecifiers = (source: string): string[] =>
  [...source.matchAll(/^\s*(?:import|export)[\s\S]*?from\s+"([^"]+)"/gm)].map(
    (match) => match[1] as string,
  );

const readModules = async (): Promise<readonly [string, string][]> => {
  const names = (await readdir(moduleDirectory)).filter((name) =>
    name.endsWith(".ts"),
  );
  return Promise.all(
    names.map(
      async (name) =>
        [
          name,
          withoutComments(await readFile(`${moduleDirectory}${name}`, "utf8")),
        ] as const,
    ),
  );
};

const modules = await readModules();

describe("M12 module boundaries", () => {
  it("reads the whole module tree", () => {
    // A scan that found nothing would pass every rule below vacuously.
    expect(modules.length).toBeGreaterThanOrEqual(8);
    expect(modules.map(([name]) => name)).toContain("engine.ts");
  });

  it("imports only the domain, the codecs, the migrations, and SQLite", () => {
    for (const [name, source] of modules) {
      for (const specifier of importSpecifiers(source)) {
        expect(
          ALLOWED_IMPORTS.some((allowed) => specifier.startsWith(allowed)),
          `${name} imports ${specifier}`,
        ).toBe(true);
      }
    }
  });

  it("imports nothing it is forbidden to depend on", () => {
    for (const [name, source] of modules) {
      for (const specifier of importSpecifiers(source)) {
        for (const rule of FORBIDDEN) {
          expect(rule.pattern.test(specifier), `${name}: ${rule.why}`).toBe(
            false,
          );
        }
      }
    }
  });

  it("declares no schema of its own", () => {
    for (const [name, source] of modules) {
      expect(DDL.test(source), `${name} contains DDL`).toBe(false);
    }
  });

  it("takes the schema from the migration asset, exactly once", () => {
    const assetImports = modules.filter(([, source]) =>
      source.includes("005_projection_v1.sql?raw"),
    );

    expect(assetImports.map(([name]) => name)).toEqual(["engine.ts"]);
  });

  it("detects a violation rather than passing whatever it is given", () => {
    // Negative control: the rules above fire on the shapes they exist for.
    expect(DDL.test("CREATE TABLE records (id BLOB);")).toBe(true);
    expect(
      importSpecifiers('import Dexie from "dexie";\n').every((specifier) =>
        ALLOWED_IMPORTS.some((allowed) => specifier.startsWith(allowed)),
      ),
    ).toBe(false);
    expect(FORBIDDEN[0]?.pattern.test("dexie")).toBe(true);
  });
});
