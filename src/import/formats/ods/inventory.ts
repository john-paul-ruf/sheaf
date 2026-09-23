/**
 * The ODS inventory reader (M18; CA-18, D35, FR-3, invariant 8).
 *
 * **Metadata only, and never one byte of `content.xml`.** An ODS keeps every
 * sheet's cells in that single part, so reading any of it is reading the cell
 * data. The reader uses:
 *
 * - `mimetype` — the spreadsheet or spreadsheet-template type; any other ODF
 *   document is `unrecognized-content`;
 * - `META-INF/manifest.xml` — an entry with `manifest:encryption-data` is an
 *   `encrypted-workbook`; a `Basic/` or `Scripts/` library (in the manifest or
 *   the archive) refuses as macro content; embedded charts, objects and
 *   pictures are counted;
 * - `meta.xml` — `meta:document-statistic` `meta:table-count` and
 *   `meta:cell-count`;
 * - `settings.xml` — the `Tables` view map, whose entries name the sheets in
 *   order (it holds cursors and visible areas, not dimensions).
 *
 * **Sheet-name fallback.** When `settings.xml` does not name the sheets (or
 * names a different number than `meta:table-count` declares), the names are
 * unknowable without reading cells: the inventory says `sheetListKnown:
 * false` and lists `meta:table-count` placeholder sheets (one when that is
 * silent) named `Table 1…n`. Pre-flight then routes *fits* or *handoff*,
 * never *subset*, and the adapter reads every table for any non-empty
 * selection (see `parse.ts`).
 *
 * **Estimates.** The workbook's populated cells are estimated as
 * `min(meta:cell-count, content.xml size / 40)` — both metadata; 40 bytes is
 * below the smallest populated `table:table-cell` markup under any namespace
 * prefix — then split evenly across the sheets, since no ODS metadata sizes a
 * sheet. Rows are not declared anywhere: `estimatedRowCount` is `null`.
 * Hidden sheets, declared tables, comments and the null date are stated in
 * `content.xml` only; the inventory reports every sheet visible, no declared
 * tables and the 1900 date system, and the parsed stream carries the truth.
 */

import { BoundExceededError, CONTAINER_BOUNDS_V1, isBoundExceeded } from "../../source/bounds.js";
import { partEvents } from "../../source/opc.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import {
  PRESERVED_PART_KINDS,
  type ContainerHandleV1,
  type InventoryOutcomeV1,
  type InventoryReaderV1,
  type MacroSignalV1,
  type PreservedPartKindV1,
  type SheetInventoryItemV1,
} from "../../facts/index.js";
import {
  attr,
  CONFIG_NS,
  CONTENT_PART,
  MANIFEST_NS,
  MANIFEST_PART,
  META_NS,
  META_PART,
  MIMETYPE_PART,
  SETTINGS_PART,
} from "./vocabulary.js";

export const ODS_MIMETYPES = Object.freeze([
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.spreadsheet-template",
] as const);

export const CHART_MEDIA_TYPE = "application/vnd.oasis.opendocument.chart";

/** Below the smallest populated `table:table-cell` markup; see the module comment. */
export const MIN_ODS_CELL_MARKUP_BYTES = 40;

const MAX_MIMETYPE_BYTES = 256;

export interface ManifestEntryV1 {
  readonly fullPath: string;
  readonly mediaType: string;
  readonly isEncrypted: boolean;
}

/** Every `manifest:file-entry`; an absent manifest lists nothing. */
export async function readManifest(zip: ZipContainerHandleV1): Promise<readonly ManifestEntryV1[]> {
  if (!zip.has(MANIFEST_PART)) return [];
  const entries: ManifestEntryV1[] = [];
  let open: { fullPath: string; mediaType: string; isEncrypted: boolean } | null = null;
  for await (const event of partEvents(zip, MANIFEST_PART)) {
    if (event.kind === "start" && event.uri === MANIFEST_NS) {
      if (event.local === "file-entry") {
        if (entries.length >= CONTAINER_BOUNDS_V1.maxZipEntries) throw new BoundExceededError("expansion-limit");
        open = {
          fullPath: attr(event, MANIFEST_NS, "full-path") ?? "",
          mediaType: attr(event, MANIFEST_NS, "media-type") ?? "",
          isEncrypted: false,
        };
      } else if (event.local === "encryption-data" && open !== null) {
        open.isEncrypted = true;
      }
    } else if (event.kind === "end" && event.uri === MANIFEST_NS && event.local === "file-entry" && open !== null) {
      entries.push(open);
      open = null;
    }
  }
  return entries;
}

const SCRIPT_LIBRARY = /^(?:basic|scripts)\//i;

/** A Basic or script library, wherever the package lists it. */
export function macroSignalOf(
  zip: ZipContainerHandleV1,
  manifest: readonly ManifestEntryV1[],
): MacroSignalV1 | null {
  const path =
    zip.entries.find(({ name }) => SCRIPT_LIBRARY.test(name))?.name ??
    manifest.find(({ fullPath }) => SCRIPT_LIBRARY.test(fullPath))?.fullPath;
  return path === undefined ? null : { kind: "script-part", partPath: path };
}

/** The `mimetype` entry's type, or `null` when the package has none. */
export async function readMimetype(zip: ZipContainerHandleV1): Promise<string | null> {
  if (!zip.has(MIMETYPE_PART)) return null;
  return new TextDecoder().decode(await zip.readEntry(MIMETYPE_PART, { maxBytes: MAX_MIMETYPE_BYTES })).trim();
}

const statisticOf = (value: string | null): number | null =>
  value !== null && /^\d{1,10}$/.test(value) ? Number(value) : null;

async function readStatistics(
  zip: ZipContainerHandleV1,
): Promise<{ readonly tableCount: number | null; readonly cellCount: number | null }> {
  if (!zip.has(META_PART)) return { tableCount: null, cellCount: null };
  for await (const event of partEvents(zip, META_PART)) {
    if (event.kind === "start" && event.uri === META_NS && event.local === "document-statistic") {
      return {
        tableCount: statisticOf(attr(event, META_NS, "table-count")),
        cellCount: statisticOf(attr(event, META_NS, "cell-count")),
      };
    }
  }
  return { tableCount: null, cellCount: null };
}

/** The sheet names `settings.xml` lists in its `Tables` view map, or `null`. */
async function readSettingsTableNames(zip: ZipContainerHandleV1): Promise<string[] | null> {
  if (!zip.has(SETTINGS_PART)) return null;
  let names: string[] | null = null;
  let depth = 0;
  let tablesDepth: number | null = null;
  for await (const event of partEvents(zip, SETTINGS_PART)) {
    if (event.kind === "start") {
      depth += 1;
      if (
        tablesDepth === null &&
        event.uri === CONFIG_NS &&
        event.local === "config-item-map-named" &&
        attr(event, CONFIG_NS, "name") === "Tables"
      ) {
        tablesDepth = depth;
        names ??= [];
      } else if (tablesDepth !== null && depth === tablesDepth + 1 && event.local === "config-item-map-entry") {
        const name = attr(event, CONFIG_NS, "name");
        if (name !== null && names !== null) {
          if (names.length >= CONTAINER_BOUNDS_V1.maxZipEntries) throw new BoundExceededError("expansion-limit");
          names.push(name.normalize("NFC"));
        }
      }
    } else if (event.kind === "end") {
      if (tablesDepth === depth) tablesDepth = null;
      depth -= 1;
    }
  }
  return names === null || names.length === 0 ? null : names;
}

export interface OdsSheetListV1 {
  readonly names: readonly string[];
  readonly isKnown: boolean;
}

/**
 * The sheet list from metadata: `settings.xml` names when they agree with
 * `meta:table-count`, else `Table 1…n` placeholders flagged unknown.
 */
export async function readSheetList(zip: ZipContainerHandleV1): Promise<OdsSheetListV1 & { readonly cellCount: number | null }> {
  const { tableCount, cellCount } = await readStatistics(zip);
  const names = await readSettingsTableNames(zip);
  if (names !== null && (tableCount === null || tableCount === names.length)) {
    return { names, isKnown: true, cellCount };
  }
  const count = Math.min(Math.max(1, tableCount ?? 1), CONTAINER_BOUNDS_V1.maxZipEntries);
  return { names: Array.from({ length: count }, (_, index) => `Table ${index + 1}`), isKnown: false, cellCount };
}

const emptyCounts = (): Record<PreservedPartKindV1, number> =>
  Object.fromEntries(PRESERVED_PART_KINDS.map((kind) => [kind, 0])) as Record<PreservedPartKindV1, number>;

/** Embedded charts, objects and pictures the manifest declares (workbook-wide). */
const manifestCounts = (manifest: readonly ManifestEntryV1[]): Record<PreservedPartKindV1, number> => {
  const counts = emptyCounts();
  for (const { fullPath, mediaType } of manifest) {
    if (mediaType === CHART_MEDIA_TYPE) {
      counts.chart += 1;
    } else if (/^Object [^/]+\/?$/.test(fullPath)) {
      counts["embedded-object"] += 1;
    } else if (/^Pictures\/[^/]+$/.test(fullPath)) {
      counts.image += 1;
    }
  }
  return counts;
};

/** Refusals shared with the adapter: wrong type, encryption, macros. */
export async function checkPackage(zip: ZipContainerHandleV1): Promise<
  | { readonly kind: "ok"; readonly manifest: readonly ManifestEntryV1[] }
  | { readonly kind: "macro"; readonly signal: MacroSignalV1 }
> {
  const mimetype = await readMimetype(zip);
  if (mimetype === null || !(ODS_MIMETYPES as readonly string[]).includes(mimetype)) {
    throw new BoundExceededError("unrecognized-content");
  }
  const manifest = await readManifest(zip);
  if (manifest.some((entry) => entry.isEncrypted)) {
    throw new BoundExceededError("encrypted-workbook");
  }
  const signal = macroSignalOf(zip, manifest);
  if (signal !== null) return { kind: "macro", signal };
  if (!zip.has(CONTENT_PART)) throw new BoundExceededError("malformed-structure");
  return { kind: "ok", manifest };
}

async function readInventory(container: ContainerHandleV1): Promise<InventoryOutcomeV1> {
  if (container.kind !== "zip") {
    return { kind: "unreadable", detail: "unrecognized-content" };
  }
  const zip = container.zip;
  try {
    const checked = await checkPackage(zip);
    if (checked.kind === "macro") return checked;
    const { names, isKnown, cellCount } = await readSheetList(zip);
    const sizeBound = Math.floor(
      (zip.entry(CONTENT_PART)?.declaredUncompressedSize ?? 0) / MIN_ODS_CELL_MARKUP_BYTES,
    );
    const workbookCells = cellCount === null ? sizeBound : Math.min(cellCount, sizeBound);
    const share = Math.floor(workbookCells / names.length);
    const sheets = names.map(
      (name, sheetIndex): SheetInventoryItemV1 => ({
        sheetIndex,
        name,
        kind: "worksheet",
        visibility: "visible",
        declaredRange: null,
        declaredTables: [],
        estimatedRowCount: null,
        estimatedCellCount: share + (sheetIndex === 0 ? workbookCells - share * names.length : 0),
        preservedPartCounts: emptyCounts(),
      }),
    );
    return {
      kind: "inventory",
      inventory: {
        format: "ods",
        sheets,
        sheetListKnown: isKnown,
        definedNames: [],
        dateSystem: "1900",
        preservedPartCounts: manifestCounts(checked.manifest),
      },
    };
  } catch (cause) {
    if (isBoundExceeded(cause)) {
      return { kind: "unreadable", detail: cause.detail };
    }
    throw cause;
  }
}

/** The ODS inventory reader the import worker registers (D35). */
export const readOdsInventory: InventoryReaderV1 = Object.freeze({
  format: "ods",
  readInventory,
});
