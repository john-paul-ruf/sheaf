/**
 * One chart part's declared shape, read and never interpreted (M15; CA-31,
 * D55).
 *
 * The part is streamed through the bounded tokenizer once, down to the end of
 * `c:chart`. The first plot in `c:plotArea` names the chart type; a part with
 * more than one plot (a combo) is `other`. Each `c:ser` gives its name and the
 * formula text of its category, value, and scatter x/y references — cached
 * points are never read. Whether any of it can become a live chart is S07's
 * decision, not this reader's.
 *
 * A part over its bounds, without a plot, or refused by the XML reader (a
 * DTD, a far-too-deep tree) yields no definition and says why: the chart fact
 * stays preserved exactly as F03 emitted it.
 */

import {
  CHART_GROUPINGS,
  CHART_PART_MAX_REF_LENGTH,
  CHART_PART_MAX_SERIES,
  CHART_PART_MAX_TITLE_LENGTH,
  type ChartGroupingV1,
  type ChartPartDefinitionV1,
  type ChartPartSeriesV1,
  type ChartPartTypeV1,
} from "../../facts/index.js";
import { isBoundExceeded, type UnreadableDetailV1 } from "../../source/bounds.js";
import { tokenizeXml } from "../../source/xml.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import { attribute, CHART_NAMESPACES } from "./parts.js";

/**
 * Why a chart or pivot part that exists carries no definition: it declares
 * none, it is over its bounds, its pivot cache is not a worksheet range, or
 * the XML reader refused it.
 */
export type PartDefinitionRefusalV1 = "not-declared" | "over-bounds" | "unsupported-source" | UnreadableDetailV1;

export type PartDefinitionReadV1<T> =
  | { readonly definition: T; readonly refusal: null }
  | { readonly definition: null; readonly refusal: PartDefinitionRefusalV1 };

export const refusedDefinition = (refusal: PartDefinitionRefusalV1) => ({ definition: null, refusal }) as const;

const DRAWINGML_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/drawingml/2006/main",
  "http://purl.oclc.org/ooxml/drawingml/main",
]);

const PLOT_TYPES: ReadonlyMap<string, ChartPartTypeV1> = new Map([
  ["barChart", "bar"],
  ["bar3DChart", "bar"],
  ["lineChart", "line"],
  ["line3DChart", "line"],
  ["pieChart", "pie"],
  ["pie3DChart", "pie"],
  ["doughnutChart", "pie"],
  ["scatterChart", "scatter"],
  ["areaChart", "area"],
  ["area3DChart", "area"],
]);

/** Every `c:plotArea` child that is a plot rather than an axis or layout. */
const isPlot = (local: string): boolean => local.endsWith("Chart");

const SERIES_SLOTS: ReadonlyMap<string, keyof ChartPartSeriesV1> = new Map([
  ["tx", "name"],
  ["cat", "categoriesRef"],
  ["val", "valuesRef"],
  ["xVal", "xRef"],
  ["yVal", "yRef"],
]);

const EMPTY_SERIES: ChartPartSeriesV1 = Object.freeze({
  name: null,
  categoriesRef: null,
  valuesRef: null,
  xRef: null,
  yRef: null,
});

/** UTF-16 units of title text kept before NFC and the code-point cap. */
const TITLE_READ_LIMIT = CHART_PART_MAX_TITLE_LENGTH * 4;

class OverBounds extends Error {}

const groupingOf = (value: string | null, fallback: ChartGroupingV1): ChartGroupingV1 | null =>
  value === null ? fallback : (CHART_GROUPINGS.find((grouping) => grouping === value) ?? null);

const titleOf = (raw: string): string | null => {
  const text = raw.normalize("NFC");
  return text.trim() === "" ? null : Array.from(text).slice(0, CHART_PART_MAX_TITLE_LENGTH).join("");
};

async function readChart(zip: ZipContainerHandleV1, partPath: string): Promise<PartDefinitionReadV1<ChartPartDefinitionV1>> {
  /** Open elements; `null` for anything outside the chart namespace. */
  const path: (string | null)[] = [];
  const isAt = (...locals: string[]): boolean => locals.every((local, depth) => path[depth] === local);

  let plotCount = 0;
  let plotType: ChartPartTypeV1 = "other";
  let barDirection: "bar" | "col" | null = null;
  let grouping: ChartGroupingV1 | null = null;
  const series: ChartPartSeriesV1[] = [];
  let current: { -readonly [K in keyof ChartPartSeriesV1]: ChartPartSeriesV1[K] } | null = null;
  let slot: keyof ChartPartSeriesV1 | null = null;
  let capture: "f" | "v" | "title" | null = null;
  let captured = "";
  let title = "";
  let titleParagraphs = 0;

  for await (const event of tokenizeXml(zip.streamEntry(partPath))) {
    if (event.kind === "start") {
      const local = CHART_NAMESPACES.has(event.uri) ? event.local : null;
      const depth = path.length;
      path.push(local);
      if (depth === 0 && local !== "chartSpace") return refusedDefinition("not-declared");
      if (local === null) {
        if (DRAWINGML_NAMESPACES.has(event.uri) && isAt("chartSpace", "chart", "title", "tx", "rich")) {
          if (event.local === "p") {
            if (titleParagraphs > 0) title += "\n";
            titleParagraphs += 1;
          } else if (event.local === "t") {
            capture = "title";
          }
        }
        continue;
      }
      const isInPlot = depth === 4 && isAt("chartSpace", "chart", "plotArea") && isPlot(path[3] ?? "");
      if (depth === 3 && isAt("chartSpace", "chart", "plotArea") && isPlot(local)) {
        plotCount += 1;
        plotType = plotCount === 1 ? (PLOT_TYPES.get(local) ?? "other") : "other";
      } else if (isInPlot && local === "ser") {
        if (series.length === CHART_PART_MAX_SERIES) return refusedDefinition("over-bounds");
        current = { ...EMPTY_SERIES };
      } else if (isInPlot && plotCount === 1 && local === "barDir") {
        const value = attribute(event, "val") ?? "col";
        barDirection = value === "bar" || value === "col" ? value : null;
      } else if (isInPlot && plotCount === 1 && local === "grouping") {
        const isBar = path[3] === "barChart" || path[3] === "bar3DChart";
        grouping = groupingOf(attribute(event, "val"), isBar ? "clustered" : "standard");
      } else if (depth === 5 && current !== null) {
        slot = SERIES_SLOTS.get(local) ?? null;
      } else if (slot !== null && local === "f") {
        capture = "f";
      } else if (slot === "name" && depth === 6 && local === "v") {
        capture = "v";
      }
    } else if (event.kind === "text") {
      if (capture === null) continue;
      captured += event.value;
      if (captured.length > CHART_PART_MAX_REF_LENGTH) {
        if (capture !== "title") throw new OverBounds();
        captured = captured.slice(0, CHART_PART_MAX_REF_LENGTH);
      }
    } else {
      const local = path.pop();
      if (capture === "title" && event.local === "t") {
        if (title.length < TITLE_READ_LIMIT) title += captured.slice(0, TITLE_READ_LIMIT);
      } else if (capture !== null && current !== null && slot !== null) {
        if (local === "f" || current[slot] === null) current[slot] = captured.normalize("NFC");
      }
      if (capture !== null) {
        capture = null;
        captured = "";
      }
      if (path.length === 5 && current !== null) slot = null;
      else if (path.length === 4 && local === "ser" && current !== null) {
        series.push(current);
        current = null;
      } else if (path.length === 1 && local === "chart") break;
    }
  }
  if (plotCount === 0) return refusedDefinition("not-declared");
  return {
    definition: {
      chartType: plotType,
      barDirection: plotType === "bar" ? barDirection : null,
      grouping: plotType === "other" ? null : grouping,
      title: titleOf(title),
      series,
    },
    refusal: null,
  };
}

/** The declared definition of one chart part, or why it has none. */
export async function readChartDefinition(
  zip: ZipContainerHandleV1,
  partPath: string,
): Promise<PartDefinitionReadV1<ChartPartDefinitionV1>> {
  try {
    return await readChart(zip, partPath);
  } catch (error) {
    if (error instanceof OverBounds) return refusedDefinition("over-bounds");
    if (isBoundExceeded(error)) return refusedDefinition(error.detail);
    throw error;
  }
}
