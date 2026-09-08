/**
 * CAP-14 (SCR-010/011/012; FR-19). D5's successor and STA-025.
 *
 * The assertions that matter are negative: no tile state F02 cannot produce is
 * constructible, an empty library and an empty search result never collapse
 * into one variant, and no count or instant is invented where the catalog
 * cached none.
 */

import { describe, expect, it } from "vitest";
import {
  selectEmptyLibraryVm,
  selectLibraryVm,
  type EmptyLibraryVm,
  type LibraryTileStatusV1,
  type LibraryTileVm,
  type PopulatedLibraryVm,
} from "../../../src/application/view-models/library.js";
import type { LibraryAppV1 } from "../../../src/workers/protocol/messages.js";

function app(overrides: Partial<LibraryAppV1> = {}): LibraryAppV1 {
  return {
    appId: "app-01",
    displayName: "Field Log",
    accentId: "accent-moss",
    glyph: "FL",
    createdAtEpochMs: 1_700_000_000_000,
    lastOpenedAtEpochMs: null,
    rowCountCache: 40,
    tableCount: 1,
    isScratch: true,
    ...overrides,
  };
}

function populated(vm: ReturnType<typeof selectLibraryVm>): PopulatedLibraryVm {
  if (vm.kind !== "populated") {
    throw new Error(`expected a populated library, got ${vm.kind}`);
  }
  return vm;
}

describe("selectEmptyLibraryVm", () => {
  it("has one variant and no fictional fields", () => {
    const vm = selectEmptyLibraryVm();

    expect(vm.kind).toBe("empty");
    expect(Object.keys(vm).sort()).toEqual([
      "actions",
      "announcement",
      "kind",
      "screen",
    ]);

    type ForbiddenKey = Extract<
      keyof EmptyLibraryVm,
      "apps" | "appCount" | "lastOpenedAt" | "rows" | "placeholders" | "tiles"
    >;
    const noForbiddenKeys: ForbiddenKey extends never ? true : false = true;
    expect(noForbiddenKeys).toBe(true);
  });

  it("enables the upload action and keeps the F05/F06 one disabled (D5)", () => {
    expect(selectEmptyLibraryVm().actions).toEqual([
      {
        id: "choose-workbook",
        label: "Choose a workbook",
        enabled: true,
        intent: "upload-workbook",
      },
      {
        id: "connect-durable-home",
        label: "Connect a durable home",
        enabled: false,
        reason: "durable-homes-not-available-in-this-release",
      },
    ]);
  });

  it("requires a reason from every disabled action, by type", () => {
    for (const action of selectEmptyLibraryVm().actions) {
      if (action.enabled) {
        // The enabled variant has no `reason` field at all to fill.
        expect(action.intent).toBe("upload-workbook");
        continue;
      }
      expect(action.reason.length).toBeGreaterThan(0);
    }
  });

  it("announces the empty state in the mock's words", () => {
    expect(selectEmptyLibraryVm().announcement).toBe(
      "Your apps will live here.",
    );
  });
});

describe("selectLibraryVm", () => {
  it("is empty only when no app exists, whatever was typed", () => {
    expect(selectLibraryVm([]).kind).toBe("empty");
    expect(selectLibraryVm([], "anything").kind).toBe("empty");
  });

  it("projects a tile from the catalog's own facts", () => {
    const vm = populated(
      selectLibraryVm([
        app({
          lastOpenedAtEpochMs: 1_700_000_900_000,
          rowCountCache: 326,
          tableCount: 2,
        }),
      ]),
    );

    expect(vm.screen).toBe("SCR-010");
    expect(vm.searchQuery).toBeNull();
    expect(vm.tiles).toEqual([
      {
        appId: "app-01",
        displayName: "Field Log",
        accentId: "accent-moss",
        glyph: "FL",
        status: "scratch",
        rowCount: 326,
        tableCount: 2,
        createdAtEpochMs: 1_700_000_000_000,
        lastOpenedAtEpochMs: 1_700_000_900_000,
      },
    ]);
  });

  it("keeps an uncounted app uncounted rather than showing zero", () => {
    const vm = populated(selectLibraryVm([app({ rowCountCache: null })]));
    expect(vm.tiles[0]?.rowCount).toBeNull();
  });

  it("renders no time and no formatted number", () => {
    const vm = populated(selectLibraryVm([app()]));
    const tile = vm.tiles[0] as LibraryTileVm;
    expect(typeof tile.lastOpenedAtEpochMs === "number" || tile.lastOpenedAtEpochMs === null).toBe(true);
    expect(typeof tile.createdAtEpochMs).toBe("number");
  });

  it("can construct no tile state F02 has no producer for (CA-14)", () => {
    // Widening either of these to a state F05–F07 owns is a compile error.
    const constructible: readonly LibraryTileStatusV1[] = ["scratch", "not-stated"];
    expect(constructible).toHaveLength(2);

    type Fictional = Extract<
      LibraryTileStatusV1,
      "conflict" | "listed-only" | "too-large" | "backed-up"
    >;
    const noFictionalStates: Fictional extends never ? true : false = true;
    expect(noFictionalStates).toBe(true);

    type ForbiddenTileKey = Extract<
      keyof LibraryTileVm,
      "conflictCount" | "lastBackupAtEpochMs" | "homeId" | "isTooLarge"
    >;
    const noForbiddenTileKeys: ForbiddenTileKey extends never ? true : false =
      true;
    expect(noForbiddenTileKeys).toBe(true);
  });

  it("says nothing about backups for an app whose home F02 cannot describe", () => {
    const vm = populated(selectLibraryVm([app({ isScratch: false })]));
    expect(vm.tiles[0]?.status).toBe("not-stated");
  });

  it("filters by name and keeps the search term visible", () => {
    const apps = [
      app({ appId: "a", displayName: "Field Log" }),
      app({ appId: "b", displayName: "Studio Stock" }),
    ];
    const vm = populated(selectLibraryVm(apps, "field"));

    expect(vm.screen).toBe("SCR-012");
    expect(vm.searchQuery).toBe("field");
    expect(vm.searchScope).toBe("this-device");
    expect(vm.tiles.map((tile) => tile.appId)).toEqual(["a"]);
    expect(vm.appCount).toBe(2);
    expect(vm.announcement).toBe("1 of 2 apps match “field”.");
  });

  it("keeps a no-result search distinct from an empty library (STA-025)", () => {
    const vm = populated(selectLibraryVm([app()], "payroll 2024"));

    expect(vm.kind).toBe("populated");
    expect(vm.tiles).toEqual([]);
    // The library still has an app; only this search matched nothing.
    expect(vm.appCount).toBe(1);
    expect(vm.announcement).toBe(
      "No app matches “payroll 2024”. 1 app is on this device.",
    );
  });

  it("treats a whitespace query as no query at all", () => {
    const vm = populated(selectLibraryVm([app()], "   "));
    expect(vm.searchQuery).toBeNull();
    expect(vm.screen).toBe("SCR-010");
  });
});
