import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BIFF_CORPUS } from "../../../fixtures/workbooks/biff/corpus.js";
import { fixtureBytes } from "../fixtures.js";

/**
 * The committed `.xls` fixtures are what every BIFF test reads; this proves
 * each is exactly what its generator writes. `SHEAF_WRITE_FIXTURES=1`
 * regenerates them instead.
 */
const shouldWrite = process.env["SHEAF_WRITE_FIXTURES"] === "1";

describe("generated BIFF corpus", () => {
  for (const [path, build] of BIFF_CORPUS) {
    it(`reproduces ${path} byte for byte`, async () => {
      const bytes = build();
      if (shouldWrite) {
        await writeFile(`tests/fixtures/workbooks/${path}`, bytes);
      }
      const committed = await fixtureBytes(path);
      expect(committed.length).toBe(bytes.length);
      expect(Buffer.compare(Buffer.from(committed), Buffer.from(bytes))).toBe(0);
    });
  }
});
