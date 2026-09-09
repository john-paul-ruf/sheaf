/**
 * CAP-15, CAP-16 and CAP-17 through the real entry.
 *
 * `index.html` → `src/main.tsx` → `startApp()` → the production data worker →
 * real IndexedDB → the real projection. The only thing supplied from outside
 * is the file a person would have picked.
 *
 * The journey is FR-11/FR-12's, end to end and in order: open the imported app
 * → create a record with typed inputs → save → the acknowledgement that only a
 * durable commit earns → an edit the one validator refuses, explained at field
 * level with nothing written → the correction → a reload that proves it was
 * written → delete (MOD-009) → the change history that makes "recoverable"
 * true (SCR-032) → restore (MOD-010) → the record is back, and valid.
 *
 * **The two reloads are the point.** A reload terminates the worker, which is
 * what locking means (FR-22): everything after one is read from ciphertext on
 * disk, not from anything the page remembered.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  DERIVE_TIMEOUT_MS,
  PASSPHRASE,
  attemptUnlock,
  deleteLocalStore,
  followHash,
  openApp,
  protectDevice,
  screen,
} from "./fixtures/app.js";
import {
  chooseOption,
  importDemoApp,
  openRecord,
  openTable,
  PARSE_TIMEOUT_MS,
} from "./fixtures/records.js";

const TABLE = "Visits";

/** The id the created record is labelled by; the demo file stops at 1040. */
const NEW_VISIT = "1099";

test.afterEach(async ({ page }) => {
  await deleteLocalStore(page);
});

/** A reload is a lock: unlock again, and go back to where we were. */
async function reloadInto(page: Page, hash: string): Promise<void> {
  await openApp(page);
  await attemptUnlock(page, PASSPHRASE);
  await expect(screen(page, "SCR-010")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });
  await followHash(page, hash);
}

test("a record is created, refused, corrected, deleted and restored", async ({
  page,
}) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  const { appHash } = await importDemoApp(page);

  // --- CAP-15: the app is a place, with its table and its exact count ------
  const home = screen(page, "SCR-024");
  await expect(home).toContainText("Field Log");
  await expect(home).toContainText("40 records");

  // --- CAP-17: a freshly imported app's log is truthfully empty ------------
  await followHash(page, `${appHash}/history`);
  await expect(screen(page, "SCR-032")).toBeVisible();
  await expect(screen(page, "SCR-032")).toContainText(
    "No changes since this app was last checkpointed.",
  );
  // Paging is offered only when there is more; there is not.
  await expect(
    page.getByRole("button", { name: "Show older changes" }),
  ).toHaveCount(0);

  // --- CAP-16: create, with a keyboard per field type ----------------------
  await followHash(page, appHash);
  await openTable(page, TABLE);
  await page.getByRole("link", { name: "Add a record", exact: true }).first().click();
  await expect(screen(page, "SCR-028")).toBeVisible();

  const visitId = page.getByLabel("Visit ID", { exact: true });
  await expect(visitId).toHaveAttribute("inputmode", "decimal");
  await visitId.fill(NEW_VISIT);

  const visitDate = page.getByLabel("Visit date", { exact: true });
  await expect(visitDate).toHaveAttribute("type", "date");
  await visitDate.fill("2026-04-20");

  await chooseOption(page, "Site", "Alder Court");
  await chooseOption(page, "Status", "Scheduled");

  const amount = page.getByLabel("Quoted amount", { exact: true });
  await expect(amount).toHaveAttribute("inputmode", "decimal");
  await amount.fill("1975.50");

  // The choice row is the label, so its name carries the field *and* the
  // state it is in ("Follow up No" until it is checked).
  await page.getByRole("checkbox", { name: /^Follow up/u }).check();

  const phone = page.getByLabel("Contact phone", { exact: true });
  await expect(phone).toHaveAttribute("type", "tel");
  await phone.fill("(555) 010-1099");

  await page.getByRole("button", { name: "Save on this device" }).click();

  // --- invariant 1: the acknowledgement arrives with the durable commit ----
  await expect(screen(page, "SCR-027")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });
  const detail = screen(page, "SCR-027");
  await expect(detail).toContainText("Created on this device.");
  await expect(detail).toContainText("Alder Court");
  await expect(detail).toContainText("Apr 20, 2026");
  await expect(detail).toContainText("$1,975.50");
  await expect(detail).toContainText("Yes");
  // FR-12's handoffs, built from the value the record holds.
  await expect(page.getByRole("link", { name: "Call this number" })).toHaveAttribute(
    "href",
    "tel:5550101099",
  );

  const recordHash = new URL(page.url()).hash;

  // --- D23: an edit the one validator refuses ------------------------------
  await page.getByRole("link", { name: "Edit this record" }).click();
  await expect(screen(page, "SCR-029")).toBeVisible();
  await page.getByLabel("Quoted amount", { exact: true }).fill("about a thousand");
  await page.getByRole("button", { name: "Save on this device" }).click();

  // Explained in user language, at the field, and still on the form.
  await expect(screen(page, "SCR-029")).toBeVisible();
  await expect(
    page.getByText("This value is not the kind this field holds."),
  ).toBeVisible();
  // The refusal did not disable the way out of it.
  await expect(
    page.getByRole("button", { name: "Save on this device" }),
  ).toBeEnabled();

  // Nothing was written: a reload reads what is on disk, and it is unchanged.
  await reloadInto(page, recordHash);
  await expect(screen(page, "SCR-027")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });
  await expect(screen(page, "SCR-027")).toContainText("$1,975.50");
  await expect(screen(page, "SCR-027")).not.toContainText("about a thousand");

  // --- the correction, and a reload that proves it landed ------------------
  await page.getByRole("link", { name: "Edit this record" }).click();
  await expect(screen(page, "SCR-029")).toBeVisible();
  await page.getByLabel("Quoted amount", { exact: true }).fill("2400.00");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(screen(page, "SCR-027")).toContainText("Saved on this device.");
  await expect(screen(page, "SCR-027")).toContainText("$2,400.00");

  await reloadInto(page, recordHash);
  await expect(screen(page, "SCR-027")).toBeVisible({
    timeout: DERIVE_TIMEOUT_MS,
  });
  await expect(screen(page, "SCR-027")).toContainText("$2,400.00");

  // --- MOD-009: delete, from SHT-010, with the recoverable promise ---------
  await page.getByRole("button", { name: "Record actions…" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Record actions");
  await sheet.getByRole("button", { name: "Delete record…" }).click();

  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Delete this record?");
  await expect(confirm).toContainText(
    "Deletes remain recoverable in change history.",
  );
  await confirm.getByRole("button", { name: "Delete record", exact: true }).click();

  // Gone from the list, and the table's count says so.
  await expect(screen(page, "SCR-025")).toBeVisible({
    timeout: PARSE_TIMEOUT_MS,
  });
  await expect(screen(page, "SCR-025")).toContainText(
    "This table holds 40 records.",
  );
  await page.getByLabel(`Search ${TABLE}`, { exact: true }).fill(NEW_VISIT);
  await expect(screen(page, "SCR-026")).toBeVisible();
  await expect(screen(page, "SCR-026")).toContainText(
    `No record matches “${NEW_VISIT}”.`,
  );

  // --- CAP-17: the log holds what was authored, delete included ------------
  await followHash(page, `${appHash}/history`);
  await expect(screen(page, "SCR-032")).toBeVisible();
  const history = screen(page, "SCR-032");
  await expect(history).toContainText("Record deleted");
  await expect(history).toContainText("Record changed");
  await expect(history).toContainText("Record created");
  // A log listing names fields, never values.
  await expect(history).not.toContainText("2400.00");

  // --- MOD-010: restore, re-validated, and the record is back -------------
  await page.getByRole("button", { name: "Restore record…" }).click();
  const restore = page.getByRole("alertdialog");
  await expect(restore).toContainText("Restore this record?");
  await expect(restore).toContainText(
    "Restore validates against the current schema before writing a new append-only event.",
  );
  await restore.getByRole("button", { name: "Restore record", exact: true }).click();

  await expect(history).toContainText("Restored on this device.");
  await expect(history).toContainText("Record restored");

  await followHash(page, appHash);
  await openTable(page, TABLE);
  await expect(screen(page, "SCR-025")).toContainText(
    "This table holds 41 records.",
  );
  await openRecord(page, TABLE, NEW_VISIT);
  await expect(screen(page, "SCR-027")).toContainText("$2,400.00");
  await expect(screen(page, "SCR-027")).not.toContainText(
    "must be corrected",
  );
});

test("the imported app's own rows are browsable, searchable and truthful", async ({
  page,
}) => {
  test.setTimeout(300_000);

  await openApp(page);
  await protectDevice(page);
  const { appHash } = await importDemoApp(page);
  await followHash(page, appHash);
  await openTable(page, TABLE);

  // CA-14: the count is the table's, and a search does not narrow it.
  await expect(screen(page, "SCR-025")).toContainText(
    "This table holds 40 records.",
  );
  await page.getByLabel(`Search ${TABLE}`, { exact: true }).fill("Alder");
  await expect(screen(page, "SCR-025")).toContainText(
    "This table holds 40 records.",
  );
  await expect(screen(page, "SCR-025")).toContainText(
    "Showing what matches “Alder” on this device.",
  );

  // FR-6: row 21's amount arrived as "TBD" and was kept, flagged, and shown.
  await page.getByLabel(`Search ${TABLE}`, { exact: true }).fill("1018");
  await expect(screen(page, "SCR-025")).toContainText("1 value needs attention");
  await page.getByRole("link", { name: "1018", exact: true }).click();

  const detail = screen(page, "SCR-027");
  await expect(detail).toContainText("TBD");
  await expect(detail).toContainText(
    "This value came in from the import unchanged and does not fit the field.",
  );
  await expect(detail).toContainText("1 value needs attention");

  // The kept original is what the form offers, so it can actually be fixed.
  await page.getByRole("link", { name: "Edit this record" }).click();
  await expect(
    page.getByLabel("Quoted amount", { exact: true }),
  ).toHaveValue("TBD");
});
