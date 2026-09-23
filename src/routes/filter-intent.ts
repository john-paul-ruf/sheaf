import type { RecordsFilterV1 } from "../application/view-models/records.js";

/**
 * D63: a records filter intent travels in router **navigation state**, never
 * in the URL — a filter can carry a reference value, and the hash is not a
 * place for record content (invariant 3 spirit). S05's chart mark sends one:
 *
 * ```ts
 * navigate(tablePath(appId, tableId), { state: filterIntentState(filters, origin) });
 * ```
 *
 * The records route applies it as the list's starting filters (CA-29 accepts
 * it verbatim), shows each as a clearable chip, and forgets it on the next
 * navigation. Anything that is not a well-formed filter list is ignored: a
 * stale or foreign state object must not become a query.
 *
 * A chart's intent also names the chart it came from, which the list heading
 * and its announcement say (design.md § Accessibility Contract: "Selecting a
 * mark announces the filter and updates the list heading"), and the labels
 * of any records a reference filter names, so its chip reads as a name.
 */
export const RECORDS_FILTER_INTENT_KEY = "sheaf.records.filterIntent";
export const RECORDS_FILTER_ORIGIN_KEY = "sheaf.records.filterOrigin";

/** Where a filter intent came from: a chart's tapped mark. */
export interface FilterIntentOriginV1 {
  readonly chartName: string;
  /** Record id → label, for the chips of a reference filter. */
  readonly recordLabels: Readonly<Record<string, string>>;
}

export interface RecordsFilterIntentStateV1 {
  readonly [RECORDS_FILTER_INTENT_KEY]: readonly RecordsFilterV1[];
  readonly [RECORDS_FILTER_ORIGIN_KEY]?: FilterIntentOriginV1;
}

export function filterIntentState(
  filters: readonly RecordsFilterV1[],
  origin?: FilterIntentOriginV1,
): RecordsFilterIntentStateV1 {
  return origin === undefined
    ? { [RECORDS_FILTER_INTENT_KEY]: filters }
    : { [RECORDS_FILTER_INTENT_KEY]: filters, [RECORDS_FILTER_ORIGIN_KEY]: origin };
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const isFilter = (value: unknown): value is RecordsFilterV1 =>
  isRecord(value) && typeof value["fieldId"] === "string" && isRecord(value["operand"]) && typeof value["operand"]["kind"] === "string";

/** The intent's filters, or none when the state carries no well-formed intent. */
export function readFilterIntent(state: unknown): readonly RecordsFilterV1[] {
  if (!isRecord(state)) return [];
  const intent = state[RECORDS_FILTER_INTENT_KEY];
  return Array.isArray(intent) && intent.every(isFilter) ? intent : [];
}

/** The chart an intent came from, when the state names one well-formed; else null. */
export function readFilterOrigin(state: unknown): FilterIntentOriginV1 | null {
  if (readFilterIntent(state).length === 0 || !isRecord(state)) return null;
  const origin = state[RECORDS_FILTER_ORIGIN_KEY];
  if (!isRecord(origin) || typeof origin["chartName"] !== "string" || !isRecord(origin["recordLabels"])) return null;
  const labels = Object.entries(origin["recordLabels"]).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return { chartName: origin["chartName"], recordLabels: Object.fromEntries(labels) };
}
