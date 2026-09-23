/**
 * One pivot table's declared shape, read and never interpreted (M15; CA-31,
 * D55).
 *
 * The pivot part (`pivotTableDefinition`) names its row fields and data
 * fields by index into its cache's fields; the cache part it relates to
 * (`pivotCacheDefinition`) names those fields and the worksheet range or
 * table they summarize. Both are streamed through the bounded tokenizer. The
 * cached records (`pivotCacheRecords`) are never opened: nothing here needs
 * the data, and they may be the largest part in the file.
 *
 * A cache over anything but a worksheet (an external connection, a
 * consolidation, a scenario, another workbook), an index outside the cache,
 * more than {@link PIVOT_PART_MAX_FIELDS} fields, or a part the XML reader
 * refuses yields no definition: the pivot fact stays preserved as in F03.
 */

import {
  PIVOT_PART_MAX_FIELDS,
  PIVOT_SUBTOTALS,
  type PivotPartDefinitionV1,
} from "../../facts/index.js";
import { BoundExceededError, isBoundExceeded } from "../../source/bounds.js";
import { readRelationships, relationshipKind } from "../../source/opc.js";
import { tokenizeXml, type XmlStartEventV1 } from "../../source/xml.js";
import type { ZipContainerHandleV1 } from "../../source/zip.js";
import { refusedDefinition, type PartDefinitionReadV1 } from "./charts.js";
import { attribute, isSheetElement, relationshipAttribute } from "./parts.js";

/** The row-field index that stands for "Values" when a pivot has several data fields. */
const VALUES_FIELD = -2;

class OverBounds extends Error {}

/** Every SpreadsheetML start element of a part, with its depth (root = 0). */
async function* startsOf(
  zip: ZipContainerHandleV1,
  partName: string,
): AsyncGenerator<{ readonly event: XmlStartEventV1; readonly depth: number }, void, undefined> {
  let depth = 0;
  for await (const event of tokenizeXml(zip.streamEntry(partName))) {
    if (event.kind === "start") {
      if (isSheetElement(event.uri)) yield { event, depth };
      depth += 1;
    } else if (event.kind === "end") {
      depth -= 1;
    }
  }
}

const bounded = <T>(items: T[], item: T): void => {
  if (items.length === PIVOT_PART_MAX_FIELDS) throw new OverBounds();
  items.push(item);
};

/** A zero-based field index, or `null` for anything that is not one. */
const indexOf = (value: string | null): number | null =>
  value !== null && /^-?\d{1,7}$/.test(value) ? Number(value) : null;

async function readPivot(zip: ZipContainerHandleV1, pivotPart: string): Promise<PartDefinitionReadV1<PivotPartDefinitionV1>> {
  const rowIndexes: (number | null)[] = [];
  const dataFields: { readonly field: number | null; readonly subtotal: string }[] = [];
  let section: string | null = null;
  for await (const { event, depth } of startsOf(zip, pivotPart)) {
    if (depth === 0 && event.local !== "pivotTableDefinition") return refusedDefinition("not-declared");
    if (depth === 1) section = event.local;
    else if (depth === 2 && section === "rowFields" && event.local === "field") {
      bounded(rowIndexes, indexOf(attribute(event, "x")));
    } else if (depth === 2 && section === "dataFields" && event.local === "dataField") {
      bounded(dataFields, { field: indexOf(attribute(event, "fld")), subtotal: attribute(event, "subtotal") ?? "sum" });
    }
  }

  const cache = (await readRelationships(zip, pivotPart)).find(
    (relationship) => relationshipKind(relationship.type) === "pivotcachedefinition" && !relationship.isExternal,
  );
  if (cache === undefined || !zip.has(cache.target)) return refusedDefinition("not-declared");

  const fields: string[] = [];
  let source: { readonly sheet: string | null; readonly ref: string } | null = null;
  let isWorksheet = false;
  section = null;
  for await (const { event, depth } of startsOf(zip, cache.target)) {
    if (depth === 0 && event.local !== "pivotCacheDefinition") return refusedDefinition("not-declared");
    if (depth === 1) section = event.local;
    if (depth === 1 && event.local === "cacheSource") {
      isWorksheet = attribute(event, "type") === "worksheet";
    } else if (depth === 2 && section === "cacheSource" && event.local === "worksheetSource") {
      if (relationshipAttribute(event) !== null) return refusedDefinition("unsupported-source");
      const ref = attribute(event, "ref");
      const name = attribute(event, "name");
      source = ref !== null ? { sheet: attribute(event, "sheet"), ref } : name !== null ? { sheet: null, ref: name } : null;
    } else if (depth === 2 && section === "cacheFields" && event.local === "cacheField") {
      bounded(fields, (attribute(event, "name") ?? "").normalize("NFC"));
    }
  }
  if (!isWorksheet || source === null) return refusedDefinition("unsupported-source");

  const fieldName = (index: number | null): string => {
    const name = index === null ? undefined : fields[index];
    if (name === undefined) throw new BoundExceededError("malformed-structure");
    return name;
  };
  return {
    definition: {
      sourceSheet: source.sheet?.normalize("NFC") ?? null,
      sourceRef: source.ref.normalize("NFC"),
      rowFields: rowIndexes.filter((index) => index !== VALUES_FIELD).map(fieldName),
      dataFields: dataFields.flatMap(({ field, subtotal }) => {
        const cacheFieldName = fieldName(field);
        const summary = PIVOT_SUBTOTALS.find((each) => each === subtotal);
        return summary === undefined ? [] : [{ cacheFieldName, subtotal: summary }];
      }),
    },
    refusal: null,
  };
}

/** The declared definition of one pivot table part, or why it has none. */
export async function readPivotDefinition(
  zip: ZipContainerHandleV1,
  pivotPart: string,
): Promise<PartDefinitionReadV1<PivotPartDefinitionV1>> {
  try {
    return await readPivot(zip, pivotPart);
  } catch (error) {
    if (error instanceof OverBounds) return refusedDefinition("over-bounds");
    if (isBoundExceeded(error)) return refusedDefinition(error.detail);
    throw error;
  }
}
