/**
 * The import *pipeline*'s dependency must-nots: M13 source, M65 workbook
 * facts, M14 pre-flight, the format adapters (M15–M20), and M21 inference.
 *
 * The sweep names those directories rather than `src/import` as a whole,
 * because `src/import` is not one module. M22 (snapshots) and M23 (staging)
 * live there too and have deliberately different edges — their contracts
 * (`arch/M22-snapshots.md`, `arch/M23-staging.md`) declare M09 codecs and
 * M01/M02, which the rules below forbid. Their own must-nots ship in
 * `tests/unit/staging/module-boundaries.test.ts`.
 *
 * F03 S01 owns this file for the whole feature and pre-declares every planned
 * F03 edge, so no later session needs to edit it:
 *
 * - no third-party package at all. D30 planned one exception (zip.js from
 *   `src/import/source/zip.ts`); S01's checkpoint-0 probe took D30's fallback,
 *   so the exception list is empty and `zip.ts` is held to the same rule;
 * - the domain only through `values`/`schema`/`events`, plus
 *   `src/domain/formulas/` for `src/import/inference/**` only (M21 → M03, D34);
 * - no adapter imports another adapter, except XLSB → `biff/ptg.ts` (D34);
 * - M65 imports values from `domain/model/values` only, and M13 by type only;
 * - M14 imports no adapter (D35) beyond F02's delimited pre-flight edge.
 *
 * The rules are a pure function over a source map so each one's negative
 * control runs against a synthetic tree — a sweep that cannot fail proves
 * nothing.
 */

import { readdir, readFile } from "node:fs/promises";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

/** The pipeline modules this file speaks for. */
const PIPELINE_DIRECTORIES = [
  "src/import/source",
  "src/import/facts",
  "src/import/preflight",
  "src/import/formats",
  "src/import/inference",
];

/** Fewer sources than this means the sweep is not reading the tree. */
const MINIMUM_SOURCES = 12;

/** D30's third-party exception list; empty on the fallback path. */
const THIRD_PARTY_EXCEPTIONS: ReadonlyMap<string, readonly string[]> = new Map();

const PERMITTED_DOMAIN_MODULES = new Set([
  "src/domain/model/values.ts",
  "src/domain/model/schema.ts",
  "src/domain/model/events.ts",
]);

const FORBIDDEN_LAYERS = [/\/persistence\//, /\/crypto\//, /\/workers\//, /\/ui\//, /\/application\//];

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

/** A planned module directory may not exist yet; the file floor still holds. */
const readPipelineSources = async (): Promise<Map<string, string>> => {
  const sources = new Map<string, string>();
  for (const directory of PIPELINE_DIRECTORIES) {
    const present = await readdir(directory).then(() => true, () => false);
    if (!present) {
      continue;
    }
    for (const [path, source] of await readSources(directory)) {
      sources.set(path, source);
    }
  }
  return sources;
};

interface ImportEdge {
  readonly specifier: string;
  readonly isTypeOnly: boolean;
}

const importsOf = (source: string): ImportEdge[] =>
  [...source.matchAll(/((?:import|export)\s+type\s*\{[^}]*\}\s*)?\bfrom\s+"([^"]+)"/g)].map(
    (match) => ({ specifier: match[2] as string, isTypeOnly: match[1] !== undefined }),
  );

/** The repository path a relative specifier names, `.js` read as `.ts`. */
const resolveTarget = (from: string, specifier: string): string =>
  posix.join(posix.dirname(from), specifier).replace(/\.js$/, ".ts");

const adapterOf = (path: string): string | null =>
  /^src\/import\/formats\/([^/]+)\//.exec(path)?.[1] ?? null;

/** Every rule violation in `sources`; an empty list is a passing sweep. */
const pipelineViolations = (sources: ReadonlyMap<string, string>): string[] => {
  const violations: string[] = [];
  if (sources.size < MINIMUM_SOURCES) {
    violations.push(`the sweep read only ${sources.size} files`);
  }
  for (const [path, source] of sources) {
    for (const { specifier, isTypeOnly } of importsOf(source)) {
      const edge = `${path} imports ${specifier}`;
      if (!specifier.startsWith(".")) {
        if (!(THIRD_PARTY_EXCEPTIONS.get(path) ?? []).includes(specifier)) {
          violations.push(`${edge}: no third-party package`);
        }
        continue;
      }
      if (FORBIDDEN_LAYERS.some((layer) => layer.test(specifier))) {
        violations.push(`${edge}: forbidden layer`);
      }
      const target = resolveTarget(path, specifier);
      if (target.startsWith("src/domain/")) {
        const isFormula = target.startsWith("src/domain/formulas/");
        const isInference = path.startsWith("src/import/inference/");
        if (!PERMITTED_DOMAIN_MODULES.has(target) && !(isFormula && isInference)) {
          violations.push(`${edge}: domain reached outside values/schema/events`);
        }
      }
      const fromAdapter = adapterOf(path);
      const toAdapter = adapterOf(target);
      if (
        fromAdapter !== null &&
        toAdapter !== null &&
        fromAdapter !== toAdapter &&
        !(fromAdapter === "xlsb" && target === "src/import/formats/biff/ptg.ts")
      ) {
        violations.push(`${edge}: adapter-to-adapter import`);
      }
      if (path.startsWith("src/import/facts/")) {
        const isValues = target === "src/domain/model/values.ts";
        const isOwn = target.startsWith("src/import/facts/");
        const isSourceType = isTypeOnly && target.startsWith("src/import/source/");
        if (!isValues && !isOwn && !isSourceType) {
          violations.push(`${edge}: M65 imports values and (type-only) M13 alone`);
        }
      }
      if (
        path.startsWith("src/import/preflight/") &&
        target.startsWith("src/import/formats/") &&
        !(path === "src/import/preflight/preflight.ts" && target === "src/import/formats/delimited/parse.ts")
      ) {
        violations.push(`${edge}: pre-flight imports no adapter (D35)`);
      }
    }
    // A literal `{ kind: "text" }` would bypass the NFC check `textValue`
    // performs, which is the entire D28 guarantee.
    for (const literal of [/kind:\s*"text",\s*text:/, /kind:\s*"invalid-preserved"/, /kind:\s*"decimal",\s*decimal:/]) {
      if (literal.test(source)) {
        violations.push(`${path} builds a cell value literally (${literal.source})`);
      }
    }
  }
  return violations;
};

const withFile = (
  sources: ReadonlyMap<string, string>,
  path: string,
  source: string,
): Map<string, string> => new Map([...sources, [path, source]]);

describe("import pipeline module boundaries", () => {
  it("holds every rule over the real pipeline tree", async () => {
    const sources = await readPipelineSources();
    expect(sources.size).toBeGreaterThanOrEqual(MINIMUM_SOURCES);
    expect(pipelineViolations(sources)).toEqual([]);
  });

  it("fails a sweep that read no files", () => {
    expect(pipelineViolations(new Map())).toEqual(["the sweep read only 0 files"]);
  });

  it("fails a third-party import anywhere, zip.ts included", async () => {
    const sources = await readPipelineSources();
    for (const path of [
      "src/import/formats/ooxml/probe.ts",
      "src/import/source/xml.ts",
      "src/import/source/zip.ts",
    ]) {
      expect(
        pipelineViolations(withFile(sources, path, 'import { ZipReader } from "@zip.js/zip.js";')),
        path,
      ).toEqual([`${path} imports @zip.js/zip.js: no third-party package`]);
    }
  });

  it("fails a cross-adapter import except XLSB's Ptg decoder", async () => {
    const sources = await readPipelineSources();
    const ooxml = "src/import/formats/ooxml/probe.ts";
    expect(
      pipelineViolations(withFile(sources, ooxml, 'import { x } from "../ods/parse.js";')),
    ).toEqual([`${ooxml} imports ../ods/parse.js: adapter-to-adapter import`]);

    const xlsb = "src/import/formats/xlsb/records.ts";
    expect(
      pipelineViolations(withFile(sources, xlsb, 'import { decodePtg } from "../biff/ptg.js";')),
    ).toEqual([]);
    expect(
      pipelineViolations(withFile(sources, xlsb, 'import { x } from "../biff/records.js";')),
    ).toEqual([`${xlsb} imports ../biff/records.js: adapter-to-adapter import`]);
  });

  it("permits domain/formulas to inference only", async () => {
    const sources = await readPipelineSources();
    expect(
      pipelineViolations(
        withFile(sources, "src/import/inference/lookups.ts", 'import { parseFormula } from "../../domain/formulas/parser.js";'),
      ),
    ).toEqual([]);
    const adapter = "src/import/formats/ooxml/probe.ts";
    expect(
      pipelineViolations(
        withFile(sources, adapter, 'import { parseFormula } from "../../../domain/formulas/parser.js";'),
      ),
    ).toEqual([
      `${adapter} imports ../../../domain/formulas/parser.js: domain reached outside values/schema/events`,
    ]);
  });

  it("holds M65 to values plus type-only M13, and M14 away from adapters", async () => {
    const sources = await readPipelineSources();
    const facts = "src/import/facts/probe.ts";
    expect(
      pipelineViolations(withFile(sources, facts, 'import type { ZipContainerHandleV1 } from "../source/zip.js";')),
    ).toEqual([]);
    expect(
      pipelineViolations(withFile(sources, facts, 'import { openZipContainer } from "../source/zip.js";')),
    ).toEqual([`${facts} imports ../source/zip.js: M65 imports values and (type-only) M13 alone`]);

    const preflight = "src/import/preflight/probe.ts";
    expect(
      pipelineViolations(withFile(sources, preflight, 'import { readOoxmlInventory } from "../formats/ooxml/inventory.js";')),
    ).toEqual([`${preflight} imports ../formats/ooxml/inventory.js: pre-flight imports no adapter (D35)`]);
  });

  it("forbids persistence and literal cell values", async () => {
    const sources = await readPipelineSources();
    const path = "src/import/formats/ooxml/probe.ts";
    expect(
      pipelineViolations(withFile(sources, path, 'import { x } from "../../../persistence/codecs/canonical-cbor.js";')),
    ).toEqual([`${path} imports ../../../persistence/codecs/canonical-cbor.js: forbidden layer`]);
    expect(
      pipelineViolations(withFile(sources, path, 'const v = { kind: "text", text: "x" };')),
    ).toHaveLength(1);
  });
});
