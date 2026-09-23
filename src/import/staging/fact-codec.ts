/**
 * The staged fact chunk: one `WorkbookFactStreamItemV2` as canonical CBOR, and
 * back (M23; CA-17).
 *
 * M65 owns the encoding direction — {@link factStreamItemToCanonicalValue} is
 * the one mapping every adapter's facts are staged through — and this file is
 * its inverse, so a staged chunk can be read again after a reload rather than
 * only while the parser's batches are still in memory. The decoder is the
 * **constraint layer**: every map must carry exactly its declared keys, every
 * closed set decodes only to its members, and every integer comes back from
 * the `bigint` the codec wrote. A chunk that fails any of that is a
 * `CodecError`, never a fact with an impossible shape.
 *
 * `decode(encode(item))` deep-equals `item` for every V2 kind, which is the
 * round trip `tests/unit/staging/fact-codec.test.ts` proves over every
 * adapter's fixture corpus.
 */

import { CodecError } from "../../domain/model/errors.js";
import type { OptionId, RecordId } from "../../domain/model/ids.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import {
  decodeCanonical,
  encodeCanonical,
  type DecodedKey,
  type DecodedValue,
} from "../../persistence/codecs/canonical-cbor.js";
import {
  CHART_BAR_DIRECTIONS,
  CHART_GROUPINGS,
  CHART_PART_TYPES,
  FORMAT_CLASSES,
  IMPORT_DIAGNOSTIC_CODES,
  PIVOT_SUBTOTALS,
  PRESERVED_PART_KINDS,
  PRESERVED_REASON_KEYS,
  SHEET_KINDS,
  SHEET_VISIBILITIES,
  VALIDATION_OPERATORS,
  VALIDATION_RULES,
  factStreamItemToCanonicalValue,
  type ChartPartDefinitionV1,
  type ImportDiagnosticV2,
  type PivotPartDefinitionV1,
  type RangeV1,
  type ValidationListSourceV1,
  type WorkbookFactStreamItemV2,
  type WorkbookFactV2,
} from "../facts/index.js";
import {
  asMap,
  boolean,
  bytesOfLength,
  count,
  exactKeys,
  field,
  integer,
  list,
  oneOf,
  optionalCount,
  optionalText,
  text,
} from "./proposal-codec.js";

const ID_BYTES = 16;
const DATE_SYSTEMS = Object.freeze(["1900", "1904"] as const);
const DIAGNOSTIC_SEVERITIES = Object.freeze(["info", "warning"] as const);
const CELL_KINDS = Object.freeze([
  "text",
  "decimal",
  "date",
  "boolean",
  "enum",
  "reference",
  "missing",
  "blank",
  "invalid-preserved",
] as const);

type DecodedMap = ReadonlyMap<DecodedKey, DecodedValue>;

/** The bytes a staged fact chunk holds: M65's mapping, canonically encoded. */
export function encodeFactStreamItem(item: WorkbookFactStreamItemV2): Uint8Array {
  return encodeCanonical(factStreamItemToCanonicalValue(item));
}

const cellValue = (value: DecodedValue): CellValueV1 => {
  const map = asMap(value, "a fact value");
  const kind = oneOf(field(map, "kind"), CELL_KINDS, "a fact value kind");
  switch (kind) {
    case "text":
      exactKeys(map, ["kind", "text"], "a text value");
      return { kind, text: text(field(map, "text"), "a text value") };
    case "decimal":
      exactKeys(map, ["kind", "decimal"], "a decimal value");
      return { kind, decimal: text(field(map, "decimal"), "a decimal value") };
    case "date":
      exactKeys(map, ["kind", "epochDay"], "a date value");
      return { kind, epochDay: integer(field(map, "epochDay"), "an epoch day") };
    case "boolean":
      exactKeys(map, ["kind", "boolean"], "a boolean value");
      return { kind, boolean: boolean(field(map, "boolean"), "a boolean value") };
    case "enum":
      exactKeys(map, ["kind", "optionId"], "an enum value");
      return { kind, optionId: bytesOfLength(field(map, "optionId"), ID_BYTES, "an option id") as OptionId };
    case "reference":
      exactKeys(map, ["kind", "recordId"], "a reference value");
      return { kind, recordId: bytesOfLength(field(map, "recordId"), ID_BYTES, "a record id") as RecordId };
    case "missing":
    case "blank":
      exactKeys(map, ["kind"], "an empty value");
      return { kind };
    case "invalid-preserved":
      exactKeys(map, ["kind", "sourceText"], "a preserved value");
      return { kind, sourceText: text(field(map, "sourceText"), "preserved text") };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
};

const diagnostic = (value: DecodedValue): ImportDiagnosticV2 => {
  const map = exactKeys(
    asMap(value, "a diagnostic"),
    ["code", "severity", "firstRowIndex", "firstColumnIndex", "occurrences"],
    "a diagnostic",
  );
  return {
    code: oneOf(field(map, "code"), IMPORT_DIAGNOSTIC_CODES, "a diagnostic code"),
    severity: oneOf(field(map, "severity"), DIAGNOSTIC_SEVERITIES, "a diagnostic severity"),
    firstRowIndex: optionalCount(field(map, "firstRowIndex"), "a diagnostic row"),
    firstColumnIndex: optionalCount(field(map, "firstColumnIndex"), "a diagnostic column"),
    occurrences: count(field(map, "occurrences"), "a diagnostic count"),
  };
};

const range = (value: DecodedValue): RangeV1 => {
  const map = exactKeys(
    asMap(value, "a range"),
    ["firstRow", "firstColumn", "lastRow", "lastColumn"],
    "a range",
  );
  return {
    firstRow: count(field(map, "firstRow"), "a first row"),
    firstColumn: count(field(map, "firstColumn"), "a first column"),
    lastRow: count(field(map, "lastRow"), "a last row"),
    lastColumn: count(field(map, "lastColumn"), "a last column"),
  };
};

const optionalRange = (value: DecodedValue): RangeV1 | null => (value === null ? null : range(value));

const listSource = (value: DecodedValue): ValidationListSourceV1 | null => {
  if (value === null) return null;
  const map = asMap(value, "a list source");
  const kind = oneOf(field(map, "kind"), ["inline", "range"] as const, "a list source kind");
  if (kind === "inline") {
    exactKeys(map, ["kind", "values"], "an inline list source");
    return { kind, values: list(field(map, "values"), "list values").map((entry) => text(entry, "a list value")) };
  }
  exactKeys(map, ["kind", "ref"], "a range list source");
  return { kind, ref: text(field(map, "ref"), "a list source reference") };
};

const optionalOneOf = <T extends string>(value: DecodedValue, allowed: readonly T[], what: string): T | null =>
  value === null ? null : oneOf(value, allowed, what);

const chartDefinition = (value: DecodedValue): ChartPartDefinitionV1 => {
  const map = exactKeys(
    asMap(value, "a chart definition"),
    ["chartType", "barDirection", "grouping", "title", "series"],
    "a chart definition",
  );
  return {
    chartType: oneOf(field(map, "chartType"), CHART_PART_TYPES, "a chart type"),
    barDirection: optionalOneOf(field(map, "barDirection"), CHART_BAR_DIRECTIONS, "a bar direction"),
    grouping: optionalOneOf(field(map, "grouping"), CHART_GROUPINGS, "a chart grouping"),
    title: optionalText(field(map, "title"), "a chart title"),
    series: list(field(map, "series"), "chart series").map((entry) => {
      const series = exactKeys(
        asMap(entry, "a chart series"),
        ["name", "categoriesRef", "valuesRef", "xRef", "yRef"],
        "a chart series",
      );
      return {
        name: optionalText(field(series, "name"), "a series name"),
        categoriesRef: optionalText(field(series, "categoriesRef"), "a series reference"),
        valuesRef: optionalText(field(series, "valuesRef"), "a series reference"),
        xRef: optionalText(field(series, "xRef"), "a series reference"),
        yRef: optionalText(field(series, "yRef"), "a series reference"),
      };
    }),
  };
};

const pivotDefinition = (value: DecodedValue): PivotPartDefinitionV1 => {
  const map = exactKeys(
    asMap(value, "a pivot definition"),
    ["sourceSheet", "sourceRef", "rowFields", "dataFields"],
    "a pivot definition",
  );
  return {
    sourceSheet: optionalText(field(map, "sourceSheet"), "a pivot source sheet"),
    sourceRef: text(field(map, "sourceRef"), "a pivot source"),
    rowFields: list(field(map, "rowFields"), "pivot row fields").map((entry) => text(entry, "a pivot field")),
    dataFields: list(field(map, "dataFields"), "pivot data fields").map((entry) => {
      const data = exactKeys(asMap(entry, "a pivot data field"), ["cacheFieldName", "subtotal"], "a pivot data field");
      return {
        cacheFieldName: text(field(data, "cacheFieldName"), "a pivot field"),
        subtotal: oneOf(field(data, "subtotal"), PIVOT_SUBTOTALS, "a pivot subtotal"),
      };
    }),
  };
};

const FACT_KEYS: Readonly<Record<WorkbookFactV2["kind"], readonly string[]>> = Object.freeze({
  row: ["kind", "rowIndex", "cellCount"],
  value: ["kind", "rowIndex", "columnIndex", "value"],
  diagnostic: ["kind", "diagnostic"],
  sheet: ["kind", "sheetIndex", "name", "sheetKind", "visibility", "declaredRange", "dateSystem"],
  "cell-format": ["kind", "rowIndex", "columnIndex", "numberFormat", "formatClass", "currencySymbol"],
  formula: ["kind", "rowIndex", "columnIndex", "text", "sharedGroup", "isArray", "isExternal"],
  "declared-table": ["kind", "name", "range", "headerRowCount", "totalsRowCount", "columns"],
  validation: ["kind", "range", "rule", "operator", "listSource", "formula1", "formula2"],
  merge: ["kind", "range"],
  "defined-name": ["kind", "name", "ref", "sheetIndex"],
  "preserved-part": ["kind", "partKind", "location", "reasonKey", "anchor", "partPath"],
});

const FACT_KINDS = Object.freeze(Object.keys(FACT_KEYS) as WorkbookFactV2["kind"][]);

const fact = (value: DecodedValue): WorkbookFactV2 => {
  const loose = asMap(value, "a fact");
  const kind = oneOf(field(loose, "kind"), FACT_KINDS, "a fact kind");
  const hasDefinition = kind === "preserved-part" && loose.has("definition");
  const keys = hasDefinition ? [...FACT_KEYS[kind], "definition"] : FACT_KEYS[kind];
  const map: DecodedMap = exactKeys(loose, keys, "a fact");
  switch (kind) {
    case "row":
      return {
        kind,
        rowIndex: count(field(map, "rowIndex"), "a row index"),
        cellCount: count(field(map, "cellCount"), "a cell count"),
      };
    case "value":
      return {
        kind,
        rowIndex: count(field(map, "rowIndex"), "a row index"),
        columnIndex: count(field(map, "columnIndex"), "a column index"),
        value: cellValue(field(map, "value")),
      };
    case "diagnostic":
      return { kind, diagnostic: diagnostic(field(map, "diagnostic")) };
    case "sheet":
      return {
        kind,
        sheetIndex: count(field(map, "sheetIndex"), "a sheet index"),
        name: text(field(map, "name"), "a sheet name"),
        sheetKind: oneOf(field(map, "sheetKind"), SHEET_KINDS, "a sheet kind"),
        visibility: oneOf(field(map, "visibility"), SHEET_VISIBILITIES, "a sheet visibility"),
        declaredRange: optionalRange(field(map, "declaredRange")),
        dateSystem: oneOf(field(map, "dateSystem"), DATE_SYSTEMS, "a date system"),
      };
    case "cell-format":
      return {
        kind,
        rowIndex: count(field(map, "rowIndex"), "a row index"),
        columnIndex: count(field(map, "columnIndex"), "a column index"),
        numberFormat: text(field(map, "numberFormat"), "a number format"),
        formatClass: oneOf(field(map, "formatClass"), FORMAT_CLASSES, "a format class"),
        currencySymbol: optionalText(field(map, "currencySymbol"), "a currency symbol"),
      };
    case "formula":
      return {
        kind,
        rowIndex: count(field(map, "rowIndex"), "a row index"),
        columnIndex: count(field(map, "columnIndex"), "a column index"),
        text: optionalText(field(map, "text"), "a formula"),
        sharedGroup: optionalCount(field(map, "sharedGroup"), "a shared group"),
        isArray: boolean(field(map, "isArray"), "an array flag"),
        isExternal: boolean(field(map, "isExternal"), "an external flag"),
      };
    case "declared-table":
      return {
        kind,
        name: text(field(map, "name"), "a table name"),
        range: range(field(map, "range")),
        headerRowCount: count(field(map, "headerRowCount"), "a header row count"),
        totalsRowCount: count(field(map, "totalsRowCount"), "a totals row count"),
        columns: list(field(map, "columns"), "table columns").map((entry) => text(entry, "a column name")),
      };
    case "validation": {
      const operator = field(map, "operator");
      return {
        kind,
        range: range(field(map, "range")),
        rule: oneOf(field(map, "rule"), VALIDATION_RULES, "a validation rule"),
        operator: operator === null ? null : oneOf(operator, VALIDATION_OPERATORS, "a validation operator"),
        listSource: listSource(field(map, "listSource")),
        formula1: optionalText(field(map, "formula1"), "a validation formula"),
        formula2: optionalText(field(map, "formula2"), "a validation formula"),
      };
    }
    case "merge":
      return { kind, range: range(field(map, "range")) };
    case "defined-name":
      return {
        kind,
        name: text(field(map, "name"), "a defined name"),
        ref: text(field(map, "ref"), "a defined name reference"),
        sheetIndex: optionalCount(field(map, "sheetIndex"), "a defined name scope"),
      };
    case "preserved-part": {
      const partKind = oneOf(field(map, "partKind"), PRESERVED_PART_KINDS, "a preserved part kind");
      const part = {
        kind,
        partKind,
        location: text(field(map, "location"), "a preserved part location"),
        reasonKey: oneOf(field(map, "reasonKey"), PRESERVED_REASON_KEYS, "a preserved reason"),
        anchor: optionalRange(field(map, "anchor")),
        partPath: optionalText(field(map, "partPath"), "a part path"),
      };
      if (!hasDefinition) return part;
      if (partKind === "chart") return { ...part, definition: chartDefinition(field(map, "definition")) };
      if (partKind === "pivot-table") return { ...part, definition: pivotDefinition(field(map, "definition")) };
      throw new CodecError(`a ${partKind} part carries no definition`);
    }
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
};

/** Reads one staged fact chunk back into the stream item it was written from. */
export function decodeFactStreamItem(payload: Uint8Array): WorkbookFactStreamItemV2 {
  const map = asMap(decodeCanonical(payload), "a staged fact chunk");
  const kind = oneOf(field(map, "kind"), ["batch", "summary"] as const, "a stream item kind");
  if (kind === "batch") {
    exactKeys(map, ["kind", "batchSeq", "facts"], "a fact batch");
    return {
      kind,
      batchSeq: count(field(map, "batchSeq"), "a batch sequence"),
      facts: list(field(map, "facts"), "batch facts").map(fact),
    };
  }
  exactKeys(
    map,
    ["kind", "rowCount", "columnCount", "valueCount", "batchCount", "diagnostics"],
    "a fact summary",
  );
  return {
    kind,
    rowCount: count(field(map, "rowCount"), "a row count"),
    columnCount: count(field(map, "columnCount"), "a column count"),
    valueCount: count(field(map, "valueCount"), "a value count"),
    batchCount: count(field(map, "batchCount"), "a batch count"),
    diagnostics: list(field(map, "diagnostics"), "summary diagnostics").map(diagnostic),
  };
}
