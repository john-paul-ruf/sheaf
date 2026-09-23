/**
 * The chart commands (M34; CAP-33, CA-30): save, delete, and pin — each one
 * authored commit through the same entrance every other write uses
 * (invariant 1: the caller hears `saved` only after the encrypted commit).
 *
 * The order inside each is the contract:
 *
 * 1. **Judge against the real current state.** The definition is checked by
 *    S01's `validateChartDefinition` against the schema the projection holds
 *    now; a refusal is a typed result and nothing is written.
 * 2. **Guard the revision.** A builder that opened revision N may only write
 *    N+1: `chart_revision` is the stale-builder guard, so an edit made against
 *    a chart that moved underneath it comes back `stale-chart` with the
 *    revision it would have to start from — never a silent overwrite.
 * 3. **Commit, then apply.** `commitEvents` is the one path: the repository
 *    resolves once the transaction is durable, the projection follows.
 *
 * A chart is not schema: its commit leaves the schema revision where it was,
 * and no formula recalculates.
 */

import type { ChartDefinitionV1, ChartRefusalV1, ChartSchemaV1 } from "../../domain/model/charts.js";
import { validateChartDefinition } from "../../domain/model/charts.js";
import type { ChartStateV1, Sha256V1 } from "../../domain/model/events.js";
import { createDomainId, encodeDomainId, type ChartId } from "../../domain/model/ids.js";
import type { TableDefV1 } from "../../domain/model/schema.js";
import type { CommitReceiptV1 } from "../ports/event-repository.js";
import type { ProjectionChartV1, ProjectionEnginePort } from "../ports/projection.js";
import type { AuthoredEventDraftV1 } from "./build-commit.js";
import { commitEvents, liveRecordCount, type CommandDependenciesV1 } from "./execute-command.js";

/** A definition before it has an identity: the chart ID is the command's to mint. */
export type ChartBodyV1 = ChartDefinitionV1 extends infer Definition
  ? Definition extends unknown
    ? Omit<Definition, "chartId">
    : never
  : never;

export interface ChartCommandDependenciesV1
  extends Pick<CommandDependenciesV1, "clock" | "entropy" | "projection" | "repository"> {
  /** SHA-256 of a definition's canonical bytes (M23's codec + M08, in the worker). */
  readonly definitionDigest: (definition: ChartDefinitionV1) => Promise<Sha256V1>;
}

export type ChartCommandResultV1 =
  /** Durable. `commit` is null only for a pin that already stood (nothing moved). */
  | {
      readonly outcome: "saved";
      readonly chart: ProjectionChartV1;
      readonly commit: CommitReceiptV1 | null;
    }
  | { readonly outcome: "deleted"; readonly chartId: ChartId; readonly commit: CommitReceiptV1 }
  /** Someone saved this chart after the builder read it; nothing was written. */
  | { readonly outcome: "stale-chart"; readonly chartRevision: bigint }
  | { readonly outcome: "refused"; readonly refusals: readonly ChartRefusalV1[] }
  | { readonly outcome: "unknown-chart" };

export interface SaveChartRequestV1 {
  /** Null saves a new chart. */
  readonly existing: { readonly chartId: ChartId; readonly expectedRevision: bigint } | null;
  readonly body: ChartBodyV1;
}

/** The schema a definition is judged against, as the projection holds it now. */
export function readChartSchema(projection: ProjectionEnginePort): ChartSchemaV1 {
  const tables: TableDefV1[] = projection
    .execute({ kind: "list-tables" })
    .map((table) => ({ ...table, fields: projection.execute({ kind: "list-fields", tableId: table.tableId }) }));
  return {
    tables,
    enumOptions: tables.flatMap((table) =>
      table.fields
        .filter((field) => field.type.kind === "enum")
        .flatMap((field) => projection.execute({ kind: "list-enum-options", fieldId: field.fieldId })),
    ),
    relationships: projection
      .execute({ kind: "list-relationships", tableId: null })
      .map(({ relationship }) => relationship),
  };
}

const chartById = (projection: ProjectionEnginePort, chartId: ChartId): ProjectionChartV1 | undefined =>
  projection
    .execute({ kind: "list-charts" })
    .find((chart) => encodeDomainId(chart.definition.chartId) === encodeDomainId(chartId));

/** The next free display position: one past the last, or the first. */
const nextOrdinal = (projection: ProjectionEnginePort): number =>
  projection.execute({ kind: "list-charts" }).reduce((next, chart) => Math.max(next, chart.ordinal + 1), 0);

export async function saveChart(
  deps: ChartCommandDependenciesV1,
  request: SaveChartRequestV1,
): Promise<ChartCommandResultV1> {
  let existing: ProjectionChartV1 | null = null;
  if (request.existing !== null) {
    const found = chartById(deps.projection, request.existing.chartId);
    if (found === undefined) return { outcome: "unknown-chart" };
    if (found.chartRevision !== request.existing.expectedRevision) {
      return { outcome: "stale-chart", chartRevision: found.chartRevision };
    }
    existing = found;
  }
  const chartId = request.existing?.chartId ?? createDomainId("chart", deps.entropy);
  const definition = { ...request.body, chartId } as ChartDefinitionV1;
  const refusals = validateChartDefinition(definition, readChartSchema(deps.projection));
  if (refusals.length > 0) return { outcome: "refused", refusals };
  return commitSave(deps, existing, definition);
}

/** One `chart.saved`: a new chart at the next ordinal, or the next revision of one. */
async function commitSave(
  deps: ChartCommandDependenciesV1,
  existing: ProjectionChartV1 | null,
  definition: ChartDefinitionV1,
): Promise<ChartCommandResultV1> {
  const chart: ProjectionChartV1 =
    existing === null
      ? {
          definition,
          displayName: definition.name,
          pinned: definition.pinned,
          ordinal: nextOrdinal(deps.projection),
          provenance: "user",
          chartRevision: 0n,
        }
      : {
          ...existing,
          definition,
          displayName: definition.name,
          pinned: definition.pinned,
          chartRevision: existing.chartRevision + 1n,
        };
  const priorSha256 = existing === null ? null : await deps.definitionDigest(existing.definition);
  const commit = await commitChart(deps, chart, {
    kind: "chart.saved",
    payload: { ...chart, chartId: definition.chartId, priorSha256 },
  });
  return { outcome: "saved", chart, commit };
}

/** MOD-013's and the index's pin toggle: a save of the same definition, pin flipped. */
export async function setChartPin(
  deps: ChartCommandDependenciesV1,
  request: { readonly chartId: ChartId; readonly expectedRevision: bigint; readonly pinned: boolean },
): Promise<ChartCommandResultV1> {
  const existing = chartById(deps.projection, request.chartId);
  if (existing === undefined) return { outcome: "unknown-chart" };
  if (existing.chartRevision !== request.expectedRevision) {
    return { outcome: "stale-chart", chartRevision: existing.chartRevision };
  }
  if (existing.pinned === request.pinned) {
    // Already so. An event here would record a change that never happened.
    return { outcome: "saved", chart: existing, commit: null };
  }
  // The chart draws what it drew before; only where it shows moves.
  return commitSave(deps, existing, { ...existing.definition, pinned: request.pinned });
}

export async function deleteChart(
  deps: ChartCommandDependenciesV1,
  request: { readonly chartId: ChartId; readonly expectedRevision: bigint },
): Promise<ChartCommandResultV1> {
  const existing = chartById(deps.projection, request.chartId);
  if (existing === undefined) return { outcome: "unknown-chart" };
  if (existing.chartRevision !== request.expectedRevision) {
    return { outcome: "stale-chart", chartRevision: existing.chartRevision };
  }
  const prior: ChartStateV1 = existing;
  const commit = await commitChart(deps, existing, {
    kind: "chart.deleted",
    payload: { chartId: request.chartId, prior },
  });
  return { outcome: "deleted", chartId: request.chartId, commit };
}

async function commitChart(
  deps: ChartCommandDependenciesV1,
  chart: ProjectionChartV1,
  event: AuthoredEventDraftV1["event"],
): Promise<CommitReceiptV1> {
  const committed = await commitEvents(
    deps,
    [{ subject: { tableId: chart.definition.tableId, objectId: chart.definition.chartId }, event }],
    { rowCountAfter: liveRecordCount(deps.projection) },
  );
  return committed.commit;
}
