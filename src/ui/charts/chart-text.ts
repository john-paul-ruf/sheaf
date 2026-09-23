import type {
  ChartCategoryVm,
  ChartFieldTypeVm,
  ChartDetailVm,
  ChartMarkVm,
  ChartMeasureVm,
} from "../../application/view-models/records.js";
import { describeRecordCount, formatCount, formatCurrency, formatEpochDay } from "../records/values.js";
import type { ChartCanvasData } from "./chart-canvas.js";

/**
 * A chart in words (SHT-017, STA-015, SCR-033): the page composes every
 * sentence from the dataset's facts, with the design's own patterns —
 * "In progress is highest at $184,000; on hold is lowest at $76,000"
 * (chart-detail.html), "Showing all 12,482 local rows", and D62's named
 * sample, "Chart uses the newest {n} of {total} local rows on this device".
 * Numbers and dates are formatted here, in the reader's locale; the view
 * model holds none.
 */

const MS_PER_DAY = 86_400_000;
const month = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

export const CHART_TYPE_NAMES: Readonly<Record<ChartDetailVm["type"], string>> = Object.freeze({
  bar: "Bar",
  line: "Line",
  pie: "Pie",
  scatter: "Scatter",
  stacked: "Stacked bar",
});

/** A category or series in words. Absent buckets use the records surface's own words. */
export function describeCategory(category: ChartCategoryVm): string {
  switch (category.kind) {
    case "text":
      return category.text;
    case "boolean":
      return category.value ? "Yes" : "No";
    case "date":
      return category.unit === "day"
        ? formatEpochDay(category.epochDay)
        : category.unit === "month"
          ? month.format(new Date(category.epochDay * MS_PER_DAY))
          : String(new Date(category.epochDay * MS_PER_DAY).getUTCFullYear());
    case "absent":
      return "Not given";
    case "unreadable":
      return "Needs attention";
    default: {
      const unreachable: never = category;
      return unreachable;
    }
  }
}

/** A number as its field reads: a currency amount in its currency, anything else as written. */
export function describeNumber(decimal: string, type: ChartFieldTypeVm | null): string {
  return type?.kind === "currency" ? formatCurrency(decimal, type.currencyCode) : decimal;
}

/** A mark's value: a count of records, or the measure in its field's terms. */
export function describeMarkValue(value: string | null, measure: ChartMeasureVm): string {
  if (value === null) return "Not given";
  if (measure.kind === "count") return describeRecordCount(Number(value));
  // A count of records is whole; an average may not be, and is shown exactly.
  return describeNumber(value, measure.kind === "average" && measure.fieldType?.kind !== "currency" ? null : measure.fieldType);
}

/** A mark's name: its category, and its series when it has one. */
export function describeMark(mark: ChartMarkVm): string {
  if (mark.kind === "point") return `${mark.x}, ${mark.y}`;
  return mark.series === null ? describeCategory(mark.category) : `${describeCategory(mark.category)} · ${describeCategory(mark.series)}`;
}

/** The measure's own name, for a table column and a value's meaning. */
export function describeMeasure(measure: ChartMeasureVm): string {
  switch (measure.kind) {
    case "count":
      return "Records";
    case "sum":
      return measure.fieldName;
    case "average":
      return `Average ${measure.fieldName}`;
    case "min":
      return `Lowest ${measure.fieldName}`;
    case "max":
      return `Highest ${measure.fieldName}`;
    default: {
      const unreachable: never = measure;
      return unreachable;
    }
  }
}

/**
 * The text summary: chart-detail.html's "{highest} is highest at {value};
 * {lowest} is lowest at {value}." A scatter names its y axis's extremes.
 */
export function describeSummary(vm: ChartDetailVm): string {
  const { highest, lowest } = vm.summary;
  if (highest === null || lowest === null) return "No record has a value to chart.";
  if (highest.kind === "point" && lowest.kind === "point" && vm.axes !== null) {
    return `${vm.axes.y} is highest at ${describeNumber(highest.y, vm.axes.yType)}; lowest at ${describeNumber(lowest.y, vm.axes.yType)}.`;
  }
  if (highest.kind !== "group" || lowest.kind !== "group") return "No record has a value to chart.";
  return `${describeMark(highest)} is highest at ${describeMarkValue(highest.value, vm.measure)}; ${describeMark(lowest)} is lowest at ${describeMarkValue(lowest.value, vm.measure)}.`;
}

/**
 * STA-015's scope, as the design's patterns say it: every row, or the named
 * sample (D62, verbatim); then any categories or points left undrawn, named.
 */
export function describeScope(vm: ChartDetailVm): readonly string[] {
  const lines = [
    vm.scope.kind === "all"
      ? vm.scope.rows === 1
        ? "Showing the 1 local row"
        : `Showing all ${formatCount(vm.scope.rows)} local rows`
      : `Chart uses the newest ${formatCount(vm.scope.rows)} of ${formatCount(vm.scope.total)} local rows on this device`,
  ];
  if (vm.scope.drawn < vm.scope.categories) {
    lines.push(`Showing ${formatCount(vm.scope.drawn)} of ${formatCount(vm.scope.categories)} ${vm.type === "scatter" ? "points" : "categories"}`);
  }
  if (vm.scope.unplotted > 0) {
    lines.push(`Showing ${formatCount(vm.scope.categories)} of ${formatCount(vm.scope.categories + vm.scope.unplotted)} rows`);
  }
  return lines;
}

/** The group's accessible name: "Bar chart: {name}. {summary}" (chart-detail.html). */
export function describeChartGroup(vm: ChartDetailVm): string {
  return `${CHART_TYPE_NAMES[vm.type]} chart: ${vm.name}. ${describeSummary(vm)}`;
}

/** The drawn marks as the canvas takes them: categories by series, or points. */
export function canvasDataOf(vm: ChartDetailVm): ChartCanvasData {
  if (vm.type === "scatter") {
    const points = vm.marks.filter((mark) => mark.kind === "point");
    return {
      type: "scatter",
      labels: [],
      series: [{ label: vm.axes === null ? vm.name : `${vm.axes.x} × ${vm.axes.y}`, values: [] }],
      points: points.map((mark) => ({ x: Number(mark.x), y: Number(mark.y) })),
      markAt: [points.map((mark) => mark.index)],
    };
  }
  const groups = vm.marks.filter((mark) => mark.kind === "group");
  const labels = [...new Set(groups.map((mark) => describeCategory(mark.category)))];
  const seriesNames = [...new Set(groups.map((mark) => (mark.series === null ? describeMeasure(vm.measure) : describeCategory(mark.series))))];
  const at = (series: string, label: string) =>
    groups.find(
      (mark) =>
        describeCategory(mark.category) === label &&
        (mark.series === null ? describeMeasure(vm.measure) : describeCategory(mark.series)) === series,
    );
  return {
    type: vm.type,
    labels,
    series: seriesNames.map((series) => ({
      label: series,
      values: labels.map((label) => {
        const value = at(series, label)?.value;
        return value === undefined || value === null ? null : Number(value);
      }),
    })),
    points: [],
    markAt: seriesNames.map((series) => labels.map((label) => at(series, label)?.index ?? null)),
  };
}
