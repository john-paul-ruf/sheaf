/**
 * The charts column's routes (M54; CA-07 amendment 4, D63; CAP-32/33).
 *
 * Kept beside the route table, like the snapshot routes: each chart surface
 * reads its dataset from the worker (CA-30) and turns it into its view model;
 * none computes an aggregate. A tapped mark leaves every one of them the same
 * way — to its table's records list, with the mark's filter in navigation
 * state and the chart named beside it (D63), never in the URL.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useParams, type NavigateFunction } from "react-router";
import {
  appendTablePage,
  selectChartDetailVm,
  type ChartDetailVm,
  type ChartMarkVm,
} from "../application/view-models/records.js";
import type { AppTableViewV1 } from "../workers/protocol/messages.js";
import { ChartDetailScreen } from "../ui/charts/chart-detail-screen.js";
import { BusyIndicator } from "../ui/primitives/busy-indicator.js";
import type { AppAreaWiring } from "./app-area-hooks.js";
import { filterIntentState } from "./filter-intent.js";
import { appPath, hashHref, tablePath } from "./guards.js";

/** The one way a mark filters the list: its intent, its chart's name, its records' labels. */
export function openMarkRecords(
  navigate: NavigateFunction,
  appId: string,
  chart: ChartDetailVm,
  mark: Extract<ChartMarkVm, { kind: "group" }>,
): void {
  if (mark.filterIntent === null) return;
  void navigate(tablePath(appId, chart.tableId), {
    state: filterIntentState(mark.filterIntent, {
      chartName: chart.name,
      recordLabels: Object.fromEntries(mark.recordLabels),
    }),
  });
}

/**
 * SCR-024's pinned charts: each pinned chart's dataset, read on arrival and
 * again whenever the app re-reads (`session` changes after a write). None is
 * drawn until its dataset is read; one that cannot be read is left out rather
 * than drawn from a guess.
 */
export function usePinnedCharts(area: AppAreaWiring): readonly ChartDetailVm[] {
  const { charts, identity, session } = area;
  const appId = identity.appId;
  const [pinned, setPinned] = useState<readonly ChartDetailVm[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const listed = (await charts.listCharts({ appId })).charts ?? [];
      const read = await Promise.all(
        listed
          .filter((chart) => chart.definition.pinned)
          .map(async (chart) => (await charts.getChartDataset({ appId, source: { kind: "chart", chartId: chart.chartId } })).dataset),
      );
      if (live) {
        setPinned(read.flatMap((dataset) => (dataset === null ? [] : [selectChartDetailVm(dataset, session.tables)])));
      }
    })().catch(() => {
      if (live) setPinned([]);
    });
    return () => {
      live = false;
    };
  }, [charts, appId, session]);
  return pinned;
}

type DetailState = { readonly kind: "reading" } | { readonly kind: "absent" } | { readonly kind: "read"; readonly vm: ChartDetailVm };

/** Reads one chart's dataset (and more of its table) into SCR-033's view model. */
function useChartDetail(area: AppAreaWiring, chartId: string, tables: readonly AppTableViewV1[]) {
  const { charts, identity } = area;
  const appId = identity.appId;
  const [state, setState] = useState<DetailState>({ kind: "reading" });
  const [rowsBusy, setRowsBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void charts.getChartDataset({ appId, source: { kind: "chart", chartId } }).then(
      ({ dataset }) => {
        if (live) setState(dataset === null ? { kind: "absent" } : { kind: "read", vm: selectChartDetailVm(dataset, tables) });
      },
      () => {
        if (live) setState({ kind: "absent" });
      },
    );
    return () => {
      live = false;
    };
  }, [charts, appId, chartId, tables]);

  const showMoreRows = useCallback(() => {
    if (state.kind !== "read") return;
    const current = state.vm;
    setRowsBusy(true);
    void charts
      .getChartDataset({ appId, source: { kind: "chart", chartId }, tableOffset: current.table.offset + current.table.rows.length })
      .then(({ dataset }) => {
        setRowsBusy(false);
        if (dataset !== null) setState({ kind: "read", vm: appendTablePage(current, selectChartDetailVm(dataset, tables)) });
      }, () => {
        setRowsBusy(false);
      });
  }, [charts, appId, chartId, state, tables]);

  return { state, rowsBusy, showMoreRows };
}

/** SCR-033 at `#/app/{id}/charts/{chartId}`. */
export function ChartDetailRoute({ area }: { readonly area: AppAreaWiring }): ReactNode {
  const { chartId = "" } = useParams();
  const navigate = useNavigate();
  const { identity, nav, session, topBarActions } = area;
  const { state, rowsBusy, showMoreRows } = useChartDetail(area, chartId, session.tables);

  if (state.kind === "reading") {
    return <BusyIndicator cancellation="unavailable" label="Reading this chart on this device." />;
  }
  if (state.kind === "absent") {
    // The app is open and this chart is not in it; its home is what is true.
    return <Navigate replace to={appPath(identity.appId)} />;
  }
  const { vm } = state;
  return (
    <ChartDetailScreen
      app={identity}
      fullDataHref={hashHref(tablePath(identity.appId, vm.tableId))}
      nav={nav}
      onApplyMark={(mark) => {
        openMarkRecords(navigate, identity.appId, vm, mark);
      }}
      rowsBusy={rowsBusy}
      topBarActions={topBarActions}
      vm={vm}
      {...(vm.table.hasMore ? { onShowMoreRows: showMoreRows } : {})}
    />
  );
}
