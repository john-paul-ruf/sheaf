import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import type {
  InertItemVm,
  SnapshotSlotVm,
  SnapshotViewerVm,
} from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { TextField } from "../primitives/text-field.js";
import { AppFrame, type AppIdentity, type AppNavigation } from "./app-frame.js";
import { formatCount } from "./values.js";
import styles from "./records.module.css";

/**
 * SCR-031 — one sheet, read only (snapshot-detail.html; CAP-25, FR-4/5/9).
 *
 * **A snapshot is text in a grid.** CTL-067's dense table: row and column
 * headers as the source numbered them, cells as the worker rendered them
 * (D41) — never markup — and a merged region drawn once, spanning.
 *
 * **Inert content is marked where it sits.** CTL-079: type, location and
 * reason inline at the item's anchor, and every inert item of the sheet listed
 * below the grid (STA-012) with the way back to its place.
 *
 * **Discarded rows stay visible.** A row inference set aside is drawn where it
 * was, marked "Not imported" with why — FR-4's "recoverable" made visible.
 *
 * **Find is the worker's.** `findInSnapshot` scans every page in the data
 * worker, so a match on a later page is found and the grid moves to it.
 */

export interface SnapshotViewerScreenProps {
  readonly vm: SnapshotViewerVm;
  readonly app: AppIdentity;
  readonly nav: AppNavigation;
  readonly allSnapshotsHref: string;
  /** Where "return to live" goes, and what it is called. */
  readonly returnLink: { readonly href: string; readonly label: string };
  readonly onFind: (text: string, isNext: boolean) => void;
  readonly onPage: (firstRow: number) => void;
  readonly onShowItem: (item: InertItemVm) => void;
  readonly onOpenOptions: () => void;
  readonly busy?: boolean;
  /** SHT-016 and anything else the route composed. */
  readonly overlays?: ReactNode;
  readonly topBarActions?: ReactNode;
  /**
   * Where SHT-016 sent the person: the find field, or the inert list. `nonce`
   * changes per request so choosing the same option twice moves focus twice.
   */
  readonly focusRequest?: { readonly target: "find" | "inert-items"; readonly nonce: number };
}

export function SnapshotViewerScreen({
  vm,
  app,
  nav,
  allSnapshotsHref,
  returnLink,
  onFind,
  onPage,
  onShowItem,
  onOpenOptions,
  busy = false,
  overlays,
  topBarActions,
  focusRequest,
}: SnapshotViewerScreenProps): ReactNode {
  const [text, setText] = useState(vm.find.state === "idle" ? "" : vm.find.text);
  const captionId = useId();
  const findFieldId = useId();
  const { previousFirstRow, nextFirstRow } = vm;
  const inertListId = useId();

  // The sheet's own focus restore lands first; this runs after it, so the
  // person ends where the option they chose said they would.
  useEffect(() => {
    if (focusRequest === undefined) return undefined;
    const timer = setTimeout(() => {
      document
        .getElementById(focusRequest.target === "find" ? findFieldId : inertListId)
        ?.focus();
    }, 60);
    return () => {
      clearTimeout(timer);
    };
  }, [focusRequest, findFieldId, inertListId]);
  const isSameQuery = vm.find.state !== "idle" && vm.find.text === text.trim();

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (text.trim() === "") return;
    onFind(text.trim(), isSameQuery && vm.find.state === "found");
  };

  return (
    <AppFrame
      announcement={vm.announcement}
      app={app}
      area="snapshots"
      nav={nav}
      title={vm.displayName}
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-031">
        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>{`${vm.displayName} · read only`}</span>
          <h1 className={cx(styles["title"])}>Original sheet snapshot</h1>
          <p className={cx(styles["lede"])}>
            Cell values, ordering, merged regions, and original locations are
            preserved. Editing happens only in generated tables.
          </p>
        </div>

        {vm.inertHeadline !== null && (
          <div className={cx(styles["inertNote"])}>
            <span aria-hidden="true" className={cx(styles["inertGlyph"])}>
              ◇
            </span>
            <div>
              <p className={cx(styles["inertTitle"])}>{vm.inertHeadline}</p>
              <p className={cx(styles["lede"])}>
                They are listed below the sheet and marked where they sit; none of
                them is interactive.
              </p>
            </div>
          </div>
        )}

        <form className={cx(styles["findRow"])} noValidate onSubmit={submit} role="search">
          <TextField
            autoComplete="off"
            className={cx(styles["searchField"])}
            label="Find in sheet"
            onChange={setText}
            value={text}
            inputId={findFieldId}
          />
          <div className={cx(styles["actions"])}>
            {text.trim() === "" || busy ? (
              <Button
                disabledReason={busy ? "The sheet is being read." : "Type something to find."}
                isDisabled
              >
                Find next
              </Button>
            ) : (
              <Button type="submit">Find next</Button>
            )}
            <Button onPress={onOpenOptions}>Snapshot options</Button>
          </div>
        </form>
        {vm.find.state !== "idle" && (
          <p className={cx(styles["note"])} data-find={vm.find.state}>
            {vm.find.sentence}
          </p>
        )}

        <div
          aria-labelledby={captionId}
          className={cx(styles["sheetScroll"])}
          role="region"
          tabIndex={0}
        >
          <table className={cx(styles["sheetGrid"])} data-format={vm.format}>
            <caption className={cx(styles["sheetCaption"])} id={captionId}>
              {`Original ${vm.displayName} worksheet, rows ${formatCount(vm.firstRow + 1)} to ${formatCount(
                vm.endRow,
              )} of ${formatCount(vm.rowCount)}`}
            </caption>
            <thead>
              <tr>
                <th scope="col">Row</th>
                {vm.columns.map((column) => (
                  <th key={column.columnIndex} scope="col">
                    {column.letters}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vm.rows.map((row) => (
                <tr
                  data-discarded={row.discarded === null ? undefined : "true"}
                  data-row={row.rowNumber}
                  key={row.rowIndex}
                >
                  <th scope="row">
                    {row.rowNumber}
                    {row.discarded !== null && (
                      <span className={cx(styles["discardTag"])}>{row.discarded}</span>
                    )}
                  </th>
                  {row.slots.map((slot) => (
                    <Cell key={slot.columnIndex} slot={slot} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(vm.hasPrevious || vm.hasNext) && (
          <div className={cx(styles["actions"])}>
            {previousFirstRow !== null && (
              <Button
                onPress={() => {
                  onPage(previousFirstRow);
                }}
              >
                Earlier rows
              </Button>
            )}
            {nextFirstRow !== null && (
              <Button
                onPress={() => {
                  onPage(nextFirstRow);
                }}
              >
                Later rows
              </Button>
            )}
          </div>
        )}

        {vm.inertItems.length > 0 && (
          <section aria-labelledby={inertListId} className={cx(styles["stack"])}>
            <h2 className={cx(styles["sectionTitle"])} id={inertListId} tabIndex={-1}>
              Inert items on this sheet
            </h2>
            <ul className={cx(styles["entryList"])}>
              {vm.inertItems.map((item) => (
                <li className={cx(styles["entry"])} data-inert={item.kind} key={item.inertItemId}>
                  <span className={cx(styles["entryTitle"])}>
                    {`${item.kindName} preserved · ${item.location}`}
                  </span>
                  <p className={cx(styles["lede"])}>{item.reason}</p>
                  {item.anchorRow !== null && (
                    <div className={cx(styles["actions"])}>
                      <Button
                        onPress={() => {
                          onShowItem(item);
                        }}
                      >
                        {`Show ${item.location} in the snapshot`}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className={cx(styles["actions"])}>
          <InlineLink target={{ kind: "internal", href: allSnapshotsHref }}>
            All snapshots
          </InlineLink>
          <InlineLink target={{ kind: "internal", href: returnLink.href }}>
            {returnLink.label}
          </InlineLink>
        </div>
      </div>
      {overlays}
    </AppFrame>
  );
}

function Cell({ slot }: { readonly slot: SnapshotSlotVm }): ReactNode {
  return (
    <td
      className={cx(slot.isMatch && styles["cellMatch"])}
      colSpan={slot.colSpan > 1 ? slot.colSpan : undefined}
      data-kind={slot.kind}
      data-merged={slot.isMerged ? "true" : undefined}
      rowSpan={slot.rowSpan > 1 ? slot.rowSpan : undefined}
      {...(slot.isMatch ? { "aria-current": "true" as const } : {})}
    >
      {slot.text}
      {slot.markers.map((marker) => (
        <span className={cx(styles["inertMarker"])} data-inert-marker={marker.kind} key={marker.inertItemId}>
          <span aria-hidden="true">◇ </span>
          {`${marker.kindName} preserved · ${marker.location}`}
        </span>
      ))}
    </td>
  );
}
