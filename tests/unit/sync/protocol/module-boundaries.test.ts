import { readdir, readFile } from "node:fs/promises";
import { expect, it } from "vitest";
function forbidden(module: string, source: string): boolean {
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!);
  return imports.some((path) => /dexie|\/ui\/|\/providers\/|persistence\/envelope-store|\/workers\//.test(path) ||
    (module === "codecs" && !/^\.\.?\//.test(path)) ||
    (module === "ports" && /\/crypto\/|\/sync\/|\/persistence\//.test(path))) ||
    (module === "protocol" && /\bfetch\s*\(/.test(source));
}
it("enforces provider-neutral M07/M08/M09/M24 boundaries", async () => {
  let count = 0;
  for (const [module, directory] of [["crypto", "src/crypto"], ["codecs", "src/persistence/codecs"], ["protocol", "src/sync/protocol"], ["ports", "src/application/ports"]]) {
    for (const file of await readdir(directory!)) {
      if (!file.endsWith(".ts")) continue;
      expect(forbidden(module!, await readFile(`${directory}/${file}`, "utf8")), file).toBe(false);
      count++;
    }
  }
  expect(count).toBeGreaterThan(20);
});
it("rejects forbidden imports and network negative controls", () => {
  expect(forbidden("crypto", 'import x from "dexie";')).toBe(true);
  expect(forbidden("codecs", 'import x from "vendor";')).toBe(true);
  expect(forbidden("ports", 'import x from "../../crypto/keys.js";')).toBe(true);
  expect(forbidden("protocol", 'fetch("https://example.invalid");')).toBe(true);
  expect(forbidden("protocol", 'import x from "../providers/dropbox/sdk.js";')).toBe(true);
});
