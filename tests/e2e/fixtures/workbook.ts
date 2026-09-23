/**
 * The workbook-import plumbing the F03 specs share: S07's steps, moved here
 * from `workbook-import.spec.ts` so the relationship, snapshot and gate specs
 * drive the same surface the same way rather than each keeping a copy.
 *
 * Everything goes through the production entry and the real workers; the only
 * thing supplied is the file a person would have picked.
 */

import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import { screen } from "./app.js";

const CORPUS = resolve(process.cwd(), "tests/fixtures/workbooks");

/** The GATE-F03 demo workbook (`build-demo.ts`). */
export const DEMO_XLSX = resolve(CORPUS, "ooxml/fieldwork-q3.xlsx");
export const MACRO_WORKBOOK = resolve(CORPUS, "unsafe/payroll.xlsm");

/** A whole workbook through two workers, on a busy machine. */
export const WORKBOOK_TIMEOUT_MS = 120_000;

export type PickedFile =
  | string
  | { readonly name: string; readonly mimeType: string; readonly buffer: Buffer };

export async function openUpload(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Choose a workbook" }).click();
  await expect(screen(page, "SCR-016")).toBeVisible();
}

export async function chooseFile(page: Page, file: PickedFile): Promise<void> {
  await page.locator('input[type="file"]').first().setInputFiles(file);
}

/** A CTL-043 row is pressed by its label; its input is visually hidden. */
export async function toggleSheet(page: Page, name: string): Promise<void> {
  await page
    .getByRole("checkbox", { name: new RegExp(`^${name}\\b`, "u") })
    .locator("xpath=ancestor::label")
    .click();
}

/** SCR-023: “Do not connect these lists” for one proposed connection. */
export async function rejectConnection(page: Page, relationshipKey: string): Promise<void> {
  const review = screen(page, "SCR-023");
  await review
    .locator(`[data-connection="${relationshipKey}"]`)
    .getByRole("button", { name: "Change connection" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /This connection/u }).click();
  await page.getByRole("option", { name: "Do not connect these lists" }).click();
  await dialog.getByRole("button", { name: "Save change" }).click();
  await expect(review.locator(`[data-connection="${relationshipKey}"]`)).toHaveAttribute(
    "data-applied",
    "false",
    { timeout: WORKBOOK_TIMEOUT_MS },
  );
}

/** The demo's Visits → Jobs key-match connection (S02's pinned proposal). */
export const VISITS_TO_JOBS = "rel:s3.t0.c1";

/**
 * Library → upload → SCR-018 → review, rejecting Visits → Jobs → Create,
 * landing on SCR-024. Archive 2018 is left out unless `allSheets` — the
 * prescribed demo selection (ROADMAP F03); the full 7-sheet selection is
 * CAP-23's surface leg since OWNER-PROMOTION-SEAMS `cd4fe9d`. Returns the
 * app's `#/app/{id}` hash.
 */
export async function importDemoWorkbook(page: Page, { allSheets = false } = {}): Promise<string> {
  await openUpload(page);
  await chooseFile(page, DEMO_XLSX);
  await expect(screen(page, "SCR-018")).toBeVisible({ timeout: WORKBOOK_TIMEOUT_MS });
  if (!allSheets) {
    await toggleSheet(page, "Archive 2018");
  }
  await page.getByRole("button", { name: `Import ${allSheets ? "7" : "6"} selected sheets` }).click();
  await expect(screen(page, "SCR-023")).toBeVisible({ timeout: WORKBOOK_TIMEOUT_MS });
  await rejectConnection(page, VISITS_TO_JOBS);
  await page.getByRole("button", { name: "Create Fieldwork Q3" }).click();
  await expect(screen(page, "SCR-024")).toBeVisible({ timeout: WORKBOOK_TIMEOUT_MS });
  return new URL(page.url()).hash;
}
