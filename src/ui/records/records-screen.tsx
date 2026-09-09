import type { ReactNode } from "react";
import type {
  RecordCardVm,
  RecordFactVm,
  RecordsListVm,
} from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { TextField } from "../primitives/text-field.js";
import {
  AppFrame,
  type AppIdentity,
  type AppNavigation,
} from "./app-frame.js";
import {
  describeRecordCount,
  describeValue,
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
 * **A count is the table's count, always.** `tableRecordCount` is how many
 * live records the *table* holds; the projection answers no "how many matched"
 * question, and `RecordsListVm` has no field for one — so a search page says
 * what it searched and what the table holds, and never invents a match count
 * (CA-14).
 *
 * **Empty and no-result stay two different screens.** records-empty.html is
 * explicit: clearing the search fixes one of them and does nothing for the
 * other, so they cannot share a sentence or an action.
 *
 * **One list, densified.** records.html draws phone cards and a desktop table
 * as separate blocks; the accessibility contract forbids the desktop table
 * creating a second keyboard order, so the same list is laid out as cards up
 * to the desktop class and as dense rows above it (records.module.css).
 *
 * The mock's filter chips and sort control are absent: typed filters and sort
 * are FR-13's, and F04 builds them (M44 fragment).
 */

export interface RecordsScreenProps {
  readonly vm: RecordsListVm;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  readonly recordHref: (recordId: string) => string;
  readonly newRecordHref: string;
  readonly onSearch: (text: string) => void;
  /** Present only while `vm.hasMore`; appends the next page. */
  readonly onShowMore?: () => void;
  /** Field types, so an amount renders as its currency (M37 holds no locale). */
  readonly fieldTypes?: ReadonlyMap<string, FieldTypeVm>;
  readonly busy?: boolean;
  readonly topBarActions?: ReactNode;
}

export function RecordsScreen({
  vm,
  app,
  nav,
  recordHref,
  newRecordHref,
  onSearch,
  onShowMore,
  fieldTypes,
  busy = false,
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
          <span className={cx(styles["eyebrow"])}>Working list</span>
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
          <p className={cx(styles["scopeLine"])}>
            <span>
              {`This table holds ${describeRecordCount(vm.tableRecordCount)}.`}
            </span>
            {vm.scope.kind === "search" && (
              <span>{`Showing what matches “${vm.scope.text}” on this device.`}</span>
            )}
          </p>
        </div>

        <div className={cx(styles["actions"])}>
          <InlineLink target={{ kind: "internal", href: newRecordHref }}>
            Add a record
          </InlineLink>
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
          />
        )}
      </div>
    </AppFrame>
  );
}

/**
 * SCR-026's two states. The one a search caused keeps the term and offers to
 * clear it; the one an empty table caused offers the first record instead,
 * because clearing a search it never had would change nothing.
 */
function EmptyRecords({
  vm,
  newRecordHref,
  onSearch,
}: {
  readonly vm: RecordsListVm;
  readonly newRecordHref: string;
  readonly onSearch: (text: string) => void;
}): ReactNode {
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
