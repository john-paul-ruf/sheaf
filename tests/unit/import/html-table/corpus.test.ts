import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { HTML_TABLE_CORPUS } from "../../../fixtures/workbooks/html-table/corpus.js";
import { fixtureBytes } from "../fixtures.js";

/**
 * The committed HTML-table fixture bytes are what every other HTML-table test
 * reads; this proves each is exactly what its generator writes.
 * `SHEAF_WRITE_FIXTURES=1` regenerates them instead.
 */
const shouldWrite = process.env["SHEAF_WRITE_FIXTURES"] === "1";

describe("generated HTML-table corpus", () => {
  it("covers the planned fixtures", () => {
    expect(HTML_TABLE_CORPUS.size).toBeGreaterThanOrEqual(4);
  });

  for (const [path, build] of HTML_TABLE_CORPUS) {
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
