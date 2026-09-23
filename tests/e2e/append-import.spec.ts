/**
 * CAP-26 through the real entry: a CSV/TSV added to an app already on this
 * device as a new table (D38; workbook-fidelity SESSION-07 CP4).
 *
 * `index.html` → the production workers → one import-class commit into the
 * existing app → the landing on the table that commit created → a reload,
 * which is a lock and a fresh worker, and the table is still there. Every
 * journey runs under the no-network fixture.
 *
 * The over-segment file is S06's own generator (`append/over-segment.ts`,
 * imported read-only) handed to the file input in memory.
 */

import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { OVER_SEGMENT_ROWS, overSegmentCsv, underestimatedOverSegmentCsv } from "../fixtures/workbooks/append/over-segment.js";
import { auditable, clipped, undersizedTargets } from "./fixtures/a11y.js";
import {
  COMPACT_VIEWPORT,
  DERIVE_TIMEOUT_MS,
  PASSPHRASE,
  attemptUnlock,
  deleteLocalStore,
  followHash,
  openApp,
  protectDevice,
  screen,
} from "./fixtures/app.js";
import { expect, test } from "./fixtures/no-network.js";

const CORPUS = resolve(process.cwd(), "tests/fixtures/workbooks");
const DEMO_XLSX = resolve(CORPUS, "ooxml/fieldwork-q3.xlsx");
const CREW_ROSTER = resolve(CORPUS, "delimited/crew-roster.tsv");

const PARSE_TIMEOUT_MS = 120_000;

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

/**
 * The demo workbook as an app, the way a person makes it, with Archive 2018
 * left out exactly as the demo script does (D39); returns its hash.
 */
async function importDemoWorkbook(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Choose a workbook" }).click();
  await expect(screen(page, "SCR-016")).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(DEMO_XLSX);
  await expect(screen(page, "SCR-018")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await page.getByRole("checkbox", { name: /^Archive 2018\b/u }).locator("xpath=ancestor::label").click();
  await page.getByRole("button", { name: "Import 6 selected sheets" }).click();
  await expect(screen(page, "SCR-023")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await page.getByRole("button", { name: "Create Fieldwork Q3" }).click();
  await expect(screen(page, "SCR-024")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  return new URL(page.url()).hash;
}

async function pickDelimited(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await followHash(page, "#/upload");
  await expect(screen(page, "SCR-016")).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await expect(screen(page, "SCR-017")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
}

/** A CTL-044 choice is pressed by its label; its input is visually hidden. */
async function chooseDestination(page: Page, label: string): Promise<void> {
  await page.getByText(label, { exact: true }).click();
}

test("a TSV is added to the demo app as a new table, lands on it, and survives a reload", async ({ page, network }) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  const appHash = await importDemoWorkbook(page);

  // --- SCR-017: the existing-app destination is on, with the app to choose --
  await pickDelimited(page, CREW_ROSTER);
  const target = screen(page, "SCR-017");
  await expect(page.getByRole("radio", { name: /Add a table to an existing app/u })).toBeEnabled();
  await chooseDestination(page, "Add a table to an existing app");
  await expect(target).toContainText("Which app");
  await expect(page.getByRole("radio", { name: /Fieldwork Q3/u })).toBeChecked();
  await expect(page.getByLabel("App name", { exact: true })).toHaveCount(0);
  await auditable(page, "SCR-017");
  await page.getByLabel("Table name", { exact: true }).fill("Crew roster");
  await page.getByRole("button", { name: "Check size first" }).click();

  await expect(screen(page, "SCR-018")).toBeVisible();
  await page.getByRole("button", { name: "Import this table" }).click();

  // --- the one review: a value-only table, added to the named app ------------
  const review = screen(page, "SCR-023");
  await expect(review).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await expect(review).toContainText(
    "CSV and TSV carry values, not workbook structure, so there was nothing of this kind to look for.",
  );
  await page.getByRole("button", { name: "Add “Crew roster” to Fieldwork Q3" }).click();

  // --- CAP-26: lands on the table the commit created -------------------------
  const table = screen(page, "SCR-025");
  await expect(table).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  expect(new URL(page.url()).hash.startsWith(`${appHash}/t/`)).toBe(true);
  const tableHash = new URL(page.url()).hash;
  await expect(table).toContainText("Crew roster");
  await expect(table).toContainText("This table holds 4 records.");

  // The app still has its workbook tables beside the new one.
  await followHash(page, appHash);
  const home = screen(page, "SCR-024");
  await expect(home).toBeVisible();
  for (const name of ["Jobs", "Customers", "Crew roster"]) await expect(home).toContainText(name);

  // --- reload: a lock and a fresh worker; the table is durable ---------------
  await openApp(page);
  await attemptUnlock(page, PASSPHRASE);
  await expect(screen(page, "SCR-010")).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
  await expect(screen(page, "SCR-010")).toContainText("1 app is on this device.");
  await followHash(page, tableHash);
  await expect(screen(page, "SCR-025")).toBeVisible({ timeout: DERIVE_TIMEOUT_MS });
  await expect(screen(page, "SCR-025")).toContainText("This table holds 4 records.");
  expect(network.unexpected).toEqual([]);
});

test("a file too large for one commit cannot be appended, and says why (D38)", async ({ page, network }) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  await importDemoWorkbook(page);
  await pickDelimited(page, {
    name: "over-segment.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(overSegmentCsv(), "utf8"),
  });

  // Pre-flight's estimate of this file already exceeds one segment, so the
  // option is off with D38's arithmetic rather than offered and refused later.
  const target = screen(page, "SCR-017");
  await expect(page.getByRole("radio", { name: /Add a table to an existing app/u })).toBeDisabled();
  await expect(target).toContainText(/About [\d,]+ rows would add about [\d,]+ changes to an app, and one addition holds at most 10,000\./u);
  await expect(target).toContainText("This file can become a new app instead.");
  expect(OVER_SEGMENT_ROWS).toBeGreaterThan(10_000);
  await auditable(page, "SCR-017");

  // The library holds exactly the one app; nothing was staged into it.
  await followHash(page, "#/library");
  await expect(screen(page, "SCR-010")).toContainText("1 app is on this device.");
  expect(network.unexpected).toEqual([]);
});

test("an append whose estimate fits but whose rows do not is refused at create, nothing written (append-too-large, D38)", async ({
  page,
  network,
}) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  const appHash = await importDemoWorkbook(page);
  await pickDelimited(page, {
    name: "crew-notes.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(underestimatedOverSegmentCsv(), "utf8"),
  });

  // Pre-flight read only long rows, so its estimate fits: the destination is offered.
  await expect(page.getByRole("radio", { name: /Add a table to an existing app/u })).toBeEnabled();
  await chooseDestination(page, "Add a table to an existing app");
  await page.getByLabel("Table name", { exact: true }).fill("Crew notes");
  await page.getByRole("button", { name: "Check size first" }).click();
  await expect(screen(page, "SCR-018")).toBeVisible();
  await page.getByRole("button", { name: "Import this table" }).click();

  // The exact count is promotion's: one commit cannot hold these rows.
  const review = screen(page, "SCR-023");
  await expect(review).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await page.getByRole("button", { name: "Add “Crew notes” to Fieldwork Q3" }).click();
  await expect(review).toContainText("The table was not added.", { timeout: PARSE_TIMEOUT_MS });
  await expect(review).toContainText(
    "This file has more rows than one addition to an app can hold, so nothing was written and this review is unchanged. It can be imported as a new app instead.",
  );
  await auditable(page, "SCR-023");

  // Nothing reached the app: its tables are the workbook's.
  await page.getByRole("button", { name: "Cancel import…" }).click();
  await expect(screen(page, "SCR-022")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await followHash(page, appHash);
  const home = screen(page, "SCR-024");
  await expect(home).toBeVisible();
  await expect(home).toContainText("Jobs");
  await expect(home).not.toContainText("Crew notes");
  expect(network.unexpected).toEqual([]);
});

test("axe and 320px: the existing-app destination", async ({ page, network }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(COMPACT_VIEWPORT);

  await openApp(page);
  await protectDevice(page);
  await importDemoWorkbook(page);
  await pickDelimited(page, CREW_ROSTER);
  await chooseDestination(page, "Add a table to an existing app");
  await expect(screen(page, "SCR-017")).toContainText("Which app");
  await auditable(page, "SCR-017");
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);
  expect(network.unexpected).toEqual([]);
});
