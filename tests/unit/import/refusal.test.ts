import { describe, expect, it } from "vitest";
import { sniffContent } from "../../../src/import/source/sniff.js";
import {
  classifyRefusal,
  laterReleaseRefusal,
  REFUSAL_KINDS,
} from "../../../src/import/preflight/refusal.js";
import { WORKBOOK_REGISTRY } from "../../../src/workers/import/adapters.js";
import type { UnreadableDetailV1 } from "../../../src/import/source/bounds.js";
import { preflightWorkbook } from "../../../src/import/preflight/workbook.js";
import { ooxmlInventoryReader } from "../../../src/import/formats/ooxml/inventory.js";
import { bytesSource, fixtureSource } from "./fixtures.js";

const READERS = new Map([["xlsx" as const, ooxmlInventoryReader]]);

const preflightRefusal = async (relativePath: string, declaredName: string) => {
  const source = await fixtureSource(relativePath);
  const outcome = await preflightWorkbook(source, await sniffContent(source, declaredName), READERS);
  return outcome.kind === "refused" ? outcome.refusal : null;
};

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

    // A workbook container is not refused here: the import worker decides it
    // by the page's accepted flows and the registry's readers (D48, D35).
    for (const [path, name] of [
      ["refusals/fieldwork.xlsx", "fieldwork.xlsx"],
      ["refusals/site-plan.ods", "site-plan.ods"],
      ["refusals/ledger.xls", "ledger.xls"],
      ["refusals/legacy-export.xls", "legacy-export.xls"],
    ] as const) {
      expect(await refuse(path, name), path).toBeNull();
    }

    expect(
      await refuse("refusals/chart-export.csv", "chart-export.csv"),
    ).toEqual({
      kind: "binary-unreadable",
      fileName: "chart-export.csv",
      remedy: "choose-another-file",
      detail: "unrecognized-content",
    });
  });

  it("keeps F02's later-release answer, verbatim, for a page without the workbook flow (D48)", async () => {
    const laterFor = async (path: string, name: string) =>
      laterReleaseRefusal(await sniffContent(await fixtureSource(path), name));
    expect(await laterFor("refusals/fieldwork.xlsx", "fieldwork.xlsx")).toEqual({
      kind: "workbook-format-later-release",
      fileName: "fieldwork.xlsx",
      remedy: "await-later-release",
      format: "ooxml",
    });
    expect(await laterFor("refusals/fieldwork.xlsx", "fieldwork.xlsb")).toMatchObject({ format: "xlsb" });
    expect(await laterFor("refusals/site-plan.ods", "site-plan.ods")).toMatchObject({
      kind: "workbook-format-later-release",
      format: "ods",
    });
    expect(await laterFor("refusals/ledger.xls", "ledger.xls")).toMatchObject({
      kind: "workbook-format-later-release",
      format: "xls",
    });
    expect(await laterFor("refusals/legacy-export.xls", "legacy-export.xls")).toMatchObject({
      kind: "workbook-format-later-release",
      format: "html",
    });
    // Nothing that is not a workbook container gets one.
    expect(await laterFor("delimited/field-log-messy.csv", "field-log-messy.csv")).toBeNull();
    expect(await laterFor("refusals/quarterly.pdf", "quarterly.pdf")).toBeNull();
  });

  it("reads F02's refusal fixtures through the full registry for what they now are", async () => {
    const outcomeOf = async (path: string, name: string) => {
      const source = await fixtureSource(path);
      return preflightWorkbook(source, await sniffContent(source, name), WORKBOOK_REGISTRY.readers);
    };
    const unreadableAs = (fileName: string, detail: UnreadableDetailV1) => ({
      kind: "refused",
      refusal: { kind: "binary-unreadable", fileName, remedy: "choose-another-file", detail },
    });
    // F02's stubs were containers only, never workbooks: opening them is now real work.
    expect(await outcomeOf("refusals/fieldwork.xlsx", "fieldwork.xlsx")).toEqual(
      unreadableAs("fieldwork.xlsx", "malformed-structure"),
    );
    expect(await outcomeOf("refusals/ledger.xls", "ledger.xls")).toEqual(
      unreadableAs("ledger.xls", "malformed-structure"),
    );
    expect(await outcomeOf("unsafe/cfb-size-mismatch.xls", "cfb-size-mismatch.xls")).toEqual(
      unreadableAs("cfb-size-mismatch.xls", "malformed-structure"),
    );
    // S05: an ODS with one sheet that fits, and HTML named `.xls` — the
    // contradiction stated (MOD-004), the content read.
    expect(await outcomeOf("refusals/site-plan.ods", "site-plan.ods")).toMatchObject({
      kind: "proceed",
      report: { format: "ods", route: "fits", sheets: [{ name: "Table 1" }], formatContradiction: null },
    });
    expect(await outcomeOf("refusals/legacy-export.xls", "legacy-export.xls")).toMatchObject({
      kind: "proceed",
      report: {
        format: "html-table",
        route: "fits",
        sheets: [{ name: "Table 1" }],
        formatContradiction: { declaredExtension: "xls", detectedFormat: "html-table" },
      },
    });
  });

  it("registers every workbook format, reader and adapter under the format they read (D35)", () => {
    for (const format of ["xlsx", "xlsb", "xls", "ods", "html-table"] as const) {
      expect(WORKBOOK_REGISTRY.readers.get(format)?.format, format).toBe(format);
      expect(WORKBOOK_REGISTRY.adapters.get(format)?.format, format).toBe(format);
    }
    expect(WORKBOOK_REGISTRY.readers.size).toBe(5);
    expect(WORKBOOK_REGISTRY.adapters.size).toBe(5);
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
    expect(classifyRefusal(sniff)).toMatchObject({
      kind: "binary-unreadable",
      detail: "unrecognized-content",
    });
  });

  it("declares macro-content and over-import-budget with no producer here", () => {
    // `macro-content` needs the workbook adapters (F03) and
    // `over-import-budget` needs sizing (pre-flight); both belong to the closed
    // union now so no consumer has to grow a case later.
    expect(REFUSAL_KINDS).toContain("macro-content");
    expect(REFUSAL_KINDS).toContain("over-import-budget");
  });

  it("refuses every workbook in the refusal corpus with its exact refusal", async () => {
    const macro = (fileName: string) => ({ kind: "macro-content", fileName, remedy: "reupload-macro-free-copy" });
    const unreadable = (fileName: string, detail: UnreadableDetailV1) => ({
      kind: "binary-unreadable",
      fileName,
      remedy: "choose-another-file",
      detail,
    });
    const cases: [string, string, object][] = [
      ["unsafe/payroll.xlsm", "payroll.xlsm", macro("payroll.xlsm")],
      ["unsafe/renamed-macro.xlsx", "renamed-macro.xlsx", macro("renamed-macro.xlsx")],
      ["unsafe/xlm-macrosheet.xlsx", "xlm-macrosheet.xlsx", macro("xlm-macrosheet.xlsx")],
      ["unsafe/zip-bomb.xlsx", "zip-bomb.xlsx", unreadable("zip-bomb.xlsx", "expansion-limit")],
      ["unsafe/entry-count.xlsx", "entry-count.xlsx", unreadable("entry-count.xlsx", "expansion-limit")],
      ["unsafe/lying-size.xlsx", "lying-size.xlsx", unreadable("lying-size.xlsx", "malformed-structure")],
      ["unsafe/truncated.xlsx", "truncated.xlsx", unreadable("truncated.xlsx", "truncated-container")],
      ["unsafe/doctype.xlsx", "doctype.xlsx", unreadable("doctype.xlsx", "entity-declaration")],
      ["unsafe/entity-reference.xlsx", "entity-reference.xlsx", unreadable("entity-reference.xlsx", "malformed-structure")],
      ["unsafe/deep-nesting.xlsx", "deep-nesting.xlsx", unreadable("deep-nesting.xlsx", "malformed-structure")],
      ["unsafe/path-traversal.xlsx", "path-traversal.xlsx", unreadable("path-traversal.xlsx", "malformed-structure")],
      ["unsafe/far-corner.xlsx", "far-corner.xlsx", unreadable("far-corner.xlsx", "impossible-dimension")],
      ["unsafe/zip-encrypted.xlsx", "zip-encrypted.xlsx", unreadable("zip-encrypted.xlsx", "encrypted-workbook")],
      ["unsafe/unknown-method.xlsx", "unknown-method.xlsx", unreadable("unknown-method.xlsx", "unrecognized-content")],
      ["unsafe/encrypted.xlsx", "encrypted.xlsx", unreadable("encrypted.xlsx", "encrypted-workbook")],
      ["unsafe/cfb-loop.xls", "cfb-loop.xls", unreadable("cfb-loop.xls", "directory-loop")],
      ["unsafe/cfb-truncated.xls", "cfb-truncated.xls", unreadable("cfb-truncated.xls", "truncated-container")],
      ["refusals/quarterly.pdf", "quarterly.pdf", { kind: "pdf-file", fileName: "quarterly.pdf", remedy: "pdf-export-from-source" }],
      ["refusals/budget.numbers", "budget.numbers", { kind: "numbers-file", fileName: "budget.numbers", remedy: "numbers-export-xlsx" }],
      ["refusals/chart-export.csv", "chart-export.csv", unreadable("chart-export.csv", "unrecognized-content")],
      // F02's header-only CFB stub: opening its container is now real work.
      ["refusals/ledger.xls", "ledger.xls", unreadable("ledger.xls", "malformed-structure")],
    ];
    for (const [path, name, refusal] of cases) {
      expect(await preflightRefusal(path, name), path).toEqual(refusal);
    }
  });

  it("keeps F02's later-release refusal for every format with no registered reader", async () => {
    const cases: [string, string, string][] = [
      ["refusals/fieldwork.xlsx", "fieldwork.xlsx", "ooxml"],
      ["refusals/legacy-export.xls", "legacy-export.xls", "html"],
      ["refusals/site-plan.ods", "site-plan.ods", "ods"],
      ["unsafe/cfb-size-mismatch.xls", "cfb-size-mismatch.xls", "xls"],
    ];
    for (const [path, name, format] of cases) {
      const source = await fixtureSource(path);
      const outcome = await preflightWorkbook(source, await sniffContent(source, name), new Map());
      expect(outcome, path).toEqual({
        kind: "refused",
        refusal: { kind: "workbook-format-later-release", fileName: name, remedy: "await-later-release", format },
      });
    }
  });
});
