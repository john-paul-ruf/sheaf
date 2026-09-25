import type { ReactNode } from "react";
import {
  describeEvent,
  type ChangeHistoryEntryVm,
  type ChangeHistoryVm,
} from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { StatusBanner } from "../primitives/status-banner.js";
import {
  AppFrame,
  type AppIdentity,
  type AppNavigation,
} from "./app-frame.js";
import { formatInstant, isoInstant } from "./values.js";
import styles from "./records.module.css";

/**
 * SCR-032 — the change log (change-history.html; CAP-17, D22, FR-12).
 *
 * Original authored history survives physical checkpoints. Initial imported
 * rows are the starting state, so a freshly imported app's log is empty.
 *
 * **Each entry names its table** (CA-21's `tableId`): in a workbook app a
 * record id alone does not say where the record lives, so the line says it
 * and the record's link goes to the right table.
 *
 * **A delete stays here, and can be undone from here.** That is what makes
 * MOD-009's "recoverable" true (D22): every entry that still carries its
 * payload offers MOD-010.
 *
 * The mock's event-type filter, its selected-event pane and its merge rows are
 * absent: `ChangeHistoryEntryViewV1` carries no before/after values (a log
 * listing keeps values out), and merges are F06's. Nothing here is a filter
 * over data that does not exist.
 */

export { describeEvent };

export interface ChangeHistoryScreenProps {
  readonly vm: ChangeHistoryVm;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  /** Field ids to their names, so a log line can say which fields moved. */
  readonly fieldNames: ReadonlyMap<string, string>;
  /** Where a record lives, when the entry's table makes that knowable. */
  readonly recordHref?: (recordId: string, tableId: string | null) => string | null;
  readonly onRestore: (entry: ChangeHistoryEntryVm) => void;
  /** Present only while `vm.hasMore`. */
  readonly onShowMore?: () => void;
  readonly busy?: boolean;
  /** A confirmed write's acknowledgement (invariant 1). */
  readonly notice?: string;
  /** MOD-010 and anything else the route composed. */
  readonly overlays?: ReactNode;
  readonly topBarActions?: ReactNode;
}

export function ChangeHistoryScreen({
  vm,
  app,
  nav,
  fieldNames,
  recordHref,
  onRestore,
  onShowMore,
  busy = false,
  notice,
  overlays,
  topBarActions,
}: ChangeHistoryScreenProps): ReactNode {
  return (
    <AppFrame
      announcement={notice ?? vm.announcement}
      app={app}
      area="history"
      nav={nav}
      title="Change history"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-032">
        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>Append-only local history</span>
          <h1 className={cx(styles["title"])}>Change history</h1>
          <p className={cx(styles["lede"])}>
            Changes retained with this app, including earlier edits and
            deleted-record recovery. Imported rows are the starting state,
            not individual changes.
          </p>
        </div>

        {/* The sentence is the whole banner: it is M37's own words for the
            outcome the worker confirmed, and a title above it could only
            repeat them. */}
        {notice !== undefined && (
          <StatusBanner title={notice} tone="success" />
        )}

        {vm.emptiness === null ? (
          <>
            <ul className={cx(styles["entryList"])}>
              {vm.entries.map((entry) => (
                <HistoryEntry
                  busy={busy}
                  entry={entry}
                  fieldNames={fieldNames}
                  key={entry.eventId}
                  onRestore={() => {
                    onRestore(entry);
                  }}
                  {...(recordHref === undefined ? {} : { recordHref })}
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
                        disabledReason: "The next changes are being read.",
                      }
                    : {})}
                >
                  Show older changes
                </Button>
              </div>
            )}
          </>
        ) : (
          <section className={cx(styles["emptyState"])} data-empty="no-changes">
            <h2 className={cx(styles["cardTitle"])}>
              No retained changes yet.
            </h2>
            <p className={cx(styles["lede"])}>
              The rows this app was imported with are not changes; they are what
              it started from. Retained creates, edits, deletes and restores
              appear here.
            </p>
          </section>
        )}
      </div>
      {overlays}
    </AppFrame>
  );
}

function HistoryEntry({
  entry,
  fieldNames,
  recordHref,
  onRestore,
  busy,
}: {
  readonly entry: ChangeHistoryEntryVm;
  readonly fieldNames: ReadonlyMap<string, string>;
  readonly recordHref?: (recordId: string, tableId: string | null) => string | null;
  readonly onRestore: () => void;
  readonly busy: boolean;
}): ReactNode {
  // A deleted record has no current value to open — the way back to it is the
  // restore beside this line, not a link to a record that is not there.
  const href =
    entry.subjectKind === "record" && entry.eventKind !== "record.deleted"
      ? (recordHref?.(entry.subjectId, entry.tableId) ?? null)
      : null;
  // The names of the fields that moved. The values stay out of a log listing.
  const changed = entry.changedFieldIds
    .map((fieldId) => fieldNames.get(fieldId) ?? "a field this app no longer has")
    .join(", ");

  return (
    <li className={cx(styles["entry"])} data-event={entry.eventId}>
      <span className={cx(styles["entryTitle"])}>
        {describeEvent(entry.eventKind)}
      </span>
      <p className={cx(styles["lede"])}>
        <time dateTime={isoInstant(entry.wallTimeMs)}>
          {formatInstant(entry.wallTimeMs)}
        </time>
        {entry.tableName === null ? "" : ` · ${entry.tableName}`}
        {changed === "" ? "" : ` · ${changed}`}
      </p>
      <div className={cx(styles["actions"])}>
        {href !== null && (
          <InlineLink target={{ kind: "internal", href }}>
            Open this record
          </InlineLink>
        )}
        {entry.isRestorable && (
          <Button
            onPress={onRestore}
            {...(busy
              ? {
                  isDisabled: true as const,
                  disabledReason: "A change is being written to this device.",
                }
              : {})}
          >
            Restore record…
          </Button>
        )}
      </div>
    </li>
  );
}
