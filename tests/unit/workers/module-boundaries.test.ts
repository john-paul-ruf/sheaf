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
  "src/workers/data/import-handlers.ts",
];

/**
 * The import worker parses and nothing else (D17). Its module graph must not
 * reach the database or any key material — a parser that could write
 * ciphertext would be a second owner of the store, and a parser that could
 * hold a key would put plaintext and key material in the same thread.
 */
const IMPORT_WORKER_FILES = [
  "src/workers/import.worker.ts",
  "src/workers/import/parse-session.ts",
  "src/workers/protocol/import-messages.ts",
  "src/workers/protocol/import-client.ts",
  "src/workers/protocol/stage-channel.ts",
];

/**
 * Everything the import worker's graph can reach, followed transitively from
 * its entry. The bundle contains the closure, not just the direct imports, so
 * the closure is what has to be free of dexie and sodium.
 */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    const directory = current.slice(0, current.lastIndexOf("/"));
    for (const specifier of importedModules(source(current))) {
      if (!specifier.startsWith(".")) {
        seen.add(specifier);
        continue;
      }
      const parts = `${directory}/${specifier.replace(/\.js$/, ".ts")}`.split("/");
      const resolved: string[] = [];
      for (const part of parts) {
        if (part === "..") {
          resolved.pop();
        } else if (part !== ".") {
          resolved.push(part);
        }
      }
      queue.push(resolved.join("/"));
    }
  }
  return seen;
}

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

describe("the import worker", () => {
  it("imports no DOM, React, or UI module", () => {
    for (const file of IMPORT_WORKER_FILES) {
      const imports = importedModules(source(file));
      expect(imports.filter((name) => name.includes("/ui/"))).toEqual([]);
      expect(imports.filter((name) => name.startsWith("react"))).toEqual([]);
    }
  });

  it("opens no network connection", () => {
    for (const file of IMPORT_WORKER_FILES) {
      expect(source(file)).not.toMatch(
        /\bfetch\(|XMLHttpRequest|EventSource|WebSocket/,
      );
    }
  });

  it("cannot reach dexie, libsodium, the store, or a key — anywhere in its graph", () => {
    const graph = reachableFrom("src/workers/import.worker.ts");
    // A resolver that silently found nothing would pass every assertion
    // below. These are the modules the worker demonstrably does reach.
    expect([...graph]).toEqual(
      expect.arrayContaining([
        "src/import/formats/delimited/parse.ts",
        "src/import/preflight/preflight.ts",
        "src/import/source/sniff.ts",
        "src/workers/protocol/stage-channel.ts",
      ]),
    );

    for (const module of graph) {
      expect({ module, ok: !module.includes("dexie") }).toEqual({ module, ok: true });
      expect({ module, ok: !module.includes("libsodium") }).toEqual({
        module,
        ok: true,
      });
      expect({ module, ok: !module.includes("src/crypto/") }).toEqual({
        module,
        ok: true,
      });
      expect({
        module,
        ok: !module.includes("persistence/envelope-store"),
      }).toEqual({ module, ok: true });
    }
  });

  it("names no key accessor and no envelope function", () => {
    for (const file of IMPORT_WORKER_FILES) {
      expect(source(file)).not.toContain("encryptEnvelope");
      expect(source(file)).not.toContain("createSecretKey");
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
