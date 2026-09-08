/**
 * The F01 no-network fixture (invariant 12 / FR-22, replan finding F-07).
 *
 * **Scope, so F08 does not think this is already done:** this is a *behavioral
 * assertion*, not a policy. It proves that the setup, unlock and lock journeys
 * make no request beyond the origin the built `dist/` is served from. It
 * installs no Content-Security-Policy and no egress allowlist — CSP
 * enforcement and the M64 security-test module remain **F08**, and a future
 * feature that adds egress will not be caught by this file unless it also runs
 * these journeys.
 *
 * The fixture is deny-by-default: every request the page attempts is routed,
 * anything that is not same-origin is aborted and recorded, and websockets are
 * recorded whether or not they connect. It is opt-in — a spec asks for
 * `network` and gets the log; specs that do not ask are unaffected.
 */

import { test as base, type Route } from "@playwright/test";

export { expect } from "@playwright/test";

export interface NetworkWatch {
  /** Requests that left, or tried to leave, the served origin. */
  readonly unexpected: readonly string[];
  /** Every request the page made, in order, same-origin ones included. */
  readonly all: readonly string[];
  /**
   * Starts a new window. Use it around a leg that must be *completely* silent,
   * not merely egress-free — the cold unlock, for instance, reads nothing from
   * the network at all once the page is loaded.
   */
  mark: () => void;
  /** Everything requested since the last {@link NetworkWatch.mark}. */
  since: () => readonly string[];
}

interface NoNetworkFixtures {
  readonly network: NetworkWatch;
}

export const test = base.extend<NoNetworkFixtures>({
  network: async ({ page, baseURL }, use) => {
    const origin = new URL(baseURL ?? "http://127.0.0.1:8080").origin;
    const all: string[] = [];
    const unexpected: string[] = [];
    let marked = 0;

    const isServedOrigin = (url: string): boolean =>
      url === origin || url.startsWith(`${origin}/`);

    page.on("request", (request) => {
      all.push(`${request.method()} ${request.url()}`);
    });
    // A socket that never opens is still an attempt to leave the device.
    page.on("websocket", (socket) => {
      unexpected.push(`WEBSOCKET ${socket.url()}`);
    });

    await page.route("**/*", async (route: Route) => {
      const request = route.request();
      if (isServedOrigin(request.url())) {
        await route.continue();
        return;
      }
      unexpected.push(`${request.method()} ${request.url()}`);
      await route.abort("blockedbyclient");
    });

    await use({
      unexpected,
      all,
      mark: () => {
        marked = all.length;
      },
      since: () => all.slice(marked),
    });

    await page.unrouteAll({ behavior: "ignoreErrors" });
  },
});
