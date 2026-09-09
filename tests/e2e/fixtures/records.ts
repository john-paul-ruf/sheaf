/**
 * The app-area plumbing the records specs share (S08).
 *
 * Like `./app.ts`, everything here drives the **production entry**: the real
 * `index.html`, the real workers, real IndexedDB. The demo file is S03's
 * `field-log-messy.csv`, whose inferred proposal is pinned by an
 * exact-expectation unit test — so a records spec is exercising the same
 * schema the inference layer is contracted to produce.
 */

import { resolve } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { screen } from "./app.js";

export const DEMO_CSV = resolve(
  process.cwd(),
  "tests/fixtures/workbooks/delimited/field-log-messy.csv",
);

/** A parse of the whole demo file, on a busy machine. */
export const PARSE_TIMEOUT_MS = 120_000;

export interface DemoApp {
  /** `#/app/{appId}` — where the app home lives. */
  readonly appHash: string;
}

/**
 * Library → upload → pre-flight → import → review → Create app, and out the
 * other side on SCR-024. Every step is the one a person takes; nothing here
 * reaches past the surface.
 */
export async function importDemoApp(
  page: Page,
  appName = "Field Log",
  tableName = "Visits",
): Promise<DemoApp> {
  await page.getByRole("button", { name: "Choose a workbook" }).click();
  await expect(screen(page, "SCR-016")).toBeVisible();
  await page.setInputFiles('input[type="file"]', DEMO_CSV);

  await expect(screen(page, "SCR-017")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });
  await page.getByLabel("App name", { exact: true }).fill(appName);
  await page.getByLabel("Table name", { exact: true }).fill(tableName);
  await page.getByRole("button", { name: "Check size first" }).click();

  await expect(screen(page, "SCR-018")).toBeVisible();
  await page.getByRole("button", { name: "Import this table" }).click();

  await expect(screen(page, "SCR-023")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });
  await page.getByRole("button", { name: /^Create / }).click();

  await expect(screen(page, "SCR-024")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });
  const hash = new URL(page.url()).hash;
  return { appHash: hash };
}

/** The app home's link into a table, followed. */
export async function openTable(page: Page, tableName: string): Promise<void> {
  await page.getByRole("link", { name: tableName, exact: true }).first().click();
  await expect(screen(page, "SCR-025")).toBeVisible();
}

/** Searches the list and opens the one record whose label is `label`. */
export async function openRecord(
  page: Page,
  tableName: string,
  label: string,
): Promise<void> {
  await page.getByLabel(`Search ${tableName}`, { exact: true }).fill(label);
  await page.getByRole("link", { name: label, exact: true }).click();
  await expect(screen(page, "SCR-027")).toBeVisible();
}

/** The enum trigger for a field, whose accessible name is "field · value". */
export function enumTrigger(page: Page, fieldName: string): Locator {
  return page.getByRole("button", { name: new RegExp(`^${fieldName} `, "u") });
}

/** Opens SHT-001 for `fieldName`, chooses `option`, and applies it. */
export async function chooseOption(
  page: Page,
  fieldName: string,
  option: string,
): Promise<void> {
  await enumTrigger(page, fieldName).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText(`Choose ${fieldName}`);
  await sheet.getByRole("button", { name: option, exact: true }).click();
  await sheet.getByRole("button", { name: "Apply choice" }).click();
  await expect(enumTrigger(page, fieldName)).toContainText(option);
}
