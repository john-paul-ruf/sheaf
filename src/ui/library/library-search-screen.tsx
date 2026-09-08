import type { ReactNode } from "react";
import type { PopulatedLibraryVm } from "../../application/view-models/library.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { TextField } from "../primitives/text-field.js";
import { UnlockedFrame, type SecurityNavigation } from "../security/frames.js";
import { LibraryActions, LibraryTileList } from "./library-screen.js";
import styles from "./library.module.css";

/**
 * SCR-012 — library search (library-search.html, STA-026, CAP-14).
 *
 * **The term stays visible and stays clearable.** library-search.html states
 * the rule for the no-result case — "The search term remains visible … no
 * zero-count tile is invented" — and STA-026 makes it general, so the field
 * keeps the query and the clear action sits beside the count in both states.
 *
 * **The scope is stated, not implied.** The mock's lede promises search across
 * "metadata supplied by connected durable-home indexes"; F02 has no durable
 * home and therefore no such index (`LibrarySearchScopeV1` has one member), so
 * the sentence is composed from the scope the model actually reports. The
 * mock's **Check durable homes** remedy is absent for the same reason — F05/F06
 * give it somewhere to go.
 */

/** library-search.html's "1 result for “field”", composed from real counts. */
export function describeMatches(shown: number, total: number): string {
  const results = shown === 1 ? "1 result" : `${String(shown)} results`;
  return `${results} of ${String(total)} apps on this device`;
}

export interface LibrarySearchScreenProps {
  readonly vm: PopulatedLibraryVm;
  readonly nav: SecurityNavigation;
  readonly appHref: (appId: string) => string;
  readonly onSearch: (query: string) => void;
  /** Defaults to the library screen's own upload destination. */
  readonly onChooseWorkbook?: () => void;
  readonly topBarActions?: ReactNode;
}

export function LibrarySearchScreen({
  vm,
  nav,
  appHref,
  onSearch,
  onChooseWorkbook,
  topBarActions,
}: LibrarySearchScreenProps): ReactNode {
  const query = vm.searchQuery ?? "";
  const searching = vm.searchQuery !== null;
  const noResult = searching && vm.tiles.length === 0;

  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="library"
      nav={nav}
      title="Search apps"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-012">
        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>All apps · Search</span>
          <h1 className={cx(styles["title"])}>Find an app.</h1>
          <p className={cx(styles["lede"])}>
            Search covers apps on this device.
          </p>
        </div>

        <div className={cx(styles["searchRow"])}>
          <TextField
            autoComplete="off"
            label="Search apps"
            onChange={onSearch}
            value={query}
          />
          <div className={cx(styles["resultLine"])}>
            <span className={cx(styles["resultCount"])}>
              {searching
                ? describeMatches(vm.tiles.length, vm.appCount)
                : `${String(vm.appCount)} apps on this device`}
            </span>
            {searching && (
              <Button
                onPress={() => {
                  onSearch("");
                }}
              >
                Clear search
              </Button>
            )}
          </div>
        </div>

        {noResult ? (
          <section className={cx(styles["noResult"])}>
            <h2 className={cx(styles["cardTitle"])}>
              No app matches “{query}”.
            </h2>
            <p className={cx(styles["lede"])}>
              The search term stays where you typed it. Clear it to see every
              app on this device, or turn another workbook into an app.
            </p>
            <LibraryActions
              actions={vm.actions}
              {...(onChooseWorkbook === undefined ? {} : { onChooseWorkbook })}
            />
          </section>
        ) : (
          <LibraryTileList appHref={appHref} tiles={vm.tiles} />
        )}
      </div>
    </UnlockedFrame>
  );
}
