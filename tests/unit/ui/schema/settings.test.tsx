import { describe, expect, it, vi } from "vitest";
import type { AppAreaWiring } from "../../../../src/routes/app-area-hooks.js";
import { AppSettingsRoute } from "../../../../src/routes/schema-routes.js";
import type { ListSheetSnapshotsResponseV1 } from "../../../../src/workers/protocol/messages.js";
import "../../../../src/ui/theme/base.css";
import { query, queryAll, render, settle, typeInto } from "../render.js";
import { APP_ID, preview } from "./fixtures.js";
import { appliedOutcome, button, dialog, fakeSchema, press, wiring } from "./harness.js";

/**
 * SCR-037 as rendered (S06 CP3; app-settings.html), truthful per feature:
 * every served route is a link with its real counts, every later-release row
 * is named and disabled with its reason, Theme & logo links to its editor with
 * the stored theme's summary, and durability states only this device's facts.
 */

const sheets: ListSheetSnapshotsResponseV1 = {
  kind: "listSheetSnapshots",
  sheets: [
    { sheetId: "s-1", displayName: "Jobs", sheetOrdinal: 0, classification: [], declaredRowCount: 6, declaredColumnCount: 6, snapshotRevision: 1, inertCounts: [{ kind: "chart", count: 2 }] },
    { sheetId: "s-2", displayName: "Notes", sheetOrdinal: 1, classification: [], declaredRowCount: null, declaredColumnCount: null, snapshotRevision: 1, inertCounts: [{ kind: "image", count: 1 }] },
  ],
};

async function open(schema = fakeSchema()) {
  const area = wiring(schema, {
    records: { listSheetSnapshots: vi.fn(() => Promise.resolve(sheets)) } as unknown as AppAreaWiring["records"],
  });
  await render(<AppSettingsRoute area={area} clearNotice={() => undefined} />);
  await settle();
  return area;
}

describe("SCR-037 — app settings", () => {
  it("links what this release serves, with the counts it read", async () => {
    await open();
    const structureRow = query('[data-section="structure"]');
    const links = [...structureRow.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toEqual([
      ["Tables, fields & rules", `#/app/${APP_ID}/structure`],
      ["Original sheet snapshots", `#/app/${APP_ID}/snapshots`],
    ]);
    expect(structureRow.textContent).toContain("2 tables · 9 fields · 1 relationship");
    expect(structureRow.textContent).toContain("2 sheets · 3 inert items");
    expect(query('[data-section="history"] a').getAttribute("href")).toBe(`#/app/${APP_ID}/history`);
  });

  it("names the later-release rows, disabled with the reason", async () => {
    await open();
    for (const title of ["Re-upload a newer workbook", "Export data & charts", "Remove or delete"]) {
      const row = query(`[data-later="${title}"]`);
      expect(row.querySelector("button")?.disabled, title).toBe(true);
      expect(row.textContent, title).toContain("Arrives in a later release.");
    }
  });

  it("links Theme & logo to SCR-036 with the stored theme's summary (CAP-37)", async () => {
    await open();
    const appearance = query('[data-section="appearance"]');
    const link = appearance.querySelector("a");
    expect([link?.textContent, link?.getAttribute("href")]).toEqual(["Theme & logo", `#/app/${APP_ID}/theme`]);
    // The F02 built-in names no palette, so the summary says only what it knows.
    expect(appearance.textContent).toContain("Light · comfortable");
    expect(appearance.querySelector('[aria-hidden="true"]')?.textContent).toBe("FL");
  });

  it("states durability from this device's facts, and offers no backup", async () => {
    await open();
    const durability = query('[data-section="durability"]');
    expect(durability.textContent).toContain("On this device only · not backed up");
    expect(durability.textContent).toContain("3 changes only on this device.");
    expect(queryAll("button").map((candidate) => candidate.textContent)).not.toContain("Back up now");
  });

  it("renames the app through a preview, and says so only after the commit", async () => {
    const schema = fakeSchema({ previews: [preview("rename-app")], outcomes: [appliedOutcome()] });
    const area = await open(schema);
    const name = query<HTMLInputElement>('[data-section="identity"] input');
    await typeInto(name, "Cedar & Finch Fieldbook");
    await press("Save name");
    await settle();
    expect(dialog().textContent).toContain("Rename the app to “Cedar & Finch Fieldbook”");
    expect(area.announce).not.toHaveBeenCalled();
    await press("Apply");
    await settle();
    expect((schema.applySchemaChange as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).toEqual({
      appId: APP_ID,
      change: { kind: "rename-app", name: "Cedar & Finch Fieldbook" },
      previewedSchemaRevision: 4,
    });
    expect(area.announce).toHaveBeenCalledWith("Saved on this device.", []);
  });

  it("marks the frame's Settings destination current", async () => {
    await open();
    const current = queryAll<HTMLAnchorElement>('a[aria-current="page"]');
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((link) => link.getAttribute("href") === `#/app/${APP_ID}/settings`)).toBe(true);
    expect(button("Save name").disabled).toBe(true);
  });
});
