/**
 * The import worker's format registry (M33; D35).
 *
 * Pre-flight (M14) never imports an adapter: it is handed the readers, and the
 * parse is handed the adapter, by the one composition that knows every format
 * — this file. Each format contributes exactly an `InventoryReaderV1` (metadata
 * only; macro and unsafe content surface here, before any stage exists) and a
 * `WorkbookAdapterV1` (the selected sheets' facts). A format missing from the
 * registry is refused by pre-flight as a later release, which is how the
 * registry stays the single statement of what this build can read.
 */

import type { InventoryReaderV1, WorkbookAdapterV1, WorkbookFormatV1 } from "../../import/facts/index.js";
import { biffAdapter, readBiffInventory } from "../../import/formats/biff/index.js";
import { htmlTableAdapter, readHtmlTableInventory } from "../../import/formats/html-table/index.js";
import { odsAdapter, readOdsInventory } from "../../import/formats/ods/index.js";
import { ooxmlAdapter, ooxmlInventoryReader } from "../../import/formats/ooxml/index.js";
import { readXlsbInventory, xlsbAdapter } from "../../import/formats/xlsb/index.js";

export interface WorkbookRegistryV1 {
  readonly readers: ReadonlyMap<WorkbookFormatV1, InventoryReaderV1>;
  readonly adapters: ReadonlyMap<WorkbookFormatV1, WorkbookAdapterV1>;
}

const FORMATS: readonly (readonly [WorkbookFormatV1, InventoryReaderV1, WorkbookAdapterV1])[] = [
  ["xlsx", ooxmlInventoryReader, ooxmlAdapter],
  ["xlsb", readXlsbInventory, xlsbAdapter],
  ["xls", readBiffInventory, biffAdapter],
  ["ods", readOdsInventory, odsAdapter],
  ["html-table", readHtmlTableInventory, htmlTableAdapter],
];

/** Every format this build reads, reader and adapter keyed by the same format. */
export const WORKBOOK_REGISTRY: WorkbookRegistryV1 = Object.freeze({
  readers: new Map(FORMATS.map(([format, reader]) => [format, reader])),
  adapters: new Map(FORMATS.map(([format, , adapter]) => [format, adapter])),
});
