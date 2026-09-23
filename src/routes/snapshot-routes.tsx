/**
 * SCR-030 and SCR-031 under CA-07 amendment 3 (M54, CAP-25, CA-22).
 *
 * `#/app/{appId}/snapshots` lists every imported sheet; `#/app/{appId}/
 * snapshots/{sheetId}` shows one, a page of at most `SNAPSHOT_PAGE_ROWS` rows
 * at a time through `getSnapshotPage`. The guard renders both shapes for an
 * unlocked session only; a sheet id this app does not hold is answered at the
 * path with the truthful absent notice (amendment 2's precedent), because
 * the guard cannot know what an app holds.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import {
  SNAPSHOT_PAGE_ROWS,
  liveTableForSheet,
  pageStartFor,
  selectSnapshotOptionsVm,
  selectSnapshotViewerVm,
  selectSnapshotsListVm,
  toSnapshotFindVm,
  type SnapshotFindVm,
} from "../application/view-models/records.js";
import type {
  InertItemViewV1,
  SheetSnapshotViewV1,
  SnapshotPageViewV1,
} from "../workers/protocol/messages.js";
import { AppFrame } from "../ui/records/app-frame.js";
import { SnapshotOptionsSheet } from "../ui/records/snapshot-options-sheet.js";
import { SnapshotViewerScreen } from "../ui/records/snapshot-viewer-screen.js";
import { SnapshotsScreen } from "../ui/records/snapshots-screen.js";
import { BusyIndicator } from "../ui/primitives/busy-indicator.js";
import { Button } from "../ui/primitives/button.js";
import { ErrorState } from "../ui/primitives/error-state.js";
import type { AppAreaWiring } from "./app-area-hooks.js";
import {
  appPath,
  appSnapshotsPath,
  hashHref,
  snapshotPath,
  tablePath,
} from "./guards.js";

/** SCR-030 — every imported sheet, with its use and its inert count. */
export function SnapshotsRoute({ area }: { readonly area: AppAreaWiring }): ReactNode {
  const { identity, nav, records, topBarActions } = area;
  const appId = identity.appId;
  const [sheets, setSheets] = useState<readonly SheetSnapshotViewV1[] | null>(null);

  useEffect(() => {
    let live = true;
    void records.listSheetSnapshots({ appId }).then(
      ({ sheets: read }) => {
        if (live) setSheets(read ?? []);
      },
      () => {
        if (live) setSheets([]);
      },
    );
    return () => {
      live = false;
    };
  }, [records, appId]);

  if (sheets === null) {
    return (
      <BusyIndicator cancellation="unavailable" label="Reading this app's sheet snapshots." />
    );
  }

  return (
    <SnapshotsScreen
      app={identity}
      nav={nav}
      snapshotHref={(sheetId) => hashHref(snapshotPath(appId, sheetId))}
      topBarActions={topBarActions}
      vm={selectSnapshotsListVm(sheets)}
    />
  );
}

/** SCR-031 — one sheet, a page at a time, with find and SHT-016. */
export function SnapshotViewerRoute({ area }: { readonly area: AppAreaWiring }): ReactNode {
  const { sheetId = "" } = useParams();
  // Another sheet is another viewer: its page, find and items start fresh.
  return <SnapshotViewer area={area} key={sheetId} sheetId={sheetId} />;
}

function SnapshotViewer({
  area,
  sheetId,
}: {
  readonly area: AppAreaWiring;
  readonly sheetId: string;
}): ReactNode {
  const { identity, nav, records, session, topBarActions } = area;
  const appId = identity.appId;
  const navigate = useNavigate();

  const [firstRow, setFirstRow] = useState(0);
  const [page, setPage] = useState<SnapshotPageViewV1 | null | undefined>(undefined);
  const [items, setItems] = useState<readonly InertItemViewV1[]>([]);
  const [find, setFind] = useState<SnapshotFindVm>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<
    { readonly target: "find" | "inert-items"; readonly nonce: number } | undefined
  >(undefined);

  useEffect(() => {
    let live = true;
    void records.listInertItems({ appId, sheetId }).then(
      ({ items: read }) => {
        if (live) setItems(read ?? []);
      },
      () => {
        if (live) setItems([]);
      },
    );
    return () => {
      live = false;
    };
  }, [records, appId, sheetId]);

  useEffect(() => {
    let live = true;
    setBusy(true);
    void records
      .getSnapshotPage({ appId, sheetId, firstRow, rowCount: SNAPSHOT_PAGE_ROWS })
      .then(
        ({ page: read }) => {
          if (!live) return;
          setBusy(false);
          setPage(read);
        },
        () => {
          if (!live) return;
          setBusy(false);
          setPage(null);
        },
      );
    return () => {
      live = false;
    };
  }, [records, appId, sheetId, firstRow]);

  if (page === undefined) {
    return <BusyIndicator cancellation="unavailable" label="Reading this sheet snapshot." />;
  }

  if (page === null) {
    return (
      <AppFrame
        announcement="That sheet snapshot is not in this app."
        app={identity}
        area="snapshots"
        nav={nav}
        title="Sheet snapshot"
        topBarActions={topBarActions}
      >
        <ErrorState
          action={
            <Button
              onPress={() => {
                void navigate(appSnapshotsPath(appId));
              }}
              tone="primary"
            >
              All snapshots
            </Button>
          }
          cause="This app holds no preserved sheet at that address. The link may be from another app or another device."
          heading="That sheet snapshot is not in this app."
          variant="recoverable"
        />
      </AppFrame>
    );
  }

  const liveTable = liveTableForSheet(page.displayName, session.tables);
  const vm = selectSnapshotViewerVm({ page, inertItems: items, find });

  const runFind = (text: string, isNext: boolean): void => {
    const afterRow = isNext && find.state === "found" ? find.rowIndex : null;
    setBusy(true);
    void records.findInSnapshot({ appId, sheetId, text, afterRow }).then(
      ({ result }) => {
        setBusy(false);
        const next = toSnapshotFindVm(text, afterRow, result ?? { outcome: "not-found" });
        setFind(next);
        if (next.state === "found") setFirstRow(pageStartFor(next.rowIndex));
      },
      () => {
        setBusy(false);
      },
    );
  };

  return (
    <SnapshotViewerScreen
      allSnapshotsHref={hashHref(appSnapshotsPath(appId))}
      app={identity}
      busy={busy}
      nav={nav}
      onFind={runFind}
      onOpenOptions={() => {
        setOptionsOpen(true);
      }}
      onPage={setFirstRow}
      onShowItem={(item) => {
        if (item.anchorRow !== null) setFirstRow(pageStartFor(item.anchorRow));
      }}
      overlays={
        <SnapshotOptionsSheet
          isOpen={optionsOpen}
          onChoose={(id) => {
            setOptionsOpen(false);
            if (id === "return") {
              void navigate(liveTable === null ? appPath(appId) : tablePath(appId, liveTable.tableId));
              return;
            }
            setFocusRequest({ target: id, nonce: Date.now() });
          }}
          onClose={() => {
            setOptionsOpen(false);
          }}
          vm={selectSnapshotOptionsVm({ inertCount: items.length, liveTable })}
        />
      }
      returnLink={
        liveTable === null
          ? { href: hashHref(appPath(appId)), label: "Return to app home" }
          : {
              href: hashHref(tablePath(appId, liveTable.tableId)),
              label: `Return to live ${liveTable.displayName}`,
            }
      }
      topBarActions={topBarActions}
      vm={vm}
      {...(focusRequest === undefined ? {} : { focusRequest })}
    />
  );
}
