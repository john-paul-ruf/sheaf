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
 * S07's amendment adds three unlocked-only paths — `#/library/search`,
 * `#/upload` and `#/import` — and nothing else. `#/import` is one route whose
 * *stage* is chosen by the import machine rather than by the URL, because the
 * stage is a fact about a run in progress and a stage-named path could be deep
 * linked into a run that is not there.
 *
 * S08's amendment (CA-07 amendment 2) serves the app area, which S07 reserved:
 * `#/app/{appId}`, `#/app/{appId}/t/{tableId}` and its `/new`, `.../r/{recordId}`
 * and its `/edit`, and `#/app/{appId}/history`. They are unlocked-only like
 * every other app path. They are matched by *shape* rather than listed, because
 * an app id is data — {@link isAppAreaPath} is the whole addition to the guard,
 * and `guardRoute` stays a pure function of the phase and the path.
 *
 * **An unknown app id is not an unknown route.** The guard cannot tell one
 * from the other — it reads no catalog, by agreement — so a well-formed path
 * whose app does not exist renders, and the app area answers with the truthful
 * "not on this device" notice rather than a blank screen. Redirecting here
 * would require the guard to know something CA-07 forbids it from knowing.
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
  librarySearch: "/library/search",
  upload: "/upload",
  importFlow: "/import",
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
  ROUTE_PATHS.librarySearch,
  ROUTE_PATHS.upload,
  ROUTE_PATHS.importFlow,
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

/**
 * The app area (CA-07 amendment 2, S08). Every path an app serves is built
 * here, so the URL scheme has exactly one home — a screen states where it
 * goes, this file decides what that spells.
 *
 * The ids are percent-encoded: they are opaque text from the domain, and a
 * path segment is not the place to find out that one of them held a slash.
 */
export function appPath(appId: string): string {
  return `/app/${encodeURIComponent(appId)}`;
}

export function appHistoryPath(appId: string): string {
  return `${appPath(appId)}/history`;
}

export function tablePath(appId: string, tableId: string): string {
  return `${appPath(appId)}/t/${encodeURIComponent(tableId)}`;
}

export function newRecordPath(appId: string, tableId: string): string {
  return `${tablePath(appId, tableId)}/new`;
}

export function recordPath(
  appId: string,
  tableId: string,
  recordId: string,
): string {
  return `${tablePath(appId, tableId)}/r/${encodeURIComponent(recordId)}`;
}

export function editRecordPath(
  appId: string,
  tableId: string,
  recordId: string,
): string {
  return `${recordPath(appId, tableId, recordId)}/edit`;
}

/** A path as an anchor's `href`. The `#` prefix belongs here, not at call sites. */
export function hashHref(path: string): string {
  return `#${path}`;
}

export function appHref(appId: string): string {
  return hashHref(appPath(appId));
}

/**
 * The six app-area shapes, as one expression. An id may be any non-empty run
 * of characters that is not a separator, so a path with an extra segment is
 * *not* an app path and falls to the phase's fallback exactly as before.
 */
const APP_AREA_PATH =
  /^\/app\/[^/]+(?:\/history|\/t\/[^/]+(?:\/new|\/r\/[^/]+(?:\/edit)?)?)?$/u;

export function isAppAreaPath(path: string): boolean {
  return APP_AREA_PATH.test(path);
}

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
  // The app area is unlocked-only, like every other app path (amendment 2).
  if (phase === "unlocked" && isAppAreaPath(path)) {
    return RENDER;
  }
  return redirect(fallbackRoute(phase));
}
