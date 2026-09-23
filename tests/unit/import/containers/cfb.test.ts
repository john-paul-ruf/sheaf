import { describe, expect, it } from "vitest";
import {
  BoundExceededError,
  type UnreadableDetailV1,
} from "../../../../src/import/source/bounds.js";
import { openCfbContainer, requireUnencrypted } from "../../../../src/import/source/cfb.js";
import { writeCfb } from "../../../fixtures/workbooks/build/cfb-writer.js";
import { bytesSource, countingSource, fixtureSource } from "../fixtures.js";

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

const readEveryStream = async (path: string): Promise<void> => {
  const cfb = await openCfbContainer(await fixtureSource(path));
  for (const stream of cfb.listStreams()) {
    await cfb.readStream(stream.path, { maxBytes: 1_048_576 });
  }
};

describe("cfb container", () => {
  it("reads regular, mini and nested streams exactly", async () => {
    const large = Uint8Array.from({ length: 70_000 }, (_, index) => (index * 13) % 256);
    const small = Uint8Array.from({ length: 300 }, (_, index) => index % 256);
    const nested = Uint8Array.from({ length: 64 }, () => 7);
    const bytes = writeCfb([
      { path: "Workbook", data: large },
      { path: "\u0005SummaryInformation", data: small },
      { path: "_VBA_PROJECT_CUR/VBA/dir", data: nested },
    ]);
    const source = countingSource(bytesSource(bytes));
    const cfb = await openCfbContainer(source);
    const openedWith = source.bytesRead;

    expect(cfb.listStreams().map((stream) => stream.path).sort()).toEqual([
      "\u0005SummaryInformation",
      "Workbook",
      "_VBA_PROJECT_CUR/VBA/dir",
    ]);
    expect(openedWith).toBeLessThan(large.length);
    expect(await cfb.readStream("workbook", { maxBytes: 100_000 })).toEqual(large);
    expect(await cfb.readStream("\u0005SummaryInformation", { maxBytes: 1000 })).toEqual(small);
    expect(await cfb.readStream("_VBA_PROJECT_CUR/VBA/dir", { maxBytes: 64 })).toEqual(nested);
    expect(cfb.isEncryptedPackage).toBe(false);
    expect(() => requireUnencrypted(cfb)).not.toThrow();
    expect(await detailOf(() => cfb.readStream("Workbook", { maxBytes: 10 }))).toBe("expansion-limit");
  });

  it("identifies an encrypted OOXML package by name", async () => {
    const cfb = await openCfbContainer(await fixtureSource("unsafe/encrypted.xlsx"));
    expect(cfb.isEncryptedPackage).toBe(true);
    expect(await detailOf(() => Promise.resolve(requireUnencrypted(cfb)))).toBe("encrypted-workbook");
  });

  it("maps every unsafe fixture to its exact detail", async () => {
    const expected: [string, UnreadableDetailV1][] = [
      ["unsafe/cfb-loop.xls", "directory-loop"],
      ["unsafe/cfb-chain-loop.xls", "directory-loop"],
      ["unsafe/cfb-size-mismatch.xls", "malformed-structure"],
      ["unsafe/cfb-truncated.xls", "truncated-container"],
    ];
    for (const [path, detail] of expected) {
      expect(await detailOf(() => readEveryStream(path)), path).toBe(detail);
    }
    expect(await detailOf(() => openCfbContainer(bytesSource(new Uint8Array(512))))).toBe(
      "unrecognized-content",
    );
  });
});
