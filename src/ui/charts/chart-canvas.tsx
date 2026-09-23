import { useEffect, useRef, type ReactNode } from "react";
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  ScatterController,
  Tooltip,
  type ChartConfiguration,
} from "chart.js";
import { cx } from "../primitives/class-names.js";
import styles from "./charts.module.css";

/**
 * CTL-074's canvas — the one file in `src/ui/**` that may import Chart.js
 * (architecture § Charts; `tests/unit/ui/architecture.test.ts` asserts it).
 *
 * Chart.js owns drawing and hit-testing, nothing else. Only the controllers,
 * elements and scales the five approved types need are registered, so the
 * rest of the library is never part of the chart. The canvas is
 * `aria-hidden`: every mark is also a button in the visible mark list beside
 * it, and the chart's summary and table are Sheaf's (SHT-017), so a person who
 * cannot see or point at a canvas loses nothing.
 *
 * Colour never carries meaning alone: the legend, the tooltip and the mark
 * list all name the series and category. The palette is read from CSS custom
 * properties at render — the app's accent first, then Violet 600, which
 * design.md reserves for the secondary chart series — so a theme recolours a
 * chart the way it recolours everything else, and no colour is written here.
 * A person who asks for reduced motion gets no animation.
 */

Chart.register(
  BarController,
  LineController,
  PieController,
  ScatterController,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
);

/** What the canvas draws: already in words and numbers, in the chart's order. */
export interface ChartCanvasData {
  readonly type: "bar" | "line" | "pie" | "stacked" | "scatter";
  /** Category names, in order (grouped charts). */
  readonly labels: readonly string[];
  /** One entry per series; a chart with no series has exactly one. */
  readonly series: readonly { readonly label: string; readonly values: readonly (number | null)[] }[];
  /** Scatter only. */
  readonly points: readonly { readonly x: number; readonly y: number }[];
  /** The mark index at (series, category) — or, for a scatter, (0, point). */
  readonly markAt: readonly (readonly (number | null)[])[];
}

/** Series colours, in order: the app accent, then the secondary series colour, then the app's own ink tones. */
export const PALETTE_PROPERTIES = Object.freeze(["--app-accent", "--violet-600", "--app-primary", "--app-ink"] as const);

/**
 * The Chart.js configuration for a dataset: a pure function of the data, the
 * palette and the motion preference, so its choices can be tested without a
 * canvas.
 */
export function chartConfiguration(
  data: ChartCanvasData,
  palette: readonly string[],
  reducedMotion: boolean,
  selected: { readonly series: number; readonly index: number } | null,
): ChartConfiguration {
  const colour = (index: number): string => palette[index % Math.max(palette.length, 1)] ?? "";
  // The selected mark is outlined in the app's ink, so it is not told by hue.
  const outline = palette[3] ?? colour(0);
  const widths = (series: number, base: number): number[] =>
    data.labels.map((_label, index) => (selected !== null && selected.series === series && selected.index === index ? 3 : base));
  const common = {
    responsive: true,
    maintainAspectRatio: false,
    ...(reducedMotion ? { animation: false as const } : {}),
    plugins: { legend: { display: data.series.length > 1 || data.type === "pie" } },
  };
  if (data.type === "scatter") {
    return {
      type: "scatter",
      data: { datasets: [{ label: data.series[0]?.label ?? "", data: data.points.map(({ x, y }) => ({ x, y })), backgroundColor: colour(0) }] },
      options: common,
    };
  }
  if (data.type === "pie") {
    return {
      type: "pie",
      data: {
        labels: [...data.labels],
        datasets: [
          {
            label: data.series[0]?.label ?? "",
            data: [...(data.series[0]?.values ?? [])],
            backgroundColor: data.labels.map((_label, index) => colour(index)),
            borderColor: outline,
            borderWidth: widths(0, 0),
          },
        ],
      },
      options: common,
    };
  }
  if (data.type === "line") {
    return {
      type: "line",
      data: {
        labels: [...data.labels],
        datasets: data.series.map((series, seriesIndex) => ({
          label: series.label,
          data: [...series.values],
          borderColor: colour(seriesIndex),
          backgroundColor: colour(seriesIndex),
          pointBorderColor: outline,
          pointRadius: widths(seriesIndex, 3).map((width) => width + 1),
          pointBorderWidth: widths(seriesIndex, 0),
        })),
      },
      options: common,
    };
  }
  const isStacked = data.type === "stacked";
  return {
    type: "bar",
    data: {
      labels: [...data.labels],
      datasets: data.series.map((series, seriesIndex) => ({
        label: series.label,
        data: [...series.values],
        backgroundColor: colour(seriesIndex),
        borderColor: outline,
        borderWidth: widths(seriesIndex, 0),
      })),
    },
    options: { ...common, scales: { x: { stacked: isStacked }, y: { stacked: isStacked, beginAtZero: true } } },
  };
}

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface ChartCanvasProps {
  readonly data: ChartCanvasData;
  readonly selectedMark: number | null;
  /** A mark was tapped or clicked on the canvas. */
  readonly onMark: (markIndex: number) => void;
}

export function ChartCanvas({ data, selectedMark, onMark }: ChartCanvasProps): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const style = getComputedStyle(canvas);
    const palette = PALETTE_PROPERTIES.map((property) => style.getPropertyValue(property).trim()).filter((value) => value !== "");
    let selected: { series: number; index: number } | null = null;
    data.markAt.forEach((row, series) => {
      row.forEach((mark, index) => {
        if (mark !== null && mark === selectedMark) selected = { series, index };
      });
    });
    const chart = new Chart(canvas, chartConfiguration(data, palette, prefersReducedMotion(), selected));
    chart.options.onClick = (event) => {
      const [hit] = chart.getElementsAtEventForMode(event as unknown as Event, "nearest", { intersect: true }, true);
      const mark = hit === undefined ? null : (data.markAt[hit.datasetIndex]?.[hit.index] ?? null);
      if (mark !== null) onMark(mark);
    };
    return () => {
      chart.destroy();
    };
  }, [data, selectedMark, onMark]);

  return (
    <div className={cx(styles["canvasBox"])} data-chart-canvas={data.type}>
      <canvas aria-hidden="true" ref={canvasRef} />
    </div>
  );
}
