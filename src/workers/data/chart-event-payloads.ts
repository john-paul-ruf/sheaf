/**
 * The payload ↔ canonical CBOR mapping for `chart.saved` and `chart.deleted`
 * (M33; CA-30). Both directions live here, as for the record and schema
 * kinds beside it, so the payload a command writes is the payload a restart
 * reads back; `encode∘decode` is asserted to be identity in
 * `tests/unit/workers/record-event-payloads.test.ts`.
 *
 * The definition itself is M23's (`encodeChartDefinition`), the same codec
 * the checkpoint's `charts` root uses — a chart reads the same from an event
 * and from a checkpoint. The payload repeats the definition's name, pin and
 * ID beside it (database.md's columns); a pair that disagrees is refused
 * rather than trusted one way or the other.
 */

import { CodecError } from "../../domain/model/errors.js";
import {
  CHART_PROVENANCES,
  type ChartDeletedPayloadV1,
  type ChartSavedPayloadV1,
  type ChartStateV1,
  type F04ChartEventKindV1,
} from "../../domain/model/events.js";
import { asDomainId, compareDomainIds } from "../../domain/model/ids.js";
import type { DomainEventV1 } from "../../application/ports/event-repository.js";
import { decodeChartDefinition, encodeChartDefinition } from "../../import/staging/roots.js";
import {
  asMap,
  boolean,
  bytesOfLength,
  cborMap,
  count,
  exactKeys,
  field,
  nfcText,
  oneOf,
} from "../../import/staging/proposal-codec.js";
import type { CborValue, DecodedKey, DecodedValue } from "../../persistence/codecs/canonical-cbor.js";

const ID_BYTES = 16;
const SHA256_BYTES = 32;
const STATE_KEYS = ["definition", "displayName", "pinned", "ordinal", "provenance", "chartRevision"] as const;

type ChartEventV1 = Extract<DomainEventV1, { readonly kind: F04ChartEventKindV1 }>;

const encodeState = (state: ChartStateV1): (readonly [string, CborValue])[] => [
  ["definition", encodeChartDefinition(state.definition)],
  ["displayName", state.displayName],
  ["pinned", state.pinned],
  ["ordinal", state.ordinal],
  ["provenance", state.provenance],
  ["chartRevision", state.chartRevision],
];

export function encodeChartEventPayload(event: ChartEventV1): CborValue {
  switch (event.kind) {
    case "chart.saved":
      return cborMap([
        ["chartId", event.payload.chartId],
        ...encodeState(event.payload),
        ["priorSha256", event.payload.priorSha256],
      ]);
    case "chart.deleted":
      return cborMap([
        ["chartId", event.payload.chartId],
        ["prior", cborMap(encodeState(event.payload.prior))],
      ]);
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

const decodeState = (map: ReadonlyMap<DecodedKey, DecodedValue>, chartId: Uint8Array): ChartStateV1 => {
  const definition = decodeChartDefinition(field(map, "definition"));
  const state: ChartStateV1 = {
    definition,
    displayName: nfcText(field(map, "displayName"), "a chart name"),
    pinned: boolean(field(map, "pinned"), "a pin flag"),
    ordinal: count(field(map, "ordinal"), "a chart ordinal"),
    provenance: oneOf(field(map, "provenance"), CHART_PROVENANCES, "a chart provenance"),
    chartRevision: BigInt(count(field(map, "chartRevision"), "a chart revision")),
  };
  if (
    compareDomainIds(definition.chartId, chartId) !== 0 ||
    state.displayName !== definition.name ||
    state.pinned !== definition.pinned
  ) {
    throw new CodecError("a chart payload disagrees with its own definition");
  }
  return state;
};

export function decodeChartEventPayload(kind: F04ChartEventKindV1, payload: DecodedValue): ChartEventV1 {
  switch (kind) {
    case "chart.saved": {
      const map = exactKeys(asMap(payload, "a chart.saved payload"), ["chartId", ...STATE_KEYS, "priorSha256"], "a chart.saved payload");
      const chartId = asDomainId("chart", bytesOfLength(field(map, "chartId"), ID_BYTES, "a chart id"));
      const prior = field(map, "priorSha256");
      const saved: ChartSavedPayloadV1 = {
        chartId,
        ...decodeState(map, chartId),
        priorSha256: prior === null ? null : bytesOfLength(prior, SHA256_BYTES, "a prior chart digest"),
      };
      return { kind, payload: saved };
    }
    case "chart.deleted": {
      const map = exactKeys(asMap(payload, "a chart.deleted payload"), ["chartId", "prior"], "a chart.deleted payload");
      const chartId = asDomainId("chart", bytesOfLength(field(map, "chartId"), ID_BYTES, "a chart id"));
      const prior = exactKeys(asMap(field(map, "prior"), "a prior chart"), [...STATE_KEYS], "a prior chart");
      const deleted: ChartDeletedPayloadV1 = { chartId, prior: decodeState(prior, chartId) };
      return { kind, payload: deleted };
    }
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
