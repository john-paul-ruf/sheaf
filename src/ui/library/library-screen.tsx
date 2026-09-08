import type { ReactNode } from "react";
import type {
  LibraryActionReason,
  LibraryActionVm,
  LibraryTileVm,
  PopulatedLibraryVm,
} from "../../application/view-models/library.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { UnlockedFrame, type SecurityNavigation } from "../security/frames.js";
import styles from "./library.module.css";

/**
 * SCR-010 — the populated library (library.html, CAP-14, FR-19).
 *
 * **Only the states F02 can produce are drawn.** library.html shows five tile
 * states; `LibraryTileStatusV1` has two, and conflicts, listed-only and
 * too-large are not members of it — so this file cannot render one even by
 * mistake (CA-14). The mock's "1 change is only on this device" freshness
 * banner and its **Back up now** remedy are likewise absent: F02 writes no
 * durable home and counts no device-only changes, and a remedy with nowhere to
 * go is the untruthful half of design.md's facts-then-remedy pattern.
 *
 * **A tile says nothing it was not told.** `not-stated` renders no backup
 * line at all rather than a guessed time, and a `rowCount` of `null` is "not
 * counted yet", never "0 rows".
 *
 * Times are formatted here because a view model holds no clock and no locale
 * (M37 must-not); the instants cross as epoch milliseconds and the `<time>`
 * element carries the machine-readable form beside the human one.
 */

const DISABLED_REASON: Readonly<Record<LibraryActionReason, string>> =
  Object.freeze({
    "durable-homes-not-available-in-this-release":
      "Connecting a durable home is not available in this release.",
  });

/** library.html, verbatim: the scratch tile's badge. */
const SCRATCH_STATUS = "Scratch · not backed up";

/**
 * Where `upload-workbook` goes when no route supplied a destination. The one
 * home for the interim S06 landed: an unknown hash is answered truthfully by
 * CA-07's guard, so the control is live rather than dead.
 */
export const UPLOAD_ROUTE = "#/upload";

export function navigateToUpload(): void {
  window.location.hash = UPLOAD_ROUTE;
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatInstant(epochMs: number): string {
  return dateTime.format(new Date(epochMs));
}

function isoInstant(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** "1 table · 40 rows" — and never "0 rows" for a count that was not cached. */
export function describeContents(tile: LibraryTileVm): string {
  const tables =
    tile.tableCount === 1 ? "1 table" : `${String(tile.tableCount)} tables`;
  const rows =
    tile.rowCount === null
      ? "rows not counted yet"
      : tile.rowCount === 1
        ? "1 row"
        : `${String(tile.rowCount)} rows`;
  return `${tables} · ${rows}`;
}

/** library.html's "Four are on this phone", composed from the real count. */
export function describeAppCount(appCount: number): string {
  return appCount === 1
    ? "1 app is on this device."
    : `${String(appCount)} apps are on this device.`;
}

export interface LibraryActionsProps {
  readonly actions: readonly LibraryActionVm[];
  /** Defaults to {@link navigateToUpload}. */
  readonly onChooseWorkbook?: () => void;
}

/**
 * library.html's "Turn another workbook into an app" card. Shared with
 * SCR-012 so both screens offer the same next action in the same words.
 */
export function LibraryActions({
  actions,
  onChooseWorkbook = navigateToUpload,
}: LibraryActionsProps): ReactNode {
  return (
    <div className={cx(styles["actions"])}>
      {actions.map((action, index) =>
        action.enabled ? (
          <Button
            key={action.id}
            onPress={onChooseWorkbook}
            tone={index === 0 ? "primary" : "secondary"}
          >
            {action.label}
          </Button>
        ) : (
          <Button
            disabledReason={DISABLED_REASON[action.reason]}
            isDisabled
            key={action.id}
            tone={index === 0 ? "primary" : "secondary"}
          >
            {action.label}
          </Button>
        ),
      )}
    </div>
  );
}

export interface LibraryTileListProps {
  readonly tiles: readonly LibraryTileVm[];
  /** Where a tile opens. S07's interim destination lands on the library. */
  readonly appHref: (appId: string) => string;
}

export function LibraryTileList({
  tiles,
  appHref,
}: LibraryTileListProps): ReactNode {
  return (
    <ul className={cx(styles["tiles"])}>
      {tiles.map((tile) => (
        <li
          className={cx(styles["tile"])}
          data-accent={tile.accentId}
          data-tile={tile.appId}
          key={tile.appId}
        >
          <div className={cx(styles["identity"])}>
            <span aria-hidden="true" className={cx(styles["glyph"])}>
              {tile.glyph}
            </span>
            {tile.status === "scratch" && (
              <span className={cx(styles["status"])}>{SCRATCH_STATUS}</span>
            )}
          </div>

          <h3 className={cx(styles["tileName"])}>
            <InlineLink target={{ kind: "internal", href: appHref(tile.appId) }}>
              {tile.displayName}
            </InlineLink>
          </h3>

          <dl className={cx(styles["facts"])}>
            <dt>Contents</dt>
            <dd>{describeContents(tile)}</dd>
            <dt>Created</dt>
            <dd>
              <time dateTime={isoInstant(tile.createdAtEpochMs)}>
                {formatInstant(tile.createdAtEpochMs)}
              </time>
            </dd>
            <dt>Opened</dt>
            <dd>
              {tile.lastOpenedAtEpochMs === null ? (
                "Not opened yet"
              ) : (
                <time dateTime={isoInstant(tile.lastOpenedAtEpochMs)}>
                  {formatInstant(tile.lastOpenedAtEpochMs)}
                </time>
              )}
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

export interface LibraryScreenProps {
  readonly vm: PopulatedLibraryVm;
  readonly nav: SecurityNavigation;
  readonly searchHref: string;
  readonly appHref: (appId: string) => string;
  /** Defaults to {@link navigateToUpload}. */
  readonly onChooseWorkbook?: () => void;
  readonly topBarActions?: ReactNode;
}

export function LibraryScreen({
  vm,
  nav,
  searchHref,
  appHref,
  onChooseWorkbook,
  topBarActions,
}: LibraryScreenProps): ReactNode {
  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="library"
      nav={nav}
      title="All apps"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-010">
        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>Local library</span>
          <h1 className={cx(styles["title"])}>Your apps, close at hand.</h1>
          <p className={cx(styles["lede"])}>{describeAppCount(vm.appCount)}</p>
        </div>

        <section aria-labelledby="library-apps">
          <div className={cx(styles["sectionHead"])}>
            <h2 className={cx(styles["sectionTitle"])} id="library-apps">
              All apps
            </h2>
            <InlineLink target={{ kind: "internal", href: searchHref }}>
              Search apps
            </InlineLink>
          </div>
          <LibraryTileList appHref={appHref} tiles={vm.tiles} />
        </section>

        <section className={cx(styles["card"])}>
          <h2 className={cx(styles["cardTitle"])}>
            Turn another workbook into an app.
          </h2>
          <p className={cx(styles["lede"])}>
            The file is parsed on this device. You review every inference before
            the app exists.
          </p>
          <LibraryActions
            actions={vm.actions}
            {...(onChooseWorkbook === undefined ? {} : { onChooseWorkbook })}
          />
        </section>
      </div>
    </UnlockedFrame>
  );
}
