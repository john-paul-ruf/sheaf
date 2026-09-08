/**
 * CAP-08 — a missing required capability stops Sheaf before it starts.
 *
 * Named proof for CAP-08 (replan finding F-06). Each case removes exactly one
 * capability from S05's reconciled probe list (D14/AD-9) *before the document
 * loads*, then asserts four things about SCR-001:
 *
 * 1. it renders CTL-087's recoverable error state (`role="alert"`);
 * 2. the message **names the capability that is missing** — "this browser is
 *    not supported" with no name is not a fact anyone can act on;
 * 3. **no worker was started**, because `startApp()` probes before it composes
 *    and a worker that cannot reach IndexedDB would fail later and less
 *    clearly;
 * 4. **no setup control is reachable**, including by deep link.
 *
 * The ids below are the ones `src/platform/capabilities.ts` actually publishes;
 * `CAPABILITY_IDS` is imported so a renamed probe fails this file rather than
 * silently testing a string nobody produces.
 */

import { expect, test } from "@playwright/test";
import { CAPABILITY_IDS } from "../../src/platform/capabilities.js";
import { currentScreen, openApp, screen } from "./fixtures/app.js";

interface StubbedCapability {
  /** The id `probeCapabilities()` reports, and the name the error must show. */
  readonly id: string;
  /** Runs before any page script, so the probe sees the browser without it. */
  readonly remove: () => void;
}

const STUBBED: readonly StubbedCapability[] = [
  {
    id: "indexeddb",
    // An own property shadows the prototype accessor; `delete` alone would not.
    remove: () => {
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        value: undefined,
      });
    },
  },
  {
    id: "service-worker",
    // The probe asks `"serviceWorker" in navigator`, so the attribute has to
    // leave the prototype entirely rather than merely read as undefined.
    remove: () => {
      delete (Navigator.prototype as unknown as Record<string, unknown>)[
        "serviceWorker"
      ];
    },
  },
];

test("every stubbed id is one this build actually probes", () => {
  for (const capability of STUBBED) {
    expect(CAPABILITY_IDS).toContain(capability.id);
  }
});

for (const capability of STUBBED) {
  test(`refuses to start without ${capability.id}, and names it`, async ({
    page,
  }) => {
    const workers: string[] = [];
    page.on("worker", (worker) => {
      workers.push(worker.url());
    });

    await page.addInitScript(capability.remove);
    await openApp(page);

    // 1 + 2: CTL-087's recoverable state, naming what is absent.
    const error = page.getByRole("alert");
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("data-variant", "recoverable");
    await expect(error).toContainText(capability.id);
    expect(await currentScreen(page)).toBe("SCR-001");

    // 3: the probe ran before composition, so nothing was spawned.
    expect(workers).toEqual([]);
    expect(page.workers()).toEqual([]);

    // 4: no way forward — not by control, and not by deep link.
    await expect(
      page.getByRole("button", { name: "Protect this device" }),
    ).toHaveCount(0);

    await openApp(page, "#/setup");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Protect this device" }),
    ).toHaveCount(0);
  });
}

test("control case: an unstubbed browser renders the ordinary welcome", async ({
  page,
}) => {
  await openApp(page);

  expect(await currentScreen(page)).toBe("SCR-001");
  await expect(screen(page, "SCR-001")).toBeVisible();
  await expect(page.locator('[data-variant="unsupported"]')).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Protect this device" }),
  ).toBeVisible();
});
