/**
 * The F01 hash-route table and its lock-state guards (M54, CA-07).
 *
 * The guard is a pure function of two facts and nothing else: which phase the
 * *bootstrap and session* are in, and which path was asked for. It never reads
 * a provider, a storage estimate, or a capability — CA-07 is explicit that a
 * guard may only know whether a bootstrap row exists and whether this session
 * is open.
 *
 * The matrix, verbatim from the agreement:
 *
 * - **first-run** (no bootstrap row): only `#/welcome` and `#/setup` render;
 *   everything else, including a deep link to `#/unlock`, lands on `#/welcome`
 *   — there is nothing to unlock yet.
 * - **locked**: only `#/welcome`, `#/setup`, `#/unlock`, `#/recover` and
 *   `#/reset` render. Every unlocked route, and every unknown path, lands on
 *   `#/unlock`.
 * - **unlocked**: the five locked routes redirect to `#/library`, as does any
 *   unknown path.
 *
 * `tests/e2e/route-guards.spec.ts` drives this matrix through the real entry,
 * deep links included.
 */

/** Every path this build serves. The keys are the vocabulary screens use. */
export const ROUTE_PATHS = {
  welcome: "/welcome",
  setup: "/setup",
  unlock: "/unlock",
  recover: "/recover",
  resetLocked: "/reset",
  library: "/library",
  securitySettings: "/settings/security",
  passphraseChange: "/settings/security/passphrase",
  recoveryCodes: "/settings/security/recovery-codes",
  resetReadable: "/settings/security/reset",
} as const;

export type RouteName = keyof typeof ROUTE_PATHS;
export type RoutePath = (typeof ROUTE_PATHS)[RouteName];

/**
 * The same table as anchors. Screens link with plain `href`s (CTL-020 is a
 * React Aria `Link`, and the shells' destinations are anchors), so the `#`
 * prefix belongs here rather than in ten call sites.
 */
export const ROUTE_HREFS = Object.freeze(
  Object.fromEntries(
    Object.entries(ROUTE_PATHS).map(([name, path]) => [name, `#${path}`]),
  ) as Readonly<Record<RouteName, string>>,
);

/**
 * What the guard is allowed to know. `first-run` is *not* a flavour of locked:
 * FR-22's cold-unlock screen would be a lie before a bootstrap row exists.
 */
export type SessionPhase = "first-run" | "locked" | "unlocked";

/** Reachable while the local store is locked (CA-07). */
export const LOCKED_ROUTES: readonly RoutePath[] = Object.freeze([
  ROUTE_PATHS.welcome,
  ROUTE_PATHS.setup,
  ROUTE_PATHS.unlock,
  ROUTE_PATHS.recover,
  ROUTE_PATHS.resetLocked,
]);

/** Reachable only once this session is open. */
export const UNLOCKED_ROUTES: readonly RoutePath[] = Object.freeze([
  ROUTE_PATHS.library,
  ROUTE_PATHS.securitySettings,
  ROUTE_PATHS.passphraseChange,
  ROUTE_PATHS.recoveryCodes,
  ROUTE_PATHS.resetReadable,
]);

/** Reachable before this device has ever been protected. */
export const FIRST_RUN_ROUTES: readonly RoutePath[] = Object.freeze([
  ROUTE_PATHS.welcome,
  ROUTE_PATHS.setup,
]);

export type RouteGuardResult =
  | { readonly kind: "render" }
  | { readonly kind: "redirect"; readonly to: RoutePath };

const RENDER: RouteGuardResult = Object.freeze({ kind: "render" });

function redirect(to: RoutePath): RouteGuardResult {
  return { kind: "redirect", to };
}

/** Where a phase sends everything it does not serve. */
export function fallbackRoute(phase: SessionPhase): RoutePath {
  switch (phase) {
    case "first-run":
      return ROUTE_PATHS.welcome;
    case "locked":
      return ROUTE_PATHS.unlock;
    case "unlocked":
      return ROUTE_PATHS.library;
  }
}

function allowedRoutes(phase: SessionPhase): readonly RoutePath[] {
  switch (phase) {
    case "first-run":
      return FIRST_RUN_ROUTES;
    case "locked":
      return LOCKED_ROUTES;
    case "unlocked":
      return UNLOCKED_ROUTES;
  }
}

/**
 * Trailing slashes and an empty path both mean "wherever this phase starts".
 * The hash router hands us `/` on a bare `index.html` load.
 */
function canonicalize(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/u, "");
  return trimmed === "" ? "/" : trimmed;
}

export function guardRoute(
  phase: SessionPhase,
  pathname: string,
): RouteGuardResult {
  const path = canonicalize(pathname);
  const allowed = allowedRoutes(phase);
  if ((allowed as readonly string[]).includes(path)) {
    return RENDER;
  }
  return redirect(fallbackRoute(phase));
}
