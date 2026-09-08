/**
 * Architecture compliance for the worker boundary (session Verification):
 * the worker imports no DOM, the page side imports no key material, and the
 * wire types cannot name bytes.
 *
 * These read the sources rather than the behavior on purpose — the property is
 * "this import can never appear", which no runtime assertion can establish.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf8");

const WORKER_FILES = [
  "src/workers/data.worker.ts",
  "src/workers/data/handlers.ts",
  "src/workers/data/catalog.ts",
  "src/workers/data/session.ts",
];

/** Files that run in the page and must never reach key material. */
const PAGE_FILES = [
  "src/bootstrap/app-bootstrap.ts",
  "src/workers/protocol/client.ts",
  "src/workers/protocol/messages.ts",
  "src/platform/capabilities.ts",
  "src/config/public-config.ts",
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

describe("the data worker", () => {
  it("imports no DOM, React, or UI module", () => {
    for (const file of WORKER_FILES) {
      const imports = importedModules(source(file));
      expect(imports.filter((name) => name.includes("/ui/"))).toEqual([]);
      expect(imports.filter((name) => name.startsWith("react"))).toEqual([]);
      expect(imports).not.toContain("react-dom");
    }
  });

  it("opens no network connection", () => {
    for (const file of WORKER_FILES) {
      expect(source(file)).not.toMatch(/\bfetch\(|XMLHttpRequest|EventSource|WebSocket/);
    }
  });

  it("never names M08's internal key-byte accessor", () => {
    for (const file of WORKER_FILES) {
      expect(source(file)).not.toContain("readKeyBytes");
    }
  });
});

describe("the page side", () => {
  it("imports nothing from src/crypto — keys exist only in the worker", () => {
    for (const file of PAGE_FILES) {
      const imports = importedModules(source(file));
      expect(imports.filter((name) => name.includes("crypto/"))).toEqual([]);
    }
  });

  it("imports no persistence module: only the worker opens the database", () => {
    for (const file of PAGE_FILES) {
      const imports = importedModules(source(file));
      expect(imports.filter((name) => name.includes("persistence/"))).toEqual([]);
    }
  });
});

describe("the wire contract", () => {
  it("type-excludes key bytes: no byte array appears in the message union", () => {
    const messages = code("src/workers/protocol/messages.ts");

    for (const forbidden of [
      "Uint8Array",
      "ArrayBuffer",
      "SecretKeyHandle",
      "LocalRootKeyHandle",
      "Transferable",
      "readKeyBytes",
      "WrappedLocalRootV1",
    ]) {
      expect(messages).not.toContain(forbidden);
    }
  });

  it("keeps the catalog's own types out of the response union", () => {
    const messages = code("src/workers/protocol/messages.ts");
    expect(messages).not.toContain("LocalCatalogV1");
    expect(importedModules(messages)).toEqual([]);
  });
});
