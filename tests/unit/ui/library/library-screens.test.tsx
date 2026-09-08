import { describe, expect, it, vi } from "vitest";
import {
  selectLibraryVm,
  type EmptyLibraryVm,
  type LibraryTileVm,
  type LibraryVm,
  type PopulatedLibraryVm,
} from "../../../../src/application/view-models/library.js";
import type { LibraryAppV1 } from "../../../../src/workers/protocol/messages.js";
import { EmptyLibraryScreen } from "../../../../src/ui/library/empty-library-screen.js";
import {
  LibraryScreen,
  describeAppCount,
  describeContents,
} from "../../../../src/ui/library/library-screen.js";
import { LibrarySearchScreen } from "../../../../src/ui/library/library-search-screen.js";
import { ROUTE_HREFS, appHref } from "../../../../src/routes/guards.js";
import "../../../../src/ui/theme/base.css";
import {
  TARGET_MIN,
  interact,
  query,
  queryAll,
  render,
  typeInto,
} from "../render.js";

/**
 * SCR-010/011/012 as rendered (CAP-14, CA-14).
 *
 * The assertions are about *what a person can read and reach*: every state the
 * view model can produce, every disabled control's stated reason, and the two
 * truths a library surface must never blur — an uncounted row cache is not "0
 * rows", and an empty library is not an empty search result.
 */

const nav = ROUTE_HREFS;

function app(overrides: Partial<LibraryAppV1> = {}): LibraryAppV1 {
  return {
    appId: "app-1",
    displayName: "Field Log Messy",
    accentId: "leaf",
    glyph: "FL",
    createdAtEpochMs: 1_757_000_000_000,
    lastOpenedAtEpochMs: null,
    rowCountCache: 40,
    tableCount: 1,
    isScratch: true,
    ...overrides,
  };
}

function populated(vm: LibraryVm): PopulatedLibraryVm {
  if (vm.kind !== "populated") {
    throw new Error("expected a populated library");
  }
  return vm;
}

function emptyVm(vm: LibraryVm): EmptyLibraryVm {
  if (vm.kind !== "empty") {
    throw new Error("expected an empty library");
  }
  return vm;
}

/** The one tile the fixture app produces, straight from the view model. */
function tile(): LibraryTileVm {
  const [first] = populated(selectLibraryVm([app()])).tiles;
  if (first === undefined) throw new Error("expected one tile");
  return first;
}

describe("SCR-011 — the empty library keeps its one truthful next action", () => {
  it("offers a live upload and a durable home that states why it is off", async () => {
    const chooseWorkbook = vi.fn();
    await render(
      <EmptyLibraryScreen
        nav={nav}
        onChooseWorkbook={chooseWorkbook}
        vm={emptyVm(selectLibraryVm([]))}
      />,
    );

    expect(query('[data-screen="SCR-011"]')).toBeTruthy();

    const buttons = queryAll("button");
    const choose = buttons.find(
      (button) => button.textContent === "Choose a workbook",
    );
    const connect = buttons.find(
      (button) => button.textContent === "Connect a durable home",
    );
    expect(choose?.hasAttribute("disabled")).toBe(false);
    expect(connect?.hasAttribute("disabled")).toBe(true);

    // CTL-014: a disabled action states its reason in text, and the reason is
    // wired to the control rather than merely printed beside it.
    const reasonId = connect?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(reasonId)?.textContent).toBe(
      "Connecting a durable home is not available in this release.",
    );
    // The F01 upload refusal copy no longer exists anywhere (D5's flip).
    expect(document.body.textContent).not.toContain(
      "Uploading a workbook is not available",
    );

    await interact(() => {
      choose?.click();
    });
    expect(chooseWorkbook).toHaveBeenCalledTimes(1);
  });
});

describe("SCR-010 — tiles say only what the catalog told them", () => {
  it("renders one tile per app, named and reachable by its own link", async () => {
    const vm = populated(
      selectLibraryVm([
        app(),
        app({ appId: "app-2", displayName: "Crew Roster", accentId: "clay" }),
      ]),
    );

    await render(
      <LibraryScreen
        appHref={appHref}
        nav={nav}
        searchHref={ROUTE_HREFS.librarySearch}
        vm={vm}
      />,
    );

    expect(query('[data-screen="SCR-010"]')).toBeTruthy();
    expect(queryAll("[data-tile]")).toHaveLength(2);
    expect(document.body.textContent).toContain("2 apps are on this device.");

    const link = queryAll<HTMLAnchorElement>("a").find(
      (anchor) => anchor.textContent === "Field Log Messy",
    );
    // S08's destination, reserved: CA-07 answers it with the library today.
    expect(link?.getAttribute("href")).toBe("#/app/app-1");
  });

  it("says 'not counted yet' for an absent row cache, never '0 rows'", () => {
    expect(describeContents({ ...tile(), rowCount: null })).toBe(
      "1 table · rows not counted yet",
    );
    expect(describeContents({ ...tile(), rowCount: 0 })).toBe(
      "1 table · 0 rows",
    );
    expect(describeContents({ ...tile(), rowCount: 1 })).toBe("1 table · 1 row");
  });

  it("renders the scratch badge only for an app with no durable home", async () => {
    const { rerender } = await render(
      <LibraryScreen
        appHref={appHref}
        nav={nav}
        searchHref={ROUTE_HREFS.librarySearch}
        vm={populated(selectLibraryVm([app({ isScratch: true })]))}
      />,
    );
    expect(document.body.textContent).toContain("Scratch · not backed up");

    await rerender(
      <LibraryScreen
        appHref={appHref}
        nav={nav}
        searchHref={ROUTE_HREFS.librarySearch}
        vm={populated(selectLibraryVm([app({ isScratch: false })]))}
      />,
    );
    // `not-stated` guesses no backup time and claims no backup state at all.
    expect(document.body.textContent).not.toContain("Scratch");
    expect(document.body.textContent).not.toContain("backed up");
  });

  it("states an unopened app as unopened rather than as a time", async () => {
    await render(
      <LibraryScreen
        appHref={appHref}
        nav={nav}
        searchHref={ROUTE_HREFS.librarySearch}
        vm={populated(selectLibraryVm([app({ lastOpenedAtEpochMs: null })]))}
      />,
    );
    expect(document.body.textContent).toContain("Not opened yet");
  });

  it("composes the device count in the singular when there is one app", () => {
    expect(describeAppCount(1)).toBe("1 app is on this device.");
    expect(describeAppCount(4)).toBe("4 apps are on this device.");
  });

  it("gives every action the minimum hit area", async () => {
    await render(
      <LibraryScreen
        appHref={appHref}
        nav={nav}
        searchHref={ROUTE_HREFS.librarySearch}
        vm={populated(selectLibraryVm([app()]))}
      />,
    );
    const buttons = queryAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(getComputedStyle(button).minHeight).toBe(TARGET_MIN);
    }
  });
});

describe("SCR-012 — search keeps its term and its scope", () => {
  it("filters by name and reports how many of how many matched", async () => {
    const apps = [app(), app({ appId: "app-2", displayName: "Crew Roster" })];
    let searched = "";

    const { rerender } = await render(
      <LibrarySearchScreen
        appHref={appHref}
        nav={nav}
        onSearch={(next) => {
          searched = next;
        }}
        vm={populated(selectLibraryVm(apps, "crew"))}
      />,
    );

    expect(query('[data-screen="SCR-012"]')).toBeTruthy();
    expect(queryAll("[data-tile]")).toHaveLength(1);
    expect(document.body.textContent).toContain(
      "1 result of 2 apps on this device",
    );

    await typeInto(query<HTMLInputElement>("input"), "roster");
    expect(searched).toBe("roster");

    await rerender(
      <LibrarySearchScreen
        appHref={appHref}
        nav={nav}
        onSearch={() => undefined}
        vm={populated(selectLibraryVm(apps, "payroll 2024"))}
      />,
    );

    // STA-026: the term is still visible, still clearable, and no zero-count
    // tile was invented in its place.
    expect(queryAll("[data-tile]")).toHaveLength(0);
    expect(document.body.textContent).toContain(
      "No app matches “payroll 2024”.",
    );
    expect(query<HTMLInputElement>("input").value).toBe("payroll 2024");
    expect(
      queryAll("button").some(
        (button) => button.textContent === "Clear search",
      ),
    ).toBe(true);
  });

  it("promises only the scope the model reports", async () => {
    await render(
      <LibrarySearchScreen
        appHref={appHref}
        nav={nav}
        onSearch={() => undefined}
        vm={populated(selectLibraryVm([app()]))}
      />,
    );
    expect(document.body.textContent).toContain(
      "Search covers apps on this device.",
    );
    expect(document.body.textContent).not.toContain("durable-home");
  });
});
