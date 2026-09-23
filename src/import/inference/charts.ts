/**
 * Imported OOXML charts and pivot tables rebuilt as charts (M21; CA-31, D55;
 * CAP-34, FR-5 c, FR-16 e).
 *
 * A chart part is rebuilt only when it maps faithfully:
 *
 * - its plot is a bar/column (clustered → `bar`; stacked or percent-stacked
 *   → `stacked`), line, pie/doughnut or scatter chart;
 * - it has **one** series, and every reference of that series is one column
 *   of the same imported table, over exactly that table's data rows;
 * - its category column can be a category (a choice, reference, yes/no, text
 *   or date — a date grouped by day) and its value column is a number.
 *
 * Repeated categories group, and the measure is the sum of the value column;
 * the chart says so when it matters (`categoriesRepeat`). A pivot table is a
 * bar chart over its source table: first row field → group, first data field
 * with its subtotal → measure. Everything else — an area chart, a combo, a
 * second series, a range across sheets, a refused part with no definition,
 * and every chart of a non-OOXML workbook (no definition either) — stays a
 * snapshot with `chart-not-rebuilt`. The mapping is by key: promotion turns
 * it into a chart definition and checks it again (`validateChartDefinition`).
 */

import { parseFormula, type FormulaReferenceV1 } from "../../domain/formulas/index.js";
import {
  isChartPartDefinition,
  type ChartPartDefinitionV1,
  type PivotPartDefinitionV1,
  type PreservedPartKindV1,
  type RangeV1,
} from "../facts/index.js";
import { workbookStatementIdOf, type WorkbookEvidenceV1 } from "./statements.js";
import { countInert } from "./formulas.js";
import type {
  ProposedChartMeasureV1,
  ProposedChartTypeV1,
  ProposedChartV1,
  ProposedInertItemV1,
  ProposedWorkbookV1,
} from "./workbook-proposal.js";

/** One column a chart may plot, as the proposal types it. */
export interface ChartColumnV1 {
  readonly columnKey: string;
  readonly columnIndex: number;
  /** The heading as the workbook wrote it: a pivot cache names its fields by it. */
  readonly heading: string;
  readonly fieldName: string;
  readonly typeKind: string;
  /** Some value appears on more than one row. */
  readonly repeats: boolean;
}

/** One standalone table a chart may plot, and the rows its data occupies. */
export interface ChartTableV1 {
  readonly tableKey: string;
  readonly tableName: string;
  readonly sheetName: string;
  readonly declaredName: string | null;
  readonly headerRowIndex: number | null;
  readonly firstDataRow: number;
  readonly lastDataRow: number | null;
  readonly columns: readonly ChartColumnV1[];
}

/** The part as a sheet's facts carry it. */
export interface ChartPartV1 {
  readonly sheetKey: string;
  readonly ordinal: number;
  readonly partKind: "chart" | "pivot-table";
  readonly location: string;
  readonly anchor: RangeV1 | null;
  readonly definition: ChartPartDefinitionV1 | PivotPartDefinitionV1 | undefined;
}

const CATEGORY_KINDS: ReadonlySet<string> = new Set(["enum", "reference", "boolean", "text", "phone", "email", "url", "address"]);
const NUMBER_KINDS: ReadonlySet<string> = new Set(["number", "currency"]);

const sameName = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

type Located = { readonly table: ChartTableV1; readonly column: ChartColumnV1 };

/** A reference text's single column of one table, over exactly its data rows. */
function columnOf(
  text: string | null,
  tables: readonly ChartTableV1[],
  definedName: (name: string) => string | null,
  defaultSheet: string | null = null,
  depth = 0,
): Located | null {
  if (text === null) return null;
  const parsed = parseFormula(text);
  if (parsed.kind !== "parsed" || parsed.ast.kind !== "reference") return null;
  const reference: FormulaReferenceV1 = parsed.ast.reference;
  if (reference.kind === "name") {
    const named = depth === 0 ? definedName(reference.name) : null;
    return named === null ? null : columnOf(named, tables, definedName, defaultSheet, depth + 1);
  }
  if (reference.kind !== "area" && reference.kind !== "columns") return null;
  const scope = reference.scope;
  if (scope !== null && (scope.workbook !== null || scope.lastSheet !== null)) return null;
  const sheet = scope?.firstSheet ?? defaultSheet;
  if (sheet === null) return null;
  const [first, last] =
    reference.kind === "area" ? [reference.first.column, reference.last.column] : [reference.firstColumn, reference.lastColumn];
  if (first !== last) return null;
  for (const table of tables) {
    if (!sameName(table.sheetName, sheet) || table.lastDataRow === null) continue;
    const column = table.columns.find((candidate) => candidate.columnIndex === first);
    if (column === undefined) continue;
    if (reference.kind === "columns") return { table, column };
    const low = Math.min(reference.first.row, reference.last.row);
    const high = Math.max(reference.first.row, reference.last.row);
    const startsAtData = low === table.firstDataRow || low === table.firstDataRow - 1;
    return startsAtData && high === table.lastDataRow ? { table, column } : null;
  }
  return null;
}

const titleOf = (measure: ChartColumnV1 | null, group: ChartColumnV1): string => `${measure?.fieldName ?? "Count"} by ${group.fieldName}`;

/** The chart a `c:chart` part maps to, or `null` when it would not be faithful. */
function mapChart(
  part: ChartPartV1,
  definition: ChartPartDefinitionV1,
  tables: readonly ChartTableV1[],
  definedName: (name: string) => string | null,
): ProposedChartV1 | null {
  const [series, ...rest] = definition.series;
  if (series === undefined || rest.length > 0) return null;
  const common = {
    chartKey: `${part.sheetKey}.chart${String(part.ordinal)}`,
    sheetKey: part.sheetKey,
    partKind: part.partKind,
    location: part.location,
    anchor: part.anchor,
    isActive: true,
  };
  if (definition.chartType === "scatter") {
    const x = columnOf(series.xRef, tables, definedName);
    const y = columnOf(series.yRef, tables, definedName);
    if (x === null || y === null || x.table !== y.table) return null;
    if (!NUMBER_KINDS.has(x.column.typeKind) || !NUMBER_KINDS.has(y.column.typeKind)) return null;
    return {
      ...common,
      name: definition.title ?? `${y.column.fieldName} by ${x.column.fieldName}`,
      type: "scatter",
      tableKey: x.table.tableKey,
      groupBy: null,
      measure: null,
      x: x.column.columnKey,
      y: y.column.columnKey,
      categoriesRepeat: false,
    };
  }
  const type: ProposedChartTypeV1 | null =
    definition.chartType === "bar"
      ? definition.grouping === "stacked" || definition.grouping === "percentStacked"
        ? "stacked"
        : "bar"
      : definition.chartType === "line" || definition.chartType === "pie"
        ? definition.chartType
        : null;
  if (type === null) return null;
  const category = columnOf(series.categoriesRef, tables, definedName);
  const value = columnOf(series.valuesRef, tables, definedName);
  if (category === null || value === null || category.table !== value.table) return null;
  const groupKind = category.column.typeKind === "date" ? "date" : CATEGORY_KINDS.has(category.column.typeKind) ? "field" : null;
  if (groupKind === null || !NUMBER_KINDS.has(value.column.typeKind)) return null;
  return {
    ...common,
    name: definition.title ?? titleOf(value.column, category.column),
    type,
    tableKey: category.table.tableKey,
    groupBy: { kind: groupKind, columnKey: category.column.columnKey },
    measure: { kind: "sum", columnKey: value.column.columnKey },
    x: null,
    y: null,
    categoriesRepeat: category.column.repeats,
  };
}

/** The source table of a pivot: a range on its sheet, or a table or defined name. */
function pivotTableOf(
  definition: PivotPartDefinitionV1,
  tables: readonly ChartTableV1[],
  definedName: (name: string) => string | null,
): ChartTableV1 | null {
  let sheet = definition.sourceSheet;
  let ref: string | null = definition.sourceRef;
  if (sheet === null) {
    const declared = tables.find((table) => table.declaredName !== null && sameName(table.declaredName, definition.sourceRef));
    if (declared !== undefined) return declared;
    ref = definedName(definition.sourceRef);
  }
  const parsed = ref === null ? null : parseFormula(ref);
  if (parsed?.kind !== "parsed" || parsed.ast.kind !== "reference") return null;
  const reference = parsed.ast.reference;
  if (reference.kind !== "area") return null;
  if (reference.scope !== null) {
    if (reference.scope.workbook !== null || reference.scope.lastSheet !== null) return null;
    sheet = reference.scope.firstSheet;
  }
  if (sheet === null) return null;
  const low = Math.min(reference.first.row, reference.last.row);
  const high = Math.max(reference.first.row, reference.last.row);
  const left = Math.min(reference.first.column, reference.last.column);
  const right = Math.max(reference.first.column, reference.last.column);
  return (
    tables.find(
      (table) =>
        sameName(table.sheetName, sheet) &&
        table.headerRowIndex === low &&
        table.lastDataRow === high &&
        table.columns.some((column) => column.columnIndex === left) &&
        table.columns.some((column) => column.columnIndex === right),
    ) ?? null
  );
}

/** The bar chart a pivot table maps to, or `null`. */
function mapPivot(
  part: ChartPartV1,
  definition: PivotPartDefinitionV1,
  tables: readonly ChartTableV1[],
  definedName: (name: string) => string | null,
): ProposedChartV1 | null {
  const table = pivotTableOf(definition, tables, definedName);
  const [rowField] = definition.rowFields;
  const [dataField] = definition.dataFields;
  if (table === null || rowField === undefined || dataField === undefined) return null;
  const byHeading = (name: string): ChartColumnV1 | undefined => table.columns.find((column) => sameName(column.heading, name));
  const group = byHeading(rowField);
  if (group === undefined) return null;
  const groupKind = group.typeKind === "date" ? "date" : CATEGORY_KINDS.has(group.typeKind) ? "field" : null;
  if (groupKind === null) return null;
  let measure: ProposedChartMeasureV1;
  let measured: ChartColumnV1 | null = null;
  if (dataField.subtotal === "count") {
    measure = { kind: "count" };
  } else {
    const column = byHeading(dataField.cacheFieldName);
    if (column === undefined || !NUMBER_KINDS.has(column.typeKind)) return null;
    measure = { kind: dataField.subtotal, columnKey: column.columnKey };
    measured = column;
  }
  return {
    chartKey: `${part.sheetKey}.chart${String(part.ordinal)}`,
    sheetKey: part.sheetKey,
    partKind: part.partKind,
    location: part.location,
    anchor: part.anchor,
    name: titleOf(measured, group),
    type: "bar",
    tableKey: table.tableKey,
    groupBy: { kind: groupKind, columnKey: group.columnKey },
    measure,
    x: null,
    y: null,
    categoriesRepeat: group.repeats,
    isActive: true,
  };
}

/** What one chart or pivot part becomes: a proposed chart, or `null` (kept as a snapshot). */
export function mapChartPart(
  part: ChartPartV1,
  tables: readonly ChartTableV1[],
  definedName: (name: string) => string | null,
): ProposedChartV1 | null {
  if (part.definition === undefined) return null;
  return isChartPartDefinition(part.definition)
    ? part.partKind === "chart"
      ? mapChart(part, part.definition, tables, definedName)
      : null
    : part.partKind === "pivot-table"
      ? mapPivot(part, part.definition, tables, definedName)
      : null;
}

/** The kinds a chart snapshot is filed under. */
export const CHART_PART_KINDS: ReadonlySet<PreservedPartKindV1> = new Set(["chart", "pivot-table", "sparkline"]);

/** The review's evidence of what a chart became, in the proposal's current names. */
export function chartMappingEvidence(proposal: ProposedWorkbookV1, chart: ProposedChartV1): WorkbookEvidenceV1 {
  const table = proposal.tables.find((candidate) => candidate.tableKey === chart.tableKey);
  const nameOf = (columnKey: string | null): string | null =>
    columnKey === null ? null : (table?.fields.find((field) => field.columnKey === columnKey)?.fieldName ?? null);
  return {
    kind: "chart-mapping",
    chartType: chart.type,
    chartName: chart.name,
    tableName: table?.tableName ?? "",
    groupFieldName: nameOf(chart.groupBy?.columnKey ?? null),
    measure: chart.measure?.kind ?? null,
    measureFieldName: chart.measure === null || chart.measure.kind === "count" ? null : nameOf(chart.measure.columnKey),
    xFieldName: nameOf(chart.x),
    yFieldName: nameOf(chart.y),
    categoriesRepeat: chart.categoriesRepeat,
  };
}

/**
 * The review surface a proposal's charts imply: each chart statement's
 * mapping evidence in current names, and a snapshot item for a declined one.
 * Pure and idempotent; every applied review edit runs it.
 */
export function deriveChartSurface(proposal: ProposedWorkbookV1): ProposedWorkbookV1 {
  if (proposal.charts.length === 0) return proposal;
  const byStatement = new Map(proposal.charts.map((chart) => [workbookStatementIdOf("chart", chart.chartKey), chart]));
  const statements = proposal.statements.map((statement) => {
    const chart = byStatement.get(statement.statementId);
    return chart === undefined
      ? statement
      : {
          ...statement,
          evidence: [
            ...statement.evidence.filter((evidence) => evidence.kind !== "chart-mapping"),
            chartMappingEvidence(proposal, chart),
          ],
        };
  });
  const owned = new Set(proposal.charts.map((chart) => `${chart.sheetKey}|${chart.location}`));
  const inertItems: ProposedInertItemV1[] = [
    ...proposal.inertItems.filter((item) => !CHART_PART_KINDS.has(item.kind) || !owned.has(`${item.sheetKey}|${item.location}`)),
    ...proposal.charts.flatMap((chart) =>
      chart.isActive
        ? []
        : [{ kind: chart.partKind, sheetKey: chart.sheetKey, location: chart.location, reasonKey: "chart-not-rebuilt" as const, anchor: chart.anchor }],
    ),
  ];
  return { ...proposal, statements, inertItems, inertCounts: countInert(inertItems) };
}
