/**
 * The container spine in real Chromium (S01 CP4; CA-17, CA-18, CAP-27).
 *
 * The node suite proves the readers against node's `DecompressionStream`;
 * the import worker runs them in a browser. Here the built modules — reached
 * through the harness, exactly as Vite emitted them — open the demo workbook
 * from a real `File`, pre-flight it with the OOXML reader, and stream sheets
 * through the adapter. The counts must be the node test's counts, which is
 * what proves the platform decompressor and the bounded readers behave the
 * same in the environment the import worker will run in.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type * as FactsModule from "../../../src/import/facts/index.js";
import type * as OoxmlModule from "../../../src/import/formats/ooxml/index.js";
import type * as PreflightModule from "../../../src/import/preflight/workbook.js";
import type * as SniffModule from "../../../src/import/source/sniff.js";
import type * as SourceModule from "../../../src/import/source/source.js";
import type * as ZipModule from "../../../src/import/source/zip.js";
import { DEMO_FACT_COUNTS, DEMO_PRESERVED_PARTS } from "../../fixtures/workbooks/ooxml/demo-counts.js";

const headRevision = execSync("git rev-parse HEAD").toString().trim();

const fixture = (relativePath: string): number[] => [
  ...readFileSync(`tests/fixtures/workbooks/${relativePath}`),
];

interface BrowserRun {
  readonly outcome: string;
  readonly route: string | null;
  readonly sheetNames: readonly string[];
  readonly detail: string | null;
  readonly counts: Record<string, Record<string, number>>;
  readonly parts: Record<string, Record<string, number>>;
  readonly summary: unknown;
}

/** Runs sniff → pre-flight → adapter in the page over one real `File`. */
const runInPage = (
  page: import("@playwright/test").Page,
  bytes: readonly number[],
  name: string,
  selection: readonly number[],
): Promise<BrowserRun> =>
  page.evaluate(
    async ([content, fileName, chosen]) => {
      const harness = window.__sheafHarness;
      const { blobSource } = await harness.module<typeof SourceModule>("/src/import/source/source.ts");
      const { sniffContent } = await harness.module<typeof SniffModule>("/src/import/source/sniff.ts");
      const { openZipContainer } = await harness.module<typeof ZipModule>("/src/import/source/zip.ts");
      const { preflightWorkbook } = await harness.module<typeof PreflightModule>("/src/import/preflight/workbook.ts");
      const { ooxmlAdapter, ooxmlInventoryReader } = await harness.module<typeof OoxmlModule>(
        "/src/import/formats/ooxml/index.ts",
      );

      const file = new File([Uint8Array.from(content)], fileName);
      const source = blobSource(file);
      const outcome = await preflightWorkbook(
        source,
        await sniffContent(source, file.name),
        new Map([["xlsx", ooxmlInventoryReader]]),
      );
      if (outcome.kind === "refused") {
        const refusal = outcome.refusal;
        return {
          outcome: refusal.kind,
          route: null,
          sheetNames: [],
          detail: refusal.kind === "binary-unreadable" ? (refusal.detail ?? null) : null,
          counts: {},
          parts: {},
          summary: null,
        };
      }

      const counts: Record<string, Record<string, number>> = {};
      const parts: Record<string, Record<string, number>> = {};
      let current = "";
      let summary: unknown = null;
      const zip = await openZipContainer(source);
      const stream = ooxmlAdapter.parseSheets({ kind: "zip", zip }, chosen, { cancellation: { aborted: false } });
      for await (const item of stream as AsyncIterable<FactsModule.WorkbookFactStreamItemV2>) {
        if (item.kind === "summary") {
          summary = item;
          continue;
        }
        for (const fact of item.facts) {
          if (fact.kind === "sheet") current = fact.name;
          const sheet = (counts[current] ??= {});
          sheet[fact.kind] = (sheet[fact.kind] ?? 0) + 1;
          if (fact.kind === "preserved-part") {
            const partCounts = (parts[current] ??= {});
            partCounts[fact.partKind] = (partCounts[fact.partKind] ?? 0) + 1;
          }
        }
      }
      return {
        outcome: "proceed",
        route: outcome.report.route,
        sheetNames: outcome.report.sheets.map((sheet) => sheet.name),
        detail: null,
        counts,
        parts,
        summary,
      };
    },
    [bytes, name, selection] as [readonly number[], string, readonly number[]],
  );

test.beforeEach(async ({ page }) => {
  await page.goto("/harness.html");
});

test("serves the harness built from the current revision", async ({ page }) => {
  await expect.poll(async () => page.evaluate(() => window.__sheafBuildId)).toBe(headRevision);
});

test("sizes and streams the demo workbook from a real File with the node counts", async ({ page }) => {
  const run = await runInPage(page, fixture("ooxml/fieldwork-q3.xlsx"), "fieldwork-q3.xlsx", [0, 6]);

  expect(run.outcome).toBe("proceed");
  expect(run.route).toBe("fits");
  expect(run.sheetNames).toEqual(["Jobs", "Customers", "Crew", "Visits", "Materials", "Overview", "Archive 2018"]);
  expect(run.counts).toEqual({ Jobs: DEMO_FACT_COUNTS.Jobs, "Archive 2018": DEMO_FACT_COUNTS["Archive 2018"] });
  expect(run.parts).toEqual({ Jobs: DEMO_PRESERVED_PARTS.Jobs, "Archive 2018": DEMO_PRESERVED_PARTS["Archive 2018"] });
  expect(run.summary).toMatchObject({ kind: "summary", rowCount: 61 + 2001, valueCount: 610 + 8004 });
});

test("refuses a zip bomb and a macro workbook the same way in the browser", async ({ page }) => {
  const bomb = await runInPage(page, fixture("unsafe/zip-bomb.xlsx"), "zip-bomb.xlsx", [0]);
  expect(bomb).toMatchObject({ outcome: "binary-unreadable", detail: "expansion-limit" });

  const macro = await runInPage(page, fixture("unsafe/payroll.xlsm"), "payroll.xlsm", [0]);
  expect(macro.outcome).toBe("macro-content");
});
