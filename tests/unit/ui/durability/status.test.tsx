import { expect, it } from "vitest";
import { AppBackupStatus } from "../../../../src/ui/records/app-frame.js";
import { query, render } from "../render.js";

it.each([
  [null, null, 0, "On this device only · not backed up", "Back up now"],
  ["home", null, 0, "Backup not confirmed", "Save a fresh bundle"],
  ["home", 0, 0, "Backup confirmed", "Save a fresh bundle"],
  ["home", 0, 2, "Bundle out of date", "Save a fresh bundle"],
] as const)("shows receipt/count/remedy for %s %s %s", async (homeId, confirmedAtMs, deviceOnlyChangeCount, title, remedy) => {
  await render(<AppBackupStatus facts={{ homeId, homeName: "Bundle", confirmedAtMs, deviceOnlyChangeCount }} href="#/app/a/backup" />);
  expect(document.body.textContent).toContain(title);
  expect(query("[data-status-count]").textContent).toBe(`${deviceOnlyChangeCount} changes only on this device.`);
  expect(query("[data-status-time]").getAttribute("data-status-time")).toBe(confirmedAtMs === null ? "never" : "0");
  expect(query("a").textContent).toBe(remedy);
  expect(query("a").getAttribute("href")).toBe("#/app/a/backup");
  expect(document.body.textContent).not.toMatch(/Dropbox|OneDrive|synced/);
});
