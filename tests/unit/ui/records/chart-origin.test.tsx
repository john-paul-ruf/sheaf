import { describe, expect, it } from "vitest";
import { selectRecordsListVm } from "../../../../src/application/view-models/records.js";
import type { AppNavigation } from "../../../../src/ui/records/app-frame.js";
import { RecordsScreen } from "../../../../src/ui/records/records-screen.js";
import "../../../../src/ui/theme/base.css";
import { query, queryAll, render } from "../render.js";
import { APP_ID, FIELD_IDS, OPTION_IDS, page, session, table } from "./fixtures.js";

/**
 * A chart mark's filter on the records list (S05 CP3; D63; design.md §
 * Accessibility Contract: "Selecting a mark announces the filter and updates
 * the list heading"). The heading names the chart, the filter is a clearable
 * chip, and the announcement says both.
 */

const nav: AppNavigation = {
  library: "#/library",
  appHome: `#/app/${APP_ID}`,
  appHistory: `#/app/${APP_ID}/history`,
  appSnapshots: `#/app/${APP_ID}/snapshots`,
  tables: [],
};
const site = { fieldId: FIELD_IDS.site, operand: { kind: "enum-in" as const, optionIds: [OPTION_IDS.ridgeway] } };

const listVm = (chartOrigin: string | null, filters = [site]) =>
  selectRecordsListVm(table(), page({ total: 4 }), undefined, { filters, sort: null, chartOrigin });

async function renderList(vm: ReturnType<typeof listVm>): Promise<void> {
  await render(
    <RecordsScreen
      app={{ appId: APP_ID, displayName: "Field Log", theme: session().theme }}
      nav={nav}
      newRecordHref="#/new"
      onClearAllFilters={() => undefined}
      onClearFilter={() => undefined}
      onOpenFilter={() => undefined}
      onOpenSort={() => undefined}
      onSearch={() => undefined}
      recordHref={(recordId) => `#/r/${recordId}`}
      vm={vm}
    />,
  );
}

describe("a chart mark's filter on the records list", () => {
  it("names the chart in the heading, keeps the filter clearable, and announces both", async () => {
    const vm = listVm("Quoted by site");
    expect(vm.chartOrigin).toBe("Quoted by site");
    expect(vm.announcement).toBe(
      "Selected mark · Quoted by site. Showing records in Visits that match the filters. 4 match. The table contains 40 records.",
    );
    await renderList(vm);
    expect(query("[data-chart-origin]").textContent).toBe("Selected mark · Quoted by site");
    expect(queryAll('[aria-label="Clear filter Site: Ridgeway Depot"]')).toHaveLength(1);
    expect(query('[role="status"]').textContent).toContain("Selected mark · Quoted by site.");
  });

  it("stops naming the chart once its filters are cleared", async () => {
    const vm = listVm("Quoted by site", []);
    expect(vm.chartOrigin).toBeNull();
    expect(vm.announcement).not.toContain("Selected mark");
    await renderList(vm);
    expect(query("h1").textContent).toBe("Visits");
    expect(queryAll("[data-chart-origin]")).toHaveLength(0);
  });

  it("names no chart for filters chosen here", () => {
    expect(listVm(null).chartOrigin).toBeNull();
  });
});
