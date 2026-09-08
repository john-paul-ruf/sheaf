/**
 * The library surface (M37; SCR-010/011/012; CAP-14; FR-19).
 *
 * Sources: `mocks/library.html`, `mocks/library-empty.html`,
 * `mocks/library-search.html`. Strings quoted from a mock carry that source in
 * a comment; the rest are tokens S07 maps to its own approved copy.
 *
 * Three truths the *types* hold, not review:
 *
 * 1. **No fictional tile state is constructible.** library.html shows five tile
 *    states; F02 can truthfully produce exactly one of them. Conflicts (F06),
 *    listed-only (F06 adoption) and too-large (F07 capacity) are absent from
 *    {@link LibraryTileStatusV1} entirely, so a surface cannot render one from
 *    a value that does not exist (CA-14).
 * 2. **An empty library and an empty search result are different types.**
 *    records-empty.html states the rule for records and it is the same rule
 *    here: "no apps yet" and "no app matches this search" are different facts
 *    with different next actions, so they are never the same variant.
 * 3. **No time is formatted here.** View models hold no clock (M36/M37
 *    must-not), so instants cross as epoch milliseconds and the surface renders
 *    them. A count that was never cached crosses as `null`, never as `0`.
 */

import type { LibraryAppV1 } from "../../workers/protocol/messages.js";

export type LibraryActionId = "choose-workbook" | "connect-durable-home";

/** Why an action is off. Not copy — the key S07 maps to its mock's wording. */
export type LibraryActionReason =
  /** Providers and adoption are F05/F06; there is no home to connect to. */
  "durable-homes-not-available-in-this-release";

/** Where an enabled action goes. S07 owns the route; this names the intent. */
export type LibraryActionIntent = "upload-workbook";

/**
 * D5's successor: import landed in F02, so `choose-workbook` is enabled and
 * carries a route intent. `connect-durable-home` keeps its F01 reason token —
 * an enabled control that cannot complete is the untruthful option, and
 * `Button` requires a text equivalent for every disabled state (CTL-014).
 */
export type LibraryActionVm =
  | {
      readonly id: LibraryActionId;
      readonly label: string;
      readonly enabled: true;
      readonly intent: LibraryActionIntent;
    }
  | {
      readonly id: LibraryActionId;
      readonly label: string;
      readonly enabled: false;
      readonly reason: LibraryActionReason;
    };

/**
 * What a tile may say about durability.
 *
 * `scratch` is the state F02 produces: promotion writes no durable home, so
 * every app it creates has none, and library.html's "Scratch · not backed up"
 * is the truthful line. `not-stated` exists for the app that has a home but
 * whose last confirmed backup F02 has no producer for — such a tile says
 * nothing about backups rather than guessing a time. Neither is a state
 * F05–F07 will need to widen: those add *members*, they do not reinterpret
 * these two.
 */
export type LibraryTileStatusV1 = "scratch" | "not-stated";

export interface LibraryTileVm {
  readonly appId: string;
  readonly displayName: string;
  /** The app's own identity (D29): an M40 palette token and one glyph. */
  readonly accentId: string;
  readonly glyph: string;
  readonly status: LibraryTileStatusV1;
  /** The catalog's cache. `null` is "not counted", never "no rows". */
  readonly rowCount: number | null;
  readonly tableCount: number;
  readonly createdAtEpochMs: number;
  /** `null` until the app has been opened once. Formatted by the surface. */
  readonly lastOpenedAtEpochMs: number | null;
}

/** Search reaches this device only; no durable-home index exists yet (F06). */
export type LibrarySearchScopeV1 = "this-device";

export interface EmptyLibraryVm {
  readonly screen: "SCR-011";
  readonly kind: "empty";
  readonly actions: readonly LibraryActionVm[];
  readonly announcement: string;
}

export interface PopulatedLibraryVm {
  readonly screen: "SCR-010" | "SCR-012";
  readonly kind: "populated";
  readonly tiles: readonly LibraryTileVm[];
  /** `null` browses the library; text filters it, and stays visible either way. */
  readonly searchQuery: string | null;
  readonly searchScope: LibrarySearchScopeV1;
  /** Apps on this device, regardless of the search — the "12,482 records" fact. */
  readonly appCount: number;
  readonly actions: readonly LibraryActionVm[];
  readonly announcement: string;
}

export type LibraryVm = EmptyLibraryVm | PopulatedLibraryVm;

/** library-empty.html / library.html, verbatim. */
const CHOOSE_WORKBOOK_LABEL = "Choose a workbook";
const CONNECT_HOME_LABEL = "Connect a durable home";

const ACTIONS: readonly LibraryActionVm[] = Object.freeze([
  Object.freeze({
    id: "choose-workbook" as const,
    label: CHOOSE_WORKBOOK_LABEL,
    enabled: true as const,
    intent: "upload-workbook" as const,
  }),
  Object.freeze({
    id: "connect-durable-home" as const,
    label: CONNECT_HOME_LABEL,
    enabled: false as const,
    reason: "durable-homes-not-available-in-this-release" as const,
  }),
]);

/** library-empty.html, verbatim. */
const EMPTY_ANNOUNCEMENT = "Your apps will live here.";

export function selectEmptyLibraryVm(): EmptyLibraryVm {
  return {
    screen: "SCR-011",
    kind: "empty",
    actions: ACTIONS,
    announcement: EMPTY_ANNOUNCEMENT,
  };
}

function toTile(app: LibraryAppV1): LibraryTileVm {
  return {
    appId: app.appId,
    displayName: app.displayName,
    accentId: app.accentId,
    glyph: app.glyph,
    status: app.isScratch ? "scratch" : "not-stated",
    rowCount: app.rowCountCache,
    tableCount: app.tableCount,
    createdAtEpochMs: app.createdAtEpochMs,
    lastOpenedAtEpochMs: app.lastOpenedAtEpochMs,
  };
}

/**
 * Case-insensitive containment over the display name. The library is the set
 * of apps on this device, so the filter runs here rather than as a query; the
 * scope is stated in the model so no surface can imply it searched further.
 */
function matchesQuery(app: LibraryAppV1, query: string): boolean {
  return app.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

export function selectLibraryVm(
  apps: readonly LibraryAppV1[],
  searchQuery: string | null = null,
): LibraryVm {
  const query = searchQuery?.trim() ?? "";
  // An empty library is empty whatever was typed: there is nothing to search.
  if (apps.length === 0) {
    return selectEmptyLibraryVm();
  }

  const searching = query.length > 0;
  const matched = searching ? apps.filter((app) => matchesQuery(app, query)) : apps;

  return {
    screen: searching ? "SCR-012" : "SCR-010",
    kind: "populated",
    tiles: matched.map(toTile),
    searchQuery: searching ? query : null,
    searchScope: "this-device",
    appCount: apps.length,
    actions: ACTIONS,
    announcement: announceLibrary(matched.length, apps.length, searching ? query : null),
  };
}

/**
 * Composed from facts in the Content Patterns style. library-search.html's
 * no-result line — "No app matches “payroll 2024.”" — keeps the term visible,
 * which is why the query is repeated rather than replaced with "your search".
 */
function announceLibrary(
  shown: number,
  total: number,
  query: string | null,
): string {
  const onThisDevice =
    total === 1
      ? "1 app is on this device."
      : `${String(total)} apps are on this device.`;
  if (query === null) {
    return onThisDevice;
  }
  if (shown === 0) {
    return `No app matches “${query}”. ${onThisDevice}`;
  }
  return `${String(shown)} of ${String(total)} apps match “${query}”.`;
}
