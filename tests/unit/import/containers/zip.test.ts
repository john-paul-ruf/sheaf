import { describe, expect, it } from "vitest";
import {
  BoundExceededError,
  CONTAINER_BOUNDS_V1,
  type UnreadableDetailV1,
} from "../../../../src/import/source/bounds.js";
import { openZipContainer } from "../../../../src/import/source/zip.js";
import { PAYROLL } from "../../../fixtures/workbooks/build/corpus.js";
import { buildOoxml } from "../../../fixtures/workbooks/build/ooxml-builder.js";
import { writeZip } from "../../../fixtures/workbooks/build/zip-writer.js";
import { bytesSource, countingSource, fixtureSource } from "../fixtures.js";

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const detailOf = async (work: () => Promise<unknown>): Promise<UnreadableDetailV1 | "none"> => {
  try {
    await work();
    return "none";
  } catch (cause) {
    if (cause instanceof BoundExceededError) {
      return cause.detail;
    }
    throw cause;
  }
};

const readAll = async (path: string): Promise<void> => {
  const zip = await openZipContainer(await fixtureSource(path));
  for (const entry of zip.entries) {
    await zip.readEntry(entry.name, { maxBytes: 16_777_216 });
  }
};

describe("zip container", () => {
  it("lists entries from the central directory without reading entry data", async () => {
    const bytes = buildOoxml(PAYROLL);
    const source = countingSource(bytesSource(bytes));
    const zip = await openZipContainer(source);

    expect(zip.entries.map((entry) => entry.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
      "xl/styles.xml",
      "xl/sharedStrings.xml",
    ]);
    // One 22-byte end record read, then only the directory's own bytes.
    expect(source.reads[0]).toEqual({ offset: bytes.length - 22, length: 22 });
    const directoryStart = Math.min(...source.reads.slice(1).map((read) => read.offset));
    expect(source.reads.slice(1).every((read) => read.offset >= directoryStart)).toBe(true);
    expect(source.bytesRead).toBeLessThan(bytes.length - directoryStart + 22);
    expect(zip.expandedByteCount).toBe(0);
  });

  it("reads stored and deflated entries, verifying size and CRC", async () => {
    const zip = await openZipContainer(
      bytesSource(
        writeZip([
          { name: "a.xml", data: "<a>stored</a>", method: "stored" },
          { name: "b.xml", data: "<b>" + "deflated ".repeat(5000) + "</b>" },
        ]),
      ),
    );
    expect(decode(await zip.readEntry("a.xml", { maxBytes: 100 }))).toBe("<a>stored</a>");
    const chunks: Uint8Array[] = [];
    for await (const chunk of zip.streamEntry("B.XML")) {
      chunks.push(chunk);
    }
    expect(decode(Buffer.concat(chunks))).toBe("<b>" + "deflated ".repeat(5000) + "</b>");
    expect(zip.has("b.xml")).toBe(true);
    expect(zip.entry("missing.xml")).toBeNull();
    expect(zip.expandedByteCount).toBe(13 + 7 + 45_000);
  });

  it("stops the compressed reads when a caller stops early", async () => {
    const payload = Uint8Array.from({ length: 3_000_000 }, (_, index) => (index * 2654435761) >>> 24);
    const bytes = writeZip([{ name: "big.bin", data: payload }]);
    const source = countingSource(bytesSource(bytes));
    const zip = await openZipContainer(source);
    const before = source.bytesRead;
    for await (const chunk of zip.streamEntry("big.bin")) {
      expect(chunk.byteLength).toBeGreaterThan(0);
      break;
    }
    expect(source.bytesRead - before).toBeLessThan(bytes.length / 4);
  });

  it("refuses a caller cap before and during the read", async () => {
    const zip = await openZipContainer(bytesSource(buildOoxml(PAYROLL)));
    expect(await detailOf(() => zip.readEntry("xl/workbook.xml", { maxBytes: 10 }))).toBe(
      "expansion-limit",
    );
    expect(await detailOf(() => zip.readEntry("xl/nope.xml", { maxBytes: 10 }))).toBe(
      "malformed-structure",
    );
  });

  it("holds the per-import total across every entry", async () => {
    const bytes = writeZip([
      { name: "a.txt", data: "a".repeat(600) },
      { name: "b.txt", data: "b".repeat(600) },
    ]);
    const zip = await openZipContainer(bytesSource(bytes), {
      ...CONTAINER_BOUNDS_V1,
      maxTotalExpandedBytes: 1000,
    });
    await zip.readEntry("a.txt", { maxBytes: 1000 });
    expect(await detailOf(() => zip.readEntry("b.txt", { maxBytes: 1000 }))).toBe("expansion-limit");
  });

  it("maps every unsafe fixture to its exact detail", async () => {
    const expected: [string, UnreadableDetailV1][] = [
      ["unsafe/truncated.xlsx", "truncated-container"],
      ["unsafe/zip-bomb.xlsx", "expansion-limit"],
      ["unsafe/entry-count.xlsx", "expansion-limit"],
      ["unsafe/lying-size.xlsx", "malformed-structure"],
      ["unsafe/path-traversal.xlsx", "malformed-structure"],
      ["unsafe/zip-encrypted.xlsx", "encrypted-workbook"],
      ["unsafe/unknown-method.xlsx", "unrecognized-content"],
    ];
    for (const [path, detail] of expected) {
      expect(await detailOf(() => readAll(path)), path).toBe(detail);
    }
  });

  it("stops a bomb long before its declared size", async () => {
    const source = countingSource(await fixtureSource("unsafe/zip-bomb.xlsx"));
    const zip = await openZipContainer(source);
    const bomb = zip.entry("xl/workbook.xml");
    expect(bomb?.declaredUncompressedSize).toBeGreaterThan(2_000_000);
    expect(await detailOf(() => zip.readEntry("xl/workbook.xml", { maxBytes: 16_777_216 }))).toBe(
      "expansion-limit",
    );
    expect(zip.expandedByteCount).toBeLessThanOrEqual(
      (bomb?.compressedSize ?? 0) * CONTAINER_BOUNDS_V1.maxExpansionRatio + 65_536,
    );
  });

  it("refuses duplicate names that differ only by case", async () => {
    const bytes = writeZip([
      { name: "xl/workbook.xml", data: "<a/>" },
      { name: "XL/Workbook.xml", data: "<b/>" },
    ]);
    expect(await detailOf(() => openZipContainer(bytesSource(bytes)))).toBe("malformed-structure");
  });
});
