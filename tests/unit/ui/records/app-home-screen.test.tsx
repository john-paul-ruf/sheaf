import { describe, expect, it, vi } from "vitest";
import { selectAppHomeVm, selectChartDetailVm } from "../../../../src/application/view-models/records.js";
import { dataset } from "../charts/fixtures.js";
import { AppHomeScreen } from "../../../../src/ui/records/app-home-screen.js";
import type { AppNavigation } from "../../../../src/ui/records/app-frame.js";
import "../../../../src/ui/theme/base.css";
import { interact, query, queryAll, render } from "../render.js";

// Chart.js draws nothing in jsdom; the pinned chart's words and marks are Sheaf's.
vi.mock("../../../../src/ui/charts/chart-canvas.js", () => ({ ChartCanvas: () => null }));
import { APP_ID, TABLE_ID, session, table } from "./fixtures.js";

/**
 * SCR-024 as rendered (CAP-15).
 *
 * The claims are the ones the design binds this screen to: the app says where
 * it lives, the tables are reachable with their exact counts, and the surfaces
 * F02 cannot compute are named as absent rather than filled in.
 */

const nav: AppNavigation = {
  library: "#/library",
  appHome: `#/app/${APP_ID}`,
  appHistory: `#/app/${APP_ID}/history`,
  appSnapshots: `#/app/${APP_ID}/snapshots`,
  tables: [
    {
      tableId: TABLE_ID,
      displayName: "Visits",
      href: `#/app/${APP_ID}/t/${TABLE_ID}`,
    },
  ],
};

const tableHref = (tableId: string): string =>
  `#/app/${APP_ID}/t/${tableId}`;
const newRecordHref = (tableId: string): string =>
  `#/app/${APP_ID}/t/${tableId}/new`;

async function renderHome(
  vm = selectAppHomeVm(session()),
): Promise<void> {
  await render(
    <AppHomeScreen
      nav={nav}
      newRecordHref={newRecordHref}
      tableHref={tableHref}
      vm={vm}
      backupHref={`#/app/${APP_ID}/backup`}
    />,
  );
}

describe("SCR-024 — the app becomes a place", () => {
  it("names the app, its tables and their exact counts", async () => {
    await renderHome();

    const screen = query('[data-screen="SCR-024"]');
    expect(screen.textContent).toContain("Field Log");
    expect(screen.textContent).toContain("Visits");
    expect(screen.textContent).toContain("40 records");
    expect(screen.textContent).toContain("9 fields");

    const links = queryAll("a").map((link) => link.getAttribute("href"));
    expect(links).toContain(`#/app/${APP_ID}/t/${TABLE_ID}`);
    expect(links).toContain(`#/app/${APP_ID}/t/${TABLE_ID}/new`);
    expect(links).toContain(`#/app/${APP_ID}/history`);
    expect(links).toContain("#/library");
  });

  it("states the scratch fact and links to the mounted durable-home chooser", async () => {
    await renderHome();

    const banner = query('[data-tone="warning"]');
    expect(banner.textContent).toContain("On this device only");
    expect(banner.textContent).toContain("1 change exists");
    expect(banner.textContent).toContain(
      "Choose a durable home",
    );

    expect(queryAll<HTMLAnchorElement>("a").find((link) => link.textContent === "Choose a durable home")?.getAttribute("href")).toBe(`#/app/${APP_ID}/backup`);
  });

  it("links to backup detail when the app has a home", async () => {
    await renderHome(
      selectAppHomeVm(session({ isScratch: false, deviceOnlyChangeCount: 0 })),
    );

    expect(queryAll('[data-tone="warning"]')).toHaveLength(0);
    expect(queryAll<HTMLAnchorElement>("a").find((link) => link.textContent === "Backup detail")?.getAttribute("href")).toBe(`#/app/${APP_ID}/backup`);
  });

  /** STA-025: the metrics and the pinned chart are F04's, and say so. */
  it("renders no metric it cannot compute", async () => {
    await renderHome();

    const screen = query('[data-screen="SCR-024"]');
    expect(screen.textContent).toContain(
      "Charts, saved views and at-a-glance totals are computed surfaces.",
    );
    expect(screen.textContent).not.toContain("This week's pulse");
  });

  it("applies the app's own theme, and only the app tokens", async () => {
    await renderHome();

    const themed = query("[style]");
    const style = themed.getAttribute("style") ?? "";
    expect(style).toContain("--app-ink: #17211c");
    expect(style).toContain("--app-surface: #fffdf8");
    // Safety semantics are system-owned and cannot be reached from a theme.
    expect(style).not.toContain("--color-danger");
    expect(style).not.toContain("--focus-ring");
  });

  it("shows the initials while no logo is saved", async () => {
    await renderHome();
    expect(queryAll("[data-app-logo]")).toHaveLength(0);
    expect(query('[data-screen="SCR-024"] [aria-hidden="true"]').textContent).toBe("FL");
  });

  it("shows a saved logo in the monogram's place, named as the app (CAP-37)", async () => {
    const logo = { pngBase64: "iVBORw0KGgo=", width: 48, height: 32 };
    const base = session();
    await renderHome(selectAppHomeVm(session({ theme: { ...base.theme, logo } })));
    const image = query<HTMLImageElement>("[data-app-logo]");
    expect(image.getAttribute("alt")).toBe("Field Log");
    expect(image.getAttribute("src")).toBe(`data:image/png;base64,${logo.pngBase64}`);
    expect(queryAll('[data-screen="SCR-024"] [aria-hidden="true"]').filter((node) => node.textContent === "FL")).toHaveLength(0);
  });

  it("offers the lone table's add action in the hero as well as on the card", async () => {
    await renderHome();
    const addLinks = queryAll("a").filter((link) =>
      (link.textContent ?? "").startsWith("Add a record"),
    );
    expect(addLinks).toHaveLength(2);
  });

  it("does not choose a table for the person when there are two", async () => {
    await render(
      <AppHomeScreen
        nav={nav}
        newRecordHref={newRecordHref}
        tableHref={tableHref}
        vm={selectAppHomeVm(
          session({
            tables: [table(), table({ tableId: "table-2", displayName: "Crew" })],
          }),
        )}
      />,
    );
    const twoTableAdds = queryAll("a").filter(
      (link) => link.textContent === "Add a record",
    );
    expect(twoTableAdds).toHaveLength(2);
    expect(
      queryAll("a").filter((link) =>
        (link.textContent ?? "").startsWith("Add a record to"),
      ),
    ).toHaveLength(0);
  });

  it("links \"Edit structure\" beside the tables once the structure route exists (app-home.html)", async () => {
    await render(
      <AppHomeScreen
        nav={{ ...nav, structure: `#/app/${APP_ID}/structure`, settings: `#/app/${APP_ID}/settings` }}
        newRecordHref={newRecordHref}
        tableHref={tableHref}
        vm={selectAppHomeVm(session())}
      />,
    );
    const tables = query('[aria-labelledby="app-tables"]');
    const edit = [...tables.querySelectorAll("a")].find((link) => link.textContent === "Edit structure");
    expect(edit?.getAttribute("href")).toBe(`#/app/${APP_ID}/structure`);
  });

  it("offers no \"Edit structure\" where no structure route serves it", async () => {
    await renderHome();
    expect(queryAll("a").map((link) => link.textContent)).not.toContain("Edit structure");
  });

  it("exposes exactly one primary navigation", async () => {
    await renderHome();
    // M39 renders the rail and the bottom bar; CSS displays one at a time, and
    // both carry the same destinations in the same order.
    const navigations = queryAll("nav[aria-label='Primary']");
    expect(navigations).toHaveLength(2);
    const hrefs = navigations.map((navigation) =>
      [...navigation.querySelectorAll("a")].map((link) =>
        link.getAttribute("href"),
      ),
    );
    expect(hrefs[0]).toEqual(hrefs[1]);
  });
});

describe("SCR-024 — the pinned chart (CAP-32)", () => {
  const pinned = selectChartDetailVm(dataset(), [table()]);

  it("draws each pinned chart with its name, scope, marks and a way to its table", async () => {
    await render(
      <AppHomeScreen
        chartHref={(chartId) => `#/app/${APP_ID}/charts/${chartId}`}
        nav={nav}
        newRecordHref={newRecordHref}
        tableHref={tableHref}
        vm={selectAppHomeVm(session(), [], [pinned])}
      />,
    );
    const section = query('[data-pinned-chart="chart-quoted-by-site"]');
    expect(section.textContent).toContain("Pinned chart");
    expect(query("h2#pinned-chart-quoted-by-site").textContent).toBe("Quoted by site");
    expect(section.textContent).toContain("Tap a bar to filter the list");
    expect(section.textContent).toContain("Showing all 8 local rows");
    const link = queryAll<HTMLAnchorElement>("a").find((anchor) => anchor.textContent === "View data table");
    expect(link?.getAttribute("href")).toBe(`#/app/${APP_ID}/charts/chart-quoted-by-site`);
    // The F02 absence card is not drawn once a computed surface exists.
    expect(query('[data-screen="SCR-024"]').textContent).not.toContain("computed surfaces");
  });

  it("filters the list by exactly a tapped mark, and a mark with no filter does nothing", async () => {
    const onApplyMark = vi.fn();
    await render(
      <AppHomeScreen
        nav={nav}
        newRecordHref={newRecordHref}
        onApplyMark={onApplyMark}
        tableHref={tableHref}
        vm={selectAppHomeVm(session(), [], [pinned])}
      />,
    );
    const marks = queryAll<HTMLButtonElement>("[data-mark]");
    expect(marks[0]?.getAttribute("aria-label")).toBe("Filter by Ridgeway Depot, $1,850.00");
    expect(marks[3]?.getAttribute("aria-label")).toBe("Needs attention, Not given");
    await interact(() => {
      marks[0]?.click();
      marks[3]?.click();
    });
    expect(onApplyMark).toHaveBeenCalledTimes(1);
    expect(onApplyMark.mock.calls[0]?.[1]).toMatchObject({ index: 0 });
  });
});
