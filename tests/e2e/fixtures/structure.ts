/**
 * The structure journey's plumbing (S06 CP4).
 *
 * The app is a small CSV built here and handed to the real file input, so the
 * journey never depends on the workbook corpus a concurrent session may be
 * changing. Five jobs are enough to keep every column's inferred type exactly
 * what the journey changes it from: Status stays Text (inference needs at
 * least eight values for a choice list), Crew size stays Text ("12" and "x" — one of two is not
 * a number), and one job already finishes before it starts, so the rule the
 * journey adds has exactly one failing record to count.
 */

import { expect, type Page } from "@playwright/test";
import { screen } from "./app.js";
import { PARSE_TIMEOUT_MS } from "./records.js";

export const JOBS_CSV = [
  "Name,Start,Finish by,Quoted,Paid,Status,Crew size",
  "Deck repair,2026-03-02,2026-03-20,1200,200,Scheduled,12",
  "Fence paint,2026-03-05,2026-03-15,800,800,Complete,x",
  "Gutter clean,2026-03-10,2026-03-08,300,0,Scheduled,",
  "Roof patch,2026-04-01,2026-04-30,2500,1000,In progress,",
  "Shed build,2026-04-10,2026-05-01,4000,0,Scheduled,",
  "",
].join("\n");

export const APP_NAME = "Crew Jobs";
export const TABLE_NAME = "Jobs";

/** Library → upload the CSV → pre-flight → import → review → Create app, landing on SCR-024. */
export async function importJobsApp(page: Page): Promise<{ readonly appHash: string }> {
  await page.getByRole("button", { name: "Choose a workbook" }).click();
  await expect(screen(page, "SCR-016")).toBeVisible();
  await page.setInputFiles('input[type="file"]', {
    name: "jobs.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(JOBS_CSV, "utf8"),
  });
  await expect(screen(page, "SCR-017")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await page.getByLabel("App name", { exact: true }).fill(APP_NAME);
  await page.getByLabel("Table name", { exact: true }).fill(TABLE_NAME);
  await page.getByRole("button", { name: "Check size first" }).click();
  await expect(screen(page, "SCR-018")).toBeVisible();
  await page.getByRole("button", { name: "Import this table" }).click();
  await expect(screen(page, "SCR-023")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  await page.getByRole("button", { name: /^Create / }).click();
  await expect(screen(page, "SCR-024")).toBeVisible({ timeout: PARSE_TIMEOUT_MS });
  return { appHash: new URL(page.url()).hash };
}

/** A React Aria select: open it by its label, choose an option by its name. */
export async function choose(page: Page, label: string, option: string): Promise<void> {
  const trigger = page.getByRole("button", { name: new RegExp(`${label}$`, "u") });
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(trigger).toContainText(option);
}

/** MOD-014 open, its counts read, then applied; resolves once the commit is announced. */
export async function applyImpact(page: Page, counts: readonly string[], action = /^Apply/u): Promise<void> {
  const mod = page.locator('[data-dialog="MOD-014"]');
  await expect(mod).toBeVisible();
  for (const line of counts) await expect(mod).toContainText(line);
  await page.getByRole("dialog").getByRole("button", { name: action }).click();
  await expect(mod).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Saved on this device." }).first()).toBeAttached();
}

/** Chooses a field in SCR-035's list and waits for its panel. */
export async function openField(page: Page, fieldName: string): Promise<void> {
  const structure = screen(page, "SCR-035");
  await structure.locator("[data-structure-field]").filter({ hasText: new RegExp(`^${fieldName}`, "u") }).click();
  await expect(structure.getByRole("heading", { level: 2, name: fieldName, exact: true })).toBeVisible();
}
