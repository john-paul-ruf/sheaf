/**
 * M03's dependency must-nots (arch/M03-formulas.md): the formula module
 * imports only `src/domain/model/` besides itself, no third-party package,
 * and never `eval` or a dynamic `Function` (invariant 8). The rules are a pure
 * function over a source map so each has a negative control that must fail.
 */

import { readdir, readFile } from "node:fs/promises";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

const FORMULAS = "src/domain/formulas";
const MINIMUM_SOURCES = 17;

const readSources = async (): Promise<Map<string, string>> => {
  const sources = new Map<string, string>();
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".ts")) sources.set(path, await readFile(path, "utf8"));
    }
  };
  await walk(FORMULAS);
  return sources;
};

const violationsOf = (sources: ReadonlyMap<string, string>): string[] => {
  const violations: string[] = [];
  if (sources.size < MINIMUM_SOURCES) violations.push(`the sweep read only ${sources.size} files`);
  for (const [path, source] of sources) {
    for (const match of source.matchAll(/\b(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
      const specifier = match[1] as string;
      if (!specifier.startsWith(".")) {
        violations.push(`${path} imports ${specifier}: no third-party package`);
        continue;
      }
      const target = posix.join(posix.dirname(path), specifier);
      if (!target.startsWith(`${FORMULAS}/`) && !target.startsWith("src/domain/model/")) {
        violations.push(`${path} imports ${specifier}: only src/domain/model/`);
      }
    }
    if (/\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/.test(source)) {
      violations.push(`${path} evaluates code`);
    }
  }
  return violations;
};

const withFile = (sources: ReadonlyMap<string, string>, path: string, source: string) =>
  new Map([...sources, [path, source]]);

describe("formulas module boundaries", () => {
  it("holds over the real tree", async () => {
    const sources = await readSources();
    expect(sources.size).toBeGreaterThanOrEqual(MINIMUM_SOURCES);
    expect(violationsOf(sources)).toEqual([]);
  });

  it("fails a sweep that read nothing", () => {
    expect(violationsOf(new Map())).toEqual(["the sweep read only 0 files"]);
  });

  it("fails a third-party import, an outward import, and code evaluation", async () => {
    const sources = await readSources();
    const probe = `${FORMULAS}/probe.ts`;
    expect(violationsOf(withFile(sources, probe, 'import { x } from "formula-lib";'))).toEqual([
      `${probe} imports formula-lib: no third-party package`,
    ]);
    expect(violationsOf(withFile(sources, probe, 'import { x } from "../../import/facts/index.js";'))).toEqual([
      `${probe} imports ../../import/facts/index.js: only src/domain/model/`,
    ]);
    expect(violationsOf(withFile(sources, probe, 'import { x } from "../validation/rules.js";'))).toEqual([
      `${probe} imports ../validation/rules.js: only src/domain/model/`,
    ]);
    expect(violationsOf(withFile(sources, probe, 'import type { CellValueV1 } from "../model/values.js";'))).toEqual([]);
    for (const code of ["eval(text)", "new Function(text)", "Function(text)()"]) {
      expect(violationsOf(withFile(sources, probe, `export const run = (text: string) => ${code};`)), code).toEqual([
        `${probe} evaluates code`,
      ]);
    }
  });
});
