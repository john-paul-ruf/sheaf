/**
 * The OOXML inventory reader (M15; CA-18, D35, invariant 8).
 *
 * **Metadata only.** It reads the content types, the package and workbook
 * relationships, `xl/workbook.xml`, table, drawing and comment parts, and —
 * the one read that touches a worksheet part — a **prefix** of each worksheet
 * that stops at the `<sheetData>` start tag, to find its declared
 * `<dimension>`. No cell, and no byte of `sharedStrings.xml`, is ever read;
 * the spy test in `tests/unit/import/ooxml/preflight.test.ts` proves it for
 * every OOXML fixture.
 *
 * **Estimated cells** are `min(declared area, part size / 12)`: both are
 * metadata. 12 bytes is the smallest a populated SpreadsheetML cell can be
 * (`<c r="A1"><v>1</v></c>` is 22; the densest real encodings approach 12 with
 * no `r` attribute), so the size bound never under-counts a real sheet, while
 * a hostile far-corner dimension over a tiny part cannot inflate the estimate.
 *
 * **Macros refuse before anything else is read**: a VBA project, a macro sheet,
 * an ActiveX part or macro-enabled embedding, or a macro-enabled content type
 * (a renamed `.xlsm`) is an inventory outcome, never a fact.
 */

import { BoundExceededError, isBoundExceeded } from "../../source/bounds.js";
import {
  partEvents,
  readContentTypes,
  readRelationships,
  relationshipKind,
  type OpcContentTypesV1,
  type OpcRelationshipV1,
} from "../../source/opc.js";
import { tokenizeXml } from "../../source/xml.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import {
  PRESERVED_PART_KINDS,
  type ContainerHandleV1,
  type DateSystemV1,
  type DeclaredTableSummaryV1,
  type DefinedNameSummaryV1,
  type InventoryOutcomeV1,
  type InventoryReaderV1,
  type MacroSignalV1,
  type PreservedPartCountsV1,
  type PreservedPartKindV1,
  type RangeV1,
  type SheetInventoryItemV1,
  type SheetKindV1,
  type SheetVisibilityV1,
} from "../../facts/index.js";
import { readCommentAnchors, readDrawingObjects } from "./drawings.js";
import {
  attribute,
  isSheetElement,
  isTrue,
  MACRO_SHEET_RELATIONSHIP_KINDS,
  parseRange,
  rangeArea,
  relationshipAttribute,
  SHEET_RELATIONSHIP_KINDS,
} from "./parts.js";

/** The smallest a populated cell's markup can be; see the module comment. */
export const MIN_CELL_MARKUP_BYTES = 12;

/** A worksheet whose `<sheetData>` has not begun within 1 MiB is malformed. */
export const SHEET_PREFIX_MAX_BYTES = 1_048_576;

const MACRO_CONTENT_TYPES = new Set([
  "application/vnd.ms-excel.sheet.macroenabled.main+xml",
  "application/vnd.ms-excel.template.macroenabled.main+xml",
  "application/vnd.ms-excel.addin.macroenabled.main+xml",
  "application/vnd.ms-office.vbaproject",
  "application/vnd.ms-office.activex+xml",
]);
const MACRO_SHEET_CONTENT_TYPES = new Set([
  "application/vnd.ms-excel.macrosheet+xml",
  "application/vnd.ms-excel.intlmacrosheet+xml",
]);
const MACRO_EMBEDDING = /^xl\/embeddings\/.*\.(xlsm|xlsb|xltm|xlam|docm|dotm|pptm|potm|ppsm)$/;

/** Every kind at zero; a count of zero is exact. */
export const emptyCounts = (): Record<PreservedPartKindV1, number> =>
  Object.fromEntries(PRESERVED_PART_KINDS.map((kind) => [kind, 0])) as Record<PreservedPartKindV1, number>;

export function macroSignalOf(
  zip: ZipContainerHandleV1,
  contentTypes: OpcContentTypesV1,
): MacroSignalV1 | null {
  for (const { name } of zip.entries) {
    const lower = name.toLowerCase();
    if (lower.endsWith("vbaproject.bin")) return { kind: "vba-project", partPath: name };
  }
  for (const { name } of zip.entries) {
    const lower = name.toLowerCase();
    if (lower.startsWith("xl/macrosheets/")) return { kind: "xlm-macro-sheet", partPath: name };
    if (lower.startsWith("xl/activex/") || MACRO_EMBEDDING.test(lower)) {
      return { kind: "script-part", partPath: name };
    }
  }
  for (const { target, contentType } of contentTypes.declared) {
    const type = contentType.toLowerCase();
    if (MACRO_SHEET_CONTENT_TYPES.has(type)) return { kind: "xlm-macro-sheet", partPath: target };
    if (MACRO_CONTENT_TYPES.has(type)) return { kind: "macro-content-type", partPath: target };
  }
  return null;
}

interface WorkbookSheetEntry {
  readonly name: string;
  readonly visibility: SheetVisibilityV1;
  readonly relationshipId: string | null;
}

export interface WorkbookPartV1 {
  readonly partName: string;
  readonly dateSystem: DateSystemV1;
  readonly sheets: readonly WorkbookSheetEntry[];
  readonly definedNames: readonly DefinedNameSummaryV1[];
  readonly relationships: readonly OpcRelationshipV1[];
}

const visibilityOf = (state: string | null): SheetVisibilityV1 =>
  state === "hidden" ? "hidden" : state === "veryHidden" ? "very-hidden" : "visible";

/** `xl/workbook.xml` (wherever the package points): sheets, epoch, names. */
export async function readWorkbookPart(zip: ZipContainerHandleV1): Promise<WorkbookPartV1> {
  const office = (await readRelationships(zip, null)).find(
    (relationship) => relationshipKind(relationship.type) === "officedocument" && !relationship.isExternal,
  );
  if (office === undefined || !zip.has(office.target)) {
    throw new BoundExceededError("malformed-structure");
  }
  let dateSystem: DateSystemV1 = "1900";
  const sheets: WorkbookSheetEntry[] = [];
  const definedNames: DefinedNameSummaryV1[] = [];
  let openName: { name: string; sheetIndex: number | null; ref: string } | null = null;

  for await (const event of partEvents(zip, office.target)) {
    if (event.kind === "start" && isSheetElement(event.uri)) {
      if (event.local === "workbookPr" && isTrue(attribute(event, "date1904"))) {
        dateSystem = "1904";
      } else if (event.local === "sheet") {
        sheets.push({
          name: (attribute(event, "name") ?? "").normalize("NFC"),
          visibility: visibilityOf(attribute(event, "state")),
          relationshipId: relationshipAttribute(event),
        });
      } else if (event.local === "definedName") {
        const local = attribute(event, "localSheetId");
        openName = {
          name: (attribute(event, "name") ?? "").normalize("NFC"),
          sheetIndex: local !== null && /^\d{1,5}$/.test(local) ? Number(local) : null,
          ref: "",
        };
      }
    } else if (event.kind === "text" && openName !== null) {
      openName.ref += event.value;
    } else if (event.kind === "end" && event.local === "definedName" && openName !== null) {
      definedNames.push({ ...openName, ref: openName.ref.normalize("NFC") });
      openName = null;
    }
  }
  return {
    partName: office.target,
    dateSystem,
    sheets,
    definedNames,
    relationships: await readRelationships(zip, office.target),
  };
}

export interface SheetPartV1 {
  readonly sheetIndex: number;
  readonly name: string;
  readonly kind: SheetKindV1;
  readonly visibility: SheetVisibilityV1;
  readonly partName: string;
}

/** Each sheet with its part and kind, in workbook order. */
export function sheetPartsOf(zip: ZipContainerHandleV1, workbook: WorkbookPartV1): SheetPartV1[] {
  const byId = new Map(workbook.relationships.map((relationship) => [relationship.id, relationship]));
  return workbook.sheets.map((sheet, sheetIndex) => {
    const relationship = sheet.relationshipId === null ? undefined : byId.get(sheet.relationshipId);
    const relKind = relationship === undefined ? "" : relationshipKind(relationship.type);
    const kind = SHEET_RELATIONSHIP_KINDS.get(relKind as "worksheet");
    if (relationship === undefined || relationship.isExternal || kind === undefined || !zip.has(relationship.target)) {
      throw new BoundExceededError("malformed-structure");
    }
    return { sheetIndex, name: sheet.name, kind, visibility: sheet.visibility, partName: relationship.target };
  });
}

async function* prefixOf(zip: ZipContainerHandleV1, partName: string): AsyncGenerator<Uint8Array> {
  let read = 0;
  for await (const chunk of zip.streamEntry(partName)) {
    if (read >= SHEET_PREFIX_MAX_BYTES) {
      throw new BoundExceededError("malformed-structure");
    }
    read += chunk.byteLength;
    yield chunk;
  }
}

/** The declared `<dimension>`, read from the part's prefix only. */
export async function readDeclaredDimension(
  zip: ZipContainerHandleV1,
  partName: string,
): Promise<RangeV1 | null> {
  let dimension: RangeV1 | null = null;
  for await (const event of tokenizeXml(prefixOf(zip, partName))) {
    if (event.kind !== "start" || !isSheetElement(event.uri)) continue;
    if (event.local === "dimension") {
      dimension = parseRange(attribute(event, "ref") ?? "");
    } else if (event.local === "sheetData") {
      break;
    }
  }
  return dimension;
}

/** A table part's display name and range. */
export async function readTablePart(
  zip: ZipContainerHandleV1,
  partName: string,
): Promise<{ readonly name: string; readonly range: RangeV1; readonly headerRowCount: number; readonly totalsRowCount: number; readonly columns: readonly string[] } | null> {
  let table: { name: string; range: RangeV1; headerRowCount: number; totalsRowCount: number; columns: string[] } | null = null;
  for await (const event of partEvents(zip, partName)) {
    if (event.kind !== "start" || !isSheetElement(event.uri)) continue;
    if (event.local === "table") {
      const range = parseRange(attribute(event, "ref") ?? "");
      if (range === null) return null;
      const count = (value: string | null, fallback: number) =>
        value !== null && /^\d{1,3}$/.test(value) ? Number(value) : fallback;
      table = {
        name: (attribute(event, "displayName") ?? attribute(event, "name") ?? "").normalize("NFC"),
        range,
        headerRowCount: count(attribute(event, "headerRowCount"), 1),
        totalsRowCount: count(attribute(event, "totalsRowCount"), 0),
        columns: [],
      };
    } else if (event.local === "tableColumn" && table !== null) {
      table.columns.push((attribute(event, "name") ?? "").normalize("NFC"));
    }
  }
  return table;
}

/** Counts of the parts a sheet's relationships declare (not its body). */
async function sheetPartCounts(
  zip: ZipContainerHandleV1,
  relationships: readonly OpcRelationshipV1[],
): Promise<{ counts: PreservedPartCountsV1; tables: DeclaredTableSummaryV1[] }> {
  const counts = emptyCounts();
  const tables: DeclaredTableSummaryV1[] = [];
  for (const relationship of relationships) {
    const kind = relationshipKind(relationship.type);
    if (relationship.isExternal) {
      if (kind === "hyperlink") counts.hyperlink += 1;
      continue;
    }
    if (!zip.has(relationship.target)) continue;
    switch (kind) {
      case "table": {
        const table = await readTablePart(zip, relationship.target);
        if (table !== null) tables.push({ name: table.name, range: table.range });
        break;
      }
      case "drawing":
        for (const object of await readDrawingObjects(zip, relationship.target)) {
          counts[object.partKind] += 1;
        }
        break;
      case "comments":
        counts.comment += (await readCommentAnchors(zip, relationship.target)).length;
        break;
      case "pivottable":
        counts["pivot-table"] += 1;
        break;
      case "oleobject":
      case "package":
        counts["embedded-object"] += 1;
        break;
      case "ctrlprop":
        counts["form-control"] += 1;
        break;
    }
  }
  return { counts, tables };
}

async function sheetInventory(
  zip: ZipContainerHandleV1,
  sheet: SheetPartV1,
): Promise<SheetInventoryItemV1> {
  const { counts, tables } = await sheetPartCounts(zip, await readRelationships(zip, sheet.partName));
  let declaredRange: RangeV1 | null = null;
  let estimatedCellCount: number | null = null;
  let estimatedRowCount: number | null = null;
  if (sheet.kind === "worksheet") {
    declaredRange = await readDeclaredDimension(zip, sheet.partName);
    const sizeBound = Math.floor(
      (zip.entry(sheet.partName)?.declaredUncompressedSize ?? 0) / MIN_CELL_MARKUP_BYTES,
    );
    estimatedCellCount = declaredRange === null ? sizeBound : Math.min(rangeArea(declaredRange), sizeBound);
    estimatedRowCount =
      declaredRange === null
        ? null
        : Math.min(declaredRange.lastRow - declaredRange.firstRow + 1, estimatedCellCount);
  }
  return {
    sheetIndex: sheet.sheetIndex,
    name: sheet.name,
    kind: sheet.kind,
    visibility: sheet.visibility,
    declaredRange,
    declaredTables: tables,
    estimatedRowCount,
    estimatedCellCount,
    preservedPartCounts: counts,
  };
}

const workbookCounts = (relationships: readonly OpcRelationshipV1[]): PreservedPartCountsV1 => {
  const counts = emptyCounts();
  for (const relationship of relationships) {
    const kind = relationshipKind(relationship.type);
    if (kind === "externallink") counts["external-link"] += 1;
    if (kind === "connections") counts["data-connection"] += 1;
  }
  return counts;
};

async function readInventory(container: ContainerHandleV1): Promise<InventoryOutcomeV1> {
  if (container.kind !== "zip") {
    return { kind: "unreadable", detail: "unrecognized-content" };
  }
  const zip = container.zip;
  try {
    const signal = macroSignalOf(zip, await readContentTypes(zip));
    if (signal !== null) {
      return { kind: "macro", signal };
    }
    const workbook = await readWorkbookPart(zip);
    const macroSheet = workbook.relationships.find((relationship) =>
      MACRO_SHEET_RELATIONSHIP_KINDS.has(relationshipKind(relationship.type)),
    );
    if (macroSheet !== undefined) {
      return { kind: "macro", signal: { kind: "xlm-macro-sheet", partPath: macroSheet.target } };
    }
    const sheets: SheetInventoryItemV1[] = [];
    for (const sheet of sheetPartsOf(zip, workbook)) {
      sheets.push(await sheetInventory(zip, sheet));
    }
    return {
      kind: "inventory",
      inventory: {
        format: "xlsx",
        sheets,
        sheetListKnown: true,
        definedNames: workbook.definedNames,
        dateSystem: workbook.dateSystem,
        preservedPartCounts: workbookCounts(workbook.relationships),
      },
    };
  } catch (cause) {
    if (isBoundExceeded(cause)) {
      return { kind: "unreadable", detail: cause.detail };
    }
    throw cause;
  }
}

/** The OOXML (`.xlsx`) inventory reader the import worker registers (D35). */
export const ooxmlInventoryReader: InventoryReaderV1 = Object.freeze({
  format: "xlsx",
  readInventory,
});
