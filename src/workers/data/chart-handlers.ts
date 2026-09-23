/**
 * The chart RPCs of an open app (M33; CAP-32/33, CA-30, D61).
 *
 * Thin, like the record and structure handlers beside them: the wire is
 * translated to M34's request at this boundary and every decision is the
 * command's. The worker supplies what the application layer may not reach
 * itself — the digest of a definition's canonical bytes (M23's codec, M08's
 * hash) — and owns the one thing that is not a command at all: the chart
 * **draft**, which D61 makes encrypted operational state in the catalog,
 * never an authored event. A draft is sealed with the catalog like
 * `lastOpenedAtEpochMs`, and discarding it leaves no trace in history.
 *
 * A refusal is a typed result (D23); an error that escapes is redacted to its
 * kind (CA-04) — no chart name or filter value crosses in an error.
 */

import { encodeBase64Url } from "../../domain/model/bytes.js";
import type { ChartDefinitionV1, GroupingV1, MeasureV1 } from "../../domain/model/charts.js";
import type { FilterV1 } from "../../domain/model/filters.js";
import { createDomainId, decodeDomainId, encodeDomainId, type ChartId, type DomainIdKind } from "../../domain/model/ids.js";
import {
  deleteChart,
  saveChart,
  setChartPin,
  type ChartBodyV1,
  type ChartCommandDependenciesV1,
  type ChartCommandResultV1,
} from "../../application/commands/chart-commands.js";
import type { ClockPort } from "../../application/ports/clock.js";
import type { EntropyPort } from "../../application/ports/entropy.js";
import type { ProjectionChartV1 } from "../../application/ports/projection.js";
import { sha256 } from "../../crypto/hash.js";
import { decodeChartDefinition, encodeChartDefinition } from "../../import/staging/roots.js";
import { asMap, cborMap, count, exactKeys, field } from "../../import/staging/proposal-codec.js";
import { decodeCanonical, encodeCanonical } from "../../persistence/codecs/canonical-cbor.js";
import type {
  ChartCommandOutcomeWireV1,
  ChartDefinitionWireV1,
  ChartDraftViewV1,
  ChartGroupingWireV1,
  ChartMeasureWireV1,
  ChartViewV1,
  DataWorkerResponseV1,
  DeleteChartRequestV1,
  DiscardChartDraftRequestV1,
  FilterWireV1,
  GetChartDraftRequestV1,
  GetChartRequestV1,
  ListChartsRequestV1,
  SaveChartDraftRequestV1,
  SaveChartRequestV1,
  SetChartPinRequestV1,
} from "../protocol/messages.js";
import { DataWorkerCommandError } from "../protocol/redact.js";
import type { AppSessionV1 } from "./app-session.js";
import type { LocalCatalogAppEntryV1, LocalCatalogV1 } from "./catalog.js";
import type { WorkerSessionContextV1 } from "./event-store.js";
import { toDomainFilter } from "./record-handlers.js";

export interface ChartHandlerDependenciesV1 {
  readonly clock: ClockPort;
  readonly entropy: EntropyPort;
  /** The open session of a catalog app, hydrating it if needed. */
  readonly appSession: (appId: string) => Promise<AppSessionV1 | undefined>;
  /** Drops a session whose projection a failed commit disposed. */
  readonly closeAppSession: (appId: string) => void;
  readonly getContext: () => WorkerSessionContextV1;
  /** Reseals the catalog for an operational write (the draft). */
  readonly commitCatalog: (next: LocalCatalogV1) => Promise<void>;
}

export interface ChartHandlersV1 {
  listCharts(request: ListChartsRequestV1): Promise<DataWorkerResponseV1>;
  getChart(request: GetChartRequestV1): Promise<DataWorkerResponseV1>;
  saveChart(request: SaveChartRequestV1): Promise<DataWorkerResponseV1>;
  setChartPin(request: SetChartPinRequestV1): Promise<DataWorkerResponseV1>;
  deleteChart(request: DeleteChartRequestV1): Promise<DataWorkerResponseV1>;
  getChartDraft(request: GetChartDraftRequestV1): Promise<DataWorkerResponseV1>;
  saveChartDraft(request: SaveChartDraftRequestV1): Promise<DataWorkerResponseV1>;
  discardChartDraft(request: DiscardChartDraftRequestV1): Promise<DataWorkerResponseV1>;
}

export function createChartHandlers(deps: ChartHandlerDependenciesV1): ChartHandlersV1 {
  const commandDeps = (session: AppSessionV1): ChartCommandDependenciesV1 => ({
    clock: deps.clock,
    entropy: deps.entropy,
    projection: session.projection,
    repository: session.repository,
    definitionDigest: (definition) => sha256(encodeCanonical(encodeChartDefinition(definition))),
  });

  /** Runs one chart command; a failure after the commit re-hydrates next time. */
  async function command(
    appId: string,
    run: (deps: ChartCommandDependenciesV1) => Promise<ChartCommandResultV1>,
  ): Promise<ChartCommandOutcomeWireV1> {
    const session = await deps.appSession(appId);
    if (session === undefined) return { result: "unknown-app" };
    let result: ChartCommandResultV1;
    try {
      result = await run(commandDeps(session));
    } catch (cause) {
      deps.closeAppSession(appId);
      throw cause;
    }
    return toOutcomeWire(result);
  }

  /** Replaces one app's draft in the catalog, or reports the app unknown. */
  async function writeDraft(appId: string, draft: Uint8Array | undefined): Promise<boolean> {
    const { catalog } = deps.getContext();
    if (!catalog.apps.some((app) => app.appId === appId)) return false;
    await deps.commitCatalog({
      ...catalog,
      catalogRevision: catalog.catalogRevision + 1,
      apps: catalog.apps.map((app) => (app.appId === appId ? withDraft(app, draft) : app)),
    });
    return true;
  }

  return {
    async listCharts(request) {
      const session = await deps.appSession(request.appId);
      return {
        kind: "listCharts",
        charts: session === undefined ? null : session.projection.execute({ kind: "list-charts" }).map(toChartView),
      };
    },

    async getChart(request) {
      const session = await deps.appSession(request.appId);
      const chartId = chartIdOf(request.chartId);
      const chart = session?.projection
        .execute({ kind: "list-charts" })
        .find((candidate) => encodeDomainId(candidate.definition.chartId) === encodeDomainId(chartId));
      return { kind: "getChart", chart: chart === undefined ? null : toChartView(chart) };
    },

    async saveChart(request) {
      const existing =
        request.chartId === null
          ? null
          : { chartId: chartIdOf(request.chartId), expectedRevision: revisionOf(request.expectedRevision) };
      const body = toChartBody(request.definition);
      return {
        kind: "saveChart",
        outcome: await command(request.appId, (commandDeps) => saveChart(commandDeps, { existing, body })),
      };
    },

    async setChartPin(request) {
      const chartId = chartIdOf(request.chartId);
      const expectedRevision = revisionOf(request.expectedRevision);
      return {
        kind: "setChartPin",
        outcome: await command(request.appId, (commandDeps) =>
          setChartPin(commandDeps, { chartId, expectedRevision, pinned: request.pinned }),
        ),
      };
    },

    async deleteChart(request) {
      const chartId = chartIdOf(request.chartId);
      const expectedRevision = revisionOf(request.expectedRevision);
      return {
        kind: "deleteChart",
        outcome: await command(request.appId, (commandDeps) => deleteChart(commandDeps, { chartId, expectedRevision })),
      };
    },

    getChartDraft(request) {
      const entry = deps.getContext().catalog.apps.find((app) => app.appId === request.appId);
      return Promise.resolve({
        kind: "getChartDraft",
        draft: entry?.chartDraft === undefined ? null : decodeDraft(entry.chartDraft),
      });
    },

    async saveChartDraft(request) {
      const saved = await writeDraft(request.appId, encodeDraft(request.draft, () => createDomainId("chart", deps.entropy)));
      return { kind: "saveChartDraft", saved };
    },

    async discardChartDraft(request) {
      await writeDraft(request.appId, undefined);
      return { kind: "discardChartDraft" };
    },
  };
}

// ------------------------------------------------------------------ drafts --

/** The entry with this draft, or with none: an absent draft is an absent key. */
function withDraft(app: LocalCatalogAppEntryV1, draft: Uint8Array | undefined): LocalCatalogAppEntryV1 {
  const next: { -readonly [K in keyof LocalCatalogAppEntryV1]: LocalCatalogAppEntryV1[K] } = { ...app };
  if (draft === undefined) delete next.chartDraft;
  else next.chartDraft = draft;
  return next;
}

/**
 * A draft's stored form: the definition through M23's codec (so a draft and a
 * saved chart are read by the same decoder), which chart it edits, and the
 * revision the builder opened. A never-saved draft's definition carries a
 * placeholder identity; saving still mints the chart's real one.
 */
function encodeDraft(draft: ChartDraftViewV1, placeholder: () => ChartId): Uint8Array {
  const editing = draft.chartId === null ? null : chartIdOf(draft.chartId);
  const expectedRevision = draft.expectedRevision === null ? null : Number(revisionOf(draft.expectedRevision));
  if ((editing === null) !== (expectedRevision === null)) {
    throw new DataWorkerCommandError("malformed-request");
  }
  const definition = { ...toChartBody(draft.definition), chartId: editing ?? placeholder() } as ChartDefinitionV1;
  return encodeCanonical(
    cborMap([
      ["editing", editing !== null],
      ["expectedRevision", expectedRevision],
      ["definition", encodeChartDefinition(definition)],
    ]),
  );
}

function decodeDraft(bytes: Uint8Array): ChartDraftViewV1 {
  const map = exactKeys(asMap(decodeCanonical(bytes), "a chart draft"), ["editing", "expectedRevision", "definition"], "a chart draft");
  const definition = decodeChartDefinition(field(map, "definition"));
  const revision = field(map, "expectedRevision");
  const isEditing = field(map, "editing") === true;
  return {
    chartId: isEditing ? encodeDomainId(definition.chartId) : null,
    expectedRevision: isEditing && revision !== null ? count(revision, "a chart revision") : null,
    definition: toDefinitionWire(definition),
  };
}

// ------------------------------------------------------------- wire mapping --

const idOf = <K extends DomainIdKind>(kind: K, text: string) => {
  try {
    return decodeDomainId(kind, text);
  } catch {
    throw new DataWorkerCommandError("malformed-request");
  }
};

const chartIdOf = (text: string): ChartId => idOf("chart", text);

const revisionOf = (value: number | null): bigint => {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new DataWorkerCommandError("malformed-request");
  }
  return BigInt(value);
};

function toGrouping(group: ChartGroupingWireV1): GroupingV1 {
  switch (group.kind) {
    case "field":
      return { kind: "field", fieldId: idOf("field", group.fieldId) };
    case "related-field":
      return {
        kind: "related-field",
        relationshipId: idOf("relationship", group.relationshipId),
        referenceFieldId: idOf("field", group.referenceFieldId),
        fieldId: idOf("field", group.fieldId),
      };
    case "date":
      return { kind: "date", fieldId: idOf("field", group.fieldId), unit: group.unit };
    default: {
      const unreachable: never = group;
      return unreachable;
    }
  }
}

const toMeasure = (measure: ChartMeasureWireV1): MeasureV1 =>
  measure.kind === "count" ? { kind: "count" } : { kind: measure.kind, fieldId: idOf("field", measure.fieldId) };

/** A wire definition as the command's body: ids decoded, name NFC (D28). */
export function toChartBody(wire: ChartDefinitionWireV1): ChartBodyV1 {
  const common = {
    chartVersion: 1 as const,
    name: wire.name.normalize("NFC"),
    tableId: idOf("table", wire.tableId),
    filters: wire.filters.map(toDomainFilter),
    pinned: wire.pinned,
  };
  return wire.type === "scatter"
    ? { ...common, type: "scatter", x: idOf("field", wire.x), y: idOf("field", wire.y) }
    : {
        ...common,
        type: wire.type,
        groupBy: toGrouping(wire.groupBy),
        seriesBy: wire.seriesBy === null ? null : toGrouping(wire.seriesBy),
        measure: toMeasure(wire.measure),
        sort: wire.sort,
      };
}

function toGroupingWire(group: GroupingV1): ChartGroupingWireV1 {
  switch (group.kind) {
    case "field":
      return { kind: "field", fieldId: encodeDomainId(group.fieldId) };
    case "related-field":
      return {
        kind: "related-field",
        relationshipId: encodeDomainId(group.relationshipId),
        referenceFieldId: encodeDomainId(group.referenceFieldId),
        fieldId: encodeDomainId(group.fieldId),
      };
    case "date":
      return { kind: "date", fieldId: encodeDomainId(group.fieldId), unit: group.unit };
    default: {
      const unreachable: never = group;
      return unreachable;
    }
  }
}

function toFilterWire(filter: FilterV1): FilterWireV1 {
  const fieldId = encodeDomainId(filter.fieldId);
  const operand = filter.operand;
  switch (operand.kind) {
    case "enum-in":
      return { fieldId, operand: { kind: "enum-in", optionIds: operand.optionIds.map((id) => encodeDomainId(id)) } };
    case "reference-in":
      return { fieldId, operand: { kind: "reference-in", recordIds: operand.recordIds.map((id) => encodeDomainId(id)) } };
    case "date-range":
    case "number-range":
    case "boolean-is":
    case "text-contains":
    case "text-equals":
    case "reference-broken":
    case "is-empty":
    case "not-empty":
      return { fieldId, operand };
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

export function toDefinitionWire(definition: ChartDefinitionV1): ChartDefinitionWireV1 {
  const common = {
    name: definition.name,
    tableId: encodeDomainId(definition.tableId),
    filters: definition.filters.map(toFilterWire),
    pinned: definition.pinned,
  };
  return definition.type === "scatter"
    ? { ...common, type: "scatter", x: encodeDomainId(definition.x), y: encodeDomainId(definition.y) }
    : {
        ...common,
        type: definition.type,
        groupBy: toGroupingWire(definition.groupBy),
        seriesBy: definition.seriesBy === null ? null : toGroupingWire(definition.seriesBy),
        measure:
          definition.measure.kind === "count"
            ? { kind: "count" }
            : { kind: definition.measure.kind, fieldId: encodeDomainId(definition.measure.fieldId) },
        sort: definition.sort,
      };
}

export const toChartView = (chart: ProjectionChartV1): ChartViewV1 => ({
  chartId: encodeDomainId(chart.definition.chartId),
  definition: toDefinitionWire(chart.definition),
  ordinal: chart.ordinal,
  provenance: chart.provenance,
  chartRevision: Number(chart.chartRevision),
});

function toOutcomeWire(result: ChartCommandResultV1): ChartCommandOutcomeWireV1 {
  switch (result.outcome) {
    case "saved":
      return {
        result: "saved",
        chart: toChartView(result.chart),
        commitId: result.commit === null ? null : encodeBase64Url(result.commit.commit.commitId),
      };
    case "deleted":
      return {
        result: "deleted",
        chartId: encodeDomainId(result.chartId),
        commitId: encodeBase64Url(result.commit.commit.commitId),
      };
    case "stale-chart":
      return { result: "stale-chart", chartRevision: Number(result.chartRevision) };
    case "refused":
      return {
        result: "refused",
        refusals: result.refusals.map((refusal) => ({
          reason: refusal.reason,
          fieldId: refusal.fieldId === null ? null : encodeDomainId(refusal.fieldId),
          filterReason: refusal.filterReason,
        })),
      };
    case "unknown-chart":
      return { result: "unknown-chart" };
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}
