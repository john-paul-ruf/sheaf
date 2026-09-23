import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { XLSB_CORPUS } from "../../../fixtures/workbooks/xlsb/corpus.js";
import { fixtureBytes } from "../fixtures.js";

/**
 * The committed `.xlsb` fixtures are what every XLSB test reads; this proves
 * each is exactly what its generator writes. `SHEAF_WRITE_FIXTURES=1`
 * regenerates them instead.
 */
const shouldWrite = process.env["SHEAF_WRITE_FIXTURES"] === "1";

describe("generated XLSB corpus", () => {
  for (const [path, build] of XLSB_CORPUS) {
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
