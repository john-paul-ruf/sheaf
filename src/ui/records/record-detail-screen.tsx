import type { ReactNode } from "react";
import type {
  BelongsToVm,
  HasManyVm,
  MissingReferenceVm,
  RecordDetailFieldVm,
  RecordDetailVm,
  RecordHandoffVm,
  RecordIssueVm,
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
import { describeValue, formatCount, isAbsent } from "./values.js";
import styles from "./records.module.css";

/**
 * SCR-027 — one record, read (record-detail.html; CAP-16, FR-12).
 *
 * **Relationships, both directions (CAP-24).** record-detail.html's three
 * blocks: "Belongs to" with the parent's human label and the way to it, "Has
 * many" with an exact count and the first children (then every page through
 * "show all"), and "Missing related record" with the original key behind a
 * disclosure and a repair (STA-011, MOD-011; design.md: *never a blank
 * cell*). A value-only table has none of them, and none is drawn (STA-025).
 *
 * **A preserved import value is shown as it arrived, and flagged.** FR-6: the
 * person who has to fix it needs to see what was actually written, so the
 * original text is rendered with its issue beside it rather than replaced by a
 * blank or by a guess.
 *
 * **The device handoffs are built here.** M37 gives `tel:`, `mailto:` and
 * `http(s)` complete, because those schemes are unambiguous. An address
 * arrives as a *query* with no URL — there is no registered scheme for a
 * textual address, so the model refuses to invent one (M51's decision). The
 * URL below is record-edit.html's own: the approved mock hands an address to
 * `https://maps.apple.com/?q=…`, which resolves in a browser on every
 * platform. `rel="noreferrer"` keeps this app's address out of the request
 * that leaves — nothing is sent until the person presses it (invariant 12).
 */

/** record-edit.html's maps handoff, with the address the record holds. */
export function mapsHref(query: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
}

/**
 * How many values need looking at, in words that agree with the number: the
 * visible sentence names the two severities apart, where M37's live-region
 * announcement gives their total.
 */
export function describeIssueCounts(vm: RecordDetailVm): string {
  const parts: string[] = [];
  if (vm.blockingIssueCount > 0) {
    parts.push(
      vm.blockingIssueCount === 1
        ? "1 value must be corrected"
        : `${String(vm.blockingIssueCount)} values must be corrected`,
    );
  }
  if (vm.warningIssueCount > 0) {
    parts.push(
      vm.warningIssueCount === 1
        ? "1 value needs attention"
        : `${String(vm.warningIssueCount)} values need attention`,
    );
  }
  return `${parts.join(", and ")}.`;
}

export interface RecordDetailScreenProps {
  readonly vm: RecordDetailVm;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  readonly editHref: string;
  readonly recordsHref: string;
  /** Where a related record lives: the record route, in its own table. */
  readonly recordHref: (tableId: string, recordId: string) => string;
  /** "Show all" / "Show more" for one relationship's children. */
  readonly onShowChildren?: (relationshipId: string) => void;
  /** The relationship whose next children are being read. */
  readonly readingChildrenOf?: string | null;
  /** Opens MOD-011 for one broken reference field. */
  readonly onRepair?: (fieldId: string) => void;
  /** Opens SHT-010. */
  readonly onOpenActions: () => void;
  /** A confirmed write's acknowledgement, once it is durable (invariant 1). */
  readonly notice?: string;
  /** SHT-010, MOD-009 and anything else the route composed. */
  readonly overlays?: ReactNode;
  readonly topBarActions?: ReactNode;
}

export function RecordDetailScreen({
  vm,
  app,
  nav,
  editHref,
  recordsHref,
  recordHref,
  onShowChildren,
  readingChildrenOf = null,
  onRepair,
  onOpenActions,
  notice,
  overlays,
  topBarActions,
}: RecordDetailScreenProps): ReactNode {
  const label =
    vm.label === null
      ? "A record with no value to lead with"
      : describeValue(vm.label.value, undefined);

  return (
    <AppFrame
      announcement={notice ?? vm.announcement}
      app={app}
      area="records"
      currentTableId={vm.tableId}
      nav={nav}
      title={label}
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-027">
        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>Record</span>
          <h1 className={cx(styles["title"])}>{label}</h1>
          <p className={cx(styles["note"])}>
            <InlineLink target={{ kind: "internal", href: recordsHref }}>
              Back to the list
            </InlineLink>
          </p>
        </div>

        {/* The sentence is the whole banner: it is M37's own words for the
            outcome the worker confirmed, and a title above it could only
            repeat them. */}
        {notice !== undefined && (
          <StatusBanner title={notice} tone="success" />
        )}

        {vm.blockingIssueCount + vm.warningIssueCount > 0 && (
          <StatusBanner
            title={
              vm.blockingIssueCount > 0
                ? "Some values must be corrected"
                : "Some values need attention"
            }
            tone={vm.blockingIssueCount > 0 ? "danger" : "warning"}
          >
            {describeIssueCounts(vm)} Each one is named beside its own field.
          </StatusBanner>
        )}

        <dl className={cx(styles["fieldList"])}>
          {vm.fields.map((field) => (
            <DetailField field={field} key={field.fieldId} />
          ))}
        </dl>

        {vm.belongsTo.length + vm.hasMany.length + vm.missing.length > 0 && (
          <div className={cx(styles["relations"])} data-relations="">
            {vm.belongsTo.map((parent) => (
              <BelongsTo
                href={recordHref(parent.tableId, parent.recordId)}
                key={parent.fieldId}
                parent={parent}
              />
            ))}
            {vm.hasMany.map((group) => (
              <HasMany
                group={group}
                isReading={readingChildrenOf === group.relationshipId}
                key={group.relationshipId}
                recordHref={recordHref}
                {...(onShowChildren === undefined
                  ? {}
                  : {
                      onShowMore: () => {
                        onShowChildren(group.relationshipId);
                      },
                    })}
              />
            ))}
            {vm.missing.map((missing) => (
              <Missing
                key={missing.fieldId}
                missing={missing}
                {...(onRepair === undefined
                  ? {}
                  : {
                      onRepair: () => {
                        onRepair(missing.fieldId);
                      },
                    })}
              />
            ))}
          </div>
        )}

        <div className={cx(styles["thumbActions"])}>
          <InlineLink target={{ kind: "internal", href: editHref }}>
            Edit this record
          </InlineLink>
          <Button onPress={onOpenActions}>Record actions…</Button>
        </div>
      </div>
      {overlays}
    </AppFrame>
  );
}

/** "Belongs to" — the parent's human label, its table, and the way there. */
function BelongsTo({
  parent,
  href,
}: {
  readonly parent: BelongsToVm;
  readonly href: string;
}): ReactNode {
  return (
    <section className={cx(styles["relation"])} data-belongs-to={parent.fieldId}>
      <span className={cx(styles["relationTag"])}>Belongs to</span>
      <h2 className={cx(styles["relationTitle"])}>{parent.label}</h2>
      <p className={cx(styles["lede"])}>
        {parent.tableName === null
          ? parent.fieldName
          : `${parent.tableName} · ${parent.fieldName}`}
      </p>
      <InlineLink target={{ kind: "internal", href }}>
        {parent.tableName === null
          ? "Open the related record →"
          : `Open in ${parent.tableName} →`}
      </InlineLink>
    </section>
  );
}

/** "Has many" — an exact count, the children by label, and every page on request. */
function HasMany({
  group,
  recordHref,
  onShowMore,
  isReading,
}: {
  readonly group: HasManyVm;
  readonly recordHref: (tableId: string, recordId: string) => string;
  readonly onShowMore?: () => void;
  readonly isReading: boolean;
}): ReactNode {
  const headingId = `has-many-${group.relationshipId}`;
  return (
    <section
      aria-labelledby={headingId}
      className={cx(styles["relation"])}
      data-has-many={group.relationshipId}
    >
      <span className={cx(styles["relationTag"])}>Has many</span>
      <h2 className={cx(styles["relationTitle"])} id={headingId}>
        {`${formatCount(group.count)} in ${group.tableName}`}
      </h2>
      {group.shown.length > 0 && (
        <ul className={cx(styles["childList"])}>
          {group.shown.map((child) => (
            <li key={child.recordId}>
              <InlineLink
                target={{ kind: "internal", href: recordHref(group.tableId, child.recordId) }}
              >
                {child.label}
              </InlineLink>
            </li>
          ))}
        </ul>
      )}
      {group.hasMore && onShowMore !== undefined && (
        <div className={cx(styles["actions"])}>
          <Button
            onPress={onShowMore}
            {...(isReading
              ? {
                  isDisabled: true as const,
                  disabledReason: `The next records in ${group.tableName} are being read.`,
                }
              : {})}
          >
            {group.isExpanded
              ? `Show more in ${group.tableName}`
              : `Show all ${formatCount(group.count)} in ${group.tableName}`}
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * STA-011: the named relation, the original key behind a disclosure, and the
 * repair — design.md's "Missing related record" treatment, verbatim.
 */
function Missing({
  missing,
  onRepair,
}: {
  readonly missing: MissingReferenceVm;
  readonly onRepair?: () => void;
}): ReactNode {
  return (
    <section
      className={cx(styles["relation"])}
      data-missing={missing.fieldId}
      data-state="missing"
    >
      <span className={cx(styles["relationTag"])}>Missing related record</span>
      <h2 className={cx(styles["relationTitle"])}>{missing.relationName}</h2>
      {missing.kind === "broken" ? (
        <details className={cx(styles["disclosure"])}>
          <summary>Show original key</summary>
          <p className={cx(styles["preserved"])}>{missing.originalKey}</p>
        </details>
      ) : (
        <p className={cx(styles["lede"])}>No original key was recorded for it.</p>
      )}
      {onRepair !== undefined && (
        <div className={cx(styles["actions"])}>
          <Button onPress={onRepair}>Repair reference</Button>
        </div>
      )}
    </section>
  );
}

function DetailField({
  field,
}: {
  readonly field: RecordDetailFieldVm;
}): ReactNode {
  const preserved = field.value.kind === "invalid-preserved";
  return (
    <div className={cx(styles["fieldRow"])} data-field={field.fieldId}>
      <dt className={cx(styles["fieldLabel"])}>{field.displayName}</dt>
      <dd
        className={cx(
          styles["fieldValue"],
          isAbsent(field.value) && styles["absent"],
          preserved && styles["preserved"],
        )}
      >
        {describeValue(field.value, field.type)}
      </dd>
      {field.handoff !== null && (
        <dd className={cx(styles["fieldValue"])}>
          <Handoff handoff={field.handoff} />
        </dd>
      )}
      {field.issues.length > 0 && (
        <dd>
          <ul className={cx(styles["issueList"])}>
            {field.issues.map((issue, index) => (
              <Issue issue={issue} key={`${issue.kind}-${String(index)}`} />
            ))}
          </ul>
        </dd>
      )}
    </div>
  );
}

function Issue({ issue }: { readonly issue: RecordIssueVm }): ReactNode {
  return (
    <li className={cx(styles["issue"])} data-severity={issue.severity}>
      {issue.sentence}
    </li>
  );
}

function Handoff({
  handoff,
}: {
  readonly handoff: RecordHandoffVm;
}): ReactNode {
  switch (handoff.kind) {
    case "dial":
      return (
        <a className={cx(styles["handoff"])} href={handoff.href}>
          Call this number
        </a>
      );
    case "email":
      return (
        <a className={cx(styles["handoff"])} href={handoff.href}>
          Send an email
        </a>
      );
    case "open-url":
      return (
        <a
          className={cx(styles["handoff"])}
          href={handoff.href}
          rel="noreferrer"
        >
          Open this page
        </a>
      );
    case "maps":
      return (
        <a
          className={cx(styles["handoff"])}
          href={mapsHref(handoff.query)}
          rel="noreferrer"
        >
          Open in Maps
        </a>
      );
  }
}
