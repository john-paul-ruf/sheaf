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
  defaultChartDefinition,
  selectChartBuilderVm,
  selectChartDetailVm,
  type ChartDetailVm,
  type ChartMarkVm,
} from "../application/view-models/records.js";
import type { AppTableViewV1, ChartCommandOutcomeWireV1, ChartDefinitionWireV1 } from "../workers/protocol/messages.js";
import { ChartBuilderScreen } from "../ui/charts/chart-builder-screen.js";
import { ChartDetailScreen } from "../ui/charts/chart-detail-screen.js";
import { ChartSavedDialog } from "../ui/charts/chart-saved-dialog.js";
import { DiscardDraftDialog } from "../ui/charts/discard-draft-dialog.js";
import chartStyles from "../ui/charts/charts.module.css";
import { BusyIndicator } from "../ui/primitives/busy-indicator.js";
import { Button } from "../ui/primitives/button.js";
import { cx } from "../ui/primitives/class-names.js";
import type { AppAreaWiring } from "./app-area-hooks.js";
import { filterIntentState } from "./filter-intent.js";
import { appPath, chartPath, editChartPath, hashHref, tablePath } from "./guards.js";

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
export function ChartDetailRoute({
  area,
  notice,
  clearNotice,
}: {
  readonly area: AppAreaWiring;
  /** A confirmed save's sentence, said once on arrival. */
  readonly notice?: string;
  readonly clearNotice: () => void;
}): ReactNode {
  const { chartId = "" } = useParams();
  const navigate = useNavigate();
  const { identity, nav, session, topBarActions } = area;
  const { state, rowsBusy, showMoreRows } = useChartDetail(area, chartId, session.tables);
  // Said once: leaving the chart forgets the sentence.
  useEffect(() => clearNotice, [clearNotice]);

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
      editHref={hashHref(editChartPath(identity.appId, chartId))}
      fullDataHref={hashHref(tablePath(identity.appId, vm.tableId))}
      nav={nav}
      {...(notice === undefined ? {} : { announcement: notice })}
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

type BuilderState =
  | { readonly kind: "reading" }
  | { readonly kind: "absent" }
  | {
      readonly kind: "ready";
      /** The definition the builder opened with: "dirty" is any difference from it. */
      readonly original: ChartDefinitionWireV1;
      readonly expectedRevision: number | null;
      /** A draft for this builder was found and restored (D61). */
      readonly hadDraft: boolean;
    };

/** How long the preview waits for the choices to settle before it reads. */
const PREVIEW_DELAY_MS = 250;

function includedOf(definition: ChartDefinitionWireV1): ReadonlySet<string> {
  if (definition.type === "scatter") return new Set();
  const groups = [definition.groupBy, ...(definition.seriesBy === null ? [] : [definition.seriesBy])];
  return new Set(groups.flatMap((group) => (group.kind === "related-field" ? [group.relationshipId] : [])));
}

const describeSaveFailure = (result: ChartCommandOutcomeWireV1["result"]): string =>
  result === "stale-chart"
    ? "This chart changed on this device after you opened it, so nothing was saved. Open it again to edit the saved version."
    : result === "refused"
      ? "This chart cannot be saved from these choices, so nothing was saved."
      : "This chart is no longer in this app, so nothing was saved.";

/**
 * SCR-034 at `#/app/{id}/charts/new` and `#/app/{id}/charts/{chartId}/edit`.
 *
 * The builder opens on the app's one draft when it is this builder's (D61),
 * else on the saved chart or a new chart's defaults. MOD-012 guards leaving an
 * unsaved chart from the builder's own Cancel and close; MOD-013 confirms the
 * name and pin before the one commit, and nothing says "saved" until the
 * worker has confirmed it (invariant 1).
 */
export function ChartBuilderRoute({ area }: { readonly area: AppAreaWiring }): ReactNode {
  const { chartId } = useParams();
  const navigate = useNavigate();
  const { charts, identity, nav, session, structure, topBarActions } = area;
  const appId = identity.appId;
  const existingId = chartId ?? null;

  const [state, setState] = useState<BuilderState>({ kind: "reading" });
  const [definition, setDefinition] = useState<ChartDefinitionWireV1 | null>(null);
  const [included, setIncluded] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<{ readonly vm: ChartDetailVm | null; readonly refused: boolean }>({ vm: null, refused: false });
  const [dialog, setDialog] = useState<"none" | "leave" | "save">("none");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ draft }, chart] = await Promise.all([
        charts.getChartDraft({ appId }),
        existingId === null ? Promise.resolve(null) : charts.getChart({ appId, chartId: existingId }).then(({ chart: read }) => read),
      ]);
      if (!live) return;
      const first = [...session.tables].sort((left, right) => left.tableOrdinal - right.tableOrdinal)[0];
      const original = chart?.definition ?? (first === undefined ? null : defaultChartDefinition(first));
      if ((existingId !== null && chart === null) || original === null) {
        setState({ kind: "absent" });
        return;
      }
      const ownDraft = draft !== null && draft.chartId === existingId ? draft : null;
      const opened = ownDraft?.definition ?? original;
      setDefinition(opened);
      setIncluded(includedOf(opened));
      setState({ kind: "ready", original, expectedRevision: chart?.chartRevision ?? null, hadDraft: ownDraft !== null });
    })().catch(() => {
      if (live) setState({ kind: "absent" });
    });
    return () => {
      live = false;
    };
  }, [charts, appId, existingId, session.tables]);

  // The live preview: the worker's dataset for the definition as it stands.
  useEffect(() => {
    if (definition === null) return undefined;
    let live = true;
    const tableName = session.tables.find((table) => table.tableId === definition.tableId)?.displayName ?? "";
    const timer = setTimeout(() => {
      // A chart is drawn before it is named; the preview borrows its table's name.
      const named = definition.name.trim() === "" ? { ...definition, name: tableName } : definition;
      void charts.getChartDataset({ appId, source: { kind: "draft", definition: named } }).then(
        ({ dataset }) => {
          if (live) setPreview({ vm: dataset === null ? null : selectChartDetailVm(dataset, session.tables), refused: dataset === null });
        },
        () => {
          if (live) setPreview({ vm: null, refused: true });
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [charts, appId, definition, session.tables]);

  const leave = useCallback(() => {
    void navigate(existingId === null ? appPath(appId) : chartPath(appId, existingId));
  }, [navigate, appId, existingId]);

  if (state.kind === "reading" || (state.kind === "ready" && definition === null)) {
    return <BusyIndicator cancellation="unavailable" label="Opening the chart builder on this device." />;
  }
  if (state.kind === "absent" || definition === null) {
    return <Navigate replace to={appPath(appId)} />;
  }

  const isDirty = JSON.stringify(definition) !== JSON.stringify(state.original);
  const cancel = (): void => {
    if (isDirty) setDialog("leave");
    else leave();
  };
  const change = (next: ChartDefinitionWireV1): void => {
    if (next.tableId !== definition.tableId) {
      // Another table: its own defaults, keeping the name and the pin.
      const table = session.tables.find((candidate) => candidate.tableId === next.tableId);
      const reset = table === undefined ? null : defaultChartDefinition(table);
      if (reset !== null) setDefinition({ ...reset, name: definition.name, pinned: definition.pinned });
      return;
    }
    setDefinition(next);
  };
  const vm = selectChartBuilderVm({ tables: session.tables, relationships: structure?.relationships ?? [], definition, included });

  return (
    <ChartBuilderScreen
      app={identity}
      fullDataHref={hashHref(tablePath(appId, definition.tableId))}
      nav={nav}
      onCancel={cancel}
      onChange={change}
      onSave={() => {
        setFailure(undefined);
        setDialog("save");
      }}
      onToggleRelationship={(relationshipId, isIncluded) => {
        setIncluded((current) => {
          const next = new Set(current);
          if (isIncluded) next.add(relationshipId);
          else next.delete(relationshipId);
          return next;
        });
      }}
      overlays={
        <>
          {dialog === "leave" && (
            <DiscardDraftDialog
              busy={busy}
              onKeepEditing={() => {
                setDialog("none");
              }}
              onLeave={() => {
                void charts.discardChartDraft({ appId }).finally(leave);
              }}
              onSaveDraft={() => {
                setBusy(true);
                void charts
                  .saveChartDraft({ appId, draft: { chartId: existingId, expectedRevision: state.expectedRevision, definition } })
                  .finally(() => {
                    setBusy(false);
                    leave();
                  });
              }}
            />
          )}
          {dialog === "save" && (
            <ChartSavedDialog
              busy={busy}
              name={definition.name}
              onCancel={() => {
                setDialog("none");
              }}
              onSave={(name, pinned) => {
                setBusy(true);
                void charts
                  .saveChart({ appId, chartId: existingId, expectedRevision: state.expectedRevision, definition: { ...definition, name, pinned } })
                  .then(async ({ outcome }) => {
                    if (outcome.result !== "saved") {
                      setBusy(false);
                      setFailure(describeSaveFailure(outcome.result));
                      return;
                    }
                    // The draft was this builder's; the chart it described now exists.
                    if (state.hadDraft) await charts.discardChartDraft({ appId });
                    area.announce("Saved on this device.");
                    void navigate(chartPath(appId, outcome.chart.chartId));
                  }, () => {
                    setBusy(false);
                    setFailure("This chart could not be saved on this device, so nothing was saved.");
                  });
              }}
              pinned={definition.pinned}
              {...(failure === undefined ? {} : { failure })}
            />
          )}
        </>
      }
      preview={preview.vm}
      previewRefused={preview.refused}
      topBarActions={
        <>
          {state.hadDraft && <span className={cx(chartStyles["scopeBadge"])}>Draft saved locally</span>}
          <Button onPress={cancel}>Close chart builder</Button>
          {topBarActions}
        </>
      }
      vm={vm}
    />
  );
}
