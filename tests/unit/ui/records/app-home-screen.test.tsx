import { describe, expect, it } from "vitest";
import { selectAppHomeVm } from "../../../../src/application/view-models/records.js";
import { AppHomeScreen } from "../../../../src/ui/records/app-home-screen.js";
import type { AppNavigation } from "../../../../src/ui/records/app-frame.js";
import "../../../../src/ui/theme/base.css";
import { query, queryAll, render } from "../render.js";
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

  it("states the scratch fact and offers no backup it cannot perform (D26)", async () => {
    await renderHome();

    const banner = query('[data-tone="warning"]');
    expect(banner.textContent).toContain("On this device only");
    expect(banner.textContent).toContain("1 change exists");
    expect(banner.textContent).toContain(
      "Choosing a durable home and backing up arrive in a later release.",
    );

    const buttons = queryAll("button").map((button) => button.textContent);
    expect(buttons).not.toContain("Back up now");
  });

  it("says nothing at all when the app is not scratch", async () => {
    await renderHome(
      selectAppHomeVm(session({ isScratch: false, deviceOnlyChangeCount: 0 })),
    );

    expect(queryAll('[data-tone="warning"]')).toHaveLength(0);
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
