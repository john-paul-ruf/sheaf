/**
 * GATE-F02 — the ROADMAP demo script, executable.
 *
 * `program/sheaf/ROADMAP.md`, F02, verbatim:
 *
 * > unlock → upload messy CSV → pre-flight → review proposal (rename column,
 * > fix a type) → Create app → app home → search → open record → typed edit
 * > with validation → save → **reload: durable** → upload an .xlsx → approved
 * > refusal surface (truthful: workbook formats land in F03).
 *
 * This file runs it through the **real entry** — `index.html` →
 * `src/main.tsx` → `startApp()` → the production data worker → the production
 * import worker → a page-created `MessageChannel` → real IndexedDB — and
 * asserts the demo package's own facts along the way: the served artifact is
 * the revision under test, and the app survives the reload that terminates the
 * worker.
 *
 * It is therefore also the **full-entry proof** for CAP-13 (surface restart
 * leg), CAP-15, CAP-16 and CAP-17: everything the gate demonstrates, a person
 * reached by accessible name, on a build served from `dist/`.
 *
 * The demo is run at the compact phone class, because that is the class the
 * design is written for and the one where a surface fails first.
 */

import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import {
  COMPACT_VIEWPORT,
  DERIVE_TIMEOUT_MS,
  PASSPHRASE,
  attemptUnlock,
  deleteLocalStore,
  followHash,
  lockDevice,
  openApp,
  protectDevice,
  screen,
} from "./fixtures/app.js";
import { chooseOption, DEMO_CSV, PARSE_TIMEOUT_MS } from "./fixtures/records.js";
import { auditable, clipped, undersizedTargets } from "./fixtures/a11y.js";
import { resolve } from "node:path";

/** The revision this run is demonstrating. */
const headRevision = execSync("git rev-parse HEAD").toString().trim();

const WORKBOOK_XLSX = resolve(
  process.cwd(),
  "tests/fixtures/workbooks/refusals/fieldwork.xlsx",
);

const TABLE = "Visits";

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

test("GATE-F02 demo: a messy CSV becomes an app that survives a reload", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize(COMPACT_VIEWPORT);

  // --- the demo package's first fact: what is being served -----------------
  await openApp(page);
  expect(await page.evaluate(() => window.__sheafBuildId)).toBe(headRevision);

  // --- unlock (the device is protected first, as a fresh profile must be) --
  await protectDevice(page);
  await lockDevice(page);
  await attemptUnlock(page, PASSPHRASE);
  await expect(screen(page, "SCR-011")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });

  // --- upload the messy CSV ------------------------------------------------
  await page.getByRole("button", { name: "Choose a workbook" }).click();
  await expect(screen(page, "SCR-016")).toBeVisible();
  await page.setInputFiles('input[type="file"]', DEMO_CSV);

  // --- pre-flight ----------------------------------------------------------
  await expect(screen(page, "SCR-017")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });
  await expect(screen(page, "SCR-017")).toContainText("Comma");
  await expect(screen(page, "SCR-017")).toContainText(/About [\d,]+ rows/);
  await page.getByLabel("App name", { exact: true }).fill("Field Log");
  await page.getByLabel("Table name", { exact: true }).fill(TABLE);
  await page.getByRole("button", { name: "Check size first" }).click();
  await expect(screen(page, "SCR-018")).toContainText(
    "This file fits this device.",
  );
  await page.getByRole("button", { name: "Import this table" }).click();

  // --- one review: rename a column, and fix a type -------------------------
  await expect(screen(page, "SCR-023")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });
  const review = screen(page, "SCR-023");
  await expect(review).toContainText("“Site” looks like a choice from a list.");

  const visitId = page.locator(
    '[data-field] [data-statement]:has-text("Column 1 will be called “Visit ID”.")',
  );
  await visitId.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Field name", { exact: true }).fill("Visit number");
  await page.getByRole("button", { name: "Save change" }).click();
  await expect(review).toContainText("Column 1 will be called “Visit number”.");

  const quoted = page.locator(
    '[data-field] [data-statement]:has-text("“Quoted amount” looks like currency in USD.")',
  );
  await quoted.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: /This field holds/ }).click();
  await page.getByRole("option", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: "Save change" }).click();
  await expect(review).toContainText("“Quoted amount” looks like text.");
  // The value that did not fit a currency fits text, so nothing is flagged now.
  await expect(review).not.toContainText(
    "1 original value does not match its field.",
  );

  // --- Create app ----------------------------------------------------------
  await page.getByRole("button", { name: /^Create / }).click();

  // --- app home ------------------------------------------------------------
  await expect(screen(page, "SCR-024")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });
  const appHash = new URL(page.url()).hash;
  const home = screen(page, "SCR-024");
  await expect(home).toContainText("Field Log");
  await expect(home).toContainText(TABLE);
  await expect(home).toContainText("40 records");
  await expect(home).toContainText("On this device only");
  // Truthful absence: the metrics and the pinned chart are F04's.
  await expect(home).toContainText(
    "Charts, saved views and at-a-glance totals are computed surfaces.",
  );

  // --- search --------------------------------------------------------------
  await page.getByRole("link", { name: TABLE, exact: true }).first().click();
  await expect(screen(page, "SCR-025")).toBeVisible();
  await page.getByLabel(`Search ${TABLE}`, { exact: true }).fill("Alder");
  // CA-14: the count is the table's, and a search does not narrow it.
  await expect(screen(page, "SCR-025")).toContainText(
    "This table holds 40 records.",
  );

  // --- open a record -------------------------------------------------------
  await page.getByLabel(`Search ${TABLE}`, { exact: true }).fill("1002");
  await page.getByRole("link", { name: "1002", exact: true }).click();
  await expect(screen(page, "SCR-027")).toBeVisible();
  const recordHash = new URL(page.url()).hash;

  // --- typed edit with validation -----------------------------------------
  await page.getByRole("link", { name: "Edit this record" }).click();
  await expect(screen(page, "SCR-029")).toBeVisible();

  // The date field is a native picker; the visit number is a decimal keypad.
  await expect(page.getByLabel("Visit date", { exact: true })).toHaveAttribute(
    "type",
    "date",
  );
  await expect(
    page.getByLabel("Visit number", { exact: true }),
  ).toHaveAttribute("inputmode", "decimal");

  // A rule violation: the visit number is a number, and this is not one.
  await page.getByLabel("Visit number", { exact: true }).fill("not a number");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText("This value is not the kind this field holds."),
  ).toBeVisible();
  await expect(screen(page, "SCR-029")).toBeVisible();

  // --- save (the correction, through the enum sheet as well) ---------------
  await page.getByLabel("Visit number", { exact: true }).fill("1002");
  await chooseOption(page, "Status", "Complete");
  await page.getByRole("button", { name: "Save on this device" }).click();

  await expect(screen(page, "SCR-027")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });
  await expect(screen(page, "SCR-027")).toContainText("Saved on this device.");
  await expect(screen(page, "SCR-027")).toContainText("Complete");

  // --- reload: durable -----------------------------------------------------
  // The reload terminates the worker, which is what locking means (FR-22), so
  // everything after it is read from ciphertext on this device.
  await openApp(page);
  expect(await page.evaluate(() => window.__sheafBuildId)).toBe(headRevision);
  await attemptUnlock(page, PASSPHRASE);
  await expect(screen(page, "SCR-010")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });
  await expect(screen(page, "SCR-010")).toContainText("Field Log");

  await followHash(page, recordHash);
  await expect(screen(page, "SCR-027")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });
  await expect(screen(page, "SCR-027")).toContainText("Complete");

  // The change history holds the edit, and says what it is the history of.
  await followHash(page, `${appHash}/history`);
  await expect(screen(page, "SCR-032")).toContainText("Record changed");
  await expect(screen(page, "SCR-032")).toContainText(
    "since this app was last checkpointed",
  );

  // --- upload an .xlsx → the approved refusal (truthful: F03) --------------
  await followHash(page, "#/upload");
  await expect(screen(page, "SCR-016")).toBeVisible();
  await page.setInputFiles('input[type="file"]', WORKBOOK_XLSX);
  await expect(screen(page, "SCR-021")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });
  const refused = screen(page, "SCR-021");
  await expect(refused).toContainText("This file cannot become a Sheaf app.");
  await expect(refused).toContainText("an Excel workbook (.xlsx)");
  await expect(refused).toContainText(
    "This release reads CSV and TSV. Workbook formats arrive in a later release.",
  );
  await expect(refused).toContainText(
    "The refusal is whole-file. Nothing partial was added to the library.",
  );

  // The library still holds exactly the one app the demo created.
  await page.getByRole("button", { name: "Return to library" }).click();
  await expect(screen(page, "SCR-010")).toContainText("1 app is on this device.");
});

/**
 * The rest of the accessibility contract on the app-area surfaces, at the
 * width where a surface fails first. The axe audits live in
 * `accessibility.spec.ts`; this is the geometry half — nothing clipped at
 * 320px, nothing under the 44px floor, on every screen the demo passes
 * through.
 */
test("GATE-F02 demo: every surface it touches holds at 320px", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize(COMPACT_VIEWPORT);

  await openApp(page);
  await protectDevice(page);
  await page.getByRole("button", { name: "Choose a workbook" }).click();
  await page.setInputFiles('input[type="file"]', DEMO_CSV);
  await expect(screen(page, "SCR-017")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });
  await page.getByLabel("App name", { exact: true }).fill("Field Log");
  await page.getByLabel("Table name", { exact: true }).fill(TABLE);
  await page.getByRole("button", { name: "Check size first" }).click();
  await page.getByRole("button", { name: "Import this table" }).click();
  await expect(screen(page, "SCR-023")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });
  await page.getByRole("button", { name: /^Create / }).click();
  await expect(screen(page, "SCR-024")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });

  for (const step of ["SCR-024"]) {
    await auditable(page, step);
  }
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);

  await page.getByRole("link", { name: TABLE, exact: true }).first().click();
  await expect(screen(page, "SCR-025")).toBeVisible();
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);

  await page.getByLabel(`Search ${TABLE}`, { exact: true }).fill("1002");
  await page.getByRole("link", { name: "1002", exact: true }).click();
  await expect(screen(page, "SCR-027")).toBeVisible();
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);

  await page.getByRole("link", { name: "Edit this record" }).click();
  await expect(screen(page, "SCR-029")).toBeVisible();
  expect(await clipped(page)).toEqual([]);
  expect(await undersizedTargets(page)).toEqual([]);
});
