import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { attemptUnlock, deleteLocalStore, followHash, openApp, protectDevice, screen, PASSPHRASE } from "./fixtures/app.js";
import { importDemoApp, openRecord, openTable } from "./fixtures/records.js";
import { applyImpact } from "./fixtures/structure.js";
import { buildBundleReader, createNativeBundleHome, decodedGraphFacts, dismissExpectedScratchReminder, inspectDurability, openProductionPage,
  readBundle, saveFreshNativeBundle, useNativeDestination, writeDurabilityEvidence, type DecodedGraphFactsV1 } from "./fixtures/durability.js";

/** Production defaults (compaction.ts); J3 never lowers them or touches a clock. */
const THRESHOLD = 128;
const INTERVAL_MS = 1500;
const SECRET = "journey three cedar lantern";
const EVIDENCE = "test-results/f05/s06";
const CREW_ROSTER = resolve(process.cwd(), "tests/fixtures/workbooks/delimited/crew-roster.tsv");

test.beforeAll(buildBundleReader);

test("retained history scope and empty state remain readable at every layout width", async ({ page }) => {
  test.setTimeout(300_000);
  try {
    await openApp(page);
    await protectDevice(page);
    const { appHash } = await importDemoApp(page);
    await followHash(page, `${appHash}/history`);
    await expect(screen(page, "SCR-032")).toContainText("No retained changes yet.");
    await inspectDurability(page, "history-empty", "s06");
    await followHash(page, appHash);
    await openTable(page, "Visits");
    await openRecord(page, "Visits", "1002");
    await page.getByRole("link", { name: "Edit this record" }).click();
    await page.getByLabel("Quoted amount", { exact: true }).fill("2300.00");
    await page.getByRole("button", { name: "Save on this device" }).click();
    await expect(screen(page, "SCR-027")).toContainText("Saved on this device.");
    await dismissExpectedScratchReminder(page);
    await followHash(page, `${appHash}/history`);
    await expect(screen(page, "SCR-032")).toContainText("Changes retained with this app");
    await expect(screen(page, "SCR-032")).not.toContainText("checkpointed");
    await expect(page.locator("[data-event]")).toHaveCount(1);
    await expect(page.locator("[data-event]")).toContainText("Record changed");
    await inspectDurability(page, "history-retained", "s06");
    await writeDurabilityEvidence("cp2-history-ui", { widths: [320, 600, 900, 1200], empty: true, retained: 1,
      buildId: await page.evaluate(() => window.__sheafBuildId), endpoint: new URL(page.url()).origin }, "s06");
  } finally { await deleteLocalStore(page); }
});

interface Recovered {
  readonly facts: DecodedGraphFactsV1;
  readonly history: readonly { eventId: number[]; eventKind: string; subjectId: number[]; restoration: unknown }[];
  readonly oracle: { readonly replayed: number; readonly checkpointStorageId: string };
}

test("J3: two periodic compactions, same-context restart, retained-history restore, V2 edit and append, then vault-only recovery", async ({ browser }) => {
  test.setTimeout(600_000);
  const context = await browser.newContext();
  await useNativeDestination(context);
  const decoder = await browser.newContext();
  let live = await openProductionPage(context);
  let page: Page = live.page;
  page.setDefaultTimeout(20_000);
  const artifacts: { label: string; sha256: string; facts: DecodedGraphFactsV1; oracleReplayed: number; oracleCheckpoint: string }[] = [];
  await mkdir(EVIDENCE, { recursive: true });
  try {
    await expect(page.locator("[data-screen]")).toBeVisible({ timeout: 90_000 });
    const localCode = await protectDevice(page);
    const { appHash } = await importDemoApp(page);

    /** One vault-only decode in the separate empty decoder context; the oracle replay must equal the recovered projection. */
    const recover = async (label: string, bytes: Buffer): Promise<Recovered> => {
      const decoded = await readBundle(decoder, bytes, SECRET);
      const json = JSON.parse(decoded) as { evidence: { history: Recovered["history"]; records: unknown[]; authoredSha256: string }; deviceChains: unknown[];
        originalCommits: { deviceId: number[]; deviceCommitSequence: string; commitSha256: number[] }[];
        oracle: { replayed: number; checkpointStorageId: string; authoredSha256: string; history: unknown[]; records: unknown[] } };
      expect(json.oracle.authoredSha256, `${label} authored state`).toBe(json.evidence.authoredSha256);
      expect(json.oracle.history, `${label} history and restoration`).toEqual(json.evidence.history);
      expect(json.oracle.records, `${label} rows, revisions and provenance`).toEqual(json.evidence.records);
      const last = json.originalCommits.at(-1)!;
      expect(json.deviceChains, `${label} chain`).toEqual([{ deviceId: last.deviceId, commitSequence: last.deviceCommitSequence, commitSha256: last.commitSha256 }]);
      const facts = decodedGraphFacts(decoded);
      await writeFile(`${EVIDENCE}/j3-${label}.bundle`, bytes);
      artifacts.push({ label, sha256: createHash("sha256").update(bytes).digest("hex"), facts, oracleReplayed: json.oracle.replayed, oracleCheckpoint: json.oracle.checkpointStorageId });
      return { facts, history: json.evidence.history, oracle: json.oracle };
    };
    const observe = async (label: string) => recover(label, await saveFreshNativeBundle(page, appHash));
    const idle = () => page.waitForTimeout(2 * INTERVAL_MS + 500);
    const untilCompacted = async (label: string, previous: DecodedGraphFactsV1["checkpointFrontier"]) => {
      let result: Recovered | undefined;
      await expect.poll(async () => { result = await observe(label); return result.facts.headVersion === 2 && JSON.stringify(result.facts.checkpointFrontier) !== JSON.stringify(previous); },
        { timeout: 30_000, intervals: [INTERVAL_MS] }).toBe(true);
      expect(result!.facts).toMatchObject({ tailCommits: 0, checkpointFrontier: result!.facts.frontier });
      return result!;
    };

    const home = await recover("home", await createNativeBundleHome(page, appHash, "Journey bundle", SECRET));
    expect(home.facts.headVersion).toBe(1);

    // --- authored theme, chart, schema and delete through the real UI -------------------------
    await followHash(page, `${appHash}/settings`);
    await screen(page, "SCR-037").getByRole("link", { name: "Theme & logo" }).click();
    await screen(page, "SCR-036").getByText("Indigo", { exact: true }).click();
    await screen(page, "SCR-036").getByRole("button", { name: "Save theme locally" }).click();
    await expect(screen(page, "SCR-037")).toBeVisible();
    await followHash(page, `${appHash}/charts/new`);
    await expect(screen(page, "SCR-034")).toBeVisible();
    for (const [label, option] of [["Group by", "Site"], ["Measure", "Sum of quoted amount"]] as const) {
      await page.getByRole("button", { name: new RegExp(`${label}$`, "u") }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    }
    await page.getByLabel("Chart name", { exact: true }).fill("Quoted by site");
    await page.getByRole("button", { name: "Save & pin" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save chart" }).click();
    await expect(screen(page, "SCR-033")).toBeVisible();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Structure", exact: true }).click();
    await expect(screen(page, "SCR-035")).toBeVisible();
    await screen(page, "SCR-035").getByLabel("Table name", { exact: true }).fill("Site visits");
    await screen(page, "SCR-035").getByRole("button", { name: "Rename table" }).click();
    await applyImpact(page, ["records are affected."]);
    await followHash(page, appHash);
    await openTable(page, "Site visits");
    await openRecord(page, "Site visits", "1003");
    await page.getByRole("button", { name: "Record actions…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete record…" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete record", exact: true }).click();
    await expect(screen(page, "SCR-025")).toBeVisible();
    await openRecord(page, "Site visits", "1002");
    const recordHash = new URL(page.url()).hash;
    let amount = 1000;
    const edit = async (count: number) => {
      await followHash(page, recordHash);
      for (let index = 0; index < count; index++) {
        await page.getByRole("link", { name: "Edit this record" }).click();
        await page.getByLabel("Quoted amount", { exact: true }).fill(`${++amount}.00`);
        await page.getByRole("button", { name: "Save on this device" }).click();
        await expect(screen(page, "SCR-027")).toContainText("Saved on this device.");
      }
    };

    // --- first threshold: 127 is not eligible; the real timer fires on 128 --------------------
    const authored = await observe("authored");
    await edit(THRESHOLD - 1 - authored.facts.tailCommits);
    const below = await observe("first-127");
    expect(below.facts).toMatchObject({ headVersion: 1, tailCommits: THRESHOLD - 1 });
    await idle();
    expect((await observe("first-127-idle")).facts).toMatchObject({ headVersion: 1, tailCommits: THRESHOLD - 1, checkpointFrontier: below.facts.checkpointFrontier });
    await followHash(page, `${appHash}/history`);
    await expect(page.locator("[data-event]").first()).toContainText("Record changed");
    const liveFirstPage = await page.locator("[data-event]").count();
    await edit(1);
    const first = await untilCompacted("first-compaction", below.facts.checkpointFrontier);
    expect(first.facts.auditPages).toBeGreaterThan(0);
    expect(first.facts.originalCommits).toBe(below.facts.originalCommits + 1);
    expect(first.oracle.checkpointStorageId).toBe(below.oracle.checkpointStorageId);
    expect(first.history.slice(1)).toEqual(below.history);
    const deletion = first.history.find((event) => event.eventKind === "record.deleted")!;
    expect(deletion.restoration).not.toBeNull();
    await idle();
    expect((await observe("first-empty-tail")).facts).toMatchObject({ headVersion: 2, tailCommits: 0, checkpointFrontier: first.facts.checkpointFrontier });

    // --- same-context page and worker replacement; retained history through the UI ------------
    await live.close();
    live = await openProductionPage(context);
    page = live.page;
    page.setDefaultTimeout(20_000);
    await attemptUnlock(page, PASSPHRASE);
    await expect(screen(page, "SCR-010")).toBeVisible({ timeout: 90_000 });
    await followHash(page, `${appHash}/history`);
    const history = screen(page, "SCR-032");
    await expect(history).toContainText("Changes retained with this app");
    await expect(page.locator("[data-event]").first()).toContainText("Record changed");
    expect(await page.locator("[data-event]").count()).toBeGreaterThanOrEqual(liveFirstPage);
    await inspectDurability(page, "j3-history-after-compaction", "s06");
    let pages = 1;
    while (await page.getByRole("button", { name: "Restore record…" }).count() === 0) {
      const older = page.getByRole("button", { name: "Show older changes" });
      await expect(older).toBeEnabled({ timeout: 30_000 });
      const shown = await page.locator("[data-event]").count();
      await older.click();
      await expect.poll(() => page.locator("[data-event]").count(), { timeout: 30_000 }).toBeGreaterThan(shown);
      expect(++pages).toBeLessThan(10);
    }
    await page.getByRole("button", { name: "Restore record…" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Restore record", exact: true }).click();
    await expect(history).toContainText("Restored on this device.");
    await edit(1);

    // --- CAP-26 append into the V2 app through the import UI, then another restart -------------
    await followHash(page, "#/upload");
    await expect(screen(page, "SCR-016")).toBeVisible();
    await page.locator('input[type="file"]').first().setInputFiles(CREW_ROSTER);
    await expect(screen(page, "SCR-017")).toBeVisible({ timeout: 120_000 });
    await page.getByText("Add a table to an existing app", { exact: true }).click();
    await page.getByLabel("Table name", { exact: true }).fill("Crew roster");
    await page.getByRole("button", { name: "Check size first" }).click();
    await expect(screen(page, "SCR-018")).toBeVisible();
    await page.getByRole("button", { name: "Import this table" }).click();
    await expect(screen(page, "SCR-023")).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: /^Add “Crew roster” to / }).click();
    await expect(screen(page, "SCR-025")).toContainText("This table holds 4 records.", { timeout: 120_000 });
    await live.close();
    live = await openProductionPage(context);
    page = live.page;
    page.setDefaultTimeout(20_000);
    await attemptUnlock(page, PASSPHRASE);
    await expect(screen(page, "SCR-010")).toBeVisible({ timeout: 90_000 });
    await followHash(page, appHash);
    for (const name of ["Site visits", "Crew roster"]) await expect(screen(page, "SCR-024")).toContainText(name);
    await openTable(page, "Site visits");
    await openRecord(page, "Site visits", "1003");
    await followHash(page, recordHash);
    await expect(screen(page, "SCR-027")).toContainText(`$${amount.toLocaleString("en-US")}.00`);
    const appended = await observe("restored-edited-appended");
    expect(appended.facts).toMatchObject({ headVersion: 2, tailCommits: 3, checkpointFrontier: first.facts.checkpointFrontier, auditPages: first.facts.auditPages });
    expect(appended.facts.originalCommits).toBe(first.facts.originalCommits + 3);
    expect(appended.history.filter((event) => event.eventKind === "record.restored").map((event) => event.subjectId)).toEqual([deletion.subjectId]);

    // --- second threshold proves the recurring timer ------------------------------------------
    await edit(THRESHOLD - 1 - appended.facts.tailCommits);
    const secondBelow = await observe("second-127");
    expect(secondBelow.facts).toMatchObject({ headVersion: 2, tailCommits: THRESHOLD - 1, checkpointFrontier: first.facts.checkpointFrontier });
    await edit(1);
    const second = await untilCompacted("second-compaction", first.facts.checkpointFrontier);
    expect(second.facts.originalCommits).toBe(secondBelow.facts.originalCommits + 1);
    expect(second.oracle.checkpointStorageId).toBe(first.oracle.checkpointStorageId);
    expect(second.history.slice(1)).toEqual(secondBelow.history);

    // --- J1 receipt semantics on the compacted format ------------------------------------------
    await followHash(page, `${appHash}/backup`);
    await expect(page.locator("[data-pending-count]")).toHaveAttribute("data-pending-count", "0");
    const confirmedAt = await page.locator("[data-backup-time]").getAttribute("data-backup-time");
    await edit(1);
    await followHash(page, `${appHash}/backup`);
    await expect(page.locator("[data-pending-count]")).toHaveAttribute("data-pending-count", "1");
    await expect(page.locator("[data-backup-time]")).toHaveAttribute("data-backup-time", confirmedAt!);
    const final = await saveFreshNativeBundle(page, appHash);
    const recovered = await recover("final", final);
    expect(recovered.facts).toMatchObject({ headVersion: 2, tailCommits: 1, checkpointFrontier: second.facts.checkpointFrontier });

    // --- vault-only secrets: the vault passphrase decodes; local secrets do not -----------------
    await expect(readBundle(decoder, final, localCode, "recovery")).rejects.toThrow("artifact rejected");
    await expect(readBundle(decoder, final, PASSPHRASE)).rejects.toThrow("artifact rejected");

    await writeDurabilityEvidence("j3", { endpoint: new URL(page.url()).origin, workerUrl: live.worker.url(), assets: live.assets,
      buildId: await page.evaluate(() => window.__sheafBuildId), threshold: THRESHOLD, intervalMs: INTERVAL_MS, liveFirstPage, historyPages: pages, artifacts }, "s06");
  } finally { await live.close().catch(() => undefined); await context.close(); await decoder.close(); }
});
