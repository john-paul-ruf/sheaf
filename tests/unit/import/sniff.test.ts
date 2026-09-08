import { describe, expect, it } from "vitest";
import { sniffContent } from "../../../src/import/source/sniff.js";
import { MAX_SLICE_BYTES } from "../../../src/import/source/source.js";
import {
  bytesSource,
  countingSource,
  fixtureSource,
  textSource,
} from "./fixtures.js";

const sniffFixture = async (relativePath: string, declaredName: string) =>
  sniffContent(await fixtureSource(relativePath), declaredName);

describe("random-access source", () => {
  it("returns only the requested window and short-reads at the end", async () => {
    const source = textSource("abcdefghij");

    expect(await source.slice(2, 3)).toEqual(
      new TextEncoder().encode("cde"),
    );
    expect((await source.slice(8, 100)).byteLength).toBe(2);
    expect((await source.slice(50, 10)).byteLength).toBe(0);
  });

  it("refuses a read larger than the slice bound or a nonsense window", async () => {
    const source = textSource("abc");

    await expect(source.slice(0, MAX_SLICE_BYTES + 1)).rejects.toThrow(
      /1 MiB slice bound/,
    );
    await expect(source.slice(-1, 2)).rejects.toThrow(/non-negative/);
    await expect(source.slice(0, 1.5)).rejects.toThrow(/whole number/);
  });
});

describe("content sniffing", () => {
  it("reads a bounded leading window, never the whole file", async () => {
    const source = countingSource(
      await fixtureSource("delimited/field-log-messy.csv"),
    );

    await sniffContent(source, "field-log-messy.csv");

    expect(source.reads).toHaveLength(1);
    expect(source.reads[0]).toEqual({ offset: 0, length: 8192 });
  });

  it("classifies the delimited corpus by content", async () => {
    const csv = await sniffFixture(
      "delimited/field-log-messy.csv",
      "field-log-messy.csv",
    );
    expect(csv.format).toEqual({
      kind: "delimited",
      delimiter: ",",
      encoding: "utf-8",
      bomByteLength: 0,
      newline: "crlf",
    });
    expect(csv.contradiction).toBeNull();

    const tsv = await sniffFixture("delimited/crew-roster.tsv", "crew-roster.tsv");
    expect(tsv.format).toMatchObject({ delimiter: "\t", newline: "lf" });

    const semicolon = await sniffFixture(
      "delimited/suppliers-latin1.csv",
      "suppliers-latin1.csv",
    );
    expect(semicolon.format).toMatchObject({
      delimiter: ";",
      encoding: "windows-1252",
      bomByteLength: 0,
    });

    const utf16 = await sniffFixture(
      "delimited/site-visits-utf16.csv",
      "site-visits-utf16.csv",
    );
    expect(utf16.format).toMatchObject({
      delimiter: ",",
      encoding: "utf-16le",
      bomByteLength: 2,
    });

    const single = await sniffFixture(
      "delimited/single-column.csv",
      "single-column.csv",
    );
    expect(single.format).toMatchObject({ kind: "delimited", delimiter: "," });

    const empty = await sniffFixture("delimited/empty.csv", "empty.csv");
    expect(empty.format).toMatchObject({ kind: "delimited", encoding: "utf-8" });
  });

  it("keeps a delimiter inside quotes out of the count", async () => {
    // Every unquoted row carries exactly one semicolon; the commas all sit
    // inside quoted fields, where a real delimiter never hides.
    const source = textSource(
      [
        'name;note',
        'Rae;"one, two, three"',
        'Wen;"four, five, six"',
        'Ibrahim;"seven, eight, nine"',
        "",
      ].join("\n"),
    );

    expect(await sniffContent(source, "notes.csv")).toMatchObject({
      format: { delimiter: ";" },
    });
  });

  it("identifies workbook containers by their entries, not their names", async () => {
    expect(
      (await sniffFixture("refusals/fieldwork.xlsx", "fieldwork.xlsx")).format,
    ).toEqual({ kind: "zip-container", container: "ooxml" });

    expect(
      (await sniffFixture("refusals/site-plan.ods", "site-plan.ods")).format,
    ).toEqual({ kind: "zip-container", container: "ods" });

    expect(
      (await sniffFixture("refusals/budget.numbers", "budget.numbers")).format,
    ).toEqual({ kind: "zip-container", container: "iwork" });

    expect((await sniffFixture("refusals/ledger.xls", "ledger.xls")).format).toEqual(
      { kind: "cfb" },
    );

    expect(
      (await sniffFixture("refusals/quarterly.pdf", "quarterly.pdf")).format,
    ).toEqual({ kind: "pdf" });
  });

  it("states the discrepancy when the extension contradicts the bytes", async () => {
    const png = await sniffFixture("refusals/chart-export.csv", "chart-export.csv");
    expect(png.format).toEqual({ kind: "binary" });
    expect(png.contradiction).toEqual({
      declaredExtension: "csv",
      expectedKind: "delimited",
      detectedKind: "binary",
    });

    const html = await sniffFixture(
      "refusals/legacy-export.xls",
      "legacy-export.xls",
    );
    expect(html.format).toEqual({ kind: "html-table" });
    expect(html.contradiction).toEqual({
      declaredExtension: "xls",
      expectedKind: "cfb",
      detectedKind: "html-table",
    });
  });

  it("states no contradiction for an unrecognised or absent extension", async () => {
    expect((await sniffContent(textSource("a,b\n1,2\n"), "notes")).contradiction)
      .toBeNull();
    expect(
      (await sniffContent(textSource("a,b\n1,2\n"), "notes.dat")).contradiction,
    ).toBeNull();
  });

  it("treats an embedded NUL as binary even when the rest decodes", async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode("name,value\nrae,"),
      0,
      ...new TextEncoder().encode("7\n"),
    ]);

    expect((await sniffContent(bytesSource(bytes), "x.csv")).format).toEqual({
      kind: "binary",
    });
  });
});
