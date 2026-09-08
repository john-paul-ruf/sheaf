/**
 * The import *pipeline*'s dependency must-nots: M13 source, M14 pre-flight,
 * M19 delimited, M21 inference.
 *
 * The sweep names those four directories rather than `src/import` as a whole,
 * because `src/import` is not one module. M22 (snapshots) and M23 (staging)
 * live there too and have deliberately different edges — their contracts
 * (`arch/M22-snapshots.md`, `arch/M23-staging.md`) declare M09 codecs and
 * M01/M02, which the assertions below forbid. Their own must-nots — no crypto,
 * no envelope-store, no dexie, no UI, no workers, ports-only injection — ship
 * in `tests/unit/staging/module-boundaries.test.ts`. Nothing here is relaxed
 * for the four modules it covers.
 */

import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/** The four pipeline modules this file speaks for. */
const PIPELINE_DIRECTORIES = [
  "src/import/source",
  "src/import/preflight",
  "src/import/formats",
  "src/import/inference",
];

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

/** Every source of the four pipeline modules, and nothing else. */
const readPipelineSources = async (): Promise<Map<string, string>> => {
  const sources = new Map<string, string>();
  for (const directory of PIPELINE_DIRECTORIES) {
    for (const [path, source] of await readSources(directory)) {
      sources.set(path, source);
    }
  }
  return sources;
};

describe("import pipeline module boundaries", () => {
  it("imports nothing from persistence, crypto, workers or the UI", async () => {
    const sources = await readPipelineSources();
    expect(sources.size).toBeGreaterThan(6);

    for (const [path, source] of sources) {
      for (const specifier of importsOf(source)) {
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(
          /\/persistence\//,
        );
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(
          /\/crypto\//,
        );
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(
          /\/workers\//,
        );
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(/\/ui\//);
        expect(specifier, `${path} imports ${specifier}`).not.toMatch(
          /\/application\//,
        );
      }
    }
  });

  it("takes no third-party dependency at all", async () => {
    for (const [path, source] of await readPipelineSources()) {
      for (const specifier of importsOf(source)) {
        expect(specifier, `${path} imports ${specifier}`).toMatch(/^\.\.?\//);
      }
    }
  });

  it("reaches the domain only through the landed value and schema modules", async () => {
    const allowed = new Set([
      "../../domain/model/values.js",
      "../../../domain/model/values.js",
      "../../domain/model/schema.js",
      "../../../domain/model/schema.js",
      "../../domain/model/events.js",
      "../../../domain/model/events.js",
    ]);

    for (const [path, source] of await readPipelineSources()) {
      for (const specifier of importsOf(source)) {
        if (specifier.includes("/domain/")) {
          expect(allowed.has(specifier), `${path} imports ${specifier}`).toBe(
            true,
          );
        }
      }
    }
  });

  it("builds cell values only through the domain's constructors", async () => {
    // A literal `{ kind: "text" }` would bypass the NFC check `textValue`
    // performs, which is the entire D28 guarantee; the codec would then refuse
    // the fact at staging instead of the parser normalizing it here.
    for (const [path, source] of await readPipelineSources()) {
      expect(source, path).not.toMatch(/kind:\s*"text",\s*text:/);
      expect(source, path).not.toMatch(/kind:\s*"invalid-preserved"/);
      expect(source, path).not.toMatch(/kind:\s*"decimal",\s*decimal:/);
    }
  });
});
