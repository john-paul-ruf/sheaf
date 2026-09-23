/**
 * The live structure a reviewed proposal promotes into (M23; CA-25, CA-30,
 * CA-31; D51, D55, D65): the checkpoint's `formulas` and `charts` roots.
 *
 * Both are built from the proposal's keys and the identities promotion
 * allocated, so what is written is exactly what the review showed:
 *
 * - every **active** formula, translated again under the app's IDs, with
 *   `source: imported` and — for a frozen or unsupported one, whose imported
 *   values stay authored literals — `importedValuePolicy: kept-as-literal`;
 * - every **active** chart as a chart definition (`provenance: imported`),
 *   checked by the one chart validator; a chart it refuses stays the
 *   workbook's snapshot instead. The charts of the first sheet that carries
 *   any rebuilt chart are pinned, in workbook order (D65).
 */

import {
  CATALOG_VERSION,
  irNodesOf,
  type FormulaDefinitionV1,
  type FormulaIRDocumentV1,
  type FormulaTargetV1,
} from "../../domain/formulas/index.js";
import { validateChartDefinition, type ChartDefinitionV1, type ChartSchemaV1, type GroupingV1, type MeasureV1 } from "../../domain/model/charts.js";
import type { FormulaMetadataV1 } from "../../domain/model/events.js";
import { createDomainId, encodeDomainId, type DomainEntropy } from "../../domain/model/ids.js";
import { translateProposedFormula } from "../inference/formulas.js";
import type { ProposedChartV1, ProposedWorkbookV1 } from "../inference/workbook-proposal.js";
import { allocatedFormulaIdentities } from "./formula-identities.js";
import type { AllocatedSchemaV2 } from "./promotion.js";
import type { CheckpointChartV1, CheckpointFormulaV1 } from "./roots.js";

/** Each catalog function the IR calls, once, at its translated version, by name. */
const functionVersionsOf = (document: FormulaIRDocumentV1 | null): FormulaMetadataV1["functionVersions"] => {
  if (document === null) return [];
  const versions = new Map<string, number>();
  for (const node of irNodesOf(document.root)) {
    if (node.kind === "call") versions.set(node.name, node.version);
  }
  return [...versions].sort(([left], [right]) => (left < right ? -1 : 1)).map(([name, version]) => ({ name, version }));
};

/** The `formulas` root of an imported app: every active formula, never a value (invariant 7). */
export function importedFormulasOf(
  proposal: ProposedWorkbookV1,
  schema: Pick<AllocatedSchemaV2, "identities">,
  schemaRevision: bigint,
): readonly CheckpointFormulaV1[] {
  const ids = allocatedFormulaIdentities(schema.identities);
  return proposal.formulas
    .filter((formula) => formula.isActive)
    .map((formula) => {
      const outcome = translateProposedFormula(proposal, formula, ids);
      const target: FormulaTargetV1 =
        formula.target.kind === "computed-column"
          ? { kind: "computed-column", tableId: ids.tableId(formula.target.tableKey), fieldId: ids.fieldId(formula.target.columnKey) }
          : formula.target.kind === "table-metric"
            ? { kind: "table-metric", tableId: ids.tableId(formula.target.tableKey) }
            : { kind: "dashboard-value", tableId: null };
      const definition: FormulaDefinitionV1 = {
        formulaId: ids.formulaId(formula.formulaKey),
        target,
        displayName: formula.target.kind === "computed-column" ? null : (formula.displayName?.normalize("NFC") ?? null),
        originalText: formula.originalText.normalize("NFC"),
        document: outcome.document,
        disposition: outcome.disposition,
        determinism: outcome.determinism,
        dependencies: outcome.dependencies,
      };
      return {
        formula: definition,
        metadata: {
          catalogVersion: CATALOG_VERSION,
          functionVersions: functionVersionsOf(outcome.document),
          source: "imported",
          // D51: a live formula's imported values are never written; the others' stay as literals.
          importedValuePolicy: outcome.disposition === "live" ? "none" : "kept-as-literal",
        },
        isActive: true,
        schemaRevision,
      };
    });
}

/** The fields whose imported values are never written (D51): each live computed column's, by `encodeDomainId`. */
export const liveComputedFieldsOf = (formulas: readonly CheckpointFormulaV1[]): ReadonlySet<string> =>
  new Set(
    formulas.flatMap(({ formula }) =>
      formula.disposition === "live" && formula.target.kind === "computed-column" ? [encodeDomainId(formula.target.fieldId)] : [],
    ),
  );

export interface ImportedChartsV1 {
  readonly charts: readonly CheckpointChartV1[];
  /** Active charts the chart validator refused: they stay the workbook's snapshot. */
  readonly kept: readonly ProposedChartV1[];
}

/** The `charts` root of an imported app (CA-30, CA-31): every active chart that validates. */
export function importedChartsOf(
  entropy: DomainEntropy,
  proposal: ProposedWorkbookV1,
  schema: Pick<AllocatedSchemaV2, "identities" | "tables" | "enumOptions" | "relationships">,
): ImportedChartsV1 {
  const ids = allocatedFormulaIdentities(schema.identities);
  const chartSchema: ChartSchemaV1 = {
    tables: schema.tables.map((plan) => plan.table),
    enumOptions: schema.enumOptions,
    relationships: schema.relationships,
  };
  const valid: { readonly proposed: ProposedChartV1; readonly definition: ChartDefinitionV1 }[] = [];
  const kept: ProposedChartV1[] = [];
  for (const proposed of proposal.charts.filter((chart) => chart.isActive)) {
    const common = {
      chartVersion: 1 as const,
      chartId: createDomainId("chart", entropy),
      name: proposed.name.normalize("NFC"),
      tableId: ids.tableId(proposed.tableKey),
      filters: [],
      pinned: false,
    };
    let definition: ChartDefinitionV1 | null = null;
    if (proposed.type === "scatter") {
      definition = proposed.x === null || proposed.y === null ? null : { ...common, type: "scatter", x: ids.fieldId(proposed.x), y: ids.fieldId(proposed.y) };
    } else if (proposed.groupBy !== null && proposed.measure !== null) {
      const fieldId = ids.fieldId(proposed.groupBy.columnKey);
      const groupBy: GroupingV1 = proposed.groupBy.kind === "date" ? { kind: "date", fieldId, unit: "day" } : { kind: "field", fieldId };
      const measure: MeasureV1 =
        proposed.measure.kind === "count" ? { kind: "count" } : { kind: proposed.measure.kind, fieldId: ids.fieldId(proposed.measure.columnKey) };
      definition = { ...common, type: proposed.type, groupBy, seriesBy: null, measure, sort: "category" };
    }
    if (definition === null || validateChartDefinition(definition, chartSchema).length > 0) kept.push(proposed);
    else valid.push({ proposed, definition });
  }
  // D65: the first sheet, in workbook order, that carries a rebuilt chart is the app's home view.
  const sheetIndexOf = (sheetKey: string): number => proposal.sheets.find((sheet) => sheet.sheetKey === sheetKey)?.sheetIndex ?? Number.MAX_SAFE_INTEGER;
  const pinnedSheet = valid.reduce<string | null>(
    (first, { proposed }) => (first === null || sheetIndexOf(proposed.sheetKey) < sheetIndexOf(first) ? proposed.sheetKey : first),
    null,
  );
  return {
    charts: valid.map(({ proposed, definition }, ordinal) => ({
      definition: { ...definition, pinned: proposed.sheetKey === pinnedSheet },
      ordinal,
      provenance: "imported",
      chartRevision: 0n,
    })),
    kept,
  };
}
