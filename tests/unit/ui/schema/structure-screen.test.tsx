import { describe, expect, it, vi } from "vitest";
import { selectStructureVm } from "../../../../src/application/view-models/schema.js";
import { StructureScreen } from "../../../../src/ui/schema/structure-screen.js";
import "../../../../src/ui/theme/base.css";
import { interact, query, queryAll, render } from "../render.js";
import { APP_ID, IDS, identity, nav, structure } from "./fixtures.js";

/**
 * SCR-035 as rendered (S06 CP1; schema.html): the tables and fields lists,
 * the chosen field's detail, the rules across fields and the calculations —
 * and the app frame's Structure destination marked current, with Settings
 * beside it and no more than six destinations at any width.
 */

async function renderStructure(fieldId: string | null = null) {
  const onSelectTable = vi.fn();
  const onSelectField = vi.fn();
  await render(
    <StructureScreen
      app={identity}
      nav={nav}
      onAddRule={vi.fn()}
      onEditRule={vi.fn()}
      onOpenFieldActions={vi.fn()}
      onPropose={vi.fn()}
      onSelectField={onSelectField}
      onSelectTable={onSelectTable}
      vm={selectStructureVm(structure(), { tableId: IDS.jobs, fieldId })}
    />,
  );
  return { onSelectTable, onSelectField };
}

describe("SCR-035 — the app structure, read", () => {
  it("names the tables with their field counts and marks the chosen one", async () => {
    await renderStructure();
    const tables = queryAll("[data-structure-table]");
    expect(tables.map((row) => row.textContent)).toEqual(["Jobs8 fields", "Customers1 field"]);
    expect(tables[0]?.getAttribute("aria-current")).toBe("true");
    expect(tables[1]?.getAttribute("aria-current")).toBe("false");
  });

  it("lists the chosen table's fields with their tags, a removed field said so", async () => {
    await renderStructure();
    const fields = queryAll("[data-structure-field]").map((row) => row.textContent);
    expect(fields).toContain("BalanceLive");
    expect(fields).toContain("StatusChoice");
    expect(fields).toContain("NotesRemoved");
  });

  it("shows a computed field read-only with its expression", async () => {
    await renderStructure(IDS.balance);
    const detail = query(`[data-structure-detail="${IDS.balance}"]`);
    expect(detail.textContent).toContain("Computed · not typed");
    expect(detail.textContent).toContain("In plain language");
    expect(detail.querySelector("code")?.textContent).toBe("[Quoted]-[Paid]");
  });

  it("says a rule as its sentence under \"A valid Jobs\"", async () => {
    await renderStructure();
    const rules = query('[data-section="rules"]');
    expect(rules.textContent).toContain("Rules across fields");
    expect(rules.textContent).toContain("A valid Jobs");
    expect(query(`[data-rule="${IDS.rule}"]`).textContent).toContain("Finish by is on or after Start");
  });

  it("hands a chosen table or field to the route", async () => {
    const { onSelectTable, onSelectField } = await renderStructure();
    await interact(() => {
      query<HTMLButtonElement>(`[data-structure-table="${IDS.customers}"]`).click();
    });
    await interact(() => {
      query<HTMLButtonElement>(`[data-structure-field="${IDS.status}"]`).click();
    });
    expect(onSelectTable).toHaveBeenCalledWith(IDS.customers);
    expect(onSelectField).toHaveBeenCalledWith(IDS.status);
  });

  it("marks the frame's Structure destination current, beside Settings, six in all", async () => {
    await renderStructure();
    const destinations = queryAll<HTMLAnchorElement>("nav[aria-label='Primary']")[0]?.querySelectorAll("a") ?? [];
    expect([...destinations].map((link) => link.getAttribute("href"))).toEqual([
      `#/app/${APP_ID}`,
      `#/app/${APP_ID}/t/${IDS.jobs}`,
      `#/app/${APP_ID}/charts`,
      `#/app/${APP_ID}/structure`,
      `#/app/${APP_ID}/settings`,
      "#/library",
    ]);
    const current = queryAll<HTMLAnchorElement>('a[aria-current="page"]');
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((link) => link.getAttribute("href") === `#/app/${APP_ID}/structure`)).toBe(true);
  });
});
