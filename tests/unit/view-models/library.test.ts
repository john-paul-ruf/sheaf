/**
 * D5 / STA-025: the F01 library is empty, says so, and offers only actions it
 * can honestly describe as unavailable.
 */

import { describe, expect, it } from "vitest";
import {
  selectEmptyLibraryVm,
  type EmptyLibraryVm,
} from "../../../src/application/view-models/library.js";

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
      "apps" | "appCount" | "lastOpenedAt" | "rows" | "placeholders"
    >;
    const noForbiddenKeys: ForbiddenKey extends never ? true : false = true;
    expect(noForbiddenKeys).toBe(true);
  });

  it("ships both actions disabled with a reason token (D5)", () => {
    const vm = selectEmptyLibraryVm();

    expect(vm.actions).toEqual([
      {
        id: "choose-workbook",
        label: "Choose a workbook",
        enabled: false,
        reason: "import-not-available-in-this-release",
      },
      {
        id: "connect-durable-home",
        label: "Connect a durable home",
        enabled: false,
        reason: "durable-homes-not-available-in-this-release",
      },
    ]);
    for (const action of vm.actions) {
      expect(action.enabled).toBe(false);
      expect(action.reason.length).toBeGreaterThan(0);
    }
  });

  it("announces the empty state in the mock's words", () => {
    expect(selectEmptyLibraryVm().announcement).toBe(
      "Your apps will live here.",
    );
  });
});
