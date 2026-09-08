import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * M01 and M02 are the pure domain: they import nothing outward and nothing
 * third-party. FORGE-CONFIG § Conventions — "a dependency must-not ships as a
 * test, not a review note".
 */
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

const importsOf = (source: string): string[] =>
  [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] as string);

describe("domain module boundaries", () => {
  it("keeps M01 and M02 free of every outward and third-party import", async () => {
    const sources = new Map([
      ...(await readSources("src/domain/model")),
      ...(await readSources("src/domain/validation")),
    ]);
    expect(sources.size).toBeGreaterThan(6);

    for (const [path, source] of sources) {
      for (const specifier of importsOf(source)) {
        // Relative only: no bare package specifiers at all.
        expect(specifier, `${path} imports ${specifier}`).toMatch(/^\.\.?\//);
        // And never a relative path that climbs out of src/domain/.
        for (const outward of [
          "persistence",
          "crypto",
          "workers",
          "import",
          "application",
          "ui",
          "routes",
          "migrations",
          "platform",
          "bootstrap",
          "config",
        ]) {
          expect(specifier, `${path} imports ${specifier}`).not.toContain(
            `/${outward}/`,
          );
        }
      }
    }
  });

  it("lets M02 depend on M01 but never the reverse", async () => {
    for (const [path, source] of await readSources("src/domain/model")) {
      for (const specifier of importsOf(source)) {
        expect(specifier, `${path} imports ${specifier}`).not.toContain(
          "validation",
        );
      }
    }

    const validation = await readSources("src/domain/validation");
    const modelImports = [...validation.values()]
      .flatMap(importsOf)
      .filter((specifier) => specifier.includes("model"));
    expect(modelImports.length).toBeGreaterThan(0);
  });

  it("exports only what F02 proves", async () => {
    const exported = new Set(
      (
        await Promise.all([
          import("../../../src/domain/validation/rules.js"),
          import("../../../src/domain/validation/validate-record.js"),
          import("../../../src/domain/validation/schema-checks.js"),
        ])
      ).flatMap((module) => Object.keys(module)),
    );

    expect(exported).toContain("validateRecord");
    expect(exported).toContain("validateSchema");

    // F04's schema editors own these; exporting a stub now would grant a
    // readiness nothing here proves (M02 F02 scope note).
    for (const unproven of [
      "analyzeImpact",
      "validateSchemaTransition",
      "evaluateFormula",
    ]) {
      expect([...exported], unproven).not.toContain(unproven);
    }
  });
});
