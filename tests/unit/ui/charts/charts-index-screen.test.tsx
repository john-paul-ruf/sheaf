import { describe, expect, it, vi } from "vitest";
import { selectChartsIndexVm } from "../../../../src/application/view-models/records.js";
import { ChartsIndexScreen } from "../../../../src/ui/charts/charts-index-screen.js";
import type { AppNavigation } from "../../../../src/ui/records/app-frame.js";
import type { ChartDefinitionWireV1, ChartViewV1 } from "../../../../src/workers/protocol/messages.js";
import "../../../../src/ui/theme/base.css";
import { interact, query, queryAll, render } from "../render.js";
import { APP_ID, FIELD_IDS, session, table } from "../records/fixtures.js";
import { dataset } from "./fixtures.js";

/**
 * SCR-053 as rendered (S05 CP5; DF-2's charts.html): every chart by name with
 * its origin and pin, the pin as a toggle whose label never changes, the
 * empty state, and the app frame's Charts destination marked current.
 */

const nav: AppNavigation = {
  library: "#/library",
  appHome: `#/app/${APP_ID}`,
  appHistory: `#/app/${APP_ID}/history`,
  appSnapshots: `#/app/${APP_ID}/snapshots`,
  charts: `#/app/${APP_ID}/charts`,
  tables: [],
};
const identity = { appId: APP_ID, displayName: "Field Log", theme: session().theme };

const chart = (chartId: string, name: string, pinned: boolean, provenance: ChartViewV1["provenance"], extra: Partial<ChartDefinitionWireV1> = {}): ChartViewV1 => ({
  chartId,
  definition: { ...dataset().definition, name, pinned, ...extra } as ChartDefinitionWireV1,
  ordinal: 0,
  provenance,
  chartRevision: 4,
});

async function renderIndex(charts: readonly ChartViewV1[]) {
  const onTogglePin = vi.fn();
  await render(
    <ChartsIndexScreen
      app={identity}
      chartHref={(chartId) => `#/app/${APP_ID}/charts/${chartId}`}
      nav={nav}
      newChartHref={`#/app/${APP_ID}/charts/new`}
      onTogglePin={onTogglePin}
      vm={selectChartsIndexVm(charts, [table()])}
    />,
  );
  return { onTogglePin };
}

describe("SCR-053 — the charts index", () => {
  it("lists every chart by name, with its type, table, grouping, origin and pin", async () => {
    await renderIndex([
      chart("c-2", "Visits by month", false, "imported", { type: "line", groupBy: { kind: "date", fieldId: FIELD_IDS.visitDate, unit: "month" } }),
      chart("c-1", "Quoted by site", true, "user"),
    ]);
    expect(query('[data-screen="SCR-053"]').textContent).toContain("2 charts · 1 pinned to app home");
    const rows = queryAll("[data-chart-row]");
    expect(rows.map((row) => row.getAttribute("data-chart-row"))).toEqual(["c-1", "c-2"]);
    expect(rows[0]?.textContent).toContain("Bar · Visits");
    expect(rows[0]?.textContent).toContain("Made here");
    expect(rows[0]?.textContent).toContain("On app home");
    expect(rows[1]?.textContent).toContain("Line · Visits, grouped by Visit date (month)");
    expect(rows[1]?.textContent).toContain("From workbook");
    expect(rows[1]?.textContent).not.toContain("On app home");
    expect(queryAll<HTMLAnchorElement>("[data-chart-row] a").map((link) => link.getAttribute("href"))).toEqual([
      `#/app/${APP_ID}/charts/c-1`,
      `#/app/${APP_ID}/charts/c-2`,
    ]);
  });

  it("toggles the pin with one constant label and its state in aria-pressed", async () => {
    const { onTogglePin } = await renderIndex([chart("c-1", "Quoted by site", true, "user"), chart("c-2", "Visits", false, "user")]);
    const toggles = queryAll<HTMLButtonElement>("[data-chart-row] button");
    expect(toggles.map((toggle) => [toggle.getAttribute("aria-label"), toggle.getAttribute("aria-pressed"), toggle.textContent])).toEqual([
      ["Pin to app home: Quoted by site", "true", "✓Pin to app home"],
      ["Pin to app home: Visits", "false", "Pin to app home"],
    ]);
    await interact(() => {
      toggles[1]?.click();
    });
    expect(onTogglePin).toHaveBeenCalledWith(expect.objectContaining({ chartId: "c-2", pinned: false, chartRevision: 4 }));
  });

  it("says there are no charts yet, and offers a new one", async () => {
    await renderIndex([]);
    const empty = query('[data-empty="no-charts"]');
    expect(empty.textContent).toContain("No charts yet");
    expect(empty.querySelector("a")?.getAttribute("href")).toBe(`#/app/${APP_ID}/charts/new`);
  });

  it("marks the app frame's Charts destination as the current one", async () => {
    await renderIndex([]);
    const current = queryAll<HTMLAnchorElement>('a[aria-current="page"]');
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((link) => link.getAttribute("href") === `#/app/${APP_ID}/charts`)).toBe(true);
  });
});
