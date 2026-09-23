import type { ReactNode } from "react";
import {
  describeActiveFilters,
  type FilterChipVm,
  type RecordCardVm,
  type RecordFactVm,
  type RecordsListVm,
  type TableSwitcherVm,
} from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { TextField } from "../primitives/text-field.js";
import { ActiveChip, FilterChips } from "./filter-chips.js";
import {
  AppFrame,
  type AppIdentity,
  type AppNavigation,
} from "./app-frame.js";
import { TableSwitcherTrigger } from "./table-switcher-sheet.js";
import {
  describeRecordCount,
  describeSort,
  describeValue,
  formatCount,
  type FieldTypeVm,
} from "./values.js";
import styles from "./records.module.css";

/**
 * SCR-025 and SCR-026 — the records list (records.html, records-empty.html;
 * CAP-15, FR-11/FR-13 search leg).
 *
 * **The search stays visible while records scroll** (design.md § Records and
 * data entry): the tools are sticky under the shell's top bar, and the term
 * stays in the field in every state, including the one where it matched
 * nothing.
 *
 * **The table's count, and a match count only when one was counted.**
 * `tableRecordCount` is how many live records the *table* holds. A filtered
 * or sorted page also says how many matched — `matchCount`, exact — and a
 * plain search or a partial page says none, because nothing counted it
 * (CA-14, CA-29).
 *
 * **Filters and sort ride with the search** (records.html; SHT-004–009): a
 * sideways chip row inside the sticky tools, each applied filter readable and
 * clearable on its own, and "Clear all filters" beside the count (STA-026).
 * A page the query budget cut short says exactly how much it searched and
 * how to widen it (STA-014, D53, D62).
 *
 * **Empty and no-result stay two different screens.** records-empty.html is
 * explicit: clearing the search or the filters fixes one of them and does
 * nothing for the other, so they cannot share a sentence or an action.
 *
 * **One list, densified.** records.html draws phone cards and a desktop table
 * as separate blocks; the accessibility contract forbids the desktop table
 * creating a second keyboard order, so the same list is laid out as cards up
 * to the desktop class and as dense rows above it (records.module.css).
 *
 * **Other tables are one control away** (CTL-059 → SHT-003): the trigger
 * names the current table and its exact count; the sheet lists every table.
 * A reference column reads as the related record's label, or as a missing
 * related record with its original key — never a raw id, never blank.
 */

export interface RecordsScreenProps {
  readonly vm: RecordsListVm;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  readonly recordHref: (recordId: string) => string;
  readonly newRecordHref: string;
  readonly onSearch: (text: string) => void;
  /** SHT-009. */
  readonly onOpenSort?: () => void;
  /** SHT-004–008 for one column. */
  readonly onOpenFilter?: (fieldId: string) => void;
  readonly onClearFilter?: (chip: FilterChipVm) => void;
  readonly onClearAllFilters?: () => void;
  /** The worker refused a filter or the sort: M37's sentence for why. */
  readonly refusal?: string;
  /** Present only while `vm.hasMore`; appends the next page. */
  readonly onShowMore?: () => void;
  /** Field types, so an amount renders as its currency (M37 holds no locale). */
  readonly fieldTypes?: ReadonlyMap<string, FieldTypeVm>;
  readonly busy?: boolean;
  /** CTL-059's state; present when the app has more than one table. */
  readonly tableSwitcher?: TableSwitcherVm;
  readonly onOpenTableSwitcher?: () => void;
  /** SHT-003 and anything else the route composed. */
  readonly overlays?: ReactNode;
  readonly topBarActions?: ReactNode;
}

export function RecordsScreen({
  vm,
  app,
  nav,
  recordHref,
  newRecordHref,
  onSearch,
  onOpenSort,
  onOpenFilter,
  onClearFilter,
  onClearAllFilters,
  refusal,
  onShowMore,
  fieldTypes,
  busy = false,
  tableSwitcher,
  onOpenTableSwitcher,
  overlays,
  topBarActions,
}: RecordsScreenProps): ReactNode {
  const searchText = vm.scope.kind === "search" ? vm.scope.text : "";

  return (
    <AppFrame
      announcement={vm.announcement}
      app={app}
      area="records"
      currentTableId={vm.tableId}
      nav={nav}
      title={vm.tableName}
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen={vm.screen}>
        <div className={cx(styles["intro"])}>
          {/* A chart mark's filter names its chart here and in the announcement (design.md § Accessibility Contract). */}
          <span className={cx(styles["eyebrow"])} data-chart-origin={vm.chartOrigin ?? undefined}>
            {vm.chartOrigin === null ? "Working list" : `Selected mark · ${vm.chartOrigin}`}
          </span>
          <h1 className={cx(styles["title"])}>{vm.tableName}</h1>
        </div>

        <div className={cx(styles["tools"])} role="search">
          <div className={cx(styles["toolsRow"])}>
            <TextField
              autoComplete="off"
              className={cx(styles["searchField"])}
              label={`Search ${vm.tableName}`}
              onChange={onSearch}
              value={searchText}
            />
            {searchText !== "" && (
              <Button
                onPress={() => {
                  onSearch("");
                }}
              >
                Clear search
              </Button>
            )}
          </div>
          {onOpenSort !== undefined && onOpenFilter !== undefined && onClearFilter !== undefined && (
            <FilterChips
              onClearFilter={onClearFilter}
              onOpenFilter={onOpenFilter}
              onOpenSort={onOpenSort}
              vm={vm}
              {...(fieldTypes === undefined ? {} : { fieldTypes })}
            />
          )}
          <p className={cx(styles["scopeLine"])}>
            <span>
              {`This table holds ${describeRecordCount(vm.tableRecordCount)}.`}
            </span>
            {vm.scope.kind === "search" && (
              <span>{`Showing what matches “${vm.scope.text}” on this device.`}</span>
            )}
            {vm.matchCount !== null && (vm.filters.length > 0 || vm.sort !== null) && (
              <span data-match-count={vm.matchCount}>
                {`${vm.matchCount === 1 ? "1 record matches" : `${formatCount(vm.matchCount)} records match`}${
                  vm.sort === null ? "" : ` · ${describeSort(vm.sort).toLowerCase()}`
                }.`}
              </span>
            )}
            {vm.filters.length > 0 && onClearAllFilters !== undefined && (
              <Button onPress={onClearAllFilters}>Clear all filters</Button>
            )}
          </p>
        </div>

        {refusal !== undefined && (
          <StatusBanner title="This filter was not applied" tone="danger">
            {refusal}
          </StatusBanner>
        )}

        {vm.partial !== null && (
          <div data-state="STA-014">
            <StatusBanner
              title={`Searched the first ${formatCount(vm.partial.scanned)} of ${formatCount(vm.partial.tableTotal)} rows`}
              tone="warning"
            >
              These are the matches among them. Narrow the search or add a
              filter to search every row on this device.
            </StatusBanner>
          </div>
        )}

        <div className={cx(styles["actions"])}>
          <InlineLink target={{ kind: "internal", href: newRecordHref }}>
            Add a record
          </InlineLink>
          {tableSwitcher !== undefined && onOpenTableSwitcher !== undefined && (
            <TableSwitcherTrigger onOpen={onOpenTableSwitcher} vm={tableSwitcher} />
          )}
        </div>

        {vm.emptiness === null ? (
          <>
            <ul className={cx(styles["recordList"])}>
              {vm.cards.map((card) => (
                <RecordCard
                  card={card}
                  href={recordHref(card.recordId)}
                  key={card.recordId}
                  {...(fieldTypes === undefined ? {} : { fieldTypes })}
                />
              ))}
            </ul>
            {vm.hasMore && onShowMore !== undefined && (
              <div className={cx(styles["actions"])}>
                <Button
                  onPress={onShowMore}
                  {...(busy
                    ? {
                        isDisabled: true as const,
                        disabledReason: "The next records are being read.",
                      }
                    : {})}
                >
                  Show more records
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyRecords
            newRecordHref={newRecordHref}
            onSearch={onSearch}
            vm={vm}
            {...(fieldTypes === undefined ? {} : { fieldTypes })}
            {...(onClearFilter === undefined ? {} : { onClearFilter })}
            {...(onClearAllFilters === undefined ? {} : { onClearAllFilters })}
          />
        )}
      </div>
      {overlays}
    </AppFrame>
  );
}

/**
 * SCR-026's two states. The one a query caused keeps its term and its filters,
 * each clearable (STA-026); the one an empty table caused offers the first
 * record instead, because clearing a search it never had would change
 * nothing.
 */
function EmptyRecords({
  vm,
  newRecordHref,
  onSearch,
  fieldTypes,
  onClearFilter,
  onClearAllFilters,
}: {
  readonly vm: RecordsListVm;
  readonly newRecordHref: string;
  readonly onSearch: (text: string) => void;
  readonly fieldTypes?: ReadonlyMap<string, FieldTypeVm>;
  readonly onClearFilter?: (chip: FilterChipVm) => void;
  readonly onClearAllFilters?: () => void;
}): ReactNode {
  if (vm.emptiness === "no-results" && vm.filters.length > 0) {
    const text = vm.scope.kind === "search" ? vm.scope.text : null;
    return (
      <section className={cx(styles["emptyState"])} data-empty="no-results" data-state="STA-026">
        <h2 className={cx(styles["cardTitle"])}>
          {text === null ? "No record matches these filters." : `No record matches “${text}” with these filters.`}
        </h2>
        {onClearFilter !== undefined && (
          <ul aria-label="Active filters" className={cx(styles["chipRow"], styles["chipWrap"])}>
            {vm.filters.map((chip, index) => (
              <li key={`${chip.fieldId}-${String(index)}`}>
                <ActiveChip chip={chip} onClear={onClearFilter} type={fieldTypes?.get(chip.fieldId)} />
              </li>
            ))}
          </ul>
        )}
        <p className={cx(styles["lede"])}>
          {`The table contains ${describeRecordCount(vm.tableRecordCount)}. ${describeActiveFilters(
            vm.filters.length,
          )} all of them.`}
        </p>
        <div className={cx(styles["actions"])}>
          {onClearAllFilters !== undefined && (
            <Button onPress={onClearAllFilters} tone="primary">
              Clear all filters
            </Button>
          )}
          {text !== null && (
            <Button
              onPress={() => {
                onSearch("");
              }}
            >
              Clear search
            </Button>
          )}
        </div>
      </section>
    );
  }

  if (vm.emptiness === "no-results") {
    const text = vm.scope.kind === "search" ? vm.scope.text : "";
    return (
      <section className={cx(styles["emptyState"])} data-empty="no-results">
        <h2 className={cx(styles["cardTitle"])}>
          No record matches “{text}”.
        </h2>
        <p className={cx(styles["lede"])}>
          {`The search term stays where you typed it. ${vm.tableName} holds ${describeRecordCount(
            vm.tableRecordCount,
          )}; clearing the search shows them again.`}
        </p>
        <Button
          onPress={() => {
            onSearch("");
          }}
          tone="primary"
        >
          Clear search
        </Button>
      </section>
    );
  }

  return (
    <section className={cx(styles["emptyState"])} data-empty="empty-table">
      <h2 className={cx(styles["cardTitle"])}>No records yet.</h2>
      <p className={cx(styles["lede"])}>
        {`${vm.tableName} contains zero records. Add the first one; there is no search or filter to clear.`}
      </p>
      <InlineLink target={{ kind: "internal", href: newRecordHref }}>
        Add the first record
      </InlineLink>
    </section>
  );
}

/**
 * records.html's phone card: the human label first, then at most three
 * supporting facts. The view model already chose which three; this renders
 * what it chose and nothing else.
 */
function RecordCard({
  card,
  href,
  fieldTypes,
}: {
  readonly card: RecordCardVm;
  readonly href: string;
  readonly fieldTypes?: ReadonlyMap<string, FieldTypeVm>;
}): ReactNode {
  return (
    <li className={cx(styles["recordCard"])} data-record={card.recordId}>
      <h2 className={cx(styles["recordLabel"])}>
        <InlineLink target={{ kind: "internal", href }}>
          {card.label === null
            ? "A record with no value to lead with"
            : renderFact(card.label, fieldTypes)}
        </InlineLink>
      </h2>

      <dl className={cx(styles["supporting"])}>
        {card.facts.map((fact) => (
          <div key={fact.fieldId}>
            <dt>{fact.displayName}</dt>
            <dd>{renderFact(fact, fieldTypes)}</dd>
          </div>
        ))}
      </dl>

      {(card.blockingIssueCount > 0 || card.warningIssueCount > 0) && (
        <div className={cx(styles["flags"])}>
          {card.blockingIssueCount > 0 && (
            <span className={cx(styles["flag"])} data-severity="blocking">
              {card.blockingIssueCount === 1
                ? "1 value must be corrected"
                : `${String(card.blockingIssueCount)} values must be corrected`}
            </span>
          )}
          {card.warningIssueCount > 0 && (
            <span className={cx(styles["flag"])} data-severity="warning">
              {card.warningIssueCount === 1
                ? "1 value needs attention"
                : `${String(card.warningIssueCount)} values need attention`}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function renderFact(
  fact: RecordFactVm,
  fieldTypes: ReadonlyMap<string, FieldTypeVm> | undefined,
): string {
  return describeValue(fact.value, fieldTypes?.get(fact.fieldId));
}
