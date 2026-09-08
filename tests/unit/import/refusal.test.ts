import { describe, expect, it } from "vitest";
import { sniffContent } from "../../../src/import/source/sniff.js";
import {
  classifyRefusal,
  REFUSAL_KINDS,
} from "../../../src/import/preflight/refusal.js";
import { bytesSource, fixtureSource } from "./fixtures.js";

const refuse = async (relativePath: string, declaredName: string) =>
  classifyRefusal(await sniffContent(await fixtureSource(relativePath), declaredName));

describe("refusal classification", () => {
  it("refuses every non-delimited fixture with its remedy and the file name", async () => {
    expect(await refuse("refusals/quarterly.pdf", "quarterly.pdf")).toEqual({
      kind: "pdf-file",
      fileName: "quarterly.pdf",
      remedy: "pdf-export-from-source",
    });

    expect(await refuse("refusals/budget.numbers", "budget.numbers")).toEqual({
      kind: "numbers-file",
      fileName: "budget.numbers",
      remedy: "numbers-export-xlsx",
    });

    expect(await refuse("refusals/budget.numbers", "invitation.pages")).toEqual({
      kind: "pages-file",
      fileName: "invitation.pages",
      remedy: "pages-copy-into-spreadsheet",
    });

    expect(await refuse("refusals/fieldwork.xlsx", "fieldwork.xlsx")).toEqual({
      kind: "workbook-format-later-release",
      fileName: "fieldwork.xlsx",
      remedy: "await-later-release",
      format: "ooxml",
    });

    expect(await refuse("refusals/fieldwork.xlsx", "fieldwork.xlsb")).toMatchObject(
      { format: "xlsb" },
    );

    expect(await refuse("refusals/site-plan.ods", "site-plan.ods")).toMatchObject({
      kind: "workbook-format-later-release",
      format: "ods",
    });

    expect(await refuse("refusals/ledger.xls", "ledger.xls")).toMatchObject({
      kind: "workbook-format-later-release",
      format: "xls",
    });

    expect(
      await refuse("refusals/legacy-export.xls", "legacy-export.xls"),
    ).toMatchObject({ kind: "workbook-format-later-release", format: "html" });

    expect(
      await refuse("refusals/chart-export.csv", "chart-export.csv"),
    ).toEqual({
      kind: "binary-unreadable",
      fileName: "chart-export.csv",
      remedy: "choose-another-file",
    });
  });

  it("lets every delimited fixture through", async () => {
    for (const name of [
      "field-log-messy.csv",
      "quoted-notes.csv",
      "crew-roster.tsv",
      "site-visits-utf16.csv",
      "suppliers-latin1.csv",
      "nfd-crew.csv",
      "headerless-readings.csv",
      "single-column.csv",
      "empty.csv",
      "ragged-rows.csv",
    ]) {
      expect(await refuse(`delimited/${name}`, name), name).toBeNull();
    }
  });

  it("refuses a zip that declares no recognisable document family", async () => {
    const name = new TextEncoder().encode("notes.txt");
    const zip = new Uint8Array(30 + name.byteLength);
    zip.set([0x50, 0x4b, 0x03, 0x04], 0);
    zip[26] = name.byteLength;
    zip.set(name, 30);

    const sniff = await sniffContent(bytesSource(zip), "mystery.zip");
    expect(sniff.format).toEqual({
      kind: "zip-container",
      container: "unknown",
    });
    expect(classifyRefusal(sniff)).toMatchObject({ kind: "binary-unreadable" });
  });

  it("declares macro-content and over-import-budget with no producer here", () => {
    // `macro-content` needs the workbook adapters (F03) and
    // `over-import-budget` needs sizing (pre-flight); both belong to the closed
    // union now so no consumer has to grow a case later.
    expect(REFUSAL_KINDS).toContain("macro-content");
    expect(REFUSAL_KINDS).toContain("over-import-budget");
  });
});
