import type { ReactNode } from "react";
import type {
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
import { describeValue, isAbsent } from "./values.js";
import styles from "./records.module.css";

/**
 * SCR-027 — one record, read (record-detail.html; CAP-16, FR-12).
 *
 * **No relationships section, and no room for one.** record-detail.html shows
 * "Belongs to", "Has many" and a broken-reference card; a value-only app has
 * no references at all, `RecordDetailVm` carries no field that could hold one,
 * and an empty "Related records" block would be scaffolding for a promise F03
 * makes (D25, STA-025).
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
 * How many values need looking at, in words that agree with the number.
 *
 * M37's `announcement` says "1 values need attention" — a plural for a count
 * of one. It is still what the live region announces (that copy is M37's to
 * fix, and it is reported), but the sentence a person *reads* is composed here
 * from the same two counts.
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

        {notice !== undefined && (
          <StatusBanner title="Saved on this device" tone="success">
            {notice}
          </StatusBanner>
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
