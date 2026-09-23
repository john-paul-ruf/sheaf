import type { RecordsFilterV1 } from "../application/view-models/records.js";

/**
 * D63: a records filter intent travels in router **navigation state**, never
 * in the URL — a filter can carry a reference value, and the hash is not a
 * place for record content (invariant 3 spirit). S05's chart mark sends one:
 *
 * ```ts
 * navigate(tablePath(appId, tableId), { state: filterIntentState([filter]) });
 * ```
 *
 * The records route applies it as the list's starting filters (CA-29 accepts
 * it verbatim), shows each as a clearable chip, and forgets it on the next
 * navigation. Anything that is not a well-formed filter list is ignored: a
 * stale or foreign state object must not become a query.
 */
export const RECORDS_FILTER_INTENT_KEY = "sheaf.records.filterIntent";

export interface RecordsFilterIntentStateV1 {
  readonly [RECORDS_FILTER_INTENT_KEY]: readonly RecordsFilterV1[];
}

export function filterIntentState(filters: readonly RecordsFilterV1[]): RecordsFilterIntentStateV1 {
  return { [RECORDS_FILTER_INTENT_KEY]: filters };
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
