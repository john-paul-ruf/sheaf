import { readdir, readFile } from "node:fs/promises";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M01 and M02 are the pure domain: they import nothing outward and nothing
 * third-party. M02 may read M01, and M03's **result types** only — a value
 * import from `src/domain/formulas/` would put the evaluator inside the
 * validator. M01 never imports M02. FORGE-CONFIG § Conventions — "a
 * dependency must-not ships as a test, not a review note". The rules are a
 * pure function over a source map so each has a negative control.
 */
const MINIMUM_SOURCES = 14;

const readSources = async (directory: string): Promise<Map<string, string>> => {
  const sources = new Map<string, string>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      for (const [nested, source] of await readSources(path)) sources.set(nested, source);
    } else if (entry.name.endsWith(".ts")) {
      sources.set(path, await readFile(path, "utf8"));
    }
  }
  return sources;
};

const domainSources = async (): Promise<Map<string, string>> =>
  new Map([...(await readSources("src/domain/model")), ...(await readSources("src/domain/validation"))]);

const violationsOf = (sources: ReadonlyMap<string, string>): string[] => {
  const violations: string[] = [];
  if (sources.size < MINIMUM_SOURCES) violations.push(`the sweep read only ${sources.size} files`);
  for (const [path, source] of sources) {
    const isValidation = path.startsWith("src/domain/validation/");
    for (const match of source.matchAll(/\b(import|export)(\s+type)?\b[^;]*?\bfrom\s+"([^"]+)"/g)) {
      const isTypeOnly = match[2] !== undefined;
      const specifier = match[3] as string;
      if (!specifier.startsWith(".")) {
        violations.push(`${path} imports ${specifier}: no third-party package`);
        continue;
      }
      const target = posix.join(posix.dirname(path), specifier);
      if (target.startsWith("src/domain/model/") || (isValidation && target.startsWith("src/domain/validation/"))) continue;
      if (isValidation && target.startsWith("src/domain/formulas/") && isTypeOnly) continue;
      violations.push(
        `${path} imports ${specifier}: ${isValidation ? "only M01 and M03 result types" : "M01 imports nothing outward"}`,
      );
    }
  }
  return violations;
};

const withFile = (sources: ReadonlyMap<string, string>, path: string, source: string) => new Map([...sources, [path, source]]);

describe("domain module boundaries", () => {
  it("holds over the real tree: M01 imports only itself, M02 reads M01 and M03 result types", async () => {
    const sources = await domainSources();
    expect(sources.size).toBeGreaterThanOrEqual(MINIMUM_SOURCES);
    expect(violationsOf(sources)).toEqual([]);
    const validationImports = [...sources]
      .filter(([path]) => path.startsWith("src/domain/validation/"))
      .flatMap(([, source]) => [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] as string));
    expect(validationImports.some((specifier) => specifier.includes("/model/"))).toBe(true);
  });

  it("fails a sweep that read nothing", () => {
    expect(violationsOf(new Map())).toEqual(["the sweep read only 0 files"]);
  });

  it("fails a package, an outward import, a formulas value import, and M01 reaching M02", async () => {
    const sources = await domainSources();
    const probe = "src/domain/validation/probe.ts";
    expect(violationsOf(withFile(sources, probe, 'import { z } from "zod";'))).toEqual([`${probe} imports zod: no third-party package`]);
    expect(violationsOf(withFile(sources, probe, 'import { x } from "../../persistence/projection/index.js";'))).toEqual([
      `${probe} imports ../../persistence/projection/index.js: only M01 and M03 result types`,
    ]);
    expect(violationsOf(withFile(sources, probe, 'import { evaluateRow } from "../formulas/index.js";'))).toEqual([
      `${probe} imports ../formulas/index.js: only M01 and M03 result types`,
    ]);
    expect(violationsOf(withFile(sources, probe, 'import type { EvaluationResultV1 } from "../formulas/index.js";'))).toEqual([]);
    const modelProbe = "src/domain/model/probe.ts";
    expect(violationsOf(withFile(sources, modelProbe, 'import type { ValidationReport } from "../validation/rules.js";'))).toEqual([
      `${modelProbe} imports ../validation/rules.js: M01 imports nothing outward`,
    ]);
  });

  it("exports the F04 schema-editor surface it now proves, and still no formula evaluator", async () => {
    const exported = new Set(
      (
        await Promise.all([
          import("../../../src/domain/validation/rules.js"),
          import("../../../src/domain/validation/validate-record.js"),
          import("../../../src/domain/validation/schema-checks.js"),
          import("../../../src/domain/validation/schema-impact.js"),
        ])
      ).flatMap((module) => Object.keys(module)),
    );

    for (const name of ["validateRecord", "validateSchema", "ruleHolds", "analyzeSchemaChange", "convertValueForType", "validateSchemaTransition"]) {
      expect(exported, name).toContain(name);
    }
    // Formula evaluation stays in M03; validation reads its results only.
    for (const unproven of ["analyzeImpact", "evaluateFormula", "evaluateRow"]) {
      expect([...exported], unproven).not.toContain(unproven);
    }
  });
});
