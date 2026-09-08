/**
 * Architecture compliance for M36/M37 (session Verification):
 * no React in workflows, no worker or persistence/crypto import in view
 * models, and no machine reading the wall clock behind the ClockPort's back.
 *
 * These read the sources rather than the behavior on purpose — the property is
 * "this import can never appear", which no runtime assertion can establish.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (path: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../${path}`, import.meta.url)),
    "utf8",
  );

const WORKFLOW_FILES = [
  "src/application/workflows/services.ts",
  "src/application/workflows/import-services.ts",
  "src/application/workflows/records-services.ts",
  "src/application/workflows/import.machine.ts",
  "src/application/workflows/setup.machine.ts",
  "src/application/workflows/unlock.machine.ts",
  "src/application/workflows/recovery.machine.ts",
  "src/application/workflows/passphrase-change.machine.ts",
  "src/application/workflows/reveal-code.machine.ts",
  "src/application/workflows/reset.machine.ts",
  "src/application/workflows/session.machine.ts",
];

const VIEW_MODEL_FILES = [
  "src/application/view-models/security.ts",
  "src/application/view-models/library.ts",
  "src/application/view-models/import.ts",
];

/** Source with comments removed: a spec citation is not an import. */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function importedModules(text: string): string[] {
  return [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
}

/** Imports that survive to runtime — `import type` is erased by the compiler. */
function runtimeImports(text: string): string[] {
  return [...text.matchAll(/^import\s+(?!type\s)([\s\S]*?)from\s+"([^"]+)"/gm)]
    .filter((match) => !/^\{\s*type\s/.test(match[1] ?? ""))
    .map((match) => match[2] ?? "");
}

describe("workflows (M36)", () => {
  it("import no React and no UI module", () => {
    for (const path of WORKFLOW_FILES) {
      for (const specifier of importedModules(code(path))) {
        expect(specifier, path).not.toMatch(/^react/u);
        expect(specifier, path).not.toContain("/ui/");
      }
    }
  });

  it("import no persistence or crypto module", () => {
    for (const path of WORKFLOW_FILES) {
      for (const specifier of importedModules(code(path))) {
        expect(specifier, path).not.toContain("/crypto/");
        expect(specifier, path).not.toContain("/persistence/");
        expect(specifier, path).not.toContain("dexie");
        expect(specifier, path).not.toContain("libsodium");
      }
    }
  });

  it("never read the wall clock directly", () => {
    for (const path of WORKFLOW_FILES) {
      const text = code(path);
      expect(text, path).not.toContain("Date.now");
      expect(text, path).not.toMatch(/new Date\(/u);
      expect(text, path).not.toContain("performance.now");
    }
  });

  it("reach the worker only through the protocol client", () => {
    for (const path of WORKFLOW_FILES) {
      for (const specifier of importedModules(code(path))) {
        expect(specifier, path).not.toMatch(/\.worker\.js$/u);
      }
    }
  });
});

describe("view models (M37)", () => {
  it("hold no runtime import from the worker: protocol types only", () => {
    for (const path of VIEW_MODEL_FILES) {
      for (const specifier of runtimeImports(code(path))) {
        expect(specifier, path).not.toContain("/workers/");
      }
    }
    // The type flow itself is allowed, and is how the shapes stay in step.
    expect(importedModules(code("src/application/view-models/security.ts")))
      .toContain("../../workers/protocol/messages.js");
  });

  it("import no persistence, crypto, React, or UI module", () => {
    for (const path of VIEW_MODEL_FILES) {
      for (const specifier of importedModules(code(path))) {
        expect(specifier, path).not.toMatch(/^react/u);
        expect(specifier, path).not.toContain("/ui/");
        expect(specifier, path).not.toContain("/crypto/");
        expect(specifier, path).not.toContain("/persistence/");
      }
    }
  });

  it("name no secret-bearing field", () => {
    for (const path of VIEW_MODEL_FILES) {
      const text = code(path);
      expect(text, path).not.toMatch(/\bpassphrase\s*:/u);
      expect(text, path).not.toMatch(/\bcurrentPassphrase\b/u);
      expect(text, path).not.toMatch(/\bnextPassphrase\b/u);
      expect(text, path).not.toMatch(/\bconfirmation\s*:/u);
    }
  });
});
